# Blondel

Logiciel web de conception paramétrique d'escaliers : tracé (droit, quart tournant, U, demi-tournant, palier), balancement des marches, pièces de base, échappée, contrôle de conception indicatif (DTU 36.3, NF P01-012, ERP…) et exports (plan et élévation SVG, DXF, liste de débit CSV).

État : jalons 1 (cœur droit) et 2 (tournants) livrés, sans plugin de structure (J3). Les exports SVG, DXF et CSV existent dans `@blondel/exports` mais l'application ne propose encore que l'enregistrement du projet (`.blondel.json`).

> Le contrôle de conception est indicatif : il ne vaut pas attestation de conformité.

## Démarrage rapide

Prérequis : Node.js 22 ou plus et pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm dev          # application web sur http://localhost:5173
```

Des projets d'exemple sont dans `examples/*.blondel.json` (un par préréglage, plus le cas d'acceptation n° 1) ; ils s'ouvrent depuis la barre d'outils de l'application.

## Commandes

| Commande                            | Rôle                                                                  |
| ----------------------------------- | --------------------------------------------------------------------- |
| `pnpm dev`                          | Serveur de développement Vite (`apps/web`).                           |
| `pnpm build`                        | Vérification des types puis build de production de l'application web. |
| `pnpm test`                         | Tous les tests (vitest, dont propriétés fast-check).                  |
| `pnpm vitest run <chemin>`          | Tests d'un dossier ou d'un fichier.                                   |
| `pnpm typecheck`                    | `tsc` sur les paquets et sur l'application web.                       |
| `pnpm format` / `pnpm format:check` | Formatage Prettier / vérification.                                    |
| `pnpm rules:build`                  | Régénère `rules.data.json` depuis `docs/research/rules.yaml`.         |

Régénérer `examples/` : `UPDATE_EXAMPLES=1 pnpm vitest run packages/core/src/project/examples.test.ts`.

Variables de test utiles : `STEPPING_RUNS=1000` (tirages des propriétés du découpage), `PERF_STRICT=1` (seuil strict du test de performance du pipeline).

## Structure

```
packages/
  core/       contrats (model/), géométrie plane (geom2d/), tracé (layout/), découpage (stepping/),
              balancement (balancing/), pièces (parts/), échappée (headroom/), règles (rules/),
              projets et préréglages (project/), pipeline buildModel (pipeline/) — sans DOM
  geometry/   maillage 3D des pièces pour l'aperçu
  exports/    plan et élévation SVG, DXF R12 / AC1021, liste de débit CSV, projet JSON
apps/
  web/        interface React + Vite (store zustand, vues plan / 3D / élévation)
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

Voir [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) pour le pipeline et les points d'extension (règle, stratégie de balancement, structure).
