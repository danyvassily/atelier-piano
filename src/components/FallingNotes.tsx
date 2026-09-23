import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Hand, NoteEvent, NoteNaming } from "../types";
import { midiToDisplayName } from "../music/notes";
import {
  ACTIVE_NOTE_WINDOW_SEC,
  BLACK_KEY_WIDTH_RATIO,
  CHORD_WINDOW_SEC,
  DEFAULT_BEATS_PER_MEASURE,
  MIN_NOTE_HEIGHT_PX,
  MIN_ZOOM_SPAN_SEMITONES,
  ZOOM_FOCUS_PAD_SEMITONES,
  activeNotesAt,
  beatLinesVisible,
  beatsToSeconds,
  buildLayout,
  computeRange,
  computeViewRange,
  measureLabelAlpha,
  measureLinesVisible,
  sortNotesByOnset,
  upcomingNote,
  visibleNotes,
  type BeatLine,
  type KeyboardLayout,
  type MeasureLine,
  type MidiRange,
  type VisibleNote,
} from "../practice/timeline";

/**
 * Piano-roll « notes qui tombent » (type Synthesia) dessiné dans un seul canvas :
 * couloirs de fond, capsules qui descendent vers la ligne de frappe, puis clavier
 * réaliste (blanches, noires, sol) avec surlignage des touches attendues et
 * enfoncées.
 *
 * Identité visuelle : scène noire pure, notes cyan (main droite) et bleu (main
 * gauche) qui tombent en capsules, touches actives cerclées d’un halo cyan.
 * Le composant est purement présentatif : le parent fournit `currentTimeSec`
 * (horloge audio) et reçoit les appuis clavier via `onKeyPress`/`onKeyRelease`.
 */

/** Couleurs du rendu (le canvas ne peut pas lire les variables CSS du thème). */
const COLOR = {
  /** Fond de scène : noir pur, comme un piano dans le noir. */
  sky: "#000000",
  lane: "#050607",
  laneBlack: "rgba(0, 0, 0, 0.62)",
  separator: "#12161b",
  octave: "#1e242c",
  /** Ligne de frappe : un repère cyan discret, jamais un trait blanc criard. */
  hitLine: "rgba(79, 195, 247, 0.35)",
  hitGlow: "rgba(79, 195, 247, 0.22)",
  /** Repères de mesure : un trait blanc très discret, jamais un mur. */
  measureLine: "rgba(255, 255, 255, 0.10)",
  /** Repères de temps : encore plus discrets que les mesures. */
  beatLine: "rgba(255, 255, 255, 0.045)",
  /** Numéro de mesure : posé près de sa ligne, estompé par la distance. */
  measureLabel: "#e9eff6",
  /** Sol : bande sombre discrète sous le clavier. */
  floor: "#0a0c0f",
  whiteKeyTop: "#ffffff",
  whiteKeyMid: "#f4f5f7",
  whiteKeyBottom: "#e9ecf1",
  whiteKeySeparator: "#c9ced6",
  whiteKeyActiveTop: "#f4fbff",
  whiteKeyActiveMid: "#d9f0fc",
  whiteKeyActiveBottom: "#bee6fa",
  blackKeyTop: "#3a3f46",
  blackKeyMid: "#14171b",
  blackKeyBottom: "#06080a",
  blackKeyActiveTop: "#41647c",
  blackKeyActiveMid: "#1a4a64",
  blackKeyActiveBottom: "#0a2434",
  /** Halo cyan des touches actives (attendues ou enfoncées). */
  activeGlow: "#4fc3f7",
  activeTint: "rgba(79, 195, 247, 0.22)",
  activeTintStrong: "rgba(79, 195, 247, 0.34)",
  keyLabel: "#8a9099",
  blackKeyLabel: "#cfd4d0",
  noteInk: "#ffffff",
  noteSheen: "rgba(255, 255, 255, 0.55)",
  focusRing: "rgba(255, 255, 255, 0.92)",
  /** Mains : cyan pour la droite, bleu pour la gauche. */
  rightHand: "#4fc3f7",
  leftHand: "#2d6cdf",
} as const;

/** 12 couleurs chromatiques (une par classe de hauteur) pour le mode `colorByPitch`. */
const CHROMATIC_COLORS = [
  "#e5484d",
  "#f2702b",
  "#f5a623",
  "#d8c02a",
  "#8fc93a",
  "#35c46b",
  "#25c2b0",
  "#2aa7d8",
  "#4a7df0",
  "#7a5cf0",
  "#b45cf0",
  "#e0559f",
] as const;

const DEFAULT_HEIGHT_PX = 360;
const MIN_CANVAS_HEIGHT_PX = 120;
const KEYBOARD_HEIGHT_RATIO = 0.28;
const MIN_KEYBOARD_HEIGHT_PX = 56;
const MAX_KEYBOARD_HEIGHT_PX = 132;
const MIN_PLAYFIELD_PX = 110;
/** Longueur d’une touche noire, en fraction de la hauteur du clavier (~62 %). */
const BLACK_KEY_HEIGHT_RATIO = 0.62;
const HIT_LINE_GAP_PX = 2;
/** Bande de sol laissée sous les touches, en pixels. */
const FLOOR_BAND_PX = 4;
/** Enfoncement visuel d’une touche attendue (mais pas encore enfoncée), en pixels. */
const KEY_SINK_PX = 3;
/** Enfoncement visuel d’une touche réellement enfoncée, en pixels. */
const KEY_SINK_PRESSED_PX = 4;
/** Rayon des coins bas d’une touche noire, et des coins des touches blanches. */
const BLACK_KEY_RADIUS_PX = 3;
const WHITE_KEY_RADIUS_PX = 4;
/** Hauteur du bandeau brillant (gloss) d’une touche noire, en fraction de sa longueur. */
const BLACK_KEY_GLOSS_RATIO = 0.45;
/** Bande d’ombre portée d’une touche noire sur les blanches, en pixels. */
const BLACK_KEY_SHADOW_PX = 20;
/** Épaisseur de la ligne spéculaire au bord supérieur d’une touche noire. */
const BLACK_KEY_SPECULAR_PX = 1;
/** Micro-biseaux latéraux d’une touche noire : l’épaisseur de la touche, en pixels. */
const BLACK_KEY_BEVEL_PX = 1;
/** Reflet vertical d’une touche noire : largeur et hauteur, en fractions de la touche. */
const BLACK_KEY_STREAK_WIDTH_RATIO = 0.32;
const BLACK_KEY_STREAK_HEIGHT_RATIO = 0.66;
/** Reflet vertical d’une touche blanche : hauteur, en fraction de la touche. */
const WHITE_KEY_SHEEN_HEIGHT_RATIO = 0.3;
/** Biseau latéral d’une touche blanche : flancs gauche et droit, en pixels. */
const WHITE_KEY_BEVEL_PX = 2;
/** Bande avant (épaisseur de la touche) au bas d’une touche blanche, en pixels. */
const WHITE_KEY_FRONT_PX = 6;
/** Ombre de pose au bas d’une touche blanche, en pixels. */
const KEY_LANDING_SHADOW_PX = 18;
/** Épaisseur de la ligne de frappe, en pixels. */
const HIT_LINE_THICKNESS_PX = 2;
/** Police des numéros de mesure, en pixels (petite mais lisible). */
const MEASURE_LABEL_FONT_PX = 10;
/** Marge des numéros de mesure depuis le bord gauche de la scène, en pixels. */
const MEASURE_LABEL_MARGIN_PX = 5;
/** Cible tactile minimale : sur iPad, une touche étroite reste attrapable. */
const MIN_TOUCH_TARGET_PX = 24;
/** Durée de chute d’une note du haut du canvas jusqu’à la ligne de frappe. */
const FALL_SECONDS = 1.8;
/** Avance du zoom sur les notes à venir, en secondes (le temps d’une chute). */
const ZOOM_LOOKAHEAD_SEC = 1.6;
/** Constante de temps du recentrage du zoom, en secondes (auto-pan doux). */
const ZOOM_PAN_TAU_SEC = 0.35;
/** Écart (demi-tons) en dessous duquel le zoom est considéré comme arrivé. */
const ZOOM_PAN_EPSILON = 0.35;
/** Facteur d’échelle maximal (mémoire des canvas sur iPad). */
const MAX_DEVICE_PIXEL_RATIO = 3;
/** Épaisseur du liseré clair en haut d’une note, en pixels. */
const NOTE_SHEEN_PX = 2;
/** Rayon du halo doux autour d’une capsule, en pixels. */
const NOTE_GLOW_BLUR_PX = 16;

