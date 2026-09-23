import type { Hand, NoteEvent } from "../types";

/**
 * Moteur « falling notes » (piano-roll type Synthesia) : conversions temps ↔ tempo,
 * géométrie de clavier en positions normalisées et rectangles des notes qui tombent.
 * Toutes les fonctions de ce module sont pures (aucun accès au DOM), donc testables
 * directement et réutilisables par d’autres rendus (canvas, SVG, tests).
 */

/** Hauteur minimale d’une note très courte, en pixels (sinon elle devient invisible). */
export const MIN_NOTE_HEIGHT_PX = 6;

/** Bornes MIDI absolues du clavier dessiné (Do1 → Do7). */
export const MIN_RANGE_MIDI = 24;
export const MAX_RANGE_MIDI = 96;

/** Largeur d’une touche noire, en fraction d’une touche blanche (cf. PianoKeyboard.tsx). */
export const BLACK_KEY_WIDTH_RATIO = 0.58;

/** Décalage d’une touche noire par rapport au bord gauche de la blanche qui la précède. */
export const BLACK_KEY_OFFSET = 0.72;

/** Nombre de classes de hauteur chromatiques (mode `colorByPitch`). */
export const CHROMATIC_PITCH_COUNT = 12;

/** Fenêtre du mode attente : une note reste « attendue » ce temps après son attaque (secondes). */
export const ACTIVE_NOTE_WINDOW_SEC = 0.18;

/** Tolérance qui regroupe les notes d’un même accord (secondes). */
export const CHORD_WINDOW_SEC = 0.03;

/** Largeur utile d’une note, en fraction de la largeur de sa touche. */
const WHITE_NOTE_WIDTH_RATIO = 0.86;
const BLACK_NOTE_WIDTH_RATIO = 0.6;

/** Marge de comparaison pour absorber les erreurs d’arrondi flottant (secondes). */
const TIME_EPSILON_SEC = 1e-6;

const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

export interface TempoOptions {
  /** Tempo nominal de la partition, en BPM. */
  bpm: number;
  /** Facteur de tempo appliqué (1 = tempo nominal, 0.75 = travail lent). */
  tempoFactor?: number;
}

/** Tempo utilisé quand l’appelant ne le fournit pas (utile pour les aperçus statiques). */
export const DEFAULT_TEMPO: TempoOptions = { bpm: 120, tempoFactor: 1 };

export interface MidiRange {
  min: number;
  max: number;
}

export interface KeyboardLayout {
  /** Touches blanches de la plage, du grave vers l’aigu. */
  whiteMidis: number[];
  /** Touches noires de la plage, du grave vers l’aigu. */
  blackMidis: number[];
  /** Nombre de touches blanches (base de la largeur d’une touche). */
  whiteCount: number;
  /**
   * Position horizontale normalisée (0..1) du CENTRE de la touche demandée.
   * L’appelant multiplie par la largeur en pixels du clavier.
   */
  xRatioForMidi(midi: number): number;
}

export interface NoteRect {
  /** Bord gauche, en pixels. */
  xPx: number;
  /** Largeur, en pixels. */
  wPx: number;
  /** Bord supérieur, en pixels. */
  yTopPx: number;
  /** Hauteur, en pixels (jamais moins de `MIN_NOTE_HEIGHT_PX`). */
  hPx: number;
}

export interface VisibleNote {
  note: NoteEvent;
  rect: NoteRect;
}

export interface VisibleNotesOptions {
  /** Tempo nominal (BPM). */
  bpm: number;
  /** Vitesse de chute du piano-roll, en pixels par seconde. */
  pxPerSec: number;
  /** Ordonnée de la ligne de frappe (le haut du clavier intégré). */
  hitLineY: number;
  /** Géométrie du clavier, produite par `buildLayout`. */
  layout: KeyboardLayout;
  /** Largeur disponible du canvas, en pixels CSS. */
  widthPx: number;
  /** Facteur de tempo appliqué (1 par défaut). */
  tempoFactor?: number;
  /** Filtre de main ; « both » affiche les deux mains. */
  hand?: Hand;
  /** Hauteur minimale d’une note en pixels (6 par défaut). */
  minHeightPx?: number;
  /**
   * Vrai si `notes` est déjà trié par attaque croissante (cas d’une liste
   * pré-triée une fois pour toutes côté appelant) : évite un tri à chaque image.
   */
  sorted?: boolean;
}

