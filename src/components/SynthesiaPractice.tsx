import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Circle,
  Gauge,
  Keyboard,
  Metronome as MetronomeIcon,
  Minus,
  Palette,
  Pause,
  PianoKeys,
  Play,
  Plus,
  PlugsConnected,
  Repeat,
  Ruler,
  SpeakerHigh,
  Stop,
  TextAa,
  Translate,
  Trophy,
  WarningCircle,
} from "@phosphor-icons/react";
import type { Hand, LessonStage, NoteNaming, PracticeStats, ScoreDocument } from "../types";
import { Metronome } from "../audio/metronome";
import { ScorePlayer } from "../audio/scorePlayer";
import { PianoSound } from "../audio/pianoSound";
import { unlockAudio } from "../audio/audioContext";
import { attachComputerKeyboard } from "../input/computerKeyboard";
import { MidiInput, type MidiDeviceInfo } from "../input/midiIo";
import { displayName } from "../music/noteNaming";
import { PracticeScorer, type ExpectedNote, type ScorerStats } from "../practice/scoring";
import { ACTIVE_NOTE_WINDOW_SEC, ZOOM_STEPS, activeNotesAt, beatsToSeconds, stepZoom } from "../practice/timeline";
import {
  beatsPerMeasureOf,
  clampMeasure,
  createTransport,
  measureRangeToSec,
  rescaleTimeForTempo,
  secToMeasure,
} from "../practice/transport";
import { FallingNotes } from "./FallingNotes";

/**
 * Mode Synthesia : la partition devient un piano-roll « notes qui tombent ».
 *
 * Le composant est autonome : il possède son horloge (le transport pur de
 * `practice/transport.ts`), son scoreur, ses entrées (clavier MIDI, clavier
 * d’ordinateur, clavier tactile du canvas) et la mémorisation locale du record.
 * Il ne reçoit de l’extérieur que la partition et l’étape en cours.
 *
 * Repères de jeu :
 * - la ligne de frappe est le haut du clavier intégré au canvas ;
 * - le mode attente fige l’horloge sur chaque note non jouée, jusqu’à la
 *   bonne touche ;
 * - le clavier d’ordinateur suit la position PHYSIQUE des touches (AZERTY
 *   comme QWERTY), transposée d’octave avec ← et →.
 *
 * Architecture : l’horloge d’image (une seule boucle `requestAnimationFrame`)
 * fait avancer le transport et pousse l’état vers React. Le rendu ne lit jamais
 * les objets mutables (transport, scoreur) : il n’affiche que l’état publié.
 */

/** Bornes du réglage de tempo (pourcentage du tempo nominal). */
const MIN_TEMPO_PERCENT = 25;
const MAX_TEMPO_PERCENT = 150;
const TEMPO_STEP_PERCENT = 5;
const DEFAULT_TEMPO_FACTOR = 0.75;

/** Première note du clavier d’ordinateur : Do4, convention de tout l’atelier. */
const KEYBOARD_BASE_MIDI = 60;
const MIN_OCTAVE_SHIFT = -2;
const MAX_OCTAVE_SHIFT = 2;

/**
 * Touches physiques réservées aux raccourcis de la séance : le piano ne les joue
 * pas. « R » n’y figure pas : le redémarrage vit sur « Maj+R » (les combinaisons
 * ne jouent jamais de note) et la touche R reste une note jouable.
 */
const SESSION_SHORTCUT_CODES = ["Space", "Escape", "ArrowLeft", "ArrowRight"] as const;

/**
 * Hauteur du piano-roll : elle suit la place réellement visible sous la scène
 * pour que la ligne de frappe et le clavier (bande basse) restent toujours dans
 * la fenêtre, y compris en fenêtre de 800 px de haut ou en plein écran.
 */
const CANVAS_MIN_HEIGHT_PX = 220;
const CANVAS_MAX_HEIGHT_PX = 760;
/** Hauteur retenue avant la première mesure de la scène. */
const CANVAS_FALLBACK_HEIGHT_PX = 400;
/** Marge gardée sous la scène : le clavier ne colle pas au bord de la fenêtre. */
const SCENE_BOTTOM_MARGIN_PX = 14;
/** Repli de mesure (environnement sans géométrie, rendu hors navigateur). */
const SCENE_ROOM_FALLBACK_PX = CANVAS_FALLBACK_HEIGHT_PX + SCENE_BOTTOM_MARGIN_PX;

/** Estompage automatique du transport et du HUD après une lecture sans interaction. */
const CHROME_HIDE_DELAY_MS = 4000;
/**
 * Période de la minuterie de secours qui veille sur l’estompage. Une fenêtre
 * masquée ou un onglet en arrière-plan gèle les images ; l’intervalle, lui,
 * continue de battre et fait tomber le chrome quand même.
 */
const CHROME_IDLE_TICK_MS = 500;
/**
 * Marge laissée au piano-roll en mode immersif : le canvas occupe tout le
 * viewport, sa bande basse est le clavier et le chrome flotte par-dessus.
 */
const IMMERSIVE_SCENE_MARGIN_PX = 2;
/** Quatre temps d’avance au démarrage : les premières notes tombent du haut de l’écran. */
const LEAD_IN_BEATS = 4;

/** Pas de temps maximal d’une image : un onglet revenu au premier plan ne saute pas. */
const MAX_FRAME_STEP_SEC = 0.25;
/** Seuil d’affichage : en dessous, la position n’a pas bougé de façon visible. */
const TIME_EPSILON_SEC = 0.0005;
/** Nombre de mesures faibles listées dans le bilan de fin. */
const WEAK_MEASURE_LIMIT = 3;
/** Préfixe de la sauvegarde locale de la meilleure précision. */
const BEST_ACCURACY_PREFIX = "atelier-synthesia";

const FALLBACK_BPM = 100;
const MIN_PLAYABLE_BPM = 30;

/** Repères du piano-roll : masqués, par mesure, ou par mesure ET par temps. */
type MarkerMode = "off" | "measures" | "all";

/** Libellé du bouton des repères, selon le mode courant. */
const MARKER_LABELS: Record<MarkerMode, string> = {
  off: "Repères",
  measures: "Mesures",
  all: "Mesures + temps",
};

type MidiState = "idle" | "connecting" | "connected" | "error";
type FeedbackKind = "perfect" | "good" | "wrong" | "miss";

interface Feedback {
  id: number;
  kind: FeedbackKind;
  label: string;
}

interface RunSummary {
  /** Section dont ce bilan est le résultat : lui seul décide de son affichage. */
  runKey: string;
  accuracy: number;
  maxCombo: number;
  correct: number;
  errors: number;
  misses: number;
  weakMeasures: Array<{ measure: number; errors: number }>;
  best: number;
  isBest: boolean;
}

