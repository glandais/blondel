# Architecture de Blondel

Vue d'ensemble courte. Les décisions détaillées sont dans `docs/adr/` (ADR 0001 à 0006) et les arbitrages de conception dans `docs/CHALLENGE.md`. Le métier fait foi dans `docs/SPEC.md` et `docs/research/`.

## Paquets

| Paquet              | Rôle                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Dépend de                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `packages/core`     | Contrats (`model/`), géométrie plane, pipeline de calcul, moteur de règles, projets, profil d'atelier bois et métal (`workshop/`), plugins de structure (`structures/`), catalogue de profilés (`catalog/`), prédimensionnement indicatif (`precheck/`), garde-corps et mains courantes (`guards/`), assistant d'initialisation (`assistant/`), site importé (`site/` : calque DXF par `@blondel/core/dxf`, image calibrée, accroches, trémie polygonale, relevé). **Aucun DOM.** | zod, dxf-parser                                  |
| `packages/geometry` | Maillage 3D des `SolidDesc` rendus par le cœur (extrusion, surface réglée, balayage) pour l'aperçu et le glTF ; coordonnées de texture selon le fil (`grainUVMesh`, projection par triangle).                                                                                                                                                                                                                                                                                     | core, earcut                                     |
| `packages/exports`  | Fonctions pures `Model → fichier` : plan, élévation et développés SVG, DXF (R12 maison, AC1021 ; plan et pièces), liste de débit CSV, ZIP, JSON, glTF binaire (`gltf/glb.ts`, sans dépendance) ; dossier PDF (sommaire, fiche de pose, fiche de débit, gabarits 1:1 tuilés) par le point d'entrée séparé `@blondel/exports/pdf` (jsPDF).                                                                                                                                          | core, geometry, jspdf, @tarikjabiri/dxf (AC1021) |
| `apps/web`          | Interface React + Vite : édition du projet, de sa structure et de ses garde-corps, vues plan / 3D / élévation / développés, nomenclature, contrôle de conception, prédimensionnement, comparateur de variantes, assistant d'initialisation, mode expert, saisie du site (calque, trémie, murs, relevé), exports ; calcul dans des Web Workers.                                                                                                                                    | core, geometry, exp.                             |

Les paquets sont consommés **par leurs sources TypeScript** (`main: ./src/index.ts`) : pas d'étape de build entre paquets, Vite et vitest compilent directement.

## Pipeline (ADR-0002)

```
Project (JSON validé par zod, immuable)
  │  buildModel(project)                         packages/core/src/pipeline/build.ts
  ├─ computeLayout      → Layout                 layout/     `inner` (C_i : jour du **premier** tournant), `outer` (C_e),
  │                                                          Γ (ligne de foulée), emprise ; S / Z : le jour d'un tournant
  │                                                          de sens opposé est sur `outer` (`TurnZone.collarSide`),
  │                                                          transitions de Γ (`walklineTransitions`) ; escalier droit :
  │                                                          bord de mesure de Γ (`walklineSide`, layout/walklineSide.ts ;
  │                                                          automatique : lit murs et garde-corps, clé de cache
  │                                                          `autoWalklineSideKey`) ;
  │                                                          hélicoïdal (`kind: "helical"`) : layout/helical.ts
  ├─ computeStepping    → Stepping               stepping/   hauteurs, nez sur Γ, zones et stratégies de balancement ;
  │                                                          hélicoïdal : nez rayonnants, stepping/helical.ts ;
  │                                                          côté du jour par tournant : stepping/sides.ts (vue
  │                                                          retournée `flipLayout` quand le jour est sur `outer`)
  │                                              balancing/  M0, M1, M2 (herse), M3, M6 (rotation paramétrée)
  │                                                          + post-traitement commun (Q, R, collets, K3/K5)
  ├─ buildBasicParts    → Part[]                 parts/      marches, contremarches, paliers
  ├─ plugin de structure → Part[] + contrôles    structures/ `stair.structure.kind` ≠ none : limons, poteaux, crémaillères,
  │                        + executionClass?                 supports, platines, marches en tôle pliée…
  │                        + precheck?           precheck/   prédimensionnement indicatif des limons : celui du plugin
  │                                                          (`StructureOutput.precheck`), sinon `precheckStringers`
  │                        + removedBaseParts?   workshop/   profil d'atelier (débits, encastrement, seuils, masses
  │                                                          volumiques ; métal : presse, lois de pli, formats de tôle)
  ├─ computeGuards      → Part[] + contrôles     guards/     `project.guards` : garde-corps de volée / jour / trémie,
  │                                                          mains courantes, contrôles GC_* / MC_*, GC_CONFLIT_DALLE
  │                                                          et GC_POTEAUX_JOUR (collision des poteaux de jour)
  ├─ computeHeadroom    → échappée               headroom/   ligne de pente, échappée sur Γ et sur la largeur ;
  │                                                          sous-faces de l'escalier lui-même (selfcover.ts) et
  │                                                          règle dérivée sous le tour supérieur (helical.ts)
  └─ evaluateCompliance → ComplianceReport       rules/      table rules.yaml + évaluateurs, fusionnés avec les contrôles
                                                             du plugin et des garde-corps
  ▼
Model { layout, stepping, parts, compliance, headroom?, headroomWidth?, headroomUnlimited?,
        executionClass?, precheck?, errors, notes? }
```

