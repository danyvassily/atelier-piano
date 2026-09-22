import { unlockAudio } from "./audioContext";

export class Metronome {
  private context: AudioContext | null = null;
  private timer: number | null = null;
  private beat = 0;

  async start(bpm: number, beatsPerMeasure = 4): Promise<void> {
    this.stop();
    this.context = await unlockAudio();
    const tick = () => {
      if (!this.context) return;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.frequency.value = this.beat % beatsPerMeasure === 0 ? 1240 : 880;
      gain.gain.setValueAtTime(0.12, this.context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + 0.045);
      oscillator.connect(gain).connect(this.context.destination);
      oscillator.start();
      oscillator.stop(this.context.currentTime + 0.05);
      this.beat += 1;
    };
    tick();
    this.timer = window.setInterval(tick, (60_000 / bpm));
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.context = null;
    this.beat = 0;
  }
}
