# ADR-0009 — Refonte de l'interface : parcours guidé et parcours libre

- Statut : accepté le 2026-10-05 (handoff de design `docs/ux/design_handoff_parcours_guide_libre/`, arbitrages de l'utilisateur du même jour)

## Constat

L'interface actuelle (trois colonnes, huit sections repliables, six onglets de vues, contrôle de conception à droite, voir `docs/ux/EXISTANT.md`) montre tout à tout le monde : trop dense pour une démo ou un débutant, peu directe pour un artisan qui veut aller à une section, et elle mêle conception et sorties d'atelier. Le designer a livré une refonte en deux parcours sur un seul projet (README du handoff, maquettes hi-fi, spécification de contenu champ par champ).

## Décision

Mettre en œuvre le handoff `docs/ux/design_handoff_parcours_guide_libre/README.md`. Font foi : la maquette hi-fi (écrans 1a, 1b, 2a à 2d) pour la mise en page et les textes, la spécification de contenu (`Blondel Contenu Parcours.dc.html`, rendu texte dans `rendus/contenu.txt`) pour le niveau et le libellé de chaque paramètre. Les rendus PNG des maquettes sont dans `rendus/`.

Arbitrages de l'utilisateur (2026-10-05), tous conformes aux recommandations :

1. **Style** : adoption du système **Industry** (jetons portés dans `apps/web/src/styles.css`, angles vifs, cadres blueprint, Barlow / Barlow Condensed, icônes Lucide trait 1,5 via `lucide-react`).
2. **Thème sombre** conservé, **dérivé** des ramps Industry ; polices **embarquées** via `@fontsource` (aucun appel externe, l'application reste utilisable hors ligne, ADR-0008).
3. **Petits écrans** : repli simple. Sous 1 100 px, l'inspecteur passe en tiroir ; sous 760 px, le parcours guidé est imposé, la barre d'étapes défile horizontalement et la vue passe au-dessus du formulaire.
4. **L'ancienne interface est remplacée entièrement** : pas de drapeau de retour. Le mode expert du plan (`PlanExpertEditor`, `lib/expert.ts`) est retiré au profit de l'inspecteur Marche ; les e2e sont réécrits sur la nouvelle interface.
5. **Essence et rayon de nez** (paramètres de la structure) s'éditent aussi dans « Marches » : même chemin du projet, deux champs.
6. **Balancement dans le guidé** : collet cible et marches balancées par côté sous « Plus de réglages » ; la méthode M0–M6 reste dans le panneau libre.
7. **Supports de marche** : la longueur d'appui mini passe au niveau Conception (visible) ; aile, épaisseur, perçage, pince, marges restent en Atelier.
8. **Prédimensionnement** (jeu de charges, catégorie d'usage) : reste dans Structure, repris en ligne dans l'inspecteur « sans sélection ».
9. **Valeurs ◆ à valider** : leur validation est mémorisée **dans le projet** (champ optionnel du `ProjectSchema`, rétrocompatible, annulable) et reprise dans le dossier PDF. « Générer le dossier » n'est **pas bloqué** par des ◆ restantes : compteur visible et liste dans le PDF.
10. **Couleurs fonctionnelles** (sélection, sévérités, respecté, trémie) centralisées en une palette unique partagée par l'interface, la 3D et les SVG exportés ; les documents d'atelier restent sur la palette claire. Les écarts d'instantanés qui en découlent sont justifiés.
11. **Contraste** (décision du 2026-10-05, après la vague 1) : les fonds pleins d'accent qui portent du texte (bouton primaire, option active d'un segmenté, onglet choisi) prennent `--color-accent-700` (#416180, 5,8:1) au lieu de l'accent Industry #5980a6 (3,7:1, sous WCAG AA) ; un test de contraste le garantit.
12. **Livraison** : worktree dédié (`feat/parcours`), une vague de workflow par étape, fusion sur `develop` (donc déploiement) seulement après accord de l'utilisateur.

## Conséquences

- Nouvel état d'interface dans `appStore` (hors projet, persisté avec les préférences) : parcours, étape guidée, étapes vues, panneau libre et épinglage, espace Conception / Fabrication, encart « parcours libre » fermé.
- Un dictionnaire de niveaux (Essentiel / Conception / Atelier) par chemin de paramètre, à côté de `lib/paramLabels.ts`.
- Les invariants existants tiennent : aucun calcul métier dans l'UI, aucun texte en dur (fr / en), SVG affichés = exports, saisie en mm entiers, tout annulable, mention indicative du contrôle visible.
- Les zones « intentions à détailler » des wireframes (1h Exporter, 1j fenêtres, 1k erreurs, 1l couleurs) reprennent l'existant restylé, sauf indication contraire.