En amont du pipeline :

- **Assistant d'initialisation** (`assistant/`, `proposeDesigns(input)`, CHALLENGE G8) : bornes lues dans les règles actives (`bounds.ts`), énumération explicite typologie × sens × jour (vif, poteau, ou en arc pour les tournants balancés si la structure visée l'accepte : aucune, ou débillardé qui l'exige — rayon roulable du profil d'atelier, décision A17) × position du tournant × n × E × calage de l'arrivée sur la trémie (`shapes.ts`, `placement.ts`), crible analytique (giron, échappée sur Γ, murs, dégagement d'arrivée), puis `buildModel` sur les meilleurs candidats par groupe à tour de rôle, élimination des bloquants, score détaillé (`score.ts`) et diagnostic par typologie. Budget de temps global (`stats.truncated` si dépassé) ; entrées invalides → liste vide et diagnostic, jamais d'exception.
- **Site importé** (`site/`, jalon 7) : `site.underlay` facultatif (calque DXF lu par `@blondel/core/dxf`, ou image calibrée par deux points et une distance), accroches (`snap.ts`), trémie polygonale validée (`opening.ts`), relevé 4 côtés + 2 diagonales avec seuil de détection par mesure (`survey.ts`), modifications pures du site (`edit.ts` : murs tracés à l'axe ou au nu). Le pipeline ne lit pas le calque : il ne sert qu'à la saisie.

- `buildModel` **ne lève jamais** pour des paramètres impossibles : l'erreur de l'étape va dans `Model.errors`, les étapes suivantes reçoivent un résultat vide, et le contrôle de conception n'évalue que les règles encore calculables (`PARTIAL_MODEL_RULES`, les autres sortent `non-evaluee`).
- Mémoïsation par identité : même objet `Project` → même `Model` ; sinon chaque étape réutilise son dernier résultat si ses entrées sont les mêmes objets. Les clés sont fines : le découpage ne dépend de la structure que par `structure.kind`, si bien que changer un paramètre de structure ne recalcule ni le découpage ni les garde-corps, et changer les garde-corps ne recalcule pas la structure (`pipeline/integration.test.ts`). Budget : environ 5 ms par modèle sur les exemples (ADR-0006).
- Structure → modèle : une pièce du plugin de même `id` qu'une pièce de base la remplace ; `StructureOutput.removedBaseParts` retire des pièces de base (contremarches bois sous des marches en tôle pliée ou en tôle de `helical-core`, décision A11) ; `StructureOutput.executionClass` (EN 1090-2, métal) est reporté dans `Model.executionClass` (lecture : `executionClassOf(model)`, fonction unique du cœur) ; `StructureOutput.precheck` (prédimensionnement fait par le plugin, ex. `steel-profile` qui choisit sa section avec) est reporté dans `Model.precheck`, sinon le pipeline le calcule par `precheckStringers` : le panneau, le comparateur et les lignes PRECHECK_* du contrôle de conception ont une seule source.
- Tracé hélicoïdal (jalon 5a) : `LayoutSpec` est une union discriminée rétrocompatible (`kind` absent = volées, jamais sérialisé ; `kind: "helical"` = sens, R_e, fût ou jour central, marches par tour ou angle total, palier d'arrivée en secteur). `Layout.helical` est renseigné et les volées sont vides : le découpage, l'échappée et les plugins testent `layout.helical`. Un plugin réservé aux volées doit rendre une erreur lisible sur un hélicoïdal.
- Unités : millimètres en float64, arrondi seulement à l'affichage et en sortie (ADR-0003).

## Flux de données dans l'application web

```
saisie ─► store zustand (projectStore) ─► Project canonique (ProjectSchema.parse)
              │  historique annuler/rétablir, autosauvegarde localStorage
              ▼
         appStore ─► modelService (store/modelStore.ts) ─► latestRunner (dernière demande seulement)
              │         ─► workerClient ─► Web Worker model/model.worker.ts (handler.ts) :
              │            partage structurel du projet reçu (structuralShare.ts) puis
              │            buildModel (cœur, mémoïsé) + meshParts ; comparateur : second worker
              │            (compareEpure) ; toute erreur, même d'envoi, rend une réponse « error »
              │            (handleWorkerRequest) ; repli sur le fil principal sans worker
              ▼  ModelView { model, project d'origine, pending }
   ┌──────────┼──────────────┬──────────────────────┬──────────────────┬───────────────────────┐
 Plan 2D   Élévation      Vue 3D                Développés          Nomenclature        Contrôle de conception
 renderPlanSvg renderElevationSvg meshParts   renderFlatPatternSvg cutListRows        ComplianceReport + remarques
 (@blondel/exports, data-tread) (@blondel/geometry) (@blondel/exports)  (@blondel/exports)

 Structure : listStructures() (cœur) ─► StructureSection : formulaire générique dérivé de
             paramsSchema + defaults(ctx), libellés lib/paramLabels.ts ─► stair.structure.params
 Garde-corps : GuardsSection (lib/guardsForm.ts) ─► project.guards ; marqueurs 3D (lib/markers.ts,
             filtrés par famille de règles : ruleFamily du cœur, rules/family.ts)
 Prédim.   : PrecheckPanel (lib/precheck.ts, mise en forme seule) ─► Model.precheck (calculé dans
             le worker), executionClassOf (cœur)
 Tracé     : sélecteur « Type de tracé » (lib/layoutKind.ts switchLayoutKind, préréglage du cœur),
             éditeur de volées ou HelicalEditor ; bord de mesure de Γ d'un escalier droit et
             « Recaler volées et trémie » (lib/realign.ts ─► realignFlightsAndOpening, cœur,
             project/realign.ts : une entrée d'historique, bandeau d'information)
 Contrôle  : CompliancePanel ─► surcharges de règles (withRuleOverride, cœur, project/overrides.ts :
             justification obligatoire) ─► compliance.overrides, reprises dans le dossier PDF
 Erreurs   : ErrorsBar ─► suggestFixes (cœur, project/fixes.ts) ─► lib/fixes.ts applyFix (annulable)
 Comparateur : CompareView (lib/variants.ts) ─► compareEpure (cœur, worker dédié) : même épure,
             raccord de jour adapté par variante et signalé ; « Appliquer » reprend l'adaptation ;
             barème d'atelier hors projet (WorkshopDialog, store/workshopStore.ts, stockage du
             navigateur) fusionné dans une copie du projet comparé (lib/workshopRates.ts)
 Développés : tronçons et joints d'un débillardé (lib/joints.ts)
 Exporter  : ExportMenu ─► lib/exportFiles.ts ─► SVG, DXF (plan, pièces en ZIP), CSV, JSON ;
             glTF (.glb) et PDF (dossier complet A4 / A3, gabarits d'une famille, sans gabarits,
             fiche de pose) calculés dans le worker ;
             @blondel/exports/pdf chargé à la demande (morceau séparé)
 Assistant : AssistantDialog (lib/assistant.ts) ─► proposeDesigns (cœur) dans un worker dédié
             annulable (model/assistant.worker.ts, assistantClient.ts) ─► cartes (croquis, cotes,
             score) ─► « Choisir » : une entrée d'historique
 Expert    : PlanExpertEditor (lib/expert.ts) ─► stair.nosingOverrides (angle imposé, nez fixe),
             orphelines listées ; le cœur applique les surcharges et rend ses remarques
 Site      : Plan 2D › « Site et saisie » : PlanSiteEditor (calque, trémie, murs, calibration,
             accroches du cœur), PlanSurveyForm (relevé), UnderlayImport / ImportMenu (DXF, image)
```

- Le calcul tourne hors du fil principal (ADR-0006) : pendant un calcul, le dernier modèle publié reste affiché avec le projet dont il est issu (`pending`), et les exports sont désactivés tant que le modèle ne correspond pas au projet courant. `postMessage` clone le projet : sans le partage structurel (`apps/web/src/model/structuralShare.ts`), les caches par identité de `buildModel` ne serviraient jamais dans le worker.
- L'UI **ne fait aucun calcul métier** : elle lit le `Model`. Les SVG de l'écran sont ceux des exports (une seule implémentation de la cotation, ADR-0005).
- La sélection (marche, pièce, règle) passe par les attributs `data-tread` des SVG et par les identifiants de pièce `tread-N`.
- Vue 3D : matériaux PBR (`three/pbr.ts`, `MeshPhysicalMaterial` : verre en transmission, vernis, inox anisotrope) et textures procédurales périodiques générées par tranches (`three/proceduralTextures.ts`, `textures.ts`), UV selon le fil (`grainUVMesh`) ; outils vue éclatée (`three/explode.ts`), coupe (`three/section.ts`), mesure et cotes 3D (`three/annotations.ts`, surimpression `views/Viewer3DOverlay.tsx`), isolation. Shaders compilés avant la première image (`three/shaderWarmup.ts`, interrompu si le contexte WebGL est perdu), qualité réduite en rendu logiciel (`three/quality.ts`).
- Les exports (SVG, DXF, CSV, ZIP, JSON, PDF) sont des fonctions pures du `Model` (et du `Project` pour la trémie). Le PDF n'est jamais réexporté par l'index principal de `@blondel/exports` (un test surveille les imports) pour que jsPDF reste hors du paquet principal.

## Où ajouter…

### une règle de conformité

1. Ajouter la règle dans `docs/research/rules.yaml` (source de vérité, avec sa source), puis `pnpm rules:build` (régénère `packages/core/src/rules/rules.data.json` ; un test vérifie la synchronisation).
2. Écrire son évaluateur dans `packages/core/src/rules/evaluators/<famille>.ts` : fonction `RuleEvaluator` enregistrée sous l'identifiant de la règle dans le groupe de la famille. **Aucun seuil en dur** : lire `min` / `max` de la règle (`rules/check.ts`), et isoler les constantes de formule dans `rules/formula-constants.ts`.
3. Si la règle reste calculable sur un modèle partiel, l'ajouter à `PARTIAL_MODEL_RULES` (`rules/evaluators/index.ts`).
4. Tests dans `rules/evaluators/*.test.ts`. Une règle sans évaluateur sort `non-evaluee` (`ruleCoverage()` la liste).
5. Applicabilité : `contexte` (contextes de forme `tournant`, `helicoidal`, `helicoidal_fut` qualifiant les autres, `rules/contexts.ts`) et, au besoin, `contexte_exclu` (contextes qui écartent la règle, ex. `G_COLLET_MIN` sur un hélicoïdal à fût, contexte déduit `helicoidal_fut`). Un contexte seulement déduit s'ajoute à `DEDUCED_ONLY_CONTEXTS` (non proposé dans l'interface).
6. Un constat peut porter une sévérité **plus faible** que celle de la règle (`Finding.severity` et `severityReason`, repris dans `downgradeReason`) ; le profil et les surcharges s'appliquent ensuite (ex. `GC_OBLIGATOIRE` en conseil au droit d'un jour plus étroit que la sphère T1).
7. Un constat levé par une justification saisie par l'utilisateur (paramètre de plugin, ex. `helical-core.cantileverJustification` pour `HELICOIDAL_PORTE_A_FAUX`, décision A12) la porte dans `Finding.justification`, reprise dans `RuleResult.justification` et imprimée dans le dossier PDF (« Justification fournie : … »). Un plugin peut aussi réappliquer un évaluateur de `rules.yaml` à un projet effectif (ex. `helical-core` : règles de `nosing.ts` sans contremarche, à l'épaisseur de la tôle) : son résultat remplace celui du moteur.

