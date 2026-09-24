import { describe, expect, it } from "vitest";
import type { NoteEvent } from "../types";
import {
  averageConfidenceOf,
  decodeTranscriptionMessage,
  decodeTranscriptionRequest,
  encodeDoneMessage,
  encodeErrorMessage,
  encodeProgressMessage,
  encodeTranscriptionRequest,
  quantize,
  runBasicPitchInference,
  toNoteEvents,
  TRANSCRIPTION_SAMPLE_RATE,
  type PredictedNote,
} from "./transcriptionClient";

function note(overrides: Partial<NoteEvent> = {}): NoteEvent {
  return {
    id: "transcribed-0",
    midi: 60,
    name: "Do4",
    onsetBeats: 0,
    durationBeats: 0.25,
    measure: 1,
    hand: "right",
    velocity: 0.6,
    confidence: 0.6,
    ...overrides,
  };
}

describe("protocole du worker de transcription", () => {
  it("encode puis décode une demande de transcription sans perdre les échantillons", () => {
    const samples = Float32Array.from([0, 0.5, -0.5, 1]);
    const request = encodeTranscriptionRequest({ samples, sampleRate: TRANSCRIPTION_SAMPLE_RATE, bpm: 92, modelUrl: "https://exemple.test/model.json" });
    expect(request.type).toBe("transcribe");

    const decoded = decodeTranscriptionRequest(request);
    expect(decoded).not.toBeNull();
    expect(decoded?.samples).toBeInstanceOf(Float32Array);
    expect(Array.from(decoded?.samples || [])).toEqual([0, 0.5, -0.5, 1]);
    expect(decoded?.sampleRate).toBe(22_050);
    expect(decoded?.bpm).toBe(92);
    expect(decoded?.modelUrl).toBe("https://exemple.test/model.json");
  });

  it("refuse les demandes illisibles (type, échantillons, tempo ou URL manquants)", () => {
    expect(decodeTranscriptionRequest(null)).toBeNull();
    expect(decodeTranscriptionRequest("transcribe")).toBeNull();
    expect(decodeTranscriptionRequest({ type: "progress", value: 0.5 })).toBeNull();
    expect(decodeTranscriptionRequest({ type: "transcribe", samples: [0, 1], sampleRate: 22_050, bpm: 80, modelUrl: "x" })).toBeNull();
    expect(decodeTranscriptionRequest({ type: "transcribe", samples: new Float32Array(1), sampleRate: 22_050, bpm: Number.NaN, modelUrl: "x" })).toBeNull();
    expect(decodeTranscriptionRequest({ type: "transcribe", samples: new Float32Array(1), sampleRate: 22_050, bpm: 80, modelUrl: "" })).toBeNull();
  });

  it("borne la progression annoncée par le worker", () => {
    expect(encodeProgressMessage(0.42)).toEqual({ type: "progress", value: 0.42 });
    expect(encodeProgressMessage(-3)).toEqual({ type: "progress", value: 0 });
    expect(encodeProgressMessage(12)).toEqual({ type: "progress", value: 1 });
    expect(encodeProgressMessage(Number.NaN)).toEqual({ type: "progress", value: 0 });
  });

  it("décode une progression et refuse les valeurs aberrantes", () => {
    expect(decodeTranscriptionMessage({ type: "progress", value: 0.5 })).toEqual({ type: "progress", value: 0.5 });
    expect(decodeTranscriptionMessage({ type: "progress", value: 4 })).toEqual({ type: "progress", value: 1 });
    expect(decodeTranscriptionMessage({ type: "progress", value: "0.5" })).toBeNull();
    expect(decodeTranscriptionMessage({ type: "progress" })).toBeNull();
    expect(decodeTranscriptionMessage(null)).toBeNull();
    expect(decodeTranscriptionMessage({ type: "inconnu" })).toBeNull();
  });

  it("décode un résultat complet et recalcule la confiance moyenne si besoin", () => {
    const encoded = encodeDoneMessage([note({ confidence: 0.8 }), note({ id: "transcribed-1", confidence: 0.2 })], 100);
    expect(encoded.type).toBe("done");
    expect(encoded.averageConfidence).toBeCloseTo(0.5, 6);

    const decoded = decodeTranscriptionMessage(encoded);
    expect(decoded?.type).toBe("done");
    if (decoded?.type !== "done") throw new Error("message attendu de type done");
    expect(decoded.bpm).toBe(100);
    expect(decoded.notes).toHaveLength(2);
    expect(decoded.notes[0].name).toBe("Do4");

    const withoutConfidence = decodeTranscriptionMessage({ type: "done", notes: [note({ confidence: 0.4 })], bpm: 90 });
    if (withoutConfidence?.type !== "done") throw new Error("message attendu de type done");
    expect(withoutConfidence.averageConfidence).toBeCloseTo(0.4, 6);
  });

  it("écarte les notes corrompues reçues du worker", () => {
    const decoded = decodeTranscriptionMessage({ type: "done", notes: [note(), { id: "cassé" }, 42], bpm: 80 });
    if (decoded?.type !== "done") throw new Error("message attendu de type done");
    expect(decoded.notes).toHaveLength(1);
    expect(decodeTranscriptionMessage({ type: "done", notes: "notes", bpm: 80 })).toBeNull();
  });

  it("transmet les erreurs du worker", () => {
    expect(decodeTranscriptionMessage(encodeErrorMessage("modèle injoignable"))).toEqual({ type: "error", message: "modèle injoignable" });
    expect(decodeTranscriptionMessage({ type: "error" })).toBeNull();
  });

  it("refuse un échantillonnage qui ne correspond pas au modèle", async () => {
    await expect(
      runBasicPitchInference({ samples: new Float32Array(8), sampleRate: 44_100, modelUrl: "https://exemple.test/model.json" }),
    ).rejects.toThrow(/Échantillonnage inattendu/);
  });
});

