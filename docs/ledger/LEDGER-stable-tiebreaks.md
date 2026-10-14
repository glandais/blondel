# Ledger des départages stables (F10 (7) et (11))

Journal dédié du chantier `feat/stable-tiebreaks` (worktree `.claude/worktrees/feat/stable-tiebreaks`). **On n'y fait que des ajouts de lignes** : jamais de réécriture d'une entrée existante ; une case cochée se coche par une ligne de journal qui le dit, et la liste des sous-lots ci-dessous n'est mise à jour que pour cocher.

`docs/LEDGER.md` ne reçoit qu'une ligne de renvoi au démarrage, puis une ligne de synthèse à la fusion sur `develop`.

## But

Rendre indépendants du bruit d'arrondi les départages de l'aval, qui changeaient des sorties d'escaliers non hélicoïdaux pendant la bascule de F10 (`docs/QUESTIONS.md` F10 (11)) : `minAreaRect` (`structures/geom.ts`), clé de regroupement de la liste et de la fiche de débit (`csv/cutlist.ts`, `cutsheet.ts`), repère gravé (`dxf/part.ts`), clé des DXF de développés (`dxf/parts.ts`), enveloppe convexe de `geom2d/collide.ts`.

## Décision de l'utilisateur (2026-10-14, F10 (7) et (11))

- Lot séparé après la fusion de F10 : d'abord des instantanés des listes de débit, fiches, DXF de développés et zones de conflit des exemples, puis les départages indépendants du bruit, **chaque changement d'instantané justifié**.

## Règles de travail

- Un workflow par sous-lot, dans ce worktree : conception, implémentation, vérification (`pnpm typecheck`, `pnpm test`, `pnpm format:check`, build web et `pnpm e2e --output <dossier privé>` si `apps/web` a changé), revue adversariale, corrections, lignes ajoutées ici, commit par l'orchestrateur (`git add <chemins>`).
- Fusion sur `develop` (donc déploiement) seulement après accord de l'utilisateur.
- Sous-lot S1 : aucun code de production modifié ; `examples/` identiques à l'octet près.

## Sous-lots

- [ ] **S1** — instantanés : listes et fiches de débit, DXF de développés, zones de conflit des exemples, enregistrés sur l'état de `develop` (56f79d8)
- [ ] **S2** — départages indépendants du bruit (`minAreaRect`, clé de débit, repère gravé, clé des DXF de développés, enveloppe convexe), écarts d'instantanés justifiés un à un

## Gabarit d'une ligne de journal

```text
- AAAA-MM-JJ [stable-tiebreaks:<sous-lot>] <rôle> — Fait : … Vérifications : <commandes et résultats réels> … Écarts : … Questions : ….
```

## Journal

- 2026-10-14 [stable-tiebreaks:0] orchestrateur — Fait : worktree `feat/stable-tiebreaks` créé depuis `develop` (56f79d8, F10 fusionnée), ce ledger. Questions : lot décidé par F10 (7) et (11).
