# Challenge de la conception — synthèse et décisions

> 2026-09-28. Trois relecteurs indépendants (architecture, géométrie, produit) ont critiqué `docs/prompts/02-conception-dev.md` et `docs/SPEC.md` ; texte intégral dans [`CHALLENGE-panel.md`](CHALLENGE-panel.md). Ce document donne **la décision retenue** pour chaque point. Les décisions durables sont reprises dans `docs/adr/`. Les points qui demandent un arbitrage de l'utilisateur ou un atelier pilote sont dans `docs/LEDGER.md` §2.

Légende : ✅ adopté · 🔀 adopté avec adaptation · ⏳ reporté (jalon indiqué) · ❓ à arbitrer par l'utilisateur.

## A. Architecture

| # | Challenge | Décision |
|---|---|---|
| A1 | « mm entiers en interne » est incompatible avec Σh = H et les girons égaux (2 650 / 15 = 176,67) | ✅ **Dérogation au prompt** : saisies en mm entiers, calcul en float64, radians en interne, arrondi unique en sortie par plus fort reste. [ADR-0003](adr/0003-unites.md) |
| A2 | `rules.yaml` n'est pas exécutable (langage naturel, tables externes, quantificateurs, définitions) | ✅ YAML = métadonnées et seuils ; un évaluateur TS par règle ; toute règle active sans évaluateur apparaît `non-evaluee`. [ADR-0004](adr/0004-moteur-de-regles.md) |
| A3 | Le pipeline n'est pas linéaire (variante M3 selon la structure, E selon les limons, K8 selon l'échappée) | 🔀 Les choix structurants sont des **entrées** (`stair.structure.kind`, lu par le découpage pour la variante M3) ; E = emmarchement **utile** entre faces internes, les limons sont hors emprise utile ; les boucles (nombre de balancées, pivot K8) sont des solveurs locaux bornés. Pas de rétroaction globale. [ADR-0002](adr/0002-modele-et-pipeline.md) |
| A4 | Le mode expert n'a ni identité stable ni politique d'invalidation | ✅ Surcharges typées et persistées (`nosingOverrides` : nez fixe, angle imposé) ; surcharge dont l'ancre disparaît = **orpheline**, affichée, jamais appliquée en silence. Édition libre de la ligne de foulée → V1. |
| A5 | Trois représentations (analytique, manifold, OCCT) = triplement de code | ✅ Représentation unique `SolidDesc` + `FlatPattern` produite par le cœur ; pas de manifold au MVP, OCCT seulement pour STEP (V1). [ADR-0001](adr/0001-noyau-geometrique.md) |
| A6 | « < 100 ms » sans périmètre ni mesure | ✅ Référence : quart tournant 16 marches, 2 limons, 30 barreaux. Budget : cœur analytique ≤ 15 ms, maillage ≤ 30 ms, mesurés par un test de performance en CI ; pas de worker au MVP. [ADR-0006](adr/0006-performance.md) |
| A7 | Invariants de test mal posés (« giron monotone » ; « absence d'intersection » alors que les assemblages s'interpénètrent) | ✅ Générateurs contraints (H ∈ [2 200 ; 3 500], E ∈ [700 ; 1 200]…) ; propriétés : Σh = H, girons égaux à 1e-6, K5 des deux côtés, collets > 0 et monotones (K3), F strictement croissante, stabilité après sérialisation. Interférences : liaisons explicites (`Joint`) au jalon 3, test booléen réservé à quelques escaliers de référence. |
| A8 | Persistance : lien partageable sans serveur | ✅ Projet compressé dans le fragment d'URL (V1) ; barèmes et capacités dans un **profil d'atelier** séparé du projet. |
| A9 | r3f / zustand : état dérivé et fuites GPU | ✅ Le store ne contient que le `Project` ; `Model` dérivé mémoïsé ; géométries three libérées à chaque régénération. [ADR-0005](adr/0005-etat-et-ui.md) |

## G. Géométrie et algorithmes

