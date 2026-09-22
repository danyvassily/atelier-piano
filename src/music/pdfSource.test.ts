import { describe, expect, it } from "vitest";
import {
  defaultMeasuresPerPage,
  estimatePdfPage,
  findLinkedPdf,
  findScoresLinkedToPdf,
  pdfLinkCandidates,
  toggleFlaggedMeasure,
} from "./pdfSource";
import type { ScoreDocument } from "../types";

function makeScore(partial: Partial<ScoreDocument> & { id: string }): ScoreDocument {
  return {
    title: partial.id,
    composer: "Test",
    sourceType: "musicxml",
    importedAt: new Date().toISOString(),
    bpm: 80,
    timeSignature: [4, 4],
    measureCount: 0,
    notes: [],
    ...partial,
  };
}

describe("pdfSource", () => {
  it("répartit les mesures sur les pages par défaut", () => {
    expect(defaultMeasuresPerPage(32, 4)).toBe(8);
    expect(defaultMeasuresPerPage(0, 4)).toBe(4);
    expect(defaultMeasuresPerPage(10, 0)).toBe(4);
  });

  it("estime la page d'une mesure", () => {
    expect(estimatePdfPage(1, 32, 4, 8)).toBe(1);
    expect(estimatePdfPage(9, 32, 4, 8)).toBe(2);
    expect(estimatePdfPage(32, 32, 4, 8)).toBe(4);
    expect(estimatePdfPage(99, 32, 4, 8)).toBe(4);
    expect(estimatePdfPage(0, 32, 4, 8)).toBe(1);
  });

  it("retombe sur la répartition uniforme sans calibration", () => {
    expect(estimatePdfPage(17, 32, 4)).toBe(3);
  });

  it("retrouve le PDF lié et les partitions liées", () => {
    const pdf = makeScore({ id: "pdf-1", sourceType: "pdf", binaryData: new ArrayBuffer(8) });
    const linked = makeScore({
      id: "xml-1",
      measureCount: 8,
      notes: [],
      pdfSource: { pdfScoreId: "pdf-1", pdfFileName: "scan.pdf", linkedAt: new Date().toISOString() },
    });
    const other = makeScore({ id: "xml-2" });
    const all = [pdf, linked, other];
    expect(findLinkedPdf(all, linked)?.id).toBe("pdf-1");
    expect(findLinkedPdf(all, other)).toBeUndefined();
    expect(findScoresLinkedToPdf(all, "pdf-1").map((score) => score.id)).toEqual([]);
    const withNotes = { ...linked, notes: [{ id: "n", midi: 60, name: "Do", onsetBeats: 0, durationBeats: 1, measure: 1, hand: "right" as const, velocity: 1 }] };
    expect(findScoresLinkedToPdf([pdf, withNotes, other], "pdf-1").map((score) => score.id)).toEqual(["xml-1"]);
  });

  it("ne propose que des PDF avec données", () => {
    const pdf = makeScore({ id: "pdf-1", sourceType: "pdf", binaryData: new ArrayBuffer(8) });
    const empty = makeScore({ id: "pdf-2", sourceType: "pdf" });
    expect(pdfLinkCandidates([pdf, empty], "xml-1").map((score) => score.id)).toEqual(["pdf-1"]);
    expect(pdfLinkCandidates([pdf, empty], "pdf-1").map((score) => score.id)).toEqual([]);
  });

  it("bascule une mesure signalée", () => {
    expect(toggleFlaggedMeasure(undefined, 5)).toEqual([5]);
    expect(toggleFlaggedMeasure([3, 5], 5)).toEqual([3]);
    expect(toggleFlaggedMeasure([5], 2)).toEqual([2, 5]);
  });
});
