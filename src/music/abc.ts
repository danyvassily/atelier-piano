import type { Hand, NoteEvent, ScoreDocument } from "../types";

const ABC_PITCHES = ["C", "^C", "D", "^D", "E", "F", "^F", "G", "^G", "A", "^A", "B"];
const KEY_BY_FIFTHS: Record<number, string> = {
  "-7": "Cb", "-6": "Gb", "-5": "Db", "-4": "Ab", "-3": "Eb", "-2": "Bb", "-1": "F",
  0: "C", 1: "G", 2: "D", 3: "A", 4: "E", 5: "B", 6: "F#", 7: "C#",
};

function sanitize(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function abcPitch(midi: number): string {
  const pitch = ABC_PITCHES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  if (octave >= 5) return `${pitch.toLowerCase()}${"'".repeat(octave - 5)}`;
  if (octave === 4) return pitch;
  return `${pitch}${",".repeat(Math.max(0, 4 - octave))}`;
}

function durationSuffix(units: number): string {
  const rounded = Math.max(1, Math.round(units));
  return rounded === 1 ? "" : String(rounded);
}

function notesForMeasure(score: ScoreDocument, hand: Exclude<Hand, "both">, measure: number): string {
  const beatsPerMeasure = score.timeSignature[0] * (4 / score.timeSignature[1]);
  const measureUnits = Math.round(beatsPerMeasure * 4);
  const measureStartBeat = (measure - 1) * beatsPerMeasure;
  const groups = new Map<number, NoteEvent[]>();

  score.notes
    .filter((note) => note.hand === hand && note.measure === measure)
    .forEach((note) => {
      const localUnits = Math.max(0, Math.round((note.onsetBeats - measureStartBeat) * 4));
      const group = groups.get(localUnits) || [];
      group.push(note);
      groups.set(localUnits, group);
    });

  let cursor = 0;
  const tokens: string[] = [];
  [...groups.entries()].sort(([a], [b]) => a - b).forEach(([onset, notes]) => {
    if (onset > cursor) tokens.push(`z${durationSuffix(onset - cursor)}`);
    const duration = Math.max(1, Math.round(Math.max(...notes.map((note) => note.durationBeats)) * 4));
    const pitches = notes.sort((a, b) => a.midi - b.midi).map((note) => abcPitch(note.midi));
    tokens.push(`${pitches.length > 1 ? `[${pitches.join("")}]` : pitches[0]}${durationSuffix(duration)}`);
    cursor = Math.max(cursor, onset + duration);
  });
  if (cursor < measureUnits) tokens.push(`z${durationSuffix(measureUnits - cursor)}`);
  return `${tokens.join(" ") || `z${durationSuffix(measureUnits)}`} |`;
}

export function scoreToAbc(score: ScoreDocument): string {
  const key = KEY_BY_FIFTHS[score.keyFifths || 0] || "C";
  const measures = Array.from({ length: Math.max(1, score.measureCount) }, (_, index) => index + 1);
  const right = measures.map((measure) => notesForMeasure(score, "right", measure)).join("\n");
  const left = measures.map((measure) => notesForMeasure(score, "left", measure)).join("\n");
  return [
    "X:1",
    `T:${sanitize(score.title)}`,
    `C:${sanitize(score.composer)}`,
    `M:${score.timeSignature[0]}/${score.timeSignature[1]}`,
    "L:1/16",
    `Q:1/4=${score.bpm}`,
    `K:${key}`,
    "%%score { ( RH LH ) }",
    "V:RH clef=treble name=\"Main droite\"",
    "V:LH clef=bass name=\"Main gauche\"",
    `[V:RH]\n${right}`,
    `[V:LH]\n${left}`,
    "",
  ].join("\n");
}
