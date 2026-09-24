import { midiToFrequency } from "../music/notes";
import { unlockAudio } from "./audioContext";

const SILENCE = 0.0001;
const outputs = new WeakMap<AudioContext, AudioNode>();
const waves = new WeakMap<AudioContext, PeriodicWave>();
const hammerBuffers = new WeakMap<AudioContext, AudioBuffer>();

export interface PianoTimbre {
  frequency: number;
  velocity: number;
  peakGain: number;
  cutoffHz: number;
  decaySeconds: number;
  pan: number;
}

export interface PianoVoice {
  release(atTime?: number, releaseSeconds?: number): void;
  stop(atTime?: number): void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Paramètres acoustiques purs, partagés par le jeu live et la lecture de partition. */
export function pianoTimbre(midi: number, velocity = 100): PianoTimbre {
  const safeMidi = clamp(Math.round(Number.isFinite(midi) ? midi : 60), 21, 108);
  const rawVelocity = Number.isFinite(velocity) ? velocity : 100;
  const normalizedVelocity = clamp(rawVelocity <= 1 ? rawVelocity : rawVelocity / 127, 0.04, 1);
  const velocityCurve = Math.sqrt(normalizedVelocity);
  return {
    frequency: midiToFrequency(safeMidi),
    velocity: normalizedVelocity,
    peakGain: 0.082 * (0.28 + velocityCurve * 0.72),
    cutoffHz: clamp(1_900 + normalizedVelocity * 4_600 + (safeMidi - 60) * 24, 1_500, 7_800),
    decaySeconds: clamp(5.8 - (safeMidi - 21) * 0.045, 1.9, 5.8),
    pan: clamp((safeMidi - 60) / 120, -0.32, 0.32),
  };
}

function pianoOutput(context: AudioContext): AudioNode {
  const cached = outputs.get(context);
  if (cached) return cached;
  const master = context.createGain();
  const compressor = context.createDynamicsCompressor();
  master.gain.value = 0.78;
  compressor.threshold.value = -20;
  compressor.knee.value = 14;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.24;
  master.connect(compressor).connect(context.destination);
  outputs.set(context, master);
  return master;
}

function pianoWave(context: AudioContext): PeriodicWave {
  const cached = waves.get(context);
  if (cached) return cached;
  // Un spectre de cordes frappées : fondamental dense, harmoniques rapidement décroissantes.
  const real = new Float32Array(10);
  const imag = new Float32Array([0, 1, 0.58, 0.37, 0.24, 0.16, 0.11, 0.075, 0.05, 0.03]);
  const wave = context.createPeriodicWave(real, imag, { disableNormalization: false });
  waves.set(context, wave);
  return wave;
}

function hammerBuffer(context: AudioContext): AudioBuffer {
  const cached = hammerBuffers.get(context);
  if (cached) return cached;
  const length = Math.max(1, Math.round(context.sampleRate * 0.038));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  // Bruit déterministe très court : le petit claquement du marteau, sans asset externe.
  let seed = 0x1234abcd;
  for (let index = 0; index < length; index += 1) {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    const noise = seed / 0xffffffff * 2 - 1;
    const envelope = Math.pow(1 - index / length, 3.2);
    data[index] = noise * envelope;
  }
  hammerBuffers.set(context, buffer);
  return buffer;
}

function holdAt(param: AudioParam, atTime: number): void {
  const modern = param as AudioParam & { cancelAndHoldAtTime?: (cancelTime: number) => AudioParam };
  if (typeof modern.cancelAndHoldAtTime === "function") {
    modern.cancelAndHoldAtTime(atTime);
    return;
  }
  param.cancelScheduledValues(atTime);
  param.setValueAtTime(Math.max(SILENCE, param.value), atTime);
}

/** Crée une voix de piano programmable, avec relâchement indépendant. */
export function createPianoVoice(
  context: AudioContext,
  midi: number,
  velocity = 100,
  atTime = context.currentTime,
): PianoVoice {
  const timbre = pianoTimbre(midi, velocity);
  const start = Math.max(context.currentTime, atTime);
  const filter = context.createBiquadFilter();
  const envelope = context.createGain();
  const destination = pianoOutput(context);
  const spatial: AudioNode = typeof context.createStereoPanner === "function"
    ? context.createStereoPanner()
    : context.createGain();

  filter.type = "lowpass";
  filter.Q.value = 0.72;
  filter.frequency.setValueAtTime(timbre.cutoffHz, start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(900, timbre.cutoffHz * 0.62), start + 0.72);
  if ("pan" in spatial) (spatial as StereoPannerNode).pan.value = timbre.pan;

  envelope.gain.setValueAtTime(SILENCE, start);
  envelope.gain.exponentialRampToValueAtTime(timbre.peakGain, start + 0.007);
  envelope.gain.setTargetAtTime(SILENCE, start + 0.055, timbre.decaySeconds / 3.2);
  filter.connect(envelope).connect(spatial).connect(destination);

  const sources: AudioScheduledSourceNode[] = [];
  const partials = [
    { ratio: 1, level: 0.82, detune: -0.8, piano: true },
    { ratio: 1.002, level: 0.24, detune: 1.6, piano: true },
    { ratio: 2.003, level: 0.095, detune: 0, piano: false },
  ];
  for (const partial of partials) {
    const oscillator = context.createOscillator();
    const level = context.createGain();
    if (partial.piano) oscillator.setPeriodicWave(pianoWave(context));
    else oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(timbre.frequency * partial.ratio, start);
    oscillator.detune.value = partial.detune;
    level.gain.value = partial.level;
    oscillator.connect(level).connect(filter);
    oscillator.start(start);
    sources.push(oscillator);
  }

  const hammer = context.createBufferSource();
  const hammerFilter = context.createBiquadFilter();
  const hammerGain = context.createGain();
  hammer.buffer = hammerBuffer(context);
  hammerFilter.type = "bandpass";
  hammerFilter.frequency.value = clamp(1_700 + timbre.velocity * 2_700, 1_700, 4_400);
  hammerFilter.Q.value = 0.8;
  hammerGain.gain.value = 0.018 * (0.35 + timbre.velocity * 0.65);
  hammer.connect(hammerFilter).connect(hammerGain).connect(spatial);
  hammer.start(start);
  sources.push(hammer);

  const stopSources = (when: number) => {
    for (const source of sources) {
      try {
        source.stop(when);
      } catch {
        // La source peut déjà être terminée (attaque de marteau ou relâchement précédent).
      }
    }
  };

  return {
    release(releaseAt = context.currentTime, releaseSeconds = 0.34) {
      const when = Math.max(start, releaseAt);
      const duration = clamp(releaseSeconds, 0.08, 1.2);
      holdAt(envelope.gain, when);
      envelope.gain.exponentialRampToValueAtTime(SILENCE, when + duration);
      stopSources(when + duration + 0.04);
    },
    stop(stopAt = context.currentTime) {
      const when = Math.max(context.currentTime, stopAt);
      holdAt(envelope.gain, when);
      envelope.gain.exponentialRampToValueAtTime(SILENCE, when + 0.035);
      stopSources(when + 0.05);
    },
  };
}

/** Piano polyphonique pour les entrées tactiles, ordinateur et MIDI. */
export class PianoSound {
  private active = new Map<number, PianoVoice>();
  private pending = new Map<number, number>();
  private generation = 0;

  async noteOn(midi: number, velocity = 100): Promise<void> {
    const note = Math.round(midi);
    this.noteOff(note, 0.07);
    const generation = ++this.generation;
    this.pending.set(note, generation);
    const context = await unlockAudio();
    if (this.pending.get(note) !== generation) return;
    this.pending.delete(note);
    const voice = createPianoVoice(context, note, velocity);
    this.active.set(note, voice);
  }

  noteOff(midi: number, releaseSeconds = 0.34): void {
    const note = Math.round(midi);
    this.pending.delete(note);
    const voice = this.active.get(note);
    if (!voice) return;
    voice.release(undefined, releaseSeconds);
    this.active.delete(note);
  }

  stopAll(): void {
    this.generation += 1;
    this.pending.clear();
    for (const voice of this.active.values()) voice.stop();
    this.active.clear();
  }
}
