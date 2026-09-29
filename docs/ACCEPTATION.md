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

« Atteint » veut dire vérifié automatiquement, pas validé par un atelier : les valeurs du profil d'atelier et des plugins restent des hypothèses « à valider » (`docs/LEDGER.md` §2). Les réserves de chaque critère sont listées plus bas.

## 1. Quart tournant bois conçu par l'assistant, conforme, exporté en PDF + DXF

**Atteint.** Définition retenue (CHALLENGE P1) : quart tournant bas, limons à la française avec poteau d'angle, H 2 700, trémie 2 800 × 900, E 800, `bois_dtu`, garde-corps barreaudé côté vide. « Conforme » = contrôle de conception sans violation bloquante (CHALLENGE P3). « 2 minutes » = nombre d'interactions mesuré par Playwright, plafonné à 20.

Preuves :

- `apps/web/e2e/assistant.spec.ts`, « critère n° 1 par l'assistant : quart tournant bois conforme, PDF et DXF ». Depuis une page vierge : assistant, trémie 2 800 × 900, structure visée « limons à la française », typologie « Quart tournant », E = 800, « Proposer », « Choisir », puis export du dossier PDF et du plan DXF 2007. Soit **12 interactions** (plafond 20) et une durée totale sous 120 s (assertion ; ≈ 4 s en exécution automatisée). Le test vérifie aussi : E = 800 sur la carte retenue, structure `wood-housed`, jour « poteau », **0 bloquant**, aucune erreur de génération, balustres et poteau dans la nomenclature, aucune tâche longue au-delà de 200 ms, et le choix annulable en une seule fois.
- `packages/core/src/assistant/propose.test.ts`, « cas d'acceptation n° 1 » : quart tournant sans bloquant proposé en tête ; escalier droit rejeté pour l'échappée (ou à marge nulle et classé après) ; limons à la française contenus dans la trémie avec poteau d'angle ; budget ≤ 2 s ; résultats déterministes.
- `packages/exports/src/acceptance-criteria.test.ts`, « critère d'acceptation n° 1 complet » (exemple `j4-acceptance-01-garde-corps`) : 0 bloquant, 4 limons, poteau, garde-corps (poteaux, balustres, mains courantes). DXF R12 de chaque pièce à plat relu à ±0,01 mm, mortaises sur leur calque, plan DXF AC1021 relu. Dossier PDF avec plan, élévation, nomenclature, contrôle et développés.
- `apps/web/e2e/acceptance.spec.ts` : même critère par le préréglage plutôt que par l'assistant (11 interactions).
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
- `apps/web/e2e/helical.spec.ts`, « comparateur : débillardé soudé à jour adapté, appliqué ; développés par tronçon et joints » : onglet Comparateur dans l'application construite.

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
  - aucun composant de `components/` ni de `views/` n'appelle ni n'importe une étape du pipeline du cœur (`buildModel`, `computeStepping`, `evaluateCompliance`, `proposeDesigns`, `compareEpure`, `precheckModel`, `meshParts`…). J'ai vérifié que le test échoue si on ajoute un appel à `buildModel` dans `StatusBar.tsx`.
- Architecture (ADR-0005, `docs/ARCHITECTURE.md`) :
  - le store ne contient que le `Project` ;
  - le `Model` est calculé dans un Web Worker (`apps/web/src/model/handler.ts`) ;
  - les SVG affichés sont ceux des exports ;
  - l'assistant et le comparateur tournent dans des workers dédiés ;
  - les formulaires de structure sont dérivés de `paramsSchema` et de `defaults(ctx)` du plugin (`lib/structureForm.ts`).
- Les fonctions pures de l'interface (`apps/web/src/lib/*.ts`) sont testées sous Node, par exemple `lib/expert.test.ts` : « angle appliqué par le cœur autour de P_k fixe ».

Réserves (écarts mineurs, hors composants, dans `apps/web/src/lib/`) :

- `lib/expert.ts` recalcule la perpendiculaire à la ligne de foulée pour la poignée du mode expert. Même convention que le cœur, vérifiée par une propriété, mais c'est une double implémentation.
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

- 88 règles sur 100 ont un évaluateur dans le moteur. Les 12 autres sortent `non-evaluee` ou sont remplacées par un contrôle de plugin : charges, contraste des nez, bande d'éveil, tolérances de trémie et d'étage, épaisseur de limon DTU, cintrage…
- Les contrôles de fabrication tirés du profil d'atelier sont traçables au profil, pas à une norme. C'est voulu : ce sont des capacités d'atelier à valider.

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
