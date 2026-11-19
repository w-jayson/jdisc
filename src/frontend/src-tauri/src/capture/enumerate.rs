use crate::state::{CaptureSource, CaptureSourceKind};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSourcesResult {
    pub windows: Vec<CaptureSource>,
    pub monitors: Vec<CaptureSource>,
    pub process_audio_supported: bool,
}

/// Detects whether the current Windows OS build supports WASAPI Process Loopback (>= Build 19041 / 2004).
pub fn is_process_audio_loopback_supported() -> bool {
    #[cfg(windows)]
    {
        win32_impl::check_windows_build_supports_process_loopback()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

pub fn list_all_capture_sources() -> Result<CaptureSourcesResult, String> {
    let process_audio_supported = is_process_audio_loopback_supported();

    #[cfg(windows)]
    {
        let windows = win32_impl::enumerate_eligible_windows(process_audio_supported)?;
        let monitors = win32_impl::enumerate_monitors()?;
        Ok(CaptureSourcesResult {
            windows,
            monitors,
            process_audio_supported,
        })
    }

    #[cfg(not(windows))]
    {
        let _ = BASE64.encode(b"");
        Ok(CaptureSourcesResult {
            windows: Vec::new(),
            monitors: Vec::new(),
            process_audio_supported,
        })
    }
}

#[cfg(windows)]
mod win32_impl {
    use super::*;
    use std::ffi::OsString;
    use std::mem::size_of;
    use std::os::windows::ffi::OsStringExt;
    use std::path::Path;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, BOOL, HWND, LPARAM, RECT, TRUE};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
    use windows::Win32::Graphics::Gdi::{
        DeleteObject, EnumDisplayMonitors, GetDC, GetDIBits, GetMonitorInfoW, GetObjectW,
        ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HDC, HMONITOR,
        MONITORINFOEXW,
    };
    use windows::Win32::System::Threading::{
        GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        DestroyIcon, GetClassLongPtrW, GetIconInfo, GetWindowLongW, GetWindowRect,
        GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
        SendMessageTimeoutW, GCLP_HICON, GCLP_HICONSM, GWL_EXSTYLE, HICON, ICONINFO, ICON_BIG,
        ICON_SMALL2, SMTO_ABORTIFHUNG, WM_GETICON, WS_EX_TOOLWINDOW,
    };

    #[repr(C)]
    struct RtlOsVersionInfoExW {
        dw_os_version_info_size: u32,
        dw_major_version: u32,
        dw_minor_version: u32,
        dw_build_number: u32,
        dw_platform_id: u32,
        sz_csd_version: [u16; 128],
    }

    #[link(name = "ntdll")]
    extern "system" {
        fn RtlGetVersion(lp_version_information: *mut RtlOsVersionInfoExW) -> i32;
    }

    pub fn check_windows_build_supports_process_loopback() -> bool {
        unsafe {
            let mut info: RtlOsVersionInfoExW = std::mem::zeroed();
            info.dw_os_version_info_size = size_of::<RtlOsVersionInfoExW>() as u32;
            if RtlGetVersion(&mut info) == 0 {
                // Windows 10 version 2004 (Build 19041+) / Windows 11 (22000+)
                info.dw_major_version >= 10 && info.dw_build_number >= 19041
            } else {
                true
            }
        }
    }

    struct EnumWindowsContext {
        current_pid: u32,
        process_audio_supported: bool,
        sources: Vec<CaptureSource>,
    }

    pub fn enumerate_eligible_windows(
        process_audio_supported: bool,
    ) -> Result<Vec<CaptureSource>, String> {
        let mut ctx = EnumWindowsContext {
            current_pid: unsafe { GetCurrentProcessId() },
            process_audio_supported,
            sources: Vec::new(),
        };

        unsafe {
            let lparam = LPARAM(&mut ctx as *mut EnumWindowsContext as isize);
            let _ = windows::Win32::UI::WindowsAndMessaging::EnumWindows(
                Some(enum_windows_proc),
                lparam,
            );
        }

        Ok(ctx.sources)
    }

    unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = &mut *(lparam.0 as *mut EnumWindowsContext);

        if !IsWindowVisible(hwnd).as_bool() {
            return TRUE;
        }

        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        if (ex_style & WS_EX_TOOLWINDOW.0) != 0 {
            return TRUE;
        }

        let mut cloaked: u32 = 0;
        let _ = DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut _,
            size_of::<u32>() as u32,
        );
        if cloaked != 0 {
            return TRUE;
        }

        let title_len = GetWindowTextLengthW(hwnd);
        if title_len <= 0 {
            return TRUE;
        }

        let mut title_buf = vec![0u16; (title_len + 1) as usize];
        let read_len = GetWindowTextW(hwnd, &mut title_buf);
        if read_len <= 0 {
            return TRUE;
        }
        let title = OsString::from_wide(&title_buf[..read_len as usize])
            .to_string_lossy()
            .trim()
            .to_string();
        if title.is_empty() {
            return TRUE;
        }

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 || pid == ctx.current_pid {
            return TRUE;
        }

        let mut rect = RECT::default();
        let _ = GetWindowRect(hwnd, &mut rect);
        let width = (rect.right - rect.left).max(0) as u32;
        let height = (rect.bottom - rect.top).max(0) as u32;
        if !IsIconic(hwnd).as_bool() && (width < 64 || height < 64) {
            return TRUE;
        }

        let process_name = query_process_exe_name(pid);
        let icon_base64 = extract_window_icon_png_base64(hwnd);
        let hwnd_val = hwnd.0 as usize;

        ctx.sources.push(CaptureSource {
            id: format!("window:{hwnd_val}"),
            kind: CaptureSourceKind::Window,
            title,
            process_id: Some(pid),
            process_name,
            icon_base64,
            width: width.max(1280),
            height: height.max(720),
            supports_process_audio_isolation: ctx.process_audio_supported,
        });

        TRUE
    }

    unsafe fn query_process_exe_name(pid: u32) -> Option<String> {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = vec![0u16; 1024];
        let mut size = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut size,
        )
        .is_ok();
        let _ = CloseHandle(handle);

        if !ok || size == 0 {
            return None;
        }

        let full_path = OsString::from_wide(&buf[..size as usize])
            .to_string_lossy()
            .into_owned();
        Path::new(&full_path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
    }

    unsafe fn extract_window_icon_png_base64(hwnd: HWND) -> Option<String> {
        let mut icon_handle: usize = 0;
        let _ = SendMessageTimeoutW(
            hwnd,
            WM_GETICON,
            windows::Win32::Foundation::WPARAM(ICON_BIG as usize),
            windows::Win32::Foundation::LPARAM(0),
            SMTO_ABORTIFHUNG,
            50,
            Some(&mut icon_handle),
        );

        if icon_handle == 0 {
            let _ = SendMessageTimeoutW(
                hwnd,
                WM_GETICON,
                windows::Win32::Foundation::WPARAM(ICON_SMALL2 as usize),
                windows::Win32::Foundation::LPARAM(0),
                SMTO_ABORTIFHUNG,
                50,
                Some(&mut icon_handle),
            );
        }

        if icon_handle == 0 {
            icon_handle = GetClassLongPtrW(hwnd, GCLP_HICON);
        }
        if icon_handle == 0 {
            icon_handle = GetClassLongPtrW(hwnd, GCLP_HICONSM);
        }
        if icon_handle == 0 {
            return None;
        }

        let hicon = HICON(icon_handle as *mut _);
        hicon_to_png_base64(hicon)
    }

    unsafe fn hicon_to_png_base64(hicon: HICON) -> Option<String> {
        let mut icon_info = ICONINFO::default();
        if GetIconInfo(hicon, &mut icon_info).is_err() {
            return None;
        }

        let hbm_color = icon_info.hbmColor;
        let hbm_mask = icon_info.hbmMask;

        let mut bmp = BITMAP::default();
        let got_obj = GetObjectW(
            hbm_color,
            size_of::<BITMAP>() as i32,
            Some(&mut bmp as *mut BITMAP as *mut _),
        );

        if got_obj == 0 || bmp.bmWidth <= 0 || bmp.bmHeight <= 0 {
            if !hbm_color.is_invalid() {
                let _ = DeleteObject(hbm_color);
            }
            if !hbm_mask.is_invalid() {
                let _ = DeleteObject(hbm_mask);
            }
            return None;
        }

        let width = bmp.bmWidth as u32;
        let height = bmp.bmHeight as u32;

        let mut bmi = BITMAPINFO::default();
        bmi.bmiHeader.biSize = size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = width as i32;
        bmi.bmiHeader.biHeight = -(height as i32); // top-down
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB.0;

        let mut pixels = vec![0u8; (width * height * 4) as usize];
        let hdc = GetDC(HWND::default());
        let lines = GetDIBits(
            hdc,
            hbm_color,
            0,
            height,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );
        let _ = ReleaseDC(HWND::default(), hdc);

        if !hbm_color.is_invalid() {
            let _ = DeleteObject(hbm_color);
        }
        if !hbm_mask.is_invalid() {
            let _ = DeleteObject(hbm_mask);
        }
        let _ = DestroyIcon(hicon);

        if lines == 0 {
            return None;
        }

        // Convert BGRA to RGBA
        for chunk in pixels.chunks_exact_mut(4) {
            chunk.swap(0, 2);
        }

        let mut png_bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png_bytes, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().ok()?;
            writer.write_image_data(&pixels).ok()?;
        }

        Some(format!(
            "data:image/png;base64,{}",
            BASE64.encode(png_bytes)
        ))
    }

    pub fn enumerate_monitors() -> Result<Vec<CaptureSource>, String> {
        let mut monitors: Vec<CaptureSource> = Vec::new();
        unsafe {
            let lparam = LPARAM(&mut monitors as *mut Vec<CaptureSource> as isize);
            let _ = EnumDisplayMonitors(HDC::default(), None, Some(enum_monitors_proc), lparam);
        }
        Ok(monitors)
    }

    unsafe extern "system" fn enum_monitors_proc(
        hmonitor: HMONITOR,
        _hdc: HDC,
        _rect: *mut RECT,
        lparam: LPARAM,
    ) -> BOOL {
        let list = &mut *(lparam.0 as *mut Vec<CaptureSource>);
        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;

        if GetMonitorInfoW(hmonitor, &mut info.monitorInfo).as_bool() {
            let rc = info.monitorInfo.rcMonitor;
            let width = (rc.right - rc.left).max(1280) as u32;
            let height = (rc.bottom - rc.top).max(720) as u32;
            let idx = list.len() + 1;
            let is_primary = (info.monitorInfo.dwFlags & 1) != 0;
            let suffix = if is_primary { " — Principal" } else { "" };
            let hmon_val = hmonitor.0 as usize;

            list.push(CaptureSource {
                id: format!("monitor:{hmon_val}"),
                kind: CaptureSourceKind::Monitor,
                title: format!("Monitor {idx} ({width}x{height}){suffix}"),
                process_id: None,
                process_name: None,
                icon_base64: None,
                width,
                height,
                supports_process_audio_isolation: false,
            });
        }

        TRUE
    }
}
