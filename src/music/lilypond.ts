import type { ScoreDocument } from "../types";

function quotedValue(source: string, field: string): string | undefined {
  return source.match(new RegExp(`${field}\\s*=\\s*"([^"]+)"`))?.[1]?.trim();
}

export function parseLilyPond(source: string, fileName: string): ScoreDocument {
  if (!/\\version|\\score|\\new\s+(PianoStaff|Staff)/.test(source)) {
    throw new Error("Ce fichier ne semble pas contenir une partition LilyPond valide.");
  }
  const time = source.match(/\\time\s+(\d+)\s*\/\s*(\d+)/);
  const tempo = source.match(/\\tempo(?:\s+\d+)?\s*=\s*(\d+)/);

  return {
    id: crypto.randomUUID(),
    title: quotedValue(source, "title") || fileName.replace(/\.ly$/i, ""),
    composer: quotedValue(source, "composer") || "Compositeur inconnu",
    sourceType: "lilypond",
    sourceFileName: fileName,
    importedAt: new Date().toISOString(),
    bpm: tempo ? Number(tempo[1]) : 80,
    timeSignature: time ? [Number(time[1]), Number(time[2])] : [4, 4],
    measureCount: 0,
    notes: [],
    rawText: source,
  };
}