/** Tableau vide partagé : évite de recréer une dépendance de mémo à chaque rendu. */
const NO_MIDIS: number[] = [];

export interface FallingNotesProps {
  /** Notes de la partition (attaques en temps). */
  notes: NoteEvent[];
  /** Tempo nominal de la partition, en BPM. */
  bpm: number;
  /** Facteur de tempo appliqué (0.35 → 1.1 dans l’atelier ; 1 par défaut). */
  tempoFactor?: number;
  /** Position de lecture en secondes (l’horloge est fournie par le parent). */
  currentTimeSec: number;
  /** Main affichée ; « both » montre les deux mains. */
  hand?: Hand;
  /** Langue des noms de notes : Do Ré Mi ou C D E. */
  naming?: NoteNaming;
  /** Colorie les notes par classe de hauteur (thème Synthesia) au lieu de la main. */
  colorByPitch?: boolean;
  /** Affiche le nom de chaque note dans son rectangle quand la place le permet. */
  showNoteNames?: boolean;
  /** Notes attendues : touches surlignées sur le clavier intégré. */
  activeMidis?: number[];
  /** Touches enfoncées par l’utilisateur : touches remplies. */
  pressedMidis?: number[];
  /** Appelé quand l’utilisateur appuie sur une touche du clavier intégré. */
  onKeyPress?: (midi: number) => void;
  /** Appelé quand l’utilisateur relâche une touche. */
  onKeyRelease?: (midi: number) => void;
  /** Hauteur du canvas en pixels CSS (360 par défaut). */
  heightPx?: number;
  /** Classe CSS appliquée au canvas. */
  className?: string;
  /**
   * Zoom des touches : 1 = clavier entier (défaut), jusqu’à 3 = fenêtre réduite
   * au tiers. Au-delà de 1, la fenêtre visible suit les notes en cours et à venir.
   */
  zoomLevel?: number;
  /** Nombre de temps (noires) par mesure, pour les repères (4 par défaut). */
  beatsPerMeasure?: number;
  /** Nombre de mesures du morceau : borne les repères (illimité par défaut). */
  measureCount?: number;
  /** Repères de mesure verticaux et leur numéro (activés par défaut). */
  showMeasureLines?: boolean;
  /** Repères de temps, encore plus discrets (désactivés par défaut). */
  showBeatLines?: boolean;
}

interface FrameGeometry {
  widthPx: number;
  heightPx: number;
  keyboardTopY: number;
  keyboardHeightPx: number;
  blackKeyHeightPx: number;
  whiteKeyWidthPx: number;
  blackKeyWidthPx: number;
  hitLineY: number;
}

interface FrameData {
  geometry: FrameGeometry;
  layout: KeyboardLayout;
  visible: VisibleNote[];
  expectedMidis: Set<number>;
  pressedMidis: Set<number>;
  activeNoteIds: Set<string>;
  naming: NoteNaming;
  showNoteNames: boolean;
  colorByPitch: boolean;
  /** Repères de mesure visibles (vide quand l’option est désactivée). */
  measureLines: MeasureLine[];
  /** Repères de temps visibles (vide quand l’option est désactivée). */
  beatLines: BeatLine[];
}

/**
 * Tout ce dont une image a besoin : React publie cette configuration, la boucle
 * de rendu en déduit la géométrie, la fenêtre du clavier (zoom) et les repères.
 * La fenêtre zoomée peut ainsi suivre les notes en douceur, image par image,
 * sans repasser par un rendu React.
 */
interface Scene {
  /** Notes pré-triées par attaque. */
  notes: NoteEvent[];
  bpm: number;
  tempoFactor: number;
  currentTimeSec: number;
  hand: Hand;
  widthPx: number;
  heightPx: number;
  /** Plage MIDI complète du morceau (vue ×1). */
  baseRange: MidiRange;
  /** Zoom demandé (1 = clavier entier). */
  zoom: number;
  /** Cluster de notes suivi par le zoom, élargi de ± 4 demi-tons. */
  focus: MidiRange | null;
  expectedMidis: Set<number>;
  pressedMidis: Set<number>;
  activeNoteIds: Set<string>;
  naming: NoteNaming;
  showNoteNames: boolean;
  colorByPitch: boolean;
  beatsPerMeasure: number;
  measureCount: number;
  showMeasureLines: boolean;
  showBeatLines: boolean;
}

/** Tableaux vides partagés : aucun repère à dessiner. */
const NO_MEASURE_LINES: MeasureLine[] = [];
const NO_BEAT_LINES: BeatLine[] = [];

/** Géométrie verticale du canvas : zone de chute en haut, clavier en bas. */
function computeGeometry(widthPx: number, heightPx: number, layout: KeyboardLayout): FrameGeometry {
  const safeWidth = Math.max(0, widthPx);
  const safeHeight = Math.max(MIN_CANVAS_HEIGHT_PX, heightPx);
  const keyboardHeightPx = Math.max(
    MIN_KEYBOARD_HEIGHT_PX,
    Math.min(Math.round(safeHeight * KEYBOARD_HEIGHT_RATIO), safeHeight - MIN_PLAYFIELD_PX, MAX_KEYBOARD_HEIGHT_PX),
  );
  const keyboardTopY = safeHeight - keyboardHeightPx;
  const whiteKeyWidthPx = layout.whiteCount > 0 ? safeWidth / layout.whiteCount : safeWidth;
  return {
    widthPx: safeWidth,
    heightPx: safeHeight,
    keyboardTopY,
    keyboardHeightPx,
    blackKeyHeightPx: Math.round(keyboardHeightPx * BLACK_KEY_HEIGHT_RATIO),
    whiteKeyWidthPx,
    blackKeyWidthPx: whiteKeyWidthPx * BLACK_KEY_WIDTH_RATIO,
    hitLineY: Math.max(0, keyboardTopY - HIT_LINE_GAP_PX),
  };
}

/** Centre MIDI visé par le zoom (milieu du cluster suivi), ou `null` sans focus. */
function focusCenterOf(focus: MidiRange | null): number | null {
  if (!focus) return null;
  return (focus.min + focus.max) / 2;
}

