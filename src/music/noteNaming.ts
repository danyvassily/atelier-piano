import type { NoteNaming } from "../types";
import { midiToFrenchName, midiToLetterName } from "./notes";

/**
 * Helpers de nommage par CLASSE DE HAUTEUR, en complément de `notes.ts`.
 *
 * - `notes.ts` reste la référence pour les noms AVEC octave (`midiToFrenchName`, `midiToLetterName`) :
 *   les noms longs sont délégués à ces fonctions, aucune logique d'octave n'est dupliquée ici.
 * - Ce module ajoute ce qui manque au mode pratique : nom sans octave, note noire, noms français
 *   indexés par classe de hauteur, et la palette chromatique du mode « coloré par classe de hauteur ».
 * - Altérations : on reprend la convention de `notes.ts`, soit « ♯ » (U+266F) et non « # ».
 * - Convention d'octave confirmée par `notes.ts` : Do4 / C4 = MIDI 60 (octave = floor(midi / 12) - 1).
 */

/** Noms français des 12 classes de hauteur, indexés par `pitchClass(midi)`. */
export const SOLFEGE_NAMES: string[] = [
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
];

/** Noms en lettres (anglais) des 12 classes de hauteur, indexés par `pitchClass(midi)`. */
const LETTER_NAMES: string[] = [
  "C",
  "C♯",
  "D",
  "D♯",
  "E",
  "F",
  "F♯",
  "G",
  "G♯",
  "A",
  "A♯",
  "B",
];

/** Classes de hauteur des touches noires : do♯, ré♯, fa♯, sol♯, la♯. */
const BLACK_KEY_CLASSES = new Set([1, 3, 6, 8, 10]);

/**
 * Palette chromatique : 12 couleurs, une par classe de hauteur (teinte = i * 30°,
 * saturation 70 %, luminosité 55 %) pour le mode « coloré par classe de hauteur ».
 */
export const PITCH_COLORS: string[] = Array.from(
  { length: 12 },
  (_, index) => `hsl(${index * 30}, 70%, 55%)`,
);

/** Classe de hauteur d'un MIDI, toujours ramenée dans 0..11 (négatifs compris). */
export function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

/** Vrai pour une touche noire (do♯, ré♯, fa♯, sol♯, la♯), quelle que soit l'octave. */
export function isBlackKey(midi: number): boolean {
  return BLACK_KEY_CLASSES.has(pitchClass(midi));
}

/** Nom français SANS octave (« Do », « Do♯ », « Si »). */
export function frenchName(midi: number): string {
  return SOLFEGE_NAMES[pitchClass(midi)];
}

/** Nom en lettres SANS octave (« C », « C♯ », « B »). */
export function letterName(midi: number): string {
  return LETTER_NAMES[pitchClass(midi)];
}

/**
 * Nom affichable d'une note, dans le système demandé.
 * Par défaut sans octave (le clavier et les pastilles n'en ont pas besoin) ;
 * avec `withOctave`, on délègue à `notes.ts` pour rester strictement cohérent.
 */
export function displayName(midi: number, naming: NoteNaming, withOctave = false): string {
  if (withOctave) {
    return naming === "letters" ? midiToLetterName(midi) : midiToFrenchName(midi);
  }
  return naming === "letters" ? letterName(midi) : frenchName(midi);
}

/** Couleur chromatique associée à un MIDI (stable entre les octaves). */
export function pitchColor(midi: number): string {
  return PITCH_COLORS[pitchClass(midi)];
}
