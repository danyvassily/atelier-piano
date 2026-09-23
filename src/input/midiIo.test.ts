// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { MidiInput, MidiOutput, parseMidiMessage, type MidiConnectResult, type MidiDeviceInfo } from "./midiIo";

/* ------------------------------------------------------------------ */
/* Doublures de l’API Web MIDI (aucun navigateur réel requis)         */
/* ------------------------------------------------------------------ */

interface FakePort {
  id: string;
  name: string;
  manufacturer: string;
  onmidimessage: ((event: { data: number[] }) => void) | null;
  sent: number[][];
  send(data: number[]): void;
}

interface FakeAccess {
  inputs: Map<string, FakePort>;
  outputs: Map<string, FakePort>;
  onstatechange: ((event: unknown) => void) | null;
}

function createPort(id: string, name: string, manufacturer = ""): FakePort {
  const port: FakePort = {
    id,
    name,
    manufacturer,
    onmidimessage: null,
    sent: [],
    send(data: number[]): void {
      port.sent.push(data);
    },
  };
  return port;
}

function createAccess(inputs: FakePort[] = [], outputs: FakePort[] = []): FakeAccess {
  return {
    inputs: new Map(inputs.map((port) => [port.id, port])),
    outputs: new Map(outputs.map((port) => [port.id, port])),
    onstatechange: null,
  };
}

/** Installe `navigator.requestMIDIAccess` et renvoie la trace des options demandées. */
function installAccess(access: FakeAccess): { options: unknown[] } {
  const trace = { options: [] as unknown[] };
  Object.defineProperty(navigator, "requestMIDIAccess", {
    configurable: true,
    writable: true,
    value: (options?: unknown) => {
      trace.options.push(options);
      return Promise.resolve(access);
    },
  });
  return trace;
}

function installUnsupported(): void {
  Object.defineProperty(navigator, "requestMIDIAccess", {
    configurable: true,
    writable: true,
    value: undefined,
  });
}

function installRefusal(): void {
  Object.defineProperty(navigator, "requestMIDIAccess", {
    configurable: true,
    writable: true,
    value: () => Promise.reject(new DOMException("Permission denied", "SecurityError")),
  });
}

function expectOk(result: MidiConnectResult): { ok: true; devices: MidiDeviceInfo[] } {
  if (!result.ok) throw new Error(`connexion MIDI inattendue : ${result.error}`);
  return result;
}

function expectFailure(result: MidiConnectResult): string {
  if (result.ok) throw new Error("la connexion devait échouer");
  return result.error;
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "requestMIDIAccess");
});

/* ------------------------------------------------------------------ */
/* Entrée MIDI                                                        */
/* ------------------------------------------------------------------ */

