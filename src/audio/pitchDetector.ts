import { frequencyToMidi } from "../music/notes";
import { unlockAudio } from "./audioContext";

export interface DetectedPitch {
  frequency: number;
  midi: number;
  clarity: number;
}

export interface CalibrationProfile {
  noiseFloor: number;
  inputThreshold: number;
}

export interface MicLevel {
  rms: number;
  threshold: number;
  midi?: number;
}

export type PitchRangeId = "full" | "grave" | "medium" | "aigu";

export const PITCH_RANGES: Record<PitchRangeId, { minFreq: number; maxFreq: number; label: string }> = {
  full: { minFreq: 27.5, maxFreq: 4186, label: "Tout le piano (La0 à Do8)" },
  grave: { minFreq: 27.5, maxFreq: 440, label: "Registre grave (La0 à La4)" },
  medium: { minFreq: 110, maxFreq: 1046, label: "Registre médium (La2 à Do6)" },
  aigu: { minFreq: 220, maxFreq: 4186, label: "Registre aigu (La3 à Do8)" },
};

export function rootMeanSquare(buffer: Float32Array): number {
  let rms = 0;
  for (const sample of buffer) rms += sample * sample;
  return Math.sqrt(rms / buffer.length);
}

export function detectPitch(
  buffer: Float32Array,
  sampleRate: number,
  inputThreshold: number,
  minFreq = 27.5,
  maxFreq = 4186,
): (DetectedPitch & { rms: number }) | null {
  let mean = 0;
  for (const sample of buffer) mean += sample;
  mean /= buffer.length;

  let energy = 0;
  const centered = new Float32Array(buffer.length);
  for (let index = 0; index < buffer.length; index += 1) {
    centered[index] = buffer[index] - mean;
    energy += centered[index] * centered[index];
  }
  const rms = Math.sqrt(energy / centered.length);
  if (rms < inputThreshold) return null;

  const minOffset = Math.max(2, Math.floor(sampleRate / maxFreq));
  const maxOffset = Math.min(Math.floor(sampleRate / minFreq), Math.floor(buffer.length / 2));
  if (maxOffset <= minOffset) return null;

  let bestOffset = -1;
  let bestCorrelation = 0;
  const correlations = new Float32Array(maxOffset + 1);

  for (let offset = minOffset; offset <= maxOffset; offset += 1) {
    let cross = 0;
    let energyA = 0;
    let energyB = 0;
    const length = centered.length - offset;
    for (let index = 0; index < length; index += 1) {
      const a = centered[index];
      const b = centered[index + offset];
      cross += a * b;
      energyA += a * a;
      energyB += b * b;
    }
    const correlation = cross / Math.sqrt(Math.max(energyA * energyB, Number.EPSILON));
    correlations[offset] = correlation;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
  }

  if (bestOffset < 0 || bestCorrelation < 0.52) return null;

  // Les multiples de la période ont une corrélation presque identique.
  // Le premier sommet fiable correspond à la fondamentale utile au cours.
  const peakThreshold = Math.max(0.58, bestCorrelation * 0.97);
  for (let offset = minOffset; offset < maxOffset; offset += 1) {
    const current = correlations[offset];
    const previous = correlations[offset - 1] || -1;
    const next = correlations[offset + 1] || -1;
    if (current >= peakThreshold && current >= previous && current > next) {
      bestOffset = offset;
      bestCorrelation = current;
      break;
    }
  }

  const previous = correlations[bestOffset - 1] || bestCorrelation;
  const next = correlations[bestOffset + 1] || bestCorrelation;
  const denominator = previous - 2 * bestCorrelation + next;
  const correction = Math.abs(denominator) > 0.000001
    ? 0.5 * (previous - next) / denominator
    : 0;
  const refinedOffset = bestOffset + Math.max(-0.5, Math.min(0.5, correction));
  const frequency = sampleRate / refinedOffset;
  if (frequency < minFreq * 0.94 || frequency > maxFreq * 1.06) return null;
  return {
    frequency,
    midi: frequencyToMidi(frequency),
    clarity: Math.max(0, Math.min(1, bestCorrelation)),
    rms,
  };
}

export class PianoPitchDetector {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private timer: number | null = null;
  private lastMidi: number | null = null;
  private stableFrames = 0;
  private silentFrames = 0;
  private baseThreshold = 0.004;
  private sensitivity = 1;
  private minFreq = 27.5;
  private maxFreq = 4186;
  private lastRms = 0;
  private lastEmitAt = 0;
  private generation = 0;
  private levelCallback: ((level: MicLevel) => void) | null = null;

  setSensitivity(value: number): void {
    this.sensitivity = Math.min(2.5, Math.max(0.4, value));
  }

