// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DEMO_MUSIC_XML } from "../demo";
import { createLessonPlan, notesForStage } from "./lessons";
import { parseMusicXml } from "./musicXml";

describe("MusicXML", () => {
  it("lit la partition de démonstration", () => {
    const score = parseMusicXml(DEMO_MUSIC_XML);

    expect(score.title).toBe("Premiers pas en do");
    expect(score.composer).toBe("Exercice Atelier Piano");
    expect(score.measureCount).toBe(8);
    expect(score.bpm).toBe(84);
    expect(score.timeSignature).toEqual([4, 4]);
    expect(score.notes.length).toBeGreaterThan(20);
    expect(score.notes.every((note) => Number.isFinite(note.onsetBeats))).toBe(true);
    expect(score.notes.some((note) => note.hand === "left")).toBe(true);
    expect(score.notes.some((note) => note.hand === "right")).toBe(true);
  });

  it("rejette un fichier qui n’est pas une partition", () => {
    expect(() => parseMusicXml("<document />")).toThrow(/Aucune partition/);
  });
});

describe("générateur de cours", () => {
  it("crée écoute, mains séparées et interprétation", () => {
    const score = parseMusicXml(DEMO_MUSIC_XML);
    const stages = createLessonPlan(score);

    expect(stages[0].kind).toBe("listen");
    expect(stages.some((stage) => stage.kind === "right")).toBe(true);
    expect(stages.some((stage) => stage.kind === "left")).toBe(true);
    expect(stages.at(-1)?.kind).toBe("performance");
  });

  it("filtre correctement une étape main gauche", () => {
    const score = parseMusicXml(DEMO_MUSIC_XML);
    const leftStage = createLessonPlan(score).find((stage) => stage.kind === "left")!;
    const notes = notesForStage(score, leftStage);

    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((note) => note.hand === "left")).toBe(true);
  });
});
