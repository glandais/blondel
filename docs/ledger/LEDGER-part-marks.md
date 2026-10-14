# Ledger de l'attribution des repères

Journal dédié du chantier `feat/part-marks` (worktree `.claude/worktrees/feat/part-marks`). **On n'y fait que des ajouts de lignes** : jamais de réécriture d'une entrée existante ; une case cochée se coche par une ligne de journal qui le dit, et la liste des sous-lots ci-dessous n'est mise à jour que pour cocher.

`docs/LEDGER.md` ne reçoit qu'une ligne de renvoi au démarrage, puis une ligne de synthèse à la fusion sur `develop`.

## But

Attribuer les repères des pièces sans dépendre d'un arrondi à seuil (`Math.round(length / IDENTICAL_TOLERANCE)` dans `steelFlat.ts`, `steelCurved.ts`, `steelProfile.ts`, `compare.ts`), de sorte qu'un même repère ne se retrouve plus sur plusieurs lignes de débit (CR1 de `demo-quarter-curved` et de `j5b-debillarde-soude`, écart de 2e-6 mm), et revoir la désignation d'une ligne de débit qui réunit plusieurs pièces (décisions F10 (18) et (19), `docs/QUESTIONS.md`).

## Règles de travail

- Un workflow par sous-lot, dans ce worktree : conception, implémentation, vérification (`pnpm typecheck`, `pnpm test`, `pnpm format:check`, build web et `pnpm e2e --output <dossier privé>` si `apps/web` a changé), revue adversariale, corrections, lignes ajoutées ici, commit par l'orchestrateur (`git add <chemins>`).
- Instantanés de référence : `packages/exports/src/fabricationOutputs.test.ts` (listes et fiches de débit, DXF de développés des exemples), posés par le chantier `stable-tiebreaks` ; tout écart justifié ici.
- Les conventions visibles (règle de regroupement, désignation) sont présentées à l'utilisateur une par une avant implémentation.
- Fusion sur `develop` (donc déploiement) seulement après accord de l'utilisateur.

## Sous-lots

- [ ] **R1** — conception : état des lieux de l'attribution des repères, options et questions à l'utilisateur (aucun code de production modifié)
- [ ] **R2** — implémentation des décisions, écarts d'instantanés justifiés

## Gabarit d'une ligne de journal

```text
- AAAA-MM-JJ [part-marks:<sous-lot>] <rôle> — Fait : … Vérifications : <commandes et résultats réels> … Écarts : … Questions : ….
```

## Journal

- 2026-10-14 [part-marks:0] orchestrateur — Fait : worktree `feat/part-marks` créé depuis `develop` (ac6ab7f, départages stables fusionnés), ce ledger. Questions : lot décidé par F10 (18) et (19).