describe("MidiInput", () => {
  it("détecte l’absence de Web MIDI (cas Safari iOS)", () => {
    installUnsupported();
    expect(new MidiInput().isSupported()).toBe(false);
  });

  it("signale un navigateur sans Web MIDI avec un message clair en français", async () => {
    installUnsupported();
    const input = new MidiInput();
    const error = expectFailure(await input.connect());
    expect(error).toMatch(/n’est pas disponible dans ce navigateur/);
    expect(input.connected).toBe(false);
  });

  it("signale un refus d’autorisation MIDI", async () => {
    installRefusal();
    const input = new MidiInput();
    const error = expectFailure(await input.connect());
    expect(error).toMatch(/refusé/i);
    expect(error).toMatch(/autoris/i);
    expect(input.connected).toBe(false);
  });

  it("liste les entrées et place l’appareil préféré en tête", async () => {
    const trace = installAccess(
      createAccess([createPort("in-1", "Nord Stage"), createPort("in-2", "Keystation", "M-Audio")]),
    );
    const input = new MidiInput();
    const result = expectOk(await input.connect("in-2"));

    expect(result.devices.map((device) => device.id)).toEqual(["in-2", "in-1"]);
    expect(result.devices[0]).toEqual({ id: "in-2", name: "Keystation", manufacturer: "M-Audio" });
    expect(input.listInputs().map((device) => device.name)).toEqual(["Nord Stage", "Keystation"]);
    expect(trace.options).toEqual([{ sysex: false }]);
    expect(input.isSupported()).toBe(true);
    expect(input.connected).toBe(true);
  });

  it("écoute toutes les entrées branchées (multi-appareils)", async () => {
    const first = createPort("in-1", "Nord Stage");
    const second = createPort("in-2", "Keystation");
    installAccess(createAccess([first, second]));

    const input = new MidiInput();
    const notes: Array<{ midi: number; velocity: number; deviceId: string }> = [];
    const releases: Array<{ midi: number; deviceId: string | undefined }> = [];
    input.onNoteOn = (midi, velocity, deviceId) => notes.push({ midi, velocity, deviceId });
    input.onNoteOff = (midi, deviceId) => releases.push({ midi, deviceId });
    expectOk(await input.connect());

    expect(first.onmidimessage).not.toBeNull();
    expect(second.onmidimessage).not.toBeNull();
    first.onmidimessage?.({ data: [0x90, 60, 100] });
    second.onmidimessage?.({ data: [0x90, 64, 72] });
    second.onmidimessage?.({ data: [0x80, 64, 0] });
    first.onmidimessage?.({ data: [0x90, 60, 0] });

    expect(notes).toEqual([
      { midi: 60, velocity: 100, deviceId: "in-1" },
      { midi: 64, velocity: 72, deviceId: "in-2" },
    ]);
    expect(releases).toEqual([
      { midi: 64, deviceId: "in-2" },
      { midi: 60, deviceId: "in-1" },
    ]);
  });

  it("configure les rappels par méthode aussi bien que par propriété", async () => {
    installAccess(createAccess([createPort("in-1", "Nord Stage")]));
    const input = new MidiInput();
    const seen: number[] = [];
    input.setOnNoteOn((midi) => seen.push(midi));
    input.setOnNoteOff(() => seen.push(-1));
    expectOk(await input.connect());
    const port = createPort("in-9", "Témoin");
    expect(port.onmidimessage).toBeNull();
    input.setOnNoteOn(null);
    input.setOnNoteOff(null);
    expect(input.onNoteOn).toBeNull();
    expect(seen).toEqual([]);
  });

  it("ignore les messages qui ne sont pas des notes", async () => {
    const port = createPort("in-1", "Nord Stage");
    installAccess(createAccess([port]));
    const input = new MidiInput();
    const received: string[] = [];
    input.onNoteOn = (midi) => received.push(`on:${midi}`);
    input.onNoteOff = (midi) => received.push(`off:${midi}`);
    expectOk(await input.connect());

    port.onmidimessage?.({ data: [0xb0, 64, 127] }); // control change (pédale)
    port.onmidimessage?.({ data: [0xe0, 0, 64] }); // pitch bend
    port.onmidimessage?.({ data: [0x90, 60] }); // message tronqué
    port.onmidimessage?.({ data: [0x60, 100, 0] }); // running status
    port.onmidimessage?.({ data: [0x90, 200, 100] }); // note hors plage
    port.onmidimessage?.({ data: [0x95, 60, 90] }); // canal 6 : note on
    port.onmidimessage?.({ data: [0x85, 60, 0] }); // canal 6 : note off

    expect(received).toEqual(["on:60", "off:60"]);
  });

  it("suit les appareils branchés ou retirés à chaud", async () => {
    const access = createAccess([createPort("in-1", "Nord Stage")]);
    installAccess(access);
    const input = new MidiInput();
    const notes: Array<{ midi: number; deviceId: string }> = [];
    input.onNoteOn = (midi, _velocity, deviceId) => notes.push({ midi, deviceId });
    expectOk(await input.connect());
    expect(access.onstatechange).not.toBeNull();

    const late = createPort("in-2", "Clavier ajouté");
    access.inputs.set(late.id, late);
    access.onstatechange?.({});
    expect(late.onmidimessage).not.toBeNull();
    late.onmidimessage?.({ data: [0x90, 67, 88] });

    access.inputs.delete("in-1");
    access.onstatechange?.({});

    expect(notes).toEqual([{ midi: 67, deviceId: "in-2" }]);
    expect(input.listInputs().map((device) => device.id)).toEqual(["in-2"]);
  });

  it("coupe l’écoute et l’accès au disconnect", async () => {
    const port = createPort("in-1", "Nord Stage");
    const access = createAccess([port]);
    installAccess(access);
    const input = new MidiInput();
    const notes: number[] = [];
    input.onNoteOn = (midi) => notes.push(midi);
    expectOk(await input.connect());

    input.disconnect();
    port.onmidimessage?.({ data: [0x90, 60, 100] });

    expect(port.onmidimessage).toBeNull();
    expect(access.onstatechange).toBeNull();
    expect(notes).toEqual([]);
    expect(input.listInputs()).toEqual([]);
    expect(input.connected).toBe(false);
  });

  it("reconnaît un appareil sans nom", async () => {
    installAccess(createAccess([createPort("in-1", "   ")]));
    const input = new MidiInput();
    const result = expectOk(await input.connect());
    expect(result.devices).toEqual([{ id: "in-1", name: "Appareil MIDI sans nom" }]);
  });

  it("décode les messages MIDI bruts", () => {
    expect(parseMidiMessage(new Uint8Array([0x90, 60, 100]))).toEqual({ type: "noteon", midi: 60, velocity: 100 });
    expect(parseMidiMessage([0x90, 60, 0])).toEqual({ type: "noteoff", midi: 60 });
    expect(parseMidiMessage([0x80, 62, 64])).toEqual({ type: "noteoff", midi: 62 });
    expect(parseMidiMessage([0x9f, 61, 1])).toEqual({ type: "noteon", midi: 61, velocity: 1 });
    expect(parseMidiMessage([0xb0, 64, 127])).toBeNull();
    expect(parseMidiMessage([0x90, 60])).toBeNull();
    expect(parseMidiMessage(null)).toBeNull();
    expect(parseMidiMessage([])).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Sortie MIDI                                                        */
/* ------------------------------------------------------------------ */

describe("MidiOutput", () => {
  it("signale l’absence de Web MIDI", async () => {
    installUnsupported();
    const output = new MidiOutput();
    expect(output.isSupported()).toBe(false);
    expect(expectFailure(await output.connect())).toMatch(/n’est pas disponible dans ce navigateur/);
  });

  it("signale un refus d’autorisation", async () => {
    installRefusal();
    const error = expectFailure(await new MidiOutput().connect());
    expect(error).toMatch(/refusé/i);
  });

  it("liste les sorties et sélectionne l’appareil préféré", async () => {
    installAccess(createAccess([], [createPort("out-1", "Casio"), createPort("out-2", "Nord", "Clavia")]));
    const output = new MidiOutput();
    const result = expectOk(await output.connect("out-2"));

    expect(result.devices.map((device) => device.id)).toEqual(["out-2", "out-1"]);
    expect(output.listOutputs().map((device) => device.name)).toEqual(["Casio", "Nord"]);
    expect(output.selectedId).toBe("out-2");
  });

  it("refuse un identifiant de sortie inconnu", async () => {
    const port = createPort("out-1", "Casio");
    installAccess(createAccess([], [port]));
    const output = new MidiOutput();
    expectOk(await output.connect());

    expect(output.select("out-42")).toBe(false);
    expect(output.selectedId).toBeNull();
    output.noteOn(60, 100);
    expect(port.sent).toEqual([]);
  });

  it("envoie notes et coupures sur la sortie sélectionnée", async () => {
    const port = createPort("out-1", "Casio");
    installAccess(createAccess([], [port]));
    const output = new MidiOutput();
    expectOk(await output.connect("out-1"));

    output.noteOn(60, 100);
    output.noteOn(64, 90);
    output.noteOff(60);
    expect(port.sent).toEqual([
      [0x90, 60, 100],
      [0x90, 64, 90],
      [0x80, 60, 0],
    ]);

    output.allNotesOff();
    expect(port.sent).toEqual([
      [0x90, 60, 100],
      [0x90, 64, 90],
      [0x80, 60, 0],
      [0x80, 64, 0],
    ]);
    output.allNotesOff();
    expect(port.sent).toHaveLength(4);
  });

  it("borne la vélocité et ignore les notes hors plage", async () => {
    const port = createPort("out-1", "Casio");
    installAccess(createAccess([], [port]));
    const output = new MidiOutput();
    expectOk(await output.connect("out-1"));

    output.noteOn(60, 0);
    output.noteOn(62, 900);
    output.noteOn(200, 100);
    output.noteOn(Number.NaN, 100);
    output.noteOff(-1);
    expect(port.sent).toEqual([
      [0x90, 60, 1],
      [0x90, 62, 127],
    ]);
  });

  it("ne pilote rien sans sélection", async () => {
    const port = createPort("out-1", "Casio");
    installAccess(createAccess([], [port]));
    const output = new MidiOutput();
    expectOk(await output.connect());

    output.noteOn(60, 100);
    expect(port.sent).toEqual([]);
    expect(output.selectedId).toBeNull();
    expect(output.select(null)).toBe(true);
  });

  it("libère tout au dispose", async () => {
    const port = createPort("out-1", "Casio");
    installAccess(createAccess([], [port]));
    const output = new MidiOutput();
    expectOk(await output.connect("out-1"));

    output.noteOn(60, 100);
    output.dispose();

    expect(port.sent).toEqual([
      [0x90, 60, 100],
      [0x80, 60, 0],
    ]);
    output.noteOn(62, 100);
    expect(port.sent).toHaveLength(2);
    expect(output.listOutputs()).toEqual([]);
    expect(output.selectedId).toBeNull();
    expect(output.connected).toBe(false);
  });

  it("oublie une sortie débranchée", async () => {
    const port = createPort("out-1", "Casio");
    const access = createAccess([], [port]);
    installAccess(access);
    const output = new MidiOutput();
    expectOk(await output.connect("out-1"));

    access.outputs.delete("out-1");
    expect(output.listOutputs()).toEqual([]);
    output.noteOn(60, 100);
    expect(port.sent).toEqual([]);
    expect(output.selectedId).toBeNull();
  });
});
