import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Hand, NoteEvent, NoteNaming } from "../types";
import { midiToDisplayName } from "../music/notes";
import {
  ACTIVE_NOTE_WINDOW_SEC,
  BLACK_KEY_WIDTH_RATIO,
  CHORD_WINDOW_SEC,
  MIN_NOTE_HEIGHT_PX,
  activeNotesAt,
  buildLayout,
  computeRange,
  sortNotesByOnset,
  upcomingNote,
  visibleNotes,
  type KeyboardLayout,
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
  beatLine: "rgba(255, 255, 255, 0.08)",
  measureLine: "rgba(79, 195, 247, 0.24)",
  /** Ligne de frappe : un repère cyan discret, jamais un trait blanc criard. */
  hitLine: "rgba(79, 195, 247, 0.35)",
  hitGlow: "rgba(79, 195, 247, 0.22)",
  /** Sol : bande sombre discrète sous le clavier. */
  floor: "#0a0c0f",
  felt: "#9d1f2d",
  feltDark: "#470a11",
  whiteKeyTop: "#ffffff",
  whiteKeyMid: "#f4f5f7",
  whiteKeyBottom: "#e9ecf1",
  whiteKeySeparator: "#c9ced6",
  whiteKeyShadow: "rgba(0, 0, 0, 0.38)",
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
  /** Mains : cyan pour la droite, violet pour la gauche — lisibles même dans les accords. */
  rightHand: "#4fc3f7",
  leftHand: "#8b5cf6",
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
const MIN_KEYBOARD_HEIGHT_PX = 72;
const MAX_KEYBOARD_HEIGHT_PX = 320;
const MIN_PLAYFIELD_PX = 140;
/** Longueur visible d'une blanche par rapport à sa largeur (piano réel ≈ 6,4). */
const WHITE_KEY_ASPECT_RATIO = 5.8;
/** Longueur d’une touche noire, en fraction de la hauteur du clavier (~64 %). */
const BLACK_KEY_HEIGHT_RATIO = 0.64;
const HIT_LINE_GAP_PX = 2;
/** Bande de sol laissée sous les touches, en pixels. */
const FLOOR_BAND_PX = 6;
/** Enfoncement visuel d’une touche attendue (mais pas encore enfoncée), en pixels. */
const KEY_SINK_PX = 0;
/** Enfoncement visuel d’une touche réellement enfoncée, en pixels. */
const KEY_SINK_PRESSED_PX = 6;
/** Rayon des coins bas d’une touche noire, et des coins des touches blanches. */
const BLACK_KEY_RADIUS_PX = 3;
const WHITE_KEY_RADIUS_PX = 4;
/** Hauteur du bandeau brillant (gloss) d’une touche noire, en fraction de sa longueur. */
const BLACK_KEY_GLOSS_RATIO = 0.35;
/** Bande d’ombre portée d’une touche noire sur les blanches, en pixels. */
const BLACK_KEY_SHADOW_PX = 24;
/** Épaisseur de la ligne spéculaire au bord supérieur d’une touche noire. */
const BLACK_KEY_SPECULAR_PX = 1;
/** Reflet vertical d’une touche noire : largeur et hauteur, en fractions de la touche. */
const BLACK_KEY_STREAK_WIDTH_RATIO = 0.34;
const BLACK_KEY_STREAK_HEIGHT_RATIO = 0.62;
/** Reflet vertical d’une touche blanche : hauteur, en fraction de la touche. */
const WHITE_KEY_SHEEN_HEIGHT_RATIO = 0.3;
/** Ombre de pose au bas d’une touche blanche, en pixels. */
const KEY_LANDING_SHADOW_PX = 16;
/** Épaisseur de la ligne de frappe, en pixels. */
const HIT_LINE_THICKNESS_PX = 2;
/** Cible tactile minimale : sur iPad, une touche étroite reste attrapable. */
const MIN_TOUCH_TARGET_PX = 24;
/** Durée de chute d’une note du haut du canvas jusqu’à la ligne de frappe. */
const FALL_SECONDS = 1.8;
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
  /** Signature rythmique, utilisée pour distinguer temps et débuts de mesure. */
  timeSignature?: [number, number];
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
  /** Publie la position réelle de la ligne de frappe pour les overlays du parent. */
  onHitLineChange?: (percent: number) => void;
  /** Hauteur du canvas en pixels CSS (360 par défaut). */
  heightPx?: number;
  /** Classe CSS appliquée au canvas. */
  className?: string;
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
  beatLines: Array<{ y: number; measure: boolean }>;
}

