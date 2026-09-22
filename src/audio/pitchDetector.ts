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

export function rootMeanSquare(buffer: Float32Array): number {
  let rms = 0;
  for (const sample of buffer) rms += sample * sample;
  return Math.sqrt(rms / buffer.length);
}

export function detectPitch(
  buffer: Float32Array,
  sampleRate: number,
  inputThreshold: number,
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

  const minOffset = Math.max(2, Math.floor(sampleRate / 4300));
  const maxOffset = Math.min(Math.floor(sampleRate / 27.5), Math.floor(buffer.length / 2));
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

  // Plusieurs multiples de la période peuvent avoir une corrélation presque
  // identique. Choisir le premier sommet fiable évite de lire 110 Hz pour un
  // La 440 Hz, tout en gardant le meilleur sommet pour les sons plus complexes.
  const peakThreshold = Math.max(0.58, bestCorrelation * 0.97);
  for (let offset = minOffset; offset < maxOffset; offset += 1) {
    const current = correlations[offset];
    const previousValue = correlations[offset - 1] || -1;
    const nextValue = correlations[offset + 1] || -1;
    if (current >= peakThreshold && current >= previousValue && current > nextValue) {
      bestOffset = offset;
      bestCorrelation = current;
      break;
    }
  }

  // Interpolation parabolique : la fréquence est plus stable entre deux cases.
  const previous = correlations[bestOffset - 1] || bestCorrelation;
  const next = correlations[bestOffset + 1] || bestCorrelation;
  const denominator = previous - 2 * bestCorrelation + next;
  const correction = Math.abs(denominator) > 0.000001
    ? 0.5 * (previous - next) / denominator
    : 0;
  const refinedOffset = bestOffset + Math.max(-0.5, Math.min(0.5, correction));
  const frequency = sampleRate / refinedOffset;
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
  private inputThreshold = 0.004;
  private lastRms = 0;
  private lastEmitAt = 0;
  private generation = 0;

  private async openStream(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Ce navigateur ne permet pas l’accès au microphone.");
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
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
    const duration = 1_200;
    while (performance.now() - started < duration) {
      this.analyser.getFloatTimeDomainData(buffer);
      samples.push(rootMeanSquare(buffer));
      onProgress?.(Math.min(1, (performance.now() - started) / duration));
      await new Promise((resolve) => window.setTimeout(resolve, 70));
    }
    const sorted = samples.sort((a, b) => a - b);
    const noiseFloor = sorted[Math.floor(sorted.length * 0.8)] || 0.004;
    this.inputThreshold = Math.min(0.035, Math.max(0.0025, noiseFloor * 2.1 + 0.001));
    return { noiseFloor, inputThreshold: this.inputThreshold };
  }

  async start(
    onPitch: (pitch: DetectedPitch) => void,
    onCalibration?: (progress: number, profile?: CalibrationProfile) => void,
    onLevel?: (level: number) => void,
  ): Promise<CalibrationProfile> {
    const generation = ++this.generation;
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
      if (generation !== this.generation) return;
      if (!this.analyser || !this.context) return;
      this.analyser.getFloatTimeDomainData(buffer);
      onLevel?.(Math.min(1, rootMeanSquare(buffer) / Math.max(this.inputThreshold * 5, 0.02)));
      const detected = detectPitch(buffer, this.context.sampleRate, this.inputThreshold);
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
      const reattack = detected.midi === this.lastMidi && detected.rms > Math.max(this.inputThreshold * 2, this.lastRms * 1.55) && now - this.lastEmitAt > 190;

      if (detected.midi === this.lastMidi) this.stableFrames += 1;
      else {
        this.lastMidi = detected.midi;
        this.stableFrames = 1;
      }
      if (this.stableFrames === 2 || reattack) {
        onPitch(detected);
        this.lastEmitAt = now;
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
