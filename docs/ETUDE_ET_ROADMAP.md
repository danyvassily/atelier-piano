# Étude produit et feuille de route

## Décision

Le meilleur point de départ est une PWA indépendante, sans compte ni serveur obligatoire. Elle peut être ouverte dans Safari ou Chrome, installée sur l’écran d’accueil et déployée gratuitement.

Le risque produit est faible pour une utilisation personnelle. Le risque technique est moyen, principalement à cause de la reconnaissance des accords d’un piano acoustique par microphone.

L’hypothèse à tester en premier est simple : la détection monophonique doit reconnaître correctement dix minutes de jeu sur votre piano, dans votre pièce, avec l’iPad placé sur le pupitre. Si ce test n’est pas assez fiable, il faudra améliorer le traitement audio avant de développer la reconnaissance polyphonique.

## Inspirations vérifiées

| Produit | Ce qu’il fait bien | Limite pour ce projet | Ce qui est repris |
| --- | --- | --- | --- |
| Simply Piano | Écoute le piano au micro, retour immédiat, clavier visuel, écoute d’un passage, tempo, mains séparées, métronome et mode qui attend la bonne note | Application native et fonctions complètes sur abonnement | Retour coloré, note attendue, mode d’entraînement, parcours par étapes |
| Skoove | Méthode « Listen, Learn, Play », petites leçons, partition mobile et retour en temps réel au microphone | Catalogue et accès complet payants, import personnel non central | Écouter, apprendre par fragments, jouer puis obtenir un bilan |
| Atelier Piano | Partitions personnelles, fonctionnement local, pas de compte et hébergement statique gratuit | Détection polyphonique et reconnaissance PDF encore à construire | Différenciation principale |

Sources :

- [Simply Piano, fonctionnement de l’apprentissage](https://piano-help.hellosimply.com/en/articles/7943490-learning-with-simply-piano-the-basics) ;
- [Simply Piano, fonctions du mode Play](https://piano-help.hellosimply.com/en/articles/7943680-understanding-play) ;
- [Simply Piano, options des morceaux](https://piano-help.hellosimply.com/en/articles/16945914-simply-piano-song-library-menu-navigation) ;
- [Skoove, méthode et fonctions](https://www.skoove.com/) ;
- [Skoove, formule gratuite et tarifs](https://www.skoove.com/en/pricing).

## Périmètre de la première version

### Inclus

- PWA responsive ;
- MusicXML, MXL et MIDI ;
- PDF consultable ;
- parcours automatiquement généré ;
- écoute synthétisée ;
- tempo, boucle et métronome ;
- mains séparées ;
- retour au micro pour une note isolée ;
- clavier tactile de test ;
- progression locale.

### Retardé volontairement

- comptes et synchronisation entre appareils ;
- catalogue commercial de chansons ;
- paiement ;
- réseau social ;
- reconnaissance fiable des accords ;
- conversion PDF automatique dans le navigateur ;
- connexion MIDI dans Safari iOS.

Ces éléments ne sont pas nécessaires pour vérifier la qualité pédagogique du produit.

## Stratégie PDF

La chaîne recommandée est :

```text
PDF ou photo
    ↓
Audiveris sur ordinateur ou service personnel
    ↓
MusicXML à corriger si nécessaire
    ↓
Atelier Piano
    ↓
Mini-cours, partition interactive et suivi des notes
```

[Audiveris](https://audiveris.github.io/audiveris/_pages/reference/outputs/README/) produit du MusicXML à partir d’une partition imprimée. Cette conversion reste imparfaite sur les scans difficiles. Une étape de vérification est donc nécessaire avant de créer les exercices.

Trois options sont possibles :

1. Installer Audiveris gratuitement sur votre ordinateur et importer le résultat dans Atelier Piano. C’est le choix immédiat le plus simple.
2. Ajouter plus tard un petit service personnel qui lance Audiveris. L’application ne serait alors plus entièrement statique.
3. Utiliser un service commercial de reconnaissance. Cette solution serait plus simple à opérer, mais ne respecterait plus l’objectif gratuit et local.

## Stratégie microphone

Le prototype utilise l’API Web Audio et une autocorrélation. Il supprime l’annulation d’écho et la réduction de bruit, car ces traitements sont conçus pour la voix et peuvent dégrader un signal de piano.

Étapes de validation :

1. Tester des notes isolées du registre utilisé par le morceau.
2. Mesurer les erreurs avec l’iPad à plusieurs distances du piano.
3. Ajuster le seuil de volume et la stabilité sur deux trames.
4. Tester les répétitions de la même note.
5. Ajouter ensuite la détection de deux notes, puis des accords.

La reconnaissance polyphonique pourra utiliser un modèle de transcription de piano exécuté avec WebAssembly, WebGPU ou sur un serveur personnel. Elle ne doit être ajoutée qu’après validation du mode monophonique.

## Feuille de route

### Version 0.1, prototype actuel

Valider l’import, la lisibilité sur le pupitre, la génération du cours et la reconnaissance de notes simples.

### Version 0.2, usage quotidien

- calibrage du microphone ;
- choix manuel de la tessiture ;
- reprise exacte après une pause ;
- édition des limites d’une boucle ;
- bilan par mesure ;
- export et import de la sauvegarde locale.

### Version 0.3, PDF personnel

- compagnon Audiveris local ;
- correction des mesures mal reconnues ;
- association du PDF original et du MusicXML ;
- surlignage de la mesure jouée sur le document original.

### Version 0.4, accords

- transcription polyphonique ;
- comparaison des accords attendus ;
- tolérance rythmique configurable ;
- tests de latence sur plusieurs générations d’iPhone et d’iPad.

## Critères de réussite

Le prototype est utile si vous pouvez importer un morceau, comprendre le parcours sans explication, travailler quatre mesures et obtenir un retour assez fiable pour corriger une erreur. La sophistication visuelle ou l’intelligence artificielle n’est pas un critère prioritaire tant que cette boucle n’est pas solide.

