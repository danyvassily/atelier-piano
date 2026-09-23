import { describe, expect, it } from "vitest";
import { isTranscribableMedia } from "./importScore";

function fakeFile(name: string, type = ""): File {
  return new File([new Uint8Array([0])], name, { type });
}

describe("isTranscribableMedia — routage d'import des fichiers", () => {
  it("refuse les partitions même quand le navigateur annonce un type audio (bug .mid → audio/midi)", () => {
    expect(isTranscribableMedia(fakeFile("morceau.mid", "audio/midi"))).toBe(false);
    expect(isTranscribableMedia(fakeFile("morceau.midi", "audio/x-midi"))).toBe(false);
    expect(isTranscribableMedia(fakeFile("partition.musicxml", "audio/midi"))).toBe(false);
    expect(isTranscribableMedia(fakeFile("scan.mxl"))).toBe(false);
    expect(isTranscribableMedia(fakeFile("document.pdf", "application/pdf"))).toBe(false);
  });

  it("accepte les vrais médias audio et vidéo", () => {
    expect(isTranscribableMedia(fakeFile("prise.mp3", "audio/mpeg"))).toBe(true);
    expect(isTranscribableMedia(fakeFile("prise.wav"))).toBe(true);
    expect(isTranscribableMedia(fakeFile("enregistrement.m4a"))).toBe(true);
    expect(isTranscribableMedia(fakeFile("video.mp4", "video/mp4"))).toBe(true);
    expect(isTranscribableMedia(fakeFile("sans-extension", "audio/mpeg"))).toBe(true);
  });
});
