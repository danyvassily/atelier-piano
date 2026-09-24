import type { NoteEvent } from "../types";
import { midiToFrenchName } from "./notes";

/**
 * Logique partagée entre le thread principal et le worker de transcription.
 *
 * Ce module est volontairement sans dépendance DOM : il contient le protocole de
 * messages (encodage / décodage purs, donc testables hors navigateur), la
 * conversion des prédictions Basic Pitch en `NoteEvent`, et l'exécution de
 * l'inférence elle-même. Il est importé par `audioTranscription.ts` (chemin
 * principal et chemin de secours) et par `transcription.worker.ts`.
 */

/** Basic Pitch n'accepte que du mono à cette fréquence (voir constants.py du modèle). */
export const TRANSCRIPTION_SAMPLE_RATE = 22_050;

/** Nombre de temps par mesure utilisé pour numéroter les mesures transcrites. */
const BEATS_PER_MEASURE = 4;

/** Pas de quantification rythmique (double-croche). */
const QUANTIZE_STEP = 0.25;

/** Moteur réellement utilisé pour une transcription (champ interne d'observabilité). */
export type TranscriptionEngine = "worker" | "main";

/** Note brute prédite par Basic Pitch, avant conversion en `NoteEvent`. */
export interface PredictedNote {
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
  amplitude: number;
}

/** Charge utile d'une transcription réussie (indépendante du moteur utilisé). */
export interface TranscriptionPayload {
  notes: NoteEvent[];
  bpm: number;
  averageConfidence: number;
}

/** Demande envoyée du thread principal vers le worker. `samples` est transférable. */
export interface TranscriptionRequest {
  type: "transcribe";
  samples: Float32Array;
  sampleRate: number;
  bpm: number;
  modelUrl: string;
}

export interface TranscriptionProgressMessage {
  type: "progress";
  /** Avancement brut de l'inférence, entre 0 et 1. */
  value: number;
}

export interface TranscriptionDoneMessage extends TranscriptionPayload {
  type: "done";
}

export interface TranscriptionErrorMessage {
  type: "error";
  message: string;
}

export type TranscriptionResponseMessage = TranscriptionProgressMessage | TranscriptionDoneMessage | TranscriptionErrorMessage;

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Construit la demande envoyée au worker (sans la poster : la couche appelante garde la main). */
export function encodeTranscriptionRequest(options: {
  samples: Float32Array;
  sampleRate: number;
  bpm: number;
  modelUrl: string;
}): TranscriptionRequest {
  return {
    type: "transcribe",
    samples: options.samples,
    sampleRate: options.sampleRate,
    bpm: options.bpm,
    modelUrl: options.modelUrl,
  };
}

export function decodeTranscriptionRequest(input: unknown): TranscriptionRequest | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as Partial<TranscriptionRequest>;
  if (candidate.type !== "transcribe") return null;
  if (!(candidate.samples instanceof Float32Array)) return null;
  if (typeof candidate.sampleRate !== "number" || !Number.isFinite(candidate.sampleRate)) return null;
  if (typeof candidate.bpm !== "number" || !Number.isFinite(candidate.bpm)) return null;
  if (typeof candidate.modelUrl !== "string" || !candidate.modelUrl) return null;
  return {
    type: "transcribe",
    samples: candidate.samples,
    sampleRate: candidate.sampleRate,
    bpm: candidate.bpm,
    modelUrl: candidate.modelUrl,
  };
}

export function encodeProgressMessage(value: number): TranscriptionProgressMessage {
  return { type: "progress", value: clampProgress(value) };
}

export function encodeDoneMessage(notes: NoteEvent[], bpm: number, averageConfidence?: number): TranscriptionDoneMessage {
  return {
    type: "done",
    notes,
    bpm,
    averageConfidence: averageConfidence ?? averageConfidenceOf(notes),
  };
}

export function encodeErrorMessage(message: string): TranscriptionErrorMessage {
  return { type: "error", message };
}

function isNoteEvent(value: unknown): value is NoteEvent {
  if (!value || typeof value !== "object") return false;
  const note = value as Partial<NoteEvent>;
  return (
    typeof note.id === "string"
    && typeof note.name === "string"
    && typeof note.midi === "number" && Number.isFinite(note.midi)
    && typeof note.onsetBeats === "number" && Number.isFinite(note.onsetBeats)
    && typeof note.durationBeats === "number" && Number.isFinite(note.durationBeats)
    && typeof note.measure === "number" && Number.isFinite(note.measure)
    && typeof note.velocity === "number" && Number.isFinite(note.velocity)
    && (note.hand === "left" || note.hand === "right")
  );
}

