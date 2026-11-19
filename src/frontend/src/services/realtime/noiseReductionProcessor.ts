import type { AudioProcessorOptions, Track, TrackProcessor } from "livekit-client";
import type {
  NoiseReductionConfig,
  NoiseReductionPreset,
} from "../desktop/types";

export const NOISE_THRESHOLD_MIN_DB = -70;
export const NOISE_THRESHOLD_MAX_DB = -15;
export const NOISE_HIGHPASS_MIN_HZ = 0;
export const NOISE_HIGHPASS_MAX_HZ = 300;
export const MIN_DB_FLOOR = -100;

export interface NoiseReductionPresetSpec {
  label: string;
  description: string;
  thresholdDb: number;
  highPassHz: number;
  webrtcNoiseSuppression: boolean;
}

export const NOISE_REDUCTION_PRESETS: Record<
  Exclude<NoiseReductionPreset, "custom">,
  NoiseReductionPresetSpec
> = {
  light: {
    label: "Leve",
    description: "Preserva detalhes da voz em ambientes silenciosos.",
    thresholdDb: -55,
    highPassHz: 70,
    webrtcNoiseSuppression: true,
  },
  moderate: {
    label: "Moderado",
    description: "Equilíbrio ideal para ventilador e ruído ambiente comum.",
    thresholdDb: -45,
    highPassHz: 95,
    webrtcNoiseSuppression: true,
  },
  aggressive: {
    label: "Agressivo",
    description: "Corte firme para teclados mecânicos e ambientes barulhentos.",
    thresholdDb: -35,
    highPassHz: 130,
    webrtcNoiseSuppression: true,
  },
};

export const DEFAULT_NOISE_REDUCTION_CONFIG: NoiseReductionConfig = {
  enabled: true,
  preset: "moderate",
  thresholdDb: NOISE_REDUCTION_PRESETS.moderate.thresholdDb,
  highPassHz: NOISE_REDUCTION_PRESETS.moderate.highPassHz,
  webrtcNoiseSuppression: NOISE_REDUCTION_PRESETS.moderate.webrtcNoiseSuppression,
};

export function clampNoiseThresholdDb(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_NOISE_REDUCTION_CONFIG.thresholdDb;
  }
  return Math.max(
    NOISE_THRESHOLD_MIN_DB,
    Math.min(NOISE_THRESHOLD_MAX_DB, Math.round(value))
  );
}

export function clampNoiseHighPassHz(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_NOISE_REDUCTION_CONFIG.highPassHz;
  }
  return Math.max(
    NOISE_HIGHPASS_MIN_HZ,
    Math.min(NOISE_HIGHPASS_MAX_HZ, Math.round(value))
  );
}

export function normalizeNoiseReductionConfig(
  input?: Partial<NoiseReductionConfig> | null
): NoiseReductionConfig {
  const merged = {
    ...DEFAULT_NOISE_REDUCTION_CONFIG,
    ...(input ?? {}),
  };

  const validPresets: NoiseReductionPreset[] = [
    "light",
    "moderate",
    "aggressive",
    "custom",
  ];
  const preset = validPresets.includes(merged.preset)
    ? merged.preset
    : DEFAULT_NOISE_REDUCTION_CONFIG.preset;

  return {
    enabled: Boolean(merged.enabled),
    preset,
    thresholdDb: clampNoiseThresholdDb(merged.thresholdDb),
    highPassHz: clampNoiseHighPassHz(merged.highPassHz),
    webrtcNoiseSuppression: Boolean(merged.webrtcNoiseSuppression),
  };
}

export function applyNoiseReductionPreset(
  current: NoiseReductionConfig,
  preset: Exclude<NoiseReductionPreset, "custom">
): NoiseReductionConfig {
  const spec = NOISE_REDUCTION_PRESETS[preset];
  return {
    ...current,
    preset,
    thresholdDb: spec.thresholdDb,
    highPassHz: spec.highPassHz,
    webrtcNoiseSuppression: spec.webrtcNoiseSuppression,
  };
}

export function calculateRmsDb(samples: Float32Array): number {
  if (samples.length === 0) {
    return MIN_DB_FLOOR;
  }
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  if (rms <= 1e-5) {
    return MIN_DB_FLOOR;
  }
  const db = 20 * Math.log10(rms);
  return Math.max(MIN_DB_FLOOR, Math.min(0, db));
}

export interface MicLevelSample {
  inputDb: number;
  gateOpen: boolean;
}

type MicLevelListener = (sample: MicLevelSample) => void;

const GATE_HYSTERESIS_DB = 4;
const GATE_HOLD_MS = 160;
const GATE_POLL_INTERVAL_MS = 20;
const GATE_ATTACK_TC_SEC = 0.015;
const GATE_RELEASE_TC_SEC = 0.08;

