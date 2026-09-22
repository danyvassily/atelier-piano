import type { LessonStage, ScoreDocument } from "../types";

export interface PracticeGroup {
  id: string;
  onsetBeats: number;
  measure: number;
  noteIds: string[];
  midis: number[];
}

export function createLessonPlan(score: ScoreDocument): LessonStage[] {
  if (!score.notes.length) return [];

  const stages: LessonStage[] = [
    {
      id: "listen-full",
      kind: "listen",
      title: "Écouter la partition",
      instruction: "Repérez la pulsation, la mélodie et les changements de position.",
      hand: "both",
      measureStart: 1,
      measureEnd: score.measureCount,
      tempoFactor: 0.8,
    },
  ];

  const chunkSize = score.measureCount > 16 ? 8 : 4;
  for (let start = 1; start <= score.measureCount; start += chunkSize) {
    const end = Math.min(score.measureCount, start + chunkSize - 1);
    const range = start === end ? `mesure ${start}` : `mesures ${start} à ${end}`;
    const notesInRange = score.notes.filter((note) => note.measure >= start && note.measure <= end);

    if (notesInRange.some((note) => note.hand === "right")) {
      stages.push({
        id: `right-${start}-${end}`,
        kind: "right",
        title: `Main droite, ${range}`,
        instruction: "Jouez lentement. La partition attend chaque note avant de continuer.",
        hand: "right",
        measureStart: start,
        measureEnd: end,
        tempoFactor: 0.55,
      });
    }

    if (notesInRange.some((note) => note.hand === "left")) {
      stages.push({
        id: `left-${start}-${end}`,
        kind: "left",
        title: `Main gauche, ${range}`,
        instruction: "Stabilisez les basses et gardez un geste souple.",
        hand: "left",
        measureStart: start,
        measureEnd: end,
        tempoFactor: 0.5,
      });
    }

    stages.push({
      id: `together-${start}-${end}`,
      kind: "together",
      title: `Mains ensemble, ${range}`,
      instruction: "Assemblez les deux mains à tempo réduit, sans accélérer.",
      hand: "both",
      measureStart: start,
      measureEnd: end,
      tempoFactor: 0.65,
    });
  }

  stages.push({
    id: "performance-full",
    kind: "performance",
    title: "Jouer le morceau entier",
    instruction: "Jouez du début à la fin et utilisez le bilan pour choisir le prochain passage à travailler.",
    hand: "both",
    measureStart: 1,
    measureEnd: score.measureCount,
    tempoFactor: 0.9,
  });

  return stages;
}

export function notesForStage(score: ScoreDocument, stage: LessonStage) {
  return score.notes.filter(
    (note) =>
      note.measure >= stage.measureStart &&
      note.measure <= stage.measureEnd &&
      (stage.hand === "both" || note.hand === stage.hand),
  );
}

export function groupNotesForPractice(notes: ReturnType<typeof notesForStage>): PracticeGroup[] {
  const groups = new Map<string, PracticeGroup>();
  notes.forEach((note) => {
    const onsetKey = note.onsetBeats.toFixed(3);
    const current = groups.get(onsetKey) || {
      id: `group-${onsetKey}`,
      onsetBeats: note.onsetBeats,
      measure: note.measure,
      noteIds: [],
      midis: [],
    };
    current.noteIds.push(note.id);
    if (!current.midis.includes(note.midi)) current.midis.push(note.midi);
    current.midis.sort((a, b) => a - b);
    groups.set(onsetKey, current);
  });
  return [...groups.values()].sort((a, b) => a.onsetBeats - b.onsetBeats);
}
