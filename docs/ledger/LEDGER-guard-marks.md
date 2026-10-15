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

- [x] **G1** — conception : état des lieux des repères de garde-corps, options et questions à l'utilisateur (aucun code de production modifié)
- [ ] **G2** — implémentation des décisions, écarts d'instantanés justifiés

## Gabarit d'une ligne de journal

```text
- AAAA-MM-JJ [guard-marks:<sous-lot>] <rôle> — Fait : … Vérifications : <commandes et résultats réels> … Écarts : … Questions : ….
```

## Journal

- 2026-10-15 [guard-marks:0] orchestrateur — Fait : worktree `feat/guard-marks` créé depuis `develop` (ab83863, attribution des repères fusionnée), ce ledger. Questions : lot décidé par F10 Q4 (garde-corps, « lot à part »).
- 2026-10-15 [guard-marks:G1] concepteur — Fait : état des lieux et conception (`guard-marks-g1.md` du scratchpad, après contre-examen) ; constats : sur ce que lit la signature, écarts intra-repère ≤ 5·10⁻¹² mm (D1 sans effet atelier sur les exemples), écarts de bord bas de PN1 (`demo-helical-well` 1,675 mm, `demo-central-glulam` 0,582 mm) = même pièce tournée de 180° (0,000 après rotation), écart en plan ≈ 0,5 mm = artefact du facettage de `panelMember` (axe identique), LS / CA séparés à tort par le nombre de sommets (24 + 25 paires en variantes), bascules sur seuil r0 / r1, câble CA13 en éventail à 0,747 mm (variante), MC1 / MC2 identiques sur 4 exemples droits, `countUniqueParts` sous le nombre de repères sur 9 exemples, main courante en double sur `helical-core` avec garde-corps (MC1 ×2 à 0,33 mm), débit PN = aire nette (46 repères sur 85 à flan vertical plus haut, +58,6 à +1 450,1 mm), pièces de quelques centimètres ; conventions CG1 à CG12 (un seul T, angles en mm, représentant le plus court pour les barres et le plus petit par l'aire pour les PN, `markName` = libellé générique, invariant C3 étendu, comparateur sur les repères distincts). Vérifications : sondes jetables `packages/exports/src/zzG1PanelProbe.test.ts` et `packages/core/src/zzG1CounterProbe.test.ts` supprimées, sorties `guard-marks-*` du scratchpad, `git status` : seul ce journal modifié. Écarts : correction « 86 repères PN » du contre-examen écartée (85 sur 12 exemples, la 86ᵉ ligne est la synthèse) ; aires de flan orienté selon la pente non consignées, à re-mesurer. Questions : G-Q2 descripteur de forme (recommandé) ou signature scalaire, G-Q3 retournement admis sans miroir sauf pièce plane, G-Q5 regroupement des MC avec nature dans la clé, G-Q6 main courante de la structure remplaçant celle du garde-corps, G-Q7 une ligne ◆ stable par règle de représentant (dont « la plus petite par l'aire », EC comprises), G-Q8 débit des panneaux en lot à part.
- 2026-10-15 [guard-marks:G1] orchestrateur — Fait : questions G-Q2, G-Q3, G-Q5 à G-Q8 tranchées par l'utilisateur, toutes sur l'option recommandée (`docs/QUESTIONS.md`, F10, lot « repères de garde-corps »). G1 coché. Découpage de G2 : G2a (descripteur de forme, instantané préalable des repères de garde-corps), G2b (regroupement à T, mains courantes, main courante de la structure, comparateur), G2c (représentant, recopie, `markName`, invariant étendu), G2d (lignes ◆ par règle, documentation, e2e).
