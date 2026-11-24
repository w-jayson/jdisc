use crate::state::{StreamAspectMode, StreamPreset};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use livekit::webrtc::prelude::{I420Buffer, VideoFrame, VideoRotation};
use livekit::webrtc::video_source::native::NativeVideoSource;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;
use yuv::{bgra_to_yuv420, YuvConversionMode, YuvPlanarImageMut, YuvRange, YuvStandardMatrix};

pub const PREVIEW_MAX_WIDTH: u32 = 480;
pub const PREVIEW_MAX_HEIGHT: u32 = 270;
pub const PREVIEW_INTERVAL: Duration = Duration::from_millis(250);

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

/// Scales (and optionally crops/stretches) a BGRA frame according to the active `StreamAspectMode`.
///
/// - `Original`: preserves aspect ratio proportionally when downscaling to fit `(max_w, max_h)`.
/// - `Stretch16x9`: stretches the active `(src_w, src_h)` region to fill `(max_w, max_h)` (16:9).
/// - `Crop4x3Stretch16x9`: if wider than 4:3 (e.g., 16:9 frame with desktop bleed on the right),
///   crops the left 4:3 region (`src_h * 4 / 3`) and stretches it to `(max_w, max_h)` (16:9).
pub fn scale_bgra_frame_if_needed(
    src: &[u8],
    src_stride: u32,
    src_w: u32,
    src_h: u32,
    max_w: u32,
    max_h: u32,
    aspect_mode: StreamAspectMode,
) -> (Vec<u8>, u32, u32, u32) {
    let crop_w = match aspect_mode {
        StreamAspectMode::Crop4x3Stretch16x9 if (src_w as u64) * 3 > (src_h as u64) * 4 => {
            (((src_h as u64) * 4) / 3).max(2).min(src_w as u64) as u32
        }
        _ => src_w.max(2),
    };
    let crop_h = src_h.max(2);

    let (target_w, target_h) = match aspect_mode {
        StreamAspectMode::Original => {
            let scale = (max_w as f64 / crop_w as f64)
                .min(max_h as f64 / crop_h as f64)
                .min(1.0);
            let w = ((crop_w as f64 * scale).round() as u32).clamp(2, max_w) & !1;
            let h = ((crop_h as f64 * scale).round() as u32).clamp(2, max_h) & !1;
            (w.max(2), h.max(2))
        }
        StreamAspectMode::Stretch16x9 | StreamAspectMode::Crop4x3Stretch16x9 => {
            ((max_w & !1).max(2), (max_h & !1).max(2))
        }
    };

    let dst_stride = target_w * 4;
    let required_fast_bytes = (dst_stride as usize) * (target_h as usize);
    if target_w == crop_w
        && target_h == crop_h
        && src_stride == dst_stride
        && src.len() >= required_fast_bytes
    {
        return (
            src[..required_fast_bytes].to_vec(),
            dst_stride,
            target_w,
            target_h,
        );
    }

    let mut dst = vec![0u8; required_fast_bytes];
    let x_offsets: Vec<usize> = (0..target_w)
        .map(|x| ((((x as u64) * (crop_w as u64)) / (target_w as u64)) as usize) * 4)
        .collect();

    for y in 0..target_h {
        let src_y = (((y as u64) * (crop_h as u64)) / (target_h as u64)) as u32;
        let src_row_offset = (src_y as usize) * (src_stride as usize);
        let dst_row_offset = (y as usize) * (dst_stride as usize);

        for (x, &sx_off) in x_offsets.iter().enumerate() {
            let s_idx = src_row_offset + sx_off;
            let d_idx = dst_row_offset + x * 4;
            if s_idx + 4 <= src.len() && d_idx + 4 <= dst.len() {
                dst[d_idx..d_idx + 4].copy_from_slice(&src[s_idx..s_idx + 4]);
            }
        }
    }

    (dst, dst_stride, target_w, target_h)
}

