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

- [x] **S1** — instantanés : listes et fiches de débit, DXF de développés, zones de conflit des exemples, enregistrés sur l'état de `develop` (56f79d8)
- [ ] **S2** — départages indépendants du bruit (`minAreaRect`, clé de débit, repère gravé, clé des DXF de développés, enveloppe convexe), écarts d'instantanés justifiés un à un

## Gabarit d'une ligne de journal

```text
- AAAA-MM-JJ [stable-tiebreaks:<sous-lot>] <rôle> — Fait : … Vérifications : <commandes et résultats réels> … Écarts : … Questions : ….
```

## Journal

- 2026-10-14 [stable-tiebreaks:0] orchestrateur — Fait : worktree `feat/stable-tiebreaks` créé depuis `develop` (56f79d8, F10 fusionnée), ce ledger. Questions : lot décidé par F10 (7) et (11).
- 2026-10-14 [stable-tiebreaks:S1] implémenteur — Fait : instantanés sur l'état 56f79d8, aucun code de production modifié. `packages/exports/src/fabricationOutputs.test.ts` (48 exemples + préréglage `helical`, 3 sections chacun, 147 instantanés : CSV de débit en clair et repères en double avec composantes brutes de la clé, fiche de débit à 1e-6 et repères en double sur la clé de `cutSheet`, 731 DXF de développés avec calques, boîte, contour, repère gravé et TEXT relu, `minAreaRect`, empreinte à 1e-4, et pour les 154 fichiers suffixés l'écart au premier fichier du repère, contour et développé entier ; repères en double présents dans 18 projets, en liste comme en fiche). `packages/exports/src/testing/snapshotFormat.ts` (aides reprises de `helicalOutputs.test.ts`, inchangé ; pas DXF en paramètre). `packages/core/src/site/fit.zones.test.ts` (mêmes 49 projets, `buildPlanPreview` : pièces hors tout avec empreinte canonique, conflits de l'aperçu, conflits provoqués par un site de test en mm entiers : 49 `wall` T1, 49 `wall` T2, 49 `outsideRoom`, 68 `obstacle`, 48 `arrivalClearance` ; tracé inchangé par le site de test vérifié sur `acceptance-01-quart-tournant`). Écart au plan : `SiteConflict` n'a pas de champ `tread`, non écrit. Vérifications : `pnpm vitest run` des 2 fichiers sans CI (147 + 147 instantanés écrits), puis 2 passages `CI=1` identiques (101 tests verts, aucun écrit) ; `pnpm typecheck` vert ; `pnpm format:check` vert ; `CI=1 pnpm test` deux fois : 344 fichiers verts, 1 ignoré, 6358 tests verts, 3 ignorés, aucun intermittent ; `git diff --exit-code -- examples/` vide ; `git status` : seulement les nouveaux fichiers (aucun `.snap` existant modifié). Tailles : `fabricationOutputs.test.ts.snap` 777 325 o, `fit.zones.test.ts.snap` 209 751 o (≈ 0,99 Mo). Durées : fichier exports ≈ 45 s, fichier core ≈ 2,4 s. Questions : aucune.
- 2026-10-14 [stable-tiebreaks:S1] correcteur — Fait : constats des relecteurs reproduits. Appliqués : (couverture) `expect.soft` dans les boucles de sections des deux tests, vérifié par un marqueur temporaire dans « conflits » (retiré) : « pièces hors tout » et « conflits » signalés ensemble pour un même projet ; (lisibilité 1 et 2) ligne « écart avec » de `fabricationOutputs.test.ts` refaite en trois mesures : écart géométrique (contour, trous compris, extrémités des lignes, épaisseur, `bendAngle`/`bendRadius`/`depth`), décomptes qui diffèrent, trois premiers chemins non géométriques qui diffèrent (+k), et qualificatif `bruit seul` (≤ 1e-9, rien d'autre) ou `différence réelle` ; résultat sur les 154 fichiers suffixés : 0 `bruit seul`, 154 `différence réelle` (105 `reference.description.params.tread`, 30 `params.index`, 19 `params.mark`), aucun décompte différent, écart géométrique nul dans 93 cas, bruit 1e-13 à 1e-10 ou écart réel (EC1 4e-2 à 5e-1, CO1 5,9e-2) ailleurs ; (3) repères en double : `cat=`, `matériau=`, `section=` ajoutés en liste, `matériau=`, `section=`, `appro=` en fiche (toutes les composantes des deux clés) ; (4) tous les sommets des pièces hors tout imprimés à 1e-6 (le premier sommet seul retiré, redondant) ; (5) phrase de stabilité (dépendance à `Math.sin`/`cos` du moteur) dans l'en-tête des deux tests. Écarté : (lisibilité 0) code de production modifié pendant la relecture : au départ du correcteur, `git diff --stat` ne montre que la ligne du ledger, `cutlist.ts` et `cutsheet.ts` sont propres ; c'était l'expérience temporaire du relecteur couverture (mêmes modifications, restaurées par lui) ; instantanés réécrits ici sur un arbre propre. Instantanés neufs réécrits par `pnpm vitest run <2 fichiers> -u` (seuls ces deux `.snap`, créés dans ce sous-lot) ; diff contre l'ancienne version : core, seules les 694 lignes « marche » changent (+ 694 lignes « sommets ») ; exports, seules les lignes « écart avec » et des repères en double. Vérifications : `pnpm format:check` vert ; `pnpm typecheck` vert ; `CI=1 pnpm test` : 344 fichiers verts, 1 ignoré, 6358 tests verts, 3 ignorés, aucun intermittent ; nouveau passage `CI=1` des 2 fichiers : 101 tests verts, rien écrit ; `git diff --exit-code -- examples/` vide ; `git status` : seulement les fichiers neufs du sous-lot et ce ledger, aucun fichier de production modifié. Tailles : `fabricationOutputs.test.ts.snap` 820 356 o, `fit.zones.test.ts.snap` 299 456 o (≈ 1,12 Mo). Questions : aucun fichier suffixé des exemples ne vient du seul bruit (tous diffèrent par un paramètre de `reference.description`) ; S2 ne devrait donc pas en fusionner, sauf si les écarts géométriques de 1e-13 étaient seuls en cause après correction des libellés, ce qui n'est pas dans son périmètre.
- 2026-10-14 [stable-tiebreaks:S1] correcteur — Fait : S1 coché — [x] **S1** instantanés enregistrés sur 56f79d8, revus et corrigés, toutes vérifications vertes (voir la ligne précédente).
