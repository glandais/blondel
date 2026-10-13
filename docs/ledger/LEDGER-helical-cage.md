# Ledger de l'unification de l'hélicoïdal (F10)

Journal dédié du chantier `feat/helical-cage` (worktree `.claude/worktrees/feat/helical-cage`). **On n'y fait que des ajouts de lignes** : jamais de réécriture d'une entrée existante ; une case cochée se coche par une ligne de journal qui le dit, et la liste des sous-lots ci-dessous n'est mise à jour qu'en cochant.

`docs/LEDGER.md` ne reçoit qu'une ligne de renvoi au démarrage, puis une ligne de synthèse à la fusion sur `develop`.

## But

Ramener l'hélicoïdal à une cage d'un seul tronçon à axe en arc (balayage au-delà de 360°), pour n'avoir qu'un moteur de tracé, **seulement si** la parité est prouvée.

## Décision de l'utilisateur (2026-10-13, F10)

- (a) **par étapes** : d'abord un sous-lot de parité seul, conversion `helicalToCage` et test de parité strict (mêmes marches, cotes, instantanés et exemples), **sans basculer le pipeline**.
- Bascule (pipeline, `helical-core` sur cage, retrait de `layout/helical.ts`) seulement si la parité tient ; sinon retour à (b), constat consigné dans `docs/QUESTIONS.md` F10.

## Règles de travail

- Un workflow par sous-lot, dans ce worktree : conception, implémentation, vérification (`pnpm typecheck`, `pnpm test`, `pnpm format:check`, build web et `pnpm e2e --output <dossier privé>` si `apps/web` a changé), revue adversariale, corrections, lignes ajoutées ici, commit par l'orchestrateur (`git add <chemins>`).
- Fusion sur `develop` (donc déploiement) seulement après accord de l'utilisateur.
- Sous-lot P1 : aucun instantané ni exemple modifié (`examples/` identiques à l'octet près, aucun `-u`).

## Sous-lots

- [ ] **P1** — parité : `helicalToCage`, test de parité strict (tracé, découpage, échappée, sous-faces), constat écrit
- [ ] **P2** — bascule (si P1 concluant) : pipeline, `helical-core` sur cage, éditeur de plan
- [ ] **P3** — retrait de l'ancien moteur et des tests `isHelicalLayout`

## Gabarit d'une ligne de journal

```text
- AAAA-MM-JJ [helical-cage:<sous-lot>] <rôle> — Fait : … Vérifications : <commandes et résultats réels> … Écarts : … Questions : ….
```

## Journal

- 2026-10-13 [helical-cage:0] orchestrateur — Fait : worktree `feat/helical-cage` créé depuis `develop` (c325462, décision F10 consignée), ce ledger. Questions : F10 tranchée (a) par étapes.