/// Proportional nearest-neighbor downscale directly from BGRA to packed RGB for lightweight local preview.
pub fn downscale_bgra_to_rgb_proportional(
    src: &[u8],
    src_stride: u32,
    src_w: u32,
    src_h: u32,
    max_w: u32,
    max_h: u32,
) -> Option<(Vec<u8>, u32, u32)> {
    if src_w < 2 || src_h < 2 || max_w < 2 || max_h < 2 {
        return None;
    }

    let scale = (max_w as f64 / src_w as f64)
        .min(max_h as f64 / src_h as f64)
        .min(1.0);
    let target_w = ((src_w as f64 * scale).round() as u32).clamp(2, max_w);
    let target_h = ((src_h as f64 * scale).round() as u32).clamp(2, max_h);

    let mut dst = vec![0u8; (target_w * target_h * 3) as usize];

    for y in 0..target_h {
        let src_y = ((y as u64 * src_h as u64) / target_h as u64) as u32;
        let src_row_offset = (src_y * src_stride) as usize;
        let dst_row_offset = (y * target_w * 3) as usize;

        for x in 0..target_w {
            let src_x = ((x as u64 * src_w as u64) / target_w as u64) as u32;
            let s_idx = src_row_offset + (src_x * 4) as usize;
            let d_idx = dst_row_offset + (x * 3) as usize;
            if s_idx + 3 < src.len() && d_idx + 2 < dst.len() {
                dst[d_idx] = src[s_idx + 2];
                dst[d_idx + 1] = src[s_idx + 1];
                dst[d_idx + 2] = src[s_idx];
            }
        }
    }

    Some((dst, target_w, target_h))
}

/// Encodes a packed RGB preview frame into a fast PNG data URL.
pub fn encode_rgb_preview_data_url(rgb: &[u8], width: u32, height: u32) -> Option<String> {
    if width < 2 || height < 2 || rgb.len() != (width * height * 3) as usize {
        return None;
    }

    let mut png_bytes = Vec::with_capacity((width * height) as usize);
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, width, height);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Fastest);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(rgb).ok()?;
    }

    Some(format!(
        "data:image/png;base64,{}",
        BASE64.encode(png_bytes)
    ))
}

pub fn run_wgc_capture_loop<F, P>(
    source_id: String,
    preset: StreamPreset,
    video_source: NativeVideoSource,
    cancel_token: CancellationToken,
    preview_enabled: Arc<AtomicBool>,
    aspect_mode: Arc<AtomicU8>,
    on_preview_frame: P,
    on_exit: F,
) -> Result<(), String>
where
    F: FnOnce(VideoCaptureExitReason) + Send + 'static,
    P: Fn(String, u32, u32) + Send + 'static,
{
    #[cfg(windows)]
    {
        win32_wgc::spawn_wgc_thread(
            source_id,
            preset,
            video_source,
            cancel_token,
            preview_enabled,
            aspect_mode,
            on_preview_frame,
            on_exit,
        )
    }

    #[cfg(not(windows))]
    {
        let _ = (
            source_id,
            preset,
            video_source,
            cancel_token,
            preview_enabled,
            aspect_mode,
            on_preview_frame,
        );
        on_exit(VideoCaptureExitReason::Cancelled);
        Ok(())
    }
}

