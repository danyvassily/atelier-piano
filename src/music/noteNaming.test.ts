import { describe, expect, it } from "vitest";
import { midiToFrenchName, midiToLetterName } from "./notes";
import {
  PITCH_COLORS,
  SOLFEGE_NAMES,
  displayName,
  frenchName,
  isBlackKey,
  letterName,
  pitchClass,
  pitchColor,
} from "./noteNaming";

describe("classes de hauteur", () => {
  it("ramène chaque MIDI dans 0..11", () => {
    expect(pitchClass(60)).toBe(0);
    expect(pitchClass(61)).toBe(1);
    expect(pitchClass(72)).toBe(0);
    expect(pitchClass(59)).toBe(11);
    expect(pitchClass(127)).toBe(7);
    expect(pitchClass(-1)).toBe(11);
    expect(pitchClass(0)).toBe(0);
  });

  it("reconnaît les touches noires", () => {
    for (const midi of [61, 63, 66, 68, 70, 73, 75, 78, 80, 82]) {
      expect(isBlackKey(midi)).toBe(true);
    }
    for (const midi of [60, 62, 64, 65, 67, 69, 71, 72, 84]) {
      expect(isBlackKey(midi)).toBe(false);
    }
  });

  it("reste cohérent avec les noms : une touche noire porte un dièse", () => {
    for (let midi = 0; midi <= 127; midi += 1) {
      expect(isBlackKey(midi)).toBe(SOLFEGE_NAMES[pitchClass(midi)].includes("♯"));
    }
  });
});

describe("noms de notes", () => {
  it("nomme en français et en lettres, sans octave par défaut", () => {
    expect(frenchName(60)).toBe("Do");
    expect(frenchName(61)).toBe("Do♯");
    expect(frenchName(58)).toBe("La♯");
    expect(frenchName(59)).toBe("Si");
    expect(letterName(60)).toBe("C");
    expect(letterName(61)).toBe("C♯");
    expect(letterName(70)).toBe("A♯");
    expect(displayName(60, "french")).toBe("Do");
    expect(displayName(60, "letters")).toBe("C");
    expect(displayName(60, "letters", false)).toBe("C");
    expect(displayName(61, "french", false)).toBe("Do♯");
  });

  it("ajoute l'octave avec la convention de l'app (Do4 / C4 = 60)", () => {
    expect(displayName(60, "french", true)).toBe("Do4");
    expect(displayName(60, "letters", true)).toBe("C4");
    expect(displayName(61, "letters", true)).toBe("C♯4");
    expect(displayName(69, "french", true)).toBe("La4");
    expect(displayName(57, "french", true)).toBe("La3");
    expect(midiToFrenchName(60)).toBe("Do4");
  });

  it("ne duplique pas notes.ts : tous les MIDI restent alignés", () => {
    for (let midi = 0; midi <= 127; midi += 1) {
      expect(displayName(midi, "french", true)).toBe(midiToFrenchName(midi));
      expect(displayName(midi, "letters", true)).toBe(midiToLetterName(midi));
      // Les noms sans octave sont exactement les noms longs privés de leur suffixe d'octave.
      expect(frenchName(midi)).toBe(midiToFrenchName(midi).replace(/-?\d+$/, ""));
      expect(letterName(midi)).toBe(midiToLetterName(midi).replace(/-?\d+$/, ""));
    }
  });

  it("expose les 12 noms solfège, un par classe de hauteur", () => {
    expect(SOLFEGE_NAMES).toHaveLength(12);
    expect(SOLFEGE_NAMES).toEqual([
      "Do",
      "Do♯",
      "Ré",
      "Ré♯",
      "Mi",
      "Fa",
      "Fa♯",
      "Sol",
      "Sol♯",
      "La",
      "La♯",
      "Si",
    ]);
    expect(new Set(SOLFEGE_NAMES).size).toBe(12);
    // Altérations écrites « ♯ » comme dans notes.ts, jamais « # ».
    expect(SOLFEGE_NAMES.some((name) => name.includes("#"))).toBe(false);
    SOLFEGE_NAMES.forEach((name, index) => {
      expect(frenchName(60 + index)).toBe(name);
    });
  });
});

describe("couleurs par classe de hauteur", () => {
  it("génère 12 teintes chromatiques (30° par demi-ton)", () => {
    expect(PITCH_COLORS).toHaveLength(12);
    expect(PITCH_COLORS[0]).toBe("hsl(0, 70%, 55%)");
    expect(PITCH_COLORS[1]).toBe("hsl(30, 70%, 55%)");
    expect(PITCH_COLORS[11]).toBe("hsl(330, 70%, 55%)");
    expect(new Set(PITCH_COLORS).size).toBe(12);
    PITCH_COLORS.forEach((color, index) => {
      expect(color).toBe(`hsl(${index * 30}, 70%, 55%)`);
    });
  });

  it("associe une couleur stable à chaque touche, octaves comprises", () => {
    expect(pitchColor(60)).toBe(PITCH_COLORS[0]);
    expect(pitchColor(61)).toBe(PITCH_COLORS[1]);
    expect(pitchColor(72)).toBe(pitchColor(60));
    expect(pitchColor(0)).toBe(PITCH_COLORS[0]);
    expect(pitchColor(127)).toBe(PITCH_COLORS[7]);
    for (let midi = 0; midi <= 127; midi += 1) {
      expect(pitchColor(midi)).toBe(PITCH_COLORS[pitchClass(midi)]);
    }
  });
});