### une stratégie de balancement

1. Implémenter `BalancingStrategy` (`packages/core/src/model/plugins.ts`) dans `packages/core/src/balancing/<id>.ts` : rendre les abscisses σ des points de collet ou les angles φ des nez de la zone ; le post-traitement commun (`balancing/postprocess.ts`) calcule Q, R, collets et contrôles.
2. L'ajouter à l'énumération `method` de `BalancingSchema` (`model/project.ts`, évolution rétrocompatible notée au ledger) : c'est la **liste unique** des identifiants (`BalancingMethod`), dont dérivent `BalancingStrategy.id` et `BalancingMethodId` ; puis l'enregistrer dans `balancing/registry.ts` (le typage exige une stratégie par méthode).
3. Interface : le sélecteur « Méthode » de `apps/web/src/components/ParamsPanel.tsx` propose **toutes** les méthodes du schéma (`balancingMethodOptions`, `apps/web/src/lib/balancingForm.ts`) ; ajouter le libellé dans `BALANCING_METHOD_LABELS` et, si la méthode a des paramètres, leurs curseurs (`RangeField`, bornes lues dans le schéma et le modèle, comme α de M2 borné par `herseAlphaMax` et λ / p de M6).
4. Tests : exemples de `docs/research/B-geometrie.md` §3 et propriétés fast-check (K3, K5, collets > 0, miroir gauche/droite).

