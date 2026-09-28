# ADR-0002 — Modèle de données et pipeline

- Statut : accepté (jalon 0)

## Décision

- **Entrée unique** : `Project` (zod, `packages/core/src/model/project.ts`), JSON versionné (`schemaVersion`), migrations `migrate(json) → Project` chaînées par version.
- **Tracé générique** : N volées reliées par N−1 tournants à 90° (`LayoutSpec`). Droit, quart tournant, deux quarts (U), demi-tournant balancé (3 volées, volée centrale = 2E + jour) et paliers d'angle sont des cas particuliers. Les bords (jour, mur) et la ligne de foulée sont des `Curve2` (segments + arcs), clothoïdes en V1. S/Z, hélicoïdal et multi-volées hétérogènes : extensions ultérieures du même modèle (`LayoutSpec` deviendra une union discriminée).
- **Pipeline de fonctions pures** : `computeLayout → computeStepping → structure.build → guards → compliance`, assemblé par `buildModel(project): Model`. Mémoïsation par étape sur l'identité des sous-objets (projet immuable).
- **Plugins** : `BalancingStrategy` (M0, M1, M3 au MVP) et `StructureKind` (registre par `kind`, paramètres validés par le plugin lui-même).
- **Pièces** : `Part` porte repère, matériau, `SolidDesc`, `FlatPattern`, quantités de nomenclature/coût.
- **Conformité** : `RuleResult` localisé (marche, nez, pièce, point 3D), traçable (source, nature, confiance, sévérité déclarée vs effective).

## Conséquences

- Aucune logique métier dans `apps/web` : l'UI édite le `Project` et affiche le `Model`.
- `LayoutSpec` sera élargi (union) sans casser les projets v1 grâce aux migrations.
