import { describe, expect, it } from "vitest";
import type { NoteEvent } from "../types";
import {
  ACTIVE_NOTE_WINDOW_SEC,
  BLACK_KEY_WIDTH_RATIO,
  CHROMATIC_PITCH_COUNT,
  MAX_RANGE_MIDI,
  MIN_NOTE_HEIGHT_PX,
  MIN_RANGE_MIDI,
  activeNotesAt,
  beatsToSeconds,
  buildLayout,
  computeRange,
  isBlackKey,
  loopProgress,
  noteRectAt,
  pitchClassOf,
  secondsToBeats,
  sortNotesByOnset,
  upcomingNote,
  visibleNotes,
} from "./timeline";

function makeNote(partial: Partial<NoteEvent> & { midi: number; onsetBeats: number }): NoteEvent {
  return {
    id: `note-${partial.midi}-${partial.onsetBeats}`,
    name: "",
    durationBeats: 1,
    measure: 1,
    hand: "right",
    velocity: 90,
    ...partial,
  };
}

/** Clavier Do3 → Do5 (48..72) : 15 touches blanches, largeur de test 300 px. */
const LAYOUT = buildLayout({ min: 48, max: 72 });
const WIDTH_PX = 300;
const HIT_LINE_Y = 260;
const WHITE_WIDTH_PX = WIDTH_PX / LAYOUT.whiteCount;

describe("conversions temps ↔ secondes", () => {
  it("traduit les temps en secondes pour un tempo donné", () => {
    expect(beatsToSeconds(1, 120)).toBeCloseTo(0.5, 10);
    expect(beatsToSeconds(4, 120)).toBeCloseTo(2, 10);
    expect(beatsToSeconds(1, 60)).toBeCloseTo(1, 10);
    expect(beatsToSeconds(0, 90)).toBe(0);
  });

  it("ralentit la lecture quand le facteur de tempo diminue", () => {
    expect(beatsToSeconds(2, 100, 0.5)).toBeCloseTo(2.4, 10);
    expect(beatsToSeconds(2, 100, 2)).toBeCloseTo(0.6, 10);
  });

  it("convertit les secondes en temps et boucle proprement", () => {
    expect(secondsToBeats(1, 120)).toBeCloseTo(2, 10);
    expect(secondsToBeats(0.5, 90, 1.5)).toBeCloseTo((0.5 * 135) / 60, 10);
    const beats = 7.5;
    expect(secondsToBeats(beatsToSeconds(beats, 96, 0.75), 96, 0.75)).toBeCloseTo(beats, 10);
  });

  it("se protège des tempos et facteurs inexploitables", () => {
    expect(beatsToSeconds(3, 0)).toBe(0);
    expect(beatsToSeconds(3, Number.NaN)).toBe(0);
    expect(beatsToSeconds(3, Number.POSITIVE_INFINITY)).toBe(0);
    expect(beatsToSeconds(Number.NaN, 120)).toBe(0);
    expect(secondsToBeats(2, 0)).toBe(0);
    // Facteur nul, négatif ou non fini : ignoré, on garde le tempo nominal.
    expect(beatsToSeconds(3, 120, 0)).toBeCloseTo(1.5, 10);
    expect(beatsToSeconds(3, 120, -2)).toBeCloseTo(1.5, 10);
    expect(beatsToSeconds(3, 120, Number.NaN)).toBeCloseTo(1.5, 10);
  });
});

describe("classes de hauteur", () => {
  it("reconnaît les touches noires", () => {
    expect(pitchClassOf(60)).toBe(0);
    expect(pitchClassOf(61)).toBe(1);
    expect(pitchClassOf(36)).toBe(0);
    expect(isBlackKey(61)).toBe(true);
    expect(isBlackKey(60)).toBe(false);
    expect(isBlackKey(66)).toBe(true);
  });

  it("normalise les hauteurs hors clavier", () => {
    expect(pitchClassOf(-1)).toBe(11);
    expect(pitchClassOf(0)).toBe(0);
    expect(pitchClassOf(120)).toBe(0);
  });
});

