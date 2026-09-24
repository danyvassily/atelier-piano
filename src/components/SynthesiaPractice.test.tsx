// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ComputerKeyboardOptions } from "../input/computerKeyboard";
import type { ScoreDocument } from "../types";
import type { Transport } from "../practice/transport";
import { SynthesiaPractice } from "./SynthesiaPractice";
import { installCanvasDouble, installRafClock, type CanvasRecorder, type RafClock } from "./canvasTestDouble";

/**
 * Simulation du mode Synthesia : l’audio (métronome, lecteur, déverrouillage),
 * les entrées (MIDI, clavier d’ordinateur) et le canvas sont remplacés par des
 * doubles, mais le transport, le scoreur et le rendu sont les vrais. L’horloge
 * d’images est pilotée image par image : on peut donc vérifier le comportement
 * du mode attente sur l’horloge, sans attente réelle ni navigateur.
 */

const harness = vi.hoisted(() => ({
  attachComputerKeyboard: vi.fn<(target: Window, options: ComputerKeyboardOptions) => () => void>(() => () => undefined),
  transportBox: { current: null, waitModeCalls: [] } as { current: Transport | null; waitModeCalls: boolean[] },
}));

vi.mock("../practice/transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../practice/transport")>();
  return {
    ...actual,
    createTransport: (options?: Parameters<typeof actual.createTransport>[0]) => {
      const transport = actual.createTransport(options);
      const applyWaitMode = transport.setWaitMode.bind(transport);
      transport.setWaitMode = (enabled: boolean) => {
        harness.transportBox.waitModeCalls.push(enabled);
        applyWaitMode(enabled);
      };
      // `useRef(createTransport())` construit une instance à chaque rendu : seule
      // la première est conservée par le composant, c’est donc elle qu’on suit.
      if (!harness.transportBox.current) harness.transportBox.current = transport;
      return transport;
    },
  };
});

vi.mock("../input/computerKeyboard", () => ({
  attachComputerKeyboard: harness.attachComputerKeyboard,
}));

vi.mock("../input/midiIo", () => ({
  MidiInput: class {
    isSupported() {
      return false;
    }
    setOnNoteOn() {}
    setOnNoteOff() {}
    disconnect() {}
    connect() {
      return Promise.resolve({ ok: false, error: "test" });
    }
  },
}));

vi.mock("../audio/scorePlayer", () => ({
  ScorePlayer: class {
    play() {}
    stop() {}
  },
}));

vi.mock("../audio/metronome", () => ({
  Metronome: class {
    start() {
      return Promise.resolve();
    }
    stop() {}
  },
}));

vi.mock("../audio/audioContext", () => ({
  unlockAudio: () => Promise.resolve(),
}));

/** Partition jouet : une noire (Do4) à 120 BPM, deux mesures de 4/4. */
const SCORE: ScoreDocument = {
  id: "score-test",
  title: "Test",
  composer: "",
  sourceType: "midi",
  importedAt: "2026-01-01T00:00:00.000Z",
  bpm: 120,
  timeSignature: [4, 4],
  measureCount: 2,
  notes: [{ id: "n1", midi: 60, name: "C4", onsetBeats: 0, durationBeats: 1, measure: 1, hand: "right", velocity: 90 }],
};

/** Quatre temps d’avance à 120 BPM et 75 % : l’horloge démarre à −2,667 s. */
const LEAD_IN_SEC = (4 * 60) / (120 * 0.75);

let recorder: CanvasRecorder;
let clock: RafClock;
let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  harness.attachComputerKeyboard.mockClear();
  harness.transportBox.current = null;
  harness.transportBox.waitModeCalls = [];
  recorder = installCanvasDouble(720);
  clock = installRafClock();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
});

function render(): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<SynthesiaPractice score={SCORE} stage={null} naming="french" onNamingChange={() => undefined} />);
  });
  clock.step(2);
}