### une structure (limons, crémaillère, tôle pliée…)

Les plugins de structure implémentent `StructureKind` (`model/plugins.ts`) et vivent dans `packages/core/src/structures/`. Plugins intégrés : `wood-housed` (limons à la française, poteau d'angle, marches et contremarches encastrées) et `wood-cut` (crémaillères, escalier droit) au jalon 3a ; `steel-flat` (limons en plat découpé laser, supports, platines, poteau tube, marches bois ou en tôle pliée Z / U) au jalon 3b ; `steel-profile` (profilés UPN / IPN / IPE / HEA du catalogue `catalog/`, prédimensionnement `precheck/`, calepinage des barres) au jalon 3c ; `helical-core` (hélicoïdal à fût central : fût, marches bois ou tôle en porte-à-faux, limon et main courante hélicoïdaux, palier d'arrivée) au jalon 5a ; `steel-curved` (limon de jour débillardé soudé : tronçons développés en fibre neutre, lignes de roulage, joints bout à bout repérés, rouleuse `MetalProfile.plateRolling`) au jalon 5b. `compareVariants` et `compareEpure` (`structures/compare.ts`) construisent plusieurs plugins sur la même épure pour le comparateur ; `compareEpure` adapte le raccord de jour à chaque structure (poteau pour des profilés, arc roulable pour un débillardé) et le signale.

