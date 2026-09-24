// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { NoteEvent } from "../types";
import { buildLayout, computeRange, measureLabelAlpha, measureLinesVisible, beatLinesVisible } from "../practice/timeline";
import { FallingNotes, type FallingNotesProps } from "./FallingNotes";
import { boxOf, installCanvasDouble, installRafClock, type CanvasBox, type CanvasRecorder, type RafClock } from "./canvasTestDouble";

/**
 * Simulation du rendu du piano-roll : le contexte 2D est un enregistreur et la
 * boucle d’images est pilotée image par image. On vérifie ainsi ce que le
 * composant DESSINE réellement (géométrie du clavier, fenêtre du zoom, repères,
 * enfoncement des touches) sans navigateur ni canvas natif.
 */

/** Canvas de 800 px de large, 360 px de haut : clavier de 101 px, ligne de frappe à 257. */
const CANVAS_WIDTH_PX = 800;
const CANVAS_HEIGHT_PX = 360;
const WHITE_KEY_MIN_HEIGHT_PX = 80;

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

/** Une note grave (main gauche) et une note aiguë (main droite), 10 s plus tard. */
const PAIR: NoteEvent[] = [
  makeNote({ id: "bas", midi: 48, onsetBeats: 0, hand: "left" }),
  makeNote({ id: "haut", midi: 84, onsetBeats: 20, hand: "right" }),
];

const LEFT_INK = "#8b5cf6";
const RIGHT_INK = "#4fc3f7";
/** Couleur des séparateurs entre touches blanches (cf. FallingNotes). */
const WHITE_KEY_SEPARATOR = "#c9ced6";

let recorder: CanvasRecorder;
let clock: RafClock;
let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  recorder = installCanvasDouble(CANVAS_WIDTH_PX);
  clock = installRafClock();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
});

