import type { ScoreDocument } from "../types";
import { extractMusicXmlFromMxl, parseMusicXml } from "./musicXml";
import { parseLilyPond } from "./lilypond";

const MEDIA_EXTENSIONS = new Set(["wav", "mp3", "ogg", "flac", "m4a", "aac", "mp4", "mov", "webm"]);

export function isTranscribableMedia(file: File): boolean {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  return file.type.startsWith("audio/") || file.type.startsWith("video/") || MEDIA_EXTENSIONS.has(extension);
}

export async function importScore(file: File, options?: { bpm?: number; onProgress?: (progress: number) => void }): Promise<ScoreDocument> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "xml" || extension === "musicxml") {
    return parseMusicXml(await file.text(), file.name);
  }
  if (extension === "mxl") {
    const buffer = await file.arrayBuffer();
    return parseMusicXml(extractMusicXmlFromMxl(buffer), file.name);
  }
  if (extension === "mid" || extension === "midi") {
    const { parseMidi } = await import("./midi");
    return parseMidi(await file.arrayBuffer(), file.name);
  }
  if (extension === "ly") {
    return parseLilyPond(await file.text(), file.name);
  }
  if (extension === "pdf") {
    return {
      id: crypto.randomUUID(),
      title: file.name.replace(/\.pdf$/i, ""),
      composer: "Compositeur inconnu",
      sourceType: "pdf",
      importedAt: new Date().toISOString(),
      bpm: 80,
      timeSignature: [4, 4],
      measureCount: 0,
      notes: [],
      sourceFileName: file.name,
      binaryData: await file.arrayBuffer(),
    };
  }

  if (isTranscribableMedia(file)) {
    const { transcribePianoFile } = await import("./audioTranscription");
    return transcribePianoFile(file, options?.bpm || 80, options?.onProgress || (() => undefined));
  }

  throw new Error("Format non pris en charge. Utilisez MusicXML, MXL, MIDI, PDF, LilyPond ou un média audio/vidéo local.");
}