1. Écrire le plugin : `kind` unique (≠ `none`), `label`, `family`, schéma zod des paramètres (`paramsSchema`), `defaults(ctx)` et `build(ctx, params) → { parts, checks, notes, errors? }`. `ctx` porte le projet, le tracé, le découpage et les pièces de base (`baseParts`).
2. Pièces : un `SolidDesc` (maillé par `@blondel/geometry`), un débit `stock`, et pour la découpe un développé `flat` (contour 1:1, traits `mark` avec `feature: "mortise" | "tenon"`, fibre de référence `reference`) ; `exportPartDxf`, `renderFlatPatternSvg` et le PDF le consomment. Une pièce de même `id` qu'une pièce de base la **remplace** (ex. marche prolongée dans les limons).
3. Contrôles : un `RuleResult` dont `ruleId` est une règle de `rules.yaml` remplace le résultat « sans évaluateur » du moteur (`mergeStructureChecks`) ; les contrôles de fabrication propres (`FAB_RULES`, `structures/checks.ts`) s'ajoutent. Une configuration non prise en charge va dans `errors` (repris dans `Model.errors`, modèle partiel), jamais une exception. Un plugin métal renseigne `executionClass` ; un plugin qui rend des pièces de base inutiles les nomme dans `removedBaseParts`.
4. Enregistrer le plugin avec `registerStructure` (`structures/index.ts` le fait au chargement pour les plugins intégrés). L'interface le propose aussitôt : `listStructures()` → formulaire générique dérivé de `paramsSchema` et `defaults(ctx)` (`apps/web/src/lib/structureForm.ts`).
5. Paramètres : le pipeline fusionne **en profondeur** `defaults(ctx)` et `structure.params` (paramètres partiels ou `{}` acceptés), puis valide par `paramsSchema` ; paramètres invalides → `StructureError` dans `Model.errors`.
6. Quantités : clés normalisées de `structures/quantities.ts` (`QUANTITY_VOLUME_M3`, `QUANTITY_MASS_KG`…) ; `normalizeWoodQuantities` est appliqué par le pipeline, y compris sur les pièces de base de repli.
7. Aucune valeur métier non sourcée en dur : paramètre du plugin ou du profil d'atelier, marqué « à valider », et point au ledger §2. Conventions : les plugins débillardés ont un `kind` qui commence par `debillard` ou figurent dans `DEBILLARDE_STRUCTURE_KINDS` (`stepping/stepping.ts`, ex. `steel-curved`) : variante M3 quintique automatique.
8. Tests : `structures/*.test.ts` (propriétés fast-check sur les développés), `pipeline/structures.test.ts`, un exemple `examples/*.blondel.json` qui l'utilise (tous les exports de bout en bout le couvrent alors, `packages/exports/src/examples.test.ts`).

