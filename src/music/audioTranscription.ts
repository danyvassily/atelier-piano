import type { NoteEvent, ScoreDocument } from "../types";
import { midiToFrenchName } from "./notes";

const TARGET_SAMPLE_RATE = 22_050;

async function decodeAndResample(file: File): Promise<AudioBuffer> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration > 12 * 60) {
      throw new Error("Limitez la transcription à 12 minutes par fichier.");
    }
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE), TARGET_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    return await offline.startRendering();
  } catch (error) {
    if (error instanceof Error && error.message.includes("12 minutes")) throw error;
    throw new Error("Le navigateur ne peut pas décoder ce média. Essayez un fichier WAV, MP3, M4A ou un extrait audio du fichier vidéo.", { cause: error });
  } finally {
    void context.close();
  }
}

function quantize(value: number, step = 0.25): number {
  return Math.round(value / step) * step;
}

export async function transcribePianoFile(
  file: File,
  bpm: number,
  onProgress: (progress: number) => void,
): Promise<ScoreDocument> {
  if (file.size > 100 * 1024 * 1024) throw new Error("Ce fichier dépasse la limite locale de 100 Mo.");
  onProgress(0.02);
  const audio = await decodeAndResample(file);
  onProgress(0.08);
  const { BasicPitch, addPitchBendsToNoteEvents, noteFramesToTime, outputToNotesPoly } = await import("@spotify/basic-pitch");
  const base = import.meta.env.BASE_URL || "/";
  const modelUrl = new URL(`${base}basic-pitch-model/model.json`, window.location.origin).toString();
  const engine = new BasicPitch(modelUrl);
  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];

  await engine.evaluateModel(
    audio,
    (nextFrames, nextOnsets, nextContours) => {
      frames.push(...nextFrames);
      onsets.push(...nextOnsets);
      contours.push(...nextContours);
    },
    (progress) => onProgress(0.08 + progress * 0.82),
  );

  const predicted = noteFramesToTime(
    addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets, 0.3, 0.28, 6)),
  );
  if (!predicted.length) throw new Error("Aucune note de piano suffisamment claire n’a été reconnue.");

  const beatsPerMeasure = 4;
  const notes: NoteEvent[] = predicted.map((note, index) => {
    const onsetBeats = Math.max(0, quantize(note.startTimeSeconds * bpm / 60));
    const durationBeats = Math.max(0.25, quantize(note.durationSeconds * bpm / 60));
    return {
      id: `transcribed-${index}`,
      midi: note.pitchMidi,
      name: midiToFrenchName(note.pitchMidi),
      onsetBeats,
      durationBeats,
      measure: Math.floor(onsetBeats / beatsPerMeasure) + 1,
      hand: note.pitchMidi < 60 ? "left" as const : "right" as const,
      velocity: Math.min(1, Math.max(0.1, note.amplitude)),
      confidence: note.amplitude,
    };
  }).sort((a, b) => a.onsetBeats - b.onsetBeats || a.midi - b.midi);

  onProgress(1);
  const averageConfidence = notes.reduce((sum, note) => sum + (note.confidence || 0), 0) / notes.length;
  return {
    id: crypto.randomUUID(),
    title: file.name.replace(/\.[^.]+$/, ""),
    composer: "Transcription à vérifier",
    sourceType: "transcription",
    sourceFileName: file.name,
    importedAt: new Date().toISOString(),
    bpm,
    timeSignature: [4, 4],
    keyFifths: 0,
    measureCount: Math.max(...notes.map((note) => note.measure)),
    notes,
    transcription: {
      engine: "basic-pitch",
      sourceFileName: file.name,
      sourceMimeType: file.type || "application/octet-stream",
      createdAt: new Date().toISOString(),
      averageConfidence,
    },
  };
}
