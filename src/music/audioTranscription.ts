import type { ScoreDocument } from "../types";
import {
  averageConfidenceOf,
  decodeTranscriptionMessage,
  encodeTranscriptionRequest,
  runBasicPitchInference,
  toNoteEvents,
  TRANSCRIPTION_SAMPLE_RATE,
  type TranscriptionEngine,
  type TranscriptionPayload,
} from "./transcriptionClient";

const MAX_FILE_BYTES = 100 * 1024 * 1024;

/**
 * Décodage du média + rééchantillonnage mono 22 050 Hz.
 * Reste sur le thread principal : `OfflineAudioContext` n'existe pas dans un worker.
 */
async function decodeAndResample(file: File): Promise<AudioBuffer> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration > 12 * 60) {
      throw new Error("Limitez la transcription à 12 minutes par fichier.");
    }
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * TRANSCRIPTION_SAMPLE_RATE), TRANSCRIPTION_SAMPLE_RATE);
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

/**
 * Signal mono 22 050 Hz prêt pour Basic Pitch. Appelée par `transcribePianoFile`
 * avant de transférer les échantillons au worker.
 */
export async function decodeAudioToMonoSamples(file: File): Promise<Float32Array> {
  const audio = await decodeAndResample(file);
  return audio.getChannelData(0);
}

function basicPitchModelUrl(): string {
  const base = import.meta.env.BASE_URL || "/";
  return new URL(`${base}basic-pitch-model/model.json`, window.location.origin).toString();
}

function createTranscriptionWorker(): Worker {
  return new Worker(new URL("./transcription.worker.ts", import.meta.url), { type: "module" });
}

/**
 * Chemin nominal : inférence dans le worker, l'interface reste fluide pendant
 * l'analyse. Rejette si le worker ne peut pas démarrer ou si TensorFlow.js n'y
 * fonctionne pas — l'appelant bascule alors sur le thread principal.
 */
function transcribeSamplesInWorker(
  samples: Float32Array,
  bpm: number,
  modelUrl: string,
  onProgress: (progress: number) => void,
): Promise<TranscriptionPayload> {
  return new Promise<TranscriptionPayload>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = createTranscriptionWorker();
    } catch (error) {
      reject(error instanceof Error ? error : new Error("Le worker de transcription n’a pas pu démarrer."));
      return;
    }

    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      action();
    };

    worker.onmessage = (event: MessageEvent) => {
      const message = decodeTranscriptionMessage(event.data);
      if (!message) return;
      if (message.type === "progress") {
        onProgress(0.08 + message.value * 0.82);
        return;
      }
      if (message.type === "done") {
        finish(() => resolve({ notes: message.notes, bpm: message.bpm, averageConfidence: message.averageConfidence }));
        return;
      }
      finish(() => reject(new Error(message.message)));
    };
    worker.onerror = (event) => finish(() => reject(new Error(event.message || "Le worker de transcription a échoué.")));
    worker.onmessageerror = () => finish(() => reject(new Error("Le worker de transcription a renvoyé des données illisibles.")));

    const request = encodeTranscriptionRequest({ samples, sampleRate: TRANSCRIPTION_SAMPLE_RATE, bpm, modelUrl });
    // Transfert sans copie : l'interface reste fluide et la mémoire n'est pas doublée.
    worker.postMessage(request, [request.samples.buffer as ArrayBuffer]);
  });
}

/** Chemin de secours : pipeline historique exécuté sur le thread principal. */
async function transcribeSamplesOnMainThread(
  samples: Float32Array,
  bpm: number,
  modelUrl: string,
  onProgress: (progress: number) => void,
): Promise<TranscriptionPayload> {
  const predicted = await runBasicPitchInference({
    samples,
    sampleRate: TRANSCRIPTION_SAMPLE_RATE,
    modelUrl,
    onProgress: (value) => onProgress(0.08 + value * 0.82),
  });
  const notes = toNoteEvents(predicted, bpm);
  return { notes, bpm, averageConfidence: averageConfidenceOf(notes) };
}

/** Partition transcrite + moteur réellement utilisé (champ interne, journalisé en console). */
export type TranscribedScoreDocument = ScoreDocument & { engine: TranscriptionEngine };

export async function transcribePianoFile(
  file: File,
  bpm: number,
  onProgress: (progress: number) => void,
): Promise<TranscribedScoreDocument> {
  if (file.size > MAX_FILE_BYTES) throw new Error("Ce fichier dépasse la limite locale de 100 Mo.");
  onProgress(0.02);
  const samples = await decodeAudioToMonoSamples(file);
  onProgress(0.08);
  const modelUrl = basicPitchModelUrl();

  let engine: TranscriptionEngine = "worker";
  let payload: TranscriptionPayload;
  try {
    payload = await transcribeSamplesInWorker(samples, bpm, modelUrl, onProgress);
  } catch (workerError) {
    engine = "main";
    console.warn("[transcription] worker indisponible, repli sur le thread principal :", workerError);
    // Les échantillons ont été transférés au worker (tampon détaché) : on re-décode
    // le fichier, uniquement sur ce chemin de secours.
    payload = await transcribeSamplesOnMainThread(await decodeAudioToMonoSamples(file), bpm, modelUrl, onProgress);
  }

  const notes = payload.notes;
  if (!notes.length) throw new Error("Aucune note de piano suffisamment claire n’a été reconnue.");

  console.info(`[transcription] moteur : ${engine}`);
  onProgress(1);
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
      averageConfidence: payload.averageConfidence,
    },
    engine,
  };
}
