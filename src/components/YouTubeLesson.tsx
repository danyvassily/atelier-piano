import { useState } from "react";
import { FloppyDisk, LinkSimple, Trash, YoutubeLogo } from "@phosphor-icons/react";
import type { LessonStage, VideoLessonLink } from "../types";
import { parseYouTubeUrl } from "../media/youtube";

interface YouTubeLessonProps {
  stage: LessonStage;
  links: VideoLessonLink[];
  onChange: (links: VideoLessonLink[]) => void;
}

export function YouTubeLesson({ stage, links, onChange }: YouTubeLessonProps) {
  const current = links.find((link) => link.stageId === stage.id);
  const [url, setUrl] = useState(current ? `https://youtu.be/${current.videoId}` : "");
  const [start, setStart] = useState(current?.startSeconds || 0);
  const [end, setEnd] = useState<number | "">(current?.endSeconds || "");
  const [error, setError] = useState("");

  const save = () => {
    const parsed = parseYouTubeUrl(url);
    if (!parsed) {
      setError("Collez une URL YouTube valide.");
      return;
    }
    const next: VideoLessonLink = {
      id: current?.id || crypto.randomUUID(),
      stageId: stage.id,
      videoId: parsed.videoId,
      startSeconds: start || parsed.startSeconds,
      endSeconds: end === "" ? undefined : end,
      measureStart: stage.measureStart,
      measureEnd: stage.measureEnd,
    };
    onChange([...links.filter((link) => link.stageId !== stage.id), next]);
    setError("");
  };

  const embedUrl = current
    ? `https://www.youtube-nocookie.com/embed/${current.videoId}?playsinline=1&rel=0&start=${Math.max(0, Math.round(current.startSeconds))}${current.endSeconds ? `&end=${Math.round(current.endSeconds)}` : ""}`
    : "";

  return (
    <details className="video-lesson">
      <summary><YoutubeLogo size={21} weight="fill" /><span><strong>Tutoriel vidéo</strong><small>{current ? `lié aux mesures ${stage.measureStart}–${stage.measureEnd}` : "ajouter un passage YouTube"}</small></span></summary>
      <div className="video-lesson-content">
        {current && <div className="youtube-frame"><iframe src={embedUrl} title={`Tutoriel pour ${stage.title}`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen /></div>}
        <div className="video-link-form">
          <label><span>URL YouTube</span><div><LinkSimple size={18} /><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://youtu.be/…" /></div></label>
          <label><span>Début (secondes)</span><input type="number" min="0" value={start} onChange={(event) => setStart(Math.max(0, Number(event.target.value)))} /></label>
          <label><span>Fin facultative</span><input type="number" min="0" value={end} onChange={(event) => setEnd(event.target.value === "" ? "" : Math.max(0, Number(event.target.value)))} /></label>
          <button className="primary-button compact" type="button" onClick={save}><FloppyDisk size={17} /> Enregistrer</button>
          {current && <button className="icon-button" type="button" aria-label="Supprimer le lien vidéo" onClick={() => { onChange(links.filter((link) => link.stageId !== stage.id)); setUrl(""); setStart(0); setEnd(""); }}><Trash size={17} /></button>}
        </div>
        {error && <p className="inline-error">{error}</p>}
        <p className="video-policy">La vidéo reste dans le lecteur officiel. Pour créer une partition, importez votre fichier audio ou vidéo original autorisé.</p>
      </div>
    </details>
  );
}
