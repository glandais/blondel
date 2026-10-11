# Ledger du tracé libre (CAGE) et de l'éditeur 2D unifié

Journal dédié du chantier `feat/free-2d` (worktree `blondel.worktrees/feat/free-2d`). **On n'y fait que des ajouts de lignes** : jamais de réécriture d'une entrée existante ; une case cochée se coche par une ligne de journal qui le dit, et la liste des lots ci-dessous n'est mise à jour qu'en cochant.

`docs/LEDGER.md` ne reçoit qu'une ligne de renvoi au lot 0, puis une ligne de synthèse à la fusion sur `develop`.

## But

Rendre le site et le tracé **libres**, avec un éditeur 2D simple qui compose les tronçons de l'escalier et montre en direct s'il tient dans les contraintes du site (murs, contour de pièce, obstacles, trémie, dalle, échappée).

## Décisions de l'utilisateur (2026-10-11)

- **Modèle CAGE** (CHALLENGE-panel, « Angle geometrie ») : tronçons reliés par des jonctions, avec dès la première version un angle signé quelconque, une largeur propre à chaque tronçon et éventuellement variable, un axe droit ou en arc, des paliers droits intermédiaires.
- **Tout migrer** : un seul chemin de calcul ; les volées deviennent un générateur de CAGE (`flightsToCage`). Le tracé à volées reste une entrée sérialisée : pas de schéma v2, `examples/` identiques à l'octet près.
- **Hélicoïdal** : garde son `kind` et son calcul (unification : F10).
- **Structures progressives** : premier lot avec la structure « aucune » ; garde-fou `cageFeatures` (erreur claire) pour les autres, généralisées une par une (limon à la française d'abord).
- **Contraintes** : retour visuel et accroches, pas de solveur ; conflits calculés dans le cœur.
- **Site** : édition directe des murs et de la trémie, contour de pièce, obstacles.
- **Éditeur 2D unifié** pour le site et l'escalier.

Décision d'architecture : `docs/adr/0010-cage-trace-libre.md` (ADR-0010, amende ADR-0002). Plan validé par l'utilisateur : `~/.claude/plans/comment-rendre-libre-le-graceful-island.md`, repris par ADR-0010. Questions ouvertes : `docs/QUESTIONS.md`, section F (F1 à F10), présentées une par une avant le sous-lot qui en dépend.

## Règles de travail

- Un workflow par sous-lot, dans ce worktree : implémentation (agents sur des zones de fichiers disjointes), vérification (`pnpm typecheck`, `pnpm test`, `pnpm format:check`, `BASE_PATH=/blondel/ pnpm --filter @blondel/web build`, `pnpm e2e --output <dossier privé>` si `apps/web` a changé), revue adversariale du diff, corrections, lignes ajoutées ici, commit par `git add <chemins>`.
- Chaque lot finit vert ; fusion sur `develop` (donc déploiement) seulement après accord de l'utilisateur ; aucun push sur `develop` sans accord.
- Lot 1 clos seulement si les instantanés de `pipeline/build.test.ts` sont intacts **sans `-u`** et `examples/` identiques à l'octet près.

## Gabarit d'une ligne de journal

```text
- AAAA-MM-JJ [free-2d:<sous-lot>] workflow <identifiant> — Fait : … Commits : <hash> … Vérifications : <commandes et résultats réels, nombres de tests, e2e n/n> … Écarts : <instantanés, exemples, écarts au plan, justifiés> … Questions : <F* ouvertes ou tranchées>.
```

## Lots et sous-lots

- [ ] **Lot 0** — ADR, questions, schéma
  - [ ] 0a ADR-0010, questions F1 à F10, ce ledger
  - [x] 0b schéma `cage`, `cageFeatures`, sérialisation
  - [ ] 0c schéma du site (`room`, `obstacles`)
- [ ] **Lot 1** — moteur `layout/cage/`, parité stricte
  - [ ] 1a `geom2d/collide.ts` (déplacé depuis `assistant/placement.ts`)
  - [ ] 1b `layout/cage/` : repères et jonctions à ±90°, `flightsToCage`
  - [ ] 1c bascule de `computeLayout`, `Layout.sections`, test de parité (instantanés intacts)
- [ ] **Lot 2** — liberté et aval
  - [ ] 2a jonctions d'angle quelconque, raccords (vif, arc, pan coupé, mur en arc), palier droit
  - [ ] 2b largeur variable, axe en arc
  - [ ] 2c `stepping/`, `balancing/`
  - [ ] 2d `headroom/`, `guards/`, `rules/`
  - [ ] 2e exports (plan, fiche de pose), `project/`
  - [ ] 2f garde-fou des structures, exemples `cage-*`
- [ ] **Lot 3** — adéquation au site
  - [ ] 3a mutateurs du site et du tracé (`site/edit.ts`, `layout/cageEdit.ts`)
  - [ ] 3b `site/fit.ts`, étape du pipeline, règles et paramètres
  - [ ] 3c `site/stairSnap.ts`, crible de l'assistant unifié
- [ ] **Lot 4** — éditeur de plan
  - [ ] 4a refonte de `PlanSiteEditor` (et `PlanView`) en calques, sélection
  - [ ] 4b poignées de l'escalier et de la cage, historique (glisser = une entrée)
  - [ ] 4c voie d'aperçu du worker, calque des conflits
  - [ ] 4d inspecteur, conversion en tracé libre, e2e
- [ ] **Lot 5** — édition du site dans l'éditeur
  - [ ] 5a murs et trémie éditables
  - [ ] 5b contour de pièce, obstacles, e2e
- [ ] **Lot 6 et suivants** — une structure par lot
  - [ ] limon à la française (`wood-housed`)
  - [ ] acier plat, plié et profilé
  - [ ] limons centraux bois et acier
  - [ ] acier cintré (axe en arc)

## Coordination avec la session « limon central »

- La session « chantiers » (`feat/limon-central-a38`) touche `structures/woodCentral*`, les migrations de `project/`, `packages/i18n/src/locales/fr.json` et `en.json`, les instantanés et `examples/`. Elle fusionne sur `develop` avant nous : on rebase sur `develop` et on régénère nous-mêmes (`pnpm vitest run <fichier> -u` justifié, `UPDATE_EXAMPLES=1`), plutôt que de résoudre ces conflits à la main. On la prévient avant tout push sur `develop`.
- `wood-central` et `steel-central` lisent le tracé par `structures/centralTrace.ts` : le garde-fou des structures (sous-lot 2f) doit couvrir ces deux plugins, avec un message lisible et sans exception.
- `docs/QUESTIONS.md` : la session « chantiers » numérote A39 et suivantes ; ce chantier utilise le préfixe F (F1 à F10, section F). Vérifier les derniers numéros au moment du rebase.

## Journal

- 2026-10-11 [free-2d:0a] workflow sous-lot 0a (documentation, aucun code) — Fait : ADR-0010 « Tracé libre : modèle CAGE et éditeur 2D unifié » (`docs/adr/0010-cage-trace-libre.md` : constat, décisions de l'utilisateur du 2026-10-11, schéma, moteur, aval, alternatives écartées ; références CHALLENGE-panel « Angle geometrie », CHALLENGE.md G1, B §1.1 et §1.2) ; amendement daté d'ADR-0002 (tracé générique → CAGE) ; `docs/QUESTIONS.md` section F (F1 à F10) ; ce ledger ; ligne de renvoi dans `docs/LEDGER.md` ; liste des ADR de `docs/ARCHITECTURE.md` portée à 0010. Noms de code cités vérifiés dans l'arbre (`FlightsLayoutSpecSchema`, `HelicalLayoutSpecSchema`, `computeLayout`, `degenerateFootprint`, `Layout.walklineTransitions`, fonctions de `assistant/placement.ts`, `attempt`, `structureAcceptsLayout`, `centralTrace.ts`, `limits.arrivalClearance`). Commits : aucun (non committé). Vérifications : `prettier --check .` vert avec le Prettier 3.9.9 du dépôt principal (le worktree n'a pas encore de `node_modules` : `pnpm format:check` y prenait un Prettier 3.6.2 global, qui signale 30 fichiers hors de ce lot ; `pnpm install` à lancer avant le sous-lot 0b). Écarts : `site/edit.ts` existe déjà (murs, trémie, calque) : il sera complété au sous-lot 3a, pas créé. Questions : F1 à F10 ouvertes.
- 2026-10-11 [free-2d:0b] workflow sous-lot 0b (schéma `cage`) — Fait : `model/project.ts` : `WellJointSchema` (vif, arc, poteau, pan coupé), `WallJointSchema` (vif, arc), `CageAxisSchema` (droit `length` ≥ 0 ou `auto`, arc `radius` + `sweep` signé), `CageSectionSchema` (`width`, `widthEnd?`, `anchor?`), `CageJunctionSchema` (`angle` signé, `mode`, `well` / `wall` vifs par défaut, `depth?`), `CAGE_MAX_SECTIONS` = 16 (F8), `CageLayoutSpecSchema` (`superRefine` à messages `layout.cage.*` par `params.message` ; champs dérivés `width` = largeur minimale, `legs: []`, `turns: []`, comme l'hélicoïdal), variante ajoutée à `LayoutSpecSchema`, `isCageLayout` ; `model/cageFeatures.ts` (`CageFeature`, `CAGE_FEATURES`, `cageFeatures`) exporté par l'index ; `serializeProject` retire les champs dérivés de la cage ; `computeLayout` lève `LayoutError(layout.cage.notYetComputed)` sur une cage (seule erreur du modèle, sans exception) ; 10 clés `layout.cage.*` fr / en triées ; décisions F4, F8, F9 inscrites dans `docs/QUESTIONS.md`. Tests : `project/cage.test.ts`, `model/cageFeatures.test.ts` (refus avec chemin et clé, aller-retour, propriétés fast-check). Commits : aucun (non committé). Vérifications : voir le compte rendu du sous-lot (typecheck, test, format:check verts). Écarts : refus supplémentaire `layout.cage.depthStraightLandingOnly` (`depth` hors palier droit) ; `variableWidth` couvre aussi des tronçons de largeurs différentes (un tracé à volées n'a qu'un emmarchement) ; `oppositeTurns` signalé même si un S / Z s'écrit en volées (structures à limons qui le refusent, `structures/legs.ts`) : une cage S / Z ne rend donc pas [] ; convention de mesure de `length` et défaut d'`anchor` laissés au moteur (lot 1). Questions : F4, F8, F9 tranchées.
- 2026-10-11 [free-2d:0b] workflow sous-lot 0b, correction finale — Fait : rectificatif de la ligne 0b précédente : **9** clés `layout.cage.*` fr / en (et non 10) avant cette correction, **10** après l'ajout de `layout.cage.straightJunctionSharp` ; refus du schéma d'un raccord `well` ou `wall` non vif sur un palier droit (angle 0 : ni coin K ni coin W ; `cageFeatures` ne peut donc plus compter `wallArc` / `chamfer` sur une jonction droite) ; documentation de `cageFeatures` restreinte (liste vide = aucune fonction au-delà des volées, sous la convention de mesure de `length` du lot 1 ; exception connue : tronçon droit de longueur 0, admis pour un demi-tour par deux jonctions de 90° (F4), sans équivalent direct en `LegSchema`, à traiter par la conversion inverse au lot 1 / 2e) ; amendement daté d'ADR-0010 (F4 : θ = 180° hors domaine, seuls 0 et ±90° traités exactement ; F8 ; F9 ; raccords vifs du palier droit) ; tests durcis (`project/cage.test.ts`) : liste entière des erreurs du modèle comparée (`["layout.cage.notYetComputed"]`) en unitaire et en propriété, cas `wood-housed` + garde-corps, 16 tronçons acceptés, longueur 0 acceptée, 3 refus de raccords sur palier droit, générateurs avec `depth` facultatif, branche `length: "auto"` à un tronçon et branche à 16 tronçons. Constats de relecture appliqués : raccords sur palier droit, ADR-0010 à 180°, compte des clés, tests buildModel trop lâches, générateurs incomplets ; longueur 0 de `cageFeatures` appliquée par la documentation et un test (pas par `mmPos` : F4 a besoin d'un tronçon intermédiaire de longueur nulle). Constats écartés pour ce sous-lot, **dette connue à fermer au lot 4 et en tout cas avant toute fusion sur `develop`** : l'interface (`LayoutSection.tsx`, `lib/layoutKind.ts` `layoutKindOf` → `flights`, `pressedShapes`, `lib/realign.ts`, `lib/layoutEdit.ts` `addLeg`) présente une cage importée comme un escalier à volées (largeur dérivée éditable et perdue à l'enregistrement, ajout de volée qui écrit `legs` / `turns` dans la cage, sans exception) ; `apps/web` non modifié dans ce sous-lot (pas d'e2e requis). Commits : aucun (non committé). Vérifications : `pnpm typecheck` 0 erreur (paquets, apps/web, e2e) ; `pnpm test` 279 fichiers réussis + 1 ignoré (280), 4329 tests réussis + 3 ignorés (4332), aucun échec (un premier passage sous charge machine 32 à 42 avait 2 échecs de budget de `apps/web/src/perf/presets.perf.test.ts`, cœur 57 ms > 45 ms ; fichier relancé seul 9/9, suite relancée verte) ; tests cage 36/36 (`project/cage.test.ts` 24, `model/cageFeatures.test.ts` 12) ; `pnpm format:check` vert ; `examples/` inchangés (`git diff examples/` vide). Écarts : aucun instantané touché. Questions : aucune nouvelle ; F4, F8, F9 tranchées (ligne précédente) ; la place d'un S / Z (`oppositeTurns`) dans la correction « reconvertir en volées » reste à trancher au lot 2e.