describe("computeRange", () => {
  it("retombe sur une plage lisible sans note exploitable", () => {
    expect(computeRange([])).toEqual({ min: 48, max: 72 });
    expect(computeRange([makeNote({ midi: Number.NaN, onsetBeats: 0 })])).toEqual({ min: 48, max: 72 });
  });

  it("encadre les extrêmes avec la marge demandée et aligne sur les octaves", () => {
    expect(computeRange([makeNote({ midi: 60, onsetBeats: 0 }), makeNote({ midi: 64, onsetBeats: 1 })])).toEqual({ min: 48, max: 72 });
    expect(computeRange([makeNote({ midi: 60, onsetBeats: 0 })], 0)).toEqual({ min: 60, max: 72 });
    expect(computeRange([makeNote({ midi: 72, onsetBeats: 0 })])).toEqual({ min: 60, max: 84 });
    expect(computeRange([makeNote({ midi: 60, onsetBeats: 0 })], Number.NaN)).toEqual({ min: 60, max: 72 });
  });

  it("borne la plage à 24..96", () => {
    expect(computeRange([makeNote({ midi: 30, onsetBeats: 0 })])).toEqual({ min: MIN_RANGE_MIDI, max: 36 });
    expect(computeRange([makeNote({ midi: 92, onsetBeats: 0 })], 8)).toEqual({ min: 84, max: MAX_RANGE_MIDI });
    expect(computeRange([makeNote({ midi: 100, onsetBeats: 0 })])).toEqual({ min: 84, max: MAX_RANGE_MIDI });
  });

  it("garde toujours au moins une octave de clavier", () => {
    const extreme = computeRange([makeNote({ midi: 96, onsetBeats: 0 })], 12);
    expect(extreme.max - extreme.min).toBeGreaterThanOrEqual(12);
    expect(extreme.min).toBeGreaterThanOrEqual(MIN_RANGE_MIDI);
    expect(extreme.max).toBeLessThanOrEqual(MAX_RANGE_MIDI);
  });
});

describe("buildLayout", () => {
  it("sépare blanches et noires et compte les touches blanches", () => {
    expect(LAYOUT.whiteCount).toBe(15);
    expect(LAYOUT.whiteMidis[0]).toBe(48);
    expect(LAYOUT.whiteMidis[LAYOUT.whiteMidis.length - 1]).toBe(72);
    expect(LAYOUT.whiteMidis.every((midi) => !isBlackKey(midi))).toBe(true);
    expect(LAYOUT.blackMidis).toContain(49);
    expect(LAYOUT.blackMidis.every((midi) => isBlackKey(midi))).toBe(true);
    expect(LAYOUT.whiteMidis.length + LAYOUT.blackMidis.length).toBe(25);
  });

  it("centre les touches blanches au milieu de leur colonne", () => {
    expect(LAYOUT.xRatioForMidi(48)).toBeCloseTo(0.5 / 15, 10);
    expect(LAYOUT.xRatioForMidi(50)).toBeCloseTo(1.5 / 15, 10);
    expect(LAYOUT.xRatioForMidi(72)).toBeCloseTo(14.5 / 15, 10);
  });

  it("place les touches noires entre deux blanches, comme la CSS du clavier", () => {
    // Do♯3 : blanche précédente d’index 0 → bord gauche 0,72, largeur 58 %.
    expect(LAYOUT.xRatioForMidi(49)).toBeCloseTo((0 + 0.72 + BLACK_KEY_WIDTH_RATIO / 2) / 15, 10);
    // Ré♯3 : blanche précédente d’index 1.
    expect(LAYOUT.xRatioForMidi(51)).toBeCloseTo((1 + 0.72 + BLACK_KEY_WIDTH_RATIO / 2) / 15, 10);
    const noir = LAYOUT.xRatioForMidi(61);
    expect(noir).toBeGreaterThan(LAYOUT.xRatioForMidi(60));
    expect(noir).toBeLessThan(LAYOUT.xRatioForMidi(62));
  });

  it("produit des positions croissantes et bornées sur toute la plage", () => {
    const ratios = Array.from({ length: 25 }, (_, index) => LAYOUT.xRatioForMidi(48 + index));
    expect(ratios).toEqual([...ratios].sort((a, b) => a - b));
    expect(ratios.every((ratio) => ratio >= 0 && ratio <= 1)).toBe(true);
  });

  it("projette les hauteurs hors plage et survit à un clavier sans blanche", () => {
    expect(LAYOUT.xRatioForMidi(36)).toBeCloseTo(0.5 / 15, 10);
    expect(LAYOUT.xRatioForMidi(96)).toBeCloseTo(14.5 / 15, 10);
    const seuleNoire = buildLayout({ min: 25, max: 25 });
    expect(seuleNoire.whiteCount).toBe(0);
    expect(seuleNoire.xRatioForMidi(25)).toBe(0.5);
  });

  it("accepte une plage inversée", () => {
    expect(buildLayout({ min: 72, max: 48 }).whiteCount).toBe(15);
  });
});

