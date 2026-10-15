# Ledger des repères de garde-corps

Journal dédié du chantier `feat/guard-marks` (worktree `.claude/worktrees/feat/guard-marks`). **On n'y fait que des ajouts de lignes** : jamais de réécriture d'une entrée existante ; une case cochée se coche par une ligne de journal qui le dit, et la liste des sous-lots ci-dessous n'est mise à jour que pour cocher.

`docs/LEDGER.md` ne reçoit qu'une ligne de renvoi au démarrage, puis une ligne de synthèse à la fusion sur `develop`.

## But

Étendre aux pièces de garde-corps (PG, BA, LS, CA, PN, MC ; `packages/core/src/guards/parts.ts`, `MarkRegistry`) la règle d'identité du chantier `part-marks` : regroupement autour d'un représentant à la tolérance d'identité T du profil d'atelier au lieu de l'arrondi à seuil `r0` (1 mm) / `r1` (0,1°), et revoir le représentant dont le débit est recopié (D1 : la première pièce), décision F10 Q4 (`docs/QUESTIONS.md`, « lot à part »).

## Règles de travail

- Un workflow par sous-lot, dans ce worktree : conception, implémentation, vérification (`pnpm typecheck`, `pnpm test`, `pnpm format:check`, build web et `pnpm e2e --output <dossier privé>` si `apps/web` a changé), revue adversariale, corrections, lignes ajoutées ici, commit par l'orchestrateur (`git add <chemins>`).
- Instantanés de référence : `packages/exports/src/fabricationOutputs.test.ts` ; tout écart justifié ici.
- Les conventions visibles sont présentées à l'utilisateur une par une avant implémentation.
- Fusion sur `develop` (donc déploiement) seulement après accord de l'utilisateur.

## Sous-lots

- [ ] **G1** — conception : état des lieux des repères de garde-corps, options et questions à l'utilisateur (aucun code de production modifié)
- [ ] **G2** — implémentation des décisions, écarts d'instantanés justifiés

## Gabarit d'une ligne de journal

```text
- AAAA-MM-JJ [guard-marks:<sous-lot>] <rôle> — Fait : … Vérifications : <commandes et résultats réels> … Écarts : … Questions : ….
```

## Journal

- 2026-10-15 [guard-marks:0] orchestrateur — Fait : worktree `feat/guard-marks` créé depuis `develop` (ab83863, attribution des repères fusionnée), ce ledger. Questions : lot décidé par F10 Q4 (garde-corps, « lot à part »).
