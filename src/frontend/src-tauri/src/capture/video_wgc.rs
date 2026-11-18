use crate::state::StreamPreset;
use livekit::webrtc::prelude::{I420Buffer, VideoFrame, VideoRotation};
use livekit::webrtc::video_source::native::NativeVideoSource;
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;
use yuv::{bgra_to_yuv420, YuvConversionMode, YuvPlanarImageMut, YuvRange, YuvStandardMatrix};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoCaptureExitReason {
    Cancelled,
    SourceClosed,
    DrmOrUnavailable,
}

pub fn preset_dimensions_and_fps(preset: StreamPreset) -> (u32, u32, u32) {
    match preset {
        StreamPreset::P720Fps30 => (1280, 720, 30),
        StreamPreset::P1080Fps60 => (1920, 1080, 60),
    }
}

/// Converts a top-down BGRA frame into a LiveKit `I420Buffer` using the `yuv` crate with SIMD acceleration.
pub fn convert_bgra_to_i420_simd(
    bgra: &[u8],
    src_stride: u32,
    width: u32,
    height: u32,
) -> Result<I420Buffer, String> {
    let even_w = (width & !1).max(2);
    let even_h = (height & !1).max(2);
    let mut i420 = I420Buffer::new(even_w, even_h);
    let (stride_y, stride_u, stride_v) = i420.strides();
    let (data_y, data_u, data_v) = i420.data_mut();

    let mut planar = YuvPlanarImageMut {
        y_plane: yuv::BufferStoreMut::Borrowed(data_y),
        y_stride: stride_y,
        u_plane: yuv::BufferStoreMut::Borrowed(data_u),
        u_stride: stride_u,
        v_plane: yuv::BufferStoreMut::Borrowed(data_v),
        v_stride: stride_v,
        width: even_w,
        height: even_h,
    };

    bgra_to_yuv420(
        &mut planar,
        bgra,
        src_stride,
        YuvRange::Limited,
        YuvStandardMatrix::Bt709,
        YuvConversionMode::Balanced,
    )
    .map_err(|e| format!("YUV_SIMD_CONVERSION_FAILED: {e:?}"))?;

    Ok(i420)
}

/// Nearest-neighbor proportional downscale for BGRA frames exceeding the target preset resolution.
pub fn scale_bgra_frame_if_needed(
    src: &[u8],
    src_stride: u32,
    src_w: u32,
    src_h: u32,
    max_w: u32,
    max_h: u32,
) -> (Vec<u8>, u32, u32, u32) {
    let target_w = (src_w.min(max_w) & !1).max(2);
    let target_h = (src_h.min(max_h) & !1).max(2);

    if target_w == src_w && target_h == src_h && src_stride == src_w * 4 {
        return (src.to_vec(), src_stride, target_w, target_h);
    }

    let dst_stride = target_w * 4;
    let mut dst = vec![0u8; (dst_stride * target_h) as usize];

    for y in 0..target_h {
        let src_y = ((y as u64 * src_h as u64) / target_h as u64) as u32;
        let src_row_offset = (src_y * src_stride) as usize;
        let dst_row_offset = (y * dst_stride) as usize;

        for x in 0..target_w {
            let src_x = ((x as u64 * src_w as u64) / target_w as u64) as u32;
            let s_idx = src_row_offset + (src_x * 4) as usize;
            let d_idx = dst_row_offset + (x * 4) as usize;
            if s_idx + 4 <= src.len() && d_idx + 4 <= dst.len() {
                dst[d_idx..d_idx + 4].copy_from_slice(&src[s_idx..s_idx + 4]);
            }
        }
    }

    (dst, dst_stride, target_w, target_h)
}

pub fn run_wgc_capture_loop<F>(
    source_id: String,
    preset: StreamPreset,
    video_source: NativeVideoSource,
    cancel_token: CancellationToken,
    on_exit: F,
) -> Result<(), String>
where
    F: FnOnce(VideoCaptureExitReason) + Send + 'static,
{
    #[cfg(windows)]
    {
        win32_wgc::spawn_wgc_thread(source_id, preset, video_source, cancel_token, on_exit)
    }

    #[cfg(not(windows))]
    {
        let _ = (source_id, preset, video_source, cancel_token);
        on_exit(VideoCaptureExitReason::Cancelled);
        Ok(())
    }
}

