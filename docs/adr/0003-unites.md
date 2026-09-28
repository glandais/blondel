# ADR-0003 — Unités et précision

- Statut : accepté (jalon 0) — amende le prompt 2 §3 (« mm entiers en interne »)

## Constat

« mm entiers en interne » est intenable pour les grandeurs dérivées : H = 2 710, n = 15 → h = 180,667 mm. Arrondir h à l'entier casse l'invariant « somme des hauteurs = H » ou crée des hauteurs irrégulières ; idem pour les points de nez balancés et les développés.

## Décision

- **Saisies** (projet sérialisé) : mm entiers, validés par zod ; angles en degrés.
- **Calculs** : float64 en mm, angles en **radians** ; aucun arrondi intermédiaire. Tolérance géométrique `EPS = 1e-6 mm`.
- **Affichage** : arrondi au 0,1 mm pour les cotes de fabrication, au mm pour les cotes d'implantation (paramètre).
- **Fabrication** : si l'atelier exige des cotes entières (ex. hauteurs de marche), une **répartition d'arrondi** explicite (méthode du plus fort reste) garantit Σ h_i = H exactement.
- Les tests par propriétés vérifient les invariants à `EPS` près.