#[cfg(windows)]
mod win32_wgc {
    use super::*;
    use std::sync::mpsc;
    use windows::core::{Interface, PCWSTR};
    use windows::Foundation::TypedEventHandler;
    use windows::Graphics::Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem};
    use windows::Graphics::DirectX::DirectXPixelFormat;
    use windows::Win32::Foundation::{HMODULE, HWND, RECT};
    use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
    use windows::Win32::Graphics::Direct3D11::{
        D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
        D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE,
        D3D11_MAP_READ, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
    };
    use windows::Win32::Graphics::Dxgi::IDXGIDevice;
    use windows::Win32::Graphics::Gdi::{
        EnumDisplaySettingsW, GetMonitorInfoW, MonitorFromWindow, DEVMODEW, ENUM_CURRENT_SETTINGS,
        HMONITOR, MONITORINFOEXW, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::System::WinRT::Direct3D11::{
        CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
    };
    use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowRect, IsIconic, IsWindow};

    pub fn spawn_wgc_thread<F, P>(
        source_id: String,
        preset: StreamPreset,
        video_source: NativeVideoSource,
        cancel_token: CancellationToken,
        preview_enabled: Arc<AtomicBool>,
        aspect_mode: Arc<AtomicU8>,
        on_preview_frame: P,
        on_exit: F,
    ) -> Result<(), String>
    where
        F: FnOnce(VideoCaptureExitReason) + Send + 'static,
        P: Fn(String, u32, u32) + Send + 'static,
    {
        // Validate source_id format upfront
        let parsed_target = parse_capture_target(&source_id)?;

        std::thread::Builder::new()
            .name("jdisc-wgc-capture".to_string())
            .spawn(move || {
                let reason = execute_wgc_session(
                    parsed_target,
                    preset,
                    video_source,
                    cancel_token,
                    preview_enabled,
                    aspect_mode,
                    on_preview_frame,
                );
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
            let exists = unsafe { IsWindow(Some(hwnd)).as_bool() };
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
                    .CreateForWindow::<GraphicsCaptureItem>(HWND(val as *mut _))
                    .map_err(|e| format!("WGC_CREATE_FOR_WINDOW_FAILED: {e}")),
                CaptureTarget::Monitor(val) => interop
                    .CreateForMonitor::<GraphicsCaptureItem>(HMONITOR(val as *mut _))
                    .map_err(|e| format!("WGC_CREATE_FOR_MONITOR_FAILED: {e}")),
            }
        }
    }

    /// Queries the active physical display mode (`dmPelsWidth x dmPelsHeight`) of the target's monitor.
    ///
    /// For monitors, this always reflects the current display resolution.
    /// For windows, this is returned only when the window is anchored to the monitor's top-left corner
    /// (e.g. fullscreen/borderless games like CS2 4:3), preventing stale desktop bleed outside the
    /// active fullscreen resolution without clipping normal windows dragged across monitors.
    fn query_active_monitor_clamp(target: &CaptureTarget) -> Option<(u32, u32)> {
        unsafe {
            let (hmon, win_rect_opt) = match *target {
                CaptureTarget::Window(raw_hwnd) => {
                    let hwnd = HWND(raw_hwnd as *mut _);
                    let mut rc = RECT::default();
                    if GetWindowRect(hwnd, &mut rc).is_err() {
                        return None;
                    }
                    let hmon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
                    (hmon, Some(rc))
                }
                CaptureTarget::Monitor(raw_hmon) => (HMONITOR(raw_hmon as *mut _), None),
            };

            if hmon.is_invalid() {
                return None;
            }

            let mut info = MONITORINFOEXW::default();
            info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
            if !GetMonitorInfoW(hmon, &mut info.monitorInfo).as_bool() {
                return None;
            }

            if let Some(win_rc) = win_rect_opt {
                let mon_rc = info.monitorInfo.rcMonitor;
                let anchored_top_left =
                    (win_rc.left - mon_rc.left).abs() <= 2 && (win_rc.top - mon_rc.top).abs() <= 2;
                if !anchored_top_left {
                    return None;
                }
            }

            let mut devmode = DEVMODEW::default();
            devmode.dmSize = std::mem::size_of::<DEVMODEW>() as u16;
            let device_name = PCWSTR::from_raw(info.szDevice.as_ptr());
            if EnumDisplaySettingsW(device_name, ENUM_CURRENT_SETTINGS, &mut devmode).as_bool()
                && devmode.dmPelsWidth >= 2
                && devmode.dmPelsHeight >= 2
            {
                Some((devmode.dmPelsWidth, devmode.dmPelsHeight))
            } else {
                None
            }
        }
    }

    fn execute_wgc_session<P>(
        target: CaptureTarget,
        preset: StreamPreset,
        video_source: NativeVideoSource,
        cancel_token: CancellationToken,
        preview_enabled: Arc<AtomicBool>,
        aspect_mode: Arc<AtomicU8>,
        on_preview_frame: P,
    ) -> VideoCaptureExitReason
    where
        P: Fn(String, u32, u32) + Send + 'static,
    {
        let (max_w, max_h, fps) = preset_dimensions_and_fps(preset);
        let frame_interval = Duration::from_micros(1_000_000 / fps as u64);
        let monitor_check_interval = Duration::from_millis(250);

        let (preview_tx, preview_rx) = mpsc::sync_channel::<(Vec<u8>, u32, u32)>(1);
        let _preview_thread = std::thread::Builder::new()
            .name("jdisc-wgc-preview".to_string())
            .spawn(move || {
                while let Ok((rgb, w, h)) = preview_rx.recv() {
                    if let Some(data_url) = encode_rgb_preview_data_url(&rgb, w, h) {
                        on_preview_frame(data_url, w, h);
                    }
                }
            });

        let mut d3d_device: Option<ID3D11Device> = None;
        let mut d3d_context: Option<ID3D11DeviceContext> = None;

        let hr = unsafe {
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
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

        let mut pool_size = match item.Size() {
            Ok(s) if s.Width > 0 && s.Height > 0 => s,
            _ => return VideoCaptureExitReason::DrmOrUnavailable,
        };

        let frame_pool = match Direct3D11CaptureFramePool::CreateFreeThreaded(
            &winrt_device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            pool_size,
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
        let mut last_preview_sent = Instant::now() - PREVIEW_INTERVAL;
        let mut last_monitor_check = Instant::now() - monitor_check_interval;
        let mut cached_monitor_clamp = query_active_monitor_clamp(&target);
        let mut preview_was_enabled = preview_enabled.load(Ordering::Relaxed);
        let mut last_aspect_mode = StreamAspectMode::from_u8(aspect_mode.load(Ordering::Relaxed));
        let mut last_valid_bgra: Option<(Vec<u8>, u32, u32, u32)> = None;

        while !cancel_token.is_cancelled() {
            if item_closed.load(Ordering::SeqCst) {
                let _ = session.Close();
                let _ = frame_pool.Close();
                return VideoCaptureExitReason::SourceClosed;
            }

            let is_preview_enabled = preview_enabled.load(Ordering::Relaxed);
            if is_preview_enabled && !preview_was_enabled {
                if let Some((ref bgra, stride, w, h)) = last_valid_bgra {
                    if let Some((rgb, pw, ph)) = downscale_bgra_to_rgb_proportional(
                        bgra,
                        stride,
                        w,
                        h,
                        PREVIEW_MAX_WIDTH,
                        PREVIEW_MAX_HEIGHT,
                    ) {
                        let _ = preview_tx.try_send((rgb, pw, ph));
                        last_preview_sent = Instant::now();
                    }
                }
            }
            preview_was_enabled = is_preview_enabled;

            if let CaptureTarget::Window(raw_hwnd) = target {
                let hwnd = HWND(raw_hwnd as *mut _);
                unsafe {
                    if !IsWindow(Some(hwnd)).as_bool() {
                        let _ = session.Close();
                        let _ = frame_pool.Close();
                        return VideoCaptureExitReason::SourceClosed;
                    }
                    // Graceful handling of minimized windows: retain last valid frame at low rate without dropping voice or WGC
                    if IsIconic(hwnd).as_bool() {
                        if let Some((ref bgra, stride, w, h)) = last_valid_bgra {
                            if let Ok(i420) = convert_bgra_to_i420_simd(bgra, stride, w, h) {
                                let video_frame =
                                    VideoFrame::new(VideoRotation::VideoRotation0, i420);
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
                let content_size = frame.ContentSize().unwrap_or(pool_size);
                let needs_recreate = content_size.Width > 0
                    && content_size.Height > 0
                    && (content_size.Width != pool_size.Width
                        || content_size.Height != pool_size.Height);
                let current_aspect_mode =
                    StreamAspectMode::from_u8(aspect_mode.load(Ordering::Relaxed));
                let aspect_changed = current_aspect_mode != last_aspect_mode;

                if needs_recreate
                    || aspect_changed
                    || now.duration_since(last_monitor_check) >= monitor_check_interval
                {
                    cached_monitor_clamp = query_active_monitor_clamp(&target);
                    last_monitor_check = now;
                }

                if aspect_changed || now.duration_since(last_frame_sent) >= frame_interval {
                    if let Ok(surface) = frame.Surface() {
                        if let Ok(access) = surface.cast::<IDirect3DDxgiInterfaceAccess>() {
                            if let Ok(tex) = unsafe { access.GetInterface::<ID3D11Texture2D>() } {
                                let content_w = content_size.Width.max(0) as u32;
                                let content_h = content_size.Height.max(0) as u32;
                                if let Some((scaled_bgra, scaled_stride, out_w, out_h)) =
                                    copy_texture_and_scale(
                                        &d3d_device,
                                        &d3d_context,
                                        &tex,
                                        content_w,
                                        content_h,
                                        cached_monitor_clamp,
                                        max_w,
                                        max_h,
                                        current_aspect_mode,
                                    )
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

                                        if is_preview_enabled
                                            && (aspect_changed
                                                || now.duration_since(last_preview_sent)
                                                    >= PREVIEW_INTERVAL)
                                        {
                                            if let Some((rgb, pw, ph)) =
                                                downscale_bgra_to_rgb_proportional(
                                                    &scaled_bgra,
                                                    scaled_stride,
                                                    out_w,
                                                    out_h,
                                                    PREVIEW_MAX_WIDTH,
                                                    PREVIEW_MAX_HEIGHT,
                                                )
                                            {
                                                let _ = preview_tx.try_send((rgb, pw, ph));
                                                last_preview_sent = now;
                                            }
                                        }

                                        last_valid_bgra =
                                            Some((scaled_bgra, scaled_stride, out_w, out_h));
                                        last_frame_sent = now;
                                        last_aspect_mode = current_aspect_mode;
                                    }
                                }
                            }
                        }
                    }
                }
                let _ = frame.Close();

                if needs_recreate
                    && frame_pool
                        .Recreate(
                            &winrt_device,
                            DirectXPixelFormat::B8G8R8A8UIntNormalized,
                            2,
                            content_size,
                        )
                        .is_ok()
                {
                    pool_size = content_size;
                }
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
        content_w: u32,
        content_h: u32,
        monitor_clamp: Option<(u32, u32)>,
        max_w: u32,
        max_h: u32,
        aspect_mode: StreamAspectMode,
    ) -> Option<(Vec<u8>, u32, u32, u32)> {
        unsafe {
            let mut desc = D3D11_TEXTURE2D_DESC::default();
            texture.GetDesc(&mut desc);
            if desc.Width < 2 || desc.Height < 2 {
                return None;
            }

            let mut effective_w = if content_w >= 2 {
                content_w.min(desc.Width)
            } else {
                desc.Width
            };
            let mut effective_h = if content_h >= 2 {
                content_h.min(desc.Height)
            } else {
                desc.Height
            };
            if let Some((mon_w, mon_h)) = monitor_clamp {
                effective_w = effective_w.min(mon_w);
                effective_h = effective_h.min(mon_h);
            }
            if effective_w < 2 || effective_h < 2 {
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

            let total_bytes = (mapped.RowPitch * effective_h) as usize;
            let raw_slice = std::slice::from_raw_parts(mapped.pData as *const u8, total_bytes);

            let scaled = scale_bgra_frame_if_needed(
                raw_slice,
                mapped.RowPitch,
                effective_w,
                effective_h,
                max_w,
                max_h,
                aspect_mode,
            );

            context.Unmap(&staging_tex, 0);

            Some(scaled)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downscales_bgra_to_rgb_preserving_aspect_ratio() {
        // 1920x1080 BGRA frame filled with (B=10, G=20, R=30, A=255)
        let w = 1920u32;
        let h = 1080u32;
        let stride = w * 4;
        let mut bgra = vec![0u8; (stride * h) as usize];
        for px in bgra.chunks_exact_mut(4) {
            px[0] = 10;
            px[1] = 20;
            px[2] = 30;
            px[3] = 255;
        }

        let (rgb, out_w, out_h) = downscale_bgra_to_rgb_proportional(
            &bgra,
            stride,
            w,
            h,
            PREVIEW_MAX_WIDTH,
            PREVIEW_MAX_HEIGHT,
        )
        .expect("preview downscale should succeed");

        assert_eq!(out_w, 480);
        assert_eq!(out_h, 270);
        assert_eq!(rgb.len(), (480 * 270 * 3) as usize);
        assert_eq!(&rgb[0..3], &[30, 20, 10]);
    }

    #[test]
    fn encodes_rgb_preview_as_png_data_url() {
        let rgb = vec![120u8; (4 * 4 * 3) as usize];
        let url = encode_rgb_preview_data_url(&rgb, 4, 4).expect("PNG encode should succeed");
        assert!(url.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn original_mode_preserves_4_3_aspect_ratio_on_720p_downscale() {
        let w = 144u32;
        let h = 108u32;
        let stride = w * 4;
        let bgra = vec![200u8; (stride * h) as usize];

        let (_out, out_stride, out_w, out_h) = scale_bgra_frame_if_needed(
            &bgra,
            stride,
            w,
            h,
            128,
            72,
            StreamAspectMode::Original,
        );

        assert_eq!(out_w, 96);
        assert_eq!(out_h, 72);
        assert_eq!(out_stride, 96 * 4);
    }

    #[test]
    fn stretch_16_9_stretches_4_3_frame_to_full_preset() {
        let w = 144u32;
        let h = 108u32;
        let stride = w * 4;
        let bgra = vec![50u8; (stride * h) as usize];

        let (out, out_stride, out_w, out_h) = scale_bgra_frame_if_needed(
            &bgra,
            stride,
            w,
            h,
            192,
            108,
            StreamAspectMode::Stretch16x9,
        );

        assert_eq!(out_w, 192);
        assert_eq!(out_h, 108);
        assert_eq!(out_stride, 192 * 4);
        assert_eq!(out.len(), (out_stride * out_h) as usize);
    }

    #[test]
    fn crop_4_3_stretch_16_9_discards_right_desktop_strip_and_stretches() {
        // Simulate 192x108 texture where left 144px is CS2 (B=10) and right 48px is desktop (B=250)
        let tex_w = 192u32;
        let tex_h = 108u32;
        let stride = tex_w * 4;
        let mut bgra = vec![0u8; (stride * tex_h) as usize];
        for y in 0..tex_h {
            for x in 0..tex_w {
                let idx = ((y * stride) + x * 4) as usize;
                let val = if x < 144 { 10 } else { 250 };
                bgra[idx] = val;
                bgra[idx + 1] = val;
                bgra[idx + 2] = val;
                bgra[idx + 3] = 255;
            }
        }

        let (out, _out_stride, out_w, out_h) = scale_bgra_frame_if_needed(
            &bgra,
            stride,
            tex_w,
            tex_h,
            192,
            108,
            StreamAspectMode::Crop4x3Stretch16x9,
        );

        assert_eq!(out_w, 192);
        assert_eq!(out_h, 108);
        // Every pixel in the output must come from the left 4:3 game region (value 10), never desktop (250)
        for px in out.chunks_exact(4) {
            assert_eq!(px[0], 10);
        }
    }
}