#[cfg(windows)]
mod win32_wgc {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use windows::core::Interface;
    use windows::Foundation::TypedEventHandler;
    use windows::Graphics::Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem};
    use windows::Graphics::DirectX::DirectXPixelFormat;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
    use windows::Win32::Graphics::Direct3D11::{
        D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
        D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE,
        D3D11_MAP_READ, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
    };
    use windows::Win32::Graphics::Dxgi::IDXGIDevice;
    use windows::Win32::Graphics::Gdi::HMONITOR;
    use windows::Win32::System::WinRT::Direct3D11::{
        CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
    };
    use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
    use windows::Win32::UI::WindowsAndMessaging::{IsIconic, IsWindow};

    pub fn spawn_wgc_thread<F>(
        source_id: String,
        preset: StreamPreset,
        video_source: NativeVideoSource,
        cancel_token: CancellationToken,
        on_exit: F,
    ) -> Result<(), String>
    where
        F: FnOnce(VideoCaptureExitReason) + Send + 'static,
    {
        // Validate source_id format upfront
        let parsed_target = parse_capture_target(&source_id)?;

        std::thread::Builder::new()
            .name("jdisc-wgc-capture".to_string())
            .spawn(move || {
                let reason = execute_wgc_session(parsed_target, preset, video_source, cancel_token);
                on_exit(reason);
            })
            .map_err(|e| format!("WGC_THREAD_SPAWN_FAILED: {e}"))?;

        Ok(())
    }

    enum CaptureTarget {
        Window(usize),
        Monitor(usize),
    }

    fn parse_capture_target(source_id: &str) -> Result<CaptureTarget, String> {
        if let Some(raw_hwnd) = source_id.strip_prefix("window:") {
            let val = raw_hwnd
                .parse::<usize>()
                .map_err(|_| "SOURCE_NOT_FOUND".to_string())?;
            let hwnd = HWND(val as *mut _);
            let exists = unsafe { IsWindow(hwnd).as_bool() };
            if !exists {
                return Err("SOURCE_NOT_FOUND".to_string());
            }
            Ok(CaptureTarget::Window(val))
        } else if let Some(raw_hmon) = source_id.strip_prefix("monitor:") {
            let val = raw_hmon
                .parse::<usize>()
                .map_err(|_| "SOURCE_NOT_FOUND".to_string())?;
            Ok(CaptureTarget::Monitor(val))
        } else {
            Err("SOURCE_NOT_FOUND".to_string())
        }
    }

    fn create_capture_item(target: &CaptureTarget) -> Result<GraphicsCaptureItem, String> {
        let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
            .map_err(|e| format!("WGC_INTEROP_FAILED: {e}"))?;

        unsafe {
            match *target {
                CaptureTarget::Window(val) => interop
                    .CreateForWindow::<_, GraphicsCaptureItem>(HWND(val as *mut _))
                    .map_err(|e| format!("WGC_CREATE_FOR_WINDOW_FAILED: {e}")),
                CaptureTarget::Monitor(val) => interop
                    .CreateForMonitor::<_, GraphicsCaptureItem>(HMONITOR(val as *mut _))
                    .map_err(|e| format!("WGC_CREATE_FOR_MONITOR_FAILED: {e}")),
            }
        }
    }

    fn execute_wgc_session(
        target: CaptureTarget,
        preset: StreamPreset,
        video_source: NativeVideoSource,
        cancel_token: CancellationToken,
    ) -> VideoCaptureExitReason {
        let (max_w, max_h, fps) = preset_dimensions_and_fps(preset);
        let frame_interval = Duration::from_micros(1_000_000 / fps as u64);

        let mut d3d_device: Option<ID3D11Device> = None;
        let mut d3d_context: Option<ID3D11DeviceContext> = None;

        let hr = unsafe {
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                None,
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut d3d_device),
                None,
                Some(&mut d3d_context),
            )
        };

        if hr.is_err() {
            return VideoCaptureExitReason::DrmOrUnavailable;
        }

        let d3d_device = match d3d_device {
            Some(d) => d,
            None => return VideoCaptureExitReason::DrmOrUnavailable,
        };
        let d3d_context = match d3d_context {
            Some(c) => c,
            None => return VideoCaptureExitReason::DrmOrUnavailable,
        };

        let dxgi_device: IDXGIDevice = match d3d_device.cast() {
            Ok(d) => d,
            Err(_) => return VideoCaptureExitReason::DrmOrUnavailable,
        };

        let inspectable = match unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi_device) } {
            Ok(i) => i,
            Err(_) => return VideoCaptureExitReason::DrmOrUnavailable,
        };

        let winrt_device: windows::Graphics::DirectX::Direct3D11::IDirect3DDevice =
            match inspectable.cast() {
                Ok(d) => d,
                Err(_) => return VideoCaptureExitReason::DrmOrUnavailable,
            };

        let item = match create_capture_item(&target) {
            Ok(it) => it,
            Err(_) => return VideoCaptureExitReason::SourceClosed,
        };

        let item_closed = Arc::new(AtomicBool::new(false));
        let item_closed_clone = Arc::clone(&item_closed);
        let _closed_token = item.Closed(&TypedEventHandler::new(move |_, _| {
            item_closed_clone.store(true, Ordering::SeqCst);
            Ok(())
        }));

        let size = match item.Size() {
            Ok(s) if s.Width > 0 && s.Height > 0 => s,
            _ => return VideoCaptureExitReason::DrmOrUnavailable,
        };

        let frame_pool = match Direct3D11CaptureFramePool::CreateFreeThreaded(
            &winrt_device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            size,
        ) {
            Ok(p) => p,
            Err(_) => return VideoCaptureExitReason::DrmOrUnavailable,
        };

        let session = match frame_pool.CreateCaptureSession(&item) {
            Ok(s) => s,
            Err(_) => return VideoCaptureExitReason::DrmOrUnavailable,
        };

        // Best-effort disable yellow border on Windows 11+
        let _ = session.SetIsBorderRequired(false);

        if session.StartCapture().is_err() {
            return VideoCaptureExitReason::DrmOrUnavailable;
        }

        let mut last_frame_sent = Instant::now() - frame_interval;
        let mut last_valid_bgra: Option<(Vec<u8>, u32, u32, u32)> = None;

        while !cancel_token.is_cancelled() {
            if item_closed.load(Ordering::SeqCst) {
                let _ = session.Close();
                let _ = frame_pool.Close();
                return VideoCaptureExitReason::SourceClosed;
            }

            if let CaptureTarget::Window(raw_hwnd) = target {
                let hwnd = HWND(raw_hwnd as *mut _);
                unsafe {
                    if !IsWindow(hwnd).as_bool() {
                        let _ = session.Close();
                        let _ = frame_pool.Close();
                        return VideoCaptureExitReason::SourceClosed;
                    }
                    // Graceful handling of minimized windows: retain last valid frame at low rate without dropping voice or WGC
                    if IsIconic(hwnd).as_bool() {
                        if let Some((ref bgra, stride, w, h)) = last_valid_bgra {
                            if let Ok(i420) = convert_bgra_to_i420_simd(bgra, stride, w, h) {
                                let video_frame = VideoFrame::new(VideoRotation::VideoRotation0, i420);
                                video_source.capture_frame(&video_frame);
                            }
                        }
                        std::thread::sleep(Duration::from_millis(100));
                        continue;
                    }
                }
            }

            if let Ok(frame) = frame_pool.TryGetNextFrame() {
                let now = Instant::now();
                if now.duration_since(last_frame_sent) >= frame_interval {
                    if let Ok(surface) = frame.Surface() {
                        if let Ok(access) = surface.cast::<IDirect3DDxgiInterfaceAccess>() {
                            if let Ok(tex) = unsafe { access.GetInterface::<ID3D11Texture2D>() } {
                                if let Some((scaled_bgra, scaled_stride, out_w, out_h)) =
                                    copy_texture_and_scale(&d3d_device, &d3d_context, &tex, max_w, max_h)
                                {
                                    if let Ok(i420) = convert_bgra_to_i420_simd(
                                        &scaled_bgra,
                                        scaled_stride,
                                        out_w,
                                        out_h,
                                    ) {
                                        let video_frame =
                                            VideoFrame::new(VideoRotation::VideoRotation0, i420);
                                        video_source.capture_frame(&video_frame);
                                        last_valid_bgra =
                                            Some((scaled_bgra, scaled_stride, out_w, out_h));
                                        last_frame_sent = now;
                                    }
                                }
                            }
                        }
                    }
                }
                let _ = frame.Close();
            } else {
                std::thread::sleep(Duration::from_millis(4));
            }
        }

        let _ = session.Close();
        let _ = frame_pool.Close();
        VideoCaptureExitReason::Cancelled
    }

    fn copy_texture_and_scale(
        device: &ID3D11Device,
        context: &ID3D11DeviceContext,
        texture: &ID3D11Texture2D,
        max_w: u32,
        max_h: u32,
    ) -> Option<(Vec<u8>, u32, u32, u32)> {
        unsafe {
            let mut desc = D3D11_TEXTURE2D_DESC::default();
            texture.GetDesc(&mut desc);
            if desc.Width < 2 || desc.Height < 2 {
                return None;
            }

            let mut staging_desc = desc;
            staging_desc.Usage = D3D11_USAGE_STAGING;
            staging_desc.BindFlags = 0;
            staging_desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
            staging_desc.MiscFlags = 0;

            let mut staging_tex: Option<ID3D11Texture2D> = None;
            if device
                .CreateTexture2D(&staging_desc, None, Some(&mut staging_tex))
                .is_err()
            {
                return None;
            }
            let staging_tex = staging_tex?;

            context.CopyResource(&staging_tex, texture);

            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            if context
                .Map(&staging_tex, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
                .is_err()
            {
                return None;
            }

            let total_bytes = (mapped.RowPitch * desc.Height) as usize;
            let raw_slice = std::slice::from_raw_parts(mapped.pData as *const u8, total_bytes);

            let scaled = scale_bgra_frame_if_needed(
                raw_slice,
                mapped.RowPitch,
                desc.Width,
                desc.Height,
                max_w,
                max_h,
            );

            context.Unmap(&staging_tex, 0);

            Some(scaled)
        }
    }
}
