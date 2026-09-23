/**
 * Couche Web MIDI de l’atelier : entrée (clavier matériel → notes) et sortie (notes → appareil).
 *
 * Zéro dépendance npm : TypeScript ne fournit pas les types Web MIDI dans `lib.dom`,
 * on décrit donc ici le strict sous-ensemble utilisé (interfaces `*Like`).
 * Le décodage des messages est fait à la main pour rester tolérant aux appareils réels.
 */

export interface MidiDeviceInfo {
  id: string;
  name: string;
  manufacturer?: string;
}

export type MidiConnectResult =
  | { ok: true; devices: MidiDeviceInfo[] }
  | { ok: false; error: string };

export type MidiMessage =
  | { type: "noteon"; midi: number; velocity: number }
  | { type: "noteoff"; midi: number };

export type NoteOnHandler = (midi: number, velocity: number, deviceId: string) => void;
export type NoteOffHandler = (midi: number, deviceId: string) => void;

const UNSUPPORTED_INPUT =
  "La saisie MIDI n’est pas disponible dans ce navigateur. Utilisez Chrome, Edge ou Opera sur ordinateur, ou jouez avec le microphone.";
const UNSUPPORTED_OUTPUT =
  "La sortie MIDI n’est pas disponible dans ce navigateur. Utilisez Chrome, Edge ou Opera sur ordinateur.";
const REFUSED =
  "Accès MIDI refusé. Autorisez les périphériques MIDI pour ce site dans les réglages du navigateur, puis réessayez.";
const GENERIC_FAILURE =
  "La connexion MIDI a échoué. Vérifiez que l’appareil est branché et allumé, puis réessayez.";
const UNNAMED_DEVICE = "Appareil MIDI sans nom";

/* ------------------------------------------------------------------ */
/* Sous-ensemble minimal de l’API Web MIDI (absente de lib.dom.d.ts) */
/* ------------------------------------------------------------------ */

interface WebMidiPortLike {
  id: string;
  name?: string | null;
  manufacturer?: string | null;
  onmidimessage?: ((event: { data?: ArrayLike<number> | null }) => void) | null;
  send?: (data: number[] | Uint8Array, timestamp?: number) => void;
}

interface WebMidiPortCollectionLike {
  size?: number;
  forEach?: (callback: (port: WebMidiPortLike) => void) => void;
  values?: () => IterableIterator<WebMidiPortLike>;
}

interface WebMidiAccessLike {
  inputs?: WebMidiPortCollectionLike;
  outputs?: WebMidiPortCollectionLike;
  onstatechange?: ((event: unknown) => void) | null;
}

type RequestMidiAccessLike = (options?: { sysex?: boolean }) => Promise<WebMidiAccessLike>;

/* ------------------------------------------------------------------ */
/* Utilitaires                                                        */
/* ------------------------------------------------------------------ */

/** Renvoie `navigator.requestMIDIAccess` quand le navigateur l’expose, sinon `null`. */
function getRequestMidiAccess(): RequestMidiAccessLike | null {
  if (typeof navigator === "undefined" || !navigator) return null;
  const request = (navigator as Navigator & { requestMIDIAccess?: RequestMidiAccessLike }).requestMIDIAccess;
  return typeof request === "function" ? request : null;
}

/** Convertit une collection MIDI (midi-spec maplike) en tableau, quel que soit son dialecte. */
function collectionToPorts(collection: WebMidiPortCollectionLike | undefined | null): WebMidiPortLike[] {
  if (!collection) return [];
  if (typeof collection.forEach === "function") {
    const ports: WebMidiPortLike[] = [];
    collection.forEach((port) => {
      if (port) ports.push(port);
    });
    return ports;
  }
  if (typeof collection.values === "function") {
    return Array.from(collection.values()).filter((port): port is WebMidiPortLike => Boolean(port));
  }
  return [];
}

function portId(port: WebMidiPortLike): string {
  return typeof port.id === "string" ? port.id : String(port.id ?? "");
}

function toDeviceInfo(port: WebMidiPortLike): MidiDeviceInfo {
  const name = typeof port.name === "string" ? port.name.trim() : "";
  const manufacturer = typeof port.manufacturer === "string" ? port.manufacturer.trim() : "";
  const info: MidiDeviceInfo = { id: portId(port), name: name || UNNAMED_DEVICE };
  if (manufacturer) info.manufacturer = manufacturer;
  return info;
}

