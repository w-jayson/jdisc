use crate::audio::mixer::apply_mix_in_place;
use crate::capture::enumerate::is_process_audio_loopback_supported;
use crate::state::{AudioMixState, StreamAudioMode};
use livekit::webrtc::audio_source::native::NativeAudioSource;
use livekit::webrtc::prelude::AudioFrame;
use std::borrow::Cow;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

pub const SAMPLE_RATE: u32 = 48_000;
pub const NUM_CHANNELS: u32 = 2;
pub const SAMPLES_PER_10MS_CHANNEL: u32 = SAMPLE_RATE / 100; // 480 samples per channel (10ms)

#[derive(Debug, Clone)]
pub struct AudioCaptureStartOutcome {
    pub active_mode: StreamAudioMode,
    pub warning_code: Option<&'static str>,
    pub warning_message: Option<String>,
}

/// Which WASAPI loopback strategy should be (or was) used.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoopbackPlan {
    /// Capture ONLY the audio of the target process tree (e.g. the shared app/window).
    IncludeProcessTree(u32),
    /// Capture all system audio EXCEPT this process tree. Used with jdisc's own PID so the
    /// call voices (played by jdisc / its WebView2 children) never leak into the stream.
    ExcludeProcessTree(u32),
    /// Legacy endpoint loopback of the default render device (captures everything, echo risk).
    Endpoint,
}

const MSG_GLOBAL_ECHO_RISK: &str = "Capturando áudio global do sistema (monitor inteiro). Vozes da chamada podem gerar eco se reproduzidas no mesmo dispositivo.";
const MSG_PROCESS_UNSUPPORTED: &str = "Sua build do Windows não suporta isolamento de áudio por processo (requer Windows 10 2004+ / Windows 11). Usando captura global com risco de eco.";
const MSG_APP_ISOLATION_FAILED: &str = "Não foi possível isolar o áudio do app selecionado. Capturando o áudio do sistema (as vozes da chamada continuam excluídas).";

pub fn start_wasapi_audio_capture(
    requested_mode: StreamAudioMode,
    target_pid: Option<u32>,
    audio_source: NativeAudioSource,
    mix_state: Arc<AudioMixState>,
    cancel_token: CancellationToken,
    runtime_handle: tokio::runtime::Handle,
) -> Result<AudioCaptureStartOutcome, String> {
    if requested_mode == StreamAudioMode::None {
        return Ok(AudioCaptureStartOutcome {
            active_mode: StreamAudioMode::None,
            warning_code: None,
            warning_message: None,
        });
    }

    let process_supported = is_process_audio_loopback_supported();

    let plan = match (requested_mode, target_pid, process_supported) {
        (StreamAudioMode::ProcessTree, Some(pid), true) => LoopbackPlan::IncludeProcessTree(pid),
        (_, _, true) => LoopbackPlan::ExcludeProcessTree(std::process::id()),
        (_, _, false) => LoopbackPlan::Endpoint,
    };

    #[cfg(windows)]
    let achieved = win32_wasapi::spawn_wasapi_loop(
        plan,
        audio_source,
        mix_state,
        cancel_token,
        runtime_handle,
    )?;

    #[cfg(not(windows))]
    let achieved = {
        let _ = (audio_source, mix_state, cancel_token, runtime_handle);
        plan
    };

    Ok(outcome_for(requested_mode, process_supported, achieved))
}

fn outcome_for(
    requested_mode: StreamAudioMode,
    process_supported: bool,
    achieved: LoopbackPlan,
) -> AudioCaptureStartOutcome {
    match achieved {
        LoopbackPlan::IncludeProcessTree(_) => AudioCaptureStartOutcome {
            active_mode: StreamAudioMode::ProcessTree,
            warning_code: None,
            warning_message: None,
        },
        LoopbackPlan::ExcludeProcessTree(_) => {
            let (warning_code, warning_message) = if requested_mode == StreamAudioMode::ProcessTree {
                (Some("PROCESS_AUDIO_FALLBACK"), Some(MSG_APP_ISOLATION_FAILED.to_string()))
            } else {
                (None, None)
            };
            AudioCaptureStartOutcome {
                active_mode: StreamAudioMode::SystemGlobal,
                warning_code,
                warning_message,
            }
        }
        LoopbackPlan::Endpoint => {
            let (code, msg) = if requested_mode == StreamAudioMode::ProcessTree && !process_supported {
                ("PROCESS_AUDIO_FALLBACK", MSG_PROCESS_UNSUPPORTED)
            } else {
                ("SYSTEM_AUDIO_ECHO_RISK", MSG_GLOBAL_ECHO_RISK)
            };
            AudioCaptureStartOutcome {
                active_mode: StreamAudioMode::SystemGlobal,
                warning_code: Some(code),
                warning_message: Some(msg.to_string()),
            }
        }
    }
}

