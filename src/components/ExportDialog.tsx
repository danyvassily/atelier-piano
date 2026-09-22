import { useEffect, useMemo, useRef, useState } from "react";
import { DownloadSimple, FileCode, FileText, MusicNotes, X } from "@phosphor-icons/react";
import type { ScoreDocument } from "../types";
import { scoreToAbc } from "../music/abc";
import { scoreToMidiBlob, scoreToMusicXml } from "../music/exportFormats";

interface ExportDialogProps {
  open: boolean;
  score: ScoreDocument;
  onClose: () => void;
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, "-").trim() || "partition";
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function ExportDialog({ open, score, onClose }: ExportDialogProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewError, setPreviewError] = useState("");
  const abc = useMemo(() => scoreToAbc(score), [score]);
  const baseName = safeFileName(score.title);

  useEffect(() => {
    if (!open || !previewRef.current) return;
    const container = previewRef.current;
    container.replaceChildren();
    setPreviewError("");
    void import("abcjs")
      .then(({ default: ABCJS }) => ABCJS.renderAbc(container, abc, { responsive: "resize", staffwidth: 720 }))
      .catch(() => setPreviewError("L’aperçu ABC n’a pas pu être affiché."));
    return () => container.replaceChildren();
  }, [abc, open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <button className="icon-button dialog-close" type="button" onClick={onClose} aria-label="Fermer"><X size={20} /></button>
        <div className="dialog-heading"><span className="dialog-icon"><DownloadSimple size={24} /></span><div><h2 id="export-title">Exporter la partition</h2><p>Les fichiers sont créés sur cet appareil.</p></div></div>
        <div className="export-actions">
          <button type="button" onClick={() => download(new Blob([scoreToMusicXml(score)], { type: "application/vnd.recordare.musicxml+xml" }), `${baseName}.musicxml`)}><MusicNotes size={22} /><span><strong>MusicXML</strong><small>Partition structurée</small></span></button>
          <button type="button" onClick={() => download(scoreToMidiBlob(score), `${baseName}.mid`)}><FileCode size={22} /><span><strong>MIDI</strong><small>Notes et rythme</small></span></button>
          <button type="button" onClick={() => download(new Blob([abc], { type: "text/vnd.abc;charset=utf-8" }), `${baseName}.abc`)}><FileText size={22} /><span><strong>ABC</strong><small>Notation texte A–G</small></span></button>
        </div>
        <div className="abc-preview-heading"><strong>Aperçu ABC</strong><span>Ce brouillon reste éditable.</span></div>
        {previewError && <p className="inline-error">{previewError}</p>}
        <div className="abc-preview" ref={previewRef} />
        <details className="abc-source"><summary>Afficher le texte ABC</summary><pre>{abc}</pre></details>
      </section>
    </div>
  );
}
