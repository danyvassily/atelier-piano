import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  CheckCircle,
  DownloadSimple,
  Ear,
  Gauge,
  Info,
  Metronome as MetronomeIcon,
  Microphone,
  Pause,
  Play,
  Repeat,
  Sparkle,
  Stop,
  Translate,
} from "@phosphor-icons/react";
import type { LessonStage, NoteNaming, PracticeStats, ScoreDocument } from "../types";
import { createLessonPlan, groupNotesForPractice, notesForStage } from "../music/lessons";
import { PITCH_RANGES, PianoPitchDetector, type CalibrationProfile, type MicLevel, type PitchRangeId } from "../audio/pitchDetector";
import { ScorePlayer } from "../audio/scorePlayer";
import { Metronome } from "../audio/metronome";
import { scoreStorage } from "../data/storage";
import { midiToDisplayName } from "../music/notes";
import { ExportDialog } from "./ExportDialog";
import { LessonRail } from "./LessonRail";
import { PianoKeyboard } from "./PianoKeyboard";
import { ScoreViewer } from "./ScoreViewer";
import { YouTubeLesson } from "./YouTubeLesson";

interface PracticeStudioProps {
  score: ScoreDocument;
  onImport: () => void;
  onUpdateScore: (score: ScoreDocument) => Promise<void> | void;
}

type SessionMode = "idle" | "listening" | "calibrating" | "practicing" | "paused" | "complete";
type NoteStatus = "idle" | "correct" | "wrong";

function freshStats(): PracticeStats {
  return { correct: 0, errors: 0, streak: 0, bestStreak: 0, completedNoteIds: [], errorsByMeasure: {} };
}

function loadSensitivity(): number {
  const raw = Number(localStorage.getItem("atelier-mic-sensitivity") || "1");
  return Number.isFinite(raw) ? Math.min(2.5, Math.max(0.4, raw)) : 1;
}

function loadPitchRange(): PitchRangeId {
  const raw = localStorage.getItem("atelier-pitch-range");
  return raw === "grave" || raw === "medium" || raw === "aigu" ? raw : "full";
}

