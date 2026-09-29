# Architecture de Blondel

Vue d'ensemble courte. Les décisions détaillées sont dans `docs/adr/` (ADR 0001 à 0006) et les arbitrages de conception dans `docs/CHALLENGE.md`. Le métier fait foi dans `docs/SPEC.md` et `docs/research/`.

## Paquets

| Paquet              | Rôle                                                                                                                                                                                                                       | Dépend de             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `packages/core`     | Contrats (`model/`), géométrie plane, pipeline de calcul, moteur de règles, projets, profil d'atelier (`workshop/`), plugins de structure (`structures/`). **Aucun DOM.**                                                  | zod                   |
| `packages/geometry` | Maillage 3D des `SolidDesc` rendus par le cœur (extrusion, surface réglée, balayage) pour l'aperçu.                                                                                                                        | core, earcut          |
| `packages/exports`  | Fonctions pures `Model → fichier` : plan, élévation et développés SVG, DXF (R12 maison, AC1021 ; plan et pièces), liste de débit CSV, ZIP, JSON ; dossier PDF par le point d'entrée séparé `@blondel/exports/pdf` (jsPDF). | core, geometry, jspdf |
| `apps/web`          | Interface React + Vite : édition du projet et de sa structure, vues plan / 3D / élévation / développés, nomenclature, contrôle de conception, exports.                                                                     | core, geometry, exp.  |

Les paquets sont consommés **par leurs sources TypeScript** (`main: ./src/index.ts`) : pas d'étape de build entre paquets, Vite et vitest compilent directement.

## Pipeline (ADR-0002)

```
Project (JSON validé par zod, immuable)
  │  buildModel(project)                         packages/core/src/pipeline/build.ts
  ├─ computeLayout      → Layout                 layout/     C_i (jour), C_e (mur), Γ (ligne de foulée), emprise
  ├─ computeStepping    → Stepping               stepping/   hauteurs, nez sur Γ, zones et stratégies de balancement
  │                                              balancing/  M0, M1, M3 + post-traitement commun (Q, R, collets, K3/K5)
  ├─ buildBasicParts    → Part[]                 parts/      marches, contremarches, paliers
  ├─ plugin de structure → Part[] + contrôles    structures/ `stair.structure.kind` ≠ none : limons, poteaux, crémaillères…
  │                                              workshop/   profil d'atelier (débits, encastrement, seuils, masses volumiques)
  ├─ computeHeadroom    → échappée               headroom/   ligne de pente, échappée sur Γ et sur la largeur
  └─ evaluateCompliance → ComplianceReport       rules/      table rules.yaml + évaluateurs, fusionnés avec les contrôles du plugin
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
   ┌──────────┼──────────────┬──────────────────────┬──────────────────┬───────────────────────┐
 Plan 2D   Élévation      Vue 3D                Développés          Nomenclature        Contrôle de conception
 renderPlanSvg renderElevationSvg meshParts   renderFlatPatternSvg cutListRows        ComplianceReport + remarques
 (@blondel/exports, data-tread) (@blondel/geometry) (@blondel/exports)  (@blondel/exports)

 Structure : listStructures() (cœur) ─► StructureSection : formulaire générique dérivé de
             paramsSchema + defaults(ctx) ─► stair.structure.params
 Exporter  : ExportMenu ─► lib/exportFiles.ts ─► SVG, DXF (plan, pièces en ZIP), CSV, JSON ;
             PDF par await import("@blondel/exports/pdf") (morceau séparé)
```

- L'UI **ne fait aucun calcul métier** : elle lit le `Model`. Les SVG de l'écran sont ceux des exports (une seule implémentation de la cotation, ADR-0005).
- La sélection (marche, pièce, règle) passe par les attributs `data-tread` des SVG et par les identifiants de pièce `tread-N`.
- Les exports (SVG, DXF, CSV, ZIP, JSON, PDF) sont des fonctions pures du `Model` (et du `Project` pour la trémie). Le PDF n'est jamais réexporté par l'index principal de `@blondel/exports` (un test surveille les imports) pour que jsPDF reste hors du paquet principal.

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

