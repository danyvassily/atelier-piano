# Mode Synthesia — Spécification de mission (v1.1)

> Établie le 23/09/2026 par le Chief of Staff (organisation Hermes) à la demande de Dany :
> « que l'application soit le plus proche possible de Synthesia pour progresser au piano et en solfège ».
> **Réalisée le 23/09/2026 au soir — v1.1.0** (développée par les agents du Software Studio Hermes).

## Objectif

Transformer l'expérience de pratique d'Atelier Piano pour s'approcher de Synthesia :
**notes qui tombent (piano roll)**, **entrée d'un vrai clavier MIDI**, **mode attente**, **scoring précis**, aide au solfège.

## Périmètre v1.1

1. **Piano roll « falling notes »** — colonnes de notes qui tombent vers une ligne de frappe, clavier intégré sous la ligne, couleurs par main (droite = cyan #4FC3F7, gauche = bleu #2D6CDF) ou par classe de hauteur (option « Solfège coloré »), noms de notes optionnels (Do Ré Mi / C D E), 60 fps, DPR-aware.
2. **Entrées** — Web MIDI (entrée + sortie, multi-appareils), clavier d'ordinateur (mapping physique rangées Z/Q, octaves ←/→), touches tactiles sur le canvas ; le microphone existant reste un mode de secours.
3. **Transport** — lecture/pause, tempo 25–150 %, choix des mains, boucle A–B par mesure, métronome existant, **mode attente**, **lead-in de 4 temps** (les notes tombent visiblement depuis le haut).
4. **Scoring** — perfect (≤ 90 ms) / good (≤ 200 ms) / wrong / miss, combo + meilleur combo, précision %, erreurs par mesure, écran de fin de session + meilleure précision mémorisée par étape.
5. **Solfège** — noms sur les touches et sur les notes (option), altérations françaises (Do♯…), colorisation chromatique pédagogique.
6. **Premium** — thème sombre type Synthesia, clavier réaliste (dégradés, gloss des noires, ombres portées), **plein écran natif + repli immersif iPhone**, estompage automatique des contrôles pendant la lecture (révélation au toucher), raccourcis (Espace, R), responsive iPad paysage + desktop.

## Definition of Done — ✅ atteint le 23/09/2026

- [x] `npm test` vert — **161 tests** (44 timeline, 34 transport, 33 MIDI/clavier, 29 scoring/nommage, 21 existants)
- [x] `npm run build` et `npm run lint` OK · `tsc -b` sans erreur
- [x] Démonstration réelle navigateur : import MIDI → mode Synthesia → notes qui tombent → clavier (ordinateur/MIDI/tactile) → mode attente → score affiché (captures desktop + iPhone validées)
- [x] Zéro régression des modes existants (micro, leçons guidées, PDF, export)
- [x] README + cette spec à jour · commit poussé sur `main` · déploiement Vercel `atelier-piano-olive`

## Backlog v1.2 (pistes)

Réalisme du clavier encore perfectible (gloss des noires), repères de mesure/temps sur le piano-roll, taille des touches ajustable sur iPhone (zoom/défilement), scoring avancé par piste MIDI, finger hints, bibliothèque de morceaux, reconnaissance polyphonique micro.
