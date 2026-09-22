import { useEffect, useMemo, useRef, useState } from "react";
import { FilePdf, WarningCircle } from "@phosphor-icons/react";
import type { NoteEvent, NoteNaming, ScoreDocument } from "../types";
import { scoreToAbc } from "../music/abc";
import { midiToDisplayName } from "../music/notes";

interface ScoreViewerProps {
  score: ScoreDocument;
  notes: NoteEvent[];
  activeIndex: number;
  activeNoteIds?: string[];
  naming?: NoteNaming;
}

interface NoteGroup {
  key: string;
  notes: NoteEvent[];
}

function groupVisibleNotes(notes: NoteEvent[]): NoteGroup[] {
  const groups = new Map<string, NoteEvent[]>();
  notes.forEach((note) => {
    const key = note.onsetBeats.toFixed(3);
    const group = groups.get(key) || [];
    group.push(note);
    groups.set(key, group);
  });
  return [...groups.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([key, group]) => ({ key, notes: group.sort((a, b) => a.midi - b.midi) }));
}

function GuidedNotation({
  score,
  notes,
  activeIndex,
  activeNoteIds = [],
  naming = "french",
}: ScoreViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const groups = useMemo(() => groupVisibleNotes(notes), [notes]);
  const activeIds = useMemo(() => new Set(activeNoteIds), [activeNoteIds]);
  const foundGroupIndex = groups.findIndex((group) => group.notes.some((note) => activeIds.has(note.id)));
  const activeGroupIndex = foundGroupIndex >= 0 ? foundGroupIndex : Math.min(activeIndex, Math.max(0, groups.length - 1));
  const activeNote = groups[activeGroupIndex]?.notes[0] || notes[0];
  const firstMeasure = notes.length ? Math.min(...notes.map((note) => note.measure)) : 1;
  const lastMeasure = notes.length ? Math.max(...notes.map((note) => note.measure)) : score.measureCount;
  const currentMeasure = activeNote?.measure || firstMeasure;
  const measureStart = Math.max(firstMeasure, currentMeasure - 1);
  const measureEnd = Math.min(lastMeasure, measureStart + 3);
  const abc = useMemo(
    () => scoreToAbc({ ...score, notes }, { measureStart, measureEnd, activeNoteIds }),
    [activeNoteIds, measureEnd, measureStart, notes, score],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    container.replaceChildren();
    setError("");
    void import("abcjs")
      .then(({ default: ABCJS }) => {
        if (cancelled) return;
        ABCJS.renderAbc(container, abc, {
          responsive: "resize",
          staffwidth: 860,
          add_classes: true,
          paddingleft: 8,
          paddingright: 8,
          paddingtop: 0,
          paddingbottom: 2,
        });
      })
      .catch(() => setError("La portée n’a pas pu être affichée."));
    return () => {
      cancelled = true;
      container.replaceChildren();
    };
  }, [abc]);

  useEffect(() => {
    const active = stripRef.current?.querySelector<HTMLElement>(".note-flow-item.is-active");
    active?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeGroupIndex]);

  if (!notes.length) {
    return <div className="empty-score"><FilePdf size={32} /><p>Aucune note dans ce passage.</p></div>;
  }

  return (
    <div className="guided-notation">
      {error && <p className="score-warning"><WarningCircle size={18} /> {error}</p>}
      <div className="notation-window-label">Portée guidée · mesures {measureStart}–{measureEnd}</div>
      <div ref={containerRef} className="abc-practice-score" aria-label="Partition en notation musicale" />
      <div ref={stripRef} className="note-flow" aria-label="Défilement des noms de notes">
        {groups.map((group, index) => {
          const isActive = index === activeGroupIndex;
          return (
            <span key={group.key} className={`note-flow-item ${isActive ? "is-active" : ""}`} aria-current={isActive ? "true" : undefined}>
              <small>{group.notes[0].measure}</small>
              <strong>{group.notes.map((note) => midiToDisplayName(note.midi, naming)).join(" + ")}</strong>
            </span>
          );
        })}
      </div>
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

export function ScoreViewer(props: ScoreViewerProps) {
  if (props.score.sourceType === "pdf" && props.score.binaryData) return <PdfScore data={props.score.binaryData} />;
  if (props.score.sourceType === "musicxml" || props.score.sourceType === "midi" || props.score.sourceType === "transcription") {
    return <GuidedNotation {...props} />;
  }
  return <div className="empty-score"><FilePdf size={32} /><p>Aucun aperçu disponible.</p></div>;
}
