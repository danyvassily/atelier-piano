import type { PracticeStats } from "../types";

/**
 * Système de score et de jugement du mode pratique.
 *
 * Le scoreur reçoit la liste des notes attendues (avec leur temps d'attaque en secondes) et
 * rend un jugement à chaque frappe (`onKeyDown`) ainsi que les notes manquées (`tick`).
 * Il est volontairement sans dépendance ni horloge interne : l'appelant fournit `nowSec`,
 * ce qui rend le tout testable en temps simulé.
 */

/** Note attendue, exprimée en temps réel (l'appelant convertit les temps musicaux en secondes). */
export interface ExpectedNote {
  id: string;
  midi: number;
  onsetSec: number;
  measure: number;
}

/** Résultat d'un jugement : `perfect`/`good` sur une note validée, `wrong` sur une frappe à côté, `miss` sur une note expirée. */
export type JudgementKind = "perfect" | "good" | "miss" | "wrong";

export interface Judgement {
  kind: JudgementKind;
  /** Id de la note attendue concernée ; absent pour une frappe ne correspondant à aucune note. */
  noteId?: string;
}

export interface ScorerOptions {
  /** Demi-fenêtre de tolérance autour du temps attendu, en millisecondes (200 par défaut). */
  windowMs?: number;
  /** Écart maximal pour un jugement « parfait », en millisecondes (90 par défaut). */
  perfectMs?: number;
}

export interface ScorerStats {
  correct: number;
  errors: number;
  misses: number;
  combo: number;
  maxCombo: number;
  /** Justesse en pourcentage arrondi (0..100). */
  accuracy: number;
  errorsByMeasure: Record<number, number>;
}

const DEFAULT_WINDOW_MS = 200;
const DEFAULT_PERFECT_MS = 90;
/** Tolérance flottante : une frappe pile sur le bord de la fenêtre compte comme dedans. */
const EPSILON = 1e-9;

export class PracticeScorer {
  private readonly notes: ExpectedNote[];
  private readonly windowSec: number;
  private readonly perfectSec: number;
  private hit: boolean[];
  private missed: boolean[];
  private correctCount = 0;
  private errorCount = 0;
  private missCount = 0;
  private comboCount = 0;
  private bestCombo = 0;
  private errorsPerMeasure: Record<number, number> = {};
  private waitMode = false;

  constructor(expected: readonly ExpectedNote[], opts: ScorerOptions = {}) {
    // Copie triée par temps d'attaque : l'ordre d'appel ne change rien et l'entrée n'est jamais modifiée.
    this.notes = [...expected].sort((a, b) => a.onsetSec - b.onsetSec);
    this.windowSec = (opts.windowMs ?? DEFAULT_WINDOW_MS) / 1000;
    this.perfectSec = (opts.perfectMs ?? DEFAULT_PERFECT_MS) / 1000;
    this.hit = this.notes.map(() => false);
    this.missed = this.notes.map(() => false);
  }

  /**
   * Juge une frappe de touche. Une note attendue de même hauteur, encore libre et dans sa fenêtre
   * est validée (une seule fois) ; la plus proche temporellement l'emporte, ce qui gère les accords
   * (chaque note d'un accord est validée indépendamment) comme les hauteurs répétées.
   * Aucune note disponible dans la fenêtre : une erreur, jamais plus, pour cette pression.
   */
  onKeyDown(midi: number, nowSec: number): Judgement {
    let bestIndex = -1;
    let bestDelta = Number.POSITIVE_INFINITY;

    for (let index = 0; index < this.notes.length; index += 1) {
      if (this.hit[index] || this.missed[index]) continue;
      const note = this.notes[index];
      if (note.midi !== midi) continue;
      const delta = Math.abs(nowSec - note.onsetSec);
      if (delta > this.windowSec + EPSILON) continue;
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIndex = index;
      }
    }

    if (bestIndex < 0) {
      this.recordError(nowSec);
      return { kind: "wrong" };
    }

    this.hit[bestIndex] = true;
    this.correctCount += 1;
    this.comboCount += 1;
    if (this.comboCount > this.bestCombo) this.bestCombo = this.comboCount;

