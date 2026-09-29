# ADR-0002 — Modèle de données et pipeline

- Statut : accepté (jalon 0) ; **amendé le 2026-09-29** (méthodes de balancement et typologies prises en charge, voir « Amendement »)

## Décision

- **Entrée unique** : `Project` (zod, `packages/core/src/model/project.ts`), JSON versionné (`schemaVersion`), migrations `migrate(json) → Project` chaînées par version.
- **Tracé générique** : N volées reliées par N−1 tournants à 90° (`LayoutSpec`). Droit, quart tournant, deux quarts (U), demi-tournant balancé (3 volées, volée centrale = 2E + jour) et paliers d'angle sont des cas particuliers. Les bords (jour, mur) et la ligne de foulée sont des `Curve2` (segments + arcs), clothoïdes en V1. S/Z, hélicoïdal et multi-volées hétérogènes : extensions ultérieures du même modèle (`LayoutSpec` deviendra une union discriminée).
- **Pipeline de fonctions pures** : `computeLayout → computeStepping → structure.build → guards → compliance`, assemblé par `buildModel(project): Model`. Mémoïsation par étape sur l'identité des sous-objets (projet immuable).
- **Plugins** : `BalancingStrategy` (M0, M1, M3 au MVP) et `StructureKind` (registre par `kind`, paramètres validés par le plugin lui-même).
- **Pièces** : `Part` porte repère, matériau, `SolidDesc`, `FlatPattern`, quantités de nomenclature/coût.
- **Conformité** : `RuleResult` localisé (marche, nez, pièce, point 3D), traçable (source, nature, confiance, sévérité déclarée vs effective).

## Amendement (2026-09-29) — état effectif

- **Balancement** : `BalancingSchema.method` = M0, M1, M2 (herse, option V1, `herseAngle`), M3 (défaut), M6 (rotation paramétrée, option V1) ; `BalancingStrategy.id` et le registre `balancing/registry.ts` dérivent de cette **liste unique** (`BalancingMethod`, `model/project.ts`). M7 (SPEC : V2) n'est pas encore un identifiant.
- **Typologies** : `LayoutSpec` **est** une union discriminée rétrocompatible (`kind` absent = volées, `kind: "helical"` = hélicoïdal, jalon 5a). Les tournants de sens opposés (**S / Z**) sont pris en charge par le modèle à volées : `Layout.inner` est le bord du côté du jour du **premier** tournant, le jour d'un tournant de sens opposé est sur `Layout.outer` (`TurnZone.collarSide`, `Layout.walklineTransitions`, aide `stepping/sides.ts`), voir LEDGER §3 [core:layout].
- **Pipeline** : le prédimensionnement indicatif des limons est rendu dans `Model.precheck` (plugin de structure s'il en fait un, `StructureOutput.precheck`, sinon `precheckStringers`) ; le calcul du `Model` côté application a lieu dans un Web Worker (ADR-0005 amendée).

## Conséquences

- Aucune logique métier dans `apps/web` : l'UI édite le `Project` et affiche le `Model`.
- `LayoutSpec` sera élargi (union) sans casser les projets v1 grâce aux migrations.
