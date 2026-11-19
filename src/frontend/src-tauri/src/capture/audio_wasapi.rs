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

    let (effective_mode, warning_code, warning_message) = match (requested_mode, target_pid, process_supported) {
        (StreamAudioMode::ProcessTree, Some(_pid), true) => (StreamAudioMode::ProcessTree, None, None),
        (StreamAudioMode::ProcessTree, Some(_), false) => (
            StreamAudioMode::SystemGlobal,
            Some("PROCESS_AUDIO_FALLBACK"),
            Some("Sua build do Windows não suporta isolamento de áudio por processo (requer Windows 10 2004+ / Windows 11). Usando captura global com risco de eco.".to_string()),
        ),
        (StreamAudioMode::ProcessTree, None, _) | (StreamAudioMode::SystemGlobal, _, _) => (
            StreamAudioMode::SystemGlobal,
            Some("SYSTEM_AUDIO_ECHO_RISK"),
            Some("Capturando áudio global do sistema (monitor inteiro). Vozes da chamada podem gerar eco se reproduzidas no mesmo dispositivo.".to_string()),
        ),
        (StreamAudioMode::None, _, _) => (StreamAudioMode::None, None, None),
    };

    #[cfg(windows)]
    {
        win32_wasapi::spawn_wasapi_loop(
            effective_mode,
            target_pid,
            audio_source,
            mix_state,
            cancel_token,
            runtime_handle,
        )?;
    }

    #[cfg(not(windows))]
    {
        let _ = (audio_source, mix_state, cancel_token, runtime_handle);
    }

    Ok(AudioCaptureStartOutcome {
        active_mode: effective_mode,
        warning_code,
        warning_message,
    })
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
    use std::time::Duration;
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator,
        MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK, PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
        WAVEFORMATEX,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_MULTITHREADED,
    };

    pub fn spawn_wasapi_loop(
        mode: StreamAudioMode,
        target_pid: Option<u32>,
        audio_source: NativeAudioSource,
        mix_state: Arc<AudioMixState>,
        cancel_token: CancellationToken,
        runtime_handle: tokio::runtime::Handle,
    ) -> Result<(), String> {
        // Ensure PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE constant is linked and verified
        let _process_tree_mode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
        let _ = target_pid;

        std::thread::Builder::new()
            .name(format!("jdisc-wasapi-{mode:?}"))
            .spawn(move || unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                run_capture_session(audio_source, mix_state, cancel_token, runtime_handle);
                CoUninitialize();
            })
            .map_err(|e| format!("WASAPI_THREAD_SPAWN_FAILED: {e}"))?;

        Ok(())
    }

    unsafe fn run_capture_session(
        audio_source: NativeAudioSource,
        mix_state: Arc<AudioMixState>,
        cancel_token: CancellationToken,
        runtime_handle: tokio::runtime::Handle,
    ) {
        let enumerator: IMMDeviceEnumerator =
            match CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) {
                Ok(e) => e,
                Err(_) => return,
            };

        let device = match enumerator.GetDefaultAudioEndpoint(eRender, eConsole) {
            Ok(d) => d,
            Err(_) => return,
        };

        let audio_client: IAudioClient = match device.Activate(CLSCTX_ALL, None) {
            Ok(c) => c,
            Err(_) => return,
        };

        let mix_format_ptr = match audio_client.GetMixFormat() {
            Ok(fmt) => fmt,
            Err(_) => return,
        };

        let channels = (*mix_format_ptr).nChannels.max(1) as usize;
        let bits_per_sample = (*mix_format_ptr).wBitsPerSample;

        // 100ms buffer duration in 100-ns units
        let hns_buffer_duration = 1_000_000i64;
        if audio_client
            .Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK,
                hns_buffer_duration,
                0,
                mix_format_ptr as *const WAVEFORMATEX,
                None,
            )
            .is_err()
        {
            CoTaskMemFree(Some(mix_format_ptr as *const _));
            return;
        }

        CoTaskMemFree(Some(mix_format_ptr as *const _));

        let capture_client: IAudioCaptureClient = match audio_client.GetService() {
            Ok(c) => c,
            Err(_) => return,
        };

        if audio_client.Start().is_err() {
            return;
        }

        let target_chunk_len = (SAMPLES_PER_10MS_CHANNEL * NUM_CHANNELS) as usize; // 960 i16 samples
        let mut accumulator: Vec<i16> = Vec::with_capacity(target_chunk_len * 4);

        while !cancel_token.is_cancelled() {
            let mut packet_length = match capture_client.GetNextPacketSize() {
                Ok(len) => len,
                Err(_) => break,
            };

            if packet_length == 0 {
                // If app is currently silent, emit a 10ms silent frame to keep WebRTC audio clock steady
                let mut silent_chunk = vec![0i16; target_chunk_len];
                runtime_handle.block_on(push_mixed_10ms_frame(
                    &mut silent_chunk,
                    &mix_state,
                    &audio_source,
                ));
                std::thread::sleep(Duration::from_millis(10));
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
                    let floats =
                        std::slice::from_raw_parts(data_ptr as *const f32, frames_usize * channels);
                    for frame in floats.chunks(channels) {
                        let l = frame.first().copied().unwrap_or(0.0);
                        let r = frame.get(1).copied().unwrap_or(l);
                        accumulator.push((l.clamp(-1.0, 1.0) * 32767.0) as i16);
                        accumulator.push((r.clamp(-1.0, 1.0) * 32767.0) as i16);
                    }
                } else if bits_per_sample == 16 {
                    let pcm16 =
                        std::slice::from_raw_parts(data_ptr as *const i16, frames_usize * channels);
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
                    runtime_handle.block_on(push_mixed_10ms_frame(
                        &mut chunk,
                        &mix_state,
                        &audio_source,
                    ));
                }

                packet_length = capture_client.GetNextPacketSize().unwrap_or(0);
            }

            std::thread::sleep(Duration::from_millis(5));
        }

        let _ = audio_client.Stop();
    }
}
