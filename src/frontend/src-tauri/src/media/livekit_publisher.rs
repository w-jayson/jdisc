use crate::capture::audio_wasapi::{NUM_CHANNELS, SAMPLE_RATE};
use crate::capture::video_wgc::preset_dimensions_and_fps;
use crate::state::{StreamAudioMode, StreamPreset};
use livekit::options::{TrackPublishOptions, VideoEncoding};
use livekit::prelude::*;
use livekit::webrtc::audio_source::native::NativeAudioSource;
use livekit::webrtc::prelude::{
    AudioSourceOptions, RtcAudioSource, RtcVideoSource, VideoResolution,
};
use livekit::webrtc::video_source::native::NativeVideoSource;
use tokio_util::sync::CancellationToken;

pub struct PublishedNativeSources {
    pub video_source: NativeVideoSource,
    pub audio_source: Option<NativeAudioSource>,
}

/// Connects to the LiveKit room using the `{userId}:screenshare` companion token (`auto_subscribe: false`)
/// and publishes native video (`TrackSource::Screenshare`) and optional process/system audio (`TrackSource::ScreenshareAudio`).
pub async fn connect_and_publish_native_stream(
    livekit_url: &str,
    screenshare_token: &str,
    preset: StreamPreset,
    audio_mode: StreamAudioMode,
    cancel_token: CancellationToken,
) -> Result<PublishedNativeSources, String> {
    let mut room_options = RoomOptions::default();
    room_options.auto_subscribe = false;

    let (room, mut _events) = Room::connect(livekit_url, screenshare_token, room_options)
        .await
        .map_err(|e| format!("LIVEKIT_CONNECT_FAILED: {e}"))?;

    let (width, height, fps) = preset_dimensions_and_fps(preset);
    let video_source = NativeVideoSource::new(VideoResolution { width, height }, true);

    let video_track = LocalVideoTrack::create_video_track(
        "jdisc-screen-video",
        RtcVideoSource::Native(video_source.clone()),
    );

    let max_bitrate = match preset {
        StreamPreset::P720Fps30 => 3_000_000,
        StreamPreset::P1080Fps60 => 6_000_000,
    };

    room.local_participant()
        .publish_track(
            LocalTrack::Video(video_track),
            TrackPublishOptions {
                source: TrackSource::Screenshare,
                video_encoding: Some(VideoEncoding {
                    max_bitrate,
                    max_framerate: fps as f64,
                }),
                ..Default::default()
            },
        )
        .await
        .map_err(|e| format!("LIVEKIT_PUBLISH_VIDEO_FAILED: {e}"))?;

    let audio_source = if audio_mode != StreamAudioMode::None {
        // High-fidelity music/game audio options: disable voice filters (AEC, NS, AGC)
        let audio_opts = AudioSourceOptions {
            echo_cancellation: false,
            noise_suppression: false,
            auto_gain_control: false,
        };
        let native_audio = NativeAudioSource::new(audio_opts, SAMPLE_RATE, NUM_CHANNELS, 100);
        let audio_track = LocalAudioTrack::create_audio_track(
            "jdisc-screen-audio",
            RtcAudioSource::Native(native_audio.clone()),
        );

        room.local_participant()
            .publish_track(
                LocalTrack::Audio(audio_track),
                TrackPublishOptions {
                    source: TrackSource::ScreenshareAudio,
                    dtx: false,
                    red: true,
                    ..Default::default()
                },
            )
            .await
            .map_err(|e| format!("LIVEKIT_PUBLISH_AUDIO_FAILED: {e}"))?;

        Some(native_audio)
    } else {
        None
    };

    // Keep room alive until cancel_token is triggered, then disconnect cleanly
    tokio::spawn(async move {
        cancel_token.cancelled().await;
        let _ = room.close().await;
    });

    Ok(PublishedNativeSources {
        video_source,
        audio_source,
    })
}
