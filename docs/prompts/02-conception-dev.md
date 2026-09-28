# Prompt 2 — Conception et développement de Blondel

> Entrées : `docs/SPEC.md`, `docs/research/*` produits par le prompt 1.
> Mode conseillé : Claude Code en **plan mode** pour le jalon 0, puis jalon par jalon (une PR par jalon).

---

Tu es un développeur senior TypeScript spécialisé en CAO paramétrique et rendu 3D web, avec une solide culture de la menuiserie et de la métallerie. Tu construis **Blondel**, un logiciel web de conception paramétrique d'escaliers. Lis d'abord `docs/SPEC.md` et `docs/research/` : ils font foi pour les règles métier et le vocabulaire. En cas de doute sur une règle, n'invente pas : ajoute-la aux questions ouvertes.

## 1. Vision produit
Un artisan (menuisier, métallier) ou un particulier averti saisit son contexte (niveaux, trémie, murs), choisit une typologie, et obtient en temps réel :
- une **vue 3D texturée** (bois, acier brut/peint/galva, inox, verre, béton) ;
- un **plan 2D coté** (vue de dessus avec ligne de foulée, numérotation des marches, balancement) et des **élévations** ;
- les **développés** de fabrication (limons, crémaillères, mains courantes, tôles pliées) ;
- une **nomenclature / fiche de débit** ;
- un **rapport de conformité** (Blondel, échappée, garde-corps, accessibilité) avec alertes en direct.

## 2. Pipeline paramétrique (cœur de l'architecture)
Chaque étape est une fonction pure, sérialisable, testable sans UI :

```
Site ──► Tracé ──► Découpage des marches ──► Structure ──► Garde-corps ──► Solides ──► Vues / Exports
                                                                         └─► Conformité (à chaque étape)
```

1. **Site** : niveaux (hauteur à monter sol fini à sol fini, épaisseurs de revêtement), **trémie** (polygone, épaisseur de plancher), murs porteurs / non porteurs, obstacles (poteaux, fenêtres, portes), plan de masse importable (DXF, ou image calibrée en fond de calque).
2. **Tracé** : ligne de foulée composée de segments (droites, arcs, hélices), volées et paliers ; départ/arrivée contraints par la trémie ; sens de montée ; emmarchement éventuellement variable.
3. **Découpage** : nombre de marches (dérivé de la hauteur et de Blondel), répartition du giron sur la ligne de foulée, **balancement** (plusieurs algorithmes interchangeables via une interface `BalancingStrategy`, cf. recherche axe B), contrôle du giron au collet.
4. **Structure** (système de plugins `StructureKind`) :
   - bois : limon à la française, à l'anglaise (crémaillère), **limon débillardé** (massif par quartiers assemblés, ou lamellé-collé cintré), limon central, marches murales en porte-à-faux, escalier suspendu ;
   - métal : **limon porteur débillardé soudé** (tronçons découpés ou roulés, un par quart tournant, soudés bout à bout), limon plat/tube, **limon en profilé du commerce UPN / IPN / IPE / HEA** (solution économique, choisie dans un catalogue de sections), limon central caisson, crémaillère, **supports de marche** (cornières, consoles, platines), marches en **tôle pliée** (profils Z/U, auto-porteuses), caillebotis, tôle larmée ;
   - mixte : ossature métal + marches bois ;
   - options : contremarches (pleines, ajourées, aucune), nez de marche, débord, poteaux, fixations murales/dalle.