export interface SynthesiaPracticeProps {
  score: ScoreDocument;
  stage: LessonStage | null;
  naming: NoteNaming;
  onNamingChange: (naming: NoteNaming) => void;
  /** Statistiques de la section, remontées à la fin d’une exécution. */
  onStats?: (stats: PracticeStats) => void;
  /** Meilleure précision de l’étape : l’appelant la persiste quand il le peut. */
  onBestAccuracy?: (accuracy: number) => void;
  /** Étape suivante du parcours guidé, proposée à la fin de la section. */
  onContinue?: () => void;
}

/* ------------------------------------------------------------------ */
/* Utilitaires                                                        */
/* ------------------------------------------------------------------ */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Horloge monotone de la session, en millisecondes (repli sur `Date.now`). */
function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now();
  return Date.now();
}

/** Facteur de tempo borné (25 % → 150 %) et aligné sur le pas du curseur. */
function clampTempoFactor(factor: number): number {
  if (!Number.isFinite(factor)) return DEFAULT_TEMPO_FACTOR;
  const percent = Math.round((factor * 100) / TEMPO_STEP_PERCENT) * TEMPO_STEP_PERCENT;
  return clamp(percent, MIN_TEMPO_PERCENT, MAX_TEMPO_PERCENT) / 100;
}

/** Tempo effectif de travail, dans les limites jouables par le métronome. */
function bpmFor(score: ScoreDocument, tempoFactor: number): number {
  const bpm = Number.isFinite(score.bpm) && score.bpm > 0 ? score.bpm : FALLBACK_BPM;
  return Math.max(MIN_PLAYABLE_BPM, Math.round(bpm * tempoFactor));
}

/** Clé de sauvegarde de la meilleure précision, par partition et par étape. */
function bestAccuracyKey(scoreId: string, stageId: string): string {
  return `${BEST_ACCURACY_PREFIX}-${scoreId}-${stageId}`;
}

/** Meilleure précision connue localement (0 si rien n’a encore été joué). */
function loadBestAccuracy(key: string): number {
  try {
    const raw = Number(localStorage.getItem(key));
    return Number.isFinite(raw) ? clamp(Math.round(raw), 0, 100) : 0;
  } catch {
    return 0;
  }
}

/** Mémorise la précision si elle dépasse le record local ; renvoie le record à jour. */
function storeBestAccuracy(key: string, accuracy: number): number {
  const best = Math.max(loadBestAccuracy(key), clamp(Math.round(accuracy), 0, 100));
  try {
    localStorage.setItem(key, String(best));
  } catch {
    // Stockage indisponible (navigation privée) : le bilan de la session reste affiché.
  }
  return best;
}

/** Mesures les plus fautives, de la pire à la meilleure (bilan de fin). */
function weakMeasuresFrom(
  errors: Record<number, number>,
  limit = WEAK_MEASURE_LIMIT,
): Array<{ measure: number; errors: number }> {
  return Object.entries(errors)
    .map(([measure, count]) => ({ measure: Number(measure), errors: count }))
    .filter((row) => Number.isFinite(row.measure) && row.measure > 0 && row.errors > 0)
    .sort((a, b) => b.errors - a.errors || a.measure - b.measure)
    .slice(0, limit);
}

/** Étiquettes françaises du retour visuel d’une frappe. */
function feedbackLabel(kind: FeedbackKind, naming: NoteNaming, midi: number): string {
  const name = ` ${displayName(midi, naming, true)}`;
  if (kind === "perfect") return `Parfait${name}`;
  if (kind === "good") return `Bien${name}`;
  if (kind === "miss") return "Note oubliée";
  return `Raté${name}`;
}

/** Affichage français d’un palier de zoom des touches : ×1, ×1,5, ×2 … */
function zoomLabel(level: number): string {
  return `×${String(level).replace(".", ",")}`;
}

/** Un champ de saisie garde la priorité sur les raccourcis clavier. */
function isTypingTarget(node: EventTarget | null): boolean {
  if (!node || typeof node !== "object") return false;
  const element = node as HTMLElement;
  if (typeof element.tagName !== "string") return false;
  const tag = element.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return element.isContentEditable === true;
}

/** Élément passé en plein écran natif, préfixes WebKit compris. */
function nativeFullscreenElement(): Element | null {
  const scope = document as Document & { webkitFullscreenElement?: Element | null };
  return scope.fullscreenElement ?? scope.webkitFullscreenElement ?? null;
}

/**
 * Demande le plein écran pour un élément. Rend `false` quand l’API n’existe pas
 * (iPhone, WebView) ou quand le navigateur refuse : l’appelant bascule alors sur
 * le mode immersif CSS.
 */
function requestFullscreenOn(element: HTMLElement | null): Promise<boolean> {
  if (!element) return Promise.resolve(false);
  if (typeof element.requestFullscreen === "function") {
    return Promise.resolve(element.requestFullscreen()).then(
      () => true,
      () => false,
    );
  }
  const legacy = (element as HTMLElement & { webkitRequestFullscreen?: () => void }).webkitRequestFullscreen;
  if (typeof legacy !== "function") return Promise.resolve(false);
  try {
    legacy.call(element);
    return Promise.resolve(true);
  } catch {
    return Promise.resolve(false);
  }
}

/** Quitte le plein écran natif s’il est actif (sans effet sinon). */
function exitNativeFullscreen(): Promise<void> {
  const scope = document as Document & { webkitExitFullscreen?: () => Promise<void> | void };
  if (!nativeFullscreenElement()) return Promise.resolve();
  if (typeof scope.exitFullscreen === "function") {
    return Promise.resolve(scope.exitFullscreen()).then(
      () => undefined,
      () => undefined,
    );
  }
  const legacy = scope.webkitExitFullscreen;
  if (typeof legacy !== "function") return Promise.resolve();
  return Promise.resolve(legacy.call(scope)).then(
    () => undefined,
    () => undefined,
  );
}

/* ------------------------------------------------------------------ */
/* Composant                                                          */
/* ------------------------------------------------------------------ */