/**
 * WebAudio TrackProcessor that filters low-frequency rumble (high-pass BiquadFilter)
 * and applies a smooth hysteresis noise gate before sending microphone audio to LiveKit.
 */
export class NoiseGateProcessor
  implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>
{
  public readonly name = "jdisc-noise-gate";
  public processedTrack?: MediaStreamTrack;

  private config: NoiseReductionConfig;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private highPassNode: BiquadFilterNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private gateGainNode: GainNode | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private sampleBuffer: Float32Array<ArrayBuffer> | null = null;
  private gateOpen = true;
  private lastAboveCloseThresholdAt = 0;
  private listeners = new Set<MicLevelListener>();

  constructor(initialConfig: NoiseReductionConfig) {
    this.config = normalizeNoiseReductionConfig(initialConfig);
  }

  public async init(opts: AudioProcessorOptions): Promise<void> {
    await this.setupGraph(opts);
  }

  public async restart(opts: AudioProcessorOptions): Promise<void> {
    await this.destroy();
    await this.setupGraph(opts);
  }

  public async destroy(): Promise<void> {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    this.sourceNode?.disconnect();
    this.highPassNode?.disconnect();
    this.analyserNode?.disconnect();
    this.gateGainNode?.disconnect();

    if (this.processedTrack) {
      this.processedTrack.stop();
      this.processedTrack = undefined;
    }

    this.sourceNode = null;
    this.highPassNode = null;
    this.analyserNode = null;
    this.gateGainNode = null;
    this.sampleBuffer = null;
    this.audioContext = null;
  }

  public updateConfig(nextConfig: NoiseReductionConfig): void {
    this.config = normalizeNoiseReductionConfig(nextConfig);
    if (this.highPassNode && this.audioContext) {
      const freq = this.config.highPassHz > 0 ? this.config.highPassHz : 10;
      this.highPassNode.frequency.setTargetAtTime(
        freq,
        this.audioContext.currentTime,
        0.02
      );
    }
  }

  public subscribeLevel(listener: MicLevelListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async setupGraph(opts: AudioProcessorOptions): Promise<void> {
    const ctx = opts.audioContext;
    if (ctx.state === "suspended") {
      await ctx.resume().catch(() => {});
    }

    this.audioContext = ctx;
    const sourceStream = new MediaStream([opts.track]);
    const source = ctx.createMediaStreamSource(sourceStream);

    const highPass = ctx.createBiquadFilter();
    highPass.type = "highpass";
    highPass.frequency.value =
      this.config.highPassHz > 0 ? this.config.highPassHz : 10;
    highPass.Q.value = 0.707;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.2;

    const gateGain = ctx.createGain();
    gateGain.gain.value = 0;

    const destination = ctx.createMediaStreamDestination();

    source.connect(highPass);
    highPass.connect(analyser);
    analyser.connect(gateGain);
    gateGain.connect(destination);

    this.sourceNode = source;
    this.highPassNode = highPass;
    this.analyserNode = analyser;
    this.gateGainNode = gateGain;
    this.processedTrack = destination.stream.getAudioTracks()[0];
    this.sampleBuffer = new Float32Array(analyser.fftSize);
    this.gateOpen = false;
    this.lastAboveCloseThresholdAt = 0;

    this.pollTimer = setInterval(() => {
      this.processFrame();
    }, GATE_POLL_INTERVAL_MS);
  }

  private processFrame(): void {
    if (
      !this.analyserNode ||
      !this.gateGainNode ||
      !this.audioContext ||
      !this.sampleBuffer
    ) {
      return;
    }

    this.analyserNode.getFloatTimeDomainData(this.sampleBuffer);
    const inputDb = calculateRmsDb(this.sampleBuffer);
    const nowMs = performance.now();
    const openThreshold = this.config.thresholdDb;
    const closeThreshold = openThreshold - GATE_HYSTERESIS_DB;

    if (inputDb >= openThreshold) {
      this.gateOpen = true;
      this.lastAboveCloseThresholdAt = nowMs;
    } else if (this.gateOpen) {
      if (inputDb >= closeThreshold) {
        this.lastAboveCloseThresholdAt = nowMs;
      } else if (nowMs - this.lastAboveCloseThresholdAt > GATE_HOLD_MS) {
        this.gateOpen = false;
      }
    }

    const targetGain = this.gateOpen ? 1 : 0;
    const timeConstant = this.gateOpen
      ? GATE_ATTACK_TC_SEC
      : GATE_RELEASE_TC_SEC;
    this.gateGainNode.gain.setTargetAtTime(
      targetGain,
      this.audioContext.currentTime,
      timeConstant
    );

    if (this.listeners.size > 0) {
      const sample: MicLevelSample = { inputDb, gateOpen: this.gateOpen };
      for (const listener of this.listeners) {
        listener(sample);
      }
    }
  }
}
