# Critères d'acceptation — revue finale

> 2026-09-30, intégration de la vague F. Revue des critères d'acceptation globaux de `docs/prompts/02-conception-dev.md` §6, précisés par `docs/CHALLENGE.md` (P1, P2, P3, P6). Pour chaque critère : l'état (**atteint** / **partiel** / **non**), puis les tests qui le prouvent. Tous ces tests passent dans `pnpm test` ou `pnpm e2e` (voir « Vérifications » en fin de document).

Légende des preuves : chemins relatifs à la racine du dépôt, nom du test entre guillemets.

## Synthèse

| #   | Critère (prompt 2 §6)                                                                                   | État    |
| --- | ------------------------------------------------------------------------------------------------------- | ------- |
| 1   | Quart tournant bois (H 2 700, trémie 2 800 × 900) conçu en < 2 min par l'assistant, conforme, PDF + DXF | atteint |
| 2   | Comparateur : variante UPN et limon débillardé soudé côte à côte, masse, nombre de pièces, coût         | atteint |
| 3   | Développés DXF d'un limon (dont chaque tronçon de débillardé) et d'une tôle pliée exploitables          | atteint |
| 4   | Aucun calcul métier dans les composants UI                                                              | atteint |
| 5   | Toute règle de conformité traçable jusqu'à sa source dans `docs/research/`                              | atteint |
| 6   | Interface et sorties en français ou en anglais (ADR-0007, ajouté le 2026-09-30)                         | atteint |
| 7   | Refonte de l'interface : parcours guidé et parcours libre (ADR-0009, ajouté le 2026-10-06)              | atteint |

« Atteint » veut dire vérifié automatiquement, pas validé par un atelier : les valeurs du profil d'atelier et des plugins restent des hypothèses « à valider » (`docs/LEDGER.md` §2). Les réserves de chaque critère sont listées plus bas.

## 1. Quart tournant bois conçu par l'assistant, conforme, exporté en PDF + DXF

**Atteint.** Définition retenue (CHALLENGE P1) : quart tournant bas, limons à la française avec poteau d'angle, H 2 700, trémie 2 800 × 900, E 800, `bois_dtu`, garde-corps barreaudé côté vide. « Conforme » = contrôle de conception sans violation bloquante (CHALLENGE P3). « 2 minutes » = nombre d'interactions mesuré par Playwright, plafonné à 20.

Preuves :

- `apps/web/e2e/assistant.spec.ts`, « critère n° 1 par l'assistant : quart tournant bois conforme, PDF et DXF ». Depuis une page vierge : assistant, trémie 2 800 × 900, structure visée « limons à la française », typologie « Quart tournant », E = 800, « Proposer », « Choisir », puis export du dossier PDF et du plan DXF 2007. Soit **13 interactions** (plafond 20 ; l'export passe par le menu « Exporter » de la barre du haut) et une durée totale sous 120 s (assertion ; ≈ 4 s en exécution automatisée). Le test vérifie aussi : E = 800 sur la carte retenue, structure `wood-housed`, jour « poteau », **0 bloquant**, aucune erreur de génération, balustres et poteau dans la nomenclature, aucune tâche longue au-delà de 200 ms, et le choix annulable en une seule fois.
- `packages/core/src/assistant/propose.test.ts`, « cas d'acceptation n° 1 » : quart tournant sans bloquant proposé en tête ; escalier droit rejeté pour l'échappée (ou à marge nulle et classé après) ; limons à la française contenus dans la trémie avec poteau d'angle ; budget ≤ 2 s ; résultats déterministes.
- `packages/exports/src/acceptance-criteria.test.ts`, « critère d'acceptation n° 1 complet » (exemple `j4-acceptance-01-garde-corps`) : 0 bloquant, 4 limons, poteau, garde-corps (poteaux, balustres, mains courantes). DXF R12 de chaque pièce à plat relu à ±0,01 mm, mortaises sur leur calque, plan DXF AC1021 relu. Dossier PDF avec plan, élévation, nomenclature, contrôle et développés.
- `apps/web/e2e/acceptance.spec.ts` : même critère par le préréglage plutôt que par l'assistant (15 interactions depuis la refonte du parcours libre, plafond 20 tenu ; côtés des garde-corps laissés en automatique : deux garde-corps, aucun mur imposé).
- `apps/web/e2e/structure-choice.spec.ts` (décision A4, 2026-09-30) : choisir « limons à la française » sur le préréglage quart tournant pose le poteau d'angle de 100 mm (plus d'erreur « jour à angle vif »), message affiché, annulable en une fois ; `packages/core/src/project/structureChoice.test.ts` pour tous les préréglages tournants.
- `packages/core/src/guards/acceptance.test.ts`, « garde-corps barreaudé côté vide : aucune violation bloquante ».

Réserves :

- La mesure « < 2 min » porte sur un parcours automatisé : aucun essai avec un utilisateur réel.
- L'assistant classe en tête un quart tournant avec palier quand la typologie n'est pas restreinte. Le parcours e2e coche « Quart tournant ».
- L'escalier droit est proposé à marge d'échappée nulle (classé après) : point ouvert au ledger §2.

## 2. Comparateur UPN / limon débillardé soudé sur un quart tournant balancé

**Atteint.** Définition retenue (CHALLENGE P2) : même épure (site, ligne de foulée, n), raccord de jour et balancement recalculés par variante, écarts affichés. Grandeurs physiques d'abord ; les euros ne s'affichent que si le barème d'atelier est renseigné.

Preuves :

- `packages/core/src/structures/steelCurved.acceptance.test.ts`, « critère d'acceptation n° 2 : comparateur sur la même épure » (exemple `j5b-debillarde-soude`, quart tournant M3 quintique) :
  - même nombre de hauteurs et même ligne de foulée ;
  - UPN impossible sur un jour à petit rayon : variante adaptée et signalée, sur le **poteau élargi des profilés** (décision A13 : aile + 2 × 20 mm, décalé vers le jour, soit 130 mm décalé de 45 mm ; aucun `FAB_POTEAU_RECEPTION` en violation) ;
  - écarts de jour, de giron et de balancement affichés ;
  - masse, pièces, pièces uniques, cordons dont bout à bout, EXC ;
  - coût `null` sans barème (champs manquants listés), et coût = matière + main-d'œuvre + finition pour les deux variantes avec un barème complet.
- Valeurs actuelles, sans barème (assertées par le test ; 2026-09-30, poteau élargi A13) :

  | Variante                | Masse    | Pièces | Uniques | Cordons   | dont bout à bout | EXC  |
  | ----------------------- | -------- | ------ | ------- | --------- | ---------------- | ---- |
  | UPN (poteau élargi 130) | 525,5 kg | 57     | 35      | 11 232 mm | 0                | EXC1 |
  | Débillardé soudé        | 307,2 kg | 66     | 40      | 15 461 mm | 650 mm           | EXC2 |

  Avant la décision A13 (poteau de 100 mm centré) : UPN 529,4 kg, 63 pièces, 41 uniques, 12 992 mm de cordons.

- `packages/core/src/structures/compare.test.ts` : une ligne par variante sur le même découpage, coût calculé à la main (`variantCost`), pas d'euros si une donnée manque.
- `apps/web/src/lib/variants.test.ts` : tableau côte à côte, « profil d'atelier requis » sans barème, euros avec un barème complet, jour adapté appliqué avec la variante.
- `apps/web/e2e/helical.spec.ts`, « comparateur : débillardé soudé à jour adapté, appliqué ; développés par tronçon et joints » : onglet « Comparer » de la Fabrication dans l'application construite.

Réserves :

