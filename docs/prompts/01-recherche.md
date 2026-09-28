# Prompt 1 — Recherche approfondie (à lancer AVANT tout code)

> But : produire `docs/SPEC.md` + `docs/research/*.md`, sources citées, qui serviront d'entrée au prompt 2.
> Mode conseillé : deep-research (ou un workflow « fan-out » d'agents de recherche, un par axe ci-dessous, puis un agent de synthèse).

---

Tu es un ingénieur-chercheur spécialisé en conception d'escaliers (menuiserie, métallerie, serrurerie) et en logiciels de CAO paramétrique. Je prépare **Blondel**, un logiciel web de conception paramétrique d'escaliers (bois, métal, mixte) avec vue 3D texturée, plan 2D coté et développés de fabrication.

Mène une recherche approfondie sur les axes suivants. Pour chaque affirmation chiffrée (dimension, tolérance, charge), **cite la source** (norme + article, ou document technique) et indique son niveau de confiance. Signale explicitement ce qui est « usage de métier » vs « exigence normative ». Contexte réglementaire : **France en priorité**, puis Eurocodes / EN pour l'Europe.

## Axe A — Règles de dimensionnement
1. Loi de Blondel (2h + g), plages usuelles selon usage (habitation, ERP, extérieur, escalier de service, échelle de meunier), hauteur de marche, giron, emmarchement, reculement, échappée (headroom), ligne de foulée (position selon l'emmarchement), giron minimal au collet pour les marches balancées.
2. Paliers : dimensions minimales, nombre max de marches par volée.
3. Normes et textes à identifier et résumer : NF DTU 36.3 (escaliers bois et garde-corps associés), NF P01-012 / NF P01-013 (garde-corps : hauteurs, zone de stationnement précaire, espacements, essais), textes accessibilité (logements neufs, ERP, PMR : mains courantes, contremarches, nez contrastés, bandes d'éveil), Eurocodes 1 (charges d'exploitation escaliers / garde-corps), 3 (acier), 5 (bois). **Vérifie les numéros et versions en vigueur.**
4. Construis une table machine-lisible (YAML ou JSON) des règles, avec : identifiant, description, formule, valeurs min/max/recommandées, contexte d'application, source, sévérité (bloquant / avertissement / conseil).

## Axe B — Typologies et géométrie
1. Typologies de tracé : droit, quart tournant (bas/haut/milieu), deux quarts tournants, demi-tournant, balancé, hélicoïdal (fût central, à jour central, sur limon), escalier à palier(s), multi-volées hétérogènes, pas japonais / décalés, échelle de meunier.
2. **Méthodes de balancement** des marches (herse, méthode proportionnelle, méthodes graphiques traditionnelles, approches algorithmiques/optimisation) : décris chaque méthode sous forme d'algorithme implémentable (entrées, sorties, pseudo-code), leurs contraintes (giron au collet, régularité sur la ligne de foulée, continuité du limon) et leurs défauts.
3. Géométrie des limons et mains courantes : limon droit, limon courbe/hélicoïdal, raccordements (quart tournant sur limon), **développés** (dépliage d'un limon hélicoïdal, gabarit de main courante courbe, tracé des mortaises), délardement.
4. **Limon porteur débillardé** (limon continu qui suit le tournant, qu'il soit balancé ou hélicoïdal) : géométrie exacte de la surface gauche, courbes de rive haute et basse, raccord tangent avec les parties droites, choix du découpage en tronçons (par quart tournant ou autre) et positionnement des joints, développés de chaque tronçon (gabarits de découpe, lignes de roulage ou de cintrage, repères d'assemblage).

## Axe C — Structures et assemblages
1. Bois : **limon débillardé** (massif en plusieurs pièces assemblées par quartiers, lamellé-collé cintré sur gabarit, sections et essences adaptées, assemblages entre tronçons : enture, boulon d'escalier, tourillons), limon à la française (marches encastrées), limon à l'anglaise (crémaillère), limon central, marches en porte-à-faux (murales), escalier suspendu, contremarches, nez de marche, assemblages (tenons, boulons, tirants, fausses marches), poteaux (départ, arrivée, intermédiaires).
2. Métal : **limon porteur débillardé soudé** (tôle découpée ou roulée par quartiers puis soudée bout à bout, profil cintré, reprise des déformations de soudure, tolérances, gabarit de soudage), limon en plat / tube, **limon en profilé du commerce UPN / IPN / IPE / HEA** (économique : pas de découpe laser, marches posées sur cornières ou platines soudées, possibilité de cintrer un UPN, limites esthétiques et géométriques), limon central (poutre caisson, tube), crémaillère, **supports de marche** (cornières, platines, consoles, tôle pliée en « Z » / « U » / auto-porteuse), marches en tôle pliée, caillebotis, tôle larmée, bois sur ossature métal, assemblages (soudure, boulonnage), fixations murales et dalle.
3. Garde-corps et rambardes : barreaudage vertical/horizontal (lisses), câbles inox, verre (pincé, sur platines), tôle perforée, remplissage bois ; main courante (sections, fixations, continuité, prolongements) ; conformité anti-escalade.
4. Pour chaque solution : paramètres géométriques pertinents, contraintes de fabrication (longueurs de barres, rayons de pliage mini selon épaisseur, épaisseur des bois, sens du fil), ordres de grandeur de portée/flèche.
5. **Coûts comparés** : pour un même escalier (droit, quart tournant, hélicoïdal), ordres de grandeur matière + main-d'œuvre + sous-traitance (laser, pliage, cintrage, galvanisation, thermolaquage) selon la solution : profilé UPN/IPN du commerce, plat découpé laser, limon débillardé soudé, bois massif, lamellé-collé. Quels postes pèsent le plus, et comment un logiciel peut aider à les réduire (standardiser les sections, limiter les pièces uniques, calepiner les tôles).

## Axe D — État de l'art logiciel
1. Logiciels concurrents (ex. StairDesigner, Compass Software, StairCon, Stairbiz, modules escaliers de Cadwork / TopSolid / SEMA / Palette CAD, configurateurs web de fabricants) : fonctions, flux utilisateur (comment initialisent-ils le projet ? trémie ? plan ?), sorties (plans, CNC, devis), points forts / faiblesses.
2. Bibliothèques web pertinentes et leurs limites : rendu 3D (three.js, react-three-fiber, Babylon), noyaux géométriques (OpenCascade.js / replicad, manifold-3d, JSCAD, CGAL wasm), 2D/export (DXF writers, SVG, PDF), BIM (IFC via web-ifc / IfcOpenShell wasm), textures PBR libres de droits (ambientCG, Poly Haven).
3. Formats d'échange utiles au métier : DXF (atelier, découpe laser/plasma, pliage), STEP (CAO), IFC (BIM), PDF coté, CSV/Excel (débit/nomenclature), éventuellement formats CNC bois (BTL/BTLx).

## Livrables attendus
- `docs/research/A-regles.md`, `B-geometrie.md`, `C-structures.md`, `D-etat-de-l-art.md` (sources en fin de fichier).
- `docs/research/rules.yaml` : table des règles de l'axe A.4.
- `docs/SPEC.md` : synthèse fonctionnelle priorisée (MVP / V1 / V2), glossaire FR↔EN des termes du métier (limon, giron, collet, emmarchement, échappée, trémie, crémaillère, délardement…), liste des **questions ouvertes** et des points où les sources se contredisent.

Ne code rien à ce stade.
