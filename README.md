# Atelier Piano

Atelier Piano est une application web installable qui transforme une partition ou un enregistrement autorisé en séance de piano guidée. Elle fonctionne dans Safari, Chrome et les navigateurs modernes, sans compte utilisateur et sans App Store.

## Ce qui fonctionne déjà

- import MusicXML, XML, MXL compressé, MIDI, PDF et source LilyPond ;
- transcription locale de fichiers audio et de vidéos compatibles avec Basic Pitch ;
- affichage des partitions MusicXML avec OpenSheetMusicDisplay ;
- lecture des PDF dans le navigateur ;
- visualisation dédiée pour les fichiers MIDI ;
- génération automatique d’un parcours : écoute, main droite, main gauche, mains ensemble et interprétation ;
- découpage automatique par groupes de mesures ;
- tempo réglable, métronome et lecture en boucle ;
- clavier de piano visuel et tactile ;
- calibration du bruit ambiant et reconnaissance d’une note isolée avec le microphone ;
- préparation des accords attendus, compteur de justesse, d’erreurs et de séries ;
- statistiques d’erreurs par mesure ;
- export MusicXML, MIDI et ABC, avec aperçu ABC ;
- noms de notes en français (`Do Ré Mi`) ou en lettres (`C D E`) ;
- tutoriels YouTube intégrés avec passages horodatés ;
- sauvegarde des partitions et de la progression dans IndexedDB ;
- sauvegarde et restauration de toute la bibliothèque dans un fichier JSON ;
- liaison d’un PDF original à une partition MusicXML ou MIDI, avec suivi de la mesure en cours sur le document ;
- guide « compagnon Audiveris » : import du MusicXML reconnu optiquement et aide à la correction des mesures douteuses ;
- interface iPhone, iPad et ordinateur, en thème clair ou sombre ;
- mode Synthesia en piano-roll : notes qui tombent, clavier MIDI, clavier d’ordinateur, mode attente et score en direct ;
- installation comme application web depuis l’écran d’accueil.

La partition d’exemple « Premiers pas en do » est ajoutée automatiquement au premier lancement. Les calculs audio sont réalisés sur l’appareil et les fichiers ne sont pas envoyés à un serveur.

## Démarrer le projet

Pré-requis : Node.js 22 ou une version LTS récente.

```bash
npm install
npm run dev
```