function downloadText(text: string, fileName: string, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function PracticeStudio({ score, onImport, onUpdateScore }: PracticeStudioProps) {
  const stages = useMemo(() => createLessonPlan(score), [score]);
  const [stage, setStage] = useState<LessonStage | null>(stages[0] || null);
  const [completedStageIds, setCompletedStageIds] = useState<string[]>([]);
  const [mode, setMode] = useState<SessionMode>("idle");
  const [activeIndex, setActiveIndex] = useState(0);
  const [detectedMidi, setDetectedMidi] = useState<number>();
  const [noteStatus, setNoteStatus] = useState<NoteStatus>("idle");
  const [stats, setStats] = useState<PracticeStats>(() => freshStats());
  const [tempoFactor, setTempoFactor] = useState(stages[0]?.tempoFactor || 0.75);
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [loopOn, setLoopOn] = useState(false);
  const [loopStart, setLoopStart] = useState(stages[0]?.measureStart || 1);
  const [loopEnd, setLoopEnd] = useState(stages[0]?.measureEnd || 1);
  const [microphoneError, setMicrophoneError] = useState("");
  const [matchedMidis, setMatchedMidis] = useState<number[]>([]);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [calibrationProfile, setCalibrationProfile] = useState<CalibrationProfile>();
  const [micLevel, setMicLevel] = useState<MicLevel>({ rms: 0, threshold: 0.012 });
  const [sensitivity, setSensitivity] = useState(loadSensitivity);
  const [pitchRange, setPitchRange] = useState<PitchRangeId>(loadPitchRange);
  const [exportOpen, setExportOpen] = useState(false);
  const [pausedFrom, setPausedFrom] = useState<"listening" | "practicing" | null>(null);
  const [naming, setNaming] = useState<NoteNaming>(() => localStorage.getItem("atelier-note-naming") === "letters" ? "letters" : "french");

  const scorePlayer = useRef(new ScorePlayer());
  const pitchDetector = useRef(new PianoPitchDetector());
  const metronome = useRef(new Metronome());
  const activeIndexRef = useRef(0);
  const matchedMidisRef = useRef<number[]>([]);
  const statsRef = useRef(stats);
  const modeRef = useRef<SessionMode>("idle");
  const loopRef = useRef(false);
  const pausedFromRef = useRef<"listening" | "practicing" | null>(null);
  const pausedGroupsRef = useRef(0);
  const sessionGenerationRef = useRef(0);

  const stageNotes = useMemo(() => (stage ? notesForStage(score, stage) : []), [score, stage]);
  // Boucle éditable : quand elle est active, le cours ne porte que sur
  // l'intervalle [loopStart, loopEnd] au lieu du découpage automatique.
  const loopedNotes = useMemo(() => {
    if (!loopOn || !stage) return stageNotes;
    const start = Math.min(loopStart, loopEnd);
    const end = Math.max(loopStart, loopEnd);
    return stageNotes.filter((note) => note.measure >= start && note.measure <= end);
  }, [loopOn, loopStart, loopEnd, stage, stageNotes]);
  const practiceGroups = useMemo(() => groupNotesForPractice(loopedNotes), [loopedNotes]);
  const practiceGroupsRef = useRef(practiceGroups);
  useEffect(() => {
    practiceGroupsRef.current = practiceGroups;
  }, [practiceGroups]);
  const effectiveBpm = Math.max(30, Math.round(score.bpm * tempoFactor));
  const expectedGroup = practiceGroups[Math.min(activeIndex, Math.max(0, practiceGroups.length - 1))];
  const activeNote = mode === "listening" || mode === "paused" && pausedFrom === "listening"
    ? loopedNotes[activeIndex]
    : loopedNotes.find((note) => expectedGroup?.noteIds.includes(note.id));
  const accuracy = stats.correct + stats.errors > 0
    ? Math.round((stats.correct / (stats.correct + stats.errors)) * 100)
    : 0;
  const weakMeasure = Object.entries(stats.errorsByMeasure || {}).sort((a, b) => b[1] - a[1])[0]?.[0];

  // Bilan par mesure : erreurs + notes réussies pour chaque mesure du passage.
  const measureReport = useMemo(() => {
    const measures = [...new Set(loopedNotes.map((note) => note.measure))].sort((a, b) => a - b);
    return measures.map((measure) => {
      const ids = loopedNotes.filter((note) => note.measure === measure).map((note) => note.id);
      const done = ids.filter((id) => stats.completedNoteIds.includes(id)).length;
      return { measure, total: ids.length, done, errors: stats.errorsByMeasure?.[measure] || 0 };
    });
  }, [loopedNotes, stats]);

  const micMeter = Math.min(1, micLevel.rms / Math.max(0.001, micLevel.threshold * 3));
  const micHeardSomething = micLevel.rms >= micLevel.threshold;

  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);

  useEffect(() => {
    localStorage.setItem("atelier-note-naming", naming);
  }, [naming]);

  useEffect(() => {
    localStorage.setItem("atelier-mic-sensitivity", String(sensitivity));
    pitchDetector.current.setSensitivity(sensitivity);
  }, [sensitivity]);

  useEffect(() => {
    localStorage.setItem("atelier-pitch-range", pitchRange);
    const range = PITCH_RANGES[pitchRange];
    pitchDetector.current.setFrequencyRange(range.minFreq, range.maxFreq);
  }, [pitchRange]);

  useEffect(() => {
    pitchDetector.current.setSensitivity(sensitivity);
    const range = PITCH_RANGES[pitchRange];
    pitchDetector.current.setFrequencyRange(range.minFreq, range.maxFreq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void scoreStorage.getProgress(score.id).then((progress) => {
      setCompletedStageIds(progress?.completedStageIds || []);
      if (progress?.stageId) {
        const restored = stages.find((item) => item.id === progress.stageId);
        if (restored) {
          setStage(restored);
          setTempoFactor(restored.tempoFactor);
        }
      }
    });
  }, [score.id, stages]);

  useEffect(() => {
    loopRef.current = loopOn;
  }, [loopOn]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const instance = metronome.current;
    if (metronomeOn && (mode === "listening" || mode === "practicing")) void instance.start(effectiveBpm, score.timeSignature[0]);
    else instance.stop();
    return () => instance.stop();
  }, [effectiveBpm, metronomeOn, mode, score.timeSignature]);

  useEffect(() => () => {
    scorePlayer.current.stop();
    pitchDetector.current.stop();
    pitchDetector.current.onLevel(null);
    metronome.current.stop();
  }, []);

  const markStageComplete = useCallback(() => {
    if (!stage) return;
    const result = statsRef.current;
    const finalAccuracy = result.correct + result.errors
      ? Math.round(result.correct / (result.correct + result.errors) * 100)
      : 0;
    setCompletedStageIds((current) => {
      const next = current.includes(stage.id) ? current : [...current, stage.id];
      void scoreStorage.putProgress({
        scoreId: score.id,
        stageId: stage.id,
        completedStageIds: next,
        bestAccuracy: finalAccuracy,
        errorsByMeasure: result.errorsByMeasure,
      });
      return next;
    });
    setMode("complete");
    modeRef.current = "complete";
    pausedFromRef.current = null;
    pitchDetector.current.stop();
    pitchDetector.current.onLevel(null);
  }, [score.id, stage]);

  const handlePlayedNote = useCallback((midi: number) => {
    if (modeRef.current !== "practicing") return;
    const target = practiceGroupsRef.current[activeIndexRef.current];
    if (!target) return;
    setDetectedMidi(midi);

    if (target.midis.includes(midi)) {
      if (matchedMidisRef.current.includes(midi)) return;
      const matched = [...matchedMidisRef.current, midi];
      matchedMidisRef.current = matched;
      setMatchedMidis(matched);
      setNoteStatus("correct");
      setStats((current) => ({
        ...current,
        correct: current.correct + 1,
        streak: current.streak + 1,
        bestStreak: Math.max(current.bestStreak, current.streak + 1),
        completedNoteIds: [...current.completedNoteIds, ...target.noteIds.filter((id) => !current.completedNoteIds.includes(id))],
      }));
      if (matched.length >= target.midis.length) {
        matchedMidisRef.current = [];
        setMatchedMidis([]);
        const nextIndex = activeIndexRef.current + 1;
        if (nextIndex >= practiceGroupsRef.current.length) window.setTimeout(markStageComplete, 280);
        else {
          activeIndexRef.current = nextIndex;
          setActiveIndex(nextIndex);
        }
      }
    } else {
      setNoteStatus("wrong");
      setStats((current) => ({
        ...current,
        errors: current.errors + 1,
        streak: 0,
        errorsByMeasure: {
          ...current.errorsByMeasure,
          [target.measure]: (current.errorsByMeasure?.[target.measure] || 0) + 1,
        },
      }));
    }
    window.setTimeout(() => setNoteStatus("idle"), 360);
  }, [markStageComplete]);

  const stopSession = useCallback(() => {
    sessionGenerationRef.current += 1;
    pausedFromRef.current = null;
    setPausedFrom(null);
    scorePlayer.current.stop();
    pitchDetector.current.stop();
    pitchDetector.current.onLevel(null);
    metronome.current.stop();
    modeRef.current = "idle";
    setMode("idle");
    setDetectedMidi(undefined);
    setNoteStatus("idle");
    setCalibrationProgress(0);
  }, []);

  const playFromIndex = useCallback(async (notes: typeof loopedNotes, fromIndex: number) => {
    const slice = notes.slice(fromIndex);
    if (!slice.length) return;
    async function playPass() {
      await scorePlayer.current.play(
        slice,
        effectiveBpm,
        (index) => {
          const absolute = fromIndex + index;
          activeIndexRef.current = absolute;
          setActiveIndex(absolute);
        },
        () => {
          if (loopRef.current && modeRef.current === "listening") void playPass();
          else if (modeRef.current === "listening") {
            modeRef.current = "idle";
            setMode("idle");
          }
        },
      );
    }
    await playPass();
  }, [effectiveBpm]);

  const listen = useCallback(async (fromIndex = 0) => {
    if (!loopedNotes.length) return;
    stopSession();
    setActiveIndex(fromIndex);
    activeIndexRef.current = fromIndex;
    setMode("listening");
    modeRef.current = "listening";
    await playFromIndex(loopedNotes, fromIndex);
  }, [loopedNotes, playFromIndex, stopSession]);

  const startMicSession = useCallback(async (sessionGeneration: number) => {
    const profile = await pitchDetector.current.start(
      (pitch) => handlePlayedNote(pitch.midi),
      (progress, calibrated) => {
        setCalibrationProgress(progress);
        if (calibrated) setCalibrationProfile(calibrated);
      },
    );
    if (sessionGeneration !== sessionGenerationRef.current) return null;
    setCalibrationProfile(profile);
    setMode("practicing");
    modeRef.current = "practicing";
    return profile;
  }, [handlePlayedNote]);

  const practice = useCallback(async (fromIndex = 0, keepStats = false) => {
    if (!practiceGroupsRef.current.length) return;
    stopSession();
    const sessionGeneration = ++sessionGenerationRef.current;
    setMicrophoneError("");
    if (!keepStats) {
      const empty = freshStats();
      statsRef.current = empty;
      setStats(empty);
    }
    setActiveIndex(fromIndex);
    activeIndexRef.current = fromIndex;
    matchedMidisRef.current = [];
    setMatchedMidis([]);
    setMode("calibrating");
    modeRef.current = "calibrating";
    pitchDetector.current.onLevel((level) => setMicLevel(level));
    try {
      await startMicSession(sessionGeneration);
    } catch (reason) {
      if (sessionGeneration !== sessionGenerationRef.current) return;
      pitchDetector.current.onLevel(null);
      setMode("idle");
      modeRef.current = "idle";
      setMicrophoneError(reason instanceof Error ? reason.message : "Le microphone n’a pas pu être activé.");
    }
  }, [startMicSession, stopSession]);

  // Reprise exacte après une pause : on repart du même index, avec les mêmes
  // stats et les notes d'accord déjà validées conservées.
  const pauseSession = useCallback(() => {
    if (modeRef.current !== "listening" && modeRef.current !== "practicing") return;
    pausedFromRef.current = modeRef.current;
    setPausedFrom(modeRef.current);
    pausedGroupsRef.current = activeIndexRef.current;
    sessionGenerationRef.current += 1;
    scorePlayer.current.stop();
    pitchDetector.current.stop();
    pitchDetector.current.onLevel(null);
    metronome.current.stop();
    modeRef.current = "paused";
    setMode("paused");
  }, []);

  const resumeSession = useCallback(() => {
    const from = pausedFromRef.current;
    const index = pausedGroupsRef.current;
    if (!from) return;
    pausedFromRef.current = null;
    setPausedFrom(null);
    if (from === "listening") {
      void listen(index);
    } else {
      void practice(index, true);
    }
  }, [listen, practice]);

  const toggleLoop = useCallback(() => {
    setLoopOn((value) => {
      if (!value && stage) {
        setLoopStart(stage.measureStart);
        setLoopEnd(stage.measureEnd);
      }
      return !value;
    });
  }, [stage]);

  const selectStage = (nextStage: LessonStage) => {
    stopSession();
    setStage(nextStage);
    setTempoFactor(nextStage.tempoFactor);
    setLoopStart(nextStage.measureStart);
    setLoopEnd(nextStage.measureEnd);
    setActiveIndex(0);
    activeIndexRef.current = 0;
    matchedMidisRef.current = [];
    setMatchedMidis([]);
    const empty = freshStats();
    statsRef.current = empty;
    setStats(empty);
  };

  // Les bornes de boucle sont initialisées et réinitialisées dans selectStage.

  if (score.sourceType === "pdf") {
    return (
      <main className="pdf-workspace">
        <header className="studio-header"><div><p>Partition PDF</p><h1>{score.title}</h1></div><button className="primary-button" type="button" onClick={onImport}>Importer le MusicXML</button></header>
        <div className="pdf-guidance"><Info size={22} weight="fill" /><div><strong>Le PDF est prêt à être consulté.</strong><p>Pour créer les exercices et reconnaître les notes, utilisez de préférence la source MusicXML ou LilyPond. Sinon, convertissez le PDF avec Audiveris puis corrigez le résultat.</p></div></div>
        <ScoreViewer score={score} notes={[]} activeIndex={0} />
      </main>
    );
  }

  if (score.sourceType === "lilypond") {
    return (
      <main className="pdf-workspace">
        <header className="studio-header"><div><p>Source LilyPond</p><h1>{score.title}</h1></div><div className="header-actions"><button className="secondary-button" type="button" onClick={() => downloadText(score.rawText || "", score.sourceFileName || `${score.title}.ly`)}>Télécharger .ly</button><button className="primary-button" type="button" onClick={onImport}>Importer le MIDI ou MusicXML</button></div></header>
        <div className="pdf-guidance"><Info size={22} weight="fill" /><div><strong>La source structurée est conservée.</strong><p>Compilez-la avec LilyPond en MIDI, ou exportez son MusicXML depuis votre éditeur, puis importez ce résultat pour générer le cours.</p></div></div>
        <pre className="lilypond-source">{score.rawText}</pre>
      </main>
    );
  }

  if (!stage) return null;
  const micActive = mode === "practicing" || mode === "calibrating" || mode === "paused" && pausedFrom === "practicing";
  const canPause = mode === "listening" || mode === "practicing";

  return (
    <>
      <main className="studio-layout">
        <LessonRail stages={stages} currentId={stage.id} completedIds={completedStageIds} onSelect={selectStage} />

        <section className="practice-stage">
          <header className="studio-header">
            <div><p>{score.composer}</p><h1>{score.title}</h1></div>
            <div className="header-actions">
              <div className="score-metadata"><span>{score.timeSignature[0]}/{score.timeSignature[1]}</span><span>{score.bpm} BPM</span><span>{score.measureCount} mesures</span></div>
              <button className="secondary-button compact-action" type="button" onClick={() => setExportOpen(true)}><DownloadSimple size={18} /> Exporter</button>
            </div>
          </header>

          {score.transcription && (
            <div className="transcription-banner"><Sparkle size={21} weight="fill" /><div><strong>Brouillon transcrit localement</strong><span>{score.notes.length} notes · confiance moyenne {Math.round(score.transcription.averageConfidence * 100)} %. Vérifiez tempo, rythme et mains avant de l’utiliser comme partition définitive.</span></div></div>
          )}

          <div className="stage-intro">
            <div><span className="stage-kind"><Sparkle size={16} weight="fill" /> Mini-cours généré</span><h2>{stage.title}</h2><p>{stage.instruction}</p></div>
            <div className="session-stats" aria-label="Résultats de la session"><div><span>Justesse</span><strong>{accuracy || "-"}{accuracy ? " %" : ""}</strong></div><div><span>Série</span><strong>{stats.bestStreak || "-"}</strong></div><div><span>Erreurs</span><strong>{stats.errors}</strong></div></div>
          </div>

          {mode === "complete" && (
            <div className="success-banner" role="status"><CheckCircle size={24} weight="fill" /><div><strong>Passage terminé</strong><span>{accuracy}% de justesse, meilleure série de {stats.bestStreak} notes.{weakMeasure ? ` Mesure ${weakMeasure} à revoir.` : ""}</span></div><button type="button" onClick={() => void practice()}><ArrowCounterClockwise size={18} /> Rejouer</button></div>
          )}

          {(stats.correct > 0 || stats.errors > 0) && mode !== "complete" && (
            <details className="measure-report" open={mode === "paused"}>
              <summary>Bilan par mesure · {measureReport.filter((row) => row.done >= row.total).length}/{measureReport.length} mesures propres</summary>
              <div className="measure-report-grid" role="table" aria-label="Bilan par mesure">
                {measureReport.map((row) => (
                  <div key={row.measure} role="row" className={`measure-row ${row.errors > 0 ? "has-errors" : row.done >= row.total ? "is-clean" : ""}`}>
                    <span role="cell">Mes. {row.measure}</span>
                    <span role="cell">{row.done}/{row.total} notes</span>
                    <span role="cell">{row.errors ? `${row.errors} err.` : "—"}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          <div className="score-surface">
            <div className="score-toolbar">
              <div className="tempo-control"><Gauge size={19} /><label htmlFor="tempo">Tempo</label><input id="tempo" type="range" min="0.35" max="1.1" step="0.05" value={tempoFactor} onChange={(event) => setTempoFactor(Number(event.target.value))} /><output>{effectiveBpm} BPM</output></div>
              <div className="toolbar-toggles">
                <button type="button" className={naming === "letters" ? "is-on" : ""} onClick={() => setNaming((value) => value === "french" ? "letters" : "french")} aria-label="Changer le nom des notes"><Translate size={18} /> {naming === "french" ? "Do Ré Mi" : "C D E"}</button>
                <button type="button" className={metronomeOn ? "is-on" : ""} onClick={() => setMetronomeOn((value) => !value)} aria-pressed={metronomeOn}><MetronomeIcon size={18} /> Métronome</button>
                <button type="button" className={loopOn ? "is-on" : ""} onClick={toggleLoop} aria-pressed={loopOn}><Repeat size={18} /> Boucle</button>
              </div>
            </div>
            {loopOn && stage && (
              <div className="loop-editor" aria-label="Limites de la boucle">
                <Repeat size={17} />
                <label>Boucle de la mesure <input type="number" min={stage.measureStart} max={stage.measureEnd} value={loopStart} onChange={(event) => setLoopStart(Math.min(stage.measureEnd, Math.max(stage.measureStart, Number(event.target.value) || stage.measureStart)))} aria-label="Première mesure de la boucle" /></label>
                <label>à <input type="number" min={stage.measureStart} max={stage.measureEnd} value={loopEnd} onChange={(event) => setLoopEnd(Math.min(stage.measureEnd, Math.max(stage.measureStart, Number(event.target.value) || stage.measureEnd)))} aria-label="Dernière mesure de la boucle" /></label>
                <span className="loop-hint">{loopedNotes.length} notes dans la boucle</span>
              </div>
            )}
            <div className="score-viewport"><div className="measure-chip">Mesure {activeNote?.measure || stage.measureStart}</div><ScoreViewer score={score} notes={loopedNotes} activeIndex={activeIndex} /></div>
          </div>

          {micActive && (
            <section className="mic-panel" aria-live="polite" aria-label="État du microphone">
              <div className="mic-meter-row">
                <Microphone size={19} weight="fill" />
                <div className="mic-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(micMeter * 100)} aria-label="Niveau du microphone">
                  <span className="mic-meter-fill" style={{ width: `${Math.round(micMeter * 100)}%` }} />
                  <span className={`mic-meter-state ${micHeardSomething ? "hears" : ""}`} />
                </div>
                <output>{detectedMidi === undefined ? "En attente" : midiToDisplayName(detectedMidi, naming)}</output>
              </div>
              <div className="mic-controls">
                <label>Sensibilité <input type="range" min={0.4} max={2.5} step={0.1} value={sensitivity} onChange={(event) => setSensitivity(Number(event.target.value))} aria-label="Sensibilité du microphone" /><output>{sensitivity.toFixed(1)}× · seuil {micLevel.threshold.toFixed(3)}</output></label>
                <label>Tessiture <select value={pitchRange} onChange={(event) => setPitchRange(event.target.value as PitchRangeId)} aria-label="Tessiture écoutée">{(Object.keys(PITCH_RANGES) as PitchRangeId[]).map((id) => <option key={id} value={id}>{PITCH_RANGES[id].label}</option>)}</select></label>
              </div>
              <p className="mic-hint">Si rien ne bouge quand vous jouez : montez la sensibilité, rapprochez l’iPhone/iPad du piano, jouez une seule note franche, puis vérifiez que la barre verte bouge et que la note entendue s’affiche.</p>
            </section>
          )}

          <PianoKeyboard notes={loopedNotes} expectedMidis={expectedGroup?.midis || []} detectedMidi={detectedMidi} status={noteStatus} onKey={handlePlayedNote} naming={naming} />
          {expectedGroup && expectedGroup.midis.length > 1 && mode === "practicing" && <p className="chord-progress">Accord : {matchedMidis.length}/{expectedGroup.midis.length} notes reconnues. Jouez-les ensemble ou rapidement l’une après l’autre.</p>}

          <YouTubeLesson key={stage.id} stage={stage} links={score.videoLessons || []} onChange={(videoLessons) => void onUpdateScore({ ...score, videoLessons })} />

          {microphoneError && <p className="inline-error microphone-error" role="alert">{microphoneError} Vérifiez l’autorisation dans Safari et utilisez une adresse HTTPS.</p>}

          <footer className="transport-bar">
            <button className="listen-button" type="button" onClick={() => mode === "listening" ? pauseSession() : mode === "paused" && pausedFrom === "listening" ? resumeSession() : void listen()}>{mode === "listening" ? <Pause size={20} weight="fill" /> : mode === "paused" && pausedFrom === "listening" ? <Play size={20} weight="fill" /> : <Ear size={20} />}{mode === "listening" ? "Pause" : mode === "paused" && pausedFrom === "listening" ? "Reprendre" : "Écouter"}</button>
            {canPause
              ? <button className="practice-button is-pause" type="button" onClick={pauseSession}><Pause size={20} weight="fill" /> Pause</button>
              : mode === "paused"
                ? <button className="practice-button" type="button" onClick={resumeSession}><Play size={20} weight="fill" /> Reprendre</button>
                : <button className="practice-button" type="button" onClick={() => mode === "calibrating" ? stopSession() : void practice()}>{mode === "calibrating" ? <Stop size={20} weight="fill" /> : <Microphone size={20} weight="fill" />}{mode === "calibrating" ? "Annuler" : "Jouer au piano"}</button>}
            {mode === "practicing" || mode === "calibrating" || mode === "paused" ? <button className="listen-button" type="button" onClick={stopSession} aria-label="Arrêter la session"><Stop size={18} weight="fill" /></button> : null}
            <span className={`session-state state-${mode}`}>
              {mode === "calibrating" && <><Microphone size={16} /> Calibrage, restez silencieux… {Math.round(calibrationProgress * 100)} %</>}
              {mode === "practicing" && <><Microphone size={16} /> Le micro écoute{calibrationProfile ? ` · seuil ${calibrationProfile.inputThreshold.toFixed(3)}` : ""}</>}
              {mode === "paused" && <><Pause size={16} /> En pause · mesure {activeNote?.measure || "—"}</>}
              {mode === "listening" && <><Play size={16} weight="fill" /> Lecture en cours</>}
              {mode === "idle" && "Prêt"}
              {mode === "complete" && "Exercice terminé"}
            </span>
          </footer>
        </section>
      </main>
      <ExportDialog open={exportOpen} score={score} onClose={() => setExportOpen(false)} />
    </>
  );
}