| # | Challenge | Décision |
|---|---|---|
| G1 | « bords libres puis Γ = offset(C_i) » ne tient pas (S/Z, emmarchement variable, auto-intersections) | ✅ **Topologie explicite** : `LayoutSpec` = volées + tournants typés (déjà le cas) ; C_i, C_e et Γ construits **en forme fermée par tournant** (droite / arc r_j + d_f / droite), sans offset générique. S/Z : transition de Γ quand E > 1 200 → question ouverte. |
| G2 | M1 ambigu au droit de la marche d'angle | ✅ M1 = profil de collets en V produisant directement σ_k (formule du relecteur), puis post-traitement commun. |
| G3 | M3 sous-spécifié (quart bas/haut sans partie droite, asymétrie, U court, collet en corde) | ✅ Zone avec extrémités `tangent` / `free` ; F'max échantillonné hors cas symétrique ; inversion par dichotomie ; choix de zone par énumération (n_avant, n_après) **maximisant le collet mesuré en corde** ; U à volée centrale < 1 giron = zone unique de 180°. Contrat `BalancingStrategy.solve → σ | φ | échec`. |
| G4 | Échappée sur Γ rend K8 sans effet ; l'escalier sous lui-même est ignoré | ✅ Deux grandeurs : échappée réglementaire exacte sur Γ (minimum aux sorties de trémie) et échappée **sur la largeur des marches** (avertissement, objectif de K8). Plafonds = dalle − trémie au MVP ; auto-recouvrement (hélicoïdal, U) au jalon 5. |
| G5 | Développé de tôle pliée sans loi de pli (erreur 10 à 20 mm par marche) | ✅ Loi de pli dans le profil d'atelier (facteur K, DIN 6935 ou table de déduction) ; développé en fibre neutre ; lignes de pli avec sens, angle, r_int. ⏳ J3. Validation par un plieur pilote (LEDGER). |
| G6 | Développés de limons : face ou fibre neutre, largeur au collet | ✅ Chaque développé déclare sa fibre de référence ; contrôle de largeur perpendiculaire mini et de bois entre mortaises. ⏳ J3/J5. |
| G7 | Débillardé : préconditions et optimisation sur données absentes | ✅ Débillardé ⇒ jour en arc (ou clothoïde) ; découpage en tronçons par **règles simples** en V1 (coupe aux naissances décalée, coupe au milieu si hors format) ; programmation dynamique en V2. |
| G8 | L'assistant est un problème inverse | ✅ Énumération explicite (typologie × sens × position du tournant × n × g), filtrage par règles bloquantes et échappée, score affiché. Cas d'acceptation = test de bout en bout (« droit rejeté pour échappée »). |

## P. Produit et priorisation

| # | Challenge | Décision |
|---|---|---|
| P1 | Le critère n° 1 n'est vérifiable qu'après le jalon 4 et reste ambigu sur le limon de jour | ✅ Critère précisé : quart tournant bas, **limon à la française avec poteau d'angle**, H 2 700, trémie 2 800 × 900, E 800, bois_dtu + logement, garde-corps barreaudé côté vide ; validé en fin de J4. Critères intermédiaires par jalon (voir ci-dessous). « 2 minutes » mesuré par Playwright en nombre d'interactions. |
| P2 | Le comparateur ne compare pas « un même tracé » et ne peut pas chiffrer sans temps d'atelier | ✅ Même **épure** (site, ligne de foulée, n) ; raccord de jour et balancement recalculés par variante, écarts affichés. Grandeurs physiques d'abord (kg, m², pièces, pièces uniques, gabarits, cordons, plis, EXC) ; euros seulement si un profil d'atelier est renseigné. |
| P3 | « Conforme » est juridiquement exposé (53 règles de sources secondaires) | ✅ La sortie s'appelle **« contrôle de conception »** ; chaque ligne affiche nature, confiance, source secondaire ; règles non évaluées listées ; option **règles de l'art** active par défaut (valeurs DTU en avertissement quand `bois_dtu` n'est pas actif). |
| P4 | Jalons 3 et 5 surchargés | ✅ Redécoupage : **J3a** bois (française, anglaise, poteau) ; **J3b** métal (plat laser, tôle pliée, supports) ; **J3c** profilés UPN/IPN/IPE/HEA, prédimensionnement, nomenclature, grandeurs de coût. **J5a** hélicoïdal ; **J5b** débillardé soudé ; **J5c** débillardé bois / lamellé (V2 tant que Q15–Q17 ouverts). |
| P5 | Aucun prédimensionnement structurel | ✅ Module `precheck` indicatif au J3c (poutre inclinée, charges AN, flèche, contrainte, f₁), libellé « ne remplace pas une note de calcul ». |
| P6 | DXF « exploitable en atelier » invérifiable | 🔀 Critère automatique : contours fermés, un calque par fonction, relecture par un second parseur à ±0,01 mm. Version DXF : la décision 7bis (AC1021 au MVP) est **maintenue** ; un écrivain R12 minimal reste recommandé (❓ LEDGER). |
| P7 | L'artisan attend d'abord relevé, plan de pose, débit | ⏳ Saisie de relevé (4 côtés + 2 diagonales de trémie) au J2+ ; fiche de pose PDF au J1–J3. |
| P8 | Édition libre des nez au J2 en conflit avec le balancement | ✅ Voir A4 : surcharges typées seulement au J2. |

## Critères intermédiaires par jalon

| Jalon | Critère vérifiable |
|---|---|
| J1 | Escalier droit : plan coté SVG, 3D, contrôle de conception, export DXF/SVG/CSV/JSON ; Σh = H ; perf cœur ≤ 15 ms |
| J2 | Quart tournant, U, demi-tournant balancés (M1, M3), paliers ; propriétés K3/K5 ; cas d'acceptation : droit rejeté pour échappée, quart tournant conforme trouvé par l'assistant |
| J3a | Limons à la française et poteau d'angle : développés DXF 1:1 avec mortaises ; nomenclature |
| J3b | Marche en tôle pliée Z/U : développé en fibre neutre, lignes de pli ; relecture DXF ±0,01 mm |
| J4 | Critère n° 1 complet (garde-corps, PDF + DXF) |
