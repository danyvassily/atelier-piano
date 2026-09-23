import { describe, expect, it } from "vitest";
import type { ExpectedNote } from "./scoring";
import { PracticeScorer } from "./scoring";

/** Trois notes de référence : Do4 (mesure 1), Mi4 (mesure 1), Sol4 (mesure 2). */
const SIMPLE: ExpectedNote[] = [
  { id: "n1", midi: 60, onsetSec: 1, measure: 1 },
  { id: "n2", midi: 64, onsetSec: 2, measure: 1 },
  { id: "n3", midi: 67, onsetSec: 3, measure: 2 },
];

describe("jugement des frappes", () => {
  it("valide une note pile à l'heure comme parfaite", () => {
    const scorer = new PracticeScorer(SIMPLE);
    const judgement = scorer.onKeyDown(60, 1);

    expect(judgement).toEqual({ kind: "perfect", noteId: "n1" });
    expect(Object.keys(judgement).sort()).toEqual(["kind", "noteId"]);
    expect(scorer.stats()).toMatchObject({ correct: 1, errors: 0, misses: 0, combo: 1, maxCombo: 1 });
  });

  it("distingue « parfait » (≤ 90 ms) et « bon » dans la fenêtre (± 200 ms)", () => {
    expect(new PracticeScorer(SIMPLE).onKeyDown(60, 1.09)).toEqual({ kind: "perfect", noteId: "n1" });
    expect(new PracticeScorer(SIMPLE).onKeyDown(60, 0.91)).toEqual({ kind: "perfect", noteId: "n1" });
    expect(new PracticeScorer(SIMPLE).onKeyDown(60, 1.1)).toEqual({ kind: "good", noteId: "n1" });
    expect(new PracticeScorer(SIMPLE).onKeyDown(60, 1.15)).toEqual({ kind: "good", noteId: "n1" });
    expect(new PracticeScorer(SIMPLE).onKeyDown(60, 0.8)).toEqual({ kind: "good", noteId: "n1" });
  });

  it("refuse une frappe hors fenêtre, même sur la bonne touche", () => {
    expect(new PracticeScorer(SIMPLE).onKeyDown(60, 1.21)).toEqual({ kind: "wrong" });
    expect(new PracticeScorer(SIMPLE).onKeyDown(60, 0.79)).toEqual({ kind: "wrong" });

    const scorer = new PracticeScorer(SIMPLE);
    expect(scorer.onKeyDown(60, 1.2000001)).toEqual({ kind: "wrong" });
    expect(scorer.stats().errors).toBe(1);
  });

  it("ne peut pas rejouer une note déjà validée", () => {
    const scorer = new PracticeScorer(SIMPLE);
    expect(scorer.onKeyDown(60, 1)).toEqual({ kind: "perfect", noteId: "n1" });
    expect(scorer.onKeyDown(60, 1.05)).toEqual({ kind: "wrong" });

    const stats = scorer.stats();
    expect(stats.correct).toBe(1);
    expect(stats.errors).toBe(1);
    expect(stats.accuracy).toBe(50);
  });

  it("valide chaque note d'un accord indépendamment", () => {
    const chord: ExpectedNote[] = [
      { id: "c1", midi: 60, onsetSec: 1, measure: 1 },
      { id: "c2", midi: 64, onsetSec: 1, measure: 1 },
      { id: "c3", midi: 67, onsetSec: 1, measure: 1 },
    ];
    const scorer = new PracticeScorer(chord);

    expect(scorer.onKeyDown(60, 1.01)).toEqual({ kind: "perfect", noteId: "c1" });
    expect(scorer.onKeyDown(64, 0.98)).toEqual({ kind: "perfect", noteId: "c2" });
    expect(scorer.onKeyDown(67, 0.85)).toEqual({ kind: "good", noteId: "c3" });
    expect(scorer.stats()).toMatchObject({ correct: 3, errors: 0, misses: 0, combo: 3, maxCombo: 3 });
    expect(scorer.pendingNotes()).toEqual([]);
  });

  it("ne consomme aucune note de l'accord quand la frappe est fausse", () => {
    const chord: ExpectedNote[] = [
      { id: "c1", midi: 60, onsetSec: 1, measure: 1 },
      { id: "c2", midi: 64, onsetSec: 1, measure: 1 },
    ];
    const scorer = new PracticeScorer(chord);

    expect(scorer.onKeyDown(63, 1)).toEqual({ kind: "wrong" });
    expect(scorer.stats().errors).toBe(1);
    expect(scorer.onKeyDown(60, 1)).toEqual({ kind: "perfect", noteId: "c1" });
    expect(scorer.onKeyDown(64, 1)).toEqual({ kind: "perfect", noteId: "c2" });
  });

  it("valide la note la plus proche quand une hauteur est répétée", () => {
    const repeated: ExpectedNote[] = [
      { id: "a", midi: 60, onsetSec: 1, measure: 1 },
      { id: "b", midi: 60, onsetSec: 1.15, measure: 1 },
    ];
    const scorer = new PracticeScorer(repeated);

    expect(scorer.onKeyDown(60, 1.14)).toEqual({ kind: "perfect", noteId: "b" });
    expect(scorer.onKeyDown(60, 1)).toEqual({ kind: "perfect", noteId: "a" });
  });

  it("respecte des tolérances personnalisées", () => {
    const strict = new PracticeScorer(SIMPLE, { windowMs: 100, perfectMs: 50 });

    expect(strict.onKeyDown(60, 1.05)).toEqual({ kind: "perfect", noteId: "n1" });
    expect(strict.onKeyDown(64, 1.94)).toEqual({ kind: "good", noteId: "n2" });
    expect(strict.onKeyDown(67, 3.15)).toEqual({ kind: "wrong" });
    expect(strict.stats().errors).toBe(1);
  });
});

