# ADR-0005 — État applicatif, rendu 2D et 3D

- Statut : accepté (jalon 0)

## Décision

- **État** : zustand. Le store contient le `Project` immuable ; `Model` est dérivé (sélecteur mémoïsé appelant `buildModel`). Undo/redo par **pile de snapshots** du `Project` (partage structurel, coût mémoire négligeable pour quelques Ko de JSON), regroupement des modifications continues (glisser un curseur = 1 entrée).
- **Persistance** : `localStorage` (autosauvegarde), import/export `.blondel.json`, lien partageable = projet compressé dans le fragment d'URL (V1).
- **Plan 2D** : SVG généré par une fonction pure `renderPlanSvg(model, options)` dans `@blondel/exports`, réutilisée à l'écran (React l'insère) et dans les exports SVG/PDF → une seule implémentation de la cotation.
- **3D** : three.js + @react-three/fiber + drei, `MeshStandardMaterial` ; maillages fournis par `@blondel/geometry`.
- **Worker** : non au MVP (calcul analytique < 100 ms, mesuré par un test de performance) ; `buildModel` est pur et sérialisable, donc déplaçable en Web Worker sans refonte.