/// Sends a 10ms stereo 48kHz PCM chunk through the independent mixer into LiveKit's `NativeAudioSource`.
pub async fn push_mixed_10ms_frame(
    pcm_stereo_48k: &mut [i16],
    mix_state: &AudioMixState,
    audio_source: &NativeAudioSource,
) {
    apply_mix_in_place(pcm_stereo_48k, mix_state);
    let frame = AudioFrame {
        data: Cow::Borrowed(pcm_stereo_48k),
        sample_rate: SAMPLE_RATE,
        num_channels: NUM_CHANNELS,
        samples_per_channel: SAMPLES_PER_10MS_CHANNEL,
    };
    let _ = audio_source.capture_frame(&frame).await;
}

#[cfg(windows)]
mod win32_wasapi {
    use super::*;
    use std::sync::mpsc;
    use std::sync::{Condvar, Mutex};
    use std::time::Duration;
    use windows::core::{implement, IUnknown, Interface, HRESULT, PCWSTR};
    use windows::Win32::Foundation::{CloseHandle, BOOL, HANDLE};
    use windows::Win32::Media::Audio::{
        eConsole, eRender, ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
        IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
        IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator,
        AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
        AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_LOOPBACK,
        AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, AUDIOCLIENT_ACTIVATION_PARAMS,
        AUDIOCLIENT_ACTIVATION_PARAMS_0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS, PROCESS_LOOPBACK_MODE,
        PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
        PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        WAVEFORMATEX,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_MULTITHREADED,
    };
    use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

    const VT_BLOB: u16 = 65;
    const WAVE_FORMAT_PCM: u16 = 1;

    /// Binary layout of a PROPVARIANT holding a VT_BLOB (24 bytes on x64), used to pass
    /// AUDIOCLIENT_ACTIVATION_PARAMS to ActivateAudioInterfaceAsync.
    #[repr(C)]
    struct BlobPropVariant {
        vt: u16,
        reserved1: u16,
        reserved2: u16,
        reserved3: u16,
        cb_size: u32,
        p_blob_data: *mut u8,
    }

    #[implement(IActivateAudioInterfaceCompletionHandler)]
    struct ActivationHandler {
        done: Arc<(Mutex<bool>, Condvar)>,
    }

    impl IActivateAudioInterfaceCompletionHandler_Impl for ActivationHandler_Impl {
        fn ActivateCompleted(
            &self,
            _operation: Option<&IActivateAudioInterfaceAsyncOperation>,
        ) -> windows::core::Result<()> {
            let (lock, cvar) = &*self.done;
            if let Ok(mut finished) = lock.lock() {
                *finished = true;
                cvar.notify_all();
            }
            Ok(())
        }
    }

    struct CaptureSession {
        audio_client: IAudioClient,
        capture_client: IAudioCaptureClient,
        channels: usize,
        bits_per_sample: u16,
        event: Option<HANDLE>,
    }

    pub fn spawn_wasapi_loop(
        plan: LoopbackPlan,
        audio_source: NativeAudioSource,
        mix_state: Arc<AudioMixState>,
        cancel_token: CancellationToken,
        runtime_handle: tokio::runtime::Handle,
    ) -> Result<LoopbackPlan, String> {
        let (ready_tx, ready_rx) = mpsc::channel::<Result<LoopbackPlan, String>>();

        std::thread::Builder::new()
            .name(format!("jdisc-wasapi-{plan:?}"))
            .spawn(move || unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

                match open_with_fallback(plan) {
                    Ok((session, achieved)) => {
                        let _ = ready_tx.send(Ok(achieved));
                        run_capture_loop(&session, &audio_source, &mix_state, &cancel_token, &runtime_handle);
                        let _ = session.audio_client.Stop();
                        if let Some(ev) = session.event {
                            let _ = CloseHandle(ev);
                        }
                        drop(session);
                    }
                    Err(err) => {
                        let _ = ready_tx.send(Err(err));
                    }
                }

                CoUninitialize();
            })
            .map_err(|e| format!("WASAPI_THREAD_SPAWN_FAILED: {e}"))?;