  setFrequencyRange(minFreq: number, maxFreq: number): void {
    this.minFreq = minFreq;
    this.maxFreq = maxFreq;
  }

  onLevel(callback: ((level: MicLevel) => void) | null): void {
    this.levelCallback = callback;
  }

  getThreshold(): number {
    return this.effectiveThreshold();
  }

  private effectiveThreshold(): number {
    return this.baseThreshold / this.sensitivity;
  }

  private async openStream(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Ce navigateur ne permet pas l’accès au microphone.");
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        throw new Error("Microphone refusé. Autorisez-le dans Safari, puis touchez « Jouer au piano » à nouveau.", { cause: error });
      }
      if (error instanceof DOMException && error.name === "NotFoundError") {
        throw new Error("Aucun microphone détecté sur cet appareil.", { cause: error });
      }
      throw new Error("Le microphone n’a pas pu être activé. Vérifiez l’autorisation et utilisez une adresse HTTPS.", { cause: error });
    }
    this.context = await unlockAudio();
    const source = this.context.createMediaStreamSource(this.stream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.08;
    source.connect(this.analyser);
  }

  private async calibrate(onProgress?: (progress: number) => void): Promise<CalibrationProfile> {
    if (!this.analyser) throw new Error("Le microphone n’est pas prêt.");
    const buffer = new Float32Array(this.analyser.fftSize);
    const samples: number[] = [];
    const started = performance.now();
    const duration = 1_000;
    while (performance.now() - started < duration) {
      this.analyser.getFloatTimeDomainData(buffer);
      samples.push(rootMeanSquare(buffer));
      onProgress?.(Math.min(1, (performance.now() - started) / duration));
      await new Promise((resolve) => window.setTimeout(resolve, 60));
    }
    const sorted = samples.sort((a, b) => a - b);
    const noiseFloor = sorted[Math.floor(sorted.length * 0.8)] ?? 0.004;
    this.baseThreshold = Math.min(0.035, Math.max(0.0025, noiseFloor * 2.1 + 0.001));
    return { noiseFloor, inputThreshold: this.effectiveThreshold() };
  }

  async start(
    onPitch: (pitch: DetectedPitch) => void,
    onCalibration?: (progress: number, profile?: CalibrationProfile) => void,
  ): Promise<CalibrationProfile> {
    const generation = ++this.generation;
    this.lastMidi = null;
    this.stableFrames = 0;
    this.silentFrames = 0;
    this.lastRms = 0;
    this.lastEmitAt = 0;
    await this.openStream();
    if (generation !== this.generation) {
      this.stream?.getTracks().forEach((track) => track.stop());
      this.stream = null;
      this.analyser = null;
      this.context = null;
      throw new Error("Activation du microphone annulée.");
    }
    const profile = await this.calibrate((progress) => onCalibration?.(progress));
    if (generation !== this.generation) throw new Error("Calibrage interrompu.");
    onCalibration?.(1, profile);
    const analyser = this.analyser;
    if (!analyser) throw new Error("Le microphone a été interrompu pendant le calibrage.");
    const buffer = new Float32Array(analyser.fftSize);

    this.timer = window.setInterval(() => {
      if (generation !== this.generation || !this.analyser || !this.context) return;
      const threshold = this.effectiveThreshold();
      this.analyser.getFloatTimeDomainData(buffer);
      const frameRms = rootMeanSquare(buffer);
      const detected = detectPitch(buffer, this.context.sampleRate, threshold, this.minFreq, this.maxFreq);
      this.levelCallback?.({ rms: frameRms, threshold, midi: detected?.midi });
      if (!detected) {
        this.silentFrames += 1;
        if (this.silentFrames >= 2) {
          this.lastMidi = null;
          this.stableFrames = 0;
        }
        return;
      }

      this.silentFrames = 0;
      const now = performance.now();
      const comingFromSilence = this.lastMidi === null;
      const reattack = detected.midi === this.lastMidi
        && detected.rms > Math.max(threshold * 2, this.lastRms * 1.35)
        && now - this.lastEmitAt > 170;

      if (detected.midi === this.lastMidi) this.stableFrames += 1;
      else {
        this.lastMidi = detected.midi;
        this.stableFrames = 1;
      }
      if ((comingFromSilence && this.stableFrames === 1) || this.stableFrames === 2 || reattack) {
        onPitch(detected);
        this.lastEmitAt = now;
        if (comingFromSilence) this.stableFrames = 2;
      }
      this.lastRms = detected.rms;
    }, 55);
    return profile;
  }

  stop(): void {
    this.generation += 1;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.timer = null;
    this.stream = null;
    this.analyser = null;
    this.context = null;
    this.lastMidi = null;
    this.stableFrames = 0;
    this.silentFrames = 0;
    this.lastRms = 0;
    this.lastEmitAt = 0;
  }
}
