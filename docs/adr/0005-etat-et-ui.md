# ADR-0005 — État applicatif, rendu 2D et 3D

- Statut : accepté (jalon 0) ; **amendé le 2026-09-29** (calcul du `Model` en Web Worker, voir « Amendement » ; la décision « Worker : non au MVP » est remplacée)

## Décision

- **État** : zustand. Le store contient le `Project` immuable ; `Model` est dérivé du projet (à l'origine : sélecteur mémoïsé appelant `buildModel` ; depuis l'amendement : calculé dans un Web Worker, voir plus bas). Undo/redo par **pile de snapshots** du `Project` (partage structurel, coût mémoire négligeable pour quelques Ko de JSON), regroupement des modifications continues (glisser un curseur = 1 entrée).
- **Persistance** : `localStorage` (autosauvegarde), import/export `.blondel.json`, lien partageable = projet compressé dans le fragment d'URL (V1).
- **Plan 2D** : SVG généré par une fonction pure `renderPlanSvg(model, options)` dans `@blondel/exports`, réutilisée à l'écran (React l'insère) et dans les exports SVG/PDF → une seule implémentation de la cotation.
- **3D** : three.js + @react-three/fiber + drei, `MeshStandardMaterial` (depuis le jalon 6 : `MeshPhysicalMaterial` et textures procédurales, voir `docs/ARCHITECTURE.md`) ; maillages fournis par `@blondel/geometry`.
- ~~**Worker** : non au MVP (calcul analytique < 100 ms, mesuré par un test de performance) ; `buildModel` est pur et sérialisable, donc déplaçable en Web Worker sans refonte.~~ Remplacé par l'amendement ci-dessous.

## Amendement (2026-09-29) — `Model` calculé dans des Web Workers

- **Motif** : budget de ADR-0006 dépassé dans le navigateur (ledger, jalon 1 : 40 à 54 ms par modèle sur le fil principal contre 15 ms visés ; tâches longues mesurées par l'e2e, budget 200 ms). ADR-0006 prévoyait ce basculement (« Web Worker seulement si le budget est dépassé ou pour les tâches lourdes »).
- **Décision** : le `Model` est calculé hors du fil principal, dans `apps/web/src/model/model.worker.ts` (deux instances : modèle courant et comparateur de variantes), et l'assistant d'initialisation dans `model/assistant.worker.ts`. Le store (`store/modelStore.ts`, `modelService`) envoie la **dernière demande seulement** (`latestRunner.ts`) ; le worker applique un **partage structurel** du projet reçu (`structuralShare.ts`) pour que les caches par identité de `buildModel` servent malgré le clonage de `postMessage` ; toute erreur rend une réponse « error » ; **repli sur le fil principal** quand aucun worker n'est disponible (tests, environnements sans `Worker`).
- **Conséquences** : pendant un calcul, le dernier modèle publié reste affiché avec le projet dont il est issu (`pending`) ; les exports sont désactivés tant que le modèle ne correspond pas au projet courant. Les composants ne calculent rien : ils lisent le `Model` (y compris le prédimensionnement, `Model.precheck`) ; `apps/web/src/architecture.test.ts` interdit les étapes du pipeline dans les composants, les vues, et les fonctions de `lib/` qu'ils importent. Détail du flux : `docs/ARCHITECTURE.md` § Flux de données.
