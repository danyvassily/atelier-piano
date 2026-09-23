import type { ScoreDocument } from "../types";
import { beatsToSeconds, loopProgress, secondsToBeats } from "./timeline";

/**
 * Transport du mode Synthesia : horloge PURE en secondes réelles, boucle A–B,
 * mode attente et complétion de plage.
 *
 * Le transport ne connaît ni le DOM, ni `requestAnimationFrame`, ni la partition :
 * l’appelant lui donne le pas de temps écoulé (`advance(dt)`) et la liste des
 * notes encore à jouer. Tout est donc rejouable en temps simulé dans les tests.
 *
 * Sémantique du MODE ATTENTE : dès que la prochaine note non jouée atteint la
 * ligne de frappe, l’horloge se fige exactement sur son attaque
 * (`time = max(time, attaque)`) et `frozen` passe à vrai. Elle repart dès que
 * cette note disparaît de la liste des notes en attente (donc quand l’élève l’a
 * jouée). Une note dont l’attaque est déjà DERRIÈRE l’horloge (saut de boucle,
 * déplacement manuel, mode attente activé en cours de lecture) est considérée
 * comme dépassée : elle ne fige pas la lecture, sinon elle la bloquerait pour
 * toujours.
 */

/** Tolérance flottante : une attaque pile sur l’horloge compte comme atteinte. */
const EPSILON_SEC = 1e-6;

/** Plage de boucle, exprimée en secondes réelles. */
export interface TransportLoop {
  startSec: number;
  endSec: number;
}

/** Plage de lecture [début, fin] en secondes réelles. */
export interface TransportRange {
  startSec: number;
  endSec: number;
}

/** Note encore à jouer, vue par le transport (compatible avec `ExpectedNote`). */
export interface TransportPendingNote {
  onsetSec: number;
  id?: string;
}

/** État complet du transport après un pas de temps. */
export interface TransportSnapshot {
  /** Position courante, en secondes réelles. */
  time: number;
  /** Vrai quand l’horloge est retenue par une note non jouée (mode attente). */
  frozen: boolean;
  /** Vrai quand la plage est terminée (jamais vrai en boucle). */
  completed: boolean;
}

export interface TransportOptions {
  /** Tempo nominal de la partition, en BPM (120 par défaut). */
  bpm?: number;
  /** Mesure [temps, valeur du temps] ; sert aux conversions en mesures. */
  timeSignature?: [number, number];
  /** Facteur de tempo appliqué (1 = tempo nominal). */
  tempoFactor?: number;
  /** Début de la plage de lecture, en secondes. */
  rangeStartSec?: number;
  /** Fin de la plage de lecture, en secondes. */
  rangeEndSec?: number;
  /** Boucle A–B active, ou `null` (aucune boucle). */
  loop?: TransportLoop | null;
  /** Mode attente : la lecture se fige sur chaque note non jouée. */
  waitMode?: boolean;
}

export interface Transport {
  readonly bpm: number;
  readonly timeSignature: [number, number];
  readonly tempoFactor: number;
  readonly playing: boolean;
  readonly time: number;
  readonly frozen: boolean;
  readonly completed: boolean;
  readonly range: TransportRange;
  readonly loop: TransportLoop | null;
  readonly waitMode: boolean;
  /** Démarre la lecture ; après une fin de plage, repart du début. */
  play(): void;
  /** Met la lecture en pause (l’horloge ne bouge plus, rien n’est « attendu »). */
  pause(): void;
  /** Bascule lecture/pause. */
  toggle(): void;
  /** Déplace l’horloge (bornée à la plage) et annule l’état « terminé ». */
  seek(timeSec: number): number;
  /** Reviens au début de la plage, à l’arrêt, sans rien avoir terminé. */
  reset(): void;
  /** Applique une nouvelle configuration en conservant au mieux la position. */
  configure(options: TransportOptions): void;
  setTempoFactor(tempoFactor: number): void;
  setRange(startSec: number, endSec: number): void;
  setLoop(loop: TransportLoop | null): void;
  setWaitMode(enabled: boolean): void;
  /** Avance de `dtRealSeconds` secondes réelles et rend l’état courant. */
  advance(dtRealSeconds: number, pendingNotes?: readonly TransportPendingNote[]): TransportSnapshot;
  /** Conversion temps (beats) → secondes, au tempo courant du transport. */
  timeForBeats(beats: number): number;
  /** Conversion secondes → temps (beats), au tempo courant du transport. */
  beatsAt(timeSec: number): number;
  /** État courant sans avancer l’horloge. */
  snapshot(): TransportSnapshot;
}