/** Géométrie verticale du canvas : zone de chute en haut, clavier en bas. */
function computeGeometry(widthPx: number, heightPx: number, layout: KeyboardLayout): FrameGeometry {
  const safeWidth = Math.max(0, widthPx);
  const safeHeight = Math.max(MIN_CANVAS_HEIGHT_PX, heightPx);
  const whiteKeyWidthPx = layout.whiteCount > 0 ? safeWidth / layout.whiteCount : safeWidth;
  const proportionalHeight = Math.round(whiteKeyWidthPx * WHITE_KEY_ASPECT_RATIO);
  const keyboardHeightPx = Math.max(
    MIN_KEYBOARD_HEIGHT_PX,
    Math.min(proportionalHeight, safeHeight - MIN_PLAYFIELD_PX, MAX_KEYBOARD_HEIGHT_PX),
  );
  const keyboardTopY = safeHeight - keyboardHeightPx;
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

/** Repères rythmiques horizontaux : fins pour les temps, cyan pour les mesures. */
function drawBeatGrid(context: CanvasRenderingContext2D, frame: FrameData) {
  const { widthPx } = frame.geometry;
  context.save();
  for (const line of frame.beatLines) {
    context.fillStyle = line.measure ? COLOR.measureLine : COLOR.beatLine;
    context.fillRect(0, Math.round(line.y), widthPx, line.measure ? 2 : 1);
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
 * lumière en haut, reflet vertical sur la partie haute, ombre de pose au bas.
 * Une touche attendue se cerne de cyan et s’enfonce de deux pixels ; enfoncée,
 * elle s’enfonce de trois et se teinte plus franchement.
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
  // Reflet vertical : une colonne de lumière douce sur la partie haute.
  const sheen = context.createLinearGradient(x + w * 0.16, 0, x + w * 0.84, 0);
  sheen.addColorStop(0, "rgba(255, 255, 255, 0)");
  sheen.addColorStop(0.42, active ? "rgba(255, 255, 255, 0.52)" : "rgba(255, 255, 255, 0.42)");
  sheen.addColorStop(0.64, "rgba(255, 255, 255, 0.16)");
  sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = sheen;
  context.fillRect(x, top + 1, w, Math.max(4, height * WHITE_KEY_SHEEN_HEIGHT_RATIO));
  // Ombre de pose : la touche s’assombrit en touchant le sol.
  const landing = pool.get(`wk-landing|${variant}|${bottom}`, (ctx) => {
    const gradient = ctx.createLinearGradient(0, bottom - KEY_LANDING_SHADOW_PX, 0, bottom);
    gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
    gradient.addColorStop(0.55, "rgba(0, 0, 0, 0.12)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0.34)");
    return gradient;
  });
  context.fillStyle = landing;
  context.fillRect(x, bottom - KEY_LANDING_SHADOW_PX, w, KEY_LANDING_SHADOW_PX);
  // Lèvre frontale : un mince chanfrein donne une vraie épaisseur à l'ivoire.
  context.fillStyle = "rgba(255, 255, 255, 0.58)";
  context.fillRect(x + 1, bottom - 7, Math.max(0, w - 2), 1);
  context.fillStyle = "rgba(94, 102, 111, 0.24)";
  context.fillRect(x + 1, bottom - 2, Math.max(0, w - 2), 2);
  context.fillStyle = "rgba(55, 62, 69, 0.16)";
  context.fillRect(x, top + 2, 1, Math.max(0, height - 10));
  // Fine ligne de lumière en haut, doublée d’un liseré de biseau.
  context.fillStyle = "rgba(255, 255, 255, 0.96)";
  context.fillRect(x, top, w, 1);
  context.fillStyle = active ? "rgba(255, 255, 255, 0.42)" : "rgba(255, 255, 255, 0.32)";
  context.fillRect(x, top + 1, w, 1);
  context.restore();
}

/**
 * Touche noire : dégradé #3A3F46 → #14171B → #06080A, bandeau brillant NET sur
 * les 35 % supérieurs, ligne spéculaire au bord haut, léger streak vertical, coins
 * bas arrondis. Une touche active s’entoure d’un halo cyan et s’enfonce.
 *
 * L’ombre portée sur les blanches est dessinée séparément, AVANT la touche :
 * c’est elle qui donne l’épaisseur du clavier.
 */
function drawBlackKeyShadow(context: CanvasRenderingContext2D, x: number, top: number, w: number) {
  const shadow = context.createLinearGradient(0, top, 0, top + BLACK_KEY_SHADOW_PX);
  shadow.addColorStop(0, "rgba(0, 0, 0, 0.5)");
  shadow.addColorStop(0.35, "rgba(0, 0, 0, 0.22)");
  shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = shadow;
  context.fillRect(x - 1, top, w + 2, BLACK_KEY_SHADOW_PX);
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
  // Bandeau brillant : 35 % de la touche, dégradé marqué, limite franche.
  const glossHeight = Math.max(4, height * BLACK_KEY_GLOSS_RATIO);
  const gloss = pool.get(`bk-gloss|${variant}|${top}|${height}`, (ctx) => {
    const gradient = ctx.createLinearGradient(0, top, 0, top + glossHeight);
    gradient.addColorStop(0, active ? "rgba(226, 246, 255, 0.52)" : "rgba(255, 255, 255, 0.46)");
    gradient.addColorStop(0.42, active ? "rgba(198, 236, 255, 0.22)" : "rgba(255, 255, 255, 0.2)");
    gradient.addColorStop(0.88, "rgba(255, 255, 255, 0.06)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    return gradient;
  });
  context.fillStyle = gloss;
  context.fillRect(x, top, w, glossHeight);
  // Limite du bandeau : elle rend le reflet net au lieu d’un halo diffus.
  context.fillStyle = "rgba(0, 0, 0, 0.36)";
  context.fillRect(x, top + glossHeight - 1, w, 1);
  // Léger streak vertical : une colonne de lumière le long de la touche.
  const streakWidth = Math.max(2, w * BLACK_KEY_STREAK_WIDTH_RATIO);
  const streak = context.createLinearGradient(x + w * 0.5 - streakWidth / 2, 0, x + w * 0.5 + streakWidth / 2, 0);
  streak.addColorStop(0, "rgba(255, 255, 255, 0)");
  streak.addColorStop(0.5, active ? "rgba(214, 243, 255, 0.3)" : "rgba(255, 255, 255, 0.22)");
  streak.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = streak;
  context.fillRect(x + w * 0.5 - streakWidth / 2, top + 1, streakWidth, Math.max(6, height * BLACK_KEY_STREAK_HEIGHT_RATIO));
  // Fine ligne spéculaire au bord supérieur de la touche.
  context.fillStyle = active ? "rgba(240, 252, 255, 0.74)" : "rgba(255, 255, 255, 0.62)";
  context.fillRect(x, top, w, BLACK_KEY_SPECULAR_PX);
  // Face avant de l'ébène : plus mate et plus sombre que la surface supérieure.
  const frontHeight = Math.max(7, Math.round(height * 0.16));
  const front = context.createLinearGradient(0, bottom - frontHeight, 0, bottom);
  front.addColorStop(0, active ? "rgba(37, 100, 132, 0.72)" : "rgba(17, 20, 24, 0.72)");
  front.addColorStop(1, "rgba(0, 0, 0, 0.92)");
  context.fillStyle = front;
  context.fillRect(x, bottom - frontHeight, w, frontHeight);
  context.fillStyle = "rgba(255, 255, 255, 0.13)";
  context.fillRect(x + 1, bottom - frontHeight, Math.max(0, w - 2), 1);
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

  // Feutre rouge derrière les touches : repère caractéristique d'un piano acoustique.
  const felt = context.createLinearGradient(0, keyboardTopY, 0, keyboardTopY + 6);
  felt.addColorStop(0, COLOR.feltDark);
  felt.addColorStop(0.5, COLOR.felt);
  felt.addColorStop(1, COLOR.feltDark);
  context.fillStyle = felt;
  context.fillRect(0, keyboardTopY + 1, widthPx, 5);

  // Ombre de pose du clavier entier : les touches reposent sur le sol. Dessinée
  // une seule fois, elle remplace l’ombre de canvas de chaque touche (coûteuse).
  const restingBottom = keyboardTopY + keyHeight;
  const keyboardBottom = keyboardTopY + keyboardHeightPx;
  const poseTop = Math.max(keyboardTopY, restingBottom - 10);
  const poseShadow = context.createLinearGradient(0, poseTop, 0, keyboardBottom);
  poseShadow.addColorStop(0, "rgba(0, 0, 0, 0)");
  poseShadow.addColorStop(0.62, COLOR.whiteKeyShadow);
  poseShadow.addColorStop(1, "rgba(0, 0, 0, 0.66)");
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
  drawBeatGrid(context, frame);
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
  timeSignature = [4, 4],
  currentTimeSec,
  hand = "both",
  naming = "french",
  colorByPitch = false,
  showNoteNames = false,
  activeMidis = NO_MIDIS,
  pressedMidis = NO_MIDIS,
  onKeyPress,
  onKeyRelease,
  onHitLineChange,
  heightPx = DEFAULT_HEIGHT_PX,
  className,
}: FallingNotesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<FrameData | null>(null);
  const dirtyRef = useRef(true);
  const dprRef = useRef(1);
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
  const layout = useMemo(() => buildLayout(computeRange(notes)), [notes]);
  const geometry = useMemo(() => computeGeometry(widthPx, canvasHeightPx, layout), [widthPx, canvasHeightPx, layout]);
  const pxPerSec = Math.max(48, geometry.hitLineY / FALL_SECONDS);
  const beatLines = useMemo(() => {
    const effectiveBpm = Math.max(1, bpm * tempoFactor);
    const secondsPerQuarter = 60 / effectiveBpm;
    const beatUnitInQuarters = 4 / Math.max(1, timeSignature[1]);
    const secondsPerGridBeat = secondsPerQuarter * beatUnitInQuarters;
    const beatsPerMeasure = Math.max(1, timeSignature[0]);
    const firstBeat = Math.ceil(currentTimeSec / secondsPerGridBeat - 1e-6);
    const visibleSeconds = geometry.hitLineY / pxPerSec;
    const lastBeat = Math.ceil((currentTimeSec + visibleSeconds) / secondsPerGridBeat);
    const lines: Array<{ y: number; measure: boolean }> = [];
    for (let beat = firstBeat; beat <= lastBeat; beat += 1) {
      const y = geometry.hitLineY - (beat * secondsPerGridBeat - currentTimeSec) * pxPerSec;
      if (y < 0 || y > geometry.hitLineY) continue;
      const normalized = ((beat % beatsPerMeasure) + beatsPerMeasure) % beatsPerMeasure;
      lines.push({ y, measure: normalized === 0 });
    }
    return lines;
  }, [bpm, tempoFactor, timeSignature, currentTimeSec, geometry.hitLineY, pxPerSec]);
  const activeNotes = useMemo(
    () => activeNotesAt(sortedNotes, currentTimeSec, ACTIVE_NOTE_WINDOW_SEC, { bpm, tempoFactor }),
    [sortedNotes, currentTimeSec, bpm, tempoFactor],
  );
  const upcoming = useMemo(
    () => upcomingNote(sortedNotes, currentTimeSec, CHORD_WINDOW_SEC, { bpm, tempoFactor }),
    [sortedNotes, currentTimeSec, bpm, tempoFactor],
  );
  const visible = useMemo(
    () =>
      visibleNotes(sortedNotes, currentTimeSec, {
        bpm,
        tempoFactor,
        pxPerSec,
        hitLineY: geometry.hitLineY,
        layout,
        widthPx: geometry.widthPx,
        hand,
        minHeightPx: MIN_NOTE_HEIGHT_PX,
        sorted: true,
      }),
    [sortedNotes, currentTimeSec, bpm, tempoFactor, pxPerSec, geometry, layout, hand],
  );
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
  const visibleCount = visible.length;

  const frame = useMemo<FrameData>(
    () => ({
      geometry,
      layout,
      visible,
      expectedMidis: new Set(expectedMidis),
      pressedMidis: new Set(pressedKeys),
      activeNoteIds,
      naming,
      showNoteNames,
      colorByPitch,
      beatLines,
    }),
    [geometry, layout, visible, expectedMidis, pressedKeys, activeNoteIds, naming, showNoteNames, colorByPitch, beatLines],
  );

  useEffect(() => {
    if (!(geometry.heightPx > 0)) return;
    onHitLineChange?.(geometry.hitLineY / geometry.heightPx * 100);
  }, [geometry.heightPx, geometry.hitLineY, onHitLineChange]);

  useEffect(() => {
    frameRef.current = frame;
    dirtyRef.current = true;
  }, [frame]);

  // Boucle rAF 60 fps : on ne redessine que lorsque quelque chose a changé
  // (horloge, props, taille de l’écran, appui clavier) pour économiser la batterie.
  useEffect(() => {
    let handle = 0;
    const drawNow = () => {
      const canvas = canvasRef.current;
      const current = frameRef.current;
      if (!canvas || !current) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      const ratio = dprRef.current;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawFrame(context, current);
    };
    const schedule =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame.bind(window)
        : (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 16);
    const unschedule =
      typeof window.cancelAnimationFrame === "function" ? window.cancelAnimationFrame.bind(window) : window.clearTimeout;
    const tick = () => {
      handle = schedule(tick);
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      drawNow();
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
