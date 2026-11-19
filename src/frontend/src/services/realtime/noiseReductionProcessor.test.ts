import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyNoiseReductionPreset,
  calculateRmsDb,
  DEFAULT_NOISE_REDUCTION_CONFIG,
  MIN_DB_FLOOR,
  NOISE_REDUCTION_PRESETS,
  NoiseGateProcessor,
  normalizeNoiseReductionConfig,
} from "./noiseReductionProcessor";

describe("noiseReductionProcessor config & DSP math", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("calculates RMS in dBFS accurately for silence, full-scale, and attenuated signals", () => {
    expect(calculateRmsDb(new Float32Array(0))).toBe(MIN_DB_FLOOR);
    expect(calculateRmsDb(new Float32Array([0, 0, 0, 0]))).toBe(MIN_DB_FLOOR);
    expect(calculateRmsDb(new Float32Array([1, -1, 1, -1]))).toBeCloseTo(0, 4);
    expect(calculateRmsDb(new Float32Array([0.1, -0.1, 0.1, -0.1]))).toBeCloseTo(
      -20,
      3
    );
  });

  it("applies preset values for light, moderate, and aggressive profiles", () => {
    const base = { ...DEFAULT_NOISE_REDUCTION_CONFIG, enabled: true };
    const light = applyNoiseReductionPreset(base, "light");
    expect(light.preset).toBe("light");
    expect(light.thresholdDb).toBe(NOISE_REDUCTION_PRESETS.light.thresholdDb);
    expect(light.highPassHz).toBe(NOISE_REDUCTION_PRESETS.light.highPassHz);

    const aggressive = applyNoiseReductionPreset(base, "aggressive");
    expect(aggressive.preset).toBe("aggressive");
    expect(aggressive.thresholdDb).toBe(
      NOISE_REDUCTION_PRESETS.aggressive.thresholdDb
    );
    expect(aggressive.highPassHz).toBe(
      NOISE_REDUCTION_PRESETS.aggressive.highPassHz
    );
  });

  it("normalizes and clamps out-of-range noise reduction settings", () => {
    const normalized = normalizeNoiseReductionConfig({
      enabled: false,
      preset: "invalid" as unknown as "custom",
      thresholdDb: -120,
      highPassHz: 999,
      webrtcNoiseSuppression: false,
    });

    expect(normalized).toEqual({
      enabled: false,
      preset: "moderate",
      thresholdDb: -70,
      highPassHz: 300,
      webrtcNoiseSuppression: false,
    });
  });

  it("opens and closes the noise gate with hysteresis and updates high-pass live", async () => {
    vi.useFakeTimers();

    const mockSamples = new Float32Array(1024).fill(0);
    const setTargetAtTimeGain = vi.fn();
    const setTargetAtTimeFreq = vi.fn();
    const outputTrack = { stop: vi.fn() } as unknown as MediaStreamTrack;
    const inputTrack = {} as MediaStreamTrack;

    const mockSource = { connect: vi.fn(), disconnect: vi.fn() };
    const mockHighPass = {
      type: "lowpass",
      frequency: { value: 0, setTargetAtTime: setTargetAtTimeFreq },
      Q: { value: 0 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const mockAnalyser = {
      fftSize: 1024,
      smoothingTimeConstant: 0,
      connect: vi.fn(),
      disconnect: vi.fn(),
      getFloatTimeDomainData: (buf: Float32Array) => {
        buf.set(mockSamples);
      },
    };
    const mockGain = {
      gain: { value: 1, setTargetAtTime: setTargetAtTimeGain },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const mockDestination = {
      stream: { getAudioTracks: () => [outputTrack] },
    };

    const mockAudioContext = {
      state: "running",
      currentTime: 1.5,
      resume: vi.fn(),
      createMediaStreamSource: vi.fn(() => mockSource),
      createBiquadFilter: vi.fn(() => mockHighPass),
      createAnalyser: vi.fn(() => mockAnalyser),
      createGain: vi.fn(() => mockGain),
      createMediaStreamDestination: vi.fn(() => mockDestination),
    } as unknown as AudioContext;

    vi.stubGlobal(
      "MediaStream",
      class {
        constructor(_tracks?: MediaStreamTrack[]) {}
      }
    );

    const processor = new NoiseGateProcessor({
      enabled: true,
      preset: "moderate",
      thresholdDb: -40,
      highPassHz: 95,
      webrtcNoiseSuppression: true,
    });

    const levels: Array<{ inputDb: number; gateOpen: boolean }> = [];
    processor.subscribeLevel((s) => levels.push(s));

    await processor.init({
      kind: "audio" as never,
      track: inputTrack,
      audioContext: mockAudioContext,
    });

    expect(processor.processedTrack).toBe(outputTrack);
    expect(mockHighPass.frequency.value).toBe(95);

    // Silence keeps gate closed
    vi.advanceTimersByTime(40);
    expect(levels.at(-1)?.gateOpen).toBe(false);
    expect(setTargetAtTimeGain).toHaveBeenLastCalledWith(0, 1.5, 0.08);

    // Voice above -40 dB (0.1 amplitude = -20 dB) opens gate
    mockSamples.fill(0.1);
    vi.advanceTimersByTime(25);
    expect(levels.at(-1)?.gateOpen).toBe(true);
    expect(setTargetAtTimeGain).toHaveBeenLastCalledWith(1, 1.5, 0.015);

    // Drop to silence: stays open during 160ms hold, then closes
    mockSamples.fill(0);
    vi.advanceTimersByTime(100);
    expect(levels.at(-1)?.gateOpen).toBe(true);
    vi.advanceTimersByTime(100);
    expect(levels.at(-1)?.gateOpen).toBe(false);

    // Live config update adjusts high-pass filter immediately
    processor.updateConfig({
      enabled: true,
      preset: "aggressive",
      thresholdDb: -35,
      highPassHz: 130,
      webrtcNoiseSuppression: true,
    });
    expect(setTargetAtTimeFreq).toHaveBeenCalledWith(130, 1.5, 0.02);

    await processor.destroy();
    expect(outputTrack.stop).toHaveBeenCalledTimes(1);
  });
});
