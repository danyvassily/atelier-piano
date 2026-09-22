import { Midi } from "@tonejs/midi";
import type { NoteEvent, ScoreDocument } from "../types";
import { midiToFrenchName } from "./notes";

function inferHand(trackName: string, midi: number): "left" | "right" {
  const normalized = trackName.toLowerCase();
  if (/left|main gauche|lh|bass/.test(normalized)) return "left";
  if (/right|main droite|rh|treble/.test(normalized)) return "right";
  return midi < 60 ? "left" : "right";
}

export function parseMidi(data: ArrayBuffer, fileName = "Partition MIDI"): ScoreDocument {
  const midi = new Midi(new Uint8Array(data));
  const ppq = midi.header.ppq || 480;
  const signature = midi.header.timeSignatures[0]?.timeSignature || [4, 4];
  const beatsPerMeasure = signature[0] * (4 / signature[1]);
  const bpm = Math.round(midi.header.tempos[0]?.bpm || 80);
  const notes: NoteEvent[] = [];

  midi.tracks.forEach((track, trackIndex) => {
    track.notes.forEach((note, noteIndex) => {
      const onsetBeats = note.ticks / ppq;
      notes.push({
        id: `midi-${trackIndex}-${noteIndex}`,
        midi: note.midi,
        name: midiToFrenchName(note.midi),
        onsetBeats,
        durationBeats: Math.max(note.durationTicks / ppq, 0.125),
        measure: Math.floor(onsetBeats / beatsPerMeasure) + 1,
        hand: inferHand(track.name, note.midi),
        velocity: note.velocity,
      });
    });
  });

  if (!notes.length) {
    throw new Error("Le fichier MIDI ne contient aucune note.");
  }

  const sorted = notes.sort((a, b) => a.onsetBeats - b.onsetBeats || a.midi - b.midi);
  return {
    id: crypto.randomUUID(),
    title: midi.name || fileName.replace(/\.(mid|midi)$/i, ""),
    composer: "Compositeur inconnu",
    sourceType: "midi",
    importedAt: new Date().toISOString(),
    bpm,
    timeSignature: [signature[0], signature[1]],
    keyFifths: 0,
    measureCount: Math.max(...sorted.map((note) => note.measure)),
    notes: sorted,
    binaryData: data,
  };
}
