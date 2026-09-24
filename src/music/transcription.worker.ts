/**
 * Worker de transcription Basic Pitch.
 *
 * Le décodage audio reste sur le thread principal (Web Audio / OfflineAudioContext
 * n'existe pas dans un worker) : ce worker reçoit directement le signal mono
 * 22 050 Hz déjà décodé, exécute l'inférence puis renvoie les notes converties en
 * `NoteEvent`. Objectif : l'interface reste réactive pendant l'analyse.
 *
 * Protocole (voir `transcriptionClient.ts`) :
 *  - entrée  : { type: "transcribe", samples, sampleRate, bpm, modelUrl }
 *  - sortie  : { type: "progress", value } | { type: "done", notes, bpm, averageConfidence } | { type: "error", message }
 */
import {
  averageConfidenceOf,
  decodeTranscriptionRequest,
  encodeDoneMessage,
  encodeErrorMessage,
  encodeProgressMessage,
  runBasicPitchInference,
  toNoteEvents,
  type TranscriptionRequest,
} from "./transcriptionClient";

/**
 * Alias `window` → scope du worker, AVANT que Basic Pitch (chargé à la demande)
 * n'évalue son TensorFlow.js embarqué. TFJS teste `!window` dans son
 * ordonnanceur d'opérations asynchrones (`setTimeoutCustom`) : sans cet alias,
 * l'inférence s'interrompt par `ReferenceError: window is not defined` et le
 * worker reste bloqué sans jamais signaler d'erreur. Les gardes `typeof window`
 * de TFJS restent fonctionnelles (son chemin navigateur est déjà couvert par
 * `WorkerGlobalScope`), et les tests unitaires du client tournent hors worker.
 */
Object.assign(globalThis, { window: globalThis });

/**
 * Vue minimale du scope worker. `DedicatedWorkerGlobalScope` n'existe que dans la
 * lib `webworker`, qui entre en conflit avec `DOM` (celle du projet) : on décrit
 * donc localement ce que ce worker utilise réellement.
 */
interface TranscriptionWorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

const workerScope = self as unknown as TranscriptionWorkerScope;

async function handleTranscription(request: TranscriptionRequest): Promise<void> {
  try {
    const predicted = await runBasicPitchInference({
      samples: request.samples,
      sampleRate: request.sampleRate,
      modelUrl: request.modelUrl,
      onProgress: (value) => workerScope.postMessage(encodeProgressMessage(value)),
    });
    const notes = toNoteEvents(predicted, request.bpm);
    workerScope.postMessage(encodeDoneMessage(notes, request.bpm, averageConfidenceOf(notes)));
  } catch (error) {
    // Toute panne (backend TensorFlow.js indisponible, modèle injoignable…) est
    // signalée au thread principal, qui bascule alors sur le chemin de secours.
    workerScope.postMessage(encodeErrorMessage(error instanceof Error ? error.message : "La transcription a échoué dans le worker."));
  }
}

workerScope.onmessage = (event: MessageEvent) => {
  const request = decodeTranscriptionRequest(event.data);
  if (!request) {
    workerScope.postMessage(encodeErrorMessage("Demande de transcription illisible."));
    return;
  }
  void handleTranscription(request);
};