function transport(): Transport {
  const current = harness.transportBox.current;
  if (!current) throw new Error("transport non créé");
  return current;
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find((element) => (element.textContent ?? "").includes(label));
  if (!found) throw new Error(`bouton « ${label} » introuvable`);
  return found as HTMLButtonElement;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Options réellement confiées au clavier d’ordinateur par le composant. */
function keyboardOptions(): ComputerKeyboardOptions {
  const call = harness.attachComputerKeyboard.mock.calls.at(-1);
  if (!call) throw new Error("clavier d’ordinateur non branché");
  return call[1];
}

function hudState(): string {
  return document.querySelector(".synthesia-hud-state")?.textContent ?? "";
}

describe("SynthesiaPractice — câblage du mode attente", () => {
  it("annonce le mode attente au transport dès le montage", () => {
    render();

    expect(harness.transportBox.waitModeCalls).toContain(true);
    expect(transport().waitMode).toBe(true);
  });

  it("suit l’option quand on la décoche", async () => {
    render();
    await click(button("Mode attente"));

    expect(harness.transportBox.waitModeCalls.at(-1)).toBe(false);
    expect(transport().waitMode).toBe(false);
  });

  it("fige l’horloge sur la note, puis repart quand la touche est jouée", async () => {
    render();
    const scene = transport();

    await click(button("Jouer"));
    // L’amorçage de quatre temps (2,667 s) est absorbé, puis la note est atteinte.
    clock.step(Math.ceil(LEAD_IN_SEC / 0.016) + 20, 16);

    expect(scene.frozen).toBe(true);
    expect(scene.time).toBeCloseTo(0, 6); // figée pile sur l’attaque du Do4
    expect(hudState()).toContain("En attente");

    // L’élève joue la touche attendue : l’horloge repart.
    act(() => {
      keyboardOptions().onNoteOn(60, 100);
    });
    clock.step(12, 16);

    expect(scene.frozen).toBe(false);
    expect(scene.time).toBeGreaterThan(0.05);
  });

  it("laisse filer l’horloge quand le mode attente est coupé", async () => {
    render();
    const scene = transport();

    await click(button("Mode attente")); // mode attente désactivé
    await click(button("Jouer"));
    clock.step(240, 16);

    expect(scene.frozen).toBe(false);
    expect(scene.time).toBeGreaterThan(0.5);
    expect(hudState()).toContain("suivez la ligne de frappe");
  });
});

describe("SynthesiaPractice — clavier d’ordinateur", () => {
  it("réserve les touches des raccourcis de la séance", () => {
    render();

    const options = keyboardOptions();
    expect(options.reservedCodes).toContain("Space");
    // « R » reste jouable : le redémarrage vit sur « Maj+R » (cf. test suivant).
    expect(options.reservedCodes).not.toContain("KeyR");
    expect(typeof options.onNoteOn).toBe("function");
    expect(typeof options.onNoteOff).toBe("function");
    expect(options.baseMidi).toBe(60);
  });

  it("rejoue la section quand on presse « Maj+R », sans jouer de note", async () => {
    render();
    const scene = transport();

    await click(button("Jouer"));
    clock.step(40, 16);
    expect(scene.playing).toBe(true);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyR", key: "R", shiftKey: true, bubbles: true, cancelable: true }));
    });
    clock.step(4, 16);

    // La section est revenue à son début et plus aucune note n’est enfoncée :
    // le raccourci n’a pas joué de Ré au passage.
    expect(scene.playing).toBe(false);
    expect(scene.time).toBeCloseTo(0, 6);
    expect(document.querySelector("canvas.synthesia-canvas")?.getAttribute("aria-label")).toContain("aucune touche enfoncée");
  });
});

describe("SynthesiaPractice — scène dessinée", () => {
  it("peint le piano-roll et le clavier dès le montage", () => {
    render();

    expect(recorder.fills.some((fill) => fill.style === "rgba(79, 195, 247, 0.35)")).toBe(true); // ligne de frappe
    expect(recorder.fills.some((fill) => fill.style === "#c9ced6")).toBe(true); // séparateurs de touches
    expect(recorder.paths.some((path) => path.style === "#4fc3f7")).toBe(true); // capsule main droite
    expect(recorder.fills.some((fill) => fill.style === "rgba(255, 255, 255, 0.10)")).toBe(true); // repères de mesure
    expect(recorder.texts.some((text) => text.text === "1")).toBe(true); // numéro de mesure
  });

  it("démarre sans erreur de rendu et se démonte proprement", () => {
    render();
    const options = keyboardOptions();
    act(() => {
      options.onNoteOn(60, 100);
    });
    act(() => {
      options.onNoteOff(60);
    });
    clock.step(3, 16);
    expect(document.querySelector(".synthesia-canvas")).not.toBeNull();
  });
});