function errorName(error: unknown): string {
  if (error && typeof error === "object" && "name" in error) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/** Transforme une erreur d’autorisation/technique en message français actionnable. */
function describeAccessError(error: unknown): string {
  const name = errorName(error);
  const message = errorMessage(error);
  if (name === "SecurityError" || name === "NotAllowedError" || name === "InvalidStateError") return REFUSED;
  if (/denied|permission|refus|not allowed/i.test(message)) return REFUSED;
  if (name === "AbortError") return "La demande d’accès MIDI a été interrompue. Réessayez.";
  return GENERIC_FAILURE;
}

/** Place l’appareil préféré en tête de liste (sans le retirer des autres). */
function orderDevices(devices: MidiDeviceInfo[], preferredId?: string): MidiDeviceInfo[] {
  if (!preferredId) return devices;
  const preferred = devices.filter((device) => device.id === preferredId);
  if (!preferred.length) return devices;
  return [...preferred, ...devices.filter((device) => device.id !== preferredId)];
}

/* ------------------------------------------------------------------ */
/* Décodage des messages MIDI                                         */
/* ------------------------------------------------------------------ */

/**
 * Décode un message MIDI brut.
 * - status `0x90` (note on) avec vélocité 0 → note off, comme le veut la norme ;
 * - status `0x80` (note off) → note off ;
 * - tout le reste (control change, pitch bend, aftertouch, sysex, running status) est ignoré.
 */
export function parseMidiMessage(data: ArrayLike<number> | null | undefined): MidiMessage | null {
  if (!data || typeof data.length !== "number" || data.length < 3) return null;
  const status = Number(data[0]);
  const midi = Number(data[1]);
  const value = Number(data[2]);
  if (!Number.isFinite(status) || !Number.isFinite(midi) || !Number.isFinite(value)) return null;
  if (status < 0x80) return null;
  if (midi < 0 || midi > 127) return null;

  const command = status & 0xf0;
  if (command === 0x90) {
    if (value <= 0) return { type: "noteoff", midi };
    return { type: "noteon", midi, velocity: Math.min(127, Math.round(value)) };
  }
  if (command === 0x80) return { type: "noteoff", midi };
  return null;
}

/* ------------------------------------------------------------------ */
/* Entrée MIDI                                                        */
/* ------------------------------------------------------------------ */

/**
 * Écoute toutes les entrées MIDI branchées (multi-appareils) et remonte les notes.
 * Les rappels se configurent par affectation (`input.onNoteOn = …`) ou par les
 * méthodes `setOnNoteOn` / `setOnNoteOff`.
 */
export class MidiInput {
  onNoteOn: NoteOnHandler | null = null;
  onNoteOff: NoteOffHandler | null = null;

  private access: WebMidiAccessLike | null = null;
  private devices: MidiDeviceInfo[] = [];
  private attached = new Map<string, WebMidiPortLike>();
  private stateHandler: ((event: unknown) => void) | null = null;

  /** Web MIDI est-il exposé par ce navigateur ? (Safari iOS ne l’expose pas.) */
  isSupported(): boolean {
    return getRequestMidiAccess() !== null;
  }

  get connected(): boolean {
    return this.access !== null;
  }

  setOnNoteOn(handler: NoteOnHandler | null): void {
    this.onNoteOn = handler;
  }

  setOnNoteOff(handler: NoteOffHandler | null): void {
    this.onNoteOff = handler;
  }

  /**
   * Demande l’accès MIDI puis écoute toutes les entrées disponibles.
   * `preferredId` n’est qu’un ordre de présentation : aucun appareil n’est exclu.
   */
  async connect(preferredId?: string): Promise<MidiConnectResult> {
    const request = getRequestMidiAccess();
    if (!request) return { ok: false, error: UNSUPPORTED_INPUT };

    this.disconnect();
    let access: WebMidiAccessLike;
    try {
      access = await request({ sysex: false });
    } catch (error) {
      return { ok: false, error: describeAccessError(error) };
    }

    this.access = access;
    // Branchement à chaud : un appareil ajouté ou retiré est suivi automatiquement.
    this.stateHandler = () => this.refresh();
    access.onstatechange = this.stateHandler;

    const devices = orderDevices(this.listInputs(), preferredId);
    return { ok: true, devices };
  }

  /** Appareils d’entrée actuellement détectés (liste recopiée, ordre du navigateur). */
  listInputs(): MidiDeviceInfo[] {
    this.refresh();
    return this.devices.map((device) => ({ ...device }));
  }

  /** Retire tous les écouteurs et oublie l’accès MIDI. */
  disconnect(): void {
    if (this.access && this.stateHandler) this.access.onstatechange = null;
    this.stateHandler = null;
    this.detachAll();
    this.access = null;
    this.devices = [];
  }

  /** S’assure que chaque entrée connue possède notre écouteur, et oublie les appareils retirés. */
  private refresh(): void {
    if (!this.access) {
      this.detachAll();
      this.devices = [];
      return;
    }
    const seen = new Set<string>();
    const devices: MidiDeviceInfo[] = [];
    for (const port of collectionToPorts(this.access.inputs)) {
      const id = portId(port);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      devices.push(toDeviceInfo(port));
      if (!this.attached.has(id)) {
        port.onmidimessage = (event) => this.handleMessage(event, id);
        this.attached.set(id, port);
      }
    }
    for (const [id, port] of Array.from(this.attached.entries())) {
      if (seen.has(id)) continue;
      port.onmidimessage = null;
      this.attached.delete(id);
    }
    this.devices = devices;
  }

  private detachAll(): void {
    for (const port of this.attached.values()) port.onmidimessage = null;
    this.attached.clear();
  }

  private handleMessage(event: { data?: ArrayLike<number> | null } | null, deviceId: string): void {
    const parsed = parseMidiMessage(event?.data);
    if (!parsed) return;
    if (parsed.type === "noteon") this.onNoteOn?.(parsed.midi, parsed.velocity, deviceId);
    else this.onNoteOff?.(parsed.midi, deviceId);
  }
}

/* ------------------------------------------------------------------ */
/* Sortie MIDI                                                        */
/* ------------------------------------------------------------------ */

/** Pilote un appareil de sortie MIDI : sélection, notes, coupure et libération des ressources. */
export class MidiOutput {
  private access: WebMidiAccessLike | null = null;
  private ports = new Map<string, WebMidiPortLike>();
  private devices: MidiDeviceInfo[] = [];
  private activeId: string | null = null;
  private activePort: WebMidiPortLike | null = null;
  private sounding = new Set<number>();

  isSupported(): boolean {
    return getRequestMidiAccess() !== null;
  }

  get connected(): boolean {
    return this.access !== null;
  }

  get selectedId(): string | null {
    return this.activeId;
  }

  /** Demande l’accès MIDI, liste les sorties et sélectionne éventuellement `preferredId`. */
  async connect(preferredId?: string): Promise<MidiConnectResult> {
    const request = getRequestMidiAccess();
    if (!request) return { ok: false, error: UNSUPPORTED_OUTPUT };

    let access: WebMidiAccessLike;
    try {
      access = await request({ sysex: false });
    } catch (error) {
      return { ok: false, error: describeAccessError(error) };
    }

    this.access = access;
    const devices = this.listOutputs();
    if (preferredId) this.select(preferredId);
    return { ok: true, devices: orderDevices(devices, preferredId) };
  }

  /** Appareils de sortie actuellement détectés. */
  listOutputs(): MidiDeviceInfo[] {
    this.refreshPorts();
    return this.devices.map((device) => ({ ...device }));
  }

  /** Sélectionne une sortie par identifiant (`null` pour tout désélectionner). Renvoie la réussite. */
  select(id: string | null): boolean {
    this.allNotesOff();
    this.refreshPorts();
    if (!id) {
      this.activeId = null;
      this.activePort = null;
      return true;
    }
    const port = this.ports.get(id);
    if (!port || typeof port.send !== "function") {
      this.activeId = null;
      this.activePort = null;
      return false;
    }
    this.activeId = id;
    this.activePort = port;
    return true;
  }

  noteOn(midi: number, velocity = 100): void {
    const note = safeNote(midi);
    const port = this.activePort;
    if (note === null || !port || typeof port.send !== "function") return;
    const raw = Number.isFinite(velocity) ? Math.round(velocity) : 100;
    const strength = Math.min(127, Math.max(1, raw));
    this.sounding.add(note);
    port.send([0x90, note, strength]);
  }

  noteOff(midi: number): void {
    const note = safeNote(midi);
    if (note === null) return;
    this.sounding.delete(note);
    const port = this.activePort;
    if (!port || typeof port.send !== "function") return;
    port.send([0x80, note, 0]);
  }

  /** Coupe toutes les notes dont on a gardé la trace (anti-note bloquée). */
  allNotesOff(): void {
    const port = this.activePort;
    if (port && typeof port.send === "function") {
      for (const note of this.sounding) port.send([0x80, note, 0]);
    }
    this.sounding.clear();
  }

  /** Coupe les notes, détache l’accès MIDI et vide la sélection. */
  dispose(): void {
    this.allNotesOff();
    this.access = null;
    this.ports.clear();
    this.devices = [];
    this.activeId = null;
    this.activePort = null;
  }

  private refreshPorts(): void {
    if (!this.access) {
      this.ports.clear();
      this.devices = [];
      return;
    }
    const ports = new Map<string, WebMidiPortLike>();
    const devices: MidiDeviceInfo[] = [];
    for (const port of collectionToPorts(this.access.outputs)) {
      const id = portId(port);
      if (!id || ports.has(id)) continue;
      ports.set(id, port);
      devices.push(toDeviceInfo(port));
    }
    this.ports = ports;
    this.devices = devices;
    if (this.activeId && !ports.has(this.activeId)) {
      // L’appareil sélectionné a disparu : plus rien à piloter.
      this.activeId = null;
      this.activePort = null;
      this.sounding.clear();
    } else if (this.activeId) {
      this.activePort = ports.get(this.activeId) ?? null;
    }
  }
}

function safeNote(midi: number): number | null {
  if (!Number.isFinite(midi)) return null;
  const note = Math.round(midi);
  if (note < 0 || note > 127) return null;
  return note;
}
