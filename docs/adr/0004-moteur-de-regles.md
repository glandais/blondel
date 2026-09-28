# ADR-0004 — Moteur de règles

- Statut : accepté (jalon 0)

## Décision

- `docs/research/rules.yaml` reste la **source de vérité** des seuils, sévérités, sources et contextes. `scripts/build-rules.mjs` le convertit en `rules.data.json` embarqué ; un test échoue si le JSON n'est pas à jour.
- Les champs `formule` sont **documentaires** : on **n'évalue jamais de chaîne** (sécurité, typage, localisation). Chaque règle implémentée a un **évaluateur TS** enregistré par `id`, qui lit `min`/`max` depuis la table et renvoie des `RuleResult` localisés.
- Une règle des contextes actifs sans évaluateur apparaît `non-evaluee` dans le rapport (traçabilité, critère d'acceptation « toute règle traçable »). Un test liste la couverture.
- Contextes cumulatifs (`tous` implicite) ; profil `strict` / `souple` (rétrogradation des bloquantes `source_secondaire`) ; surcharges utilisateur avec justification obligatoire, tracées dans `downgradeReason`.
- Le projet enregistre `rulesVersion`.