/**
 * Résout une image à dessiner : fenêtre MIDI (zoom), clavier, notes visibles et
 * repères de mesure. Au zoom ×1, la fenêtre `computeViewRange` renvoie la plage
 * de base : le rendu est exactement celui d’avant le zoom.
 */
function resolveFrame(scene: Scene, focusCenter: number | null): FrameData {
  const viewRange = computeViewRange(scene.baseRange, scene.zoom, focusCenter, MIN_ZOOM_SPAN_SEMITONES);
  const layout = buildLayout(viewRange);
  const geometry = computeGeometry(scene.widthPx, scene.heightPx, layout);
  const pxPerSec = Math.max(48, geometry.hitLineY / FALL_SECONDS);
  let visible = visibleNotes(scene.notes, scene.currentTimeSec, {
    bpm: scene.bpm,
    tempoFactor: scene.tempoFactor,
    pxPerSec,
    hitLineY: geometry.hitLineY,
    layout,
    widthPx: geometry.widthPx,
    hand: scene.hand,
    minHeightPx: MIN_NOTE_HEIGHT_PX,
    sorted: true,
  });
  // Zoom : une note hors de la fenêtre n’a plus de touche à l’écran, elle est
  // donc écartée (au zoom ×1 la fenêtre couvre tout le morceau : rien ne bouge).
  if (scene.zoom > 1) {
    visible = visible.filter(({ note }) => note.midi >= viewRange.min && note.midi <= viewRange.max);
  }
  const markerOptions = {
    bpm: scene.bpm,
    tempoFactor: scene.tempoFactor,
    pxPerSec,
    hitLineY: geometry.hitLineY,
    beatsPerMeasure: scene.beatsPerMeasure,
    measureCount: scene.measureCount,
  };
  return {
    geometry,
    layout,
    visible,
    expectedMidis: scene.expectedMidis,
    pressedMidis: scene.pressedMidis,
    activeNoteIds: scene.activeNoteIds,
    naming: scene.naming,
    showNoteNames: scene.showNoteNames,
    colorByPitch: scene.colorByPitch,
    measureLines: scene.showMeasureLines ? measureLinesVisible(scene.currentTimeSec, markerOptions) : NO_MEASURE_LINES,
    beatLines: scene.showBeatLines ? beatLinesVisible(scene.currentTimeSec, markerOptions) : NO_BEAT_LINES,
  };
}

/**
 * Recentrage progressif du zoom : le centre visé (cluster des notes en cours et
 * à venir) est rejoint en douceur, image par image. Rend `true` tant que la
 * fenêtre bouge, pour que la boucle de rendu continue de redessiner — au zoom
 * ×1 et hors lecture, rien ne bouge et la boucle reste au repos.
 */
function advanceFocus(
  scene: Scene | null,
  nowMs: number,
  focusRef: { current: number | null },
  lastTickRef: { current: number },
): boolean {
  const previous = lastTickRef.current;
  lastTickRef.current = nowMs;
  if (!scene) return false;
  const target = focusCenterOf(scene.focus);
  if (scene.zoom <= 1 || target === null) {
    focusRef.current = target;
    return false;
  }
  const current = focusRef.current;
  if (current === null) {
    focusRef.current = target;
    return true;
  }
  const delta = target - current;
  if (Math.abs(delta) <= ZOOM_PAN_EPSILON) {
    focusRef.current = target;
    return false;
  }
  const dt = Math.min(0.25, Math.max(0, (nowMs - previous) / 1000));
  focusRef.current = current + delta * (1 - Math.exp(-dt / ZOOM_PAN_TAU_SEC));
  return true;
}

/** Couleur d’une note : main droite cyan, main gauche bleu, ou roue chromatique. */
function colorForNote(note: NoteEvent, colorByPitch: boolean): string {
  if (colorByPitch) return CHROMATIC_COLORS[((note.midi % 12) + 12) % 12];
  return note.hand === "left" ? COLOR.leftHand : COLOR.rightHand;
}

/**
 * Éclaircit (facteur > 0) ou assombrit (facteur < 0) une couleur #rrggbb : les
 * dégradés des notes sont dérivés de leur couleur pour rester lisibles dans les
 * deux modes de coloriage.
 */