/** Monte le composant puis dessine une image. */
function mount(props: Partial<FallingNotesProps> & { notes: NoteEvent[] }): void {
  if (container) {
    throw new Error("un seul montage par test : démonter avant de remonter");
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const full: FallingNotesProps = {
    bpm: 120,
    tempoFactor: 1,
    currentTimeSec: 0,
    heightPx: CANVAS_HEIGHT_PX,
    ...props,
  };
  act(() => {
    root?.render(<FallingNotes {...full} />);
  });
  clock.step(2);
}

/* ------------------------------------------------------------------ */
/* Lecture des traces                                                 */
/* ------------------------------------------------------------------ */

/** Séparateurs entre touches blanches : 1 px de large, style dédié. */
function separators(): number[] {
  return recorder.fills.filter((fill) => fill.style === WHITE_KEY_SEPARATOR).map((fill) => fill.x);
}

/** Ligne de frappe cyan (2 px) : donne aussi `hitLineY`. */
function hitLineY(): number {
  const line = recorder.fills.find((fill) => fill.style === "rgba(79, 195, 247, 0.35)");
  if (!line) throw new Error("ligne de frappe absente");
  return line.y + 1;
}

/**
 * Touches blanches dessinées (corps arrondi sous la ligne de frappe).
 * Le filtre de largeur écarte les touches NOIRES : depuis le clavier
 * proportionnel (aspect 5,8), une noire dépasse la hauteur plancher du harnais
 * et serait comptée à tort comme une blanche.
 */
function whiteKeyBoxes(): CanvasBox[] {
  const top = hitLineY() + 2;
  const marks = separators();
  const steps = marks.slice(1).map((x, index) => x - marks[index]);
  const keyWidth = steps.length ? steps.reduce((sum, step) => sum + step, 0) / steps.length : Number.NaN;
  const seen = new Set<string>();
  const boxes: CanvasBox[] = [];
  for (const path of recorder.paths) {
    if (path.kind !== "fill" || path.points.length < 12) continue;
    const box = boxOf(path.points);
    if (!box) continue;
    if (box.y < top - 1 || box.h < WHITE_KEY_MIN_HEIGHT_PX) continue;
    // Une blanche occupe ~toute sa case ; une noire fait ~56 % de sa largeur.
    if (Number.isFinite(keyWidth) && Math.abs(box.w - (keyWidth - 1)) > 2) continue;
    const key = `${box.x.toFixed(2)}|${box.h.toFixed(2)}`;
    if (seen.has(key)) continue; // halo et corps d’une touche active : même cadre
    seen.add(key);
    boxes.push(box);
  }
  return boxes.sort((a, b) => a.x - b.x);
}

/** Notes réellement dessinées : les capsules, repérées par la couleur de la main. */
function drawnNotes(): string[] {
  return recorder.paths.filter((path) => path.style === LEFT_INK || path.style === RIGHT_INK).map((path) => path.style);
}

/** Lignes d’un style donné, hauteur 1 px sur toute la largeur. */
function horizontalLines(style: string): number[] {
  return recorder.fills.filter((fill) => fill.style === style && fill.h === 1 && fill.w === CANVAS_WIDTH_PX).map((fill) => fill.y);
}

describe("FallingNotes — clavier dessiné", () => {
  it("couvre toute la plage du morceau au zoom ×1", () => {
    mount({ notes: PAIR, currentTimeSec: 0, zoomLevel: 1 });

    const range = computeRange(PAIR);
    const layout = buildLayout(range);
    const marks = separators();
    expect(range).toEqual({ min: 36, max: 96 });
    expect(marks).toHaveLength(layout.whiteCount - 1);

    // Une touche blanche = 800 / 36 px, la première centrée sur sa colonne.
    const keyWidth = CANVAS_WIDTH_PX / layout.whiteCount;
    expect(keyWidth).toBeCloseTo(22.22, 1);
    expect(Math.abs(marks[0] - keyWidth)).toBeLessThan(2);
    expect(Math.abs((marks.at(-1) ?? 0) - (CANVAS_WIDTH_PX - keyWidth))).toBeLessThan(2);
    expect(whiteKeyBoxes()).toHaveLength(layout.whiteCount);
  });

  it("réduit la fenêtre au zoom ×3 et l’élargit au prorata", () => {
    mount({ notes: PAIR, currentTimeSec: 0, zoomLevel: 3 });

    // Fenêtre [38, 58] : 12 demi-tons, soit 12 blanches et 11 séparateurs.
    const marks = separators();
    expect(marks).toHaveLength(11);
    expect(whiteKeyBoxes()).toHaveLength(12);
    // Les séparateurs sont arrondis au pixel : leur pas vaut 66 ou 67 px.
    const keyWidth = CANVAS_WIDTH_PX / 12;
    for (let index = 1; index < marks.length; index += 1) {
      expect(Math.abs(marks[index] - marks[index - 1] - keyWidth)).toBeLessThan(1.5);
    }
  });

  it("suit la note jouée : la fenêtre se déplace avec le focus", () => {
    mount({ notes: PAIR, currentTimeSec: 0, zoomLevel: 3 });
    expect(drawnNotes()).toEqual([LEFT_INK]);

    act(() => {
      root?.unmount();
    });
    root = null;
    container?.remove();
    container = null;

    // À 10 s, la note aiguë (main droite) entre dans la fenêtre : le clavier a
    // suivi, et la note grave sortie du champ n’est plus dessinée.
    mount({ notes: PAIR, currentTimeSec: 10, zoomLevel: 3 });
    expect(drawnNotes()).toEqual([RIGHT_INK]);
    expect(whiteKeyBoxes()).toHaveLength(12);
  });

  it("écarte les notes hors de la fenêtre zoomée, jamais au zoom ×1", () => {
    mount({ notes: PAIR, currentTimeSec: 10, zoomLevel: 1 });
    // Au zoom ×1 la plage complète est visible : la note aiguë est dessinée.
    expect(drawnNotes()).toEqual([RIGHT_INK]);
    expect(separators()).toHaveLength(buildLayout(computeRange(PAIR)).whiteCount - 1);
  });

  it("enfonce de 3 px la touche attendue, et d’elle seule", () => {
    // À 5 s, aucune note n’est en cours : la seule touche active est celle demandée.
    mount({ notes: PAIR, currentTimeSec: 5, activeMidis: [60] });

    const heights = [...new Set(whiteKeyBoxes().map((box) => Number(box.h.toFixed(4))))].sort((a, b) => a - b);
    expect(heights).toHaveLength(2);
    expect(heights[1] - heights[0]).toBeCloseTo(3, 6);

    // La touche enfoncée est bien celle du Do4 demandé (le corps de la touche
    // fait 1 px de moins que sa colonne : tolérance de 1 px).
    const layout = buildLayout(computeRange(PAIR));
    const pressed = whiteKeyBoxes().find((box) => box.h === heights[0]);
    const center = (pressed?.x ?? 0) + (pressed?.w ?? 0) / 2;
    expect(Math.abs(center - layout.xRatioForMidi(60) * CANVAS_WIDTH_PX)).toBeLessThan(1);
  });

  it("enfonce la touche de la note en cours de jeu", () => {
    // À 0 s, la note grave (Do3, main gauche) vient d’être attaquée : sa touche
    // s’enfonce même sans consigne extérieure.
    mount({ notes: PAIR, currentTimeSec: 0 });

    const heights = [...new Set(whiteKeyBoxes().map((box) => Number(box.h.toFixed(4))))].sort((a, b) => a - b);
    expect(heights).toHaveLength(2);
    expect(heights[1] - heights[0]).toBeCloseTo(3, 6);

    const layout = buildLayout(computeRange(PAIR));
    const pressed = whiteKeyBoxes().find((box) => box.h === heights[0]);
    const center = (pressed?.x ?? 0) + (pressed?.w ?? 0) / 2;
    expect(Math.abs(center - layout.xRatioForMidi(48) * CANVAS_WIDTH_PX)).toBeLessThan(1);
  });

  it("laisse toutes les touches au même niveau hors note active", () => {
    mount({ notes: PAIR, currentTimeSec: 5 });
    const heights = [...new Set(whiteKeyBoxes().map((box) => Number(box.h.toFixed(4))))];
    expect(heights).toHaveLength(1);
  });
});

describe("FallingNotes — repères de mesure", () => {
  const MEASURE_LINE = "rgba(255, 255, 255, 0.10)";
  const BEAT_LINE = "rgba(255, 255, 255, 0.045)";

  it("dessine une ligne et son numéro à chaque début de mesure visible", () => {
    mount({ notes: PAIR, currentTimeSec: 1.5, showMeasureLines: true, measureCount: 8 });

    const top = hitLineY();
    const expected = measureLinesVisible(1.5, {
      bpm: 120,
      tempoFactor: 1,
      pxPerSec: Math.max(48, top / 1.8),
      hitLineY: top,
      beatsPerMeasure: 4,
      measureCount: 8,
    });
    expect(expected).toHaveLength(1);
    expect(expected[0].measure).toBe(2);

    const drawn = horizontalLines(MEASURE_LINE);
    expect(drawn).toEqual(expected.map((line) => Math.round(line.yPx)));

    // Le numéro est écrit juste au-dessus de sa ligne, estompé par la distance.
    const labels = recorder.texts.filter((text) => /^\d+$/.test(text.text));
    expect(labels).toHaveLength(1);
    expect(labels[0].text).toBe("2");
    expect(labels[0].y).toBeCloseTo(expected[0].yPx - 2, 6);
    expect(labels[0].x).toBe(5);
    expect(labels[0].alpha).toBeCloseTo(measureLabelAlpha(expected[0].yPx, top), 6);
  });

  it("estompe les numéros avec la distance à la ligne de frappe", () => {
    // À 240 BPM, une mesure dure 1 s : deux repères tiennent dans la scène, et
    // celui du bas doit être plus lisible que celui du haut.
    mount({ notes: PAIR, currentTimeSec: 1.5, bpm: 240, showMeasureLines: true, measureCount: 8 });

    const top = hitLineY();
    const expected = measureLinesVisible(1.5, {
      bpm: 240,
      tempoFactor: 1,
      pxPerSec: Math.max(48, top / 1.8),
      hitLineY: top,
      beatsPerMeasure: 4,
      measureCount: 8,
    });
    const labels = recorder.texts.filter((text) => /^\d+$/.test(text.text));
    expect(expected.length).toBeGreaterThanOrEqual(2);
    expect(labels).toHaveLength(expected.length);

    const alphas = labels.map((label) => label.alpha);
    expect(alphas).toEqual([...alphas].sort((a, b) => b - a));
    expect(alphas[0]).toBeGreaterThan(alphas.at(-1) ?? 0);
  });

  it("n’affiche rien quand les repères sont masqués", () => {
    mount({ notes: PAIR, currentTimeSec: 1.5, showMeasureLines: false });
    expect(horizontalLines(MEASURE_LINE)).toEqual([]);
    expect(recorder.texts.filter((text) => /^\d+$/.test(text.text))).toEqual([]);
  });

  it("ajoute les lignes de temps, plus discrètes, quand l’option est active", () => {
    mount({ notes: PAIR, currentTimeSec: 1.5, showMeasureLines: true, showBeatLines: true, measureCount: 8 });

    const top = hitLineY();
    const expected = beatLinesVisible(1.5, {
      bpm: 120,
      tempoFactor: 1,
      pxPerSec: Math.max(48, top / 1.8),
      hitLineY: top,
      beatsPerMeasure: 4,
      measureCount: 8,
    });
    const drawn = horizontalLines(BEAT_LINE);
    expect(drawn).toHaveLength(expected.length);
    expect(drawn.length).toBeGreaterThan(horizontalLines(MEASURE_LINE).length);
    // Chaque repère de mesure coïncide avec un repère de temps (le début du temps 1).
    for (const line of horizontalLines(MEASURE_LINE)) {
      expect(drawn).toContain(line);
    }
  });

  it("suit le facteur de tempo et l’horloge", () => {
    mount({ notes: PAIR, currentTimeSec: 0, tempoFactor: 0.5, showMeasureLines: true, measureCount: 8 });

    const top = hitLineY();
    const expected = measureLinesVisible(0, {
      bpm: 120,
      tempoFactor: 0.5,
      pxPerSec: Math.max(48, top / 1.8),
      hitLineY: top,
      beatsPerMeasure: 4,
      measureCount: 8,
    });
    expect(horizontalLines(MEASURE_LINE)).toEqual(expected.map((line) => Math.round(line.yPx)));
  });
});
