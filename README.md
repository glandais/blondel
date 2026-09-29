# Blondel

Logiciel web de conception paramétrique d'escaliers : tracé (droit, quart tournant, U, demi-tournant, palier), balancement des marches, pièces de base, structures bois (limons à la française avec poteau d'angle, crémaillères) et métal (limons en plat découpé laser, marches en tôle pliée Z / U, limons en profilés UPN / IPN / IPE / HEA), garde-corps et mains courantes, échappée, contrôle de conception indicatif (DTU 36.3, NF P01-012, garde-corps NF P01-012 régimes 1988 et 2024, ERP…), contrôles de fabrication, prédimensionnement indicatif et classe d'exécution EN 1090-2, comparateur de variantes de structure, exports (plan, élévation et développés SVG, DXF du plan et des pièces avec lignes de pli, liste de débit CSV, dossier PDF, projet JSON).

État : jalons 1 (cœur droit), 2 (tournants), 3a (structures bois), 3b (structures métal), 3c (profilés, prédimensionnement, comparateur) et 4 (garde-corps) livrés, à valider avec un atelier pilote : les valeurs du profil d'atelier et des plugins sont des hypothèses marquées « à valider » (voir `docs/LEDGER.md` §2). Les critères d'acceptation n° 1 (quart tournant bois avec poteau et garde-corps, PDF + DXF) et n° 3 (DXF de limon et de marche en tôle pliée) sont vérifiés de bout en bout par des tests. Débillardé, hélicoïdal et import de plan restent à faire.

> Le contrôle de conception est indicatif : il ne vaut pas attestation de conformité.

## Démarrage rapide

Prérequis : Node.js 22 ou plus et pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm dev          # application web sur http://localhost:5173
```

Des projets d'exemple sont dans `examples/*.blondel.json` ; ils s'ouvrent depuis la barre d'outils de l'application (« Importer… »). On y trouve un exemple par préréglage, le cas d'acceptation n° 1 et ses variantes :

| Exemple                              | Contenu                                                         |
| ------------------------------------ | --------------------------------------------------------------- |
| `acceptance-01-quart-tournant`       | quart tournant bas, poteau d'angle, sans structure              |
| `j3a-acceptance-01-bois`             | limons à la française (bois)                                    |
| `j3b-acceptance-01-acier-plat`       | limons en plat acier, marches bois                              |
| `j3b-acceptance-01-tole-pliee`       | limons en plat acier, marches en tôle pliée en Z (critère n° 3) |
| `j3c-acceptance-01-upn`              | limons en profilés UPN (section automatique)                    |
| `j4-acceptance-01-garde-corps`       | limons bois, garde-corps barreaudé côté vide (critère n° 1)     |
| `j4-demi-tournant-acier-garde-corps` | demi-tournant, deux poteaux, acier et tôle pliée, garde-corps   |

La structure se choisit dans le panneau des paramètres (section « Structure »), les garde-corps dans la section « Garde-corps » ; les développés des pièces s'affichent dans l'onglet « Développés », le comparateur de variantes dans l'onglet « Comparateur », et le menu « Exporter » produit tous les fichiers.

## Commandes

| Commande                            | Rôle                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                          | Serveur de développement Vite (`apps/web`).                                                                     |
| `pnpm build`                        | Vérification des types puis build de production de l'application web (`BASE_PATH=/blondel/` pour GitHub Pages). |
| `pnpm test`                         | Tous les tests (vitest, dont propriétés fast-check).                                                            |
| `pnpm vitest run <chemin>`          | Tests d'un dossier ou d'un fichier.                                                                             |
| `pnpm typecheck`                    | `tsc` sur les paquets et sur l'application web.                                                                 |
| `pnpm format` / `pnpm format:check` | Formatage Prettier / vérification.                                                                              |
| `pnpm rules:build`                  | Régénère `rules.data.json` depuis `docs/research/rules.yaml`.                                                   |

Régénérer `examples/` : `UPDATE_EXAMPLES=1 pnpm vitest run packages/core/src/project/examples.test.ts packages/core/src/guards/acceptance.test.ts`.

Variables de test utiles : `STEPPING_RUNS=1000` (tirages des propriétés du découpage), `PERF_STRICT=1` (seuil strict du test de performance du pipeline).

## Structure

```
packages/
  core/       contrats (model/), géométrie plane (geom2d/), tracé (layout/), découpage (stepping/),
              balancement (balancing/), pièces (parts/), échappée (headroom/), règles (rules/),
              projets et préréglages (project/), profil d'atelier bois et métal (workshop/), plugins
              de structure (structures/), catalogue de profilés (catalog/), prédimensionnement
              (precheck/), garde-corps (guards/), pipeline buildModel (pipeline/) — sans DOM
  geometry/   maillage 3D des pièces pour l'aperçu
  exports/    plan, élévation et développés SVG, DXF R12 / AC1021, CSV, ZIP, JSON ;
              dossier PDF par @blondel/exports/pdf
apps/
  web/        interface React + Vite (store zustand, calcul en Web Worker, vues plan / 3D /
              élévation / développés, nomenclature, formulaires de structure et de garde-corps,
              prédimensionnement, comparateur, menu d'export)
docs/
  SPEC.md             cahier des charges
  CHALLENGE.md        arbitrages de conception (font foi)
  ARCHITECTURE.md     paquets, pipeline, flux de données, points d'extension
  adr/                décisions d'architecture
  research/           recherche métier (règles, géométrie, structures) et rules.yaml
  LEDGER.md           avancement, points en suspens, journal
examples/             projets .blondel.json
scripts/              build-rules.mjs
```

Voir [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) pour le pipeline et les points d'extension (règle, stratégie de balancement, structure, garde-corps, profil d'atelier).