/** Partition réduite au strict nécessaire pour les conversions mesures ↔ secondes. */
export type TransportScore = Pick<ScoreDocument, "bpm" | "timeSignature" | "measureCount">;
/** Partition avec ses notes, pour mesurer la durée réellement jouée. */
export type TransportScoreWithNotes = TransportScore & Pick<ScoreDocument, "notes">;

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveOr(value: number | undefined, fallback: number): number {
  const candidate = finiteOr(value, fallback);
  return candidate > 0 ? candidate : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Mesure [temps, valeur du temps] exploitable (sinon 4/4). */
function sanitizeTimeSignature(signature: [number, number] | undefined): [number, number] {
  const beats = Math.round(finiteOr(signature?.[0], 4));
  const beatType = Math.round(finiteOr(signature?.[1], 4));
  if (beats < 1 || beatType < 1) return [4, 4];
  return [beats, beatType];
}

/** Plage valide : bornes finies, début ≤ fin (les bornes inversées sont remises d’aplomb). */
function sanitizeRange(startSec: number | undefined, endSec: number | undefined): TransportRange {
  let start = finiteOr(startSec, 0);
  let end = finiteOr(endSec, start);
  if (end < start) [start, end] = [end, start];
  return { startSec: start, endSec: end };
}

/** Boucle valide (durée strictement positive), ou `null` : une boucle vide est ignorée. */
function sanitizeLoop(loop: TransportLoop | null | undefined): TransportLoop | null {
  if (!loop) return null;
  const startSec = finiteOr(loop.startSec, Number.NaN);
  const endSec = finiteOr(loop.endSec, Number.NaN);
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return null;
  if (endSec - startSec <= EPSILON_SEC) return null;
  return { startSec, endSec };
}

/**
 * Attaque de la prochaine note encore à jouer, ou `null` si aucune ne peut
 * retenir la lecture :
 * - notes hors de la section active (plage, ou boucle quand elle est active) ;
 * - notes dont l’attaque est déjà derrière l’horloge (dépassées, jamais bloquantes).
 */
function nextPendingOnset(
  notes: readonly TransportPendingNote[],
  fromTimeSec: number,
  activeStartSec: number,
  activeEndSec: number,
): number | null {
  let next: number | null = null;
  for (const note of notes) {
    const onset = finiteOr(note?.onsetSec, Number.NaN);
    if (!Number.isFinite(onset)) continue;
    if (onset < fromTimeSec - EPSILON_SEC) continue;
    if (onset < activeStartSec - EPSILON_SEC || onset > activeEndSec + EPSILON_SEC) continue;
    if (next === null || onset < next) next = onset;
  }
  return next;
}

/** Crée un transport d’horloge pure, prêt pour le rendu piano-roll. */
export function createTransport(options: TransportOptions = {}): Transport {
  let bpm = positiveOr(options.bpm, 120);
  let timeSignature = sanitizeTimeSignature(options.timeSignature);
  let tempoFactor = positiveOr(options.tempoFactor, 1);
  let range = sanitizeRange(options.rangeStartSec, options.rangeEndSec);
  let loop = sanitizeLoop(options.loop);
  let waitMode = options.waitMode === true;
  let time = range.startSec;
  let playing = false;
  let frozen = false;
  let completed = false;

  function snapshot(): TransportSnapshot {
    return { time, frozen, completed };
  }

  function reset(): void {
    time = range.startSec;
    playing = false;
    frozen = false;
    completed = false;
  }

  function play(): void {
    if (completed) reset();
    playing = true;
    frozen = false;
  }

  function pause(): void {
    playing = false;
    frozen = false;
  }

  function seek(value: number): number {
    time = clamp(finiteOr(value, time), range.startSec, range.endSec);
    completed = false;
    frozen = false;
    return time;
  }

  function applyRange(startSec: number | undefined, endSec: number | undefined): void {
    range = sanitizeRange(startSec, endSec);
    time = clamp(time, range.startSec, range.endSec);
    if (time < range.endSec) completed = false;
  }

  function advance(dtRealSeconds: number, pendingNotes: readonly TransportPendingNote[] = []): TransportSnapshot {
    if (!playing || completed) {
      // À l’arrêt (ou après la fin), rien n’est « attendu » : pas de gel affiché.
      if (!playing) frozen = false;
      return snapshot();
    }
    const dt = finiteOr(dtRealSeconds, Number.NaN);
    if (!Number.isFinite(dt) || dt <= 0) return snapshot();

    let target = time + dt;
    let nextFrozen = false;

    if (waitMode && pendingNotes.length) {
      const activeStartSec = loop ? loop.startSec : range.startSec;
      const activeEndSec = loop ? loop.endSec : range.endSec;
      const onset = nextPendingOnset(pendingNotes, time, activeStartSec, activeEndSec);
      if (onset !== null && onset <= target + EPSILON_SEC) {
        target = Math.max(time, onset);
        nextFrozen = true;
      }
    }

    if (loop) {
      // Boucle A–B : la fin de boucle ramène au début, indéfiniment.
      if (target > loop.endSec) target = loopProgress(target, loop.startSec, loop.endSec);
    } else if (target >= range.endSec) {
      // Fin de plage : l’horloge s’arrête pile sur la fin et la lecture est terminée.
      target = range.endSec;
      completed = true;
      playing = false;
    }

    time = target;
    frozen = nextFrozen && !completed;
    return snapshot();
  }

  function configure(next: TransportOptions): void {
    if (next.bpm !== undefined) bpm = positiveOr(next.bpm, bpm);
    if (next.timeSignature) timeSignature = sanitizeTimeSignature(next.timeSignature);
    if (next.tempoFactor !== undefined) tempoFactor = positiveOr(next.tempoFactor, 1);
    if (next.waitMode !== undefined) waitMode = next.waitMode === true;
    if (next.loop !== undefined) loop = sanitizeLoop(next.loop);
    if (next.rangeStartSec !== undefined || next.rangeEndSec !== undefined) {
      applyRange(next.rangeStartSec ?? range.startSec, next.rangeEndSec ?? range.endSec);
    }
  }

  return {
    get bpm() {
      return bpm;
    },
    get timeSignature() {
      return timeSignature;
    },
    get tempoFactor() {
      return tempoFactor;
    },
    get playing() {
      return playing;
    },
    get time() {
      return time;
    },
    get frozen() {
      return frozen;
    },
    get completed() {
      return completed;
    },
    get range() {
      return { ...range };
    },
    get loop() {
      return loop ? { ...loop } : null;
    },
    get waitMode() {
      return waitMode;
    },
    play,
    pause,
    reset,
    seek,
    configure,
    toggle() {
      if (playing) pause();
      else play();
    },
    setTempoFactor(factor: number) {
      tempoFactor = positiveOr(factor, 1);
    },
    setRange(startSec: number, endSec: number) {
      applyRange(startSec, endSec);
    },
    setLoop(next: TransportLoop | null) {
      loop = sanitizeLoop(next);
    },
    setWaitMode(enabled: boolean) {
      waitMode = enabled === true;
      if (!waitMode) frozen = false;
    },
    advance,
    timeForBeats(beats: number) {
      return beatsToSeconds(beats, bpm, tempoFactor);
    },
    beatsAt(timeSec: number) {
      return secondsToBeats(timeSec, bpm, tempoFactor);
    },
    snapshot,
  };
}

/** Nombre de temps (noires) dans une mesure, d’après l’armure de la partition. */
export function beatsPerMeasureOf(score: Pick<ScoreDocument, "timeSignature">): number {
  const [beats, beatType] = sanitizeTimeSignature(score?.timeSignature);
  return beats * (4 / beatType);
}

/** Mesure (1-based) bornée à celles de la partition. */
export function clampMeasure(score: Pick<ScoreDocument, "measureCount">, measure: number): number {
  const count = Math.max(1, Math.round(finiteOr(score?.measureCount, 1)));
  return clamp(Math.round(finiteOr(measure, 1)), 1, count);
}

/**
 * Plage d’une section de mesures, en secondes réelles : mesure `measureStart`
 * (incluse) → fin de la mesure `measureEnd` (incluse). Les mesures sont ramenées
 * dans celles de la partition et remises dans l’ordre, pour qu’un appelant
 * distrait (champ de saisie vidé, bornes inversées) ne casse pas la lecture.
 */
export function measureRangeToSec(
  score: TransportScore,
  measureStart: number,
  measureEnd: number,
  tempoFactor = 1,
): TransportRange {
  const first = clampMeasure(score, measureStart);
  const last = clampMeasure(score, measureEnd);
  const from = Math.min(first, last);
  const to = Math.max(first, last);
  const beatsPerMeasure = beatsPerMeasureOf(score);
  const bpm = positiveOr(score?.bpm, 120);
  return {
    startSec: beatsToSeconds((from - 1) * beatsPerMeasure, bpm, tempoFactor),
    endSec: beatsToSeconds(to * beatsPerMeasure, bpm, tempoFactor),
  };
}

/** Mesure (1-based) qui contient l’instant donné, bornée à la partition. */
export function secToMeasure(score: TransportScore, atSeconds: number, tempoFactor = 1): number {
  const bpm = positiveOr(score?.bpm, 120);
  const beats = secondsToBeats(finiteOr(atSeconds, 0), bpm, tempoFactor);
  const beatsPerMeasure = beatsPerMeasureOf(score);
  if (!(beatsPerMeasure > 0)) return 1;
  return clampMeasure(score, Math.floor(Math.max(0, beats) / beatsPerMeasure) + 1);
}

/**
 * Durée totale exploitable de la partition, en secondes : la plus tardive entre
 * la fin de la dernière mesure et la fin de la dernière note (une levée ou une
 * note tenue au-delà de la dernière barre restent ainsi jouées en entier).
 */
export function scoreDurationSec(score: TransportScoreWithNotes, tempoFactor = 1): number {
  const beatsPerMeasure = beatsPerMeasureOf(score);
  let beats = Math.max(1, Math.round(finiteOr(score?.measureCount, 1))) * beatsPerMeasure;
  for (const note of score?.notes ?? []) {
    const onset = finiteOr(note?.onsetBeats, Number.NaN);
    if (!Number.isFinite(onset)) continue;
    const duration = Math.max(0, finiteOr(note?.durationBeats, 0));
    beats = Math.max(beats, onset + duration);
  }
  return beatsToSeconds(beats, positiveOr(score?.bpm, 120), tempoFactor);
}

/**
 * Repositionne une position en secondes après un changement de tempo : la
 * position MUSICALE est conservée, seule sa traduction en secondes change
 * (`durée ∝ 1 / facteur`). Un facteur inexploitable retombe sur 1.
 */
export function rescaleTimeForTempo(timeSec: number, fromFactor: number, toFactor: number): number {
  const safeTime = finiteOr(timeSec, 0);
  const from = positiveOr(fromFactor, 1);
  const to = positiveOr(toFactor, 1);
  const scaled = (safeTime * from) / to;
  return Number.isFinite(scaled) ? Math.max(0, scaled) : 0;
}
