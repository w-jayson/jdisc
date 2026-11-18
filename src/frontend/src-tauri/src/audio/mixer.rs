use crate::state::AudioMixState;

/// Applies lock-free gain (0.0..=1.0) and mute state in-place on 16-bit PCM samples.
/// Completely independent of the user's microphone track.
pub fn apply_mix_in_place(samples: &mut [i16], mix_state: &AudioMixState) {
    if mix_state.is_muted() {
        samples.fill(0);
        return;
    }

    let gain = mix_state.gain().clamp(0.0, 1.0);
    if (gain - 1.0).abs() < f32::EPSILON {
        return;
    }
    if gain <= 0.0 {
        samples.fill(0);
        return;
    }

    for sample in samples.iter_mut() {
        let scaled = (*sample as f32 * gain).round();
        *sample = scaled.clamp(i16::MIN as f32, i16::MAX as f32) as i16;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mute_zeros_all_pcm_samples() {
        let mix = AudioMixState::new(80, true);
        let mut buffer = vec![12000i16, -12000, 32767, -32768];
        apply_mix_in_place(&mut buffer, &mix);
        assert_eq!(buffer, vec![0, 0, 0, 0]);
    }

    #[test]
    fn gain_scales_and_clamps_within_i16_bounds() {
        let mix = AudioMixState::new(50, false);
        let mut buffer = vec![10000i16, -10000, 0];
        apply_mix_in_place(&mut buffer, &mix);
        assert_eq!(buffer, vec![5000, -5000, 0]);

        mix.update(0, false);
        apply_mix_in_place(&mut buffer, &mix);
        assert_eq!(buffer, vec![0, 0, 0]);
    }
}