function shadeColor(hexColor: string, factor: number): string {
  const hex = hexColor.trim().replace("#", "");
  if (hex.length !== 6) return hexColor;
  const value = Number.parseInt(hex, 16);
  if (!Number.isFinite(value)) return hexColor;
  const ratio = Math.min(1, Math.abs(factor));
  const target = factor >= 0 ? 255 : 0;
  const channel = (shift: number) => {
    const base = (value >> shift) & 255;
    return Math.round(base + (target - base) * ratio);
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

/** Rectangle arrondi, avec un rayon distinct pour les coins haut et bas. */
function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radiusTop: number,
  radiusBottom = radiusTop,
) {
  if (!(w > 0) || !(h > 0)) return;
  const top = Math.max(0, Math.min(radiusTop, w / 2, h / 2));
  const bottom = Math.max(0, Math.min(radiusBottom, w / 2, h / 2));
  context.beginPath();
  context.moveTo(x + top, y);
  context.lineTo(x + w - top, y);
  context.arcTo(x + w, y, x + w, y + top, top);
  context.lineTo(x + w, y + h - bottom);
  context.arcTo(x + w, y + h, x + w - bottom, y + h, bottom);
  context.lineTo(x + bottom, y + h);
  context.arcTo(x, y + h, x, y + h - bottom, bottom);
  context.lineTo(x, y + top);
  context.arcTo(x, y, x + top, y, top);
  context.closePath();
}

/** Couloirs de fond : une colonne par touche blanche, assombrie sous les noires. */
function drawLanes(context: CanvasRenderingContext2D, frame: FrameData) {
  const { geometry, layout } = frame;
  const { widthPx, hitLineY, whiteKeyWidthPx, blackKeyWidthPx } = geometry;
  if (!(widthPx > 0) || !(hitLineY > 0)) return;
  context.fillStyle = COLOR.lane;
  context.fillRect(0, 0, widthPx, hitLineY);
  context.fillStyle = COLOR.laneBlack;
  for (const midi of layout.blackMidis) {
    const x = layout.xRatioForMidi(midi) * widthPx - blackKeyWidthPx / 2;
    context.fillRect(x, 0, blackKeyWidthPx, hitLineY);
  }
  layout.whiteMidis.forEach((midi, index) => {
    context.fillStyle = midi % 12 === 0 ? COLOR.octave : COLOR.separator;
    context.fillRect(Math.round(index * whiteKeyWidthPx), 0, 1, hitLineY);
  });
}

/**
 * Repères de mesure : un trait vertical discret à chaque début de mesure, son
 * numéro posé juste au-dessus, et — quand l’option est active — un trait encore
 * plus ténu à chaque temps. Le numéro s’estompe avec la distance à la ligne de
 * frappe : il guide l’œil sans envahir la scène. Tout est dessiné AVANT les
 * notes, pour que les capsules restent toujours nettes.
 */
function drawMeasureMarks(context: CanvasRenderingContext2D, frame: FrameData) {
  const { widthPx, hitLineY } = frame.geometry;
  const { measureLines, beatLines } = frame;
  if (!(widthPx > 0) || !(hitLineY > 0) || (!measureLines.length && !beatLines.length)) return;
  context.save();
  context.beginPath();
  context.rect(0, 0, widthPx, hitLineY);
  context.clip();
  // Repères de temps : un trait nu, sans numéro.
  if (beatLines.length) {
    context.fillStyle = COLOR.beatLine;
    for (const line of beatLines) {
      context.fillRect(0, Math.round(line.yPx), widthPx, 1);
    }
  }
  // Repères de mesure : le trait, puis son numéro.
  if (measureLines.length) {
    context.fillStyle = COLOR.measureLine;
    for (const line of measureLines) {
      context.fillRect(0, Math.round(line.yPx), widthPx, 1);
    }
    context.font = `600 ${MEASURE_LABEL_FONT_PX}px "Avenir Next", system-ui, sans-serif`;
    context.textAlign = "left";
    context.textBaseline = "bottom";
    context.fillStyle = COLOR.measureLabel;
    for (const line of measureLines) {
      const alpha = measureLabelAlpha(line.yPx, hitLineY);
      if (alpha <= 0.05) continue;
      context.globalAlpha = alpha;
      context.fillText(String(line.measure), MEASURE_LABEL_MARGIN_PX, line.yPx - 2);
    }
    context.globalAlpha = 1;
  }
  context.restore();
}

/**
 * Notes qui tombent : capsules aux coins très arrondis (rayon = demi-largeur),
 * dégradé vertical léger, halo doux autour et fin liseré clair en haut.
 */
function drawNotes(context: CanvasRenderingContext2D, frame: FrameData) {
  const { geometry } = frame;
  const { widthPx, hitLineY } = geometry;
  if (!(widthPx > 0) || !(hitLineY > 0)) return;
  context.save();
  context.beginPath();
  context.rect(0, 0, widthPx, hitLineY);
  context.clip();
  for (const { note, rect } of frame.visible) {
    const color = colorForNote(note, frame.colorByPitch);
    // Capsule : les flancs sont arrondis au maximum (rayon = demi-largeur).
    const radius = rect.wPx / 2;

    // Halo doux autour de la capsule.
    context.save();
    context.shadowColor = color;
    context.shadowBlur = NOTE_GLOW_BLUR_PX;
    context.fillStyle = color;
    roundedRectPath(context, rect.xPx, rect.yTopPx, rect.wPx, rect.hPx, radius);
    context.fill();
    context.restore();

    // Dégradé vertical léger, borné à la capsule.
    context.save();
    roundedRectPath(context, rect.xPx, rect.yTopPx, rect.wPx, rect.hPx, radius);
    context.clip();
    const body = context.createLinearGradient(0, rect.yTopPx, 0, rect.yTopPx + rect.hPx);
    body.addColorStop(0, shadeColor(color, 0.26));
    body.addColorStop(1, shadeColor(color, -0.24));
    context.fillStyle = body;
    context.fillRect(rect.xPx, rect.yTopPx, rect.wPx, rect.hPx);
    // Fin liseré clair en haut de la capsule.
    context.fillStyle = COLOR.noteSheen;
    context.fillRect(rect.xPx, rect.yTopPx, rect.wPx, Math.min(NOTE_SHEEN_PX, rect.hPx));
    context.restore();

    // Mode attente : la note attendue est cerclée pour rester lisible.
    if (frame.activeNoteIds.has(note.id)) {
      context.save();
      context.strokeStyle = COLOR.focusRing;
      context.lineWidth = 2;
      roundedRectPath(context, rect.xPx + 1, rect.yTopPx + 1, rect.wPx - 2, rect.hPx - 2, Math.max(0, radius - 1));
      context.stroke();
      context.restore();
    }

    if (frame.showNoteNames && rect.hPx >= 13 && rect.wPx >= 16) {
      context.save();
      context.fillStyle = COLOR.noteInk;
      context.shadowColor = "rgba(0, 0, 0, 0.55)";
      context.shadowBlur = 3;
      context.font = `600 ${Math.round(Math.min(11, Math.max(9, rect.wPx * 0.42)))}px "Avenir Next", system-ui, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(midiToDisplayName(note.midi, frame.naming), rect.xPx + rect.wPx / 2, rect.yTopPx + rect.hPx / 2, rect.wPx - 4);
      context.restore();
    }
  }
  context.restore();

  // Fondu du haut : les notes apparaissent en douceur au lieu de surgir.
  const fade = context.createLinearGradient(0, 0, 0, 28);
  fade.addColorStop(0, "rgba(0, 0, 0, 1)");
  fade.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = fade;
  context.fillRect(0, 0, widthPx, 28);
}

/**
 * Ligne de frappe : un repère cyan discret (2 px, 35 % d’opacité) posé juste
 * au-dessus du clavier, précédé d’une lueur douce qui indique la zone d’arrivée.
 */
function drawHitLine(context: CanvasRenderingContext2D, frame: FrameData) {
  const { widthPx, hitLineY } = frame.geometry;
  if (!(widthPx > 0)) return;
  const glow = context.createLinearGradient(0, Math.max(0, hitLineY - 26), 0, hitLineY);
  glow.addColorStop(0, "rgba(79, 195, 247, 0)");
  glow.addColorStop(1, COLOR.hitGlow);
  context.fillStyle = glow;
  context.fillRect(0, Math.max(0, hitLineY - 26), widthPx, Math.min(26, Math.max(0, hitLineY)));
  context.save();
  context.shadowColor = "rgba(79, 195, 247, 0.55)";
  context.shadowBlur = 8;
  context.fillStyle = COLOR.hitLine;
  context.fillRect(0, hitLineY - 1, widthPx, HIT_LINE_THICKNESS_PX);
  context.restore();
}

/** Étiquette d’une touche : on nomme les Do, et les autres touches si la place le permet. */
function keyLabelVisible(midi: number, keyWidthPx: number): boolean {
  return midi % 12 === 0 || keyWidthPx >= 30;
}

/**
 * Cache de dégradés valable UNE image : toutes les touches blanches partagent la
 * même géométrie verticale, donc le même dégradé de corps et d’ombre de pose.
 * Sans ce cache, le clavier recréerait ces objets à chaque rafraîchissement.
 */
class GradientPool {
  private readonly cache = new Map<string, CanvasGradient>();
  private readonly context: CanvasRenderingContext2D;

  constructor(context: CanvasRenderingContext2D) {
    this.context = context;
  }

  /** Dégradé associé à `key`, construit à la première demande de l’image. */
  get(key: string, build: (context: CanvasRenderingContext2D) => CanvasGradient): CanvasGradient {
    const cached = this.cache.get(key);
    if (cached) return cached;
    const created = build(this.context);
    this.cache.set(key, created);
    return created;
  }
}

/**
 * Touche blanche : dégradé renforcé (#FFFFFF → #F1F3F7 → #D9DEE8), fine ligne de
 * lumière en haut, reflet vertical sur la partie haute, biseaux latéraux (les
 * flancs se détachent du voisin), ombre de pose renforcée et bande avant plus
 * sombre (l’épaisseur de la touche, sous la surface).
 *
 * Une touche attendue se cerne de cyan et s’enfonce de trois pixels ; enfoncée,
 * elle s’enfonce un peu plus et se teinte plus franchement.
 */
function drawWhiteKey(
  context: CanvasRenderingContext2D,
  x: number,
  top: number,
  w: number,
  height: number,
  active: boolean,
  pressed: boolean,
  pool: GradientPool,
) {
  const bottom = top + height;
  const variant = active ? (pressed ? "pressed" : "active") : "idle";

  const body = pool.get(`wk-body|${variant}|${top}|${height}`, (ctx) => {
    const gradient = ctx.createLinearGradient(0, top, 0, bottom);
    gradient.addColorStop(0, active ? COLOR.whiteKeyActiveTop : COLOR.whiteKeyTop);
    gradient.addColorStop(0.08, active ? "#eef9ff" : "#fcfdff");
    gradient.addColorStop(0.52, active ? COLOR.whiteKeyActiveMid : COLOR.whiteKeyMid);
    gradient.addColorStop(0.86, active ? "#c6eafc" : "#e4e8ef");
    gradient.addColorStop(1, active ? COLOR.whiteKeyActiveBottom : COLOR.whiteKeyBottom);
    return gradient;
  });

  // Halo cyan pour une touche active ; la touche au repos, elle, n’a plus d’ombre
  // de canvas (l’ombre de pose est dessinée une fois pour tout le clavier).
  if (active) {
    context.save();
    context.shadowColor = COLOR.activeGlow;
    context.shadowBlur = pressed ? 24 : 18;
    context.fillStyle = body;
    roundedRectPath(context, x, top, w, height, WHITE_KEY_RADIUS_PX);
    context.fill();
    context.restore();
  } else {
    context.fillStyle = body;
    roundedRectPath(context, x, top, w, height, WHITE_KEY_RADIUS_PX);
    context.fill();
  }

  // Détails internes, bornés à la touche (les coins bas arrondis restent nets).
  context.save();
  roundedRectPath(context, x, top, w, height, WHITE_KEY_RADIUS_PX);
  context.clip();
  if (active) {
    context.fillStyle = pressed ? COLOR.activeTintStrong : COLOR.activeTint;
    context.fillRect(x, top, w, height);
  }
  // Reflet vertical : une colonne de lumière douce sur la partie haute. Le
  // dégradé est créé en coordonnées locales et posé après translation : toutes
  // les blanches partagent ainsi le même objet (aucune allocation par touche).
  const sheen = pool.get(`wk-sheen|${variant}|${w.toFixed(1)}`, (ctx) => {
    const gradient = ctx.createLinearGradient(w * 0.16, 0, w * 0.84, 0);
    gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
    gradient.addColorStop(0.42, active ? "rgba(255, 255, 255, 0.52)" : "rgba(255, 255, 255, 0.42)");
    gradient.addColorStop(0.64, "rgba(255, 255, 255, 0.16)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    return gradient;
  });
  context.save();
  context.translate(x, 0);
  context.fillStyle = sheen;
  context.fillRect(0, top + 1, w, Math.max(4, height * WHITE_KEY_SHEEN_HEIGHT_RATIO));
  context.restore();
  // Biseaux latéraux : un flanc sombre à l’extérieur, une amorce à l’intérieur.
  const bevel = Math.max(1, Math.min(WHITE_KEY_BEVEL_PX, w * 0.24));
  context.fillStyle = "rgba(0, 0, 0, 0.22)";
  context.fillRect(x, top + 1, bevel, height - 2);
  context.fillStyle = "rgba(0, 0, 0, 0.09)";
  context.fillRect(x + bevel, top + 1, bevel, height - 2);
  context.fillStyle = "rgba(0, 0, 0, 0.26)";
  context.fillRect(x + w - bevel, top + 1, bevel, height - 2);
  context.fillStyle = "rgba(0, 0, 0, 0.11)";
  context.fillRect(x + w - bevel * 2, top + 1, bevel, height - 2);
  // Ombre de pose : la touche s’assombrit en touchant le sol.
  const landing = pool.get(`wk-landing|${variant}|${bottom}`, (ctx) => {
    const gradient = ctx.createLinearGradient(0, bottom - KEY_LANDING_SHADOW_PX, 0, bottom);
    gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
    gradient.addColorStop(0.55, "rgba(0, 0, 0, 0.16)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0.4)");
    return gradient;
  });
  context.fillStyle = landing;
  context.fillRect(x, bottom - KEY_LANDING_SHADOW_PX, w, KEY_LANDING_SHADOW_PX);
  // Bande avant : l’épaisseur de la touche, nettement plus sombre que sa surface.
  const frontPx = Math.min(WHITE_KEY_FRONT_PX, Math.max(2, height * 0.12));
  const front = pool.get(`wk-front|${variant}|${bottom}|${frontPx.toFixed(1)}`, (ctx) => {
    const gradient = ctx.createLinearGradient(0, bottom - frontPx, 0, bottom);
    gradient.addColorStop(0, "rgba(0, 0, 0, 0.05)");
    gradient.addColorStop(0.45, "rgba(0, 0, 0, 0.22)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0.4)");
    return gradient;
  });
  context.fillStyle = front;
  context.fillRect(x, bottom - frontPx, w, frontPx);
  // Le chant avant renvoie un peu de lumière : la tranche de la touche existe.
  context.fillStyle = "rgba(255, 255, 255, 0.2)";
  context.fillRect(x + 1, bottom - 1, Math.max(1, w - 2), 1);
  // Fine ligne de lumière en haut, doublée d’un liseré de biseau.
  context.fillStyle = "rgba(255, 255, 255, 0.96)";
  context.fillRect(x, top, w, 1);
  context.fillStyle = active ? "rgba(255, 255, 255, 0.42)" : "rgba(255, 255, 255, 0.32)";
  context.fillRect(x, top + 1, w, 1);
  context.restore();
}

/**
 * Touche noire : dégradé #3A3F46 → #14171B → #06080A, reflet type verre NET sur
 * les 45 % supérieurs (limite franche), ligne spéculaire au bord haut, léger
 * streak vertical, micro-biseaux latéraux sombres et coins bas arrondis. Une
 * touche active s’entoure d’un halo cyan et s’enfonce.
 *
 * L’ombre portée sur les blanches est dessinée séparément, AVANT la touche :
 * c’est elle qui donne l’épaisseur du clavier.
 */
function drawBlackKeyShadow(context: CanvasRenderingContext2D, x: number, top: number, w: number) {
  const shadow = context.createLinearGradient(0, top, 0, top + BLACK_KEY_SHADOW_PX);
  shadow.addColorStop(0, "rgba(0, 0, 0, 0.58)");
  shadow.addColorStop(0.32, "rgba(0, 0, 0, 0.3)");
  shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = shadow;
  context.fillRect(x - 1.5, top, w + 3, BLACK_KEY_SHADOW_PX);
}

function drawBlackKey(
  context: CanvasRenderingContext2D,
  x: number,
  top: number,
  w: number,
  height: number,
  active: boolean,
  pressed: boolean,
  pool: GradientPool,
) {
  const bottom = top + height;
  const variant = active ? (pressed ? "pressed" : "active") : "idle";
  const body = pool.get(`bk-body|${variant}|${top}|${height}`, (ctx) => {
    const gradient = ctx.createLinearGradient(0, top, 0, bottom);
    gradient.addColorStop(0, active ? COLOR.blackKeyActiveTop : COLOR.blackKeyTop);
    gradient.addColorStop(0.34, active ? "#2d5872" : "#20252b");
    gradient.addColorStop(0.62, active ? COLOR.blackKeyActiveMid : COLOR.blackKeyMid);
    gradient.addColorStop(1, active ? COLOR.blackKeyActiveBottom : COLOR.blackKeyBottom);
    return gradient;
  });

  // Halo cyan quand la touche est active : elle se détache du clavier.
  if (active) {
    context.save();
    context.shadowColor = COLOR.activeGlow;
    context.shadowBlur = pressed ? 22 : 16;
    context.fillStyle = body;
    roundedRectPath(context, x, top, w, height, 0, BLACK_KEY_RADIUS_PX);
    context.fill();
    context.restore();
  } else {
    context.fillStyle = body;
    roundedRectPath(context, x, top, w, height, 0, BLACK_KEY_RADIUS_PX);
    context.fill();
  }

  context.save();
  roundedRectPath(context, x, top, w, height, 0, BLACK_KEY_RADIUS_PX);
  context.clip();
  if (active) {
    context.fillStyle = pressed ? COLOR.activeTintStrong : COLOR.activeTint;
    context.fillRect(x, top, w, height);
  }
  // Reflet type verre : 45 % de la touche, dégradé marqué, limite franche. Le
  // bandeau se termine par un trait sombre qui le rend net au lieu de diffus.
  const glossHeight = Math.max(4, height * BLACK_KEY_GLOSS_RATIO);
  const gloss = pool.get(`bk-gloss|${variant}|${top}|${height}`, (ctx) => {
    const gradient = ctx.createLinearGradient(0, top, 0, top + glossHeight);
    gradient.addColorStop(0, active ? "rgba(232, 250, 255, 0.58)" : "rgba(255, 255, 255, 0.52)");
    gradient.addColorStop(0.38, active ? "rgba(198, 236, 255, 0.26)" : "rgba(255, 255, 255, 0.24)");
    gradient.addColorStop(0.86, "rgba(255, 255, 255, 0.07)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0.01)");
    return gradient;
  });
  context.fillStyle = gloss;
  context.fillRect(x, top, w, glossHeight);
  // Limite du bandeau : elle rend le reflet net au lieu d’un halo diffus.
  context.fillStyle = "rgba(0, 0, 0, 0.46)";
  context.fillRect(x, top + glossHeight - 1, w, 1);
  // Léger streak vertical : une colonne de lumière le long de la touche, créée
  // en coordonnées locales pour être partagée par toutes les noires.
  const streakWidth = Math.max(2, w * BLACK_KEY_STREAK_WIDTH_RATIO);
  const streak = pool.get(`bk-streak|${variant}|${w.toFixed(1)}`, (ctx) => {
    const gradient = ctx.createLinearGradient(w * 0.5 - streakWidth / 2, 0, w * 0.5 + streakWidth / 2, 0);
    gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
    gradient.addColorStop(0.5, active ? "rgba(214, 243, 255, 0.3)" : "rgba(255, 255, 255, 0.22)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    return gradient;
  });
  context.save();
  context.translate(x, 0);
  context.fillStyle = streak;
  context.fillRect(w * 0.5 - streakWidth / 2, top + 1, streakWidth, Math.max(6, height * BLACK_KEY_STREAK_HEIGHT_RATIO));
  context.restore();
  // Micro-biseaux latéraux : les flancs de la touche, toujours dans l’ombre.
  context.fillStyle = "rgba(0, 0, 0, 0.42)";
  context.fillRect(x, top, BLACK_KEY_BEVEL_PX, height);
  context.fillStyle = "rgba(0, 0, 0, 0.55)";
  context.fillRect(x + w - BLACK_KEY_BEVEL_PX, top, BLACK_KEY_BEVEL_PX, height);
  // Fine ligne spéculaire au bord supérieur de la touche.
  context.fillStyle = active ? "rgba(240, 252, 255, 0.8)" : "rgba(255, 255, 255, 0.68)";
  context.fillRect(x, top, w, BLACK_KEY_SPECULAR_PX);
  context.restore();
}

/** Clavier intégré : sol, blanches séparées par un filet, puis noires par-dessus. */
function drawKeyboard(context: CanvasRenderingContext2D, frame: FrameData) {
  const { geometry, layout } = frame;
  const { widthPx, keyboardTopY, keyboardHeightPx, blackKeyHeightPx, whiteKeyWidthPx, blackKeyWidthPx } = geometry;
  if (!(widthPx > 0) || !(keyboardHeightPx > 0)) return;
  const pool = new GradientPool(context);
  context.save();
  context.beginPath();
  context.rect(0, keyboardTopY, widthPx, keyboardHeightPx);
  context.clip();

  // Sol : bande sombre discrète, sous les touches.
  context.fillStyle = COLOR.floor;
  context.fillRect(0, keyboardTopY, widthPx, keyboardHeightPx);
  const keyHeight = Math.max(6, keyboardHeightPx - FLOOR_BAND_PX);

  context.textAlign = "center";
  context.textBaseline = "alphabetic";

  // Touches blanches : dégradé, reflet vertical, ligne de lumière, ombre de pose.
  layout.whiteMidis.forEach((midi, index) => {
    const x = index * whiteKeyWidthPx;
    const pressed = frame.pressedMidis.has(midi);
    const active = pressed || frame.expectedMidis.has(midi);
    const sink = pressed ? KEY_SINK_PRESSED_PX : active ? KEY_SINK_PX : 0;
    const height = Math.max(6, keyHeight - sink);
    const width = Math.max(1, whiteKeyWidthPx - 1);
    drawWhiteKey(context, x, keyboardTopY, width, height, active, pressed, pool);
  });

  // Séparateurs fins entre les touches blanches.
  context.fillStyle = COLOR.whiteKeySeparator;
  for (let index = 1; index < layout.whiteMidis.length; index += 1) {
    context.fillRect(Math.round(index * whiteKeyWidthPx) - 0.5, keyboardTopY + 1, 1, keyHeight - 2);
  }

  // Ombre de pose du clavier entier : les touches reposent sur le sol. Dessinée
  // une seule fois, elle remplace l’ombre de canvas de chaque touche (coûteuse).
  const restingBottom = keyboardTopY + keyHeight;
  const keyboardBottom = keyboardTopY + keyboardHeightPx;
  const poseTop = Math.max(keyboardTopY, restingBottom - 11);
  const poseShadow = context.createLinearGradient(0, poseTop, 0, keyboardBottom);
  poseShadow.addColorStop(0, "rgba(0, 0, 0, 0)");
  poseShadow.addColorStop(0.62, "rgba(0, 0, 0, 0.46)");
  poseShadow.addColorStop(1, "rgba(0, 0, 0, 0.76)");
  context.fillStyle = poseShadow;
  context.fillRect(0, poseTop, widthPx, Math.max(0, keyboardBottom - poseTop));

  // Noms des touches : uniquement quand le toggle « Noms » est actif.
  if (frame.showNoteNames) {
    context.font = `700 ${Math.round(Math.min(11, Math.max(8, whiteKeyWidthPx * 0.34)))}px "Avenir Next", system-ui, sans-serif`;
    layout.whiteMidis.forEach((midi, index) => {
      if (!keyLabelVisible(midi, whiteKeyWidthPx) || whiteKeyWidthPx < MIN_TOUCH_TARGET_PX) return;
      context.fillStyle = COLOR.keyLabel;
      context.fillText(
        midiToDisplayName(midi, frame.naming),
        index * whiteKeyWidthPx + whiteKeyWidthPx / 2,
        keyboardTopY + keyHeight - 5,
        Math.max(8, whiteKeyWidthPx - 6),
      );
    });
  }

  // Touches noires : plus courtes, posées sur les blanches, ombre portée comprise.
  for (const midi of layout.blackMidis) {
    const pressed = frame.pressedMidis.has(midi);
    const active = pressed || frame.expectedMidis.has(midi);
    const sink = pressed ? KEY_SINK_PRESSED_PX : active ? KEY_SINK_PX : 0;
    const height = Math.max(6, blackKeyHeightPx - sink);
    const x = layout.xRatioForMidi(midi) * widthPx - blackKeyWidthPx / 2;
    drawBlackKeyShadow(context, x, keyboardTopY + height, blackKeyWidthPx);
    drawBlackKey(context, x, keyboardTopY, blackKeyWidthPx, height, active, pressed, pool);
    if (frame.showNoteNames && keyLabelVisible(midi, blackKeyWidthPx) && blackKeyWidthPx >= 20) {
      context.fillStyle = COLOR.blackKeyLabel;
      context.font = `600 ${Math.round(Math.min(10, Math.max(8, blackKeyWidthPx * 0.42)))}px "Avenir Next", system-ui, sans-serif`;
      context.fillText(
        midiToDisplayName(midi, frame.naming),
        x + blackKeyWidthPx / 2,
        keyboardTopY + height - 5,
        Math.max(8, blackKeyWidthPx - 2),
      );
    }
  }
  context.restore();
}

/** Rendu complet d’une image. */
function drawFrame(context: CanvasRenderingContext2D, frame: FrameData) {
  context.clearRect(0, 0, frame.geometry.widthPx, frame.geometry.heightPx);
  context.fillStyle = COLOR.sky;
  context.fillRect(0, 0, frame.geometry.widthPx, frame.geometry.heightPx);
  drawLanes(context, frame);
  // Repères de mesure sous les notes : la scène reste lisible avant tout.
  drawMeasureMarks(context, frame);
  drawNotes(context, frame);
  drawHitLine(context, frame);
  drawKeyboard(context, frame);
}

/**
 * Touche sous un point du canvas (ou `undefined` en dehors du clavier).
 * Les zones tactiles sont élargies à `MIN_TOUCH_TARGET_PX` : sur iPad, une
 * touche noire fine reste jouable même quand le clavier est large.
 */
function midiAtPoint(x: number, y: number, geometry: FrameGeometry, layout: KeyboardLayout): number | undefined {
  if (!(geometry.widthPx > 0) || layout.whiteCount === 0) return undefined;
  const relativeY = y - geometry.keyboardTopY;
  if (relativeY < 0 || relativeY > geometry.keyboardHeightPx) return undefined;
  if (relativeY <= geometry.blackKeyHeightPx) {
    const tolerance = Math.max(geometry.blackKeyWidthPx / 2, MIN_TOUCH_TARGET_PX / 2);
    let bestMidi: number | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const midi of layout.blackMidis) {
      const distance = Math.abs(x - layout.xRatioForMidi(midi) * geometry.widthPx);
      if (distance <= tolerance && distance < bestDistance) {
        bestMidi = midi;
        bestDistance = distance;
      }
    }
    if (bestMidi !== undefined) return bestMidi;
  }
  const index = Math.min(layout.whiteCount - 1, Math.max(0, Math.floor(x / geometry.whiteKeyWidthPx)));
  return layout.whiteMidis[index];
}

export function FallingNotes({
  notes,
  bpm,
  tempoFactor = 1,
  currentTimeSec,
  hand = "both",
  naming = "french",
  colorByPitch = false,
  showNoteNames = false,
  activeMidis = NO_MIDIS,
  pressedMidis = NO_MIDIS,
  onKeyPress,
  onKeyRelease,
  heightPx = DEFAULT_HEIGHT_PX,
  className,
  zoomLevel = 1,
  beatsPerMeasure = DEFAULT_BEATS_PER_MEASURE,
  measureCount,
  showMeasureLines = true,
  showBeatLines = false,
}: FallingNotesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Dernière image dessinée : c’est elle que lisent les interactions. */
  const frameRef = useRef<FrameData | null>(null);
  /** Configuration publiée par React, lue par la boucle de rendu. */
  const sceneRef = useRef<Scene | null>(null);
  const dirtyRef = useRef(true);
  const dprRef = useRef(1);
  /** Centre MIDI de la fenêtre zoomée, animé image par image (auto-pan). */
  const focusRef = useRef<number | null>(null);
  /** Horodatage de l’image précédente, pour l’inertie du recentrage. */
  const lastTickRef = useRef(0);
  /** Touches enfoncées par pointeur : pointeur → hauteur MIDI. */
  const pointerKeysRef = useRef(new Map<number, number>());
  const onKeyReleaseRef = useRef(onKeyRelease);
  const [localPressed, setLocalPressed] = useState<number[]>([]);
  const [widthPx, setWidthPx] = useState(0);
  const canvasHeightPx = Math.max(MIN_CANVAS_HEIGHT_PX, Math.round(heightPx));

  useEffect(() => {
    onKeyReleaseRef.current = onKeyRelease;
  }, [onKeyRelease]);

  // Largeur suivie par ResizeObserver (repli sur `resize` si indisponible).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const update = () => setWidthPx(Math.round(canvas.clientWidth));
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // Tampon du canvas ajusté au facteur d’échelle de l’écran (net sur iPad).
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(MAX_DEVICE_PIXEL_RATIO, Math.max(1, window.devicePixelRatio || 1));
    dprRef.current = ratio;
    const nextWidth = Math.max(1, Math.round(widthPx * ratio));
    const nextHeight = Math.max(1, Math.round(canvasHeightPx * ratio));
    if (canvas.width !== nextWidth) canvas.width = nextWidth;
    if (canvas.height !== nextHeight) canvas.height = nextHeight;
    canvas.style.width = "100%";
    canvas.style.height = `${canvasHeightPx}px`;
    dirtyRef.current = true;
  }, [widthPx, canvasHeightPx]);

  // Pré-tri unique par attaque : les images suivantes filtrent sans retrier.
  const sortedNotes = useMemo(() => sortNotesByOnset(notes), [notes]);
  const baseRange = useMemo(() => computeRange(notes), [notes]);
  /** Zoom borné : en dessous de ×1, la vue reste celle du clavier entier. */
  const zoom = Number.isFinite(zoomLevel) && zoomLevel > 1 ? zoomLevel : 1;
  const activeNotes = useMemo(
    () => activeNotesAt(sortedNotes, currentTimeSec, ACTIVE_NOTE_WINDOW_SEC, { bpm, tempoFactor }),
    [sortedNotes, currentTimeSec, bpm, tempoFactor],
  );
  const upcoming = useMemo(
    () => upcomingNote(sortedNotes, currentTimeSec, CHORD_WINDOW_SEC, { bpm, tempoFactor }),
    [sortedNotes, currentTimeSec, bpm, tempoFactor],
  );
  /**
   * Cluster suivi par le zoom : notes en cours, prochaine attaque et notes qui
   * tombent dans la fenêtre d’avance, élargies de ± 4 demi-tons pour laisser de
   * l’air autour de la main. C’est son milieu que la vue rejoint en douceur.
   */
  const focus = useMemo<MidiRange | null>(() => {
    const midis: number[] = [];
    for (const note of activeNotes) midis.push(note.midi);
    for (const note of upcoming) midis.push(note.midi);
    const horizonSec = currentTimeSec + ZOOM_LOOKAHEAD_SEC;
    for (const note of sortedNotes) {
      const onsetSec = beatsToSeconds(note.onsetBeats, bpm, tempoFactor);
      if (onsetSec > horizonSec) break;
      if (onsetSec < currentTimeSec) continue;
      if (hand !== "both" && note.hand !== hand) continue;
      midis.push(note.midi);
    }
    if (!midis.length) return null;
    return {
      min: Math.min(...midis) - ZOOM_FOCUS_PAD_SEMITONES,
      max: Math.max(...midis) + ZOOM_FOCUS_PAD_SEMITONES,
    };
  }, [activeNotes, upcoming, sortedNotes, currentTimeSec, bpm, tempoFactor, hand]);
  const expectedMidis = useMemo(() => {
    const merged = new Set<number>(activeMidis);
    for (const note of activeNotes) merged.add(note.midi);
    return [...merged].sort((a, b) => a - b);
  }, [activeMidis, activeNotes]);
  const pressedKeys = useMemo(() => {
    const merged = new Set<number>(pressedMidis);
    for (const midi of localPressed) merged.add(midi);
    return [...merged].sort((a, b) => a - b);
  }, [pressedMidis, localPressed]);
  const activeNoteIds = useMemo(() => new Set(activeNotes.map((note) => note.id)), [activeNotes]);
  const expectedCount = expectedMidis.length;
  const pressedCount = pressedKeys.length;

  /**
   * Configuration publiée à la boucle de rendu : elle porte tout ce qui décide
   * d’une image (horloge, vue, clavier, repères). La géométrie et les notes
   * visibles en sont déduites à chaque image réellement dessinée.
   */
  const scene = useMemo<Scene>(
    () => ({
      notes: sortedNotes,
      bpm,
      tempoFactor,
      currentTimeSec,
      hand,
      widthPx,
      heightPx: canvasHeightPx,
      baseRange,
      zoom,
      focus,
      expectedMidis: new Set(expectedMidis),
      pressedMidis: new Set(pressedKeys),
      activeNoteIds,
      naming,
      showNoteNames,
      colorByPitch,
      beatsPerMeasure,
      measureCount: typeof measureCount === "number" ? measureCount : Number.POSITIVE_INFINITY,
      showMeasureLines,
      showBeatLines,
    }),
    [
      sortedNotes,
      bpm,
      tempoFactor,
      currentTimeSec,
      hand,
      widthPx,
      canvasHeightPx,
      baseRange,
      zoom,
      focus,
      expectedMidis,
      pressedKeys,
      activeNoteIds,
      naming,
      showNoteNames,
      colorByPitch,
      beatsPerMeasure,
      measureCount,
      showMeasureLines,
      showBeatLines,
    ],
  );
  /** Nombre de notes réellement à l’écran, zoom compris (texte d’accessibilité). */
  const visibleCount = useMemo(() => resolveFrame(scene, focusCenterOf(focus)).visible.length, [scene, focus]);

  useEffect(() => {
    sceneRef.current = scene;
    dirtyRef.current = true;
  }, [scene]);

  // Nouveau morceau ou nouveau zoom : la fenêtre se recale sans transition.
  useEffect(() => {
    focusRef.current = null;
    dirtyRef.current = true;
  }, [zoom, notes]);

  // Boucle rAF 60 fps : on ne redessine que lorsque quelque chose a changé
  // (horloge, props, taille de l’écran, appui clavier) ou que la vue zoomée
  // glisse vers les notes suivantes, pour économiser la batterie.
  useEffect(() => {
    let handle = 0;
    const schedule =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame.bind(window)
        : (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 16);
    const unschedule =
      typeof window.cancelAnimationFrame === "function" ? window.cancelAnimationFrame.bind(window) : window.clearTimeout;
    const tick = (now: number) => {
      handle = schedule(tick);
      const current = sceneRef.current;
      const moving = advanceFocus(current, now, focusRef, lastTickRef);
      if (!dirtyRef.current && !moving) return;
      dirtyRef.current = false;
      const canvas = canvasRef.current;
      if (!canvas || !current) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      const frame = resolveFrame(current, focusRef.current);
      frameRef.current = frame;
      const ratio = dprRef.current;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawFrame(context, frame);
    };
    handle = schedule(tick);
    return () => unschedule(handle);
  }, []);

  // Relâchement propre des touches si le composant disparaît en pleine session.
  useEffect(
    () => () => {
      const held = [...pointerKeysRef.current.values()];
      pointerKeysRef.current.clear();
      for (const midi of held) onKeyReleaseRef.current?.(midi);
    },
    [],
  );

  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const releasePointer = (pointerId: number) => {
    const midi = pointerKeysRef.current.get(pointerId);
    if (midi === undefined) return;
    pointerKeysRef.current.delete(pointerId);
    // Une autre main peut encore tenir la même touche (accord joué à deux doigts).
    const stillHeld = [...pointerKeysRef.current.values()].includes(midi);
    if (stillHeld) return;
    setLocalPressed((current) => current.filter((value) => value !== midi));
    onKeyRelease?.(midi);
  };

  const pressPointer = (pointerId: number, midi: number) => {
    const previous = pointerKeysRef.current.get(pointerId);
    if (previous === midi) return;
    if (previous !== undefined) releasePointer(pointerId);
    pointerKeysRef.current.set(pointerId, midi);
    setLocalPressed((current) => (current.includes(midi) ? current : [...current, midi]));
    onKeyPress?.(midi);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const current = frameRef.current;
    if (!current) return;
    const point = pointFromEvent(event);
    const midi = midiAtPoint(point.x, point.y, current.geometry, current.layout);
    if (midi === undefined) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // La capture est un confort : sans elle, les événements du canvas suffisent.
    }
    pressPointer(event.pointerId, midi);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!pointerKeysRef.current.has(event.pointerId)) return;
    const current = frameRef.current;
    if (!current) return;
    const point = pointFromEvent(event);
    const midi = midiAtPoint(point.x, point.y, current.geometry, current.layout);
    if (midi !== undefined) pressPointer(event.pointerId, midi);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    releasePointer(event.pointerId);
  };

  const ariaLabel = useMemo(() => {
    const handLabel = hand === "left" ? "main gauche seule" : hand === "right" ? "main droite seule" : "deux mains";
    const nextLabel = upcoming.length
      ? `prochaine note ${upcoming.map((note) => midiToDisplayName(note.midi, naming)).join(" + ")}`
      : "plus aucune note à venir";
    const expectedLabel = expectedCount
      ? `${expectedCount} touche${expectedCount > 1 ? "s" : ""} attendue${expectedCount > 1 ? "s" : ""}`
      : "aucune touche attendue";
    const pressedLabel = pressedCount
      ? `${pressedCount} touche${pressedCount > 1 ? "s" : ""} enfoncée${pressedCount > 1 ? "s" : ""}`
      : "aucune touche enfoncée";
    return `Piano-roll « notes qui tombent » : ${visibleCount} note${visibleCount > 1 ? "s" : ""} à l’écran, ${handLabel}, ${nextLabel}, ${expectedLabel}, ${pressedLabel}.`;
  }, [hand, upcoming, naming, expectedCount, pressedCount, visibleCount]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label={ariaLabel}
      style={{
        display: "block",
        width: "100%",
        height: `${canvasHeightPx}px`,
        touchAction: "none",
        userSelect: "none",
        cursor: "pointer",
        background: COLOR.sky,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {ariaLabel}
    </canvas>
  );
}
