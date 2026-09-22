import { Code, FilePdf, MusicNote, Plus, Trash, Waveform } from "@phosphor-icons/react";
import type { ScoreDocument } from "../types";

interface LibraryProps {
  scores: ScoreDocument[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onImport: () => void;
  onDelete: (id: string) => void;
}

export function Library({ scores, selectedId, onSelect, onImport, onDelete }: LibraryProps) {
  const iconFor = (score: ScoreDocument) => {
    if (score.sourceType === "pdf") return <FilePdf size={18} />;
    if (score.sourceType === "lilypond") return <Code size={18} />;
    if (score.sourceType === "transcription") return <Waveform size={18} />;
    return <MusicNote size={18} weight="fill" />;
  };
  const detailFor = (score: ScoreDocument) => {
    if (score.sourceType === "pdf") return "PDF à convertir";
    if (score.sourceType === "lilypond") return "Source LilyPond";
    if (score.sourceType === "transcription") return `${score.measureCount} mesures · brouillon IA`;
    return `${score.measureCount} mesures`;
  };
  return (
    <aside className="library-panel" aria-label="Bibliothèque de partitions">
      <div className="library-heading">
        <div>
          <span>Ma bibliothèque</span>
          <strong>{scores.length} {scores.length > 1 ? "partitions" : "partition"}</strong>
        </div>
        <button className="icon-button" type="button" onClick={onImport} aria-label="Ajouter une partition">
          <Plus size={20} weight="bold" />
        </button>
      </div>

      <div className="score-list">
        {scores.map((score) => (
          <div className={`score-list-item ${score.id === selectedId ? "is-selected" : ""}`} key={score.id}>
            <button type="button" onClick={() => onSelect(score.id)}>
              <span className="file-kind">
                {iconFor(score)}
              </span>
              <span>
                <strong>{score.title}</strong>
                <small>{detailFor(score)}</small>
              </span>
            </button>
            <button className="delete-score" type="button" onClick={() => onDelete(score.id)} aria-label={`Supprimer ${score.title}`}>
              <Trash size={16} />
            </button>
          </div>
        ))}
      </div>

      <button className="secondary-button library-add" type="button" onClick={onImport}>
        <Plus size={18} weight="bold" /> Ajouter
      </button>
    </aside>
  );
}