export function SynthesiaPractice({
  score,
  stage,
  naming,
  onNamingChange,
  onStats,
  onBestAccuracy,
  onContinue,
}: SynthesiaPracticeProps) {
  const stageStartMeasure = clampMeasure(score, stage?.measureStart ?? 1);
  const stageEndMeasure = clampMeasure(score, stage?.measureEnd ?? score.measureCount);
  const stageId = stage?.id ?? "section-libre";

  const [hand, setHand] = useState<Hand>(stage?.hand ?? "both");
  const [tempoFactor, setTempoFactor] = useState(() => clampTempoFactor(stage?.tempoFactor ?? DEFAULT_TEMPO_FACTOR));
  const [waitMode, setWaitMode] = useState(true);
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [loopOn, setLoopOn] = useState(false);
  const [loopStart, setLoopStart] = useState(stageStartMeasure);
  const [loopEnd, setLoopEnd] = useState(stageEndMeasure);
  const [colorByPitch, setColorByPitch] = useState(false);
  /**
   * Noms des notes : DÉSACTIVÉ par défaut dans le mode Synthesia. Le toggle
   * garde la main sur les deux affichages — noms dans les capsules et étiquettes
   * (Do) du clavier — pour que la scène reste propre à l’ouverture.
   */
  const [showNoteNames, setShowNoteNames] = useState(false);
  const [octaveShift, setOctaveShift] = useState(0);
  /** Zoom des touches : 1 = clavier entier, 3 = fenêtre réduite au tiers. */
  const [zoomLevel, setZoomLevel] = useState<number>(ZOOM_STEPS[0]);
  /** Repères du piano-roll : une ligne par mesure par défaut. */
  const [markers, setMarkers] = useState<MarkerMode>("measures");
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [time, setTime] = useState(0);
  const [pressedMidis, setPressedMidis] = useState<number[]>([]);
  const [liveStats, setLiveStats] = useState<ScorerStats>(() => ({
    correct: 0,
    errors: 0,
    misses: 0,
    combo: 0,
    maxCombo: 0,
    accuracy: 0,
    errorsByMeasure: {},
  }));
  const [feedback, setFeedback] = useState<Feedback>({ id: 0, kind: "perfect", label: "" });
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null);
  const [midiState, setMidiState] = useState<MidiState>("idle");
  const [midiMessage, setMidiMessage] = useState("");
  const [midiDevices, setMidiDevices] = useState<MidiDeviceInfo[]>([]);
  const [fullscreen, setFullscreen] = useState(false);
  /** Repli CSS du plein écran (iPhone, WebView) : la scène occupe le viewport. */
  const [immersive, setImmersive] = useState(false);
  /** Transport et HUD estompés pendant la lecture, comme un lecteur vidéo. */
  const [chromeHidden, setChromeHidden] = useState(false);
  /** Place visible sous la scène, en pixels : elle dimensionne le piano-roll. */
  const [sceneRoomPx, setSceneRoomPx] = useState(SCENE_ROOM_FALLBACK_PX);
  /** Ligne de frappe publiée par le canvas, dont le clavier suit les vraies proportions. */
  const [hitLinePercent, setHitLinePercent] = useState(72);
  /** Hauteur du viewport : en immersif, le piano-roll occupe toute la fenêtre. */
  const [viewportHeightPx, setViewportHeightPx] = useState(() =>
    typeof window === "undefined" ? CANVAS_FALLBACK_HEIGHT_PX : Math.round(window.innerHeight),
  );
  const [demoOn, setDemoOn] = useState(false);
  const [playbackError, setPlaybackError] = useState("");

  // Objets impératifs : horloge, score, audio, entrées. Leur état interne n’est
  // jamais lu pendant le rendu, il est publié par l’horloge d’image.
  const transportRef = useRef(createTransport());
  const scorerRef = useRef(new PracticeScorer([]));
  const metronomeRef = useRef(new Metronome());
  const scorePlayerRef = useRef(new ScorePlayer());
  const pianoSoundRef = useRef(new PianoSound());
  const [midiInput] = useState(() => new MidiInput());
  const midiSupported = useMemo(() => midiInput.isSupported(), [midiInput]);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const pressedRef = useRef(new Set<number>());
  /** État d’estompage du chrome, suivi hors rendu : l’horloge d’image le décide. */
  const chromeHiddenRef = useRef(false);
  /**
   * Horodatage de la dernière interaction (pointeur, tap, touche), sur l’horloge
   * de `performance.now()`. L’estompage compare cet horodatage au temps de
   * l’image : aucune minuterie à réarmer, donc aucun délai perdu en route.
   */
  const lastInteractionRef = useRef(0);
  /** « Jouer / Pause » courant : le bouton et la barre d’espace suivent le même chemin. */
  const playPauseRef = useRef<() => void>(() => undefined);
  /** Le plein écran automatique n’est tenté qu’au tout premier appui sur « Jouer ». */
  const autoFullscreenRef = useRef(false);

  /**
   * Décision d’estompage du chrome pendant la lecture : l’écart entre l’horloge
   * courante et l’horodatage de la dernière interaction fait disparaître le
   * transport et le HUD ; à l’arrêt, tout revient.
   *
   * Elle lit l’horloge DU TRANSPORT (et non l’état publié) : elle reste donc
   * juste même quand les images ne passent pas. Appelée par l’horloge d’image ET
   * par une minuterie de secours, elle rend l’estompage déterministe : aucune
   * minuterie à réarmer, donc aucun délai perdu en route.
   */
  const settleChromeIdle = useCallback((clockMs: number) => {
    if (transportRef.current.playing) {
      if (lastInteractionRef.current <= 0) lastInteractionRef.current = clockMs;
      if (chromeHiddenRef.current || clockMs - lastInteractionRef.current < CHROME_HIDE_DELAY_MS) return;
      chromeHiddenRef.current = true;
      setChromeHidden(true);
      return;
    }
    if (!chromeHiddenRef.current) return;
    chromeHiddenRef.current = false;
    setChromeHidden(false);
  }, []);

  const tempoPercent = Math.round(tempoFactor * 100);
  const effectiveBpm = bpmFor(score, tempoFactor);
  const baseMidi = KEYBOARD_BASE_MIDI + octaveShift * 12;
  const bestKey = bestAccuracyKey(score.id, stageId);
  /** Plein écran natif ou repli immersif : les deux partagent le même rendu. */
  const immersiveView = fullscreen || immersive;
  /** Transport et HUD estompés : uniquement pendant la lecture, après un temps calme. */
  const chromeIdle = playing && chromeHidden;
  /**
   * Hauteur du piano-roll. En immersif (plein écran natif ou repli CSS), le
   * canvas occupe tout le viewport : le clavier est sa bande basse et le chrome
   * flotte par-dessus. Sinon, il suit la place visible sous la scène.
   */
  const canvasHeightPx = immersiveView
    ? Math.max(CANVAS_MIN_HEIGHT_PX, Math.round(viewportHeightPx - IMMERSIVE_SCENE_MARGIN_PX))
    : clamp(sceneRoomPx - SCENE_BOTTOM_MARGIN_PX, CANVAS_MIN_HEIGHT_PX, CANVAS_MAX_HEIGHT_PX);
  /** Section jouée : mesures (étape ou boucle), portée(s) et notes attendues en secondes. */
  const section = useMemo(() => {
    const from = clampMeasure(score, loopOn ? loopStart : stageStartMeasure);
    const to = clampMeasure(score, loopOn ? loopEnd : stageEndMeasure);
    const startMeasure = Math.min(from, to);
    const endMeasure = Math.max(from, to);
    const range = measureRangeToSec(score, startMeasure, endMeasure, tempoFactor);
    const loopRange = loopOn ? measureRangeToSec(score, loopStart, loopEnd, tempoFactor) : null;
    const notes = score.notes
      .filter((note) => note.measure >= startMeasure && note.measure <= endMeasure)
      .slice()
      .sort((a, b) => a.onsetBeats - b.onsetBeats || a.midi - b.midi);
    const playable = hand === "both" ? notes : notes.filter((note) => note.hand === hand);
    const expected: ExpectedNote[] = playable.map((note) => ({
      id: note.id,
      midi: note.midi,
      onsetSec: beatsToSeconds(note.onsetBeats, score.bpm, tempoFactor),
      measure: note.measure,
    }));
    return {
      startMeasure,
      endMeasure,
      range,
      loopRange,
      notes,
      playable,
      expected,
      runKey: `${score.id}|${startMeasure}-${endMeasure}|${hand}|${loopOn ? "boucle" : "etape"}|${score.notes.length}`,
    };
  }, [score, hand, tempoFactor, loopOn, loopStart, loopEnd, stageStartMeasure, stageEndMeasure]);

  const activeNotes = useMemo(
    () => activeNotesAt(section.playable, time, ACTIVE_NOTE_WINDOW_SEC, { bpm: score.bpm, tempoFactor }),
    [section.playable, time, score.bpm, tempoFactor],
  );
  const activeMidis = useMemo(() => activeNotes.map((note) => note.midi), [activeNotes]);
  const currentMeasure = useMemo(() => secToMeasure(score, time, tempoFactor), [score, time, tempoFactor]);
  const targetLabel = useMemo(
    () => activeNotes.map((note) => displayName(note.midi, naming, true)).join(" + "),
    [activeNotes, naming],
  );
  const sectionEmpty = section.playable.length === 0;
  const hasScoreNotes = score.notes.length > 0;
  /** Le bilan ne s’affiche que pour la section qu’il décrit. */
  const visibleSummary = runSummary && runSummary.runKey === section.runKey ? runSummary : null;

  /* --------------------------- Entrées --------------------------- */

  const handleNoteOn = useCallback(
    (midi: number, velocity = 100) => {
      if (!Number.isFinite(midi)) return;
      const note = Math.round(midi);
      void pianoSoundRef.current.noteOn(note, velocity).catch((reason: unknown) => {
        setPlaybackError(reason instanceof Error ? reason.message : "Le son du piano n’a pas pu démarrer.");
      });
      pressedRef.current.add(note);
      setPressedMidis((current) => (current.includes(note) ? current : [...current, note].sort((a, b) => a - b)));
      const transport = transportRef.current;
      // Hors lecture, le clavier reste libre : rien n’est jugé tant que
      // l’horloge ne donne pas le temps de référence.
      if (!transport.playing) return;
      const judgement = scorerRef.current.onKeyDown(note, transport.time);
      setFeedback((current) => ({ id: current.id + 1, kind: judgement.kind, label: feedbackLabel(judgement.kind, naming, note) }));
    },
    [naming],
  );

  const handleNoteOff = useCallback((midi: number) => {
    const note = Math.round(midi);
    pianoSoundRef.current.noteOff(note);
    pressedRef.current.delete(note);
    setPressedMidis((current) => (current.includes(note) ? current.filter((value) => value !== note) : current));
  }, []);

  /* --------------------------- Effets --------------------------- */

  // Nouvelle exécution : le scoreur est reconstruit (les attaques en secondes
  // dépendent du tempo) et l’horloge repart au début de la section — ou de la
  // boucle — dès que la position courante sort de la nouvelle plage. Un simple
  // changement de tempo, lui, conserve la position musicale.
  useEffect(() => {
    const transport = transportRef.current;
    const previousFactor = transport.tempoFactor;
    const rescaled = rescaleTimeForTempo(transport.time, previousFactor, tempoFactor);
    transport.setTempoFactor(tempoFactor);
    transport.setRange(section.range.startSec, section.range.endSec);
    transport.setLoop(section.loopRange);
    const startSec = section.loopRange ? section.loopRange.startSec : section.range.startSec;
    const inside = rescaled >= section.range.startSec - TIME_EPSILON_SEC && rescaled < section.range.endSec;
    transport.seek(inside ? rescaled : startSec);
    scorerRef.current = new PracticeScorer(section.expected);
  }, [section, tempoFactor]);

  // Mode attente : le transport doit le connaître AVANT d’avancer, sinon
  // l’horloge ne s’arrête jamais sur les notes (il ne se fie qu’à son propre
  // drapeau, celui du scoreur ne suffit pas) ; le scoreur est mis à jour aussi,
  // sans reconstruire la session en cours.
  useEffect(() => {
    transportRef.current.setWaitMode(waitMode);
    scorerRef.current.enableWaitMode(waitMode);
  }, [waitMode]);

  // Horloge d’image : avance le transport, récolte les oublis et publie l’état.
  // Elle se relance quand la section, le nommage ou le mode attente changent.
  useEffect(() => {
    let handle = 0;
    let last = typeof performance === "undefined" ? 0 : performance.now();
    let pushedTime = Number.NEGATIVE_INFINITY;
    let pushedWaiting = false;
    let pushedPlaying = false;
    let pushedStatsKey = "";
    const schedule =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame.bind(window)
        : (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 16);
    const unschedule =
      typeof window.cancelAnimationFrame === "function" ? window.cancelAnimationFrame.bind(window) : window.clearTimeout;

    const tick = (now: number) => {
      handle = schedule(tick);
      const dt = clamp((now - last) / 1000, 0, MAX_FRAME_STEP_SEC);
      last = now;
      const transport = transportRef.current;
      const scorer = scorerRef.current;
      scorer.enableWaitMode(waitMode);

      // Estompage du chrome (lecteur vidéo), décidé à chaque image : pendant la
      // lecture, l’écart entre le temps courant et la dernière interaction
      // déclenche l’estompage ; hors lecture, tout reste visible.
      settleChromeIdle(now);

      if (transport.playing && section.expected.length) {
        const step = transport.advance(dt, scorer.pendingNotes());
        if (!waitMode) {
          const misses = scorer.tick(step.time);
          if (misses.length > 0) {
            const missed = section.expected.find((note) => note.id === misses[0].noteId);
            setFeedback((current) => ({
              id: current.id + 1,
              kind: "miss",
              label: missed ? `${feedbackLabel("miss", naming, missed.midi)} (${displayName(missed.midi, naming, true)})` : "Note oubliée",
            }));
          }
        }
        if (step.completed) {
          const stats = scorer.stats();
          const previousBest = loadBestAccuracy(bestKey);
          setRunSummary({
            runKey: section.runKey,
            accuracy: stats.accuracy,
            maxCombo: stats.maxCombo,
            correct: stats.correct,
            errors: stats.errors,
            misses: stats.misses,
            weakMeasures: weakMeasuresFrom(stats.errorsByMeasure),
            best: storeBestAccuracy(bestKey, stats.accuracy),
            isBest: stats.accuracy > previousBest,
          });
          onStats?.(scorer.toPracticeStats());
          onBestAccuracy?.(stats.accuracy);
        }
      }

      if (
        Math.abs(transport.time - pushedTime) > TIME_EPSILON_SEC ||
        transport.frozen !== pushedWaiting ||
        transport.playing !== pushedPlaying
      ) {
        pushedTime = transport.time;
        pushedWaiting = transport.frozen;
        pushedPlaying = transport.playing;
        setTime(transport.time);
        setWaiting(transport.frozen);
        setPlaying(transport.playing);
      }

      const stats = scorer.stats();
      const statsKey = `${stats.correct}|${stats.errors}|${stats.misses}|${stats.combo}|${stats.maxCombo}|${stats.accuracy}`;
      if (statsKey !== pushedStatsKey) {
        pushedStatsKey = statsKey;
        setLiveStats(stats);
      }
    };

    handle = schedule(tick);
    // Minuterie de secours : même si les images se gèlent (onglet en arrière-plan,
    // WebView), l’estompage du chrome reste décidé par l’horloge du transport.
    const idleTick = window.setInterval(() => settleChromeIdle(nowMs()), CHROME_IDLE_TICK_MS);
    return () => {
      unschedule(handle);
      window.clearInterval(idleTick);
    };
  }, [section, naming, waitMode, bestKey, onStats, onBestAccuracy, settleChromeIdle]);

  // Clavier d’ordinateur : touche physique → note MIDI, transposée d’octave.
  // Les codes réservés aux raccourcis de la séance ne jouent aucune note.
  useEffect(() => {
    return attachComputerKeyboard(window, {
      baseMidi,
      reservedCodes: SESSION_SHORTCUT_CODES,
      onNoteOn: handleNoteOn,
      onNoteOff: handleNoteOff,
    });
  }, [baseMidi, handleNoteOn, handleNoteOff]);

  // Clavier MIDI : les appareils branchés à chaud sont repris par `MidiInput`.
  useEffect(() => {
    midiInput.setOnNoteOn(handleNoteOn);
    midiInput.setOnNoteOff(handleNoteOff);
    return () => {
      midiInput.setOnNoteOn(null);
      midiInput.setOnNoteOff(null);
    };
  }, [midiInput, handleNoteOn, handleNoteOff]);

  // Métronome : battement aligné sur le tempo effectif, seulement pendant la lecture.
  useEffect(() => {
    const metronome = metronomeRef.current;
    if (metronomeOn && playing && !sectionEmpty) {
      void metronome.start(effectiveBpm, score.timeSignature[0]);
    } else {
      metronome.stop();
    }
    return () => metronome.stop();
  }, [metronomeOn, playing, effectiveBpm, score.timeSignature, sectionEmpty]);

  // Plein écran : l’état suit l’API du navigateur (Échap reste disponible).
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(nativeFullscreenElement()));
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    onChange();
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  // Le piano-roll se dimensionne sur la place visible sous la scène : la ligne de
  // frappe et le clavier restent ainsi dans la fenêtre, même en 800 px de haut.
  // Les mesures sont refaites quand la page bouge (redimensionnement, boucle,
  // affichage du plein écran) et une fois les polices chargées.
  useLayoutEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const measure = () => {
      const rect = scene.getBoundingClientRect();
      setSceneRoomPx(Math.max(0, Math.round(window.innerHeight - rect.top)));
    };
    measure();
    const raf = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    if (fonts?.ready) void fonts.ready.then(measure).catch(() => undefined);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, [immersiveView, loopOn, sectionEmpty, hasScoreNotes]);

  // Hauteur du viewport : elle dimensionne le piano-roll immersif, qui occupe
  // tout l’écran. Remesurée à l’entrée et à la sortie du plein écran, à la
  // rotation et à chaque redimensionnement.
  useEffect(() => {
    const measure = () => setViewportHeightPx(Math.round(window.innerHeight));
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [immersiveView]);

  /**
   * Estompage du transport et du HUD pendant la lecture : ils s’effacent après
   * quelques secondes sans interaction et reviennent au moindre mouvement, comme
   * un lecteur vidéo. Le piano-roll, lui, reste toujours visible.
   *
   * Le délai est tenu par l’horloge d’image (voir `tick`) : chaque interaction
   * pose un horodatage, chaque image compare cet horodatage au temps courant.
   * Aucune minuterie ne peut donc se perdre en route.
   */
  const showChrome = useCallback(() => {
    lastInteractionRef.current = nowMs();
    chromeHiddenRef.current = false;
    setChromeHidden(false);
  }, []);

  /** Moindre mouvement, tap ou touche : le transport revient, le délai repart. */
  const revealChrome = useCallback(() => {
    lastInteractionRef.current = nowMs();
    // Déjà visible : aucun rendu à refaire, seul l’horodatage compte.
    if (!chromeHiddenRef.current) return;
    chromeHiddenRef.current = false;
    setChromeHidden(false);
  }, []);

  // Le chrome revient au moindre mouvement, tap ou touche. Les écouteurs restent
  // posés en permanence : hors lecture, l’estompage n’est jamais décidé.
  useEffect(() => {
    window.addEventListener("pointermove", revealChrome, { passive: true });
    window.addEventListener("pointerdown", revealChrome, { passive: true });
    window.addEventListener("keydown", revealChrome);
    return () => {
      window.removeEventListener("pointermove", revealChrome);
      window.removeEventListener("pointerdown", revealChrome);
      window.removeEventListener("keydown", revealChrome);
    };
  }, [revealChrome]);

  // Raccourcis globaux : Espace (lecture/pause), R (recommencer), ← → (octave),
  // Échap (sortie du mode immersif).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.key === "Escape" && immersive) {
        setImmersive(false);
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        // Même chemin que le bouton « Jouer » : arrivée progressive des notes et
        // plein écran au premier lancement compris.
        playPauseRef.current();
        return;
      }
      if (event.code === "KeyR" && event.shiftKey) {
        event.preventDefault();
        scorePlayerRef.current.stop();
        transportRef.current.reset();
        transportRef.current.seek(section.loopRange ? section.loopRange.startSec : section.range.startSec);
        scorerRef.current.reset();
        setDemoOn(false);
        setRunSummary(null);
        return;
      }
      if (event.code === "ArrowLeft") {
        event.preventDefault();
        setOctaveShift((current) => Math.max(MIN_OCTAVE_SHIFT, current - 1));
        return;
      }
      if (event.code === "ArrowRight") {
        event.preventDefault();
        setOctaveShift((current) => Math.min(MAX_OCTAVE_SHIFT, current + 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [section, immersive]);

  // Libération propre des ressources audio et des touches tenues.
  useEffect(() => {
    const player = scorePlayerRef.current;
    const piano = pianoSoundRef.current;
    const metronome = metronomeRef.current;
    const held = pressedRef.current;
    return () => {
      player.stop();
      piano.stopAll();
      metronome.stop();
      midiInput.disconnect();
      held.clear();
    };
  }, [midiInput]);

  /* ------------------------- Commandes ------------------------- */

  const stopDemo = useCallback(() => {
    scorePlayerRef.current.stop();
    setDemoOn(false);
  }, []);

  /**
   * Au premier appui sur « Jouer », la scène passe en plein écran : le geste de
   * l’utilisateur autorise la demande, et le mode immersif CSS prend le relais
   * quand l’API est absente (iPhone) ou refusée (WebView, permission).
   */
  const enterFullscreenOnFirstPlay = useCallback(() => {
    if (autoFullscreenRef.current) return;
    autoFullscreenRef.current = true;
    if (immersiveView) return;
    void requestFullscreenOn(shellRef.current).then((granted) => {
      if (!granted) setImmersive(true);
    });
  }, [immersiveView]);

  /** Bouton « Plein écran » : plein écran natif, sinon mode immersif CSS. */
  const toggleFullscreen = useCallback(() => {
    if (immersiveView) {
      // Sortie : les deux mécanismes redescendent ensemble (Échap et le bouton).
      setImmersive(false);
      void exitNativeFullscreen();
      return;
    }
    void requestFullscreenOn(shellRef.current).then((granted) => {
      if (!granted) setImmersive(true);
    });
  }, [immersiveView]);

  const startPlayback = useCallback(() => {
    scorePlayerRef.current.stop();
    setDemoOn(false);
    setPlaybackError("");
    // La lecture repart : le transport et le HUD redeviennent visibles.
    showChrome();
    void unlockAudio().catch(() => undefined);
    const transport = transportRef.current;
    const startSec = section.loopRange ? section.loopRange.startSec : section.range.startSec;
    const leadInSec = beatsToSeconds(LEAD_IN_BEATS, score.bpm, tempoFactor);
    // Arrivée progressive : l’horloge part quatre temps AVANT le début de la
    // plage (position négative autorisée quand la section commence à zéro) pour
    // que les premières notes tombent visiblement du haut de l’écran au lieu
    // d’apparaître sur la ligne de frappe. Une reprise en cours de section, elle,
    // ne recule pas.
    const fromStart = !transport.playing && (transport.completed || transport.time <= startSec + TIME_EPSILON_SEC);
    transport.setRange(section.range.startSec, section.range.endSec);
    if (fromStart) {
      // Nouvelle exécution : le scoreur repart de zéro, l’ancien bilan s’efface.
      scorerRef.current.reset();
      setRunSummary(null);
      if (leadInSec > 0) {
        transport.setRange(startSec - leadInSec, section.range.endSec);
        transport.seek(startSec - leadInSec);
      }
    }
    transport.play();
    enterFullscreenOnFirstPlay();
  }, [enterFullscreenOnFirstPlay, score.bpm, section, showChrome, tempoFactor]);

  const pausePlayback = useCallback(() => {
    transportRef.current.pause();
    // À l’arrêt, le transport reste affiché.
    showChrome();
  }, [showChrome]);

  // Le bouton « Jouer/Pause » et la barre d’espace suivent le même chemin.
  useEffect(() => {
    playPauseRef.current = playing ? pausePlayback : startPlayback;
  }, [playing, pausePlayback, startPlayback]);

  const restartSection = useCallback(() => {
    stopDemo();
    const transport = transportRef.current;
    transport.reset();
    transport.seek(section.loopRange ? section.loopRange.startSec : section.range.startSec);
    scorerRef.current.reset();
    setRunSummary(null);
    showChrome();
  }, [section, showChrome, stopDemo]);

  const replaySection = useCallback(() => {
    restartSection();
    startPlayback();
  }, [restartSection, startPlayback]);

  const toggleDemo = useCallback(() => {
    if (demoOn) {
      stopDemo();
      return;
    }
    const notes = section.playable;
    if (!notes.length) return;
    pausePlayback();
    transportRef.current.seek(section.range.startSec);
    setPlaybackError("");
    setDemoOn(true);
    void unlockAudio()
      .then(() =>
        scorePlayerRef.current.play(
          notes,
          score.bpm * tempoFactor,
          (index) => {
            const note = notes[index];
            if (!note) return;
            transportRef.current.seek(beatsToSeconds(note.onsetBeats, score.bpm, tempoFactor));
          },
          () => setDemoOn(false),
        ),
      )
      .catch((reason: unknown) => {
        setDemoOn(false);
        setPlaybackError(reason instanceof Error ? reason.message : "La lecture n’a pas pu démarrer.");
      });
  }, [demoOn, pausePlayback, score.bpm, section, stopDemo, tempoFactor]);

  const connectMidi = useCallback(() => {
    setMidiState("connecting");
    setMidiMessage("Recherche des appareils MIDI…");
    void midiInput.connect().then((result) => {
      if (!result.ok) {
        setMidiState("error");
        setMidiDevices([]);
        setMidiMessage(result.error);
        return;
      }
      setMidiDevices(result.devices);
      setMidiState("connected");
      setMidiMessage(
        result.devices.length
          ? `Connecté à ${result.devices.map((device) => device.name).join(", ")}.`
          : "Autorisation accordée, mais aucun clavier détecté : branchez-le puis reconnectez.",
      );
    });
  }, [midiInput]);

  const changeLoopBound = useCallback(
    (bound: "start" | "end", value: number) => {
      const next = clampMeasure(score, value);
      if (bound === "start") setLoopStart(next);
      else setLoopEnd(next);
    },
    [score],
  );

  /** Zoom des touches : un palier de plus (direction > 0) ou de moins. */
  const changeZoom = useCallback((direction: number) => {
    setZoomLevel((current) => stepZoom(current, direction));
  }, []);

  /** Repères du piano-roll : masqués → par mesure → par mesure et par temps. */
  const cycleMarkers = useCallback(() => {
    setMarkers((current) => (current === "off" ? "measures" : current === "measures" ? "all" : "off"));
  }, []);

  /* --------------------------- Rendu --------------------------- */

  if (!hasScoreNotes) {
    return (
      <section className="synthesia" aria-label="Mode Synthesia">
        <div className="synthesia-empty-state">
          <PianoKeys size={40} weight="duotone" />
          <strong>Importez une partition MIDI pour commencer</strong>
          <p>
            Le piano-roll a besoin de notes jouables : importez un fichier MIDI ou MusicXML, ou reliez un PDF à son
            MusicXML reconnu. La partition d’exemple « Premiers pas en do » fonctionne aussi, dès le premier lancement.
          </p>
        </div>
      </section>
    );
  }

  const tempoLabel = `${tempoPercent} % · ${effectiveBpm} BPM`;
  const handLabel = hand === "right" ? "Main droite" : hand === "left" ? "Main gauche" : "Deux mains";
  const sceneClassName = ["synthesia", fullscreen ? "is-fullscreen" : "", immersive ? "immersive" : ""]
    .filter((name) => name.length > 0)
    .join(" ");

  return (
    <section className={sceneClassName} aria-label="Mode Synthesia" ref={shellRef}>
      {/* Transport et HUD : estompés ensemble pendant la lecture. */}
      <div className={`synthesia-chrome ${chromeIdle ? "is-idle" : ""}`}>
        <div className="synthesia-bar" role="toolbar" aria-label="Transport du mode Synthesia">
          <div className="synthesia-bar-group">
            <button
              className="synthesia-play"
              type="button"
              onClick={() => (playing ? pausePlayback() : startPlayback())}
              disabled={sectionEmpty}
              aria-label={playing ? "Mettre la lecture en pause" : "Lancer la lecture"}
            >
              {playing ? <Pause size={20} weight="fill" /> : <Play size={20} weight="fill" />}
              {playing ? "Pause" : "Jouer"}
            </button>
            <button className="synthesia-button" type="button" onClick={restartSection} aria-label="Recommencer la section depuis le début">
              <ArrowCounterClockwise size={18} /> Recommencer
            </button>
            <button
              className={`synthesia-button ${demoOn ? "is-on" : ""}`}
              type="button"
              onClick={toggleDemo}
              disabled={sectionEmpty}
              aria-pressed={demoOn}
              aria-label={demoOn ? "Arrêter l’écoute de la section" : "Écouter la section avant de la jouer"}
            >
              {demoOn ? <Stop size={18} weight="fill" /> : <SpeakerHigh size={18} />} {demoOn ? "Arrêter" : "Écouter"}
            </button>
            <label className="synthesia-tempo">
              <Gauge size={18} />
              <span>Tempo</span>
              <input
                type="range"
                min={MIN_TEMPO_PERCENT}
                max={MAX_TEMPO_PERCENT}
                step={TEMPO_STEP_PERCENT}
                value={tempoPercent}
                onChange={(event) => setTempoFactor(clampTempoFactor(Number(event.target.value) / 100))}
                aria-label={`Tempo de travail : ${tempoPercent} pour cent du tempo nominal`}
              />
              <output>{tempoLabel}</output>
            </label>
            <div className="synthesia-hands" role="group" aria-label="Mains jouées">
              {(["both", "right", "left"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  data-hand={value}
                  className={hand === value ? "is-on" : ""}
                  aria-pressed={hand === value}
                  onClick={() => {
                    if (value === hand) return;
                    setHand(value);
                    restartSection(); // nouvelle portée : le compte repart de zéro
                  }}
                >
                  {value === "both" ? "Les deux" : value === "right" ? "Droite" : "Gauche"}
                </button>
              ))}
            </div>
            {/* Zoom des touches : réduire la fenêtre visible du clavier et la
                laisser suivre les notes (iPhone, écrans étroits). */}
            <div className="synthesia-zoom" role="group" aria-label="Zoom des touches">
              <button
                type="button"
                className="synthesia-zoom-step"
                onClick={() => changeZoom(-1)}
                disabled={zoomLevel <= ZOOM_STEPS[0]}
                aria-label="Réduire le zoom des touches"
              >
                <Minus size={16} weight="bold" />
              </button>
              <output className="synthesia-zoom-value" aria-live="polite">
                {zoomLabel(zoomLevel)}
              </output>
              <button
                type="button"
                className="synthesia-zoom-step"
                onClick={() => changeZoom(1)}
                disabled={zoomLevel >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                aria-label="Agrandir le zoom des touches"
              >
                <Plus size={16} weight="bold" />
              </button>
            </div>
          </div>

          <div className="synthesia-bar-group synthesia-bar-toggles">
            <button type="button" className={waitMode ? "is-on" : ""} aria-pressed={waitMode} onClick={() => setWaitMode((value) => !value)}>
              <Circle size={16} weight={waitMode ? "fill" : "regular"} /> Mode attente
            </button>
            <button
              type="button"
              className={metronomeOn ? "is-on" : ""}
              aria-pressed={metronomeOn}
              onClick={() => setMetronomeOn((value) => !value)}
            >
              <MetronomeIcon size={18} /> Métronome
            </button>
            <button type="button" className={loopOn ? "is-on" : ""} aria-pressed={loopOn} onClick={() => setLoopOn((value) => !value)}>
              <Repeat size={18} /> Boucle
            </button>
            <button
              type="button"
              className={colorByPitch ? "is-on" : ""}
              aria-pressed={colorByPitch}
              onClick={() => setColorByPitch((value) => !value)}
            >
              <Palette size={18} /> Solfège coloré
            </button>
            <button
              type="button"
              className={showNoteNames ? "is-on" : ""}
              aria-pressed={showNoteNames}
              onClick={() => setShowNoteNames((value) => !value)}
            >
              <TextAa size={18} /> Noms
            </button>
            {/* Repères du piano-roll : une ligne par mesure, puis par temps. */}
            <button
              type="button"
              className={markers !== "off" ? "is-on" : ""}
              aria-pressed={markers !== "off"}
              onClick={cycleMarkers}
              aria-label={
                markers === "off"
                  ? "Repères de mesure masqués"
                  : markers === "measures"
                    ? "Repères de mesure affichés : une ligne par mesure"
                    : "Repères affichés : lignes par mesure et par temps"
              }
            >
              <Ruler size={18} /> {MARKER_LABELS[markers]}
            </button>
            <button
              type="button"
              onClick={() => onNamingChange(naming === "french" ? "letters" : "french")}
              aria-label={`Noms des notes en ${naming === "french" ? "lettres" : "solfège"}`}
            >
              <Translate size={18} /> {naming === "french" ? "Do Ré Mi" : "C D E"}
            </button>
            <button
              className={`synthesia-button ${immersiveView ? "is-on" : ""}`}
              type="button"
              onClick={toggleFullscreen}
              aria-pressed={immersiveView}
              aria-label={immersiveView ? "Quitter le plein écran" : "Passer en plein écran"}
            >
              <span className="synthesia-fullscreen-glyph" aria-hidden="true">
                ⛶
              </span>{" "}
              Plein écran
            </button>
          </div>

          {loopOn && (
            <div className="synthesia-loop" role="group" aria-label="Boucle A–B par mesures">
              <Repeat size={17} />
              <label>
                Mesure A
                <input
                  type="number"
                  min={1}
                  max={score.measureCount}
                  value={loopStart}
                  onChange={(event) => changeLoopBound("start", Number(event.target.value))}
                />
              </label>
              <label>
                Mesure B
                <input
                  type="number"
                  min={1}
                  max={score.measureCount}
                  value={loopEnd}
                  onChange={(event) => changeLoopBound("end", Number(event.target.value))}
                />
              </label>
              <span className="synthesia-loop-hint">
                Mesures {section.startMeasure}–{section.endMeasure} · {section.playable.length} note
                {section.playable.length > 1 ? "s" : ""} à jouer
              </span>
            </div>
          )}
        </div>

        {/* Statistiques de la session : en immersif, le panneau s’efface pendant
            la lecture et revient avec le chrome ou à la fin de la section. */}
        <div
          className={`synthesia-hud ${immersiveView && chromeIdle ? "is-quiet" : ""}`}
          role="status"
          aria-live="polite"
        >
          <div className="synthesia-hud-grid">
            <div>
              <span>Précision</span>
              <strong>{liveStats.correct + liveStats.errors > 0 ? `${liveStats.accuracy} %` : "—"}</strong>
            </div>
            <div>
              <span>Combo</span>
              <strong>{liveStats.combo}</strong>
            </div>
            <div className="synthesia-hud-best">
              <span>Meilleur combo</span>
              <strong>{liveStats.maxCombo}</strong>
            </div>
            <div>
              <span>Justes</span>
              <strong>{liveStats.correct}</strong>
            </div>
            <div>
              <span>Erreurs</span>
              <strong>{liveStats.errors}</strong>
            </div>
            <div>
              <span>Oubliées</span>
              <strong>{liveStats.misses}</strong>
            </div>
            <div>
              <span>Mesure</span>
              <strong>
                {currentMeasure}/{score.measureCount}
              </strong>
            </div>
          </div>
          <p className="synthesia-hud-state">
            {waiting ? (
              <>
                <Circle size={15} weight="fill" /> En attente{targetLabel ? ` de ${targetLabel}` : ""} — jouez la touche surlignée
              </>
            ) : playing ? (
              <>
                <Play size={15} weight="fill" /> {handLabel} · {waitMode ? "le temps s’arrête sur chaque note" : "suivez la ligne de frappe"}
              </>
            ) : demoOn ? (
              <>
                <SpeakerHigh size={15} /> Écoute de la section
              </>
            ) : (
              <>
                <Play size={15} /> Prêt : « Jouer » ou la barre d’espace lance la section
              </>
            )}
          </p>
        </div>
      </div>

      <div className="synthesia-scene" ref={sceneRef} style={{ "--hit-line": `${hitLinePercent.toFixed(2)}%` } as CSSProperties}>
        <FallingNotes
          notes={section.notes}
          bpm={score.bpm}
          tempoFactor={tempoFactor}
          currentTimeSec={time}
          hand={hand}
          naming={naming}
          colorByPitch={colorByPitch}
          showNoteNames={showNoteNames}
          activeMidis={activeMidis}
          pressedMidis={pressedMidis}
          onKeyPress={handleNoteOn}
          onKeyRelease={handleNoteOff}
          onHitLineChange={setHitLinePercent}
          heightPx={canvasHeightPx}
          zoomLevel={zoomLevel}
          beatsPerMeasure={beatsPerMeasureOf(score)}
          measureCount={score.measureCount}
          showMeasureLines={markers !== "off"}
          showBeatLines={markers === "all"}
          className="synthesia-canvas"
        />
        <div key={feedback.id} className={`synthesia-flash is-${feedback.kind}`} aria-hidden="true" />
        {feedback.id > 0 && (
          <span className={`synthesia-feedback is-${feedback.kind}`} aria-hidden="true">
            {feedback.kind === "wrong" || feedback.kind === "miss" ? (
              <WarningCircle size={16} weight="fill" />
            ) : (
              <CheckCircle size={16} weight="fill" />
            )}
            {feedback.label}
          </span>
        )}
        {sectionEmpty && (
          <p className="synthesia-scene-empty">
            Aucune note pour {hand === "both" ? "cette section" : hand === "right" ? "la main droite" : "la main gauche"} ici :
            changez de main, de mesures ou d’étape dans le parcours.
          </p>
        )}
      </div>

      {visibleSummary && (
        <section className="synthesia-results" aria-label="Résultats de la section">
          <header>
            <Trophy size={22} weight="fill" />
            <div>
              <strong>{visibleSummary.isBest ? "Section terminée · nouveau record" : "Section terminée"}</strong>
              <span>
                {visibleSummary.accuracy} % de précision · combo max {visibleSummary.maxCombo} · {visibleSummary.correct} note
                {visibleSummary.correct > 1 ? "s" : ""} juste{visibleSummary.correct > 1 ? "s" : ""} · {visibleSummary.errors} erreur
                {visibleSummary.errors > 1 ? "s" : ""} · {visibleSummary.misses} oubliée{visibleSummary.misses > 1 ? "s" : ""}
              </span>
            </div>
          </header>
          {visibleSummary.weakMeasures.length > 0 ? (
            <div className="synthesia-results-measures">
              <strong>Mesures à revoir</strong>
              <ul>
                {visibleSummary.weakMeasures.map((row) => (
                  <li key={row.measure}>
                    Mesure {row.measure} · {row.errors} erreur{row.errors > 1 ? "s" : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="synthesia-results-clean">
              Aucune erreur sur cette exécution : montez le tempo de 5 % ou passez à l’étape suivante.
            </p>
          )}
          <p className="synthesia-results-best">
            Record de l’étape : {visibleSummary.best} %{visibleSummary.best > 0 ? " (mémorisé sur cet appareil)" : ""}
          </p>
          <div className="synthesia-results-actions">
            <button className="synthesia-button" type="button" onClick={replaySection}>
              <ArrowCounterClockwise size={18} /> Rejouer la section
            </button>
            {onContinue && (
              <button className="synthesia-play" type="button" onClick={onContinue}>
                <Play size={18} weight="fill" /> Continuer
              </button>
            )}
          </div>
        </section>
      )}

      <div className="synthesia-devices">
        <button className="synthesia-button" type="button" onClick={connectMidi} disabled={midiState === "connecting"}>
          <PlugsConnected size={18} /> {midiState === "connected" ? "Reconnecter le clavier MIDI" : "Connecter un clavier MIDI"}
        </button>
        <p className={`synthesia-device-state is-${midiState}`}>
          {midiState === "idle" && !midiSupported && (
            <>
              <WarningCircle size={16} /> La saisie MIDI n’est pas disponible dans ce navigateur (Safari sur iPhone et iPad).
              Le clavier d’ordinateur et le clavier tactile de l’écran restent utilisables.
            </>
          )}
          {midiState === "idle" && midiSupported && "Branchez le piano, puis connectez-le : les notes jouées sont reconnues en direct."}
          {midiState === "connecting" && midiMessage}
          {midiState === "connected" && (
            <>
              <CheckCircle size={16} weight="fill" /> {midiMessage}
              {midiDevices.length > 0 ? ` (${midiDevices.length})` : ""}
            </>
          )}
          {midiState === "error" && (
            <>
              <WarningCircle size={16} weight="fill" /> {midiMessage}
            </>
          )}
        </p>
        <p className="synthesia-key-hint">
          <Keyboard size={18} /> Clavier d’ordinateur : rangées Z–M (grave) et Q–P (aigu), base {displayName(baseMidi, naming, true)} ·{" "}
          <ArrowLeft size={14} /> <ArrowRight size={14} /> changent d’octave (de −2 à +2) · Espace = lecture/pause · Maj+R =
          recommencer
        </p>
      </div>

      {playbackError && (
        <p className="inline-error synthesia-error" role="alert">
          {playbackError}
        </p>
      )}
    </section>
  );
}
