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

export interface MicLevel {
  rms: number;
  threshold: number;
  midi?: number;
}

export type PitchRangeId = "full" | "grave" | "medium" | "aigu";

export const PITCH_RANGES: Record<PitchRangeId, { minFreq: number; maxFreq: number; label: string }> = {
  full: { minFreq: 55, maxFreq: 2093, label: "Tout le clavier (Do1 à Do7)" },
  grave: { minFreq: 55, maxFreq: 440, label: "Registre grave (Do1 à La3)" },
  medium: { minFreq: 110, maxFreq: 1046, label: "Registre médium (La1 à Do6)" },
  aigu: { minFreq: 220, maxFreq: 2093, label: "Registre aigu (La2 à Do7)" },
};

function rootMeanSquare(buffer: Float32Array): number {
  let rms = 0;
  for (let i = 0; i < buffer.length; i += 1) rms += buffer[i] * buffer[i];
  return Math.sqrt(rms / buffer.length);
}

function autoCorrelate(
  buffer: Float32Array,
  sampleRate: number,
  inputThreshold: number,
  minFreq: number,
  maxFreq: number,
): (DetectedPitch & { rms: number }) | null {
  // Retire la composante continue : sans ça, un offset DC fait croire à une
  // corrélation forte et le détecteur reste muet ou renvoie n'importe quoi.
  let mean = 0;
  for (let i = 0; i < buffer.length; i += 1) mean += buffer[i];
  mean /= buffer.length;

  const rms = rootMeanSquare(buffer);
  if (rms < inputThreshold) return null;

  const minOffset = Math.max(2, Math.floor(sampleRate / maxFreq));
  const maxOffset = Math.min(Math.floor(sampleRate / minFreq), Math.floor(buffer.length / 2));
  if (maxOffset <= minOffset) return null;

  let bestOffset = -1;
  let bestCorrelation = 0;

  for (let offset = minOffset; offset <= maxOffset; offset += 1) {
    let correlation = 0;
    const count = buffer.length - offset;
    for (let index = 0; index < count; index += 1) {
      correlation += (buffer[index] - mean) * (buffer[index + offset] - mean);
    }
    correlation /= count;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
  }

  if (bestOffset < 0) return null;
  const energy = Math.max(rms * rms, 0.0001);
  const clarity = Math.min(1, bestCorrelation / energy);
  // Seuil de clarté : en dessous, c'est du bruit ou un accord (polyphonie
  // que le détecteur monophonique ne peut pas trancher). On préfère ne rien
  // émettre plutôt qu'une note fausse — mais on reste permissif (0.22) pour
  // les pianos peu fort ou éloignés.
  if (bestCorrelation < 0.008 || clarity < 0.22) return null;

  // Biais d'octave : l'autocorrélation aime les multiples de la période
  // (détecte 2x trop haut). On cherche la période la plus longue dont la
  // corrélation reste proche du meilleur pic → on privilégie la fondamentale.
  let fundamentalOffset = bestOffset;
  for (let offset = bestOffset + 1; offset <= maxOffset; offset += 1) {
    if (offset % bestOffset !== 0) continue;
    let correlation = 0;
    const count = buffer.length - offset;
    for (let index = 0; index < count; index += 1) {
      correlation += (buffer[index] - mean) * (buffer[index + offset] - mean);
    }
    correlation /= count;
    if (correlation >= bestCorrelation * 0.82) fundamentalOffset = offset;
  }

  // Interpolation parabolique autour du pic pour une fréquence plus juste.
  let refined = fundamentalOffset;
  if (fundamentalOffset > minOffset && fundamentalOffset < maxOffset) {
    const getCorr = (offset: number) => {
      let c = 0;
      const count = buffer.length - offset;
      for (let index = 0; index < count; index += 4) {
        c += (buffer[index] - mean) * (buffer[index + offset] - mean);
      }
      return c / Math.ceil(count / 4);
    };
    const y0 = getCorr(fundamentalOffset - 1);
    const y1 = getCorr(fundamentalOffset);
    const y2 = getCorr(fundamentalOffset + 1);
    const denom = y0 - 2 * y1 + y2;
    if (denom !== 0) {
      const shift = Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denom));
      refined = fundamentalOffset + shift;
    }
  }

  const frequency = sampleRate / refined;
  if (frequency < minFreq * 0.94 || frequency > maxFreq * 1.06) return null;
  return { frequency, midi: frequencyToMidi(frequency), clarity, rms };
}

export class PianoPitchDetector {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private timer: number | null = null;
  private lastMidi: number | null = null;
  private stableFrames = 0;
  private silentFrames = 0;
  private baseThreshold = 0.012;
  private sensitivity = 1;
  private minFreq = 55;
  private maxFreq = 2093;
  private lastRms = 0;
  private lastEmitAt = 0;
  private generation = 0;
  private levelCallback: ((level: MicLevel) => void) | null = null;

  /** Multiplicateur de sensibilité : 0.5 = peu sensible, 2 = très sensible. */
  setSensitivity(value: number): void {
    this.sensitivity = Math.min(2.5, Math.max(0.4, value));
  }

  setFrequencyRange(minFreq: number, maxFreq: number): void {
    this.minFreq = minFreq;
    this.maxFreq = maxFreq;
  }

  /** Appelé à chaque trame (~18x/s) pour le vumètre, même sans note. */
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
        throw new Error("Microphone refusé. Autorisez-le dans Safari / Chrome, puis touchez « Jouer au piano » à nouveau.", { cause: error });
      }
      if (error instanceof DOMException && error.name === "NotFoundError") {
        throw new Error("Aucun microphone détecté sur cet appareil.", { cause: error });
      }
      throw new Error("Le microphone n’a pas pu être activé. Vérifiez l’autorisation et utilisez une adresse HTTPS.", { cause: error });
    }
    this.context = new AudioContext({ latencyHint: "interactive" });
    await this.context.resume();
    const source = this.context.createMediaStreamSource(this.stream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 4096;
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
    // Seuil = bruit ambiant x 2.2, borné pour rester jouable dans un salon
    // calme comme près d'une fenêtre ouverte.
    this.baseThreshold = Math.min(0.05, Math.max(0.006, noiseFloor * 2.2));
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
    const profile = await this.calibrate((progress) => onCalibration?.(progress));
    if (generation !== this.generation) throw new Error("Calibrage interrompu.");
    onCalibration?.(1, profile);
    const analyser = this.analyser;
    if (!analyser) throw new Error("Le microphone a été interrompu pendant le calibrage.");
    const buffer = new Float32Array(analyser.fftSize);

    this.timer = window.setInterval(() => {
      if (generation !== this.generation) return;
      if (!this.analyser || !this.context) return;
      const threshold = this.effectiveThreshold();
      this.analyser.getFloatTimeDomainData(buffer);
      const frameRms = rootMeanSquare(buffer);
      const detected = autoCorrelate(buffer, this.context.sampleRate, threshold, this.minFreq, this.maxFreq);
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
      const reattack =
        detected.midi === this.lastMidi &&
        detected.rms > Math.max(threshold * 2, this.lastRms * 1.35) &&
        now - this.lastEmitAt > 170;

      if (detected.midi === this.lastMidi) {
        this.stableFrames += 1;
      } else {
        this.lastMidi = detected.midi;
        // Après un silence, la première trame suffit : c'est ce qui manquait
        // pour les notes répétées et les attaques franches.
        this.stableFrames = 1;
      }
      if (this.stableFrames === 1 ? comingFromSilence : this.stableFrames === 2 || reattack) {
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
    void this.context?.close().catch(() => undefined);
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