describe("erreurs", () => {
  it("compte une seule erreur par pression, rattachée à la mesure la plus proche", () => {
    const scorer = new PracticeScorer(SIMPLE);

    expect(scorer.onKeyDown(61, 1)).toEqual({ kind: "wrong" });
    expect(scorer.onKeyDown(61, 1.1)).toEqual({ kind: "wrong" });
    expect(scorer.onKeyDown(61, 2.9)).toEqual({ kind: "wrong" });

    const stats = scorer.stats();
    expect(stats.errors).toBe(3);
    expect(stats.errorsByMeasure).toEqual({ 1: 2, 2: 1 });

    // La frappe fausse n'a rien consommé : la note attendue reste jouable.
    expect(scorer.onKeyDown(67, 3)).toEqual({ kind: "perfect", noteId: "n3" });
    expect(scorer.stats().correct).toBe(1);
  });

  it("n'enregistre rien quand aucune note n'est attendue", () => {
    const scorer = new PracticeScorer([]);

    expect(scorer.onKeyDown(60, 1)).toEqual({ kind: "wrong" });
    expect(scorer.stats()).toEqual({
      correct: 0,
      errors: 1,
      misses: 0,
      combo: 0,
      maxCombo: 0,
      accuracy: 0,
      errorsByMeasure: {},
    });
  });
});

describe("miss et mode attente", () => {
  it("signale une note expirée une seule fois, dans l'ordre de la partition", () => {
    const scorer = new PracticeScorer(SIMPLE);

    expect(scorer.tick(1.1)).toEqual([]);
    expect(scorer.tick(1.2)).toEqual([]);
    expect(scorer.tick(1.21)).toEqual([{ kind: "miss", noteId: "n1" }]);
    expect(scorer.tick(1.5)).toEqual([]);
    expect(scorer.tick(10)).toEqual([
      { kind: "miss", noteId: "n2" },
      { kind: "miss", noteId: "n3" },
    ]);

    const stats = scorer.stats();
    expect(stats.misses).toBe(3);
    expect(stats.correct).toBe(0);
    expect(stats.accuracy).toBe(0);
  });

  it("ne manque ni une note validée ni une note déjà manquée", () => {
    const scorer = new PracticeScorer(SIMPLE);
    scorer.onKeyDown(60, 1);

    expect(scorer.tick(5)).toEqual([
      { kind: "miss", noteId: "n2" },
      { kind: "miss", noteId: "n3" },
    ]);
    expect(scorer.tick(99)).toEqual([]);
    expect(scorer.stats().misses).toBe(2);
  });

  it("gèle le temps en mode attente jusqu'à désactivation", () => {
    const scorer = new PracticeScorer(SIMPLE);
    scorer.enableWaitMode(true);

    expect(scorer.tick(99)).toEqual([]);
    expect(scorer.stats().misses).toBe(0);
    expect(scorer.pendingNotes().map((note) => note.id)).toEqual(["n1", "n2", "n3"]);
    expect(scorer.onKeyDown(60, 1)).toEqual({ kind: "perfect", noteId: "n1" });

    scorer.enableWaitMode(false);
    expect(scorer.tick(99)).toEqual([
      { kind: "miss", noteId: "n2" },
      { kind: "miss", noteId: "n3" },
    ]);
  });
});

