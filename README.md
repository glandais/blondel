# Blondel

Logiciel web de conception paramétrique d'escaliers : tracé (droit, quart tournant, U, demi-tournant, palier), balancement des marches, pièces de base, structures bois (limons à la française avec poteau d'angle, crémaillères), échappée, contrôle de conception indicatif (DTU 36.3, NF P01-012, ERP…) et contrôles de fabrication, exports (plan, élévation et développés SVG, DXF du plan et des pièces, liste de débit CSV, dossier PDF, projet JSON).

État : jalons 1 (cœur droit), 2 (tournants) et 3a (structures bois) livrés, à valider avec un atelier pilote : les valeurs du profil d'atelier et des plugins sont des hypothèses marquées « à valider » (voir `docs/LEDGER.md` §2). Structures métal (3b), garde-corps, débillardé et import de plan restent à faire.

> Le contrôle de conception est indicatif : il ne vaut pas attestation de conformité.

## Démarrage rapide

Prérequis : Node.js 22 ou plus et pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm dev          # application web sur http://localhost:5173
```

Des projets d'exemple sont dans `examples/*.blondel.json` (un par préréglage, le cas d'acceptation n° 1, et sa variante en limons à la française `j3a-acceptance-01-bois`) ; ils s'ouvrent depuis la barre d'outils de l'application. La structure se choisit dans le panneau des paramètres (section « Structure ») ; les développés des pièces s'affichent dans l'onglet « Développés » et le menu « Exporter » produit tous les fichiers.

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
              projets et préréglages (project/), profil d'atelier (workshop/), plugins de structure
              (structures/), pipeline buildModel (pipeline/) — sans DOM
  geometry/   maillage 3D des pièces pour l'aperçu
  exports/    plan, élévation et développés SVG, DXF R12 / AC1021, CSV, ZIP, JSON ;
              dossier PDF par @blondel/exports/pdf
apps/
  web/        interface React + Vite (store zustand, vues plan / 3D / élévation / développés,
              nomenclature, formulaire de structure, menu d'export)
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

Voir [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) pour le pipeline et les points d'extension (règle, stratégie de balancement, structure, profil d'atelier).
