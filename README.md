# Blondel

Logiciel web de conception paramétrique d'escaliers, pour les menuisiers, les métalliers et les particuliers avertis.

**Application en ligne : <https://glandais.github.io/blondel/>** (tout le calcul se fait dans le navigateur ; le projet reste sur le poste, autosauvegardé localement).

## Fonctionnalités

- **Assistant d'initialisation** : à partir de la hauteur à monter, de la trémie (rectangulaire, relevée ou tracée) et des murs, propose les typologies compatibles, classées par score (Blondel, régularité, échappée), avec croquis, cotes et score détaillé ; diagnostic lisible quand rien ne passe.
- **Tracé** : droit, quart tournant, deux quarts (U), demi-tournant, quart tournant avec palier, hélicoïdal à fût ou à jour central ; jour vif, en arc ou à poteau.
- **Balancement** des marches (M0, M1, M3 et variante quintique pour les débillardés), contrôle du giron au collet ; **mode expert** dans le plan 2D : angle imposé d'un nez à la poignée ou au clavier, nez fixe, surcharges orphelines signalées.
- **Site** : niveaux, trémie rectangulaire ou polygonale, murs ; **import de plan** DXF (calque) ou image calibrée, accroches, tracé assisté de la trémie et des murs (à l'axe ou au nu), **relevé** 4 côtés + 2 diagonales avec contrôle de cohérence.
- **Structures** bois (limons à la française avec poteau d'angle, crémaillères) et métal (limons en plat découpé laser, marches en tôle pliée Z / U, limons en profilés UPN / IPN / IPE / HEA, limon de jour **débillardé soudé** en tronçons roulés, hélicoïdal à fût central avec marches en porte-à-faux) ; **garde-corps** et mains courantes (balustres, lisses, câbles, verre, tôle perforée, panneau plein).
- **Contrôle de conception** indicatif (DTU 36.3, NF P01-012, garde-corps régimes 1988 et 2024, ERP…), échappée (y compris sous le tour supérieur d'un hélicoïdal), contrôles de fabrication, prédimensionnement indicatif et classe d'exécution EN 1090-2, corrections proposées ; chaque règle renvoie à sa source dans `docs/research/`.
- **Comparateur de variantes** de structure sur la même épure : masse, pièces, pièces uniques, cordons, plis, EXC, coût si le barème d'atelier est renseigné.
- **Vues** : plan 2D coté, élévation, développés, nomenclature ; **3D** avec matériaux PBR (essences de bois avec fil orienté, acier brut / peint / galvanisé, inox brossé, verre, béton), vue éclatée, coupe, mesure, isolation d'une pièce, cotes 3D.
- **Exports** : SVG (plan, élévation, développés), DXF R12 / 2007 du plan et de chaque pièce (calques de découpe, pli, roulage, joints, repères), liste de débit CSV, **modèle 3D glTF** (`.glb`), **dossier PDF** (sommaire, plan, élévation, nomenclature, fiche de débit, fiche de pose, contrôle de conception, développés, gabarits 1:1 tuilés en A4 ou A3), ZIP, projet JSON ; annuler / rétablir, autosauvegarde.

État : jalons 1 à 5b, 6 (rendu et exports) et 7 (import de plan, version simple) livrés, ainsi que l'assistant et le mode expert ; tout est **à valider avec un atelier pilote** : les valeurs du profil d'atelier et des plugins sont des hypothèses marquées « à valider » (voir `docs/LEDGER.md` §2). Bilan des critères d'acceptation, avec leurs tests : [`docs/ACCEPTATION.md`](docs/ACCEPTATION.md). Restent notamment : débillardé bois ou lamellé-collé (V2), exports STEP et XLSX, lien partageable, obstacles (poteaux, fenêtres, portes), détection automatique de la trémie et des murs dans un plan importé.

> Le contrôle de conception est indicatif : il ne vaut pas attestation de conformité.

## Démarrage rapide

Prérequis : Node.js 22 ou plus et pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm dev          # application web sur http://localhost:5173
```

Des projets d'exemple sont dans `examples/*.blondel.json` ; ils s'ouvrent depuis le menu « Importer » de l'application. On y trouve un exemple par préréglage, le cas d'acceptation n° 1 et ses variantes :

| Exemple                              | Contenu                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `acceptance-01-quart-tournant`       | quart tournant bas, poteau d'angle, sans structure                          |
| `j3a-acceptance-01-bois`             | limons à la française (bois)                                                |
| `j3b-acceptance-01-acier-plat`       | limons en plat acier, marches bois                                          |
| `j3b-acceptance-01-tole-pliee`       | limons en plat acier, marches en tôle pliée en Z (critère n° 3)             |
| `j3c-acceptance-01-upn`              | limons en profilés UPN (section automatique)                                |
| `j4-acceptance-01-garde-corps`       | limons bois, garde-corps barreaudé côté vide (critère n° 1)                 |
| `j4-demi-tournant-acier-garde-corps` | demi-tournant, deux poteaux, acier et tôle pliée, garde-corps               |
| `j5a-helicoidal`                     | hélicoïdal à fût central, marches en porte-à-faux, main courante            |
| `j5b-debillarde-soude`               | quart tournant à jour en arc, limon de jour débillardé soudé (critère n° 2) |

Le type de tracé (volées ou hélicoïdal) se choisit en tête du panneau des paramètres, la structure dans la section « Structure », les garde-corps dans la section « Garde-corps ». Les erreurs de génération s'affichent au-dessus des vues avec, quand il y en a, des corrections proposées (annulables). Les développés des pièces s'affichent dans l'onglet « Développés » (avec le tableau des tronçons et joints d'un débillardé), le comparateur de variantes dans l'onglet « Comparateur » (raccord de jour adapté à chaque structure et signalé), et le menu « Exporter » produit tous les fichiers.

## Commandes

| Commande                            | Rôle                                                                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                          | Serveur de développement Vite (`apps/web`).                                                                                               |
| `pnpm build`                        | Vérification des types puis build de production de l'application web (`BASE_PATH=/blondel/` pour GitHub Pages).                           |
| `pnpm test`                         | Tous les tests (vitest, dont propriétés fast-check).                                                                                      |
| `pnpm vitest run <chemin>`          | Tests d'un dossier ou d'un fichier.                                                                                                       |
| `pnpm typecheck`                    | `tsc` sur les paquets, sur l'application web et sur ses tests e2e.                                                                        |
| `pnpm e2e`                          | Tests de bout en bout Playwright sur l'application construite (Chromium ; budget de tâches longues de 200 ms, `E2E_LONG_TASK_BUDGET_MS`). |
| `pnpm format` / `pnpm format:check` | Formatage Prettier / vérification.                                                                                                        |
| `pnpm rules:build`                  | Régénère `rules.data.json` depuis `docs/research/rules.yaml`.                                                                             |

Régénérer `examples/` : `UPDATE_EXAMPLES=1 pnpm vitest run packages/core/src/project/examples.test.ts packages/core/src/guards/acceptance.test.ts packages/core/src/structures/helicalExample.test.ts packages/core/src/structures/steelCurved.acceptance.test.ts`.

Variables de test utiles : `STEPPING_RUNS=1000` (tirages des propriétés du découpage), `PERF_STRICT=1` (seuil strict du test de performance du pipeline).

## Structure

```
packages/
  core/       contrats (model/), géométrie plane (geom2d/), tracé (layout/), découpage (stepping/),
              balancement (balancing/), pièces (parts/), échappée (headroom/), règles (rules/),
              projets et préréglages (project/), profil d'atelier bois et métal (workshop/), plugins
              de structure (structures/), catalogue de profilés (catalog/), prédimensionnement
              (precheck/), garde-corps (guards/), assistant (assistant/), site importé et relevé
              (site/), pipeline buildModel (pipeline/) — sans DOM
  geometry/   maillage 3D des pièces (aperçu, glTF), coordonnées de texture selon le fil
  exports/    plan, élévation et développés SVG, DXF R12 / AC1021, CSV, ZIP, JSON, glTF ;
              dossier PDF par @blondel/exports/pdf
apps/
  web/        interface React + Vite (store zustand, calcul en Web Worker, vues plan / 3D /
              élévation / développés, nomenclature, formulaires de tracé (volées, hélicoïdal), de
              structure et de garde-corps, assistant, mode expert, saisie du site, corrections
              proposées, prédimensionnement, comparateur, menus d'import et d'export) ;
              tests Playwright dans e2e/
docs/
  SPEC.md             cahier des charges
  CHALLENGE.md        arbitrages de conception (font foi)
  ARCHITECTURE.md     paquets, pipeline, flux de données, points d'extension
  adr/                décisions d'architecture
  research/           recherche métier (règles, géométrie, structures) et rules.yaml
  LEDGER.md           avancement, points en suspens, journal
  ACCEPTATION.md      critères d'acceptation : état et tests qui les prouvent
examples/             projets .blondel.json
scripts/              build-rules.mjs
```

Voir [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) pour le pipeline et les points d'extension (règle, stratégie de balancement, structure, garde-corps, profil d'atelier).