/**
 * Valide et normalise un message reçu du worker. Renvoie `null` pour tout
 * message illisible ou incomplet : la couche appelante l'ignore silencieusement
 * plutôt que de faire échouer la transcription.
 */
export function decodeTranscriptionMessage(input: unknown): TranscriptionResponseMessage | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as { type?: unknown };

  if (candidate.type === "progress") {
    const value = (input as { value?: unknown }).value;
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return { type: "progress", value: clampProgress(value) };
  }

  if (candidate.type === "done") {
    const { notes, bpm, averageConfidence } = input as { notes?: unknown; bpm?: unknown; averageConfidence?: unknown };
    if (!Array.isArray(notes) || typeof bpm !== "number" || !Number.isFinite(bpm)) return null;
    const safeNotes = notes.filter(isNoteEvent);
    return {
      type: "done",
      notes: safeNotes,
      bpm,
      averageConfidence: typeof averageConfidence === "number" && Number.isFinite(averageConfidence)
        ? averageConfidence
        : averageConfidenceOf(safeNotes),
    };
  }

  if (candidate.type === "error") {
    const message = (input as { message?: unknown }).message;
    if (typeof message !== "string") return null;
    return { type: "error", message };
  }

  return null;
}

export function quantize(value: number, step = QUANTIZE_STEP): number {
  return Math.round(value / step) * step;
}

/**
 * Conversion des prédictions Basic Pitch en `NoteEvent` (logique historique de
 * création de notes : quantification, mesure, main, vélocité, tri).
 */
export function toNoteEvents(predicted: PredictedNote[], bpm: number): NoteEvent[] {
  return predicted.map((note, index) => {
    const onsetBeats = Math.max(0, quantize(note.startTimeSeconds * bpm / 60));
    const durationBeats = Math.max(QUANTIZE_STEP, quantize(note.durationSeconds * bpm / 60));
    return {
      id: `transcribed-${index}`,
      midi: note.pitchMidi,
      name: midiToFrenchName(note.pitchMidi),
      onsetBeats,
      durationBeats,
      measure: Math.floor(onsetBeats / BEATS_PER_MEASURE) + 1,
      hand: note.pitchMidi < 60 ? "left" as const : "right" as const,
      velocity: Math.min(1, Math.max(0.1, note.amplitude)),
      confidence: note.amplitude,
    };
  }).sort((a, b) => a.onsetBeats - b.onsetBeats || a.midi - b.midi);
}

export function averageConfidenceOf(notes: NoteEvent[]): number {
  if (!notes.length) return 0;
  return notes.reduce((sum, note) => sum + (note.confidence || 0), 0) / notes.length;
}

export interface BasicPitchInferenceOptions {
  samples: Float32Array;
  sampleRate: number;
  modelUrl: string;
  /** Avancement brut de l'inférence (0 → 1). */
  onProgress?: (value: number) => void;
}

/**
 * Inférence Basic Pitch sur du mono 22 050 Hz, appelée aussi bien par le worker
 * que par le chemin de secours du thread principal. Le modèle est chargé à la
 * demande pour ne pas embarquer TensorFlow.js dans le bundle initial.
 */
export async function runBasicPitchInference({ samples, sampleRate, modelUrl, onProgress }: BasicPitchInferenceOptions): Promise<PredictedNote[]> {
  if (sampleRate !== TRANSCRIPTION_SAMPLE_RATE) {
    throw new Error(`Échantillonnage inattendu : ${sampleRate} Hz au lieu de ${TRANSCRIPTION_SAMPLE_RATE} Hz.`);
  }
  const { BasicPitch, addPitchBendsToNoteEvents, noteFramesToTime, outputToNotesPoly } = await import("@spotify/basic-pitch");
  const engine = new BasicPitch(modelUrl);
  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];

  await engine.evaluateModel(
    samples,
    (nextFrames, nextOnsets, nextContours) => {
      frames.push(...nextFrames);
      onsets.push(...nextOnsets);
      contours.push(...nextContours);
    },
    (progress) => onProgress?.(progress),
  );

  return noteFramesToTime(
    addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets, 0.3, 0.28, 6)),
  ).map((note) => ({
    startTimeSeconds: note.startTimeSeconds,
    durationSeconds: note.durationSeconds,
    pitchMidi: note.pitchMidi,
    amplitude: note.amplitude,
  }));
}
