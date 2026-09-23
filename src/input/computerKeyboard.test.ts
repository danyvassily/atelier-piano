// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { COMPUTER_KEY_MAP, attachComputerKeyboard } from "./computerKeyboard";

interface Recorder {
  noteOns: Array<{ midi: number; velocity: number }>;
  noteOffs: number[];
}

const detachers: Array<() => void> = [];

function attach(overrides: { baseMidi?: number; velocity?: number } = {}): { recorder: Recorder; detach: () => void } {
  const recorder: Recorder = { noteOns: [], noteOffs: [] };
  const detach = attachComputerKeyboard(window, {
    ...overrides,
    onNoteOn: (midi, velocity) => recorder.noteOns.push({ midi, velocity }),
    onNoteOff: (midi) => recorder.noteOffs.push(midi),
  });
  detachers.push(detach);
  return { recorder, detach };
}

function keyDown(code: string, target: EventTarget = window, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function keyUp(code: string, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent("keyup", { code, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function setVisibility(state: "hidden" | "visible"): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
}

afterEach(() => {
  while (detachers.length) detachers.pop()?.();
  document.body.innerHTML = "";
  Reflect.deleteProperty(document, "visibilityState");
});

describe("clavier d’ordinateur", () => {
  it("mappe les deux rangées physiques sur 22 demi-tons", () => {
    expect(COMPUTER_KEY_MAP.KeyZ).toBe(0);
    expect(COMPUTER_KEY_MAP.KeyM).toBe(11);
    expect(COMPUTER_KEY_MAP.KeyQ).toBe(12);
    expect(COMPUTER_KEY_MAP.KeyP).toBe(21);
    expect(Object.keys(COMPUTER_KEY_MAP)).toHaveLength(22);
    expect(Object.values(COMPUTER_KEY_MAP)).toEqual(Array.from({ length: 22 }, (_, index) => index));
  });

  it("joue chaque touche depuis le Do central", () => {
    const { recorder } = attach();

    for (const [code, offset] of Object.entries(COMPUTER_KEY_MAP)) {
      keyDown(code);
      expect(recorder.noteOns.at(-1)).toEqual({ midi: 60 + offset, velocity: 100 });
      keyUp(code);
      expect(recorder.noteOffs.at(-1)).toBe(60 + offset);
    }

    expect(recorder.noteOns).toHaveLength(22);
    expect(recorder.noteOffs).toHaveLength(22);
  });

  it("décale la plage avec baseMidi et la vélocité demandée", () => {
    const { recorder } = attach({ baseMidi: 48, velocity: 64 });

    keyDown("KeyZ");
    keyDown("KeyQ");
    keyUp("KeyZ");
    keyUp("KeyQ");

    expect(recorder.noteOns).toEqual([
      { midi: 48, velocity: 64 },
      { midi: 60, velocity: 64 },
    ]);
    expect(recorder.noteOffs).toEqual([48, 60]);
  });

  it("n’émet qu’une fois par appui et relâche au keyup", () => {
    const { recorder } = attach();

    keyDown("KeyZ");
    keyDown("KeyZ");
    expect(recorder.noteOns).toEqual([{ midi: 60, velocity: 100 }]);

    keyUp("KeyZ");
    keyUp("KeyZ");
    expect(recorder.noteOffs).toEqual([60]);
  });

  it("ignore la répétition automatique du système", () => {
    const { recorder } = attach();

    keyDown("KeyZ");
    keyDown("KeyZ", window, { repeat: true });
    keyDown("KeyZ", window, { repeat: true });

    expect(recorder.noteOns).toHaveLength(1);
    keyUp("KeyZ");
    expect(recorder.noteOffs).toEqual([60]);
  });

  it("permet de jouer un accord (plusieurs touches tenues)", () => {
    const { recorder } = attach();

    keyDown("KeyZ");
    keyDown("KeyC");
    keyDown("KeyB");
    expect(recorder.noteOns.map((note) => note.midi)).toEqual([60, 64, 67]);

    keyUp("KeyC");
    expect(recorder.noteOffs).toEqual([64]);
  });

  it("ignore les touches hors mapping sans bloquer le navigateur", () => {
    const { recorder } = attach();

    expect(keyDown("KeyA").defaultPrevented).toBe(false);
    expect(keyDown("Space").defaultPrevented).toBe(false);
    expect(keyDown("ArrowUp").defaultPrevented).toBe(false);
    keyUp("KeyA");
    keyUp("Space");

    expect(recorder.noteOns).toEqual([]);
    expect(recorder.noteOffs).toEqual([]);
  });

  it("empêche le comportement par défaut des touches jouées", () => {
    const { recorder } = attach();

    expect(keyDown("KeyZ").defaultPrevented).toBe(true);
    expect(recorder.noteOns).toHaveLength(1);
  });

  it("reste muet dans les champs de saisie et contenus éditables", () => {
    const { recorder } = attach();
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const child = document.createElement("span");
    editable.append(child);
    document.body.append(input, textarea, editable);

    keyDown("KeyZ", input);
    keyDown("KeyZ", textarea);
    keyDown("KeyZ", editable);
    keyDown("KeyZ", child);
    keyUp("KeyZ", input);

    expect(recorder.noteOns).toEqual([]);
    expect(recorder.noteOffs).toEqual([]);
  });

  it("reste muet quand un champ a le focus", () => {
    const { recorder } = attach();
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    keyDown("KeyZ");
    expect(recorder.noteOns).toEqual([]);

    input.blur();
    keyDown("KeyZ");
    expect(recorder.noteOns).toHaveLength(1);
  });

  it("libère les notes tenues au blur de la fenêtre", () => {
    const { recorder } = attach();

    keyDown("KeyZ");
    keyDown("KeyQ");
    window.dispatchEvent(new Event("blur"));

    expect(recorder.noteOffs).toEqual([60, 72]);
    keyUp("KeyZ");
    expect(recorder.noteOffs).toEqual([60, 72]);
  });

  it("libère les notes tenues quand la page passe en arrière-plan", () => {
    const { recorder } = attach();

    keyDown("KeyZ");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(recorder.noteOffs).toEqual([]);

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(recorder.noteOffs).toEqual([60]);
  });

  it("détache complètement les écouteurs", () => {
    const { recorder, detach } = attach();
    detach();

    keyDown("KeyZ");
    keyUp("KeyZ");
    window.dispatchEvent(new Event("blur"));
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(recorder.noteOns).toEqual([]);
    expect(recorder.noteOffs).toEqual([]);
  });
});
