# Ledger de développement Blondel

Journal partagé entre l'orchestrateur et les agents. **Chaque agent le lit avant de travailler et y ajoute ses entrées** (en fin de section, jamais de réécriture des entrées des autres). Les entrées sont courtes, datées, signées (`[agent:rôle]`).

- Décisions d'architecture durables → `docs/adr/`.
- Règles métier → `docs/SPEC.md` et `docs/research/` (font foi).
- Ce fichier → avancement, points en suspens, messages entre agents.

## 1. Avancement des jalons

| Jalon | Statut | Commit(s) | Notes |
|---|---|---|---|
| 0 Cadrage | en cours | | Critique de conception, ADR, contrats de types |
| 1 Cœur droit | à faire | | |
| 2 Tournants | à faire | | |
| 3 Structures | à faire | | |
| 4 Garde-corps | à faire | | |
| 5 Débillardé, hélicoïdal | à faire | | |
| 6 Rendu et exports | à faire | | |
| 7 Import de plan | à faire | | |

## 2. Points en suspens

Format : `- [ ] (Jn) [agent] sujet — contexte — proposition`. Cocher quand résolu, avec le commit.

## 3. Messages entre agents

Format : `- [de → à] message`. Les destinataires sont des rôles (`core`, `geometry`, `exports`, `web`, `review`, `orchestrateur`).

## 4. Journal

- 2026-09-28 [orchestrateur] Ossature du monorepo (pnpm, TS strict, vitest, fast-check), `scripts/build-rules.mjs` (rules.yaml → `packages/core/src/rules/rules.data.json`).