describe("noteRectAt", () => {
  const note = makeNote({ midi: 60, onsetBeats: 0, durationBeats: 1 });

  it("pose le bord bas sur la ligne de frappe au moment de l’attaque", () => {
    const rect = noteRectAt(note, 0, 120, 1, 100, HIT_LINE_Y, LAYOUT, WIDTH_PX);
    expect(rect).not.toBeNull();
    expect(rect?.hPx).toBeCloseTo(50, 10);
    expect((rect?.yTopPx ?? 0) + (rect?.hPx ?? 0)).toBeCloseTo(HIT_LINE_Y, 10);
  });

  it("remonte la note avant l’attaque et la fait descendre après", () => {
    const avant = noteRectAt(note, -0.5, 120, 1, 100, HIT_LINE_Y, LAYOUT, WIDTH_PX);
    const pendant = noteRectAt(note, 0.2, 120, 1, 100, HIT_LINE_Y, LAYOUT, WIDTH_PX);
    expect((avant?.yTopPx ?? 0) + (avant?.hPx ?? 0)).toBeCloseTo(HIT_LINE_Y - 50, 10);
    expect((pendant?.yTopPx ?? 0) + (pendant?.hPx ?? 0)).toBeCloseTo(HIT_LINE_Y + 20, 10);
  });

  it("respecte le tempo et le facteur de tempo", () => {
    // 120 BPM à 0,5× : une noire (1 temps) dure 1 s, soit 100 px à 100 px/s.
    const lent = noteRectAt(note, 0, 120, 0.5, 100, HIT_LINE_Y, LAYOUT, WIDTH_PX);
    expect(lent?.hPx).toBeCloseTo(100, 10);
  });

  it("garantit une hauteur minimale aux notes très courtes", () => {
    const courte = makeNote({ midi: 64, onsetBeats: 0, durationBeats: 0.02 });
    expect(noteRectAt(courte, 0, 120, 1, 100, HIT_LINE_Y, LAYOUT, WIDTH_PX)?.hPx).toBe(MIN_NOTE_HEIGHT_PX);
    expect(noteRectAt(courte, 0, 120, 1, 100, HIT_LINE_Y, LAYOUT, WIDTH_PX, 14)?.hPx).toBe(14);
  });

  it("centre la note sur sa touche et rétrécit les touches noires", () => {
    const blanche = noteRectAt(note, 0, 120, 1, 100, HIT_LINE_Y, LAYOUT, WIDTH_PX);
    const noire = noteRectAt(makeNote({ midi: 61, onsetBeats: 0 }), 0, 120, 1, 100, HIT_LINE_Y, LAYOUT, WIDTH_PX);
    expect((blanche?.xPx ?? 0) + (blanche?.wPx ?? 0) / 2).toBeCloseTo(LAYOUT.xRatioForMidi(60) * WIDTH_PX, 10);
    expect((noire?.xPx ?? 0) + (noire?.wPx ?? 0) / 2).toBeCloseTo(LAYOUT.xRatioForMidi(61) * WIDTH_PX, 10);
    expect(blanche?.wPx).toBeCloseTo(WHITE_WIDTH_PX * 0.86, 10);
    expect(noire?.wPx).toBeCloseTo(WHITE_WIDTH_PX * 0.6, 10);
    expect(noire?.wPx).toBeLessThan(blanche?.wPx ?? 0);
    expect(blanche?.xPx ?? -1).toBeGreaterThanOrEqual(0);
    expect((blanche?.xPx ?? 0) + (blanche?.wPx ?? 0)).toBeLessThanOrEqual(WIDTH_PX);
  });

  it("renvoie null quand la note est hors de la zone de jeu", () => {
    expect(noteRectAt(note, 1, 120, 1, 100, HIT_LINE_Y, LAYOUT, WIDTH_PX)).toBeNull();
    expect(noteRectAt(note, -10, 120, 1, 100, HIT_LINE_Y, LAYOUT, WIDTH_PX)).toBeNull();
  });

  it("renvoie null si la géométrie est inutilisable", () => {
    const sansBlanche = buildLayout({ min: 25, max: 25 });
    expect(noteRectAt(note, 0, 120, 1, 100, HIT_LINE_Y, sansBlanche, WIDTH_PX)).toBeNull();
    expect(noteRectAt(note, 0, 120, 1, 0, HIT_LINE_Y, LAYOUT, WIDTH_PX)).toBeNull();
    expect(noteRectAt(note, 0, 120, 1, 100, HIT_LINE_Y, LAYOUT, 0)).toBeNull();
    expect(noteRectAt(note, Number.NaN, 120, 1, 100, HIT_LINE_Y, LAYOUT, WIDTH_PX)).toBeNull();
  });
});

