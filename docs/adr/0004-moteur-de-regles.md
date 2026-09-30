# ADR-0004 — Moteur de règles

- Statut : accepté (jalon 0)

## Décision

- `docs/research/rules.yaml` reste la **source de vérité** des seuils, sévérités, sources et contextes. `scripts/build-rules.mjs` le convertit en `rules.data.json` embarqué ; un test échoue si le JSON n'est pas à jour.
- Les champs `formule` sont **documentaires** : on **n'évalue jamais de chaîne** (sécurité, typage, localisation). Chaque règle implémentée a un **évaluateur TS** enregistré par `id`, qui lit `min`/`max` depuis la table et renvoie des `RuleResult` localisés.
- Une règle des contextes actifs sans évaluateur apparaît `non-evaluee` dans le rapport (traçabilité, critère d'acceptation « toute règle traçable »). Un test liste la couverture.
- Contextes cumulatifs (`tous` implicite) ; profil `strict` / `souple` (rétrogradation des bloquantes `source_secondaire`) ; surcharges utilisateur avec justification obligatoire, tracées dans `downgradeReason`.
- Le projet enregistre `rulesVersion`.

## Sémantique des listes de contextes (complément du 2026-09-30)

- Les contextes actifs sont cumulatifs : toutes les règles applicables s'appliquent, `tous` est implicite ; `tournant`, `helicoidal`, `helicoidal_fut` et le régime garde-corps peuvent être déduits (`rules/contexts.ts`).
- La liste `contexte` d'une règle se découpe en deux groupes : les **contextes de forme** (liste `contextes_forme` de `rules.yaml` : `tournant`, `helicoidal`, `helicoidal_fut`) et les autres (destination, matériau, régime garde-corps). Chaque groupe est une **disjonction** ; les deux groupes se combinent par une **conjonction** ; un groupe vide est satisfait. `tous` rend la règle toujours applicable. `contexte_exclu` écarte la règle dès qu'un de ses contextes est actif.
- Exemples : `[erp_neuf, erp_existant]` = ERP neuf ou existant ; `[erp_securite, tournant, helicoidal]` = ERP et (tournant ou hélicoïdal) ; `[helicoidal, bois_dtu]` = bois et hélicoïdal. La lecture purement disjonctive imposerait `LF_POSITION_HELICOIDAL` à tout escalier bois (LEDGER l. 47).
- Écrite en tête de `rules.yaml`, lue par `isRuleApplicable` (`SHAPE_CONTEXTS` = `contextes_forme`), testée par `rules/contexts.test.ts`.

## Champs structurés (complément du 2026-09-30)

- Toute constante lue par un évaluateur est un champ de `rules.yaml` : `min` / `max` / `recommande`, ou `parametres` (constantes nommées : seuil 1 200 mm des `LF_POSITION_*`, recouvrement 50 mm sans contremarche, zones des gabarits, unités de passage, seuil E ≤ 1 200 mm des limons…) ou `tables` (table h(E) de `GC_HAUTEUR_2024`, tableau FCBA de `CREMAILLERE_REGLE_MOYENS`, charges par catégorie). Lecture par `ruleParam` / `ruleTable` (`rules/table.ts`) ; plus aucune valeur extraite d'une `formule` ou d'une `description` (l'ancien `rules/formula-constants.ts` est remplacé par `rules/params.ts`, qui ne fait que nommer ces lectures).
- `formule` et `description` restent documentaires ; un test vérifie que chaque valeur structurée y figure aussi (cohérence du texte et des données).
- `regles_mesurees` (règles `LF_POSITION_*`) : règles de giron contrôlées sur la ligne de mesure réglementaire quand elle diffère de la ligne de conception (SPEC X9) ; appariement par convention Blondel à valider.
- Contrôles évalués par un plugin de structure (`LIMON_EPAISSEUR_MIN_DTU`, `LIMON_ENTAILLE_MIN`, `CREMAILLERE_REGLE_MOYENS`) : le moteur rend un résultat d'attente (structure concernée), sans objet (autre structure) ou non évalué (aucune structure) ; `mergeStructureChecks` le remplace par ceux du plugin.
- Règle sans donnée dans le modèle (contraste des nez, bande d'éveil, charges, cintrage…) : le moteur rend `non-evaluee` avec le **motif** précis (`rules/evaluators/unevaluable.ts`) au lieu de « sans évaluateur ».