    return {
      kind: bestDelta <= this.perfectSec + EPSILON ? "perfect" : "good",
      noteId: this.notes[bestIndex].id,
    };
  }

  /**
   * Signale les notes dont la fenêtre vient d'expirer sans être validées (mode chronométré).
   * Chaque note n'est signalée qu'une fois, dans l'ordre de la partition.
   * En mode attente, le temps n'expire pas : rien n'est jamais manqué.
   */
  tick(nowSec: number): Judgement[] {
    if (this.waitMode) return [];

    const misses: Judgement[] = [];
    for (let index = 0; index < this.notes.length; index += 1) {
      const note = this.notes[index];
      if (this.hit[index] || this.missed[index]) continue;
      if (nowSec <= note.onsetSec + this.windowSec + EPSILON) continue;
      this.missed[index] = true;
      this.missCount += 1;
      misses.push({ kind: "miss", noteId: note.id });
    }

    if (misses.length > 0) this.comboCount = 0;
    return misses;
  }

  /** Active ou désactive le mode attente (désactivé par défaut) : aucune note n'expire tant qu'on attend. */
  enableWaitMode(enabled = true): void {
    this.waitMode = enabled;
  }

  stats(): ScorerStats {
    const total = this.correctCount + this.errorCount + this.missCount;
    return {
      correct: this.correctCount,
      errors: this.errorCount,
      misses: this.missCount,
      combo: this.comboCount,
      maxCombo: this.bestCombo,
      accuracy: total > 0 ? Math.round((this.correctCount / total) * 100) : 0,
      errorsByMeasure: { ...this.errorsPerMeasure },
    };
  }

  /** Projection vers le type `PracticeStats` déjà utilisé par la progression (mesures faibles, série, notes faites). */
  toPracticeStats(): PracticeStats {
    const completedNoteIds: string[] = [];
    for (let index = 0; index < this.notes.length; index += 1) {
      if (this.hit[index]) completedNoteIds.push(this.notes[index].id);
    }

    return {
      correct: this.correctCount,
      errors: this.errorCount,
      streak: this.comboCount,
      bestStreak: this.bestCombo,
      completedNoteIds,
      errorsByMeasure: { ...this.errorsPerMeasure },
    };
  }

  /** Remet le score à zéro et rend toutes les notes rejouables (la partition et le mode attente sont conservés). */
  reset(): void {
    this.hit = this.notes.map(() => false);
    this.missed = this.notes.map(() => false);
    this.correctCount = 0;
    this.errorCount = 0;
    this.missCount = 0;
    this.comboCount = 0;
    this.bestCombo = 0;
    this.errorsPerMeasure = {};
  }

  /** Vrai quand chaque note attendue a été validée ou manquée. */
  isComplete(): boolean {
    for (let index = 0; index < this.notes.length; index += 1) {
      if (!this.hit[index] && !this.missed[index]) return false;
    }
    return true;
  }

  /** Notes encore ni validées ni manquées, dans l'ordre de la partition (cibles à mettre en évidence). */
  pendingNotes(): ExpectedNote[] {
    const pending: ExpectedNote[] = [];
    for (let index = 0; index < this.notes.length; index += 1) {
      if (!this.hit[index] && !this.missed[index]) pending.push(this.notes[index]);
    }
    return pending;
  }

  /** Une erreur enregistrée : une seule par pression, rattachée à la mesure la plus proche dans le temps. */
  private recordError(nowSec: number): void {
    this.errorCount += 1;
    this.comboCount = 0;
    const measure = this.nearestMeasure(nowSec);
    if (measure === null) return;
    this.errorsPerMeasure[measure] = (this.errorsPerMeasure[measure] ?? 0) + 1;
  }

  /** Mesure la plus proche du moment de la frappe, pour alimenter « mesures à revoir ». */
  private nearestMeasure(nowSec: number): number | null {
    let nearest: ExpectedNote | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const note of this.notes) {
      const delta = Math.abs(nowSec - note.onsetSec);
      if (delta < bestDelta) {
        bestDelta = delta;
        nearest = note;
      }
    }
    return nearest ? nearest.measure : null;
  }
}