### des garde-corps

`packages/core/src/guards/` : `project.guards` (`guards/spec.ts`, facultatif ; absent = aucun garde-corps et règles GC_* / MC_* non évaluées). `computeGuards(project, layout, stepping)` rend les pièces (poteaux `PG`, balustres `BA`, mains courantes `MC` balayées) et une analyse lue par les évaluateurs `rules/evaluators/guards.ts` (régime 1988 ou 2024 selon `compliance.referenceDate`) ; `guardChecks` ajoute les contrôles hors table (`GC_CABLES_DETENTE`, `GC_CONFLIT_DALLE`). Les côtés « automatiques » se déduisent de `site.walls`. Une configuration impossible (jour plus étroit que deux décalages) lève une `GuardError`, reprise dans `Model.errors`.

### le profil d'atelier

`packages/core/src/workshop/profile.ts` (CHALLENGE A8) décrit ce que l'atelier sait débiter et usiner, séparément du projet : épaisseurs, largeurs et sections de débit disponibles, longueur maximale de plateau, surcotes, profondeur d'encastrement, jeu d'assemblage, seuils de fabrication (joue, largeur perpendiculaire, bois entre encastrements, dépassement de rive) et masses volumiques.

- `DEFAULT_WORKSHOP_PROFILE` : toutes les valeurs sont des hypothèses **à valider** ; `WORKSHOP_PROVENANCE` indique pour chaque réglage s'il est sourcé.
- Métal (`workshop/metal.ts`, `METAL_PROVENANCE`) : presse plieuse, lois de pli par nuance et épaisseur (facteur K, DIN 6935, table), formats de tôle, épaisseur laser maximale, barres du commerce ; mêmes réserves « à valider ».
- `Project.workshop` (facultatif, partiel) remplace champ par champ le profil par défaut : `resolveWorkshopProfile(project.workshop)`. Un projet sans profil est sérialisé à l'identique.
- Les plugins lisent le profil résolu (débit au plus petit disponible : `smallestAvailable`) ; le pipeline en dépend pour la mémoïsation de l'étape structure.
- Barème de coût (`workshop/costs.ts`, aucun défaut) : saisi dans l'interface (« Atelier… », `apps/web/src/components/WorkshopDialog.tsx`), gardé hors du projet (stockage du navigateur, import / export JSON) et fusionné par `withWorkshopRates` (`apps/web/src/lib/workshopRates.ts`) dans une copie du projet envoyée au comparateur ; `Project.workshop.costs` d'un fichier importé reste lu, complété par le barème de l'interface.

## Conventions de code

- TypeScript strict, imports relatifs avec suffixe `.js`, identifiants en anglais, commentaires et documentation en français.
- Tests vitest `*.test.ts` à côté du code ; invariants en propriétés fast-check sur générateurs **contraints**.
- Exemples `examples/*.blondel.json` générés par leurs générateurs de test (`project/examples.test.ts`, `guards/acceptance.test.ts`, `structures/helicalExample.test.ts`, `structures/steelCurved.acceptance.test.ts`, `UPDATE_EXAMPLES=1`) ; chacun est couvert de bout en bout par tous les exports (`exports/src/examples.test.ts`) et par un instantané des cotes principales (`pipeline/build.test.ts`). Critères d'acceptation n° 1 et n° 3 (dont chaque tronçon d'un débillardé) : `exports/src/acceptance-criteria.test.ts` ; n° 2 : `core/src/structures/steelCurved.acceptance.test.ts` ; « aucun calcul métier dans l'UI » : `apps/web/src/architecture.test.ts` ; traçabilité des règles : `core/src/rules/traceability.test.ts` ; bilan : [`ACCEPTATION.md`](ACCEPTATION.md) ; interactions entre étapes : `core/src/pipeline/integration.test.ts`.
- Tests de bout en bout Playwright (`apps/web/e2e/`, `pnpm e2e`) sur le build : critère n° 1 dans l'interface, critère n° 1 par l'assistant, mode expert, outils 3D, exports glTF et fiche de pose, import DXF et relevé de trémie, hélicoïdal, corrections proposées, comparateur, import / annuler / autosauvegarde, et aucune tâche longue au-delà de 200 ms (`E2E_LONG_TASK_BUDGET_MS`).
- Prettier (`.prettierrc.json`) ; `pnpm format:check` doit passer.
- Suivi du travail : `docs/LEDGER.md` (avancement, points en suspens, messages entre agents, journal).
