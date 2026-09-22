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
- interface iPhone, iPad et ordinateur, en thème clair ou sombre ;
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

L’accès au microphone par `getUserMedia()` exige une adresse HTTPS, sauf sur `localhost`. Le son n’est ni enregistré ni envoyé à un serveur. Il est analysé directement dans le navigateur.

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

La version actuelle privilégie le microphone, car l’API Web MIDI n’est pas prise en charge par Safari sur iPhone et iPad. Un futur connecteur natif ne serait possible qu’en emballant l’application pour l’App Store, ce qui ne correspond pas au choix actuel.

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