describe("visibleNotes", () => {
  const notes = [
    makeNote({ id: "r1", midi: 60, onsetBeats: 0, durationBeats: 1, hand: "right" }),
    makeNote({ id: "l1", midi: 52, onsetBeats: 1, durationBeats: 1, hand: "left" }),
    makeNote({ id: "r2", midi: 67, onsetBeats: 2, durationBeats: 1, hand: "right" }),
    makeNote({ id: "r3", midi: 64, onsetBeats: 10, durationBeats: 1, hand: "right" }),
  ];
  const options = { bpm: 120, pxPerSec: 100, hitLineY: HIT_LINE_Y, layout: LAYOUT, widthPx: WIDTH_PX };

  it("ne garde que la fenêtre visible, triée par attaque et prête à dessiner", () => {
    const visibles = visibleNotes(notes, 0.4, options);
    expect(visibles.map((item) => item.note.id)).toEqual(["r1", "l1", "r2"]);
    expect(visibles.every((item) => item.rect.hPx >= MIN_NOTE_HEIGHT_PX)).toBe(true);
    expect(visibles.every((item) => item.rect.yTopPx < HIT_LINE_Y)).toBe(true);
  });

  it("filtre la main demandée", () => {
    expect(visibleNotes(notes, 0.4, { ...options, hand: "left" }).map((item) => item.note.id)).toEqual(["l1"]);
    expect(visibleNotes(notes, 0.4, { ...options, hand: "right" }).map((item) => item.note.id)).toEqual(["r1", "r2"]);
    expect(visibleNotes(notes, 0.4, { ...options, hand: "both" })).toHaveLength(3);
  });

  it("écarte les notes déjà passées sous la ligne de frappe", () => {
    const passees = [
      makeNote({ id: "vieux", midi: 60, onsetBeats: 0, durationBeats: 1 }),
      makeNote({ id: "recent", midi: 64, onsetBeats: 6, durationBeats: 1 }),
    ];
    expect(visibleNotes(passees, 2, options).map((item) => item.note.id)).toEqual(["recent"]);
  });

  it("applique la hauteur minimale demandée", () => {
    const courtes = [makeNote({ id: "c1", midi: 60, onsetBeats: 0, durationBeats: 0.01 })];
    expect(visibleNotes(courtes, 0, options)[0].rect.hPx).toBe(MIN_NOTE_HEIGHT_PX);
    expect(visibleNotes(courtes, 0, { ...options, minHeightPx: 18 })[0].rect.hPx).toBe(18);
  });

  it("respecte l’ordre fourni quand les notes sont annoncées triées", () => {
    const desordonnees = [notes[1], notes[0]];
    expect(visibleNotes(desordonnees, 0.4, { ...options, sorted: true }).map((item) => item.note.id)).toEqual(["l1", "r1"]);
    expect(visibleNotes(desordonnees, 0.4, options).map((item) => item.note.id)).toEqual(["r1", "l1"]);
  });

  it("conserve une note longue dont l’attaque est passée", () => {
    const longue = [makeNote({ id: "long", midi: 60, onsetBeats: 0, durationBeats: 8 })];
    expect(visibleNotes(longue, 2, options).map((item) => item.note.id)).toEqual(["long"]);
  });

  it("renvoie une liste vide sans géométrie exploitable", () => {
    expect(visibleNotes(notes, 0.4, { ...options, widthPx: 0 })).toEqual([]);
    expect(visibleNotes(notes, 0.4, { ...options, pxPerSec: 0 })).toEqual([]);
    expect(visibleNotes(notes, Number.NaN, options)).toEqual([]);
    expect(visibleNotes([], 0.4, options)).toEqual([]);
  });
});

