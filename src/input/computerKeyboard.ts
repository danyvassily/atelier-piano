/**
 * Saisie au clavier d’ordinateur : deux rangées jouables, mappées sur `event.code`
 * (position PHYSIQUE des touches) pour rester identiques en AZERTY et QWERTY.
 *
 *   rangée basse  KeyZ KeyS KeyX KeyD KeyC KeyV KeyG KeyB KeyH KeyN KeyJ KeyM  → baseMidi + 0..11
 *   rangée haute  KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP            → baseMidi + 12..21
 */

export const COMPUTER_KEY_MAP: Record<string, number> = {
  KeyZ: 0,
  KeyS: 1,
  KeyX: 2,
  KeyD: 3,
  KeyC: 4,
  KeyV: 5,
  KeyG: 6,
  KeyB: 7,
  KeyH: 8,
  KeyN: 9,
  KeyJ: 10,
  KeyM: 11,
  KeyQ: 12,
  KeyW: 13,
  KeyE: 14,
  KeyR: 15,
  KeyT: 16,
  KeyY: 17,
  KeyU: 18,
  KeyI: 19,
  KeyO: 20,
  KeyP: 21,
};

export interface ComputerKeyboardOptions {
  /** Première note de la ligne basse (Do central par défaut). */
  baseMidi?: number;
  /** Vélocité envoyée à chaque appui (défaut 100, bornée 1..127). */
  velocity?: number;
  onNoteOn: (midi: number, velocity: number) => void;
  onNoteOff: (midi: number) => void;
}

const DEFAULT_BASE_MIDI = 60;
const DEFAULT_VELOCITY = 100;

const KEY_OFFSETS = new Map<string, number>(Object.entries(COMPUTER_KEY_MAP));

/**
 * Branche l’écoute du clavier physique sur `target`.
 * Renvoie la fonction de détachement : elle retire les écouteurs et libère l’état interne.
 */
export function attachComputerKeyboard(target: Window, opts: ComputerKeyboardOptions): () => void {
  const baseMidi = Math.round(opts.baseMidi ?? DEFAULT_BASE_MIDI);
  const rawVelocity = Math.round(opts.velocity ?? DEFAULT_VELOCITY);
  const velocity = Math.min(127, Math.max(1, Number.isFinite(rawVelocity) ? rawVelocity : DEFAULT_VELOCITY));

  // Notes actuellement tenues par le clavier (anti-doublon et anti-note bloquée).
  const held = new Set<number>();

  const releaseAll = (): void => {
    if (!held.size) return;
    const notes = Array.from(held);
    held.clear();
    for (const note of notes) opts.onNoteOff(note);
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return; // la répétition automatique du système ne rejoue pas la note
    if (isTypingTarget(event.target) || isTypingTarget(currentActiveElement(target))) return;
    const offset = KEY_OFFSETS.get(event.code);
    if (offset === undefined) return;
    event.preventDefault();
    const midi = baseMidi + offset;
    if (held.has(midi)) return;
    held.add(midi);
    opts.onNoteOn(midi, velocity);
  };

  const handleKeyUp = (event: KeyboardEvent): void => {
    const offset = KEY_OFFSETS.get(event.code);
    if (offset === undefined) return;
    const midi = baseMidi + offset;
    if (!held.has(midi)) return; // l’appui avait été ignoré (champ de saisie) : rien à relâcher
    held.delete(midi);
    opts.onNoteOff(midi);
  };

  const handleRelease = (): void => {
    releaseAll();
  };

  const handleVisibilityChange = (): void => {
    if (target.document?.visibilityState === "hidden") releaseAll();
  };

  target.addEventListener("keydown", handleKeyDown);
  target.addEventListener("keyup", handleKeyUp);
  target.addEventListener("blur", handleRelease);
  target.document?.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    target.removeEventListener("keydown", handleKeyDown);
    target.removeEventListener("keyup", handleKeyUp);
    target.removeEventListener("blur", handleRelease);
    target.document?.removeEventListener("visibilitychange", handleVisibilityChange);
    // Démontage volontaire : on vide l’état sans rejouer de note off (l’appelant coupe ses voix).
    held.clear();
  };
}

/** Un champ de saisie (texte, zone de texte ou contenu éditable) a la priorité sur le piano. */
function isTypingTarget(node: EventTarget | null | undefined): boolean {
  if (!node || typeof node !== "object") return false;
  const element = node as HTMLElement;
  if (typeof element.tagName !== "string") return false;
  const tag = element.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (element.isContentEditable === true) return true;
  if (typeof element.closest !== "function") return false;
  return Boolean(element.closest('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'));
}

function currentActiveElement(target: Window): EventTarget | null {
  return target.document?.activeElement ?? null;
}
