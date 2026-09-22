import { frequencyToMidi } from "../music/notes";

export interface DetectedPitch {
  frequency: number;
  midi: number;
  clarity: number;
}

export interface CalibrationProfile {
  noiseFloor: number;
  inputThreshold: number;
}

function rootMeanSquare(buffer: Float32Array): number {
  let rms = 0;
  for (const sample of buffer) rms += sample * sample;
  return Math.sqrt(rms / buffer.length);
}

function autoCorrelate(buffer: Float32Array, sampleRate: number, inputThreshold: number): (DetectedPitch & { rms: number }) | null {
  const rms = rootMeanSquare(buffer);
  if (rms < inputThreshold) return null;

  const minOffset = Math.floor(sampleRate / 1100);
  const maxOffset = Math.min(Math.floor(sampleRate / 55), Math.floor(buffer.length / 2));
  let bestOffset = -1;
  let bestCorrelation = 0;

  for (let offset = minOffset; offset <= maxOffset; offset += 1) {
    let correlation = 0;
    for (let index = 0; index < buffer.length - offset; index += 1) {
      correlation += buffer[index] * buffer[index + offset];
    }
    correlation /= buffer.length - offset;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
  }

  if (bestOffset < 0 || bestCorrelation < 0.01) return null;
  const frequency = sampleRate / bestOffset;
  return {
    frequency,
    midi: frequencyToMidi(frequency),
    clarity: Math.min(1, bestCorrelation / Math.max(rms * rms, 0.0001)),
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
  private inputThreshold = 0.018;
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
    this.context = new AudioContext({ latencyHint: "interactive" });
    await this.context.resume();
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
    this.inputThreshold = Math.min(0.08, Math.max(0.008, noiseFloor * 2.6));
    return { noiseFloor, inputThreshold: this.inputThreshold };
  }

  async start(
    onPitch: (pitch: DetectedPitch) => void,
    onCalibration?: (progress: number, profile?: CalibrationProfile) => void,
  ): Promise<CalibrationProfile> {
    const generation = ++this.generation;
    await this.openStream();
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
      const detected = autoCorrelate(buffer, this.context.sampleRate, this.inputThreshold);
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
    void this.context?.close();
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
