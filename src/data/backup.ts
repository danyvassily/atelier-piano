import type { ScoreDocument, StoredProgress } from "../types";
import { scoreStorage } from "./storage";

interface SerializedScore extends Omit<ScoreDocument, "binaryData"> {
  binaryDataBase64?: string;
}

interface PianoBackup {
  format: "atelier-piano-backup";
  version: 1;
  exportedAt: string;
  scores: SerializedScore[];
  progress: StoredProgress[];
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export async function createBackup(): Promise<Blob> {
  const [scores, progress] = await Promise.all([scoreStorage.list(), scoreStorage.listProgress()]);
  const serialized = scores.map(({ binaryData, ...score }): SerializedScore => ({
    ...score,
    binaryDataBase64: binaryData ? arrayBufferToBase64(binaryData) : undefined,
  }));
  const backup: PianoBackup = {
    format: "atelier-piano-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    scores: serialized,
    progress,
  };
  return new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
}

export async function restoreBackup(file: File): Promise<number> {
  if (file.size > 150 * 1024 * 1024) throw new Error("Cette sauvegarde dépasse la limite de 150 Mo.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("La sauvegarde n’est pas un fichier JSON valide.");
  }
  const backup = parsed as Partial<PianoBackup>;
  if (backup.format !== "atelier-piano-backup" || backup.version !== 1 || !Array.isArray(backup.scores)) {
    throw new Error("Ce fichier n’est pas une sauvegarde Atelier Piano compatible.");
  }
  await Promise.all(backup.scores.map(async ({ binaryDataBase64, ...score }) => {
    if (!score.id || !score.title || !Array.isArray(score.notes)) throw new Error("Une partition de la sauvegarde est incomplète.");
    await scoreStorage.put({
      ...score,
      binaryData: binaryDataBase64 ? base64ToArrayBuffer(binaryDataBase64) : undefined,
    } as ScoreDocument);
  }));
  if (Array.isArray(backup.progress)) await Promise.all(backup.progress.map((item) => scoreStorage.putProgress(item)));
  return backup.scores.length;
}
