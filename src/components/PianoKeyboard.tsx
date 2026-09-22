import { useMemo } from "react";
import type { NoteEvent, NoteNaming } from "../types";
import { midiToDisplayName } from "../music/notes";

interface PianoKeyboardProps {
  notes: NoteEvent[];
  expectedMidis?: number[];
  detectedMidi?: number;
  status: "idle" | "correct" | "wrong";
  onKey: (midi: number) => void;
  naming: NoteNaming;
}

const BLACK_PITCHES = new Set([1, 3, 6, 8, 10]);

export function PianoKeyboard({ notes, expectedMidis = [], detectedMidi, status, onKey, naming }: PianoKeyboardProps) {
  const range = useMemo(() => {
    const pitches = notes.map((note) => note.midi);
    const minNote = pitches.length ? Math.min(...pitches) : 48;
    const maxNote = pitches.length ? Math.max(...pitches) : 72;
    let min = Math.max(36, minNote - 4);
    let max = Math.min(84, maxNote + 4);
    while (min % 12 !== 0 && min > 36) min -= 1;
    while (max % 12 !== 0 && max < 84) max += 1;
    return { min, max };
  }, [notes]);

  const allKeys = Array.from({ length: range.max - range.min + 1 }, (_, index) => range.min + index);
  const whiteKeys = allKeys.filter((midi) => !BLACK_PITCHES.has(midi % 12));
  const blackKeys = allKeys
    .filter((midi) => BLACK_PITCHES.has(midi % 12))
    .map((midi) => ({ midi, whiteBefore: whiteKeys.filter((whiteMidi) => whiteMidi < midi).length - 1 }));

  const keyClass = (midi: number) => {
    if (midi === detectedMidi && status === "wrong") return "is-wrong";
    if (midi === detectedMidi && status === "correct") return "is-correct";
    if (expectedMidis.includes(midi)) return "is-expected";
    return "";
  };

  return (
    <div className="keyboard-shell">
      <div className="keyboard-status" aria-live="polite">
        <span>{!expectedMidis.length ? "Sélectionnez un exercice" : `À jouer : ${expectedMidis.map((midi) => midiToDisplayName(midi, naming)).join(" + ")}`}</span>
        <span>{detectedMidi === undefined ? "Micro en attente" : `Entendue : ${midiToDisplayName(detectedMidi, naming)}`}</span>
      </div>
      <div className="piano-keyboard" style={{ "--white-count": whiteKeys.length } as React.CSSProperties}>
        {whiteKeys.map((midi) => (
          <button
            type="button"
            className={`white-key ${keyClass(midi)}`}
            key={midi}
            onPointerDown={() => onKey(midi)}
            aria-label={`Jouer ${midiToDisplayName(midi, naming)}`}
          >
            {midi % 12 === 0 && <span>{midiToDisplayName(midi, naming)}</span>}
          </button>
        ))}
        {blackKeys.map(({ midi, whiteBefore }) => (
          <button
            type="button"
            className={`black-key ${keyClass(midi)}`}
            key={midi}
            style={{ left: `calc((${whiteBefore} + .72) * (100% / var(--white-count)))` }}
            onPointerDown={() => onKey(midi)}
            aria-label={`Jouer ${midiToDisplayName(midi, naming)}`}
          />
        ))}
      </div>
    </div>
  );
}
