import type { ScoreDocument } from "../types";

/**
 * Helpers v0.3 « PDF personnel » — 100 % locaux, sans serveur.
 * L'estimation page ↔ mesure est une approximation assumée : sans OMR
 * embarquée, on répartit les mesures uniformément sur les pages du PDF.
 * L'utilisateur peut calibrer `measuresPerPage` dans l'interface.
 */

export function defaultMeasuresPerPage(measureCount: number, pageCount: number): number {
  if (measureCount <= 0 || pageCount <= 0) return 4;
  return Math.max(1, Math.round(measureCount / pageCount));
}

/** Page estimée (1-based) contenant la mesure donnée. */
export function estimatePdfPage(
  measure: number,
  measureCount: number,
  pageCount: number,
  measuresPerPage?: number,
): number {
  if (pageCount <= 0) return 1;
  const perPage = measuresPerPage && measuresPerPage > 0
    ? measuresPerPage
    : defaultMeasuresPerPage(measureCount, pageCount);
  const safeMeasure = Math.min(Math.max(1, measure), Math.max(1, measureCount));
  return Math.min(pageCount, Math.max(1, Math.ceil(safeMeasure / perPage)));
}

/** Retrouve le PDF source lié dans la bibliothèque locale. */
export function findLinkedPdf(allScores: ScoreDocument[], score: ScoreDocument): ScoreDocument | undefined {
  const pdfId = score.pdfSource?.pdfScoreId;
  if (!pdfId) return undefined;
  return allScores.find((candidate) => candidate.id === pdfId && candidate.binaryData);
}

/** Partitions exploitables (avec notes) liées à un PDF donné. */
export function findScoresLinkedToPdf(allScores: ScoreDocument[], pdfScoreId: string): ScoreDocument[] {
  return allScores.filter((candidate) => candidate.pdfSource?.pdfScoreId === pdfScoreId && candidate.notes.length > 0);
}

/** Candidats PDF pour une liaison (PDF avec données, autre que le score lui-même). */
export function pdfLinkCandidates(allScores: ScoreDocument[], excludeId: string): ScoreDocument[] {
  return allScores.filter(
    (candidate) => candidate.id !== excludeId && candidate.sourceType === "pdf" && candidate.binaryData,
  );
}

export function toggleFlaggedMeasure(flagged: number[] | undefined, measure: number): number[] {
  const current = flagged ?? [];
  if (current.includes(measure)) return current.filter((value) => value !== measure).sort((a, b) => a - b);
  return [...current, measure].sort((a, b) => a - b);
}
