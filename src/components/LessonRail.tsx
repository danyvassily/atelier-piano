import { Check, Ear, Hand, PianoKeys } from "@phosphor-icons/react";
import type { LessonStage } from "../types";

interface LessonRailProps {
  stages: LessonStage[];
  currentId: string;
  completedIds: string[];
  onSelect: (stage: LessonStage) => void;
}

function StageIcon({ stage }: { stage: LessonStage }) {
  if (stage.kind === "listen") return <Ear size={19} />;
  if (stage.kind === "right" || stage.kind === "left") return <Hand size={19} />;
  return <PianoKeys size={19} />;
}

export function LessonRail({ stages, currentId, completedIds, onSelect }: LessonRailProps) {
  return (
    <nav className="lesson-rail" aria-label="Parcours du cours">
      <div className="lesson-rail-heading">
        <strong>Votre séance</strong>
        <span>{completedIds.length}/{stages.length}</span>
      </div>
      <div className="lesson-steps">
        {stages.map((stage) => {
          const completed = completedIds.includes(stage.id);
          return (
            <button
              type="button"
              key={stage.id}
              className={`${stage.id === currentId ? "is-current" : ""} ${completed ? "is-complete" : ""}`}
              onClick={() => onSelect(stage)}
              aria-current={stage.id === currentId ? "step" : undefined}
            >
              <span className="stage-symbol">{completed ? <Check size={17} weight="bold" /> : <StageIcon stage={stage} />}</span>
              <span>
                <strong>{stage.title}</strong>
                <small>{Math.round(stage.tempoFactor * 100)} % du tempo</small>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
