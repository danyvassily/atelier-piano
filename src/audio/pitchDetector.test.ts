import { describe, expect, it } from "vitest";
import { detectPitch } from "./pitchDetector";

function sine(frequency: number, amplitude = 0.025, sampleRate = 44_100, length = 4096): Float32Array {
  return Float32Array.from(
    { length },
    (_, index) => amplitude * Math.sin(2 * Math.PI * frequency * index / sampleRate),
  );
}

function pianoLike(frequency: number, sampleRate = 44_100, length = 4096): Float32Array {
  return Float32Array.from({ length }, (_, index) => {
    const phase = 2 * Math.PI * frequency * index / sampleRate;
    return 0.014 * Math.sin(phase) + 0.019 * Math.sin(phase * 2) + 0.006 * Math.sin(phase * 3);
  });
}

describe("détecteur de hauteur", () => {
  it("reconnaît un La4 à faible volume", () => {
    const pitch = detectPitch(sine(440), 44_100, 0.004);
    expect(pitch).not.toBeNull();
    expect(pitch?.midi).toBe(69);
    expect(pitch?.frequency).toBeCloseTo(440, 0);
    expect(pitch?.clarity).toBeGreaterThan(0.9);
  });

  it("ignore le silence sous le seuil calibré", () => {
    expect(detectPitch(sine(440, 0.001), 44_100, 0.004)).toBeNull();
  });

  it("retrouve la fondamentale d’un son riche en harmoniques", () => {
    const pitch = detectPitch(pianoLike(220), 44_100, 0.004);
    expect(pitch?.midi).toBe(57);
    expect(pitch?.frequency).toBeCloseTo(220, 0);
  });
});
