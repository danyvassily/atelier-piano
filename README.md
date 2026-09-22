# Atelier Piano

Atelier Piano est une application web installable qui transforme une partition MusicXML ou MIDI en séance de piano guidée. Elle fonctionne dans Safari, Chrome et les navigateurs modernes, sans compte utilisateur et sans App Store.

## Ce qui fonctionne déjà

- import MusicXML, XML, MXL compressé, MIDI et PDF ;
- affichage des partitions MusicXML avec OpenSheetMusicDisplay ;
- lecture des PDF dans le navigateur ;
- visualisation dédiée pour les fichiers MIDI ;
- génération automatique d’un parcours : écoute, main droite, main gauche, mains ensemble et interprétation ;
- découpage automatique par groupes de mesures ;
- tempo réglable, métronome et lecture en boucle ;
- clavier de piano visuel et tactile ;
- reconnaissance d’une note isolée avec le microphone ;
- compteur de justesse, d’erreurs et de séries ;
- sauvegarde des partitions et de la progression dans IndexedDB ;
- interface iPhone, iPad et ordinateur, en thème clair ou sombre ;
- installation comme application web depuis l’écran d’accueil.

La partition d’exemple « Premiers pas en do » est ajoutée automatiquement au premier lancement.

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
  music/              MusicXML, MXL, MIDI et génération des cours
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

La [spécification complète](spec/spec-architecture-piano-learning-application.md) décrit aussi les évolutions prévues : amélioration du microphone, transcription audio/vidéo locale, export ABC, flux PDF/Audiveris, sources LilyPond et tutoriels YouTube.

Le format central est MusicXML. Il contient les notes, les durées, les mesures, les portées et les mains. Le MIDI est converti dans le même modèle interne. Un PDF est affichable, mais doit être transformé en MusicXML avant la génération automatique du cours.

## Limites connues

### Microphone

Le détecteur actuel reconnaît une note à la fois. C’est adapté aux premiers exercices et aux mains séparées, mais pas encore aux accords complets. La transcription polyphonique d’un piano acoustique nécessite un modèle spécialisé, davantage de calcul et une validation sur plusieurs pianos et pièces.

### PDF

Un PDF de partition contient généralement des pages dessinées, pas une liste exploitable de notes. La version actuelle l’affiche et demande ensuite le MusicXML correspondant. L’intégration proposée pour la suite utilise Audiveris, logiciel libre de reconnaissance optique musicale, sur un ordinateur ou un petit service personnel.

### MIDI dans Safari

La version actuelle privilégie le microphone, car l’API Web MIDI n’est pas prise en charge par Safari sur iPhone et iPad. Un futur connecteur natif ne serait possible qu’en emballant l’application pour l’App Store, ce qui ne correspond pas au choix actuel.

## Confidentialité

- aucun compte ;
- aucune publicité ;
- aucune analyse comportementale ;
- aucune partition envoyée vers un service externe ;
- bibliothèque enregistrée uniquement sur l’appareil ;
- microphone analysé en mémoire puis immédiatement libéré.

Effacer les données du site dans Safari ou supprimer une partition dans la bibliothèque retire les données enregistrées localement.

## Sources techniques

- [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org/typescript-library/) pour le rendu MusicXML ;
- [Audiveris](https://audiveris.github.io/audiveris/) pour la future conversion optique PDF vers MusicXML ;
- [MDN, accès au microphone](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) ;
- [Apple, configuration des applications web](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html) ;
- [Compatibilité Web MIDI](https://caniuse.com/midi).
