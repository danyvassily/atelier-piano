// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DEMO_MUSIC_XML } from "../demo";
import { parseYouTubeUrl } from "../media/youtube";
import { scoreToAbc } from "./abc";
import { scoreToMusicXml } from "./exportFormats";
import { createLessonPlan, createStepByStepTargets, groupNotesForPractice, notesForStage } from "./lessons";
import { parseLilyPond } from "./lilypond";
import { parseMusicXml } from "./musicXml";

describe("formats de sortie", () => {
  it("exporte une partition à deux voix en ABC", () => {
    const abc = scoreToAbc(parseMusicXml(DEMO_MUSIC_XML));
    expect(abc).toContain("V:RH clef=treble");
    expect(abc).toContain("V:LH clef=bass");
    expect(abc).toContain("[V:RH]");
    expect(abc).toContain("K:C");
  });

  it("génère une fenêtre de portée avec la note active marquée", () => {
    const score = parseMusicXml(DEMO_MUSIC_XML);
    const note = score.notes.find((item) => item.measure === 3)!;
    const abc = scoreToAbc(score, { measureStart: 3, measureEnd: 4, activeNoteIds: [note.id] });
    expect(abc).toContain("!accent!");
    expect(abc.match(/\|/g)?.length).toBe(4);
  });

  it("produit un MusicXML relisible pour une partition dérivée", () => {
    const score = parseMusicXml(DEMO_MUSIC_XML);
    score.sourceType = "transcription";
    score.rawText = undefined;
    const exported = scoreToMusicXml(score);
    const reparsed = parseMusicXml(exported);
    expect(reparsed.measureCount).toBe(score.measureCount);
    expect(reparsed.notes.length).toBeGreaterThan(20);
  });
});

describe("sources et exercices avancés", () => {
  it("reconnaît une source LilyPond sans prétendre l’avoir convertie", () => {
    const score = parseLilyPond(String.raw`\version "2.24.4" \header { title = "Essai" composer = "Piano" } \time 3/4 \tempo 4=70 \new PianoStaff << >>`, "essai.ly");
    expect(score.sourceType).toBe("lilypond");
    expect(score.title).toBe("Essai");
    expect(score.timeSignature).toEqual([3, 4]);
    expect(score.bpm).toBe(70);
    expect(score.notes).toEqual([]);
  });

  it("regroupe les notes simultanées comme un accord attendu", () => {
    const score = parseMusicXml(DEMO_MUSIC_XML);
    const stage = createLessonPlan(score)[0];
    const groups = groupNotesForPractice(notesForStage(score, stage));
    expect(groups.some((group) => group.midis.length > 1)).toBe(true);
  });

  it("décompose les accords en cibles successives pour le microphone", () => {
    const score = parseMusicXml(DEMO_MUSIC_XML);
    const notes = notesForStage(score, createLessonPlan(score)[0]);
    const targets = createStepByStepTargets(notes);
    expect(targets.length).toBeGreaterThan(groupNotesForPractice(notes).length);
    expect(targets.every((target) => target.midis.length === 1)).toBe(true);
  });

  it("lit les URL YouTube usuelles et leur horodatage", () => {
    expect(parseYouTubeUrl("https://youtu.be/dQw4w9WgXcQ?t=1m30s")).toEqual({ videoId: "dQw4w9WgXcQ", startSeconds: 90 });
    expect(parseYouTubeUrl("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });
});
