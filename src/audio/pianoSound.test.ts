import { describe, expect, it } from "vitest";
import { pianoTimbre } from "./pianoSound";

describe("timbre du piano", () => {
  it("convertit les vélocités MIDI et normalisées de la même façon", () => {
    expect(pianoTimbre(60, 64).velocity).toBeCloseTo(64 / 127);
    expect(pianoTimbre(60, 0.5).velocity).toBeCloseTo(0.5);
  });

  it("rend une frappe forte plus brillante et plus présente", () => {
    const soft = pianoTimbre(60, 24);
    const strong = pianoTimbre(60, 120);
    expect(strong.peakGain).toBeGreaterThan(soft.peakGain);
    expect(strong.cutoffHz).toBeGreaterThan(soft.cutoffHz);
  });

  it("conserve davantage les graves et place subtilement les registres", () => {
    const bass = pianoTimbre(33, 90);
    const treble = pianoTimbre(84, 90);
    expect(bass.decaySeconds).toBeGreaterThan(treble.decaySeconds);
    expect(bass.pan).toBeLessThan(0);
    expect(treble.pan).toBeGreaterThan(0);
  });

  it("borne les valeurs invalides aux limites d’un piano 88 touches", () => {
    const low = pianoTimbre(Number.NEGATIVE_INFINITY, -50);
    const high = pianoTimbre(200, 500);
    expect(low.frequency).toBeCloseTo(261.625, 2);
    expect(low.velocity).toBe(0.04);
    expect(high.velocity).toBe(1);
    expect(high.pan).toBeLessThanOrEqual(0.32);
  });
});
