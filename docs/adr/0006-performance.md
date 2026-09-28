# ADR-0006 — Budget de performance

- Statut : accepté (jalon 0) — précise le prompt 2 §3 (« < 100 ms »)

## Décision

- Escalier de référence : quart tournant balancé, 16 hauteurs, 2 limons, garde-corps de 30 barreaux.
- Budget sur le thread principal, machine de CI : **cœur analytique (`buildModel`) ≤ 15 ms**, **maillage d'aperçu ≤ 30 ms**, rendu ≤ 1 image.
- Mesure : test vitest dédié (médiane de 20 exécutions, seuil ×3 en CI pour absorber la variance), escaliers de référence dans `examples/`.
- Mémoïsation par étage (identité des sous-objets du projet immuable).
- Web Worker seulement si le budget est dépassé ou pour les tâches lourdes (assistant par énumération, export STEP).