/** Classe de hauteur (0 = Do) d’une note MIDI, toujours dans 0..11. */
export function pitchClassOf(midi: number): number {
  return ((Math.round(midi) % CHROMATIC_PITCH_COUNT) + CHROMATIC_PITCH_COUNT) % CHROMATIC_PITCH_COUNT;
}

/** Vrai si la note MIDI est une touche noire. */
export function isBlackKey(midi: number): boolean {
  return BLACK_PITCH_CLASSES.has(pitchClassOf(midi));
}

/**
 * Tempo effectif (BPM × facteur de tempo). Un facteur absent, nul, négatif ou
 * non fini est ignoré (traité comme 1) ; un tempo non exploitable renvoie 0,
 * ce qui met les conversions à zéro au lieu de propager `Infinity`/`NaN`.
 */
function effectiveTempo(bpm: number, tempoFactor: number): number {
  const factor = Number.isFinite(tempoFactor) && tempoFactor > 0 ? tempoFactor : 1;
  const tempo = bpm * factor;
  return Number.isFinite(tempo) && tempo > 0 ? tempo : 0;
}

/** Convertit des temps (beats) en secondes pour un tempo donné. */
export function beatsToSeconds(beats: number, bpm: number, tempoFactor = 1): number {
  const tempo = effectiveTempo(bpm, tempoFactor);
  if (tempo <= 0 || !Number.isFinite(beats)) return 0;
  return (beats * 60) / tempo;
}

/** Convertit des secondes en temps (beats) pour un tempo donné. */
export function secondsToBeats(seconds: number, bpm: number, tempoFactor = 1): number {
  const tempo = effectiveTempo(bpm, tempoFactor);
  if (tempo <= 0 || !Number.isFinite(seconds)) return 0;
  return (seconds * tempo) / 60;
}

