import { useRef, useState } from "react";
import { FilePdf, Link as LinkIcon, UploadSimple } from "@phosphor-icons/react";
import type { ScoreDocument } from "../types";
import { importScore } from "../music/importScore";
import { defaultMeasuresPerPage, findLinkedPdf, pdfLinkCandidates } from "../music/pdfSource";

interface SourcePdfPanelProps {
  score: ScoreDocument;
  allScores: ScoreDocument[];
  pdfPageCount: number;
  onShowPdf: () => void;
  onUpdateScore: (score: ScoreDocument) => Promise<void> | void;
  onAddScoreQuiet: (score: ScoreDocument) => Promise<void> | void;
}

/**
 * Association PDF original ↔ partition exploitable (v0.3, 100 % local).
 * Le lien est stocké dans IndexedDB via le ScoreDocument (champ pdfSource).
 */
export function SourcePdfPanel({ score, allScores, pdfPageCount, onShowPdf, onUpdateScore, onAddScoreQuiet }: SourcePdfPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedPdfId, setSelectedPdfId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const candidates = pdfLinkCandidates(allScores, score.id);
  const linkedPdf = findLinkedPdf(allScores, score);
  const linkMissing = Boolean(score.pdfSource && !linkedPdf);

  const linkTo = (pdfScoreId: string, pdfFileName: string) => {
    setError("");
    void onUpdateScore({
      ...score,
      pdfSource: { pdfScoreId, pdfFileName, linkedAt: new Date().toISOString() },
    });
  };

  const unlink = () => {
    setError("");
    const next = { ...score };
    delete next.pdfSource;
    void onUpdateScore(next);
  };

  const importAndLink = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const pdfScore = await importScore(file);
      if (pdfScore.sourceType !== "pdf" || !pdfScore.binaryData) {
        throw new Error("Choisissez un fichier PDF : seul le document original peut être lié ici.");
      }
      await onAddScoreQuiet(pdfScore);
      linkTo(pdfScore.id, pdfScore.sourceFileName || file.name);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible d’importer ce PDF.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const setMeasuresPerPage = (value: number | undefined) => {
    if (!score.pdfSource) return;
    void onUpdateScore({
      ...score,
      pdfSource: { ...score.pdfSource, measuresPerPage: value },
    });
  };

  return (
    <section className="source-pdf-panel" aria-label="PDF original associé">
      <div className="source-pdf-heading">
        <FilePdf size={20} />
        <div>
          <strong>PDF original</strong>
          <span>Le scan ou l’édition source, conservé sur cet appareil et affiché pendant la séance.</span>
        </div>
      </div>

      {linkedPdf && score.pdfSource && (
        <>
          <div className="source-pdf-linked">
            <div>
              <strong>{score.pdfSource.pdfFileName}</strong>
              <span>Lié le {new Date(score.pdfSource.linkedAt).toLocaleDateString("fr-FR")}</span>
            </div>
            <div className="source-pdf-actions">
              <button className="secondary-button" type="button" onClick={onShowPdf}>Voir le PDF</button>
              <button className="secondary-button danger-ghost" type="button" onClick={unlink}>Dissocier</button>
            </div>
          </div>
          <label className="source-pdf-calibration">
            <span>Mesures par page du PDF</span>
            <input
              type="number"
              min={1}
              max={64}
              placeholder={pdfPageCount > 0 ? String(defaultMeasuresPerPage(score.measureCount, pdfPageCount)) : "auto"}
              value={score.pdfSource.measuresPerPage ?? ""}
              onChange={(event) => {
                const value = Number(event.target.value);
                setMeasuresPerPage(Number.isFinite(value) && value > 0 ? Math.min(64, Math.floor(value)) : undefined);
              }}
              aria-label="Mesures par page du PDF, vide pour automatique"
            />
            <small>
              {pdfPageCount > 0
                ? `Auto : ${defaultMeasuresPerPage(score.measureCount, pdfPageCount)} mesures/page sur ${pdfPageCount} pages. Ajustez si le surlignage tombe à côté.`
                : "Laissez vide pour une répartition uniforme. Ajustez si le surlignage tombe à côté."}
            </small>
          </label>
        </>
      )}

      {linkMissing && score.pdfSource && (
        <div className="source-pdf-missing" role="alert">
          <strong>PDF source introuvable (« {score.pdfSource.pdfFileName} »).</strong>
          <span>Il a peut-être été supprimé de la bibliothèque. Importez-le à nouveau ou dissociez-le.</span>
          <div className="source-pdf-actions">
            <button className="secondary-button" type="button" onClick={() => fileRef.current?.click()} disabled={busy}>Importer à nouveau</button>
            <button className="secondary-button danger-ghost" type="button" onClick={unlink}>Dissocier</button>
          </div>
        </div>
      )}

      {!score.pdfSource && (
        <>
          <p className="source-pdf-hint">
            Associez le document d’origine pour le relire pendant la séance, mesure par mesure.
            {score.audiverisGenerated ? " Idéal après une conversion Audiveris : gardez le scan sous les yeux pour corriger." : ""}
          </p>
          <div className="source-pdf-actions">
            {candidates.length > 0 && (
              <>
                <select
                  value={selectedPdfId}
                  onChange={(event) => setSelectedPdfId(event.target.value)}
                  aria-label="Choisir un PDF de la bibliothèque"
                >
                  <option value="">Choisir dans la bibliothèque…</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.title}</option>
                  ))}
                </select>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!selectedPdfId}
                  onClick={() => {
                    const target = candidates.find((candidate) => candidate.id === selectedPdfId);
                    if (target) linkTo(target.id, target.sourceFileName || target.title);
                  }}
                >
                  <LinkIcon size={17} /> Lier
                </button>
              </>
            )}
            <button className="secondary-button" type="button" onClick={() => fileRef.current?.click()} disabled={busy}>
              <UploadSimple size={17} /> {busy ? "Import…" : "Importer un PDF"}
            </button>
          </div>
        </>
      )}

      <input
        ref={fileRef}
        className="visually-hidden"
        type="file"
        accept=".pdf,application/pdf"
        onChange={(event) => void importAndLink(event.target.files?.[0])}
      />

      {error && <p className="inline-error" role="alert">{error}</p>}
    </section>
  );
}
