import { Scan } from "@phosphor-icons/react";
import type { ScoreDocument } from "../types";

interface AudiverisGuideProps {
  score: ScoreDocument;
  onImport: () => void;
  onUpdateScore: (score: ScoreDocument) => Promise<void> | void;
}

/**
 * Flux « compagnon Audiveris » (v0.3, 100 % local).
 * La reconnaissance optique tourne sur l'ordinateur de l'utilisateur
 * (Audiveris, logiciel libre) ; l'app importe le MusicXML produit,
 * le relie à son PDF source et aide à corriger les mesures douteuses.
 */
export function AudiverisGuide({ score, onImport, onUpdateScore }: AudiverisGuideProps) {
  const isPdf = score.sourceType === "pdf";
  const flaggedCount = score.flaggedMeasures?.length ?? 0;

  const toggleAudiveris = (checked: boolean) => {
    const next = { ...score };
    if (checked) next.audiverisGenerated = true;
    else delete next.audiverisGenerated;
    void onUpdateScore(next);
  };

  return (
    <details className="audiveris-guide">
      <summary>
        <Scan size={19} />
        <span>
          <strong>Compagnon Audiveris : du scan au cours</strong>
          <small>Conversion optique sur votre ordinateur, correction ici — sans serveur ni compte.</small>
        </span>
      </summary>
      <ol className="audiveris-steps">
        <li>
          <strong>Préparez le PDF.</strong>
          <span>Un scan droit, contrasté, sans pages penchées. C’est ce qui change le plus la qualité.</span>
        </li>
        <li>
          <strong>Lancez Audiveris sur votre ordinateur.</strong>
          <span>Logiciel libre, gratuit. Ouvrez-y le PDF puis exportez le résultat en MusicXML.</span>
        </li>
        <li>
          <strong>Importez le MusicXML ici.</strong>
          <span>
            {isPdf
              ? "Utilisez le bouton d’import et cochez « Généré par Audiveris » : le cours sera créé et pourra être relié à ce PDF."
              : "Cochez ci-dessous si ce fichier vient d’Audiveris, puis reliez le PDF source dans le panneau « PDF original »."}
            <button className="secondary-button compact-action" type="button" onClick={onImport}>Importer un fichier</button>
          </span>
        </li>
        <li>
          <strong>Corrigez les mesures douteuses.</strong>
          <span>
            {flaggedCount > 0
              ? `${flaggedCount} mesure${flaggedCount > 1 ? "s" : ""} signalée${flaggedCount > 1 ? "s" : ""} « à vérifier » dans le bilan. Comparez avec le PDF original, corrigez dans Audiveris si besoin, puis réimportez.`
              : "Écoutez le passage, comparez avec le PDF original et signalez « à vérifier » toute mesure fausse depuis le bilan par mesure."}
          </span>
        </li>
      </ol>
      {!isPdf && (
        <label className="rights-check audiveris-check">
          <input type="checkbox" checked={score.audiverisGenerated === true} onChange={(event) => toggleAudiveris(event.target.checked)} />
          <span>Ce MusicXML a été généré par Audiveris (affiche l’aide à la correction).</span>
        </label>
      )}
      {!isPdf && score.audiverisGenerated === true && (
        <p className="audiveris-reminder" role="note">
          Points de vigilance Audiveris : armure et tempo, répartition main droite / main gauche,
          altérations accidentelles et reprises. Une mesure corrigée à la source profite à tout le cours.
        </p>
      )}
    </details>
  );
}