describe("statistiques", () => {
  it("suit la série en cours et la meilleure série", () => {
    const scorer = new PracticeScorer(SIMPLE);

    scorer.onKeyDown(60, 1);
    scorer.onKeyDown(64, 2);
    expect(scorer.stats()).toMatchObject({ combo: 2, maxCombo: 2 });

    scorer.onKeyDown(61, 2.5);
    expect(scorer.stats()).toMatchObject({ combo: 0, maxCombo: 2, errors: 1 });

    scorer.onKeyDown(67, 3);
    expect(scorer.stats()).toMatchObject({ combo: 1, maxCombo: 2 });
  });

  it("casse la série sur une note manquée", () => {
    const scorer = new PracticeScorer(SIMPLE);
    scorer.onKeyDown(60, 1);
    scorer.tick(5);

    expect(scorer.stats()).toMatchObject({ combo: 0, maxCombo: 1, misses: 2 });
  });

  it("arrondit la justesse sur les trois compteurs", () => {
    const scorer = new PracticeScorer(SIMPLE);
    scorer.onKeyDown(60, 1);
    scorer.onKeyDown(64, 2);
    scorer.onKeyDown(61, 3);

    expect(scorer.stats().accuracy).toBe(67);

    const failed = new PracticeScorer(SIMPLE);
    failed.onKeyDown(60, 1);
    failed.onKeyDown(61, 1);
    failed.tick(9);

    expect(failed.stats()).toMatchObject({ correct: 1, errors: 1, misses: 2, accuracy: 25 });
  });

  it("projette vers PracticeStats et renvoie des copies", () => {
    const scorer = new PracticeScorer(SIMPLE);
    scorer.onKeyDown(64, 2);
    scorer.onKeyDown(60, 1);
    scorer.onKeyDown(59, 1);

    const practice = scorer.toPracticeStats();
    expect(practice).toEqual({
      correct: 2,
      errors: 1,
      streak: 0,
      bestStreak: 2,
      completedNoteIds: ["n1", "n2"],
      errorsByMeasure: { 1: 1 },
    });

    practice.completedNoteIds.push("intrus");
    if (practice.errorsByMeasure) practice.errorsByMeasure[1] = 99;
    expect(scorer.toPracticeStats().completedNoteIds).toEqual(["n1", "n2"]);
    expect(scorer.stats().errorsByMeasure).toEqual({ 1: 1 });
  });

  it("remet tout à zéro sans perdre la partition", () => {
    const scorer = new PracticeScorer(SIMPLE);
    scorer.onKeyDown(60, 1);
    scorer.onKeyDown(61, 1);
    scorer.onKeyDown(64, 2);
    scorer.tick(9);
    expect(scorer.isComplete()).toBe(true);

    scorer.reset();

    expect(scorer.stats()).toEqual({
      correct: 0,
      errors: 0,
      misses: 0,
      combo: 0,
      maxCombo: 0,
      accuracy: 0,
      errorsByMeasure: {},
    });
    expect(scorer.toPracticeStats().completedNoteIds).toEqual([]);
    expect(scorer.isComplete()).toBe(false);
    expect(scorer.pendingNotes()).toHaveLength(3);
    expect(scorer.onKeyDown(60, 1)).toEqual({ kind: "perfect", noteId: "n1" });
  });
});

describe("prise en charge de la partition", () => {
  it("tolère un ordre quelconque et ne modifie pas la liste fournie", () => {
    const unordered: ExpectedNote[] = [
      { id: "n3", midi: 67, onsetSec: 3, measure: 2 },
      { id: "n1", midi: 60, onsetSec: 1, measure: 1 },
      { id: "n2", midi: 64, onsetSec: 2, measure: 1 },
    ];
    const snapshot = unordered.map((note) => ({ ...note }));

    const scorer = new PracticeScorer(unordered);
    scorer.onKeyDown(64, 2);
    scorer.onKeyDown(60, 1);

    expect(scorer.toPracticeStats().completedNoteIds).toEqual(["n1", "n2"]);
    expect(scorer.pendingNotes().map((note) => note.id)).toEqual(["n3"]);
    expect(scorer.isComplete()).toBe(false);
    expect(unordered).toEqual(snapshot);
  });

  it("considère le passage terminé une fois tout joué ou manqué", () => {
    const scorer = new PracticeScorer(SIMPLE);
    expect(scorer.isComplete()).toBe(false);

    scorer.onKeyDown(60, 1);
    scorer.tick(2.5);
    expect(scorer.isComplete()).toBe(false);

    expect(scorer.tick(3.5)).toEqual([{ kind: "miss", noteId: "n3" }]);
    expect(scorer.isComplete()).toBe(true);
    expect(scorer.stats()).toMatchObject({ correct: 1, misses: 2, accuracy: 33 });
  });
});