Ouvrez ensuite [http://localhost:4173](http://localhost:4173).

Commandes de vérification :

```bash
npm test
npm run lint
npm run build
```

## Utilisation sur iPhone ou iPad

1. Déployez le dossier avec une adresse HTTPS.
2. Ouvrez cette adresse dans Safari.
3. Touchez le bouton de partage, puis « Sur l’écran d’accueil ».
4. Lancez Atelier Piano depuis son icône.
5. Au premier exercice, autorisez le microphone.

Dans « Jouer au piano », Atelier Piano fonctionne note après note : la note cible est surlignée, une note juste est validée et la suivante apparaît immédiatement. Les accords sont d’abord décomposés du grave vers l’aigu afin de rester fiables avec le microphone d’un iPad. La jauge à côté de « Le micro écoute » confirme que le son du piano arrive bien dans l’application.

L’accès au microphone par `getUserMedia()` exige une adresse HTTPS, sauf sur `localhost`. Le son n’est ni enregistré ni envoyé à un serveur. Il est analysé directement dans le navigateur.

Si le micro reste en attente, vérifiez dans Réglages iPadOS > Safari > Microphone que l’accès est autorisé, puis fermez et rouvrez l’application web. Après une nouvelle mise en ligne, la PWA recharge automatiquement sa dernière version ; si une ancienne version reste affichée, quittez-la complètement puis relancez-la depuis l’écran d’accueil.

## Mode Synthesia (piano-roll)

Le sélecteur en haut du pupitre propose deux façons de travailler la même partition :

- **Parcours guidé** (par défaut) : écoute, main droite, main gauche, mains ensemble, puis interprétation au microphone ;
- **Piano-roll — Mode Synthesia** : les notes de la section tombent vers la ligne de frappe, juste au-dessus du clavier dessiné.

### Ce que fait le mode Synthesia

- **notes qui tombent** : chaque note descend vers la ligne de frappe et l’atteint exactement au moment où elle doit être jouée ;
- **clavier MIDI** : bouton « Connecter un clavier MIDI » (Chrome, Edge ou Opera) ; les appareils branchés ou retirés à chaud sont suivis automatiquement ;
- **clavier d’ordinateur** : rangées `Z S X D C V G B H N J M` (grave) et `Q W E R T Y U I O P` (aigu), base Do4, décalage d’octave avec ← et → ;
- **clavier tactile** : sur iPad, touchez directement les touches du clavier dessiné ;
- **mode attente** : le temps s’arrête sur chaque note non jouée et repart dès que la bonne touche est enfoncée ;
- **score en direct** : précision, combo, meilleur combo, notes justes, erreurs, notes oubliées et mesure courante ;
- **bilan de fin de section** : précision, combo maximum et erreurs par mesure (3 mesures à revoir), avec « Rejouer la section » et « Continuer » vers l’étape suivante ;
- **solfège coloré** : une couleur par classe de hauteur, avec affichage optionnel des noms de notes (Do Ré Mi ou C D E) ;
- **boucle A–B par mesures**, **tempo de 25 % à 150 %**, **métronome** et **écoute de la section** avant de la jouer.

### Utilisation

1. Ouvrez une partition : la démo « Premiers pas en do » convient parfaitement.
2. Choisissez « Piano-roll — Mode Synthesia » en haut du pupitre, puis une étape dans le rail de gauche.
3. Réglez le tempo et la main (les deux, droite, gauche) ; laissez « Mode attente » actif pour débuter.
4. Jouez au clavier MIDI, au clavier d’ordinateur ou au doigt sur l’écran.
5. Raccourcis : `Espace` lecture/pause, `R` recommencer, `←` et `→` pour changer d’octave au clavier d’ordinateur.
6. À la fin de la section, lisez le bilan puis rejouez la section ou passez à l’étape suivante.

La meilleure précision de chaque étape est mémorisée sur l’appareil (progression IndexedDB du parcours, doublée d’une copie locale pour le piano-roll), comme pour le mode guidé.

## Déploiement gratuit

L’application est statique. Elle peut être hébergée gratuitement sur Cloudflare Pages, Netlify, Vercel ou GitHub Pages.

Configuration générale :

- commande de construction : `npm run build` ;
- dossier publié : `dist` ;
- version de Node recommandée : 22 ;
- HTTPS : activé par l’hébergeur.

Pour un premier essai depuis le même réseau Wi-Fi, la commande `npm run dev` expose aussi l’adresse locale de l’ordinateur. Safari exigera toutefois HTTPS pour garantir l’accès au microphone sur un autre appareil. Un hébergement gratuit reste donc la méthode la plus simple.

## Architecture

```text
src/
  audio/              Détection de hauteur, lecture et métronome
  components/         Pupitre, clavier, bibliothèque et import
  data/               Sauvegarde IndexedDB
  media/              Validation des liens et horodatages YouTube
  music/              Imports, transcription, exports et génération des cours
  practice/           Moteur de pratique : tempo, piano-roll, transport, boucle et score
  App.tsx              Navigation principale
  demo.ts              Partition libre de démonstration
public/
  manifest.webmanifest
  sw.js                Cache PWA
docs/
  ETUDE_ET_ROADMAP.md  Comparaison produit et étapes suivantes
spec/
  spec-architecture-piano-learning-application.md  Spécification complète et portable
```

La [spécification complète](spec/spec-architecture-piano-learning-application.md) est le document autonome à transmettre à un autre développeur ou à ouvrir dans un autre IDE. Elle décrit le produit, l’architecture, les formats, les modèles de données, la sécurité, les critères de test et les évolutions prévues.

Le format central est MusicXML. Il contient les notes, les durées, les mesures, les portées et les mains. MIDI et transcription audio sont convertis dans le même modèle interne. Un PDF reste affichable, mais doit être transformé en MusicXML par un outil OMR tel qu’Audiveris avant la génération automatique d’un cours fiable.

## Limites connues

### Microphone

Le détecteur en direct reconnaît une note dominante à la fois. C’est adapté aux premiers exercices et aux mains séparées, mais les accords joués au piano acoustique ne peuvent pas encore être validés note par note de façon fiable. En revanche, la transcription d’un fichier audio utilise un modèle polyphonique spécialisé.

### Transcription audio et vidéo

La transcription accepte les formats que le navigateur sait décoder, avec une limite de 100 Mo et 12 minutes. Elle produit un brouillon quantifié qu’il faut vérifier, surtout lorsque l’enregistrement contient d’autres instruments, de la réverbération ou du bruit. Sur Safari, tous les conteneurs vidéo ne sont pas décodables : extraire légalement la piste audio de sa propre vidéo améliore la compatibilité.

### YouTube

L’application intègre le lecteur officiel et permet d’associer des passages horodatés aux étapes du cours. Elle ne télécharge pas et n’extrait pas le son d’une vidéo YouTube. Pour transcrire un tutoriel, il faut importer un fichier audio ou vidéo dont l’utilisateur possède les droits ou l’autorisation.

### PDF

Un PDF de partition contient généralement des pages dessinées, pas une liste exploitable de notes. La version actuelle l’affiche et demande ensuite le MusicXML correspondant. L’intégration proposée pour la suite utilise Audiveris, logiciel libre de reconnaissance optique musicale, sur un ordinateur ou un petit service personnel.

### MIDI dans Safari

Le mode Synthesia utilise l’API Web MIDI quand le navigateur l’expose (Chrome, Edge et Opera sur ordinateur). Safari sur iPhone et iPad ne la propose pas : dans ce cas le piano-roll reste jouable au clavier d’ordinateur et au doigt sur le clavier tactile de l’écran, et le parcours guidé continue de tout valider au microphone. Un connecteur MIDI natif supposerait d’emballer l’application pour l’App Store, ce qui ne correspond pas au choix actuel.

## Confidentialité

- aucun compte ;
- aucune publicité ;
- aucune analyse comportementale ;
- aucune partition ni transcription envoyée vers un service externe ;
- bibliothèque enregistrée uniquement sur l’appareil ;
- microphone analysé en mémoire puis immédiatement libéré.

Effacer les données du site dans Safari ou supprimer une partition dans la bibliothèque retire les données enregistrées localement.

## Sources techniques

- [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org/typescript-library/) pour le rendu MusicXML ;
- [Spotify Basic Pitch](https://github.com/spotify/basic-pitch) pour la transcription locale ;
- [abcjs](https://www.abcjs.net/) pour l’aperçu ABC ;
- [Audiveris](https://audiveris.github.io/audiveris/) pour la future conversion optique PDF vers MusicXML ;
- [MDN, accès au microphone](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) ;
- [Apple, configuration des applications web](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html) ;
- [Compatibilité Web MIDI](https://caniuse.com/midi).
