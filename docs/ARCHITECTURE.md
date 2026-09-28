# Architecture de Blondel

Vue d'ensemble courte. Les décisions détaillées sont dans `docs/adr/` (ADR 0001 à 0006) et les arbitrages de conception dans `docs/CHALLENGE.md`. Le métier fait foi dans `docs/SPEC.md` et `docs/research/`.

## Paquets

| Paquet              | Rôle                                                                                                           | Dépend de            |
| ------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------- |
| `packages/core`     | Contrats (`model/`), géométrie plane, pipeline de calcul, moteur de règles, projets. **Aucun DOM.**            | zod                  |
| `packages/geometry` | Maillage 3D des `SolidDesc` rendus par le cœur (extrusion, surface réglée, balayage) pour l'aperçu.            | core, earcut         |
| `packages/exports`  | Fonctions pures `Model → fichier` : plan et élévation SVG, DXF (R12 maison, AC1021), liste de débit CSV, JSON. | core, geometry       |
| `apps/web`          | Interface React + Vite : édition du projet, vues plan / 3D / élévation, contrôle de conception.                | core, geometry, exp. |

Les paquets sont consommés **par leurs sources TypeScript** (`main: ./src/index.ts`) : pas d'étape de build entre paquets, Vite et vitest compilent directement.

## Pipeline (ADR-0002)

```
Project (JSON validé par zod, immuable)
  │  buildModel(project)                         packages/core/src/pipeline/build.ts
  ├─ computeLayout      → Layout                 layout/     C_i (jour), C_e (mur), Γ (ligne de foulée), emprise
  ├─ computeStepping    → Stepping               stepping/   hauteurs, nez sur Γ, zones et stratégies de balancement
  │                                              balancing/  M0, M1, M3 + post-traitement commun (Q, R, collets, K3/K5)
  ├─ buildBasicParts    → Part[]                 parts/      marches, contremarches, paliers (plugins de structure : J3)
  ├─ computeHeadroom    → échappée               headroom/   ligne de pente, échappée sur Γ et sur la largeur
  └─ evaluateCompliance → ComplianceReport       rules/      table rules.yaml + évaluateurs par identifiant
  ▼
Model { layout, stepping, parts, compliance, headroom?, headroomWidth?, errors, notes? }
```

- `buildModel` **ne lève jamais** pour des paramètres impossibles : l'erreur de l'étape va dans `Model.errors`, les étapes suivantes reçoivent un résultat vide, et le contrôle de conception n'évalue que les règles encore calculables (`PARTIAL_MODEL_RULES`, les autres sortent `non-evaluee`).
- Mémoïsation par identité : même objet `Project` → même `Model` ; sinon chaque étape réutilise son dernier résultat si ses entrées sont les mêmes objets. Budget : environ 5 ms par modèle sur les exemples (ADR-0006).
- Unités : millimètres en float64, arrondi seulement à l'affichage et en sortie (ADR-0003).

## Flux de données dans l'application web

```
saisie ─► store zustand (projectStore) ─► Project canonique (ProjectSchema.parse)
              │  historique annuler/rétablir, autosauvegarde localStorage
              ▼
         useModel() ─► model/buildModel.ts ─► buildModel (cœur, mémoïsé)
              ▼
   ┌──────────┼───────────────────────┬──────────────────────────┐
 Plan 2D   Élévation               Vue 3D                   Contrôle de conception
 renderPlanSvg  renderElevationSvg  meshParts → BufferGeometry  ComplianceReport + remarques
 (@blondel/exports, data-tread)     (@blondel/geometry)
```

- L'UI **ne fait aucun calcul métier** : elle lit le `Model`. Les SVG de l'écran sont ceux des exports (une seule implémentation de la cotation, ADR-0005).
- La sélection (marche, pièce, règle) passe par les attributs `data-tread` des SVG et par les identifiants de pièce `tread-N`.
- Les exports (SVG, DXF, CSV, JSON) sont des fonctions pures du `Model` (et du `Project` pour la trémie).

## Où ajouter…

### une règle de conformité

1. Ajouter la règle dans `docs/research/rules.yaml` (source de vérité, avec sa source), puis `pnpm rules:build` (régénère `packages/core/src/rules/rules.data.json` ; un test vérifie la synchronisation).
2. Écrire son évaluateur dans `packages/core/src/rules/evaluators/<famille>.ts` : fonction `RuleEvaluator` enregistrée sous l'identifiant de la règle dans le groupe de la famille. **Aucun seuil en dur** : lire `min` / `max` de la règle (`rules/check.ts`), et isoler les constantes de formule dans `rules/formula-constants.ts`.
3. Si la règle reste calculable sur un modèle partiel, l'ajouter à `PARTIAL_MODEL_RULES` (`rules/evaluators/index.ts`).
4. Tests dans `rules/evaluators/*.test.ts`. Une règle sans évaluateur sort `non-evaluee` (`ruleCoverage()` la liste).

### une stratégie de balancement

1. Implémenter `BalancingStrategy` (`packages/core/src/model/plugins.ts`) dans `packages/core/src/balancing/<id>.ts` : rendre les abscisses σ des points de collet ou les angles φ des nez de la zone ; le post-traitement commun (`balancing/postprocess.ts`) calcule Q, R, collets et contrôles.
2. L'enregistrer dans `balancing/registry.ts` et l'ajouter à l'énumération `method` de `BalancingSchema` (`model/project.ts`, évolution rétrocompatible notée au ledger).
3. Tests : exemples de `docs/research/B-geometrie.md` §3 et propriétés fast-check (K3, K5, collets > 0, miroir gauche/droite).

### une structure (limons, crémaillère, tôle pliée…)

1. Implémenter `StructureKind` (`model/plugins.ts`) : schéma zod des paramètres, valeurs par défaut, `build(ctx, params) → { parts, checks, notes }`. Les pièces portent un `SolidDesc` (maillé par `@blondel/geometry`) et, pour la découpe, un développé `flat` (exporté par `exportPartDxf`).
2. Le brancher dans `pipeline/build.ts` (aujourd'hui : message « aucun plugin de structure disponible » quand `structure.kind ≠ "none"`), à la place ou en complément de `parts/basic.ts`.
3. Convention : les plugins débillardés ont un `kind` qui commence par `debillard` (variante M3 quintique automatique).
4. Les quantités de pièce utilisent les clés `QUANTITY_VOLUME` / `QUANTITY_SURFACE` exportées par le cœur.

## Conventions de code

- TypeScript strict, imports relatifs avec suffixe `.js`, identifiants en anglais, commentaires et documentation en français.
- Tests vitest `*.test.ts` à côté du code ; invariants en propriétés fast-check sur générateurs **contraints**.
- Prettier (`.prettierrc.json`) ; `pnpm format:check` doit passer.
- Suivi du travail : `docs/LEDGER.md` (avancement, points en suspens, messages entre agents, journal).