/** Trie une copie de `notes` par attaque croissante, puis par hauteur (ordre stable). */
export function sortNotesByOnset(notes: NoteEvent[]): NoteEvent[] {
  return [...notes].sort((a, b) => a.onsetBeats - b.onsetBeats || a.midi - b.midi || a.id.localeCompare(b.id));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Plage MIDI à afficher : extrêmes des notes ± `pad`, alignée sur les octaves
 * (comme `PianoKeyboard`) puis bornée à 24..96. La plage couvre au moins une
 * octave, même quand toutes les notes sont hors bornes.
 */
export function computeRange(notes: NoteEvent[], pad = 4): MidiRange {
  const midis = notes.map((note) => note.midi).filter((midi) => Number.isFinite(midi));
  if (!midis.length) return { min: 48, max: 72 };
  const safePad = Number.isFinite(pad) && pad >= 0 ? pad : 0;
  let min = Math.round(Math.min(...midis)) - safePad;
  let max = Math.round(Math.max(...midis)) + safePad;
  while (min % 12 !== 0 && min > MIN_RANGE_MIDI) min -= 1;
  while (max % 12 !== 0 && max < MAX_RANGE_MIDI) max += 1;
  min = clamp(min, MIN_RANGE_MIDI, MAX_RANGE_MIDI);
  max = clamp(max, MIN_RANGE_MIDI, MAX_RANGE_MIDI);
  if (max - min < 12) {
    max = Math.min(MAX_RANGE_MIDI, min + 12);
    min = Math.max(MIN_RANGE_MIDI, max - 12);
  }
  return { min, max };
}

/**
 * Géométrie du clavier pour une plage : listes de touches blanches/noires et
 * fonction de position normalisée. Les coordonnées sont exprimées en « largeurs
 * de touche blanche » (une blanche = 1 unité), donc valables pour n’importe
 * quelle largeur de canvas.
 */
export function buildLayout(range: MidiRange): KeyboardLayout {
  const low = Math.round(Math.min(range.min, range.max));
  const high = Math.round(Math.max(range.min, range.max));
  const allMidis = Array.from({ length: Math.max(0, high - low + 1) }, (_, index) => low + index);
  const whiteMidis = allMidis.filter((midi) => !isBlackKey(midi));
  const blackMidis = allMidis.filter((midi) => isBlackKey(midi));
  const whiteCount = whiteMidis.length;
  const whiteIndex = new Map<number, number>();
  whiteMidis.forEach((midi, index) => whiteIndex.set(midi, index));

  function xRatioForMidi(midi: number): number {
    if (whiteCount === 0) return 0.5;
    if (!isBlackKey(midi)) {
      const index = whiteIndex.get(Math.round(midi));
      if (index !== undefined) return (index + 0.5) / whiteCount;
      // Hors clavier : on projette sur la première ou la dernière blanche.
      return midi < whiteMidis[0] ? 0.5 / whiteCount : (whiteCount - 0.5) / whiteCount;
    }
    // Touche noire : même placement que la CSS du clavier (bord gauche à
    // « blanche précédente + 0.72 », largeur 58 %), donc centre à + 0.72 + 0.29.
    const whiteBefore = whiteMidis.filter((white) => white < midi).length - 1;
    const centerUnits = whiteBefore + BLACK_KEY_OFFSET + BLACK_KEY_WIDTH_RATIO / 2;
    return clamp(centerUnits / whiteCount, 0, 1);
  }

  return { whiteMidis, blackMidis, whiteCount, xRatioForMidi };
}

/** Attaque et fin d’une note, en secondes, pour un tempo donné. */
function noteTiming(note: NoteEvent, bpm: number, tempoFactor: number): { onsetSec: number; endSec: number } {
  const onsetSec = beatsToSeconds(note.onsetBeats, bpm, tempoFactor);
  const durationBeats = Number.isFinite(note.durationBeats) ? Math.max(0, note.durationBeats) : 0;
  const endSec = beatsToSeconds(note.onsetBeats + durationBeats, bpm, tempoFactor);
  return { onsetSec, endSec };
}

/** Ordonnée du bord BAS d’une note à l’instant donné (bord avant, celui qui touche la ligne de frappe). */
function noteBottomPx(note: NoteEvent, atSeconds: number, bpm: number, tempoFactor: number, pxPerSec: number, hitLineY: number): number {
  const { onsetSec } = noteTiming(note, bpm, tempoFactor);
  return hitLineY + (atSeconds - onsetSec) * pxPerSec;
}

/**
 * Rectangle d’une note à l’instant donné, ou `null` si elle sort de la zone de
 * jeu (au-dessus de y = 0 ou déjà passée sous la ligne de frappe).
 * Le bord bas atteint exactement `hitLineY` au moment de l’attaque.
 */
export function noteRectAt(
  note: NoteEvent,
  atSeconds: number,
  bpm: number,
  tempoFactor: number,
  pxPerSec: number,
  hitLineY: number,
  layout: KeyboardLayout,
  widthPx: number,
  minHeightPx: number = MIN_NOTE_HEIGHT_PX,
): NoteRect | null {
  if (!layout.whiteCount || !(widthPx > 0) || !(pxPerSec > 0) || !Number.isFinite(atSeconds)) return null;
  const { onsetSec, endSec } = noteTiming(note, bpm, tempoFactor);
  const bottomPx = hitLineY + (atSeconds - onsetSec) * pxPerSec;
  const floor = Number.isFinite(minHeightPx) && minHeightPx > 0 ? minHeightPx : MIN_NOTE_HEIGHT_PX;
  const hPx = Math.max(floor, (endSec - onsetSec) * pxPerSec);
  const yTopPx = bottomPx - hPx;
  if (bottomPx <= 0 || yTopPx >= hitLineY) return null;
  const whiteWidthPx = widthPx / layout.whiteCount;
  const wPx = whiteWidthPx * (isBlackKey(note.midi) ? BLACK_NOTE_WIDTH_RATIO : WHITE_NOTE_WIDTH_RATIO);
  const xPx = clamp(layout.xRatioForMidi(note.midi) * widthPx - wPx / 2, 0, Math.max(0, widthPx - wPx));
  return { xPx, wPx, yTopPx, hPx };
}

/**
 * Notes visibles à l’instant donné, triées par attaque croissante, avec leur
 * rectangle prêt à dessiner. `hand` filtre la main, `minHeightPx` garantit la
 * lisibilité des notes très courtes. Les notes pré-triées (`sorted: true`)
 * évitent un tri par image ; les notes au-dessus de l’écran interrompent la
 * boucle, puisque la suite est encore plus haute dans le piano-roll.
 */
export function visibleNotes(notes: NoteEvent[], atSeconds: number, options: VisibleNotesOptions): VisibleNote[] {
  const {
    bpm,
    pxPerSec,
    hitLineY,
    layout,
    widthPx,
    tempoFactor = 1,
    hand = "both",
    minHeightPx = MIN_NOTE_HEIGHT_PX,
    sorted = false,
  } = options;
  if (!layout.whiteCount || !(widthPx > 0) || !(pxPerSec > 0) || !Number.isFinite(atSeconds)) return [];
  const ordered = sorted ? notes : sortNotesByOnset(notes);
  const result: VisibleNote[] = [];
  for (const note of ordered) {
    if (hand !== "both" && note.hand !== hand) continue;
    const bottomPx = noteBottomPx(note, atSeconds, bpm, tempoFactor, pxPerSec, hitLineY);
    if (bottomPx <= 0) break; // trié par attaque : toutes les suivantes sont encore plus haut
    const { onsetSec, endSec } = noteTiming(note, bpm, tempoFactor);
    if (bottomPx - Math.max(minHeightPx, (endSec - onsetSec) * pxPerSec) >= hitLineY) continue; // déjà passée
    const rect = noteRectAt(note, atSeconds, bpm, tempoFactor, pxPerSec, hitLineY, layout, widthPx, minHeightPx);
    if (rect) result.push({ note, rect });
  }
  return result;
}

/**
 * Notes dont l’attaque vient de passer (≤ `windowSec`) : alimente le mode
 * attente et le surlignage des touches attendues sur le clavier.
 */
export function activeNotesAt(notes: NoteEvent[], atSeconds: number, windowSec = ACTIVE_NOTE_WINDOW_SEC, tempo: TempoOptions = DEFAULT_TEMPO): NoteEvent[] {
  if (!Number.isFinite(atSeconds) || !(windowSec >= 0)) return [];
  const bpm = tempo.bpm;
  const tempoFactor = tempo.tempoFactor ?? 1;
  return sortNotesByOnset(notes).filter((note) => {
    const { onsetSec } = noteTiming(note, bpm, tempoFactor);
    const elapsed = atSeconds - onsetSec;
    return elapsed >= -TIME_EPSILON_SEC && elapsed <= windowSec;
  });
}

/**
 * Prochaine note (ou accord) à jouer à partir de `atSeconds`, triée du grave
 * vers l’aigu. Les notes partageant la même attaque (à `chordWindowSec` près)
 * forment l’accord. Tableau vide s’il n’y a plus rien à venir.
 */
export function upcomingNote(notes: NoteEvent[], atSeconds: number, chordWindowSec = CHORD_WINDOW_SEC, tempo: TempoOptions = DEFAULT_TEMPO): NoteEvent[] {
  if (!Number.isFinite(atSeconds) || !notes.length) return [];
  const span = Number.isFinite(chordWindowSec) && chordWindowSec > 0 ? chordWindowSec : CHORD_WINDOW_SEC;
  const bpm = tempo.bpm;
  const tempoFactor = tempo.tempoFactor ?? 1;
  const ordered = sortNotesByOnset(notes);
  let firstOnsetSec: number | undefined;
  const chord: NoteEvent[] = [];
  for (const note of ordered) {
    const { onsetSec } = noteTiming(note, bpm, tempoFactor);
    if (onsetSec < atSeconds - TIME_EPSILON_SEC) continue;
    if (firstOnsetSec === undefined) firstOnsetSec = onsetSec;
    if (onsetSec - firstOnsetSec > span) break;
    chord.push(note);
  }
  return chord.sort((a, b) => a.midi - b.midi);
}

/**
 * Position repliée dans une boucle : toute position hors de [start, end] est
 * ramenée dans l’intervalle par modulo (avance comme recul), ce qui permet de
 * boucler indéfiniment sur un passage.
 */
export function loopProgress(atSeconds: number, loopStartSec: number, loopEndSec: number): number {
  const start = Math.min(loopStartSec, loopEndSec);
  const end = Math.max(loopStartSec, loopEndSec);
  const span = end - start;
  if (!Number.isFinite(atSeconds)) return start;
  if (!(span > 0)) return clamp(atSeconds, start, end);
  const offset = atSeconds - start;
  const wrapped = ((offset % span) + span) % span;
  return start + wrapped;
}

/* ------------------------------------------------------------------ */
/* Repères de mesure du piano-roll                                    */
/* ------------------------------------------------------------------ */

/** Nombre de temps par défaut d’une mesure (4/4) quand rien n’est précisé. */
export const DEFAULT_BEATS_PER_MEASURE = 4;

/** Garde-fou : nombre maximal de repères produits pour une image. */
export const MAX_MARKER_LINES = 96;

/** Repère vertical du piano-roll : numéro de mesure et ordonnée en pixels. */
export interface MeasureLine {
  /** Ordonnée du repère (0 = haut de la scène, `hitLineY` = ligne de frappe). */
  yPx: number;
  /** Numéro de mesure (1 = première mesure du morceau, sauf décalage demandé). */
  measure: number;
}

/** Repère de temps (un temps), encore plus discret que les repères de mesure. */
export interface BeatLine {
  /** Ordonnée du repère (0 = haut de la scène, `hitLineY` = ligne de frappe). */
  yPx: number;
  /** Numéro du temps (1 = premier temps du morceau, sauf décalage demandé). */
  beat: number;
}

/** Géométrie et bornes communes aux repères de mesure et de temps. */
export interface TimelineLinesOptions {
  /** Tempo nominal (BPM). */
  bpm: number;
  /** Vitesse de chute du piano-roll, en pixels par seconde. */
  pxPerSec: number;
  /** Ordonnée de la ligne de frappe (le haut du clavier intégré). */
  hitLineY: number;
  /** Facteur de tempo appliqué (1 par défaut). */
  tempoFactor?: number;
  /** Nombre de temps (noires) par mesure : 4 par défaut. */
  beatsPerMeasure?: number;
  /**
   * Numéro affiché pour la première mesure du morceau (1 par défaut) : une
   * section démarrée en cours de partition peut ainsi garder la numérotation
   * de la partition d’origine.
   */
  firstMeasure?: number;
  /** Nombre de mesures du morceau : borne les repères (illimité par défaut). */
  measureCount?: number;
  /** Nombre maximal de repères rendus (garde-fou, 96 par défaut). */
  maxLines?: number;
}

/** Réglage interne d’une famille de repères (mesure, ou temps). */
interface MarkerOptions {
  bpm: number;
  pxPerSec: number;
  hitLineY: number;
  tempoFactor: number;
  /** Nombre de temps (noires) par mesure, déjà assaini. */
  beatsPerMeasure: number;
  /** Numéro affiché pour la première unité (mesure 1, ou temps 1). */
  firstUnit: number;
  /** Nombre d’unités du morceau (infini quand il n’est pas connu). */
  unitCount: number;
  /** Nombre maximal de repères rendus. */
  limit: number;
}

/**
 * Cœur commun des repères : une graduation par unité (`beatsPerUnit` temps,
 * mesure ou temps selon l’appelant), posée sur la ligne de frappe au moment où
 * l’unité commence et remontant le piano-roll à la vitesse des notes. Seuls les
 * repères encore dans la zone de jeu sont rendus, du plus bas (proche de la
 * ligne de frappe) vers le plus haut.
 */
function markerLines(
  atSeconds: number,
  beatsPerUnit: number,
  options: MarkerOptions,
): Array<{ yPx: number; index: number }> {
  const { bpm, pxPerSec, hitLineY, tempoFactor, firstUnit, unitCount, limit } = options;
  if (!Number.isFinite(atSeconds) || !(pxPerSec > 0) || !(hitLineY > 0) || !(beatsPerUnit > 0)) return [];
  const unitSeconds = beatsToSeconds(beatsPerUnit, bpm, tempoFactor);
  if (!(unitSeconds > 0)) return [];
  const beats = secondsToBeats(atSeconds, bpm, tempoFactor);
  const currentIndex = Math.floor(Math.max(0, beats) / beatsPerUnit);
  // Nombre d’unités qui tiennent au-dessus de la ligne de frappe, plus la
  // suivante (elle apparaît en haut de la scène).
  const visibleSpan = Math.ceil(hitLineY / (unitSeconds * pxPerSec)) + 1;
  const lastIndex = Math.min(unitCount - 1, currentIndex + visibleSpan);
  const lines: Array<{ yPx: number; index: number }> = [];
  for (let index = Math.max(0, currentIndex - visibleSpan); index <= lastIndex && lines.length < limit; index += 1) {
    const onsetSec = beatsToSeconds(index * beatsPerUnit, bpm, tempoFactor);
    const yPx = hitLineY + (atSeconds - onsetSec) * pxPerSec;
    if (yPx < 0 || yPx > hitLineY) continue;
    lines.push({ yPx, index: index + firstUnit });
  }
  return lines;
}

/** Options réglées à partir de la requête de l’appelant (valeurs défensives). */
function markerOptions(options: TimelineLinesOptions): MarkerOptions {
  const rawBeats = options.beatsPerMeasure;
  const beats = typeof rawBeats === "number" && Number.isFinite(rawBeats) && rawBeats > 0 ? rawBeats : DEFAULT_BEATS_PER_MEASURE;
  const rawFirst = options.firstMeasure;
  const first = typeof rawFirst === "number" && Number.isFinite(rawFirst) ? Math.max(0, Math.floor(rawFirst)) : 1;
  const rawCount = options.measureCount;
  const count = typeof rawCount === "number" && Number.isFinite(rawCount) && rawCount > 0 ? Math.floor(rawCount) : Number.POSITIVE_INFINITY;
  const rawLimit = options.maxLines;
  const limit = typeof rawLimit === "number" && Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : MAX_MARKER_LINES;
  return {
    bpm: options.bpm,
    pxPerSec: options.pxPerSec,
    hitLineY: options.hitLineY,
    tempoFactor: options.tempoFactor ?? 1,
    beatsPerMeasure: beats,
    firstUnit: first,
    unitCount: count,
    limit,
  };
}

/**
 * Repères de mesure visibles à l’instant donné : une ligne par début de mesure,
 * placée à `hitLineY` quand la mesure commence puis remontant le piano-roll.
 * Les mesures sont numérotées depuis `firstMeasure` (1 par défaut) et bornées au
 * morceau (`measureCount`) ; le résultat est trié de la mesure la plus basse
 * (proche de la ligne de frappe) vers la plus haute.
 */
export function measureLinesVisible(atSeconds: number, options: TimelineLinesOptions): MeasureLine[] {
  const base = markerOptions(options);
  return markerLines(atSeconds, base.beatsPerMeasure, base).map(({ yPx, index }) => ({ yPx, measure: index }));
}

/**
 * Repères de temps visibles à l’instant donné : un repère par temps, encore plus
 * discret que les repères de mesure (repliés sur la même géométrie).
 */
export function beatLinesVisible(atSeconds: number, options: TimelineLinesOptions): BeatLine[] {
  return markerLines(atSeconds, 1, markerOptions(options)).map(({ yPx, index }) => ({ yPx, beat: index }));
}

/**
 * Opacité d’une étiquette de mesure : maximale sur la ligne de frappe, elle
 * s’estompe progressivement vers le haut de la scène (quadratique, pour rester
 * lisible dans la zone de jeu proche).
 */
export function measureLabelAlpha(yPx: number, hitLineY: number, minAlpha = 0.16): number {
  const floor = Number.isFinite(minAlpha) ? clamp(minAlpha, 0, 1) : 0.16;
  if (!Number.isFinite(yPx) || !Number.isFinite(hitLineY) || !(hitLineY > 0)) return floor;
  const ratio = clamp(yPx / hitLineY, 0, 1);
  return floor + (1 - floor) * ratio * ratio;
}

/* ------------------------------------------------------------------ */
/* Zoom des touches                                                   */
/* ------------------------------------------------------------------ */

/** Marge (demi-tons) autour du cluster de notes que le zoom garde à l’écran. */
export const ZOOM_FOCUS_PAD_SEMITONES = 4;

/** Plancher du nombre de demi-tons visibles quand les touches sont zoomées. */
export const MIN_ZOOM_SPAN_SEMITONES = 12;

/** Paliers de zoom des touches proposés par la barre de transport. */
export const ZOOM_STEPS = [1, 1.5, 2, 2.5, 3] as const;

/** Focus du zoom : une hauteur, un cluster de hauteurs, ou directement une plage. */
export type ZoomFocus = number | readonly number[] | MidiRange | null | undefined;

/** Bornes du focus demandé, ou `null` s’il ne contient aucune hauteur finie. */
function focusBoundsOf(focus: ZoomFocus): MidiRange | null {
  if (focus === null || focus === undefined) return null;
  let values: number[];
  if (typeof focus === "number") values = [focus];
  else if (Array.isArray(focus)) values = [...(focus as readonly number[])];
  else values = [(focus as MidiRange).min, (focus as MidiRange).max];
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return null;
  return { min: Math.min(...finite), max: Math.max(...finite) };
}

/**
 * Fenêtre MIDI réellement affichée par le clavier, pour un zoom donné.
 *
 * - `zoom` ≤ 1 (ou inexploitable) renvoie la plage de base telle quelle : le
 *   comportement de la vue ×1 reste strictement inchangé ;
 * - au-delà, la fenêtre couvre `span de base / zoom` demi-tons, jamais moins de
 *   `minSpan` (12 par défaut) ni plus que la plage de base ;
 * - la fenêtre est centrée sur `focusMidi` (hauteur unique, milieu du cluster de
 *   notes en cours et à venir, ou milieu de la plage si le focus est absent) et
 *   reste bornée au clavier du morceau : elle ne montre jamais autre chose que
 *   des touches existantes.
 */
export function computeViewRange(
  baseRange: MidiRange,
  zoom: number,
  focusMidi: ZoomFocus,
  minSpan: number = MIN_ZOOM_SPAN_SEMITONES,
): MidiRange {
  const rawMin = Number.isFinite(baseRange.min) ? baseRange.min : MIN_RANGE_MIDI;
  const rawMax = Number.isFinite(baseRange.max) ? baseRange.max : MAX_RANGE_MIDI;
  const low = clamp(Math.round(Math.min(rawMin, rawMax)), MIN_RANGE_MIDI, MAX_RANGE_MIDI);
  const high = clamp(Math.round(Math.max(rawMin, rawMax)), MIN_RANGE_MIDI, MAX_RANGE_MIDI);
  const baseSpan = high - low;
  if (!(baseSpan > 0)) return { min: low, max: high };
  const floorSpan = Number.isFinite(minSpan) && minSpan > 0 ? Math.max(1, Math.round(minSpan)) : MIN_ZOOM_SPAN_SEMITONES;
  const safeZoom = Number.isFinite(zoom) && zoom > 1 ? zoom : 1;
  const span = clamp(Math.round(baseSpan / safeZoom), Math.min(floorSpan, baseSpan), baseSpan);
  if (span >= baseSpan) return { min: low, max: high };
  const focus = focusBoundsOf(focusMidi);
  const center = focus ? (focus.min + focus.max) / 2 : (low + high) / 2;
  const min = clamp(Math.round(center - span / 2), low, high - span);
  return { min, max: min + span };
}

/**
 * Palier de zoom voisin : `direction` > 0 agrandit, < 0 réduit. Une valeur hors
 * palier (ou inexploitable) retombe sur le palier le plus proche, et les bornes
 * ×1 / ×3 ne sont jamais dépassées.
 */
export function stepZoom(level: number, direction: number): number {
  const steps: readonly number[] = ZOOM_STEPS;
  const current = Number.isFinite(level)
    ? steps.reduce((best, step) => (Math.abs(step - level) < Math.abs(best - level) ? step : best), steps[0])
    : steps[0];
  const shift = direction > 0 ? 1 : direction < 0 ? -1 : 0;
  return steps[clamp(steps.indexOf(current) + shift, 0, steps.length - 1)];
}
