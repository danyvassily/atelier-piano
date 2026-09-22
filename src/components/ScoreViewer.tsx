import { useEffect, useRef, useState } from "react";
import { FilePdf, WarningCircle } from "@phosphor-icons/react";
import type { NoteEvent, ScoreDocument } from "../types";

interface ScoreViewerProps {
  score: ScoreDocument;
  notes: NoteEvent[];
  activeIndex: number;
}

function MusicXmlScore({ xml }: { xml: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    container.replaceChildren();
    setError("");

    void import("opensheetmusicdisplay")
      .then(async ({ OpenSheetMusicDisplay }) => {
        if (cancelled) return;
        const osmd = new OpenSheetMusicDisplay(container, {
          autoResize: true,
          backend: "svg",
          drawingParameters: "compacttight",
          drawTitle: false,
        });
        await osmd.load(xml);
        if (!cancelled) await osmd.render();
      })
      .catch(() => setError("La notation complète ne peut pas être affichée, mais les notes restent disponibles pour le cours."));

    return () => {
      cancelled = true;
      container.replaceChildren();
    };
  }, [xml]);

  return (
    <div className="notation-wrap">
      {error && <p className="score-warning"><WarningCircle size={18} /> {error}</p>}
      <div ref={containerRef} className="osmd-container" aria-label="Partition musicale" />
    </div>
  );
}

function MidiRoll({ notes, activeIndex }: { notes: NoteEvent[]; activeIndex: number }) {
  const maxBeat = Math.max(1, ...notes.map((note) => note.onsetBeats + note.durationBeats));
  const minMidi = Math.min(...notes.map((note) => note.midi));
  const maxMidi = Math.max(...notes.map((note) => note.midi));
  const pitchSpan = Math.max(12, maxMidi - minMidi + 1);

  return (
    <div className="midi-roll" aria-label="Visualisation MIDI">
      <div className="midi-grid" />
      {notes.map((note, index) => (
        <span
          key={note.id}
          className={`midi-note ${index === activeIndex ? "is-active" : ""} ${note.hand === "left" ? "is-left" : ""}`}
          style={{
            left: `${(note.onsetBeats / maxBeat) * 100}%`,
            width: `${Math.max(0.65, (note.durationBeats / maxBeat) * 100)}%`,
            bottom: `${((note.midi - minMidi) / pitchSpan) * 84 + 8}%`,
          }}
          title={`${note.name}, mesure ${note.measure}`}
        />
      ))}
    </div>
  );
}

function PdfScore({ data }: { data: ArrayBuffer }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    container.replaceChildren();

    void Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ])
      .then(async ([pdfjs, worker]) => {
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) break;
          const page = await pdf.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1.45 });
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          if (!context) continue;
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.setAttribute("aria-label", `Page ${pageNumber} de la partition PDF`);
          container.appendChild(canvas);
          await page.render({ canvas, canvasContext: context, viewport }).promise;
        }
      })
      .catch(() => setError("Impossible d’afficher ce PDF dans le navigateur."));

    return () => {
      cancelled = true;
      container.replaceChildren();
    };
  }, [data]);

  return (
    <div className="pdf-wrap">
      {error && <p className="inline-error">{error}</p>}
      <div ref={containerRef} className="pdf-pages" />
    </div>
  );
}

export function ScoreViewer({ score, notes, activeIndex }: ScoreViewerProps) {
  if (score.sourceType === "musicxml" && score.rawText) return <MusicXmlScore xml={score.rawText} />;
  if (score.sourceType === "midi" || score.sourceType === "transcription") return <MidiRoll notes={notes} activeIndex={activeIndex} />;
  if (score.sourceType === "pdf" && score.binaryData) return <PdfScore data={score.binaryData} />;
  return (
    <div className="empty-score">
      <FilePdf size={32} />
      <p>Aucun aperçu disponible.</p>
    </div>
  );
}