describe("activeNotesAt", () => {
  const tempo = { bpm: 120, tempoFactor: 1 };
  // Attaques : 0 s (a), 2 s (b), 4 s (c).
  const notes = [
    makeNote({ id: "a", midi: 60, onsetBeats: 0 }),
    makeNote({ id: "b", midi: 64, onsetBeats: 4 }),
    makeNote({ id: "c", midi: 67, onsetBeats: 8 }),
  ];

  it("garde les attaques qui viennent de passer", () => {
    expect(activeNotesAt(notes, 0, ACTIVE_NOTE_WINDOW_SEC, tempo).map((note) => note.id)).toEqual(["a"]);
    expect(activeNotesAt(notes, 2.1, ACTIVE_NOTE_WINDOW_SEC, tempo).map((note) => note.id)).toEqual(["b"]);
    expect(activeNotesAt(notes, 4, ACTIVE_NOTE_WINDOW_SEC, tempo).map((note) => note.id)).toEqual(["c"]);
  });

  it("ignore les notes futures et les attaques plus anciennes que la fenêtre", () => {
    expect(activeNotesAt(notes, 3.9, ACTIVE_NOTE_WINDOW_SEC, tempo)).toEqual([]);
    expect(activeNotesAt(notes, 2.4, ACTIVE_NOTE_WINDOW_SEC, tempo)).toEqual([]);
    expect(activeNotesAt(notes, 2.05, 0.02, tempo)).toEqual([]);
    expect(activeNotesAt(notes, 2.05, 0.2, tempo).map((note) => note.id)).toEqual(["b"]);
  });

  it("accepte une fenêtre nulle ou négative et des paramètres non finis", () => {
    expect(activeNotesAt(notes, 2, 0, tempo).map((note) => note.id)).toEqual(["b"]);
    expect(activeNotesAt(notes, 2, -1, tempo)).toEqual([]);
    expect(activeNotesAt(notes, Number.NaN, ACTIVE_NOTE_WINDOW_SEC, tempo)).toEqual([]);
  });

  it("utilise le tempo de repli quand il n’est pas fourni", () => {
    const lent = [makeNote({ id: "x", midi: 60, onsetBeats: 2 })];
    expect(lent.length && activeNotesAt(lent, 1, ACTIVE_NOTE_WINDOW_SEC)).toHaveLength(1); // 2 temps à 120 BPM = 1 s
    expect(activeNotesAt(lent, 0.5, ACTIVE_NOTE_WINDOW_SEC)).toEqual([]);
  });
});

