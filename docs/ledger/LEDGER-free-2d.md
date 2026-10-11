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
  - [ ] 0b schéma `cage`, `cageFeatures`, sérialisation
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