        match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(result) => result,
            Err(_) => Err("WASAPI_INIT_TIMEOUT".to_string()),
        }
    }

    /// Tries the requested plan first, then degrades: include-app -> exclude-self -> endpoint.
    unsafe fn open_with_fallback(plan: LoopbackPlan) -> Result<(CaptureSession, LoopbackPlan), String> {
        let mut attempts: Vec<LoopbackPlan> = vec![plan];
        if let LoopbackPlan::IncludeProcessTree(_) = plan {
            attempts.push(LoopbackPlan::ExcludeProcessTree(std::process::id()));
        }
        if plan != LoopbackPlan::Endpoint {
            attempts.push(LoopbackPlan::Endpoint);
        }

        let mut last_err = String::from("WASAPI_NO_ATTEMPT");
        for attempt in attempts {
            let result = match attempt {
                LoopbackPlan::IncludeProcessTree(pid) => {
                    open_process_loopback(pid, PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE)
                }
                LoopbackPlan::ExcludeProcessTree(pid) => {
                    open_process_loopback(pid, PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE)
                }
                LoopbackPlan::Endpoint => open_endpoint_loopback(),
            };
            match result {
                Ok(session) => return Ok((session, attempt)),
                Err(e) => {
                    eprintln!("[jdisc] WASAPI {attempt:?} falhou: {e}");
                    last_err = e;
                }
            }
        }
        Err(last_err)
    }

    unsafe fn open_process_loopback(
        pid: u32,
        mode: PROCESS_LOOPBACK_MODE,
    ) -> Result<CaptureSession, String> {
        let mut activation_params = AUDIOCLIENT_ACTIVATION_PARAMS {
            ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
            Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
                ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                    TargetProcessId: pid,
                    ProcessLoopbackMode: mode,
                },
            },
        };

        let prop = BlobPropVariant {
            vt: VT_BLOB,
            reserved1: 0,
            reserved2: 0,
            reserved3: 0,
            cb_size: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
            p_blob_data: &mut activation_params as *mut AUDIOCLIENT_ACTIVATION_PARAMS as *mut u8,
        };

        let done = Arc::new((Mutex::new(false), Condvar::new()));
        let handler: IActivateAudioInterfaceCompletionHandler =
            ActivationHandler { done: Arc::clone(&done) }.into();

        let operation = ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            &IAudioClient::IID,
            Some(&prop as *const BlobPropVariant as *const _),
            &handler,
        )
        .map_err(|e| format!("ActivateAudioInterfaceAsync: {e}"))?;

        {
            let (lock, cvar) = &*done;
            let guard = lock.lock().map_err(|_| "ACTIVATION_LOCK_POISONED".to_string())?;
            let (guard, timeout) = cvar
                .wait_timeout_while(guard, Duration::from_secs(3), |finished| !*finished)
                .map_err(|_| "ACTIVATION_LOCK_POISONED".to_string())?;
            if timeout.timed_out() && !*guard {
                return Err("ACTIVATION_TIMEOUT".to_string());
            }
        }

        let mut activate_hr = HRESULT(0);
        let mut activated: Option<IUnknown> = None;
        operation
            .GetActivateResult(&mut activate_hr, &mut activated)
            .map_err(|e| format!("GetActivateResult: {e}"))?;
        activate_hr
            .ok()
            .map_err(|e| format!("Process loopback activation: {e}"))?;

        let audio_client: IAudioClient = activated
            .ok_or_else(|| "ACTIVATION_NO_INTERFACE".to_string())?
            .cast()
            .map_err(|e| format!("cast IAudioClient: {e}"))?;

        // Process loopback clients do not support GetMixFormat: request 48kHz stereo PCM16 directly.
        let format = WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_PCM,
            nChannels: NUM_CHANNELS as u16,
            nSamplesPerSec: SAMPLE_RATE,
            nAvgBytesPerSec: SAMPLE_RATE * NUM_CHANNELS * 2,
            nBlockAlign: (NUM_CHANNELS * 2) as u16,
            wBitsPerSample: 16,
            cbSize: 0,
        };

        audio_client
            .Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK
                    | AUDCLNT_STREAMFLAGS_EVENTCALLBACK
                    | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
                    | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                200_000, // 20ms in 100-ns units
                0,
                &format,
                None,
            )
            .map_err(|e| format!("Initialize (process loopback): {e}"))?;

        let event = CreateEventW(None, BOOL(0), BOOL(0), PCWSTR::null()).map_err(|e| format!("CreateEventW: {e}"))?;
        if let Err(e) = audio_client.SetEventHandle(event) {
            let _ = CloseHandle(event);
            return Err(format!("SetEventHandle: {e}"));
        }

        let capture_client: IAudioCaptureClient = match audio_client.GetService() {
            Ok(c) => c,
            Err(e) => {
                let _ = CloseHandle(event);
                return Err(format!("GetService: {e}"));
            }
        };

        if let Err(e) = audio_client.Start() {
            let _ = CloseHandle(event);
            return Err(format!("Start: {e}"));
        }

        Ok(CaptureSession {
            audio_client,
            capture_client,
            channels: NUM_CHANNELS as usize,
            bits_per_sample: 16,
            event: Some(event),
        })
    }

    unsafe fn open_endpoint_loopback() -> Result<CaptureSession, String> {
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("MMDeviceEnumerator: {e}"))?;

        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("GetDefaultAudioEndpoint: {e}"))?;

        let audio_client: IAudioClient = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Activate: {e}"))?;

        let mix_format_ptr = audio_client
            .GetMixFormat()
            .map_err(|e| format!("GetMixFormat: {e}"))?;

        let channels = (*mix_format_ptr).nChannels.max(1) as usize;
        let bits_per_sample = (*mix_format_ptr).wBitsPerSample;

        // 100ms buffer duration in 100-ns units
        let init = audio_client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK,
            1_000_000i64,
            0,
            mix_format_ptr as *const WAVEFORMATEX,
            None,
        );
        CoTaskMemFree(Some(mix_format_ptr as *const _));
        init.map_err(|e| format!("Initialize (endpoint loopback): {e}"))?;

        let capture_client: IAudioCaptureClient = audio_client
            .GetService()
            .map_err(|e| format!("GetService: {e}"))?;

        audio_client.Start().map_err(|e| format!("Start: {e}"))?;

        Ok(CaptureSession {
            audio_client,
            capture_client,
            channels,
            bits_per_sample,
            event: None,
        })
    }

    unsafe fn run_capture_loop(
        session: &CaptureSession,
        audio_source: &NativeAudioSource,
        mix_state: &AudioMixState,
        cancel_token: &CancellationToken,
        runtime_handle: &tokio::runtime::Handle,
    ) {
        let capture_client = &session.capture_client;
        let channels = session.channels;
        let bits_per_sample = session.bits_per_sample;

        let target_chunk_len = (SAMPLES_PER_10MS_CHANNEL * NUM_CHANNELS) as usize; // 960 i16 samples
        let mut accumulator: Vec<i16> = Vec::with_capacity(target_chunk_len * 4);

        while !cancel_token.is_cancelled() {
            if let Some(event) = session.event {
                let _ = WaitForSingleObject(event, 10);
            }

            let mut packet_length = match capture_client.GetNextPacketSize() {
                Ok(len) => len,
                Err(_) => break,
            };

            if packet_length == 0 {
                // If nothing is playing, emit a 10ms silent frame to keep WebRTC audio clock steady
                let mut silent_chunk = vec![0i16; target_chunk_len];
                runtime_handle.block_on(push_mixed_10ms_frame(&mut silent_chunk, mix_state, audio_source));
                if session.event.is_none() {
                    std::thread::sleep(Duration::from_millis(10));
                }
                continue;
            }

            while packet_length > 0 && !cancel_token.is_cancelled() {
                let mut data_ptr: *mut u8 = std::ptr::null_mut();
                let mut num_frames: u32 = 0;
                let mut flags: u32 = 0;

                if capture_client
                    .GetBuffer(&mut data_ptr, &mut num_frames, &mut flags, None, None)
                    .is_err()
                {
                    break;
                }

                let is_silent = (flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0;
                let frames_usize = num_frames as usize;

                if is_silent || data_ptr.is_null() {
                    accumulator.extend(std::iter::repeat(0i16).take(frames_usize * 2));
                } else if bits_per_sample == 32 {
                    let floats = std::slice::from_raw_parts(data_ptr as *const f32, frames_usize * channels);
                    for frame in floats.chunks(channels) {
                        let l = frame.first().copied().unwrap_or(0.0);
                        let r = frame.get(1).copied().unwrap_or(l);
                        accumulator.push((l.clamp(-1.0, 1.0) * 32767.0) as i16);
                        accumulator.push((r.clamp(-1.0, 1.0) * 32767.0) as i16);
                    }
                } else if bits_per_sample == 16 {
                    let pcm16 = std::slice::from_raw_parts(data_ptr as *const i16, frames_usize * channels);
                    for frame in pcm16.chunks(channels) {
                        let l = frame.first().copied().unwrap_or(0);
                        let r = frame.get(1).copied().unwrap_or(l);
                        accumulator.push(l);
                        accumulator.push(r);
                    }
                }

                let _ = capture_client.ReleaseBuffer(num_frames);

                while accumulator.len() >= target_chunk_len {
                    let mut chunk: Vec<i16> = accumulator.drain(..target_chunk_len).collect();
                    runtime_handle.block_on(push_mixed_10ms_frame(&mut chunk, mix_state, audio_source));
                }

                packet_length = capture_client.GetNextPacketSize().unwrap_or(0);
            }

            if session.event.is_none() {
                std::thread::sleep(Duration::from_millis(5));
            }
        }
    }
}
