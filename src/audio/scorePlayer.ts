import type { NoteEvent } from "../types";
import { unlockAudio } from "./audioContext";
import { createPianoVoice, type PianoVoice } from "./pianoSound";

export class ScorePlayer {
  private context: AudioContext | null = null;
  private timers: number[] = [];
  private voices: PianoVoice[] = [];
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
      const voice = createPianoVoice(this.context, note.midi, note.velocity, onset);
      voice.release(onset + duration, Math.min(0.72, Math.max(0.18, duration * 0.34)));
      this.voices.push(voice);
      this.timers.push(window.setTimeout(() => onProgress(index), Math.max(0, (onset - this.context!.currentTime) * 1000)));
    });

    const finalBeat = Math.max(...notes.map((note) => note.onsetBeats + note.durationBeats));
    const totalSeconds = (finalBeat - firstBeat) * secondsPerBeat;
    this.timers.push(window.setTimeout(onEnd, totalSeconds * 1000 + 150));
  }

  stop(): void {
    this.generation += 1;
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.voices.forEach((voice) => voice.stop());
    this.timers = [];
    this.voices = [];
    this.context = null;
  }
}
