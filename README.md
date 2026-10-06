# Blondel

Logiciel web de conception paramétrique d'escaliers, pour les menuisiers, les métalliers et les particuliers avertis.

**Application en ligne : <https://glandais.github.io/blondel/>** (tout le calcul se fait dans le navigateur ; le projet reste sur le poste, autosauvegardé localement).

## Fonctionnalités

- **Deux parcours sur un même projet** (ADR-0009) : le **parcours guidé** mène en sept étapes (Site, Forme, Découpage, Marches, Structure, Garde-corps, Fabrication), avec les chiffres clés, une vue conseillée et le contrôle en pied ; le **parcours libre** donne accès direct aux huit sections (rail et panneau unique), à la vue centrale (plan, 3D, élévation) et à un inspecteur contextuel (marche, pièce, règle, ou projet sans sélection). Deux espaces : **Conception** et **Fabrication** (pièces par famille, développés, nomenclature, comparateur, valeurs ◆ à valider, dossier PDF, coût). Première visite et démos s'ouvrent en guidé, un projet importé en libre ; sous 760 px de large, le guidé est imposé.
- **Application installable, hors ligne** : Blondel s'installe depuis le navigateur (icône, fenêtre propre) et, une fois chargé, s'ouvre, calcule et exporte sans réseau ; une nouvelle version est proposée, jamais imposée (ADR-0008).
- **Français ou anglais** : l'interface démarre dans la langue du navigateur (anglais si elle commence par `en`, sinon français), un sélecteur du menu ⋯ de la barre du haut la change à tout moment sans relancer de calcul, et tous les exports (SVG, DXF, CSV, glTF, PDF) sortent dans la langue choisie : nombres, dates, séparateur CSV et calques DXF compris. Terminologie anglaise britannique, **à valider** ([`docs/research/glossaire-en.md`](docs/research/glossaire-en.md)).
- **Assistant d'initialisation** : à partir de la hauteur à monter, de la trémie (rectangulaire, relevée ou tracée) et des murs, propose les typologies compatibles, classées par score (Blondel, régularité, échappée et marge d'échappée), une carte par forme avec croquis, cotes et score détaillé, les autres variantes de la forme (sens, emmarchement, nombre de marches) repliées sous la carte ou toutes à plat sur demande ; diagnostic lisible quand rien ne passe.
- **Tracé** : droit, quart tournant, deux quarts (U), deux quarts opposés (S / Z, la ligne de foulée change de côté dans la volée intermédiaire), demi-tournant, quart tournant avec palier, hélicoïdal à fût ou à jour central ; jour vif, en arc ou à poteau.
- **Balancement** des marches (M0, M1, M3 et variante quintique pour les débillardés ; M2 herse avec curseur d'angle borné par le modèle, M6 rotation paramétrée avec curseurs de portée et de raideur), contrôle du giron au collet ; **ligne de nez** dans l'inspecteur Marche : angle imposé d'un nez, nez fixe, retouches orphelines signalées.
- **Site** : niveaux, trémie rectangulaire ou polygonale, murs ; **import de plan** DXF (calque) ou image calibrée, accroches, tracé assisté de la trémie et des murs (à l'axe ou au nu), **relevé** 4 côtés + 2 diagonales avec contrôle de cohérence.
- **Structures** bois (limons à la française avec poteau d'angle, crémaillères) et métal (limons en plat découpé laser, marches en tôle pliée Z / U, limons en profilés UPN / IPN / IPE / HEA, limon de jour **débillardé soudé** en tronçons roulés, hélicoïdal à fût central avec marches en porte-à-faux) ; **garde-corps** et mains courantes (balustres, lisses, câbles, verre, tôle perforée, panneau plein).
- **Contrôle de conception** indicatif (DTU 36.3, NF P01-012, garde-corps régimes 1988 et 2024, ERP…), échappée (y compris sous le tour supérieur d'un hélicoïdal), contrôles de fabrication, prédimensionnement indicatif et classe d'exécution EN 1090-2, corrections proposées ; chaque règle renvoie à sa source dans `docs/research/`.
- **Comparateur de variantes** de structure sur la même épure : masse, pièces, pièces uniques, cordons, plis, EXC, coût si le barème d'atelier est renseigné.
- **Vues** : plan 2D coté, élévation, développés, nomenclature ; **3D** avec matériaux PBR (essences de bois avec fil orienté, acier brut / peint / galvanisé, inox brossé, verre, béton), vue éclatée, coupe, mesure, isolation d'une pièce, cotes 3D.
- **Exports** : SVG (plan, élévation, développés), DXF R12 / 2007 du plan et de chaque pièce (calques de découpe, pli, roulage, joints, repères), liste de débit CSV (avec masses et mention « masse volumique à valider »), **modèle 3D glTF** (`.glb`), **dossier PDF** (sommaire, plan, élévation, nomenclature, fiche de débit, fiche de pose, contrôle de conception, développés, gabarits 1:1 tuilés en A4 ou A3), ZIP, projet JSON ; annuler / rétablir, autosauvegarde.

État : jalons 1 à 5b, 6 (rendu et exports) et 7 (import de plan, version simple) livrés, ainsi que l'assistant et la refonte de l'interface en deux parcours (ADR-0009) ; tout est **à valider avec un atelier pilote** : les valeurs du profil d'atelier et des plugins sont des hypothèses marquées « à valider ». Les questions ouvertes et les décisions appliquées par défaut en attente de confirmation (rehausse du garde-corps sur palier, main courante des deux côtés en ERP et BHC, poteau d'angle au-dessus de la main courante, masses affichées, débord de nez de 10 mm, chien de garde du calcul…) sont consolidées dans [`docs/QUESTIONS.md`](docs/QUESTIONS.md). Bilan des critères d'acceptation, avec leurs tests : [`docs/ACCEPTATION.md`](docs/ACCEPTATION.md). Restent notamment : débillardé bois ou lamellé-collé (V2), exports STEP et XLSX, lien partageable, obstacles (poteaux, fenêtres, portes), détection automatique de la trémie et des murs dans un plan importé.

> Le contrôle de conception est indicatif : il ne vaut pas attestation de conformité.

## Démarrage rapide

Prérequis : Node.js 22 ou plus et pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm dev          # application web sur http://localhost:5173
```

### Préréglages

Le sélecteur « Préréglage » du menu du projet (nom du projet, dans la barre du haut du parcours libre) présente deux groupes :

- **Basiques** : les huit tracés de départ (droit, quart tournant à gauche ou à droite, deux quarts en U ou en S, demi-tournant balancé, quart tournant avec palier, hélicoïdal à fût central), réglages par défaut, à compléter pas à pas (structure, garde-corps, matériaux) ;
- **Démo** : huit escaliers complets, prêts à montrer (structure, marches, garde-corps et teintes), ouverts dans le parcours guidé à l'étape 1, vue 3D cadrée de trois quarts, cotes principales et contrôles sur les pièces masqués (deux cases de la vue 3D, à cocher pour les revoir ; le contrôle de conception liste toujours les avertissements ; un préréglage de base ou un autre projet les rétablit). Chaque démo est décrite en une ligne sous le sélecteur :

| Démo                                    | Contenu                                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| Hélicoïdal acier, verre et inox         | fût acier noir, marches chêne rayonnantes, garde-corps verre et main courante inox           |
| Quart tournant débillardé soudé         | limon acier débillardé soudé autour d'un jour en arc, marches chêne, garde-corps verre       |
| Deux quarts en U, chêne massif          | limons à la française, poteaux d'angle et balustres, tout en chêne huilé                     |
| Demi-tournant industriel en tôle pliée  | limons en plat laser anthracite, marches en tôle pliée en Z gris clair, barreaudage graphite |
| Escalier droit loft sur UPN             | limons UPN noirs, marches massives de 80 mm en chêne foncé sans contremarche, verre fumé     |
| Quart tournant à palier, frêne et verre | limons à la française et poteau en frêne clair, palier d'angle, garde-corps verre            |
| Grand escalier d'ERP                    | emmarchement de 1 400 mm, mains courantes des deux côtés, contextes ERP neuf                 |
| Hélicoïdal à jour central               | marches portées par deux limons hélicoïdaux roulés autour d'un jour central                  |

Une démo reste un projet ordinaire : tout se modifie, et une seule entrée d'annulation la retire. Elle peut porter l'essence des marches (`stair.treads.material`, qui compte dans les masses et le débit) et des teintes d'affichage (`appearance` : couleur de la peinture, éventuellement distincte pour les marches et les garde-corps, ton du bois, teinte du verre), propres à la vue 3D : elles ne changent ni les pièces, ni les masses, ni les exports. Chaque démo existe aussi en fichier (`examples/demo-*.blondel.json`).

### Exemples

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
| `two-quarters-s`                     | deux quarts tournants de sens opposés (S / Z), sans structure               |

Le type de tracé (volées ou hélicoïdal) se choisit en tête du panneau des paramètres (pour deux tournants, « Enchaînement des tournants » passe du U au S / Z), la méthode de balancement et ses curseurs dans la section « Balancement », la structure dans la section « Structure », les garde-corps dans la section « Garde-corps ». Les erreurs de génération s'affichent au-dessus des vues avec, quand il y en a, des corrections proposées (annulables). Les développés des pièces s'affichent dans l'onglet « Développés » (avec le tableau des tronçons et joints d'un débillardé), le comparateur de variantes dans l'onglet « Comparateur » (raccord de jour adapté à chaque structure et signalé), et le menu « Exporter » produit tous les fichiers.

## Commandes

| Commande                            | Rôle                                                                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                          | Serveur de développement Vite (`apps/web`).                                                                                                    |
| `pnpm build`                        | Vérification des types puis build de production de l'application web (`BASE_PATH=/blondel/` pour GitHub Pages).                                |
| `pnpm test`                         | Tous les tests (vitest, dont propriétés fast-check).                                                                                           |
| `pnpm vitest run <chemin>`          | Tests d'un dossier ou d'un fichier.                                                                                                            |
| `pnpm typecheck`                    | `tsc` sur les paquets, sur l'application web et sur ses tests e2e.                                                                             |
| `pnpm e2e`                          | Tests de bout en bout Playwright sur l'application construite (Chromium ; budget de tâches longues de 200 ms, `E2E_LONG_TASK_BUDGET_MS`).      |
| `pnpm format` / `pnpm format:check` | Formatage Prettier / vérification.                                                                                                             |
| `pnpm rules:build`                  | Régénère `rules.data.json` depuis `docs/research/rules.yaml`.                                                                                  |
| `pnpm i18n:sort`                    | Trie les clés des dictionnaires `packages/i18n/src/locales/*.json`.                                                                            |
| `pnpm ux:captures`                  | Captures d'écran de l'interface (parcours guidé et libre, inspecteurs, Fabrication, sombre, 1 024 et 390 px) dans `docs/ux/captures-refonte/`. |
| `pnpm pwa:icons`                    | Régénère les icônes PNG de l'application installable depuis `apps/web/public/favicon.svg` (`rsvg-convert`, ADR-0008).                          |

Régénérer `examples/` : `UPDATE_EXAMPLES=1 pnpm vitest run packages/core/src/project/examples.test.ts packages/core/src/guards/acceptance.test.ts packages/core/src/structures/helicalExample.test.ts packages/core/src/structures/steelCurved.acceptance.test.ts`.

Variables de test utiles : `STEPPING_RUNS=1000` (tirages des propriétés du découpage), `PERF_STRICT=1` (seuil strict du test de performance du pipeline).

## Structure

```
packages/
  i18n/       messages neutres, dictionnaires fr.json / en.json, traducteur (nombres, dates,
              pluriels) — sans DOM ni dépendance
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
  web/        interface React + Vite (store zustand, calcul en Web Worker ; parcours guidé et
              parcours libre, sections, inspecteurs marche / pièce / règle / projet, espaces
              Conception et Fabrication, vues plan / 3D / élévation / développés, nomenclature,
              assistant, saisie du site, corrections proposées, prédimensionnement, comparateur,
              menus d'import et d'export) ; tests Playwright dans e2e/
docs/
  SPEC.md             cahier des charges
  CHALLENGE.md        arbitrages de conception (font foi)
  ARCHITECTURE.md     paquets, pipeline, flux de données, points d'extension
  adr/                décisions d'architecture
  research/           recherche métier (règles, géométrie, structures) et rules.yaml
  LEDGER.md           avancement, points en suspens, journal
  QUESTIONS.md        questions ouvertes consolidées, décisions appliquées par défaut à confirmer
  ACCEPTATION.md      critères d'acceptation : état et tests qui les prouvent
examples/             projets .blondel.json
scripts/              build-rules.mjs
```

Voir [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) pour le pipeline et les points d'extension (règle, stratégie de balancement, structure, garde-corps, profil d'atelier, langue).