- Le coût dépend d'un barème (taux horaire, prix matière, finition) que le profil d'atelier par défaut ne renseigne pas. Les euros n'apparaissent donc qu'une fois ce profil rempli (décision P2, ledger §2 « Temps d'atelier »).
- Depuis la vague I (décision A17), l'assistant énumère des jours en arc sur les tournants balancés et propose donc `steel-curved` (rayon roulable, 160 mm par défaut ; `packages/core/src/assistant/propose.test.ts`). Le cas n° 2 se vérifie toujours depuis le comparateur.
- Le barème se saisit depuis la vague I dans la fenêtre « Profil d'atelier » (décision A14), hors du projet ; le comparateur affiche les euros dès qu'il est complet (`apps/web/e2e/workshop-and-filters.spec.ts`, `apps/web/src/lib/workshopRates.test.ts`).
- Variante UPN de l'exemple j5b : le poteau élargi reçoit bien les limons de jour, mais la variante reste en erreur « aucune section UPN du catalogue ne passe » : le limon **mural** LE2, barre droite sur la corde des nez à travers le tournant, demande 340 mm d'âme pour loger les cornières (UPN 260 au plus dans le catalogue), alors que le prédimensionnement indicatif passe dès l'UPN 80. La masse UPN porte donc toujours sur une UPN 260 non validée ; le limon coudé par pièce d'angle soudée est prévu en V1 (QUESTIONS A13). Sur le cas d'acceptation n° 1 en profilés (`j3c-acceptance-01-upn`, poteau 125 mm décalé de 43 mm, soit l'aile de l'UPN 240 + 2 × 20 mm), l'UPN 240 passe (hauteur d'âme et prédimensionnement) sans erreur.

## 3. Développés DXF exploitables en atelier : limon, tronçons de débillardé, tôle pliée

**Atteint** au sens du critère automatique de CHALLENGE P6 : contours fermés, un calque par fonction, relecture par un second parseur à ±0,01 mm, repère de pièce gravé. L'essai en atelier (découpe laser, pliage, roulage) reste à faire.

Preuves (`packages/exports/src/acceptance-criteria.test.ts`) :

- « critère d'acceptation n° 3 : DXF de limon acier et de marche en tôle pliée » (exemple `j3b-acceptance-01-tole-pliee`) :
  - limons en plat : DXF R12 relus à ±0,01 mm (contour, perçages, traits), fibre de référence et épaisseur dans INFO ;
  - marches en Z : deux plis de 90° sur le calque PLI en tirets, sens (haut / bas) et angle annotés ;
  - contremarches : celles des marches en Z sont pliées dans la pièce ; la contremarche d'arrivée (`riser-n`, sous le dernier nez, portée par aucune pièce Z) est depuis la vague I une tôle pliée en L fixée au chevêtre (décision A11 : développé, ligne de pli, perçages, DXF ; `packages/core/src/structures/folded.test.ts`, `steelFlat.test.ts`), générée quand `treads.risers = "full"` ;
  - longueur de pli = emmarchement − 2 jeux (cote réelle), développé en fibre neutre ;
  - développés présents dans le PDF.
- « critère d'acceptation n° 3 : chaque tronçon d'un limon débillardé soudé » (exemple `j5b-debillarde-soude`, **ajouté par cette intégration**) :
  - chaque tronçon est développé en fibre neutre, avec un repère distinct, et son DXF R12 est relu à ±0,01 mm ;
  - lignes de roulage sur le calque ROULAGE en tirets, rayon intérieur annoté ;
  - un trait de joint par tronçon voisin sur le calque JOINT, qui nomme le repère de ce voisin.
- Limons bois : mortaises sur le calque MORTAISE relues à ±0,01 mm (critère n° 1 ci-dessus ; propriété dans `packages/exports/src/dxf/parts.test.ts`).
- `packages/exports/src/examples.test.ts` : sur les 16 exemples (dont `two-quarters-s`, ajouté par la vague G), DXF de chaque pièce à plat et de tous les développés relus sans NaN, planches SVG bien formées.
- `packages/core/src/structures/steelCurved.test.ts` : longueur roulée = (r_j − e/2)·θ en fibre neutre, lignes de roulage, traits de joint, reports des nez.
- Gabarits 1:1 du PDF : `packages/exports/src/pdf/tiles.test.ts` (1 mm = 1 mm, tuilage).

Réserves :

- Loi de pli (facteur K), rayon mini de roulage et formats de tôle : valeurs du profil d'atelier à valider par un plieur ou un rouleur pilote (ledger §2).
- La préparation des soudures est seulement annotée (« chanfrein à définir »).

## 4. Aucun calcul métier dans les composants UI

**Atteint**, avec un garde-fou automatique ajouté par cette intégration.

Preuves :

- `apps/web/src/architecture.test.ts` (**nouveau**) :
  - l'application ne consomme les paquets que par leurs points d'entrée publics, sans chemin vers `packages/…/src` ni lecture directe de `rules.data.json` ou `rules.yaml` ;
  - aucun composant de `components/` ni de `views/` n'appelle ni n'importe une étape du pipeline du cœur (`buildModel`, `computeStepping`, `evaluateCompliance`, `proposeDesigns`, `compareEpure`, `precheckModel`, `meshParts`…). Le test échoue si on ajoute un appel à `buildModel` dans un composant : vérifié avec `StatusBar.tsx`, puis (vague 2 du parcours libre, 2026-10-05) avec `components/view/FigureLine.tsx`, la ligne de chiffres qui la remplace.
- Architecture (ADR-0005, `docs/ARCHITECTURE.md`) :
  - le store ne contient que le `Project` ;
  - le `Model` est calculé dans un Web Worker (`apps/web/src/model/handler.ts`) ;
  - les SVG affichés sont ceux des exports ;
  - l'assistant et le comparateur tournent dans des workers dédiés ;
  - les formulaires de structure sont dérivés de `paramsSchema` et de `defaults(ctx)` du plugin (`lib/structureForm.ts`).
- Les fonctions pures de l'interface (`apps/web/src/lib/*.ts`) sont testées sous Node, par exemple `lib/nosingOverrides.test.ts` : « l'angle imposé est appliqué par le cœur autour de P_k (P_k immobile) » (le mode expert du plan et `lib/expert.ts` sont retirés par la refonte, ADR-0009 point 4).
- Refonte de l'interface (ADR-0009) : les chiffres affichés par les panneaux, les étapes guidées et les inspecteurs sont lus dans le `Model` (`Model.autoValues`, `headroomAtNosings`, `figures`, `Part.assembledWith`), jamais recalculés ; `architecture.test.ts` couvre les nouveaux dossiers `components/{free,guided,inspector,fabrication,topbar,view,sections,ui}`.

Réserves (écarts mineurs, hors composants, dans `apps/web/src/lib/`) :

- ~~`lib/expert.ts` recalcule la perpendiculaire à la ligne de foulée pour la poignée du mode expert.~~ Écart levé (vague 3 de la refonte, 2026-10-05) : le mode expert est retiré ; l'inspecteur Marche lit l'angle et l'angle calculé de chaque nez dans le modèle (`NosingLine.angle` / `computedAngle`) et `lib/nosingOverrides.ts` ne fait plus que des modifications du projet.
- Les pièces de garde-corps sont reconnues par le préfixe de leur identifiant.
- L'apparence par famille de pièces n'est qu'un aperçu.

## 5. Toute règle de conformité traçable jusqu'à sa source dans `docs/research/`

**Atteint.**

Preuves :

- `docs/research/rules.yaml` est la source unique des règles, avec pour chacune sa source, sa confiance et sa nature. `packages/core/src/rules/table.test.ts` vérifie que `rules.data.json` en est la copie à jour.
- `packages/core/src/rules/traceability.test.ts` (**nouveau**), sur les exemples (16 depuis la vague G) :
  - chaque règle de la table a une source ;
  - chaque ligne du contrôle issue de la table affiche la source de `rules.yaml` ;
  - chaque contrôle hors table (fabrication, prédimensionnement, garde-corps) cite `docs/research/` (ou SPEC / CHALLENGE), ou bien déclare une provenance non réglementaire : « Profil d'atelier Blondel (valeur par défaut à valider) », « Géométrie du… » ou « Calcul élastique Blondel ».
- `packages/core/src/rules/engine.test.ts`, « chaque règle applicable apparaît au moins une fois (traçabilité) ». Une règle sans évaluateur sort `non-evaluee`, jamais omise.
- Le rapport affiche nature, confiance et source secondaire (CHALLENGE P3), dans l'onglet de contrôle et dans le PDF.

Réserves :

- Depuis la vague J, 95 règles sur 103 ont un évaluateur dans le moteur (dont `LIMON_EPAISSEUR_MIN_DTU`, `CREMAILLERE_REGLE_MOYENS` et `LIMON_ENTAILLE_MIN`, dont le résultat d'attente est remplacé par celui de la structure). Les 8 autres sortent `non-evaluee` avec un motif exigé par test (`rules/evaluators/unevaluable.ts`) : contraste des nez, bande d'éveil, trois charges, cintrage, tolérances de trémie et d'étage. `GC_CABLES_DETENTE` et `LIMON_ENTAILLE_MIN` sont passées de contrôles hors table à la table ; les constantes des formules sont des champs structurés (`parametres`, `tables`), plus lues dans le texte.
- Les contrôles de fabrication tirés du profil d'atelier sont traçables au profil, pas à une norme. C'est voulu : ce sont des capacités d'atelier à valider.

## 6. Interface et sorties en français ou en anglais

**Atteint** (critère ajouté le 2026-09-30 avec l'internationalisation, ADR-0007). Définition retenue : l'interface, les messages du modèle (erreurs, remarques, constats du contrôle de conception, noms de pièces) et toutes les sorties (SVG, DXF, CSV, glTF, PDF) existent en français et en anglais ; la langue de l'interface vient du navigateur puis du choix de l'utilisateur ; changer de langue ne relance aucun calcul et retraduit tout ce qui est affiché ; le français reste identique à l'octet près (exemples et instantanés inchangés).

Preuves :

- `packages/i18n/src/keys.test.ts`, « dictionnaires » et « clés employées dans le code » : mêmes clés en français et en anglais, mêmes paramètres `{…}`, aucune valeur vide, clés triées et bien formées, variante `.other` de tout pluriel, toute clé littérale du code présente dans `fr.json`, aucune clé orpheline.
- `packages/i18n/src/translator.test.ts` : détection de la langue du navigateur, interpolation, pluriels français et anglais, nombres (« français : virgule et espace fine insécable (comme l'ancien formatFr des exports) », « anglais : point décimal et virgule des milliers »), dates, tri, repli sur la clé sans exception, `Message` intact après `structuredClone` (passage par le worker).
- `packages/core/src/rules/messages.test.ts` : « chaque règle de rules.yaml a sa description, en français identique à la table », « chaque description est traduite en anglais », constats (séries, rétrogradation, remarques du moteur, modèle partiel) en anglais sans reste français. `pipeline/structures.test.ts` et `structures/steelProfile.test.ts` : paramètres de structure refusés et section hors catalogue dans les deux langues.
- `packages/exports/src/i18n.test.ts`, « exports en anglais sur tous les exemples : aucun texte français restant » : pour chaque exemple de `examples/`, plan et élévation SVG, développés SVG, plan et développés DXF R12 et 2007 (textes et calques), CSV et fiche de débit, fiche de pose, glTF, dossier PDF ; ni texte français, ni clé brute, ni paramètre non rempli (heuristique `src/testing/french.ts`).
- `packages/exports/src/svg/english.test.ts` (calques DXF traduits, noms français historiques inchangés), `data.en.test.ts` (CSV anglais : « , » et point décimal ; « fr » explicite = défaut), `pdf/locale.test.ts` (dossier PDF anglais : même découpage en pages qu'en français, métadonnées, unités accordées).
- `apps/web/src/architecture.test.ts`, « aucun texte visible en dur dans l'interface (ADR-0007) » : aucun texte JSX ni attribut `title` / `aria-label` / `placeholder` / `alt` littéral dans `components/`, `views/` et `App.tsx` (avec auto-test du détecteur), aucun format `fr` écrit en dur.
- `apps/web/src/components/topbar.i18n.test.ts`, `assistant.i18n.test.ts`, `free/free.test.ts`, `inspector/inspector.test.ts`, `view/view.test.ts` et `sections/sections.test.ts` (refonte du parcours libre, vague 2) : barre du haut, ligne de chiffres, contrôle de conception de l'inspecteur, garde-corps, calque, panneaux des sections, hélicoïdal et assistant en français (libellés inchangés) et en anglais (aucune clé brute) ; « notification traduite à l'affichage (changer de langue la retraduit) ». `apps/web/src/store/projectStore.test.ts` : refus d'une modification et autosauvegarde refusée qui suivent un changement de langue, projet neuf nommé dans la langue de l'interface.
- `apps/web/e2e/i18n.spec.ts` : navigateur `en-US` sans choix mémorisé → interface anglaise et `html[lang=en]`, constat du contrôle de conception et export CSV en anglais, passage au français par le sélecteur, choix mémorisé au rechargement, sous le budget de 200 ms. Les autres specs imposent le français (`openApp`) et vérifient les libellés d'avant la migration.

Réserves :

- La terminologie anglaise suit `docs/research/glossaire-en.md` et reste **à valider** par un professionnel anglophone du métier (`docs/QUESTIONS.md` A26 et B12).
- Sources citées des règles, des contrôles de plugin, du catalogue de profilés et du profil d'atelier : traduites depuis le 2026-10-06 (QUESTIONS A26 (b), section 8 ci-dessous). Restent en français : noms par défaut du cœur quand l'interface n'en fournit pas, messages d'erreurs de programmation (toujours en paramètre d'un message traduit). Les contextes du contrôle s'affichent en libellés clairs depuis la vague 6 de la refonte (`contextShortLabel`, `packages/core/src/rules/contexts.ts` : « Logement (intérieur) », « Bois (DTU 36.3) »), la description longue en aide. Quelques textes anglais gardent un pluriel « (s) ». Détail : ADR-0007, « Restes connus ».
- Deux langues seulement ; ajouter une langue : `docs/ARCHITECTURE.md`, « une langue ».

## 7. Refonte de l'interface : parcours guidé et parcours libre (ADR-0009)

**Atteint** (critère ajouté le 2026-10-06, fin de la refonte en six vagues, worktree `feat/parcours`). Définition retenue : le handoff `docs/ux/design_handoff_parcours_guide_libre/` est mis en œuvre (maquettes 1a, 1b, 2a à 2d ; spécification de contenu `rendus/contenu.txt` pour le niveau et le libellé de chaque paramètre) avec les arbitrages de l'ADR-0009 ; les invariants tiennent (aucun calcul métier dans l'UI, aucun texte en dur, SVG affichés = exports, saisie en mm entiers, tout annulable, mention « Contrôle de conception indicatif : il ne vaut pas attestation de conformité. » visible). Captures : `docs/ux/captures-refonte/` (`pnpm ux:captures`).

| Critère                                                                                                                                                                                                                                                                                                                         | Preuves                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Règles d'ouverture : première visite ou démo → guidé, assistant → guidé à l'étape 1, import ou reprise → libre, puis dernier choix ; bascule sans perte (historique, vue, sélection)                                                                                                                                            | `apps/web/src/lib/journey.test.ts`, `apps/web/src/store/journeyStore.test.ts` ; e2e `apps/web/e2e/guided-journey.spec.ts`, `demos.spec.ts`                                                                                                                                           |
| Parcours guidé (1a) : 7 étapes en onglets ARIA, résumés et coche ✓, formulaire bâti sur les sections, chiffres clés et jauge 2h + g aux bornes lues dans les règles, vue conseillée, pied (contrôle, mention, précédent / suivant), encart « Vous connaissez le métier ? », étape 7 Fabrication                                 | `apps/web/src/components/guided/shell.test.ts`, `stepForm.test.ts`, `stepFigures.test.ts`, `cards.test.ts`, `apps/web/src/lib/guidedSteps.test.ts`, `ruleSteps.test.ts`, `blondelGauge.test.ts` ; e2e `guided-journey.spec.ts`                                                       |
| Parcours libre (1b) : barre du haut, rail des 8 sections, panneau unique (épingle, Échap), vue centrale (Plan \| 3D \| Élévation, − + Recadrer, ligne de chiffres en mm entiers), chiffres clés de section lus dans le `Model` (`Model.figures`)                                                                                | `apps/web/src/components/free/free.test.ts`, `sectionFigures.test.ts`, `apps/web/src/components/view/view.test.ts`, `apps/web/src/components/topbar.i18n.test.ts`, `packages/core/src/pipeline/figures.test.ts` ; e2e `free-journey.spec.ts`, `headroom-status.spec.ts`              |
| Niveaux et libellés unifiés : chaque paramètre a son niveau (Essentiel, Conception, Atelier) et sa place d'après la spécification ; un seul libellé par notion ; contextes en libellés clairs                                                                                                                                   | `apps/web/src/lib/paramTiers.test.ts`, `paramLabels.test.ts`, `apps/web/src/components/sections/sections.test.ts`, `packages/core/src/rules/contexts.test.ts` ; e2e `site.spec.ts`, `auto-field.spec.ts`, `structure-choice.spec.ts`                                                 |
| Inspecteur sans sélection (2d) : fiche du projet, coût ou lien vers le profil d'atelier, contrôle (compteurs, cartes, listes repliées, surcharges, prédimensionnement), mention                                                                                                                                                 | `apps/web/src/components/inspector/inspector.test.ts`, `template.test.ts`, `elementRules.test.ts` ; e2e `free-journey.spec.ts`, `workshop-and-filters.spec.ts`                                                                                                                       |
| Inspecteur Règle (2c) : sévérité, constat, jauge, « Où » cliquable, « Pour corriger » annulable, provenance, nature et fiabilité expliquées, surcharge justifiée                                                                                                                                                                | `apps/web/src/components/inspector/ruleInspector.test.ts`, `apps/web/src/lib/compliance.test.ts`, `ruleSections.test.ts` ; e2e `rule-inspector.spec.ts`                                                                                                                              |
| Inspecteur Pièce (2b) : valeurs du modèle, Isoler en 3D, Développé →, DXF R12, réglages d'atelier de la famille (structure) ou de la catégorie (garde-corps), annulables, pièces assemblées                                                                                                                                     | `apps/web/src/components/inspector/partInspector.test.ts`, `apps/web/src/lib/partSettings.test.ts`, `partLinks.test.ts` ; e2e `part-inspector.spec.ts`                                                                                                                               |
| Inspecteur Marche (2a) et ligne de nez (le mode expert du plan est retiré) : angle, valeur calculée, Fixer le nez, retrait, orphelines, ← / →                                                                                                                                                                                   | `apps/web/src/components/inspector/treadInspector.test.ts`, `apps/web/src/lib/nosingOverrides.test.ts` ; e2e `tread-inspector.spec.ts`                                                                                                                                               |
| Sélection partagée (plan, élévation, 3D, Fabrication, inspecteur), chaîne d'Échap, clic dans le vide → 2d                                                                                                                                                                                                                       | `apps/web/src/components/escapeChain.test.ts`, `apps/web/src/store/uiStore.test.ts` ; e2e `selection.spec.ts`                                                                                                                                                                        |
| Mode Fabrication : pièces par famille et filtre, pièce choisie, réglages d'atelier sur place, « Ouvrir dans Conception », Nomenclature, Comparer, À valider, sorties (dossier PDF jamais bloqué, fiche de pose, liste de débit), coût estimé                                                                                    | `apps/web/src/components/fabrication/fabrication.test.ts`, `aside.test.ts`, `apps/web/src/lib/partGroups.test.ts`, `workshopRates.test.ts` ; e2e `fabrication.spec.ts`                                                                                                               |
| Valeurs ◆ : validation mémorisée dans le projet (champ facultatif, caduque si la valeur change, annulable), compteurs des seules valeurs restantes, liste à cocher, page « Valeurs à valider » du dossier PDF, glyphe jamais dans un nom accessible                                                                             | `packages/core/src/project/validatedValues.test.ts`, `apps/web/src/lib/toValidate.test.ts`, `apps/web/src/components/ui/tvMark.test.ts`, `packages/exports/src/pdf/toValidate.test.ts`, `apps/web/src/lib/exportFiles.test.ts` ; e2e `fabrication.spec.ts`, `guided-journey.spec.ts` |
| Petits écrans : inspecteur en tiroir sous 1 100 px (mention du contrôle indicatif visible sous la vue, tiroir fermé), guidé imposé sous 760 px (option Libre désactivée et expliquée en clair, barre d'étapes défilante, vue au-dessus du formulaire), aucun défilement horizontal du document à 1 100, 760 et 390 px           | `apps/web/src/lib/viewport.test.ts`, `apps/web/src/store/journeyStore.test.ts`, `apps/web/src/store/uiStore.test.ts` ; e2e `responsive.spec.ts`                                                                                                                                      |
| Clavier et lecteur d'écran : modèle ARIA des onglets (rail, barre d'étapes : activation manuelle ; segmentés : automatique), focus itinérant, contour 2 px décalé de 2 px, commandes nommées, audit axe-core WCAG A / AA sans violation (1a, 1b, 2a, 2b, 2c, Fabrication, thème sombre, tiroir à 760 px, guidé imposé à 390 px) | `apps/web/src/components/ui/ui.test.ts` ; e2e `accessibility.spec.ts`                                                                                                                                                                                                                |
| Aucun calcul métier dans l'UI, aucun texte en dur, contraste des fonds pleins d'accent (ADR-0009 point 11)                                                                                                                                                                                                                      | `apps/web/src/architecture.test.ts`, `packages/i18n/src/keys.test.ts`, `apps/web/src/styles.test.ts` (contraste des feuilles de style)                                                                                                                                               |

Réserves :

- Écarts au handoff et questions ouvertes : ADR-0009, « Mise en œuvre » ; `docs/QUESTIONS.md` (groupe « Visserie » et nez d'arrivée sélectionnable : implémentés le 2026-10-06, section 8 ; angle du nez d'arrivée : A30).
- L'audit axe ne couvre pas le canevas 3D (rendu WebGL, nommé par son conteneur) ; une règle écartée doit l'être explicitement dans `accessibility.spec.ts`, avec sa raison, et être reportée ici.
- `docs/ux/EXISTANT.md` et `docs/ux/captures/` décrivent l'interface d'avant la refonte (2026-09-30) et ne sont plus tenus à jour.

## 8. Décisions de l'utilisateur A26 à A28 (2026-10-06)

**Atteint** (worktree `feat/decisions-a26-a28`, 2026-10-06). Définition retenue : les décisions consignées dans `docs/QUESTIONS.md` A26, A27 et A28 sont mises en œuvre sans écart au français (instantanés et `examples/` inchangés), sans calcul métier dans l'interface ni valeur non sourcée en dur.

| Critère                                                                                                                                                                                                                                                                                                                                                         | Preuves                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A26 (a) : « Development » pour le développé d'un limon bois, « Flat pattern » pour la tôle et l'acier (dessins, dossier PDF, interface)                                                                                                                                                                                                                         | `packages/exports/src/svg/flat.test.ts`, `pdf/locale.test.ts`, `apps/web/src/components/inspector/partInspector.test.ts` ; e2e `english-terms.spec.ts`                                                                   |
| A26 (a) : « R » réservé au rayon, hauteur de marche en toutes lettres dans les cartouches et libellés anglais (« rise »)                                                                                                                                                                                                                                        | `packages/exports/src/svg/english.test.ts`, `pdf/locale.test.ts` ; glossaire « Notations des cartouches »                                                                                                                |
| A26 (b) : sources citées traduites (`source_en` de `rules.yaml`, sources des contrôles de plugin, du catalogue et du profil d'atelier), profil du contrôle Strict / Lenient ; références françaises permises seulement pour une sortie qui imprime des sources                                                                                                  | `packages/core/src/rules/table.test.ts`, `rules/sources.test.ts`, `packages/exports/src/pdf/locale.test.ts` (tous les exemples), `i18n.test.ts` (option `citedSources`)                                                  |
| A27 : visserie déduite des seuls assemblages connus (fixations déclarées, platines percées, poteaux, mains courantes murales), diamètre normalisé (plus grand diamètre de la série qui passe avec le jeu minimal : 14 mm → M12, 18 mm → M16), fixation des poteaux selon le support (escalier acier : boulons, aucun tire-fond), mur non décrit selon le profil | `packages/core/src/fasteners/compute.test.ts`, `woodCentral.test.ts` (visserie)                                                                                                                                          |
| A27 : valeurs non déduites dans le profil d'atelier, « à valider », ◆ (section Structure, liste « À valider »)                                                                                                                                                                                                                                                  | `packages/core/src/workshop/profile.test.ts`, `apps/web/src/lib/fasteners.test.ts`, `paramTiers.test.ts`, `toValidate.test.ts` ; e2e `fasteners.spec.ts`                                                                 |
| A27 : visserie dans la nomenclature, la liste de visserie CSV, le dossier PDF et le groupe « Visserie » du mode Fabrication                                                                                                                                                                                                                                     | `packages/exports/src/csv/fasteners.test.ts`, `pdf/fasteners.test.ts`, `apps/web/src/lib/partGroups.test.ts` ; e2e `fasteners.spec.ts`, `english-terms.spec.ts` (« Fixings »)                                            |
| A28 : nez d'arrivée sélectionnable dans le plan coté (cible rectangulaire transparente) et l'élévation, au clavier ; bloc « Ligne de nez » seul ; Fixer le nez, annuler, Retirer la retouche ; navigation avec la dernière marche ; Échap                                                                                                                       | `apps/web/src/model/planSvg.test.ts`, `apps/web/src/components/inspector/treadInspector.test.ts`, `apps/web/src/components/escapeChain.test.ts` ; e2e `arrival-nosing.spec.ts`, `english-terms.spec.ts` (« Top nosing ») |
| Champ numérique : une saisie acceptée sans changement de la valeur affichée n'est pas réappliquée à la perte de focus (une seule entrée d'historique)                                                                                                                                                                                                           | `apps/web/src/lib/draft.test.ts` (`isRepeatedCommit`)                                                                                                                                                                    |

Réserves :

- A28 : l'angle du nez d'arrivée est affiché mais non modifiable (le découpage déclare inapplicable tout angle non nul sur ce nez) : question A30. Pas de sélection du nez d'arrivée par un clic en 3D (surlignage seulement).
- A27 : marche en tôle pliée sur son support, assemblage non décrit (perçages chiffrés, aucune visserie) : question A31. Pinces de verre non modélisées : aucune visserie.
- Toutes les valeurs de visserie restent « à valider » par un atelier (aucune règle chiffrée de cheville dans docs/research).

## 9. Décisions de l'utilisateur A29 (limon central métal) et A31 (2026-10-06)

**Partiel** (worktree `feat/limon-central-metal`, 2026-10-07) : vague 1 (métal) atteinte, limon central bois (couches collées) en vague 2. Définition retenue : les décisions consignées dans `docs/QUESTIONS.md` A29 (familles métal, tracés, supports, porte-à-faux et torsion, ancrages) et A31 sont mises en œuvre sans écart d'instantané sur les exemples existants (instantanés et `examples/` existants inchangés), sans calcul métier dans l'interface ni valeur non sourcée en dur. Écart voulu (A31) : les sorties de trois exemples en tôle pliée changent — `j3b-acceptance-01-tole-pliee`, `demo-half-turn-industrial`, `j4-demi-tournant-acier-garde-corps` : perçages dans le développé des marches, vis à métaux M8 × 20 (`treadBolted`) au lieu de vis à bois sur les supports, masse des marches, nomenclature, CSV, DXF, PDF et glTF ; classe d'exécution inchangée. L'instantané des cotes ne compte pas les perçages, d'où son identité.

| Critère                                                                                                                                                                                                                                          | Tests                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A29 : trace du limon central à l'axe de l'emmarchement (décalage), droite, débillardée sur les tournants (S / Z, poteau d'angle), hélicoïdale ; ligne des nez monotone                                                                           | `packages/core/src/structures/centralTrace.test.ts`                                                                                                                                     |
| A29 : poutre tube (droit) ou caisson (flasques roulées, semelles, entretoises), tronçons continus, joints bout à bout EXC2, développés en fibre neutre, évents, platines                                                                         | `packages/core/src/structures/centralBeam.test.ts`                                                                                                                                      |
| A29 : consoles ou supports pliés sous chaque marche, aucune pièce hors emprise, `buildModel` ne lève jamais (propriétés fast-check), justification de `LIMON_CENTRAL_PORTE_A_FAUX`                                                               | `packages/core/src/structures/steelCentral.test.ts`, `steelCentral.acceptance.test.ts`                                                                                                  |
| A29 : justification reprise dans le dossier PDF                                                                                                                                                                                                  | `packages/exports/src/pdf/compliance.test.ts`                                                                                                                                           |
| A29 : exemples `j5c-limon-central-*` et démo couverts par tous les exports et l'instantané des cotes                                                                                                                                             | `packages/exports/src/examples.test.ts`, `packages/core/src/pipeline/build.test.ts`, `project/presetDemo.test.ts`                                                                       |
| A29 : interface (carte, tube grisé avec sa raison, caisson, tronçons et joints en Fabrication, justification dans l'inspecteur Règle, démo)                                                                                                      | `apps/web/src/lib/structureForm.test.ts`, `paramTiers.test.ts`, `paramLabels.test.ts`, `variants.test.ts` ; e2e `central-stringer.spec.ts`, `english-terms.spec.ts` (« mono-stringer ») |
| A31 : marche en tôle vissée (perçages dans le développé et le support, visserie `treadBolted`) ou soudée (cordons, ni perçage ni visserie), chiffrage aligné                                                                                     | `packages/core/src/structures/treadFixing.test.ts`, `steelFlat.test.ts`, `steelCurved.test.ts`, `fasteners/compute.test.ts`, `pipeline/fasteners.test.ts`                               |
| A31 : point de fixation non percé dans la marche (trop près d'un pli, d'un bord, d'un autre perçage) : ni perçage du support ni vis ; trous des marches = points `treadBolted` = vis (propriétés)                                                | `steelFlat.test.ts`, `steelCentral.test.ts` (« points de fixation non percés », propriété « modèle sans erreur »)                                                                       |
| A31 : choix vissée / soudée dans l'interface (vis à métaux et perçages du développé d'une marche, annulation)                                                                                                                                    | e2e `fasteners.spec.ts` (« marches en tôle vissées \| soudées »)                                                                                                                        |
| A29 n° 5 : platines du limon central (tube et caisson) chevillées au sol et au chevêtre, jamais boulonnées acier sur acier                                                                                                                       | `pipeline/fasteners.test.ts`, `centralBeam.test.ts`                                                                                                                                     |
| A29 : console sous une marche balancée posée sur le dessus réel de la poutre (largeur b / cos β) ; support plié d'équerre ; support assemblé à la semelle haute du caisson                                                                       | `steelCentral.test.ts` (« appui des supports sur la poutre », propriété « modèle sans erreur »)                                                                                         |
| A29 : section incohérente refusée (erreur explicite, aucune pièce, quantités finies) ; entretoises jointives et supports de palier superposés signalés ; flasques valides sur un premier tronçon court (contre-exemple fixé) ; hélicoïdaux tirés | `centralBeam.test.ts`, `steelCentral.test.ts`                                                                                                                                           |

Réserves :

- Limon central bois (vague 2). Torsion et déversement non vérifiés (signalés, justification jointe). Boulons d'un support vissé non tracés dans la semelle haute de la poutre. Variante M3 quintique automatique non appliquée à `steel-central`, entraxe minimal des entretoises et supports pliés sous une marche balancée : questions A32. Palier d'arrivée d'un hélicoïdal non porté par le limon central.
- Toutes les dimensions du limon central et de la fixation des marches restent « à valider » par un atelier.

## 10. Décision de l'utilisateur A29, vague 2 : limon central bois (2026-10-07)

**Atteint** (worktree `feat/limon-central-bois`, 2026-10-07 ; vérifications ci-dessous). Avec la vague 1 (section 9), A29 est mise en œuvre pour les deux familles. Définition retenue : les décisions consignées dans `docs/QUESTIONS.md` A29 pour le bois (couches collées, épaisseur × 2 du tableau FCBA ; tracés droit, tournants et hélicoïdal ; marche entaillée et boulonnée ; torsion et porte-à-faux avec justification ; sabots métalliques ; visserie déduite) sont mises en œuvre sans écart d'instantané sur les exemples existants (instantanés et `examples/` existants inchangés, ajouts seulement), sans calcul métier dans l'interface ni valeur non sourcée en dur.

| Critère                                                                                                                                                                                                                                                                                                                                                                                                                            | Tests                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crémaillère centrale sur la trace partagée (droite, débillardée, hélicoïdale) : assise sous chaque marche portée, entaille arrière mesurée (0 avec contremarches pleines et à l'arrivée), reste sous entaille perpendiculaire à la sous-face, aucune pièce hors emprise, boulons placés sur chaque assise (propriétés fast-check)                                                                                                  | `packages/core/src/structures/woodCentralBeam.test.ts`                                                                                                                                        |
| Lamelles et k_r : couches droites sur un droit, t = ⌊r_in / 240⌋ sur une trace courbe, k_r = 1 / 0,76 + 0,001·r_in/t / refus sous 170 lus dans `LAMELLE_CINTRE_KR` (`laminationKr`) ; refus lisible (erreur « rayon de cintrage trop petit », aucune pièce de poutre ni de sabot, constat bloquant, aucune exception)                                                                                                              | `woodCentralBeam.test.ts`, `woodCentral.test.ts`, `packages/core/src/rules/table.test.ts`                                                                                                     |
| Sabots en U au pied et en tête : développés pliés (loi de pli du profil métal), logés sur la coupe au sol ou sur la hauteur de tête, chevillés et boulonnés au travers de la poutre                                                                                                                                                                                                                                                | `packages/core/src/structures/woodCentralBeam.test.ts` (sabots)                                                                                                                               |
| Contrôles : `CREMAILLERE_REGLE_MOYENS` (tableau FCBA à b / 2, non évaluée avec sa raison sur une trace courbe), `LIMON_EPAISSEUR_MIN_DTU`, `LIMON_ENTAILLE_MIN`, `LAMELLE_CINTRE_KR`, `LAMELLE_PLIS_MINCES` et `LIMON_CENTRAL_PORTE_A_FAUX` avec justification jointe ; contexte déduit `limon_central_bois` ; prédimensionnement en flexion × k_r ; massif refusé sur une trace courbe ; `buildModel` ne lève jamais (propriétés) | `woodCentral.test.ts`, `packages/core/src/structures/fcba.test.ts`, `rules/evaluators/regulatory.test.ts`, `rules/table.test.ts`, `rules/messages.test.ts`                                    |
| Visserie : marches boulonnées (`treadBeamBolted`) et sabots boulonnés (`shoeBolted`) à longueur déduite (`PartFixing.length`), sabots chevillés (`plateFloor`, `plateTrimmer`)                                                                                                                                                                                                                                                     | `packages/core/src/fasteners/compute.test.ts`, `woodCentral.test.ts` (visserie)                                                                                                               |
| Boulons de marche jusqu'au dessous réel de la poutre (bout au-dessus du sol ou de la semelle), aucun sous une sous-face trop basse pour l'écrou (marches au-dessus de la coupe au sol : constat `FAB_LIMON_CENTRAL_BOIS_BOULONS`), aucun perçage croisé avec les boulons des sabots (`bolts.minSpacing`), décalés d'une demi-couche hors du joint de colle central                                                                 | `woodCentralBeam.test.ts` (« boulons… », « boulons de marche écartés des boulons des sabots », propriété « assises sous chaque marche… »), `woodCentral.test.ts`                              |
| Développé de `LC1` avec les perçages des boulons de sabot (vrais trous, repère « Perçage Ø13 (sabot SP1) ») ; sabot droit sur une poutre cintrée signalé par `FAB_SABOT_EMPRISE` quand l'écart des joues dépasse le jeu (hélicoïdal), sans constat sur un départ droit                                                                                                                                                             | `woodCentralBeam.test.ts` (« développé non dégénéré… », « sabots droits sur la poutre cintrée… »)                                                                                             |
| Lamelles égales n = ⌈b / t⌉ d'épaisseur b / n (somme = b, épaisseur saisie = maximum) ; débit d'une lame par lamelle (`Part.stock.count`), liste et fiche de débit à une ligne par lame avec les totaux de la pièce, `FAB_DEBIT_DISPONIBLE` sur la même couche ; entaille arrière de chaque marche non finale au moins égale à la profondeur retenue (propriété) ; refus k_r sans « lamelles plus fines » quand 1 mm ne suffit pas | `woodCentralBeam.test.ts`, `packages/exports/src/csv/cutlist.test.ts`, `packages/exports/src/cutsheet.test.ts`                                                                                |
| Interface (relecture finale) : identifiants de pièces et critère « trace courbe » importés du cœur ; e2e de la carte « Limon central bois » du guidé (résumé « Limon central bois · Chêne ») et du comparateur sur l'hélicoïdal (variante appliquée sans erreur, `LC1`) ; morceau principal du build sous 1 200 ko (morceau `core`)                                                                                                | `apps/web/src/lib/partSettings.test.ts`, `paramTiers.test.ts`, e2e `wood-central-stringer.spec.ts`                                                                                            |
| Exemples `j5c-limon-central-bois-{droit,quart-tournant,helicoidal}` et démo `demo-central-glulam` couverts par tous les exports et l'instantané des cotes                                                                                                                                                                                                                                                                          | `woodCentral.acceptance.test.ts`, `packages/exports/src/examples.test.ts`, `packages/core/src/pipeline/build.test.ts`, `project/presetDemo.test.ts`                                           |
| Interface : carte « Limon central bois » (panneau Structure, guidé, comparateur), massif grisé avec sa raison sur une trace courbe, paramètres par niveaux avec ◆, réglages d'atelier dans l'inspecteur Pièce, justifications dans l'inspecteur Règle ; choix sur un droit et un quart tournant, pièces en Fabrication, refus lisible à petit rayon                                                                                | `apps/web/src/lib/structureForm.test.ts`, `paramTiers.test.ts`, `paramLabels.test.ts`, `variants.test.ts`, `ruleSteps.test.ts` ; e2e `wood-central-stringer.spec.ts`, `english-terms.spec.ts` |

Réserves :

- Points ouverts de la question A33 : classes GL non sourcées ; interprétation de l'entaille arrière et des boulons verticaux (source faible) ; poutre d'une seule pièce, sans raccord ; seuil des plis minces ; massif courbe et couches horizontales sans moule non pris en charge ; pas de platine à âme noyée ; reste sous entaille de repli sur une trace courbe (hors domaine FCBA) ; variante M3 quintique non appliquée.
- Points ouverts de la question A34 : fixation des marches au-dessus de la coupe au sol (sans boulon traversant, constat) ; entraxe des perçages non sourcé ; sabot droit sur une poutre cintrée (constat) ; décalage des boulons hors du joint de colle ; débit des plis minces.
- 3D d'une poutre cintrée sans entaille arrière (remarque) ; torsion et déversement non vérifiés (justification jointe).
- Toutes les dimensions du limon central bois, de ses boulons et de ses sabots restent « à valider » par un atelier.

## 11. Décisions de l'utilisateur du 2026-10-09 : suites du limon central (A32 (a), A33, A34)

**Intégré** (worktree `feat/limon-central-suites`, 2026-10-09, non committé ; vérifications ci-dessous, questions nouvelles en A35). Définition retenue : les décisions « à implémenter » de `docs/QUESTIONS.md` A32 (a), A33 (a) (e) (f) (i) et A34 (a) (b) (c) (e) sont mises en œuvre avec des valeurs sourcées en C §1.11 ou des paramètres « à valider », sans calcul métier dans l'interface ; les écarts d'instantanés des exemples du limon central (ancrage par défaut des exemples cintrés, couches empilées, tire-fonds des marches basses, positions des boulons de l'EC5, entailles sous contremarches pleines) sont voulus et justifiés.

| Critère                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Tests                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Caisson de `steel-central` : borne basse de l'entraxe des entretoises (défaut : hauteur de la section) ; en dessous, erreur lisible et entretoises d'extrémité et de joint seules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `packages/core/src/structures/centralBeam.test.ts`, `steelCentral.test.ts`                                                                                                                                         |
| Classes GL24h, GL28h, GL32h du prédimensionnement (valeurs de C §1.11 [71], γ_M du lamellé-collé), classe `auto` selon l'essence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `packages/core/src/precheck/settings.test.ts`                                                                                                                                                                      |
| Entraxes et pinces de l'EC5 : valeurs des tableaux à 0°, 90°, 180° et 270° pour boulons et broches, enveloppe « tous angles » majorant a1, a2, a3,t, a4,t et a4,c à tout angle (propriété), diamètre nominal lu sur le perçage (M10 dans 11 mm : a1 = 50 mm, a3,c = 40 mm), valeurs saisies conservées                                                                                                                                                                                                                                                                                                                                                                                                       | `packages/core/src/structures/woodSpacing.test.ts`                                                                                                                                                                 |
| Platine à âme noyée : pièces `PP1`, `AP1`, `PT1`, `AT1`, chevilles (`plateFloor`, `plateTrimmer`), broches (`embeddedPlatePinned`, longueur = b), âme soudée (`weld_mm`, `welded`), traits de scie et perçages des broches reportés sur la poutre ; constat `FAB_PLATINE_AME_NOYEE` par platine (platine réduite ou absente, âme sans place, chevilles sous la poutre, broches hors des pinces) ; propriétés : ne lève jamais, broches à l'entraxe a1 et dans l'âme, trait de scie dans le bois quand le constat est conforme                                                                                                                                                                                | `packages/core/src/structures/woodCentralPlates.test.ts`                                                                                                                                                           |
| Poutre et plugin : filière et ancrage par défaut selon la trace (`resolveCurvedMethod`, `resolveAnchorKind`), contremarches pleines avec entaille arrière derrière la contremarche, tire-fonds des marches basses (longueur bornée par la matière, perçages, visserie), boulons aux pinces de l'EC5, plis minces en placages                                                                                                                                                                                                                                                                                                                                                                                 | `woodCentralBeam.test.ts`, `woodCentral.test.ts`, `woodCentral.acceptance.test.ts`                                                                                                                                 |
| Couches empilées : une composante `LC1-<k>` par couche (gabarit, surcotes de délardement, débit), pièce finie sans débit propre, pas de contrôle k_r                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `woodCentralLayers.test.ts`                                                                                                                                                                                        |
| Relecture finale : contremarches pleines, marche entaillée prolongée sous la contremarche suivante et contremarche posée sur elle (pièces de base remplacées, dent derrière la contremarche, aucune interpénétration) ; platine à âme noyée jamais omise en silence (constat ok ⇒ platine et âme générées, propriété), trait de scie et broches dans le contour développé de la poutre (propriété de bout en bout sur droit, quart tournant et hélicoïdal) ; organes décalés autour d'un trait de scie ; couches non produites : poutre gardant matière et débit ; surface des couches = face développée ; placage seulement ≤ `thinPlyMax` ; prédimensionnement d'une poutre en couches empilées non évalué | `woodCentralBeam.test.ts`, `woodCentralPlates.test.ts`, `woodCentral.acceptance.test.ts`                                                                                                                           |
| Pièces fabriquées (`fabricatedParts`) : pièce finie faite de composantes retirée des comptes ; comparateur sans masse inconnue ni double compte sur une poutre en couches empilées, surfaces et masses comparables entre filières ; chiffre « Pièces » du projet sur les pièces fabriquées                                                                                                                                                                                                                                                                                                                                                                                                                   | `parts/components.test.ts`, `structures/compare.test.ts`                                                                                                                                                           |
| Exports : libellé « placage », composantes listées au débit à la place de la pièce finie, composantes absentes du glTF ; interface : nouveaux paramètres par niveaux avec ◆ et libellés, inspecteur Pièce ; e2e : platine à âme noyée sur l'hélicoïdal, tire-fonds des marches basses, couches empilées sur un quart tournant                                                                                                                                                                                                                                                                                                                                                                                | `packages/exports/src/csv/cutlist.test.ts`, `cutsheet.test.ts`, `gltf/glb.test.ts`, `apps/web/src/lib/paramTiers.test.ts`, `paramLabels.test.ts` ; e2e `wood-central-stringer.spec.ts`, `central-stringer.spec.ts` |

Réserves :

- Dimensions de la platine à âme noyée (épaisseurs, profondeur et longueur de l'âme, broches) tirées d'un pied de poteau du commerce (C §1.11 [80]) : à valider pour une poutre d'escalier ; aucune source sur l'épaisseur, l'orientation ni la surcote des couches empilées.
- Valeurs « tous angles » des entraxes et pinces de l'EC5 (direction de l'effort inconnue) : a3,c pris pour une extrémité non chargée (150° ≤ α < 210°), hors enveloppe, pour les boulons et tire-fonds de marche, alors que les broches de platine sont contrôlées à a3,t ; convention à trancher (QUESTIONS A35 (e)).
- Prédimensionnement d'une poutre en couches empilées non évalué (fil horizontal, QUESTIONS A35 (j)) ; marche M1 d'une poutre cintrée à un organe sur deux (aucun sur un escalier en U) à cause des broches de la platine de pied (QUESTIONS A35 (a)).
- Sur une poutre cintrée, l'âme reste plane (corde de la trace, décalée pour centrer sa flèche) ; une poutre étroite ou un petit rayon peut sortir le trait de scie de la pince a4,c (constat).

## Vérifications de la correction finale (suites du limon central)

Dans le worktree `feat-limon-central-suites`, le 2026-10-09, sans commit, après les corrections de la relecture (16 constats ; questions A35 (a), (b), (e), (i) complétées, (j), (k), (l) nouvelles).

- `pnpm typecheck` : vert (paquets, application web, tests e2e).
- `pnpm test` : vert en français et en anglais (`LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 LANGUAGE=en`), 272 fichiers (1 ignoré), 4 126 tests passés et 3 ignorés ; propriétés du limon central bois (poutre, platines, couches, EC5, comparateur) relancées trois fois sans échec.
- `pnpm format:check` : vert.
- `BASE_PATH=/blondel/ pnpm --filter @blondel/web build` : OK.
- e2e : 128 sur 128 verts (`--output` privé), sous le budget de 200 ms par tâche.
- Instantanés : seules 2 entrées de `pipeline/build.test.ts` changent, écart voulu : `j5c-limon-central-bois-quart-tournant` et `demo-central-glulam`, conseils 16 → 15 (`PRECHECK_FLECHE_CONSEIL` « non évalué » sur la poutre en couches empilées, A35 (j)) ; nombres de pièces et d'avertissements inchangés ; `examples/` régénérés (`UPDATE_EXAMPLES=1`) sans changement.

## Vérifications de l'intégration (suites du limon central)

Dans le worktree `feat-limon-central-suites`, le 2026-10-09, sans commit, après fusion des fragments de dictionnaires (`pnpm i18n:merge` : fragments `lcshared`, `lcbeam`, `lclayers`, `lcplates`, `lcmisc` ; `wip.ts` remis à vide) et suppression de 11 clés devenues orphelines (`structure.woodCentral.check.bolts.{blocked,missing,ok}`, `structure.woodCentral.note.glulamClass`, `ui.param.group.anchors`, `ui.param.woodCentral.anchors.{anchors,foot,grade,head,length}.label`, `ui.param.woodCentral.bolts.minSpacing.hint`).

- `pnpm typecheck` : vert (paquets, application web, tests e2e).
- `pnpm test` : vert en français et en anglais (`LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 LANGUAGE=en`), 271 fichiers (1 ignoré), 4 117 tests passés et 3 ignorés ; propriétés du limon central (bois et métal, couches, platines, EC5) relancées trois fois sans échec.
- `pnpm format:check` : vert.
- `BASE_PATH=/blondel/ pnpm --filter @blondel/web build` : OK.
- e2e : 128 sur 128 verts, sous le budget de 200 ms par tâche, dont les nouveaux cas de `wood-central-stringer.spec.ts` (platine à âme noyée sur l'hélicoïdal, tire-fonds des marches basses, couches empilées sur un quart tournant) et de `central-stringer.spec.ts` (A32 (a)).
- Instantanés : seules les 4 entrées du limon central bois de `pipeline/build.test.ts` changent, écarts voulus. Exemples cintrés (`j5c-limon-central-bois-quart-tournant`, `-helicoidal`, `demo-central-glulam`) : pièces 17 → 52, 18 → 54, 55 → 90 (couches `LC1-<k>` composantes et platines `PP1` / `AP1` / `PT1` / `AT1` au lieu des sabots), avertissements 5 → 3, 7 → 3, 5 → 3 (plus de `FAB_SABOT_EMPRISE` ni de marches sans fixation, nouveaux constats `FAB_PLATINE_AME_NOYEE` et `FAB_LIMON_CENTRAL_BOIS_BOULONS` sur M1, question A35 (a)) ; exemple droit : avertissements 4 → 3 (tire-fonds sur M1 et M2, nouveau `FAB_LIMON_CENTRAL_BOIS_PINCES`, question A35 (f)). `examples/` régénérés (`UPDATE_EXAMPLES=1`) sans changement (nouveaux défauts non sérialisés).
- Tests adaptés : glTF des exemples (composantes non dessinées), masse des pièces des exemples et des démos (pièce finie à composantes : masse portée par ses couches), démo `demo-central-glulam` (platines au lieu des sabots).

## Vérifications de la correction finale (limon central bois)

Dans le worktree `feat-limon-central-bois`, le 2026-10-07, sans commit, après les corrections de la relecture (17 constats ; question A34).

- `pnpm typecheck` : vert (paquets, application web, tests e2e).
- `pnpm test` : vert en français et en anglais (`LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 LANGUAGE=en`), 266 fichiers (1 ignoré), 4 024 tests passés et 3 ignorés ; propriétés du limon central (bois et métal) relancées trois fois sans échec (130 sur 130).
- `pnpm format:check` : vert.
- `BASE_PATH=/blondel/ pnpm --filter @blondel/web build` : OK, sans avertissement de taille (morceau principal 543 ko, morceau `core` 726 ko, limite 1 200 ko inchangée).
- e2e : 124 sur 124 verts, sous le budget de 200 ms par tâche, dont les deux nouveaux cas de `wood-central-stringer.spec.ts` (guidé, comparateur sur l'hélicoïdal).
- Instantanés : seules les 4 entrées nouvelles du limon central bois changent (avertissements en plus : marches 1 et 2 sans boulon traversant sur les 4 exemples, sabots droits sur la poutre cintrée de l'hélicoïdal) ; `examples/` régénérés (`UPDATE_EXAMPLES=1`) sans changement ; aucun exemple ni instantané existant modifié.

## Vérifications de l'intégration (limon central bois)

Dans le worktree `feat-limon-central-bois`, le 2026-10-07, sans commit, après fusion des fragments de dictionnaires (`pnpm i18n:merge` : 101 clés ajoutées par langue, aucune clé existante modifiée ni supprimée).

- `pnpm typecheck` : vert (paquets, application web, tests e2e).
- `pnpm test` : vert en français et en anglais (`LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 LANGUAGE=en`), 266 fichiers (1 ignoré), 4 018 tests passés et 3 ignorés ; propriétés du limon central (bois et métal) relancées trois fois sans échec.
- `pnpm format:check` : vert.
- `BASE_PATH=/blondel/ pnpm --filter @blondel/web build` : OK ; avertissement de taille du morceau principal (1 230 kB pour une limite de 1 200 kB), sans effet sur le déploiement.
- e2e : 122 sur 122 verts, sous le budget de 200 ms par tâche, dont `wood-central-stringer.spec.ts` (nouveau) et le parcours « préréglages et structures » de `long-tasks.spec.ts` avec `wood-central` (8 préréglages × 9 structures).
- Exemples : les 32 `examples/*.blondel.json` se lisent, se construisent et s'exportent ; 4 ajoutés (`j5c-limon-central-bois-{droit,quart-tournant,helicoidal}`, `demo-central-glulam`), aucun exemple ni instantané existant modifié. La démo est à marches ouvertes (sans contremarche) pour montrer l'entaille arrière (A33 (i)).

## Vérifications de l'intégration (limon central métal)

Dans le worktree `feat-limon-central`, le 2026-10-07, sans commit.

- `pnpm typecheck` : vert (paquets, application web, tests e2e).
- `pnpm test` : vert en français et en anglais (`LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 LANGUAGE=en`), 263 fichiers (1 ignoré), 3 805 tests passés et 3 ignorés.
- `pnpm format:check` : vert.
- `BASE_PATH=/blondel/ pnpm --filter @blondel/web build` : OK.
- e2e : 116 sur 116 verts, sous le budget de 200 ms par tâche, dont `central-stringer.spec.ts` (nouveau) et le parcours « préréglages et structures » de `long-tasks.spec.ts` avec `steel-central`.
- Exemples : les 28 `examples/*.blondel.json` se lisent, se construisent et s'exportent ; 4 ajoutés (`j5c-limon-central-*`, `demo-central-wreathed`), aucun exemple ni instantané existant modifié.

## Vérifications de la correction finale (limon central métal)

Dans le worktree `feat-limon-central`, le 2026-10-07, sans commit, après les corrections de la relecture (platines chevillées, consoles en biais, supports pliés d'équerre, semelle haute, sections incohérentes, entraxes, flasques du premier tronçon, perçages A31 alignés, libellés des développés, comparateur).

- `pnpm typecheck` : vert (paquets, application web, tests e2e).
- `pnpm test` : vert en français et en anglais (`LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 LANGUAGE=en`), 263 fichiers (1 ignoré), 3 822 tests passés et 3 ignorés ; propriétés du limon central, de `steel-flat` et de `steel-curved` relancées quatre fois (tirages différents) sans échec.
- `pnpm format:check` : vert. `BASE_PATH=/blondel/ pnpm --filter @blondel/web build` : OK.
- e2e : 117 sur 117 verts, sous le budget de 200 ms par tâche, dont le nouveau cas A31 de `fasteners.spec.ts`.
- Instantanés et `examples/` : aucun écart (l'instantané des cotes et les projets générés ne portent ni les consoles ni les perçages).

## Vérifications de l'intégration (vague F)

Depuis la racine, le 2026-09-30, sans commit :

- `pnpm install` : OK.
- `pnpm typecheck` : vert (paquets, application web, tests e2e).
- `pnpm test` : vert, 145 fichiers (1 ignoré), 1 692 tests passés et 3 ignorés, quatre fois de suite après correction de cinq propriétés instables (journal du ledger).
- `pnpm format:check` : vert.
- `BASE_PATH=/blondel/ pnpm --filter @blondel/web build` : OK.
- `pnpm e2e` : 22 sur 22 verts, sous le budget de 200 ms par tâche.
- Exemples : les 15 `examples/*.blondel.json` se lisent, se construisent sans erreur et s'exportent en SVG, DXF (plan et pièces), PDF, glTF, CSV et JSON (`packages/exports/src/examples.test.ts`). Dans l'application, l'import d'un exemple est couvert par `apps/web/e2e/project.spec.ts`.

## Vérifications de l'intégration (vague G)

Depuis la racine, le 2026-09-29, sans commit. Aucun critère ne change d'état ; le critère n° 3 précise la contremarche d'arrivée conservée en tôle pliée Z (ci-dessus).

- `pnpm install` : OK.
- `pnpm typecheck` : vert (paquets, application web, tests e2e).
- `pnpm test` : vert, 156 fichiers (1 ignoré), 1 823 tests passés et 3 ignorés, trois fois de suite (avec et sans `CI=1`) après correction de l'outil de test `landingPitchGap` (propriété instable de `woodHoused.test.ts`, journal du ledger).
- `pnpm format:check` : vert.
- `BASE_PATH=/blondel/ pnpm --filter @blondel/web build` : OK.
- `pnpm e2e` : 28 sur 28 verts, sous le budget de 200 ms par tâche, dont `typologies.spec.ts` (S / Z, curseurs M2 / M6) et les variantes de l'assistant (`assistant.spec.ts`) ; le parcours « préréglages et structures » de `long-tasks.spec.ts` inclut le préréglage S.
- Exemples : les 16 `examples/*.blondel.json` se lisent, se construisent sans erreur et s'exportent (`packages/exports/src/examples.test.ts`).

## Vérifications de l'intégration (vague I)

Depuis la racine, le 2026-09-29, sans commit. Aucun critère ne change d'état ; les réserves du critère n° 2 (assistant et `steel-curved`, saisie du barème) et le détail du critère n° 3 (contremarche d'arrivée en L) sont mis à jour ci-dessus.

- `pnpm install` : OK.
- `pnpm typecheck` : vert (paquets, application web, tests e2e).
- `pnpm test` : vert, 178 fichiers (1 ignoré), 2 209 tests passés et 3 ignorés.
- `pnpm format:check` : vert.
- `BASE_PATH=/blondel/ pnpm --filter @blondel/web build` : OK.
- `pnpm e2e` : 44 sur 44 verts, sous le budget de 200 ms par tâche, après correction de la fenêtre « Profil d'atelier » (contenu monté seulement ouverte : son `.notice` caché faisait échouer 5 specs par violation du mode strict).

## Vérifications de l'intégration (vague J)

Depuis la racine, le 2026-09-30, sans commit. Aucun critère ne change d'état ; la réserve du critère n° 5 (règles évaluées) et la preuve e2e du critère n° 1 (côtés des garde-corps en automatique) sont mises à jour ci-dessus.

- `pnpm install` : OK.
- `pnpm typecheck` : vert (paquets, application web, tests e2e).
- `pnpm test` : vert, 185 fichiers (1 ignoré), 2 322 tests passés et 3 ignorés, après correction d'une propriété instable de `site/survey.test.ts` (journal du ledger).
- `pnpm format:check` : vert.
- `BASE_PATH=/blondel/ pnpm --filter @blondel/web build` : OK.
- `pnpm e2e` : 46 sur 46 verts, sous le budget de 200 ms par tâche, dont `storage-quota.spec.ts` (nouveau) et les onglets mesurés avec `steel-flat`, `steel-profile` et `steel-curved`. Au premier passage complet, `demos.spec.ts` a dépassé le budget (209 puis 232 ms, deux démos hélicoïdales différentes, charge machine 7 à 9) ; relancé seul deux fois : vert.
- Exemples : les 24 `examples/*.blondel.json` se lisent, se construisent sans erreur et s'exportent (`packages/exports/src/examples.test.ts`) ; aucun exemple ni instantané modifié par la vague.

## Vérifications de l'intégration (internationalisation)

Dans le worktree `feat-i18n`, le 2026-09-30, sans commit. Nouveau critère n° 6 (atteint) ; les autres critères ne changent pas d'état.

- `pnpm typecheck` : vert (paquets, application web, tests e2e).
- `pnpm test` : vert, 201 fichiers (1 ignoré), 2 696 tests passés et 3 ignorés (après la revue de complétude).
- `pnpm format:check` : vert.
- `BASE_PATH=/blondel/ pnpm --filter @blondel/web build` : OK, sans avertissement de taille (dictionnaires dans leur propre morceau `i18n-locales`) ; vérifié avant la revue de complétude, qui n'a touché que core, `lib/exportFiles.ts` et les dictionnaires.
- `pnpm e2e` : 47 sur 47 verts, sous le budget de 200 ms par tâche, dont `i18n.spec.ts` (nouveau) ; même réserve.
- Exemples : `examples/*.blondel.json` et instantanés français inchangés octet par octet ; variantes anglaises testées à part (`packages/exports/src/i18n.test.ts`).
