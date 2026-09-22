import { useRef, useState } from "react";
import { FileArrowUp, FilePdf, FilmSlate, MusicNotes, Waveform, X } from "@phosphor-icons/react";
import type { ScoreDocument } from "../types";
import { importScore, isTranscribableMedia } from "../music/importScore";

interface ImportDialogProps {
  open: boolean;
  pdfOptions: { id: string; title: string }[];
  onClose: () => void;
  onImported: (score: ScoreDocument) => Promise<void> | void;
}

const LINKABLE_EXTENSIONS = new Set(["xml", "musicxml", "mxl", "mid", "midi"]);

export function ImportDialog({ open, pdfOptions, onClose, onImported }: ImportDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [pendingScoreFile, setPendingScoreFile] = useState<File | null>(null);
  const [audiverisFlag, setAudiverisFlag] = useState(false);
  const [linkPdfId, setLinkPdfId] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [transcriptionBpm, setTranscriptionBpm] = useState(80);
  const [progress, setProgress] = useState(0);

  if (!open) return null;

  const resetAndClose = () => {
    setMediaFile(null);
    setPendingScoreFile(null);
    setAudiverisFlag(false);
    setLinkPdfId("");
    setRightsConfirmed(false);
    setProgress(0);
    setError("");
    onClose();
  };

  const processFile = async (file?: File) => {
    if (!file) return;
    if (isTranscribableMedia(file)) {
      setMediaFile(file);
      setRightsConfirmed(false);
      setProgress(0);
      setError("");
      return;
    }
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    // MusicXML/MIDI : options de liaison avant import (Audiveris + PDF source).
    if (LINKABLE_EXTENSIONS.has(extension)) {
      setPendingScoreFile(file);
      setAudiverisFlag(false);
      setLinkPdfId("");
      setError("");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const score = await importScore(file);
      await onImported(score);
      resetAndClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible d’importer ce fichier.");
    } finally {
      setBusy(false);
    }
  };

  const confirmPendingImport = async () => {
    if (!pendingScoreFile) return;
    setBusy(true);
    setError("");
    try {
      const score = await importScore(pendingScoreFile);
      if (audiverisFlag) score.audiverisGenerated = true;
      const pdfTarget = pdfOptions.find((option) => option.id === linkPdfId);
      if (pdfTarget) {
        score.pdfSource = {
          pdfScoreId: pdfTarget.id,
          pdfFileName: pdfTarget.title,
          linkedAt: new Date().toISOString(),
        };
      }
      await onImported(score);
      resetAndClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible d’importer ce fichier.");
    } finally {
      setBusy(false);
    }
  };

  const transcribeMedia = async () => {
    if (!mediaFile || !rightsConfirmed) return;
    setBusy(true);
    setError("");
    setProgress(0);
    try {
      const score = await importScore(mediaFile, { bpm: transcriptionBpm, onProgress: setProgress });
      await onImported(score);
      resetAndClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "La transcription a échoué.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <button className="icon-button dialog-close" type="button" onClick={resetAndClose} aria-label="Fermer">
          <X size={20} weight="bold" />
        </button>
        <div className="dialog-heading">
          <span className="dialog-icon"><MusicNotes size={24} weight="fill" /></span>
          <div>
            <h2 id="import-title">Ajouter une partition</h2>
            <p>Vos fichiers restent sur cet appareil.</p>
          </div>
        </div>

        {!mediaFile && !pendingScoreFile && <button
          type="button"
          className={`drop-zone ${dragging ? "is-dragging" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void processFile(event.dataTransfer.files[0]);
          }}
          disabled={busy}
        >
          <FileArrowUp size={32} weight="duotone" />
          <strong>{busy ? "Lecture du fichier…" : "Choisir ou déposer un fichier"}</strong>
          <span>MusicXML, MXL, MIDI, PDF, LilyPond ou média local</span>
        </button>}
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept=".xml,.musicxml,.mxl,.mid,.midi,.pdf,.ly,.wav,.mp3,.ogg,.flac,.m4a,.aac,.mp4,.mov,.webm,application/pdf,audio/*,video/*"
          onChange={(event) => void processFile(event.target.files?.[0])}
        />

        {pendingScoreFile && (
          <div className="transcription-setup">
            <div className="transcription-file"><MusicNotes size={22} /><span><strong>{pendingScoreFile.name}</strong><small>{(pendingScoreFile.size / 1024).toFixed(0)} Ko · reste sur cet appareil</small></span></div>
            <label className="rights-check">
              <input type="checkbox" checked={audiverisFlag} onChange={(event) => setAudiverisFlag(event.target.checked)} />
              <span>Ce fichier a été généré par Audiveris (affiche l’aide à la correction).</span>
            </label>
            {pdfOptions.length > 0 && (
              <label className="pdf-link-field">
                <span>PDF source à relier</span>
                <select value={linkPdfId} onChange={(event) => setLinkPdfId(event.target.value)} aria-label="PDF source à relier">
                  <option value="">Aucun pour l’instant</option>
                  {pdfOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.title}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="dialog-actions">
              <button className="secondary-button" type="button" disabled={busy} onClick={() => setPendingScoreFile(null)}>Choisir un autre fichier</button>
              <button className="primary-button" type="button" disabled={busy} onClick={() => void confirmPendingImport()}>{busy ? "Import…" : "Importer"}</button>
            </div>
          </div>
        )}

        {mediaFile && (
          <div className="transcription-setup">
            <div className="transcription-file"><Waveform size={22} /><span><strong>{mediaFile.name}</strong><small>{(mediaFile.size / 1024 / 1024).toFixed(1)} Mo · traitement local</small></span></div>
            <p>Basic Pitch va créer un brouillon de partition. Le meilleur résultat vient d’un piano seul, sans voix ni accompagnement.</p>
            <label className="bpm-field">
              <span>Tempo estimé</span>
              <input type="number" min="30" max="240" value={transcriptionBpm} onChange={(event) => setTranscriptionBpm(Math.min(240, Math.max(30, Number(event.target.value) || 80)))} />
              <span>BPM</span>
            </label>
            <label className="rights-check">
              <input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} />
              <span>Je possède ce fichier ou j’ai l’autorisation de le transcrire.</span>
            </label>
            {busy && <div className="transcription-progress" aria-live="polite"><span style={{ width: `${Math.max(3, progress * 100)}%` }} /><output>Analyse {Math.round(progress * 100)} %</output></div>}
            <div className="dialog-actions">
              <button className="secondary-button" type="button" disabled={busy} onClick={() => setMediaFile(null)}>Choisir un autre fichier</button>
              <button className="primary-button" type="button" disabled={busy || !rightsConfirmed} onClick={() => void transcribeMedia()}>{busy ? "Transcription…" : "Créer le brouillon"}</button>
            </div>
          </div>
        )}

        {error && <p className="inline-error" role="alert">{error}</p>}

        <div className="format-notes">
          <div>
            <MusicNotes size={20} />
            <p><strong>MusicXML et MIDI</strong><br />Cours généré immédiatement</p>
          </div>
          <div>
            <FilePdf size={20} />
            <p><strong>PDF</strong><br />Lecture ici, puis conversion MusicXML</p>
          </div>
          <div>
            <FilmSlate size={20} />
            <p><strong>Audio et vidéo locale</strong><br />Transcription IA à vérifier</p>
          </div>
        </div>
      </section>
    </div>
  );
}
