import type { NoteEvent } from "../types";
import { midiToFrequency } from "../music/notes";
import { unlockAudio } from "./audioContext";

export class ScorePlayer {
  private context: AudioContext | null = null;
  private timers: number[] = [];
  private oscillators: OscillatorNode[] = [];
  private generation = 0;

  async play(notes: NoteEvent[], bpm: number, onProgress: (noteIndex: number) => void, onEnd: () => void): Promise<void> {
    this.stop();
    if (!notes.length) return;
    const generation = this.generation;
    const context = await unlockAudio();
    if (generation !== this.generation) return;
    this.context = context;
    const firstBeat = Math.min(...notes.map((note) => note.onsetBeats));
    const secondsPerBeat = 60 / bpm;
    const startTime = this.context.currentTime + 0.08;

    notes.forEach((note, index) => {
      if (!this.context) return;
      const onset = startTime + (note.onsetBeats - firstBeat) * secondsPerBeat;
      const duration = Math.max(0.09, Math.min(note.durationBeats * secondsPerBeat, 2.5));
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.value = midiToFrequency(note.midi);
      gain.gain.setValueAtTime(0.0001, onset);
      gain.gain.exponentialRampToValueAtTime(0.11 * Math.max(note.velocity, 0.3), onset + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, onset + duration);
      oscillator.connect(gain).connect(this.context.destination);
      oscillator.start(onset);
      oscillator.stop(onset + duration + 0.02);
      this.oscillators.push(oscillator);
      this.timers.push(window.setTimeout(() => onProgress(index), Math.max(0, (onset - this.context!.currentTime) * 1000)));
    });

    const finalBeat = Math.max(...notes.map((note) => note.onsetBeats + note.durationBeats));
    const totalSeconds = (finalBeat - firstBeat) * secondsPerBeat;
    this.timers.push(window.setTimeout(onEnd, totalSeconds * 1000 + 150));
  }

  stop(): void {
    this.generation += 1;
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.oscillators.forEach((oscillator) => {
      try {
        oscillator.stop();
      } catch {
        // An oscillator that already ended does not need another stop.
      }
    });
    this.timers = [];
    this.oscillators = [];
    this.context = null;
  }
}
