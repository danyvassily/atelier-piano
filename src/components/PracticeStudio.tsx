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
import { createLessonPlan, createStepByStepTargets, groupNotesForPractice, notesForStage } from "../music/lessons";
import { PianoPitchDetector } from "../audio/pitchDetector";
import { ScorePlayer } from "../audio/scorePlayer";
import { Metronome } from "../audio/metronome";
import { unlockAudio } from "../audio/audioContext";
import { scoreStorage } from "../data/storage";
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

type SessionMode = "idle" | "listening" | "requesting" | "calibrating" | "practicing" | "complete";
type NoteStatus = "idle" | "correct" | "wrong";

function freshStats(): PracticeStats {
  return { correct: 0, errors: 0, streak: 0, bestStreak: 0, completedNoteIds: [], errorsByMeasure: {} };
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
  const [microphoneError, setMicrophoneError] = useState("");
  const [playbackError, setPlaybackError] = useState("");
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [naming, setNaming] = useState<NoteNaming>(() => localStorage.getItem("atelier-note-naming") === "letters" ? "letters" : "french");

  const scorePlayer = useRef(new ScorePlayer());
  const pitchDetector = useRef(new PianoPitchDetector());
  const metronome = useRef(new Metronome());
  const activeIndexRef = useRef(0);
  const statsRef = useRef(stats);
  const modeRef = useRef<SessionMode>("idle");
  const loopRef = useRef(false);
  const sessionGenerationRef = useRef(0);

  const stageNotes = useMemo(() => (stage ? notesForStage(score, stage) : []), [score, stage]);
  const practiceGroups = useMemo(() => groupNotesForPractice(stageNotes), [stageNotes]);
  const practiceTargets = useMemo(() => createStepByStepTargets(stageNotes), [stageNotes]);
  const passageContainsChords = practiceGroups.some((group) => group.midis.length > 1);
  const effectiveBpm = Math.max(30, Math.round(score.bpm * tempoFactor));
  const expectedGroup = practiceTargets[activeIndex];
  const activeNote = mode === "listening"
    ? stageNotes[activeIndex]
    : stageNotes.find((note) => expectedGroup?.noteIds.includes(note.id));
  const activeNoteIds = mode === "listening"
    ? (stageNotes[activeIndex] ? [stageNotes[activeIndex].id] : [])
    : (expectedGroup?.noteIds || []);
  const accuracy = stats.correct + stats.errors > 0
    ? Math.round((stats.correct / (stats.correct + stats.errors)) * 100)
    : 0;
  const weakMeasure = Object.entries(stats.errorsByMeasure || {}).sort((a, b) => b[1] - a[1])[0]?.[0];

  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);

  useEffect(() => {
    localStorage.setItem("atelier-note-naming", naming);
  }, [naming]);

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
    pitchDetector.current.stop();
  }, [score.id, stage]);

  const handlePlayedNote = useCallback((midi: number) => {
    if (modeRef.current !== "practicing") return;
    const target = practiceTargets[activeIndexRef.current];
    if (!target) return;
    setDetectedMidi(midi);

    if (target.midis.includes(midi)) {
      setNoteStatus("correct");
      setStats((current) => ({
        ...current,
        correct: current.correct + 1,
        streak: current.streak + 1,
        bestStreak: Math.max(current.bestStreak, current.streak + 1),
        completedNoteIds: [...current.completedNoteIds, ...target.noteIds.filter((id) => !current.completedNoteIds.includes(id))],
      }));
      const nextIndex = activeIndexRef.current + 1;
      if (nextIndex >= practiceTargets.length) window.setTimeout(markStageComplete, 280);
      else {
        activeIndexRef.current = nextIndex;
        setActiveIndex(nextIndex);
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
  }, [markStageComplete, practiceTargets]);

  const stopSession = useCallback(() => {
    sessionGenerationRef.current += 1;
    scorePlayer.current.stop();
    pitchDetector.current.stop();
    metronome.current.stop();
    modeRef.current = "idle";
    setMode("idle");
    setDetectedMidi(undefined);
    setNoteStatus("idle");
    setCalibrationProgress(0);
    setMicrophoneLevel(0);
  }, []);

  const listen = useCallback(async () => {
    if (!stageNotes.length) return;
    setPlaybackError("");
    try {
      await unlockAudio();
      stopSession();
      setMode("listening");
      modeRef.current = "listening";
      async function playPass() {
        await scorePlayer.current.play(
          stageNotes,
          effectiveBpm,
          (index) => {
            activeIndexRef.current = index;
            setActiveIndex(index);
          },
          () => {
            if (loopRef.current && modeRef.current === "listening") void playPass();
            else setMode("idle");
          },
        );
      }
      await playPass();
    } catch (reason) {
      stopSession();
      setPlaybackError(reason instanceof Error ? reason.message : "Le son n’a pas pu démarrer.");
    }
  }, [effectiveBpm, stageNotes, stopSession]);

  const practice = async () => {
    if (!practiceTargets.length) return;
    stopSession();
    const sessionGeneration = ++sessionGenerationRef.current;
    setMicrophoneError("");
    const empty = freshStats();
    statsRef.current = empty;
    setStats(empty);
    setActiveIndex(0);
    activeIndexRef.current = 0;
    setMode("requesting");
    modeRef.current = "requesting";
    try {
      await unlockAudio();
      await pitchDetector.current.start(
        (pitch) => handlePlayedNote(pitch.midi),
        (progress) => {
          setMode("calibrating");
          modeRef.current = "calibrating";
          setCalibrationProgress(progress);
        },
        (level) => setMicrophoneLevel(level),
      );
      if (sessionGeneration !== sessionGenerationRef.current) return;
      setMode("practicing");
      modeRef.current = "practicing";
    } catch (reason) {
      if (sessionGeneration !== sessionGenerationRef.current) return;
      pitchDetector.current.stop();
      setMode("idle");
      modeRef.current = "idle";
      setMicrophoneError(reason instanceof Error ? reason.message : "Le microphone n’a pas pu être activé.");
    }
  };

  const selectStage = (nextStage: LessonStage) => {
    stopSession();
    setStage(nextStage);
    setTempoFactor(nextStage.tempoFactor);
    setActiveIndex(0);
    activeIndexRef.current = 0;
    const empty = freshStats();
    statsRef.current = empty;
    setStats(empty);
  };

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

          <div className="score-surface">
            <div className="score-toolbar">
              <div className="tempo-control"><Gauge size={19} /><label htmlFor="tempo">Tempo</label><input id="tempo" type="range" min="0.35" max="1.1" step="0.05" value={tempoFactor} onChange={(event) => setTempoFactor(Number(event.target.value))} /><output>{effectiveBpm} BPM</output></div>
              <div className="toolbar-toggles">
                <button type="button" className={naming === "letters" ? "is-on" : ""} onClick={() => setNaming((value) => value === "french" ? "letters" : "french")} aria-label="Changer le nom des notes"><Translate size={18} /> {naming === "french" ? "Do Ré Mi" : "C D E"}</button>
                <button type="button" className={metronomeOn ? "is-on" : ""} onClick={() => setMetronomeOn((value) => !value)} aria-pressed={metronomeOn}><MetronomeIcon size={18} /> Métronome</button>
                <button type="button" className={loopOn ? "is-on" : ""} onClick={() => setLoopOn((value) => !value)} aria-pressed={loopOn}><Repeat size={18} /> Boucle</button>
              </div>
            </div>
            <div className="score-viewport"><div className="measure-chip">Mesure {activeNote?.measure || stage.measureStart}</div><ScoreViewer score={score} notes={stageNotes} activeIndex={activeIndex} activeNoteIds={activeNoteIds} naming={naming} /></div>
          </div>

          <PianoKeyboard notes={stageNotes} expectedMidis={expectedGroup?.midis || []} detectedMidi={detectedMidi} status={noteStatus} onKey={handlePlayedNote} naming={naming} />
          {passageContainsChords && mode === "practicing" && <p className="chord-progress">Mode note après note : les accords sont décomposés du grave vers l’aigu pour que chaque note soit reconnue et validée.</p>}

          <YouTubeLesson key={stage.id} stage={stage} links={score.videoLessons || []} onChange={(videoLessons) => void onUpdateScore({ ...score, videoLessons })} />

          {microphoneError && <p className="inline-error microphone-error" role="alert">{microphoneError} Vérifiez l’autorisation dans Safari et utilisez une adresse HTTPS.</p>}
          {playbackError && <p className="inline-error microphone-error" role="alert">{playbackError} Touchez de nouveau « Écouter » pour autoriser le son sur l’iPad.</p>}

          <footer className="transport-bar">
            <button className="listen-button" type="button" onClick={() => mode === "listening" ? stopSession() : void listen()}>{mode === "listening" ? <Pause size={20} weight="fill" /> : <Ear size={20} />}{mode === "listening" ? "Pause" : "Écouter"}</button>
            <button className="practice-button" type="button" onClick={() => mode === "practicing" || mode === "calibrating" || mode === "requesting" ? stopSession() : void practice()}>{mode === "practicing" || mode === "calibrating" || mode === "requesting" ? <Stop size={20} weight="fill" /> : <Microphone size={20} weight="fill" />}{mode === "calibrating" || mode === "requesting" ? "Annuler" : mode === "practicing" ? "Arrêter" : "Jouer au piano"}</button>
            <span className={`session-state state-${mode}`}>
              {mode === "requesting" && <><Microphone size={16} /> Autorisez le microphone…</>}
              {mode === "calibrating" && <><Microphone size={16} /> Calibrage, restez silencieux… {Math.round(calibrationProgress * 100)} %</>}
              {mode === "practicing" && <><Microphone size={16} /> Le micro écoute <span className="microphone-level" aria-label={`Niveau du microphone ${Math.round(microphoneLevel * 100)} %`}><i style={{ width: `${Math.max(4, microphoneLevel * 100)}%` }} /></span></>}
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