Les plugins de structure implémentent `StructureKind` (`model/plugins.ts`) et vivent dans `packages/core/src/structures/`. Plugins intégrés (jalon 3a) : `wood-housed` (limons à la française, poteau d'angle, marches et contremarches encastrées) et `wood-cut` (crémaillères, escalier droit).

1. Écrire le plugin : `kind` unique (≠ `none`), `label`, `family`, schéma zod des paramètres (`paramsSchema`), `defaults(ctx)` et `build(ctx, params) → { parts, checks, notes, errors? }`. `ctx` porte le projet, le tracé, le découpage et les pièces de base (`baseParts`).
2. Pièces : un `SolidDesc` (maillé par `@blondel/geometry`), un débit `stock`, et pour la découpe un développé `flat` (contour 1:1, traits `mark` avec `feature: "mortise" | "tenon"`, fibre de référence `reference`) ; `exportPartDxf`, `renderFlatPatternSvg` et le PDF le consomment. Une pièce de même `id` qu'une pièce de base la **remplace** (ex. marche prolongée dans les limons).
3. Contrôles : un `RuleResult` dont `ruleId` est une règle de `rules.yaml` remplace le résultat « sans évaluateur » du moteur (`mergeStructureChecks`) ; les contrôles de fabrication propres (`FAB_RULES`, `structures/checks.ts`) s'ajoutent. Une configuration non prise en charge va dans `errors` (repris dans `Model.errors`, modèle partiel), jamais une exception.
4. Enregistrer le plugin avec `registerStructure` (`structures/index.ts` le fait au chargement pour les plugins intégrés). L'interface le propose aussitôt : `listStructures()` → formulaire générique dérivé de `paramsSchema` et `defaults(ctx)` (`apps/web/src/lib/structureForm.ts`).
5. Paramètres : le pipeline fusionne **en profondeur** `defaults(ctx)` et `structure.params` (paramètres partiels ou `{}` acceptés), puis valide par `paramsSchema` ; paramètres invalides → `StructureError` dans `Model.errors`.
6. Quantités : clés normalisées de `structures/quantities.ts` (`QUANTITY_VOLUME_M3`, `QUANTITY_MASS_KG`…) ; `normalizeWoodQuantities` est appliqué par le pipeline, y compris sur les pièces de base de repli.
7. Aucune valeur métier non sourcée en dur : paramètre du plugin ou du profil d'atelier, marqué « à valider », et point au ledger §2. Conventions : les plugins débillardés ont un `kind` qui commence par `debillard` (variante M3 quintique automatique).
8. Tests : `structures/*.test.ts` (propriétés fast-check sur les développés), `pipeline/structures.test.ts`, un exemple `examples/*.blondel.json` qui l'utilise (tous les exports de bout en bout le couvrent alors, `packages/exports/src/examples.test.ts`).

### le profil d'atelier

`packages/core/src/workshop/profile.ts` (CHALLENGE A8) décrit ce que l'atelier sait débiter et usiner, séparément du projet : épaisseurs, largeurs et sections de débit disponibles, longueur maximale de plateau, surcotes, profondeur d'encastrement, jeu d'assemblage, seuils de fabrication (joue, largeur perpendiculaire, bois entre encastrements, dépassement de rive) et masses volumiques.

- `DEFAULT_WORKSHOP_PROFILE` : toutes les valeurs sont des hypothèses **à valider** ; `WORKSHOP_PROVENANCE` indique pour chaque réglage s'il est sourcé.
- `Project.workshop` (facultatif, partiel) remplace champ par champ le profil par défaut : `resolveWorkshopProfile(project.workshop)`. Un projet sans profil est sérialisé à l'identique.
- Les plugins lisent le profil résolu (débit au plus petit disponible : `smallestAvailable`) ; le pipeline en dépend pour la mémoïsation de l'étape structure.

## Conventions de code

- TypeScript strict, imports relatifs avec suffixe `.js`, identifiants en anglais, commentaires et documentation en français.
- Tests vitest `*.test.ts` à côté du code ; invariants en propriétés fast-check sur générateurs **contraints**.
- Prettier (`.prettierrc.json`) ; `pnpm format:check` doit passer.
- Suivi du travail : `docs/LEDGER.md` (avancement, points en suspens, messages entre agents, journal).
