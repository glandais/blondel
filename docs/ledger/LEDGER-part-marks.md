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

- [x] **R1** — conception : état des lieux de l'attribution des repères, options et questions à l'utilisateur (aucun code de production modifié)
- [ ] **R2** — implémentation des décisions, écarts d'instantanés justifiés

## Gabarit d'une ligne de journal

```text
- AAAA-MM-JJ [part-marks:<sous-lot>] <rôle> — Fait : … Vérifications : <commandes et résultats réels> … Écarts : … Questions : ….
```

## Journal

- 2026-10-14 [part-marks:0] orchestrateur — Fait : worktree `feat/part-marks` créé depuis `develop` (ac6ab7f, départages stables fusionnés), ce ledger. Questions : lot décidé par F10 (18) et (19).
- 2026-10-15 [part-marks:R1] orchestrateur — Fait : workflow R1 (état des lieux, options, contre-examen ; aucun fichier suivi modifié, sondes supprimées). Constat : 11 repères sur 6 exemples s'étalent sur 16 lignes de débit en trop (arrondi à seuil des cornières `Math.round(L / 0,5)` dans `steelFlat.ts`, `steelCurved.ts`, `steelProfile.ts` ; comparaison gloutonne des développés au premier membre) ; 153 DXF de développés en trop (730 pour 577 couples repère × matériau), dont 143 par le texte de référence qui nomme la pièce porteuse ; `IDENTICAL_TOLERANCE` = 0,5 mm ni sourcée ni « à valider » ; garde-corps (`guards/parts.ts`) à arrondi à seuil `r0` 1 mm / `r1` 0,1° masqué par D1 (PN1 de `demo-helical-glass`, 0,52 mm) ; PDF regroupant les développés par clé JSON exacte (`pdf/document.ts:519`) ; nomenclature de l'interface rattachant les pièces par `rowKey` (CR1 de `demo-erp-grand` : 1 pièce sur 32). Questions : Q1a à Q7 tranchées par l'utilisateur, toutes sur l'option recommandée (voir `docs/QUESTIONS.md`, F10, décisions du 2026-10-15). Découpage de R2 : R2a (C1, Q2, Q1a, Q1b, C4 : règle et paramètre), R2b (Q3, C3 : recopie par famille, invariant, partition DXF / PDF commune), R2c (Q5, Q6 : textes et désignations i18n), R2d (C2 : interface, e2e).
- 2026-10-15 [part-marks:R1] orchestrateur — Fait : R1 coché — [x] **R1** état des lieux et décisions de l'utilisateur.
