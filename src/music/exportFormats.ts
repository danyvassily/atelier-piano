import { Midi } from "@tonejs/midi";
import type { NoteEvent, ScoreDocument } from "../types";

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function pitchParts(midi: number) {
  const names = [
    ["C", 0], ["C", 1], ["D", 0], ["D", 1], ["E", 0], ["F", 0],
    ["F", 1], ["G", 0], ["G", 1], ["A", 0], ["A", 1], ["B", 0],
  ] as const;
  const [step, alter] = names[((midi % 12) + 12) % 12];
  return { step, alter, octave: Math.floor(midi / 12) - 1 };
}

function noteType(duration: number): string {
  if (duration >= 16) return "whole";
  if (duration >= 8) return "half";
  if (duration >= 4) return "quarter";
  if (duration >= 2) return "eighth";
  return "16th";
}

function renderStaff(score: ScoreDocument, measure: number, staff: 1 | 2): string {
  const beats = score.timeSignature[0] * (4 / score.timeSignature[1]);
  const total = Math.max(1, Math.round(beats * 4));
  const measureStart = (measure - 1) * beats;
  const groups = new Map<number, NoteEvent[]>();
  score.notes
    .filter((note) => note.measure === measure && (staff === 1 ? note.hand === "right" : note.hand === "left"))
    .forEach((note) => {
      const onset = Math.max(0, Math.round((note.onsetBeats - measureStart) * 4));
      const group = groups.get(onset) || [];
      group.push(note);
      groups.set(onset, group);
    });

  const nodes: string[] = [];
  let cursor = 0;
  [...groups.entries()].sort(([a], [b]) => a - b).forEach(([onset, notes]) => {
    if (onset > cursor) {
      const duration = onset - cursor;
      nodes.push(`<note><rest/><duration>${duration}</duration><voice>${staff}</voice><type>${noteType(duration)}</type><staff>${staff}</staff></note>`);
    }
    const duration = Math.max(1, Math.round(Math.max(...notes.map((note) => note.durationBeats)) * 4));
    notes.sort((a, b) => a.midi - b.midi).forEach((note, index) => {
      const pitch = pitchParts(note.midi);
      nodes.push(`<note>${index ? "<chord/>" : ""}<pitch><step>${pitch.step}</step>${pitch.alter ? `<alter>${pitch.alter}</alter>` : ""}<octave>${pitch.octave}</octave></pitch><duration>${duration}</duration><voice>${staff}</voice><type>${noteType(duration)}</type><staff>${staff}</staff></note>`);
    });
    cursor = Math.max(cursor, onset + duration);
  });
  if (cursor < total) {
    const duration = total - cursor;
    nodes.push(`<note><rest/><duration>${duration}</duration><voice>${staff}</voice><type>${noteType(duration)}</type><staff>${staff}</staff></note>`);
  }
  return nodes.join("");
}

export function scoreToMusicXml(score: ScoreDocument): string {
  if (score.sourceType === "musicxml" && score.rawText) return score.rawText;
  const beats = score.timeSignature[0] * (4 / score.timeSignature[1]);
  const duration = Math.round(beats * 4);
  const measures = Array.from({ length: Math.max(1, score.measureCount) }, (_, index) => {
    const number = index + 1;
    const attributes = number === 1
      ? `<attributes><divisions>4</divisions><key><fifths>${score.keyFifths || 0}</fifths></key><time><beats>${score.timeSignature[0]}</beats><beat-type>${score.timeSignature[1]}</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${score.bpm}</per-minute></metronome></direction-type><sound tempo="${score.bpm}"/></direction>`
      : "";
    return `<measure number="${number}">${attributes}${renderStaff(score, number, 1)}<backup><duration>${duration}</duration></backup>${renderStaff(score, number, 2)}</measure>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><movement-title>${escapeXml(score.title)}</movement-title><identification><creator type="composer">${escapeXml(score.composer)}</creator><encoding><software>Atelier Piano</software></encoding></identification><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}

export function scoreToMidiBlob(score: ScoreDocument): Blob {
  const midi = new Midi();
  midi.header.setTempo(score.bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: score.timeSignature, measures: 0 });
  const ppq = midi.header.ppq;
  const right = midi.addTrack();
  right.name = "Main droite";
  const left = midi.addTrack();
  left.name = "Main gauche";
  score.notes.forEach((note) => {
    (note.hand === "left" ? left : right).addNote({
      midi: note.midi,
      ticks: Math.round(note.onsetBeats * ppq),
      durationTicks: Math.max(1, Math.round(note.durationBeats * ppq)),
      velocity: Math.min(1, Math.max(0.05, note.velocity)),
    });
  });
  return new Blob([midi.toArray() as BlobPart], { type: "audio/midi" });
}
