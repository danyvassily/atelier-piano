/**
 * Doubles de test pour les composants du piano-roll (utilisés uniquement par les
 * tests `*.test.tsx`).
 *
 * 1. `installCanvasDouble` remplace le contexte 2D de tous les canvas par un
 *    enregistreur : chaque image dessinée laisse une trace exploitable
 *    (rectangles remplis, chemins remplis/cerclés, textes) sans avoir besoin de
 *    la dépendance native `canvas` (absente de jsdom).
 * 2. `installRafClock` remplace `requestAnimationFrame` par une horloge que le
 *    test fait avancer image par image : la boucle de rendu et l’horloge du
 *    transport deviennent déterministes, sans attente réelle.
 */
import { act } from "react";

/** Rectangle rempli par `fillRect`, en coordonnées canvas absolues. */
export interface CanvasFillRecord {
  x: number;
  y: number;
  w: number;
  h: number;
  style: string;
}

/** Point d’un chemin en cours de construction. */
export interface CanvasPoint {
  x: number;
  y: number;
}

/** Chemin rempli (`fill`) ou cerclé (`stroke`), avec les points qui l’ont formé. */
export interface CanvasPathRecord {
  points: CanvasPoint[];
  style: string;
  kind: "fill" | "stroke";
  closed: boolean;
}

/** Texte écrit, avec l’opacité et la police en vigueur au moment de l’écriture. */
export interface CanvasTextRecord extends CanvasPoint {
  text: string;
  alpha: number;
  font: string;
  style: string;
}

/** Journal d’une image : il est vidé à chaque `clearRect` (une image = une trace). */
export interface CanvasRecorder {
  fills: CanvasFillRecord[];
  paths: CanvasPathRecord[];
  texts: CanvasTextRecord[];
  clear(): void;
}

/** Cadre englobant d’une liste de points. */
export interface CanvasBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Dégradé factice : la composition seule compte, pas son rendu. */
const FAKE_GRADIENT = {
  addColorStop() {
    // Les arrêts de couleur n’ont pas d’incidence sur les assertions.
  },
  toString() {
    return "gradient";
  },
} as unknown as CanvasGradient;

/** Contextes 2D factices créés par le double (le dernier sert aux vérifications). */
function createRecordingContext(recorder: CanvasRecorder): CanvasRenderingContext2D {
  let translateX = 0;
  let translateY = 0;
  const stack: CanvasPoint[] = [];
  let points: CanvasPoint[] = [];
  let closed = false;
  let fillStyle = "#000000";
  let strokeStyle = "#000000";
  let globalAlpha = 1;
  let font = "10px sans-serif";
  const local = (x: number, y: number): CanvasPoint => ({ x: x + translateX, y: y + translateY });

  const context = {
    // --- État de style (lu par le composant, écrit par le dessin) ---
    get fillStyle(): string {
      return fillStyle;
    },
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      fillStyle = String(value);
    },
    get strokeStyle(): string {
      return strokeStyle;
    },
    set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
      strokeStyle = String(value);
    },
    get globalAlpha(): number {
      return globalAlpha;
    },
    set globalAlpha(value: number) {
      globalAlpha = Number.isFinite(value) ? value : 1;
    },
    get font(): string {
      return font;
    },
    set font(value: string) {
      font = String(value);
    },
    lineWidth: 1,
    shadowColor: "",
    shadowBlur: 0,
    textAlign: "start",
    textBaseline: "alphabetic",
    // --- Transformations (suivies pour que les traces restent absolues) ---
    setTransform() {
      // Le facteur d’échelle de l’écran n’a pas d’incidence sur les assertions.
    },
    save() {
      stack.push({ x: translateX, y: translateY });
    },
    restore() {
      const previous = stack.pop();
      if (previous) {
        translateX = previous.x;
        translateY = previous.y;
      }
    },
    translate(x: number, y: number) {
      translateX += x;
      translateY += y;
    },
    // --- Images ---
    clearRect() {
      recorder.clear();
    },
    fillRect(x: number, y: number, w: number, h: number) {
      const origin = local(x, y);
      recorder.fills.push({ x: origin.x, y: origin.y, w, h, style: fillStyle });
    },
    // --- Chemins ---
    beginPath() {
      points = [];
      closed = false;
    },
    moveTo(x: number, y: number) {
      points.push(local(x, y));
    },
    lineTo(x: number, y: number) {
      points.push(local(x, y));
    },
    arcTo(x1: number, y1: number, x2: number, y2: number) {
      points.push(local(x1, y1), local(x2, y2));
    },
    rect(x: number, y: number, w: number, h: number) {
      points.push(local(x, y), local(x + w, y + h));
    },
    closePath() {
      closed = true;
    },
    clip() {
      // Le découpage n’est pas simulé : le composant reste seul juge de ses bornes.
    },
    fill() {
      recorder.paths.push({ points: [...points], style: fillStyle, kind: "fill", closed });
    },
    stroke() {
      recorder.paths.push({ points: [...points], style: strokeStyle, kind: "stroke", closed });
    },
    // --- Textes et dégradés ---
    fillText(text: string, x: number, y: number) {
      const origin = local(x, y);
      recorder.texts.push({ text: String(text), x: origin.x, y: origin.y, alpha: globalAlpha, font, style: fillStyle });
    },
    createLinearGradient() {
      return FAKE_GRADIENT;
    },
  };

  return context as unknown as CanvasRenderingContext2D;
}

/**
 * Branche le double de canvas : tous les canvas du document partagent le même
 * journal (vidé à chaque image) et annoncent la largeur demandée.
 */
export function installCanvasDouble(widthCss = 800): CanvasRecorder {
  const recorder: CanvasRecorder = {
    fills: [],
    paths: [],
    texts: [],
    clear() {
      recorder.fills = [];
      recorder.paths = [];
      recorder.texts = [];
    },
  };
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => createRecordingContext(recorder),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "clientWidth", {
    configurable: true,
    get: () => widthCss,
  });
  return recorder;
}

/** Horloge d’images pilotée par le test. */
export interface RafClock {
  /** Horodatage courant, en millisecondes. */
  now(): number;
  /** Fait avancer l’horloge de `frames` images de `dtMs` et exécute les rappels. */
  step(frames?: number, dtMs?: number): void;
  /** Nombre d’images en attente (0 = la boucle de rendu est au repos). */
  pending(): number;
}

/** Remplace `requestAnimationFrame` par une horloge déterministe. */
export function installRafClock(): RafClock {
  const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  scope.IS_REACT_ACT_ENVIRONMENT = true;
  let queue: FrameRequestCallback[] = [];
  let current = 0;
  const win = window as unknown as {
    requestAnimationFrame: (callback: FrameRequestCallback) => number;
    cancelAnimationFrame: (handle: number) => void;
  };
  win.requestAnimationFrame = (callback) => {
    queue.push(callback);
    return queue.length;
  };
  win.cancelAnimationFrame = () => {
    // Les rappels annulés sont simplement ignorés : la file est remplacée à chaque pas.
  };
  return {
    now: () => current,
    pending: () => queue.length,
    step(frames = 1, dtMs = 16) {
      for (let index = 0; index < frames; index += 1) {
        current += dtMs;
        const pending = queue;
        queue = [];
        act(() => {
          for (const callback of pending) callback(current);
        });
      }
    },
  };
}

/** Cadre englobant d’un chemin, ou `null` s’il ne contient aucun point. */
export function boxOf(points: readonly CanvasPoint[]): CanvasBox | null {
  if (!points.length) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
