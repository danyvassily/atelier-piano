import { useEffect, useMemo, useRef, useState } from "react";
import { DownloadSimple, Moon, Plus, Sun, UploadSimple } from "@phosphor-icons/react";
import type { ScoreDocument } from "./types";
import { Library } from "./components/Library";
import { ImportDialog } from "./components/ImportDialog";
import { PracticeStudio } from "./components/PracticeStudio";
import { scoreStorage } from "./data/storage";
import { parseMusicXml } from "./music/musicXml";
import { BUNDLED_DEMO_ID, DEMO_MUSIC_XML, isBundledDemo } from "./demo";
import { createBackup, restoreBackup } from "./data/backup";

type Theme = "light" | "dark";

function initialTheme(): Theme {
  const stored = localStorage.getItem("atelier-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function App() {
  const [scores, setScores] = useState<ScoreDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [backupMessage, setBackupMessage] = useState("");
  const backupInputRef = useRef<HTMLInputElement>(null);

  const selectedScore = useMemo(
    () => scores.find((score) => score.id === selectedId) || scores[0],
    [scores, selectedId],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("atelier-theme", theme);
  }, [theme]);

  useEffect(() => {
    void scoreStorage
      .list()
      .then(async (storedScores) => {
        let ordered = storedScores.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
        const storedDemos = ordered.filter(isBundledDemo);
        if (storedDemos.length) {
          const refreshedDemo = parseMusicXml(DEMO_MUSIC_XML, "Premiers pas en do.musicxml");
          refreshedDemo.id = BUNDLED_DEMO_ID;
          refreshedDemo.importedAt = storedDemos[0].importedAt;
          await scoreStorage.put(refreshedDemo);
          await Promise.all(
            storedDemos
              .filter((demo) => demo.id !== refreshedDemo.id)
              .map((demo) => scoreStorage.remove(demo.id)),
          );
          ordered = [refreshedDemo, ...ordered.filter((score) => !isBundledDemo(score))];
        }
        if (ordered.length) {
          setScores(ordered);
          setSelectedId(ordered[0].id);
          return;
        }
        const demo = parseMusicXml(DEMO_MUSIC_XML, "Premiers pas en do.musicxml");
        demo.id = BUNDLED_DEMO_ID;
        await scoreStorage.put(demo);
        setScores([demo]);
        setSelectedId(demo.id);
      })
      .catch(() => setLoadError("La bibliothèque locale n’a pas pu être ouverte."))
      .finally(() => setLoading(false));
  }, []);

  const addScore = async (score: ScoreDocument) => {
    await scoreStorage.put(score);
    setScores((current) => [score, ...current]);
    setSelectedId(score.id);
  };

  const addScoreQuiet = async (score: ScoreDocument) => {
    await scoreStorage.put(score);
    setScores((current) => [score, ...current]);
  };

  const updateScore = async (score: ScoreDocument) => {
    await scoreStorage.put(score);
    setScores((current) => current.map((item) => item.id === score.id ? score : item));
  };

  const exportBackup = async () => {
    try {
      const blob = await createBackup();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `atelier-piano-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setBackupMessage("Sauvegarde créée.");
    } catch {
      setBackupMessage("La sauvegarde n’a pas pu être créée.");
    }
  };

  const importBackup = async (file?: File) => {
    if (!file) return;
    try {
      const count = await restoreBackup(file);
      const restored = (await scoreStorage.list()).sort((a, b) => b.importedAt.localeCompare(a.importedAt));
      setScores(restored);
      if (restored.length) setSelectedId(restored[0].id);
      setBackupMessage(`${count} partition${count > 1 ? "s" : ""} restaurée${count > 1 ? "s" : ""}.`);
    } catch (reason) {
      setBackupMessage(reason instanceof Error ? reason.message : "La restauration a échoué.");
    } finally {
      if (backupInputRef.current) backupInputRef.current.value = "";
    }
  };

  const deleteScore = async (id: string) => {
    const score = scores.find((item) => item.id === id);
    if (!score || !window.confirm(`Supprimer « ${score.title} » de cet appareil ?`)) return;
    await Promise.all([scoreStorage.remove(id), scoreStorage.removeProgress(id)]);
    setScores((current) => current.filter((item) => item.id !== id));
    if (selectedId === id) {
      setSelectedId(scores.find((item) => item.id !== id)?.id || null);
    }
  };

  return (
    <div className="app-shell">
      <header className="app-bar">
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="Accueil Atelier Piano">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span><strong>Atelier</strong> Piano</span>
        </a>
        <div className="app-actions">
          <button className="theme-toggle" type="button" onClick={() => void exportBackup()} aria-label="Sauvegarder la bibliothèque" title="Sauvegarder la bibliothèque"><DownloadSimple size={19} /></button>
          <button className="theme-toggle" type="button" onClick={() => backupInputRef.current?.click()} aria-label="Restaurer une sauvegarde" title="Restaurer une sauvegarde"><UploadSimple size={19} /></button>
          <input ref={backupInputRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => void importBackup(event.target.files?.[0])} />
          <button className="theme-toggle" type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={`Activer le thème ${theme === "dark" ? "clair" : "sombre"}`}>
            {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
          </button>
          <button className="primary-button compact" type="button" onClick={() => setImportOpen(true)}>
            <Plus size={18} weight="bold" /> Importer
          </button>
        </div>
      </header>

      {backupMessage && <button className="toast-message" type="button" onClick={() => setBackupMessage("")} aria-live="polite">{backupMessage}</button>}

      <div className="app-body">
        <Library
          scores={scores}
          selectedId={selectedScore?.id || null}
          onSelect={setSelectedId}
          onImport={() => setImportOpen(true)}
          onDelete={(id) => void deleteScore(id)}
        />

        {loading && (
          <main className="loading-state" aria-live="polite">
            <div className="skeleton-line wide" /><div className="skeleton-line" /><div className="skeleton-sheet" />
            <span>Ouverture de votre piano…</span>
          </main>
        )}
        {!loading && loadError && (
          <main className="empty-state">
            <h1>Bibliothèque indisponible</h1>
            <p>{loadError}</p>
            <button className="primary-button" type="button" onClick={() => window.location.reload()}>Réessayer</button>
          </main>
        )}
        {!loading && !loadError && selectedScore && (
          <PracticeStudio
            key={selectedScore.id}
            score={selectedScore}
            allScores={scores}
            onImport={() => setImportOpen(true)}
            onUpdateScore={updateScore}
            onAddScoreQuiet={addScoreQuiet}
            onSelectScore={setSelectedId}
          />
        )}
        {!loading && !loadError && !selectedScore && (
          <main className="empty-state">
            <h1>Votre pupitre est vide</h1>
            <p>Ajoutez une partition, une source LilyPond ou un enregistrement de piano pour commencer.</p>
            <button className="primary-button" type="button" onClick={() => setImportOpen(true)}>
              <Plus size={18} weight="bold" /> Ajouter une partition
            </button>
          </main>
        )}
      </div>

      <ImportDialog
        open={importOpen}
        pdfOptions={scores.filter((score) => score.sourceType === "pdf" && score.binaryData).map((score) => ({ id: score.id, title: score.title }))}
        onClose={() => setImportOpen(false)}
        onImported={addScore}
      />
    </div>
  );
}