describe("upcomingNote", () => {
  const tempo = { bpm: 120, tempoFactor: 1 };
  // Attaques : 0 s (p1), 2 s (p2 + p3), 2,02 s (p4), 6 s (p5).
  const notes = [
    makeNote({ id: "p1", midi: 48, onsetBeats: 0 }),
    makeNote({ id: "p2", midi: 67, onsetBeats: 4 }),
    makeNote({ id: "p3", midi: 60, onsetBeats: 4 }),
    makeNote({ id: "p4", midi: 65, onsetBeats: 4.04 }),
    makeNote({ id: "p5", midi: 72, onsetBeats: 12 }),
  ];

  it("renvoie l’accord complet de la prochaine attaque, du grave vers l’aigu", () => {
    expect(upcomingNote(notes, 0.5, undefined, tempo).map((note) => note.midi)).toEqual([60, 65, 67]);
  });

  it("inclut la note pile sur l’instant courant et ignore les attaques passées", () => {
    expect(upcomingNote(notes, 2, undefined, tempo).map((note) => note.midi)).toEqual([60, 65, 67]);
    expect(upcomingNote(notes, 3.9, undefined, tempo).map((note) => note.midi)).toEqual([72]);
    expect(upcomingNote(notes, 4.5, undefined, tempo).map((note) => note.midi)).toEqual([72]);
  });

  it("renvoie une liste vide à la fin du morceau", () => {
    expect(upcomingNote(notes, 10, undefined, tempo)).toEqual([]);
    expect(upcomingNote([], 0, undefined, tempo)).toEqual([]);
    expect(upcomingNote(notes, Number.NaN, undefined, tempo)).toEqual([]);
  });

  it("resserre ou élargit le regroupement d’accord", () => {
    expect(upcomingNote(notes, 0.5, 0.005, tempo).map((note) => note.midi)).toEqual([60, 67]);
    expect(upcomingNote(notes, 0.5, 0.2, tempo).map((note) => note.midi)).toEqual([60, 65, 67]);
  });
});

describe("loopProgress", () => {
  it("laisse la position intacte dans l’intervalle", () => {
    expect(loopProgress(3, 2, 5)).toBeCloseTo(3, 10);
    expect(loopProgress(2, 2, 5)).toBeCloseTo(2, 10);
  });

  it("replie les dépassements et les tours complets", () => {
    expect(loopProgress(6, 2, 5)).toBeCloseTo(3, 10);
    expect(loopProgress(8, 2, 5)).toBeCloseTo(2, 10);
    expect(loopProgress(5, 2, 5)).toBeCloseTo(2, 10);
    expect(loopProgress(2 + 3 * 4 + 1, 2, 5)).toBeCloseTo(3, 10);
  });

  it("replie aussi les positions antérieures au début", () => {
    expect(loopProgress(1, 2, 5)).toBeCloseTo(4, 10);
    expect(loopProgress(2 - 3, 2, 5)).toBeCloseTo(2, 10);
  });

  it("reste stable sur un intervalle nul ou inversé", () => {
    expect(loopProgress(2.5, 3, 3)).toBeCloseTo(3, 10);
    expect(loopProgress(4, 5, 2)).toBeCloseTo(4, 10);
    expect(loopProgress(99, 5, 2)).toBeCloseTo(3, 10);
    expect(loopProgress(Number.NaN, 2, 5)).toBeCloseTo(2, 10);
  });
});

describe("sortNotesByOnset", () => {
  it("trie par attaque puis par hauteur sans modifier la liste source", () => {
    const source = [
      makeNote({ id: "c", midi: 60, onsetBeats: 2 }),
      makeNote({ id: "a", midi: 67, onsetBeats: 0 }),
      makeNote({ id: "b", midi: 60, onsetBeats: 0 }),
    ];
    expect(sortNotesByOnset(source).map((note) => note.id)).toEqual(["b", "a", "c"]);
    expect(source.map((note) => note.id)).toEqual(["c", "a", "b"]);
  });
});

describe("cohérence du thème chromatique", () => {
  it("décrit bien les 12 classes de hauteur", () => {
    const classes = new Set(Array.from({ length: 24 }, (_, index) => pitchClassOf(60 + index)));
    expect(classes.size).toBe(CHROMATIC_PITCH_COUNT);
    expect(CHROMATIC_PITCH_COUNT).toBe(12);
  });
});