describe("création des notes transcrites", () => {
  it("quantifie le rythme, numérote les mesures et répartit les mains", () => {
    const predicted: PredictedNote[] = [
      { startTimeSeconds: 0.24, durationSeconds: 1.1, pitchMidi: 48, amplitude: 1.7 },
      { startTimeSeconds: 1.9, durationSeconds: 2, pitchMidi: 72, amplitude: 0.01 },
      { startTimeSeconds: 0.02, durationSeconds: 0.01, pitchMidi: 60, amplitude: 0.55 },
    ];
    const notes = toNoteEvents(predicted, 60);

    expect(notes.map((item) => item.midi)).toEqual([60, 48, 72]);

    const [first, second, third] = notes;
    expect(first.onsetBeats).toBe(0);
    expect(first.durationBeats).toBe(0.25);
    expect(first.hand).toBe("right");
    expect(first.velocity).toBeCloseTo(0.55, 6);
    expect(first.confidence).toBeCloseTo(0.55, 6);

    expect(second.onsetBeats).toBe(0.25);
    expect(second.measure).toBe(1);
    expect(second.hand).toBe("left");
    expect(second.velocity).toBe(1);

    expect(third.onsetBeats).toBe(2);
    expect(third.durationBeats).toBe(2);
    expect(third.measure).toBe(1);
    expect(third.velocity).toBe(0.1);
  });

  it("démarre la numérotation des mesures à 1 et change de mesure tous les 4 temps", () => {
    const notes = toNoteEvents([
      { startTimeSeconds: 0, durationSeconds: 0.5, pitchMidi: 60, amplitude: 0.5 },
      { startTimeSeconds: 4, durationSeconds: 0.5, pitchMidi: 62, amplitude: 0.5 },
      { startTimeSeconds: 8, durationSeconds: 0.5, pitchMidi: 64, amplitude: 0.5 },
    ], 60);
    expect(notes.map((item) => item.measure)).toEqual([1, 2, 3]);
    expect(notes.map((item) => item.id)).toEqual(["transcribed-0", "transcribed-1", "transcribed-2"]);
  });

  it("respecte le tempo fourni", () => {
    const predicted: PredictedNote[] = [{ startTimeSeconds: 1, durationSeconds: 1, pitchMidi: 60, amplitude: 0.5 }];
    expect(toNoteEvents(predicted, 60)[0].onsetBeats).toBe(1);
    expect(toNoteEvents(predicted, 120)[0].onsetBeats).toBe(2);
    expect(toNoteEvents(predicted, 120)[0].durationBeats).toBe(2);
  });

  it("arrondit la quantification au quart de temps", () => {
    expect(quantize(0.11)).toBe(0);
    expect(quantize(0.13)).toBe(0.25);
    expect(quantize(1.9)).toBe(2);
  });

  it("calcule la confiance moyenne sans diviser par zéro", () => {
    expect(averageConfidenceOf([])).toBe(0);
    expect(averageConfidenceOf([note({ confidence: 0.5 }), note({ confidence: undefined })])).toBeCloseTo(0.25, 6);
  });
});
