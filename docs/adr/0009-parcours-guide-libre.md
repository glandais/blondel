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

## Mise en œuvre du point 9 (vague 4)

- Champ optionnel `validatedValues` du `ProjectSchema` (`packages/core/src/model/project.ts`) : liste d'entrées `{ path, value, structureKind? }`. `path` est la clé du dictionnaire des niveaux (chemin du projet joint par des points : `guards.posts.size`, `stair.balancing.rotationReach`, `stair.structure.params.supports.pinch`) ; `value` est la valeur **effective** au moment de la validation, défauts compris (défaut du schéma des garde-corps, du plugin de structure ou du cœur pour M6) ; `structureKind` n'est renseigné que pour un paramètre de plugin. Sans valeur par défaut : un projet sans validation est relu et réécrit à l'octet près (exemples inchangés), sans migration.
- **Caducité** : une validation ne vaut que si le chemin, le plugin et la valeur effective courante sont égaux à ceux enregistrés (`isValueValidated`). Si la valeur change ou si la structure change, l'entrée reste dans le fichier mais est ignorée : la valeur redevient ◆ et doit être validée de nouveau (revenir à la valeur validée la rend de nouveau validée).
- Édition par `setValuesValidated` du projectStore (une entrée d'historique, « Tout valider » compris, annulable) ; la dernière validation retirée retire le champ. Les compteurs ◆ (rail, replis des sections, étapes, Fabrication) ne comptent que les valeurs restantes ; la liste à cocher `ToValidateList` sert en Fabrication et à l'étape 7 du guidé ; le dossier PDF liste les valeurs validées et restantes.

## Mise en œuvre

Livrée en six vagues dans le worktree `feat/parcours` (journal : lignes `[parcours:vague-1]` à `[parcours:vague-6]` de `docs/LEDGER.md` ; architecture : `docs/ARCHITECTURE.md`, « Interface : parcours guidé et parcours libre » ; critères : `docs/ACCEPTATION.md` n° 7 ; captures : `docs/ux/captures-refonte/`).

1. **Fondations** : jetons Industry et thème sombre dérivé (`apps/web/src/styles.css`), polices Barlow embarquées, `lucide-react` et `components/ui/` ; palette fonctionnelle unique `FUNCTIONAL_COLORS` (interface, 3D, SVG exportés) ; sections extraites en composants autonomes rendus par `Tiered` ; dictionnaire des niveaux `lib/paramTiers.ts` ; contrôle « Auto | Imposer » qui affiche la valeur retenue par le modèle ; état des parcours (`store/journeyStore.ts`, `lib/journey.ts`).
2. **Parcours libre (1b)** : barre du haut, rail des 8 sections, panneau unique (épingle, Échap), vue centrale (Plan | 3D | Élévation, − + Recadrer, ligne de chiffres à la place de la barre d'état), inspecteur sans sélection (2d) et badge Contrôle, bascule Conception / Fabrication ; l'interface trois colonnes est retirée et les e2e réécrits.
3. **Inspecteurs** Règle (2c), Pièce (2b) et Marche (2a) sur une sélection partagée ; chaîne d'Échap ; le mode expert du plan (`PlanExpertEditor`, `lib/expert.ts`) est remplacé par le bloc « Ligne de nez » ; champs facultatifs du cœur pour l'interface (`Model.autoValues`, `headroomAtNosings`, `NosingLine.angle` / `computedAngle`, `Part.assembledWith`, `FixSuggestion.ruleIds`, `ruleTitle`, `Location` affinée).
4. **Mode Fabrication** (pièces par famille, pièce choisie, réglages d'atelier sur place, nomenclature, comparateur, sorties, coût) et validation des valeurs ◆ mémorisée dans le projet (point 9 ci-dessus).
5. **Parcours guidé (1a)** : barre d'étapes, formulaires d'étape bâtis sur les mêmes sections, chiffres clés et jauge 2h + g, vue conseillée, pied, encart « Vous connaissez le métier ? », correspondance étape ↔ panneau, étapes cochées ; règles d'ouverture réelles.
6. **Finitions** : libellés unifiés de la spécification § 4 dans le panneau, l'étape, l'assistant, l'inspecteur, le plan et les exports (contextes du contrôle en libellés courts, usages compris ; méthodes M0–M6 en libellés clairs, jusque dans le cartouche du plan exporté, « M3 · courbe continue (quintique) » ; nature et fiabilité expliquées dans l'inspecteur Règle) ; chiffres manquants exposés par le cœur (`Model.figures` : collet minimal, emprise au sol, recouvrement au nez, garde-corps) ; petits écrans (inspecteur en tiroir sous 1 100 px, la mention du contrôle indicatif reprise sous la vue tant que le tiroir est fermé ; guidé imposé sous 760 px, option Libre désactivée avec son explication en clair ; aucun défilement horizontal à 390 px) ; clavier (modèle ARIA des onglets, focus itinérant, contour 2 px décalé de 2 px) et audit axe-core WCAG A / AA ; réglages d'atelier des pièces de garde-corps dans l'inspecteur Pièce et en Fabrication ; glyphe ◆ retiré des noms accessibles (`TvMark`) ; notifications (avis de démo, application hors ligne) dans le flux au-dessus de la vue, texte jamais tronqué ; captures et documentation.

Écarts au handoff, et ce qui reste ouvert :

- **Chiffres et libellés sans source** : un chiffre que le modèle n'expose pas n'est pas affiché (jamais recalculé dans l'interface) ; la masse des marches est lue dans la nomenclature (`bomSummary` des pièces de la famille `treads`) ; la hauteur minimale exigée d'un garde-corps est lue dans les résultats des règles, pas écrite en dur. Les libellés de la maquette qui contredisaient le glossaire ou un libellé déjà en usage ont suivi la spécification de contenu § 4, qui fait foi.
- **Groupe « Visserie »** du mode Fabrication non affiché : le modèle ne produit aucune pièce de visserie (`docs/QUESTIONS.md` A27).
- **Retouche de l'angle du nez d'arrivée** : listée et retirable dans le bloc « Ligne de nez », plus éditable, faute de marche qui le porte (`docs/QUESTIONS.md` A28).
- **Valeurs « Auto » sans valeur retenue** : `windersPerSide` et les clés `stair.stepping.*` ne sont pas dans `Model.autoValues` ; le contrôle « Auto » affiche alors le libellé neutre « calculé », jamais une valeur de repli. Les assemblages des garde-corps et des contremarches ne sont pas encore dans `Part.assembledWith`.
- **Murs par côté** de la section Site : non proposés, le modèle n'expose pas le côté des murs (liste des murs seulement).
- **Fabrication sous 1 100 px** : le handoff ne la décrit pas ; le repli des petits écrans vise la Conception (tiroir d'inspecteur) et le guidé (imposé sous 760 px, étape 7 comprise) ; entre 760 et 1 099 px, la colonne de droite de la Fabrication passe simplement sous sa zone principale (document défilant verticalement), sans tiroir.
- **Notifications** : le handoff ne place ni l'avis de démo ni l'encart « Blondel est prêt à fonctionner hors ligne » ; ils sont posés hors du cadre de la vue, de ses commandes, de la ligne de chiffres, du formulaire et de l'inspecteur, et l'avis de démo reste jusqu'à sa fermeture.
- **Jauge 2h + g** : un seul repère pour la valeur courante entre les deux bornes lues dans `rules.yaml` ; l'anglais garde « 2R + G » (glossaire).
- **Contraste** : fonds pleins d'accent en `--color-accent-700` (point 11), au lieu de l'accent Industry.
- **Méthode M3** : la liste du panneau Balancement propose « M3 · courbe continue », la variante (Auto | Cubique | Quintique) étant un contrôle à part (spécification § 3) ; le libellé complet du § 4, « M3 · courbe continue (quintique) », désigne la variante **retenue** : cartouche du plan exporté, notes du découpage, bloc « Ligne de nez » de l'inspecteur Marche. En anglais, « M3 · smooth curve (quintic) ».
- **Matériau des garde-corps** : c'est le matériau de tout le garde-corps (poteaux, main courante, remplissage par défaut ; `GuardsSpec.material`), pas celui de la seule main courante où la spécification le range : le champ reste au niveau de la section, et la liste des valeurs ◆ le nomme « Garde-corps · Matériau » (de même « Garde-corps · Tolérance de détection des murs »).
- **Réglages hors du guidé sous 760 px** : le guidé étant imposé, les réglages de niveau Conception sans place dans les étapes (méthode de balancement et variante M3, angle de la herse, portée et raideur de M6, ligne de foulée, sens des tournants, ordre des volées) ne sont modifiables qu'à partir de 760 px de large ; le lien « Ouvrir » d'une telle valeur ◆ (M6) laisse alors place à l'explication « Parcours libre disponible à partir de 760 px de large. ».
- **Anglais** : symboles du glossaire dans les libellés unifiés (W pour l'emmarchement, R et G dans les chiffres, « rises » pour le nombre de hauteurs) ; des textes anglais plus anciens du cœur et des exports gardent « risers » au sens de contremarches comptées (ils ne sont pas des libellés de paramètre).
- `docs/ux/EXISTANT.md` et `docs/ux/captures/` restent la description de l'interface d'avant la refonte ; `pnpm ux:captures` produit désormais `docs/ux/captures-refonte/`.