5. **Garde-corps / rambardes** : le long de la volée et autour de la trémie ; barreaudage vertical, lisses horizontales, câbles, verre, tôle perforée, panneaux bois ; main courante (section, côté mur/côté vide, continuité, prolongements, raccords courbes).
6. **Solides** : génération B-rep ou maillage manifold par pièce, chaque pièce portant ses métadonnées (matériau, section, repère de fabrication, opérations d'usinage/pliage).
7. **Vues / Exports** : 3D, plan 2D, élévations, développés, nomenclature, exports fichiers.

## 3. Exigences clés
- **Paramétrique et réactif** : toute modification (hauteur, trémie, emmarchement, typologie…) regénère le modèle en < 100 ms pour un escalier standard (calcul en Web Worker si nécessaire).
- **Assistant d'initialisation** : à partir de la hauteur à monter + trémie + murs, proposer automatiquement les typologies compatibles, classées par score de confort (Blondel, régularité, échappée), avec aperçu.
- **Modes** : « assistant » (guidé, peu de paramètres) et « expert » (tous les paramètres, édition directe des points de la ligne de foulée et des marches dans le plan 2D).
- **Conformité** : moteur de règles alimenté par `docs/research/rules.yaml` (profil sélectionnable : habitation, ERP, extérieur, service) ; chaque règle renvoie OK / avertissement / bloquant, localisée sur la pièce ou la marche concernée, visible en 2D et en 3D.
- **Unités** : millimètres entiers en interne ; affichage mm/cm/m ; angles en degrés.
- **Persistance** : projet = JSON versionné (schéma validé, migrations), undo/redo illimité, sauvegarde locale, export/import de fichier, lien partageable.
- **Exports** : PDF coté (plan + élévations + développés + nomenclature), DXF par pièce (découpe laser/plasma, CNC), SVG, STEP ou glTF pour la 3D, CSV de débit ; IFC en V2.
- **Coûts** : estimation matière + façonnage par pièce (poids d'acier, m³ de bois, longueurs de soudure, nombre de plis, surface à découper ou à traiter), et **comparateur de variantes** pour un même tracé (ex. UPN du commerce, plat laser ou limon débillardé soudé ; bois massif ou lamellé-collé). Barèmes de prix modifiables par l'utilisateur.
- **Limon débillardé** : découpage automatique en tronçons (par quart, ou longueur maxi de tôle ou de bois), joints placés hors des zones de marche, développé de chaque tronçon avec lignes de roulage ou de cintrage, préparation des soudures et repères d'assemblage.
- **Rendu 3D** : matériaux PBR (essences de bois avec sens du fil cohérent sur chaque pièce, acier, inox brossé, verre), éclairage d'ambiance, ombres, vue éclatée, coupe, mesure, isolation d'une pièce, cotation 3D.

## 4. Stack imposée (sauf objection argumentée dans un ADR)
- TypeScript strict, Vite, pnpm, monorepo :
  - `packages/core` : modèle, pipeline, règles, algorithmes — **zéro dépendance DOM** ;
  - `packages/geometry` : génération de solides et développés (choisir entre manifold-3d et OpenCascade.js/replicad via un ADR comparant précision, poids wasm, exports STEP, performances) ;
  - `packages/exports` : PDF, DXF, SVG, CSV, glTF/STEP ;
  - `apps/web` : React + react-three-fiber + drei, état via zustand (ou équivalent), plan 2D en SVG.
- Tests : vitest ; **tests par propriétés** (fast-check) sur le cœur : somme des hauteurs = hauteur à monter, giron monotone sur la ligne de foulée, absence d'intersection entre pièces, échappée respectée, etc. ; tests de non-régression sur des escaliers de référence (snapshots des cotes et des développés) ; Playwright pour quelques parcours UI.
- Schémas : zod pour le JSON projet.

## 5. Jalons
0. **Cadrage** : ADRs (noyau géométrique, état, rendu 2D), modèle de données complet, interfaces des plugins, arborescence du monorepo. Présente-moi le plan avant de coder.
1. **Cœur droit** : site minimal (hauteur + trémie rectangulaire), escalier droit, calcul Blondel, plan 2D coté, 3D non texturée, conformité de base.
2. **Tournants** : quart tournant, deux quarts, demi-tournant, paliers, balancement (≥ 2 algorithmes), édition de la ligne de foulée en 2D.
3. **Structures** : limons bois (française, anglaise), limon métal plat et **UPN/IPN** (catalogue de profilés), supports de marche, tôle pliée ; développés des limons et des tôles ; nomenclature et premier chiffrage.
4. **Garde-corps** : volée + trémie, remplissages, main courante, conformité NF P01-012.
5. **Débillardé, hélicoïdal et multi-volées** : **limon porteur débillardé** (métal soudé par quartiers, bois massif ou lamellé-collé), hélicoïdal (fût central, à jour), enchaînements hétérogènes, limon et main courante hélicoïdaux avec développés ; comparateur de coût entre variantes.
6. **Rendu et exports** : textures PBR, exports PDF/DXF/SVG/CSV/glTF, impression.
7. **Import de plan** : DXF de plan de masse, image calibrée, détection/tracé assisté de la trémie et des murs.

Chaque jalon : code + tests verts + un escalier d'exemple dans `examples/` + mise à jour de `docs/`.

## 6. Critères d'acceptation globaux
- Un escalier quart tournant bois standard (hauteur 2 700 mm, trémie 2 800 × 900) est conçu en moins de 2 minutes via l'assistant, conforme, et exporté en PDF + DXF.
- Pour un quart tournant balancé, le comparateur affiche côte à côte la variante UPN et la variante limon débillardé soudé, avec poids, nombre de pièces et coût estimé.
- Les développés DXF d'un limon (y compris chaque tronçon d'un limon débillardé) et d'une marche en tôle pliée sont directement exploitables en atelier (cotes réelles, lignes de pli repérées, repères de pièce).
- Aucun calcul métier dans les composants UI.
- Toute règle de conformité est traçable jusqu'à sa source dans `docs/research/`.

## 7. Façon de travailler
- Commence par lire la SPEC et lister tes questions ; ne suppose pas une règle métier non documentée.
- Petits commits, une PR par jalon, description claire.
- Si une exigence te paraît irréaliste ou mal priorisée, dis-le et propose une alternative.
