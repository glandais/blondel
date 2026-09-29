# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Blondel est un logiciel web de conception paramétrique d'escaliers (bois, métal, mixte) : tracé, balancement, structures, garde-corps, développés de fabrication, contrôle de conception, exports. Tout tourne dans le navigateur. Le dépôt, la documentation, les commentaires et les libellés sont **en français** (accents corrects) ; les identifiants de code sont en anglais.

## Commandes

Monorepo pnpm 10 (Node ≥ 22). Les paquets sont consommés par leurs sources TypeScript : aucune étape de build entre paquets.

```sh
pnpm install
pnpm dev                          # Vite, apps/web
pnpm test                         # vitest (tous les *.test.ts de packages/*/src et apps/*/src)
pnpm vitest run <fichier|dossier> # un test ou un dossier ; -t "<nom>" pour un cas précis
pnpm vitest run <fichier> -u      # mettre à jour des instantanés (justifier l'écart)
pnpm typecheck                    # tsc : paquets, apps/web, apps/web/e2e
pnpm format:check                 # Prettier (pnpm format pour corriger)
BASE_PATH=/blondel/ pnpm --filter @blondel/web build   # build tel que déployé
pnpm e2e                          # Playwright (build + vite preview, Chromium)
pnpm rules:build                  # rules.yaml -> packages/core/src/rules/rules.data.json
```

- Avant un commit : `typecheck`, `test`, `format:check`, build web, et `e2e` si `apps/web` a changé. Vérifier l'absence d'échec, pas seulement la ligne de synthèse.
- E2E : budget de tâches longues de 200 ms (`E2E_LONG_TASK_BUDGET_MS`), sensible à la charge de la machine ; relancer un échec de budget avant de conclure à une régression. Options : `E2E_SKIP_BUILD=1`, `E2E_BASE_URL=<url>` (site déjà servi), `E2E_GPU=1`. D'autres projets lancent Playwright sur cette machine : utiliser `--output <dossier privé>` et ne jamais tuer de processus par motif (`pkill -f`).
- Variables de test : `UPDATE_EXAMPLES=1` (régénère `examples/`, voir README), `STEPPING_RUNS=1000`, `PERF_STRICT=1`.
- `examples/*.blondel.json` sont **générés** par `serializeProject` et comparés octet par octet : ne pas les éditer à la main ni les passer à Prettier (exclus dans `.prettierignore`).

## Architecture

Détail complet et points d'extension (règle, stratégie de balancement, structure, garde-corps, profil d'atelier) : `docs/ARCHITECTURE.md`. À retenir :

- `packages/core` (**sans DOM**) : contrats dans `src/model/` (`Project` zod, sorties `Model`, interfaces `BalancingStrategy` et `StructureKind`) et pipeline `buildModel(project)` (`src/pipeline/build.ts`) : `computeLayout` → `computeStepping` (+ `balancing/`) → pièces de base → plugin de structure → `computeGuards` → échappée → contrôle de conception (`rules/`). Assistant (`assistant/`) et site importé (`site/`) sont en amont.
- `packages/geometry` : `SolidDesc` → maillages (aperçu 3D, glTF). `packages/exports` : fonctions pures `Model → fichier` (SVG, DXF R12/AC1021, CSV, glTF, ZIP) ; le PDF est sur l'entrée séparée `@blondel/exports/pdf` (jsPDF, jamais réexporté par l'index).
- `apps/web` : React 19 + react-three-fiber + zustand. L'UI édite le `Project` et affiche le `Model` calculé dans un Web Worker ; les SVG affichés sont ceux des exports.

Invariants à respecter :

- **Aucun calcul métier dans l'UI** (vérifié par `apps/web/src/architecture.test.ts`).
- `buildModel` **ne lève jamais** : erreurs dans `Model.errors`, modèle partiel, règles non calculables en `non-evaluee`. Les plugins rendent `errors`, pas d'exception.
- Mémoïsation par identité d'objet : le `Project` est immuable ; le worker applique un partage structurel (`apps/web/src/model/structuralShare.ts`) pour que les caches servent.
- Unités : saisies en mm entiers, calcul en float64 (mm, radians), arrondi seulement à l'affichage et en sortie (ADR-0003).
- Règles : `docs/research/rules.yaml` est la source de vérité (seuils, sources, contextes) ; chaque règle a un évaluateur TS (`rules/evaluators/`) qui lit `min`/`max` dans la table. **Aucun seuil en dur**, aucune évaluation de la chaîne `formule`.
- Aucune valeur métier non sourcée en dur : paramètre de plugin ou du profil d'atelier (`workshop/`), marqué « à valider ».
- Évolutions de `ProjectSchema` rétrocompatibles (champs optionnels ; sinon migration dans `project/`).
- Tests : `*.test.ts` à côté du code, invariants en propriétés fast-check sur générateurs contraints ; chaque exemple est couvert par tous les exports et par un instantané des cotes (`pipeline/build.test.ts`).

## Documentation qui fait foi

- `docs/SPEC.md` et `docs/research/` : règles métier et vocabulaire. En cas de doute sur une règle, ne pas inventer : ajouter une question.
- `docs/CHALLENGE.md` et `docs/adr/` : décisions d'architecture et de conception (dont les arbitrages de l'utilisateur).
- `docs/QUESTIONS.md` : questions ouvertes consolidées et décisions validées par l'utilisateur.
- `docs/LEDGER.md` : avancement et journal ; on n'y fait que des **ajouts** de lignes.
- `docs/ACCEPTATION.md` : critères d'acceptation et tests qui les prouvent.

## Git et déploiement

- Branche de travail et branche par défaut : `develop` (dépôt GitHub `glandais/blondel`). Un push sur `develop` déploie GitHub Pages (https://glandais.github.io/blondel/, `.github/workflows/pages.yml`, types et tests d'abord). `ci.yml` vérifie les pull requests (types, tests, format, build, e2e). Dependabot est configuré.
- Quand plusieurs agents travaillent dans l'arbre, ne committer que ses propres fichiers (`git add <chemins>`, jamais `git add -A` ni `git stash`).
