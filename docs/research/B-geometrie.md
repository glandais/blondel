# Axe B — Typologies et géométrie

> Projet **Blondel** — recherche, axe B (typologies de tracé, balancement, géométrie des limons et mains courantes, limon porteur débillardé).
> Rédigé le 2026-09-28. Entrée du prompt 2 (spécification puis code).

## 0. Mode d'emploi du document

### 0.1 Étiquettes

Chaque affirmation porte une ou plusieurs étiquettes :

| Étiquette | Sens |
|---|---|
| **[NORME]** | Exigence normative ou réglementaire, citée par un texte officiel ou par un guide d'application qui le reproduit. |
| **[USAGE]** | Usage de métier : règle de l'art, pratique d'atelier, choix courant d'un logiciel ou d'un fabricant. Ce n'est pas une obligation. |
| **[ANALYSE]** | Dérivation mathématique ou proposition d'algorithme faite pour Blondel à partir de principes géométriques. Aucune source ne la donne telle quelle. À valider par des tests et par un professionnel. |
| **Confiance : élevée / moyenne / faible** | Élevée : source primaire ou guide officiel lu. Moyenne : source secondaire sérieuse, ou reconstruction cohérente de plusieurs sources. Faible : extrait isolé, source commerciale, ou information non recoupée. |

Les références `[n]` renvoient à la section **Sources** en fin de fichier.

### 0.2 Accès aux normes

- **NF DTU 36.3** (P1-1, P1-2, P2, P3, septembre 2014, indice P21-220) est payant (AFNOR). Il est toujours en vigueur à la date de consultation [38] (vérifié). Je ne l'ai pas lu directement. Les valeurs DTU citées ici viennent du **guide d'application AFEB / FIBC (janvier 2016)** [1], qui en reproduit les points principaux avec renvois aux chapitres. En particulier, l'**annexe A du P3** (escaliers hélicoïdaux et « gain de place ») n'est pas reproduite dans ce guide. Ses valeurs restent donc **à confirmer**.
- **DIN 18065:2020-08** est payante ; elle remplace l'édition 2015-03 et reste l'édition en vigueur (DIN Media [39], vérifié). La page trepedia [5] ne précise pas l'édition qu'elle résume. Elle est citée via des sources secondaires allemandes (trepedia [5], résultats de recherche) et sert de comparaison, car la France n'a pas d'équivalent public aussi détaillé sur le balancement.
- **IRC** (États-Unis) et **Approved Document K** (Royaume-Uni) servent de points de comparaison internationaux.

### 0.3 Notations communes (utilisées dans tout le document)

| Symbole | Définition |
|---|---|
| `H` | hauteur à monter (sol fini à sol fini) |
| `n` | nombre de hauteurs de marche (contremarches) ; `h = H / n` |
| `n_g` | nombre de girons. Usage courant : `n_g = n − 1` quand la dernière marche est le palier d'arrivée |
| `Γ` | ligne de foulée (courbe plane), abscisse curviligne `s ∈ [0, L_f]` |
| `g` | giron sur la ligne de foulée, `g = L_f / n_g` (équipartition) |
| `P_k` | point du nez `k` sur la ligne de foulée : `P_k = Γ(s₀ + k·g)` |
| `ℓ_k` | ligne de nez `k` en plan : droite passant par `P_k`, de direction unitaire `u_k` |
| `C_i`, `C_e` | courbes en plan des faces des limons intérieur (côté jour) et extérieur (côté mur), abscisses `σ_i`, `σ_e` |
| `Q_k`, `R_k` | intersections `ℓ_k ∩ C_i` et `ℓ_k ∩ C_e` |
| `c_k` | collet de la marche `k` : longueur de `C_i` entre `Q_k` et `Q_{k+1}` (ou corde, suivant la convention, voir §2.3) |
| `z_k` | altitude du nez `k` : `z_k = k·h` (hors marche de départ) |
| `E` | emmarchement (distance entre faces internes des limons) |

---

## 1. Typologies de tracé

### 1.1 Tableau de synthèse

| Typologie | Description géométrique | Paramètres de tracé (modèle Blondel) | Remarques et sources |
|---|---|---|---|
| **Droit** | Une volée rectiligne, marches perpendiculaires à la ligne de foulée. | longueur, emmarchement, `n`, `h`, `g`, départ et arrivée | Cas de base. Au plus **25 marches sans palier** selon le DTU 36.3 [1] **[NORME]**, confiance élevée (via guide). |
| **Quart tournant bas / haut / médian** | Deux volées à 90° reliées par des marches tournantes (sans palier), placées en bas, en haut ou au milieu. | position du tournant (indice de marche ou longueurs de volées), sens (gauche/droite), forme du jour (angle vif, poteau, arc de rayon `r_j`, pan coupé) | Les trois dénominations « quartier tournant bas / haut / médian » sont d'usage courant en enseignement [8] **[USAGE]**, confiance élevée. |
| **Deux quarts tournants** | Trois volées. Deux quarts dans le même sens donnent un « U » ; deux quarts en sens opposés donnent un « S » (ou « Z »). | idem, pour chaque tournant, plus la longueur de la volée intermédiaire | StairDesigner traite les formes U et S comme **deux balancements consécutifs** raccordés par une **marche virtuelle** dans la volée intermédiaire [2] **[USAGE]**, confiance élevée. |
| **Demi-tournant** | Deux volées parallèles, soit reliées par un palier, soit par des marches balancées sur 180° (« double quartier tournant »). | largeur de jour (0 = mur d'échiffre ou noyau), rayon, marche d'angle | Pour le balancement, on coupe le demi-tour par une ligne à 90° et on calcule chaque moitié comme un quart tournant [8] **[USAGE]**, confiance élevée. |
| **Balancé** (qualificatif) | Des marches **dansantes** : la ligne de nez ne passe plus par le centre du tournant. Le balancement déborde sur des marches des parties droites. | méthode de balancement et ses paramètres (§3) | Marche dansante : « marche d'angle et celle qui la précède, et qui portent toutes deux plus de largeur d'un bout que de l'autre » [33]. Balanced / dancing steps : les nez « ne convergent pas vers le même point » [34]. |
| **Rayonnant** (opposé du balancé) | Les lignes de nez du tournant passent par le centre du tournant. | centre, secteur angulaire | Plus simple, mais collet étroit, voire nul si le jour est à angle vif [9][35] **[USAGE]**. |
| **Hélicoïdal à fût (noyau) central** | Marches rayonnantes encastrées ou fixées sur un fût vertical. La ligne de nez est portée par un rayon. | rayon extérieur `R_e`, rayon du fût `r_f`, angle par marche `Δθ`, sens, angle total | Rotation constante, pas de balancement. Ligne de foulée : voir §2.2, les sources divergent (à 50 ou 60 cm de l'axe). |
| **Hélicoïdal à jour central** | Limon intérieur hélicoïdal de rayon `r_j > 0` (jour) et limon extérieur hélicoïdal ou mur. | `r_j`, `R_e`, `Δθ` | Les deux limons sont des bandes hélicoïdales. Leur face est un cylindre développable (§4.3). |
| **Hélicoïdal sur limon central** | Une poutre hélicoïdale (crémaillère, caisson, tube) porte les marches en leur milieu. | rayon de l'axe du limon, section, `Δθ` | Pour le métal, courbure et torsion de l'hélice fixent les paramètres de cintrage (§4.3). |
| **Escalier à palier(s)** | Volées séparées par des paliers (droits, d'angle, de demi-tour). | position du palier (entre deux nez), profondeur, forme | StairDesigner découpe l'escalier en **interpaliers**, chacun avec sa hauteur et son giron [2] **[USAGE]**. |
| **Multi-volées hétérogènes** | Volées d'emmarchement, d'angle ou de sens différents, cage à bords non parallèles. | par volée : longueur sur un côté de référence, largeur, angle avec la volée précédente | StairDesigner saisit la cage volée par volée (longueur, largeur, angle), jusqu'à **7 volées**, qui ne doivent pas se recouper en vue de dessus [2] **[USAGE]**, confiance élevée. |
| **Pas japonais / pas décalés** (« gain de place ») | Marches alternées gauche/droite : un pied par marche, pente forte. | pente, giron effectif par pied, largeur | Le DTU 36.3 P3 **annexe A** donne des « spécifications particulières » pour les escaliers gain de place et hélicoïdaux [1] **[NORME]** (contenu non accessible, **à confirmer**). Pente d'environ 45 à 60° selon une source commerciale **[USAGE]**, confiance faible. |
| **Échelle de meunier** | Escalier droit très raide, souvent sans contremarches, sur deux limons. | pente, giron, hauteur, largeur | **Hors du domaine d'application du DTU 36.3** [1] **[NORME]**, confiance élevée. Pente usuelle de 60 à 75°, giron d'au moins 20 cm, largeur de 60 à 80 cm [25] **[USAGE]**, confiance faible (source commerciale). Pour l'accès aux machines, l'ISO 14122-3:2016 classe les « échelles à marches » entre 45 et 75° (de préférence 45 à 60°) et les escaliers entre 20 et 45° [26][43] **[NORME]** (domaine machines seulement), confiance moyenne. La page [26] ne donne pas ces angles ; ils viennent de résultats de recherche citant ISO et L'Échelle Européenne ; norme non lue. |

### 1.2 Raccords de jour (géométrie du tournant côté intérieur)

StairDesigner propose trois formes de raccord entre deux volées successives [2] **[USAGE]**, confiance élevée :

- **Poteau** : il reçoit les deux limons.
- **Raccord circulaire** : défini par un rayon, intérieur et/ou extérieur (exemple : 200 mm à l'intérieur, 500 mm à l'extérieur). Ce raccord est un limon « **débillardé qui ne peut être usiné à plat** ».
- **Pan coupé** : défini par un « retrait haut » et un « retrait bas » à partir du point de jonction. On ne peut alors pas placer de poteau dans ses angles.

**Proposition de modèle Blondel [ANALYSE]** : représenter chaque bord (jour, mur) par une **courbe plane composée** de segments, d'arcs et, en option, de **clothoïdes de raccord**. Les clothoïdes sont justifiées au §5.3 : elles permettent un raccord tangent des deux faces d'un limon débillardé. La ligne de foulée s'en déduit par décalage (§2.1).

### 1.3 Modèle de données minimal proposé [ANALYSE]

```text
Escalier
  hauteurTotale H, nbContremarches n (ou h cible), départ, arrivée
  bordJour  : Courbe2D (segments | arcs | clothoïdes | poteaux ponctuels)
  bordMur   : Courbe2D
  lignesFoulée : dérivée (règle §2.1) ou imposée
  paliers   : liste {sDebut, sFin} sur Γ (interpaliers : h et g propres)
  marchesFixes : liste {k, u_k imposé}   // première, dernière, marche palière, marche sous trémie…
  balancement : {méthode, paramètres} par zone entre deux marches fixes
  limons    : {type (français / anglais / central / aucun), épaisseur, largeur, dépassements}
  mainsCourantes : {côté, hauteur, section, décalage}
```

---

## 2. Ligne de foulée et mesure du giron

### 2.1 Position de la ligne de foulée (France, bois)

- **[NORME]** Selon le DTU 36.3, la ligne de foulée est **au milieu de l'emmarchement si celui-ci est ≤ 1,20 m**, et **à 0,60 m de la rampe (côté intérieur) si l'emmarchement dépasse 1,20 m** [1]. Confiance élevée (guide AFEB, renvoi RC 6-3 ; texte revérifié mot pour mot).
- **[NORME]** Le giron se mesure « sur la ligne de foulée pour les parties droites et **sur l'arc de cercle dont le centre est le point à l'intersection des faces internes des limons** pour les parties tournantes » [1]. Confiance élevée.
  - Conséquence géométrique **[ANALYSE]** : dans un tournant à angle vif, la ligne de foulée est exactement la **courbe décalée** (offset) du bord intérieur à la distance `d_f`. Le décalage d'un coin convexe est un arc centré sur le coin. On calcule donc la ligne de foulée comme `Γ = offset(C_i, d_f)`, avec `d_f = E/2` si `E ≤ 1,20 m`, sinon `d_f = 0,60 m` mesurés depuis la main courante intérieure. Pour un jour courbe de rayon `r_j`, l'offset est un arc de rayon `r_j + d_f`, ce qui est cohérent avec la règle.
- **[NORME]** Tolérance du giron : **± 5 mm sur marche droite, ± 10 mm sur marche balancée** par rapport à la valeur nominale. Giron minimal de **190 mm**. Module `2h + g` compris entre **580 et 660 mm** sur la ligne de foulée (au moins 600 mm exigés en ERP et parties communes de BHC, selon une remarque du guide qui renvoie à la réglementation) [1]. Confiance élevée (revérifié dans [1]). **Attention [ANALYSE, vérification]** : les ± 5 / ± 10 mm sont des **tolérances de mesure par rapport à la valeur nominale** (réception de l'ouvrage), pas une marge de conception. En conception, les girons sur la ligne de foulée doivent être **exactement égaux** ; la tolérance ne sert qu'aux contrôles de fabrication ou de pose.
- **[USAGE]** Beaucoup de sources de métier et de manuels placent la ligne de foulée « à 50 cm du bord intérieur » pour les escaliers tournants [35][14]. Cette règle vient d'usages antérieurs et d'autres normes. Elle **ne correspond pas** à la règle DTU ci-dessus pour un emmarchement de 0,80 à 1,20 m. Confiance moyenne. **À traiter comme un paramètre.**

### 2.2 Cas hélicoïdal et sources contradictoires

Les sources se contredisent sur la position de la ligne de foulée des escaliers tournants et hélicoïdaux. Je ne l'ai pas tranché :

| Source | Position de la ligne de foulée | Statut |
|---|---|---|
| DTU 36.3 (guide AFEB) [1] | milieu si `E ≤ 1,20 m`, sinon 0,60 m du côté intérieur | [NORME], élevée (hors annexe A hélicoïdal, non lue) |
| Fabricant EHI [24] | « à 60 cm du noyau ou du vide central » pour 90 cm d'unité de passage. Cite aussi une « NF P 85-015 » (« 7/10 de la largeur de passage ») et une NF P 21-210 (« milieu pour largeur < 1 m »). EHI note elle-même une **absence de consensus**. **Vérification** : « NF P 85-015 » est très probablement une coquille pour **NF E 85-015** (moyens d'accès permanents des installations industrielles : escaliers, échelles à marches, garde-corps). L'édition d'avril 2008 est remplacée par celle de **juillet 2019** [41] ; ce texte est hors du champ de l'habitat. **NF P21-210** existe bien : c'est la norme AFNOR de **terminologie des escaliers en bois** [40], dont le contenu a été repris par le DTU 36.3 selon une source secondaire | [USAGE], faible. Existence des deux normes vérifiée ; leur contenu (7/10, milieu < 1 m) reste **⚠️ non vérifié** (normes payantes) |
| Accessibilité, circulaire du 30/11/2007 (ancienne réglementation) [23] | **ligne de mesure** du giron suivant la paroi extérieure : à **0,50 m du mur** pour un escalier de 1,20 m, à **0,35 m** pour un escalier intérieur de logement de 0,80 m. Giron ≥ 24 cm | [NORME] historique, moyenne. Les textes en vigueur (arrêté du 24/12/2015 pour les BHC neufs) sont à vérifier par l'axe A |
| Résultats de recherche (fabricants) | « 50 cm de l'axe » ou « 60 cm du fût » pour les hélicoïdaux | [USAGE], faible |

**Conséquence pour Blondel [ANALYSE]** : prévoir **plusieurs lignes de contrôle**. La ligne de foulée de conception sert à l'équipartition des girons. Une ou plusieurs **lignes de mesure réglementaires** (DTU, accessibilité, autre) servent de contrôles indépendants. Ce découplage existe déjà à l'étranger : l'IRC mesure le giron des marches balancées sur une *walkline* à 12 in (305 mm) du côté intérieur [28]. L'Approved Document K (édition 2013, diagramme 1.9) le mesure **au milieu du giron** si l'escalier fait moins de 1 m de large, et **à 270 mm de chaque bord** s'il fait 1 m ou plus [37] (vérifié sur le texte officiel).

### 2.3 Mesure du collet

- **[NORME, étranger]** DIN 18065 : le giron minimal au collet se mesure **en corde**, « à la limite intérieure de la largeur utile » (environ à la face intérieure de la main courante), et pas forcément au bout de la marche [5]. Confiance moyenne (source secondaire).
- **[ANALYSE]** Blondel doit donc pouvoir calculer le collet de deux façons : en longueur d'arc sur la face du limon (utile pour le développé et la fabrication) et en corde sur une ligne décalée (utile pour la conformité).

### 2.4 Valeurs minimales de collet et de régularité : tableau de comparaison

| Référentiel | Collet mini | Régularité | Statut, confiance |
|---|---|---|---|
| NF DTU 36.3 | **Aucune valeur trouvée** dans le guide AFEB. Les sources de métier disent seulement que le collet doit « rester praticable » | giron ± 10 mm sur marche balancée [1] | [NORME] pour la tolérance (élevée). Collet **inconnu, à vérifier dans le P3** |
| DIN 18065:2020-08 [5][39] | **100 mm** en général (escaliers normaux et escaliers en vis). **50 mm** dans les bâtiments d'habitation d'au plus 2 logements ou à l'intérieur d'un logement (0 mm pour les escaliers en vis) | le collet doit **diminuer ou rester constant** vers l'angle. Dans la partie droite, les marches balancées sont limitées à une longueur de **3,5 × a** à partir de l'angle (`a` = giron). **Une seule méthode de balancement** par volée | [NORME, DE], moyenne (citations revérifiées dans [5], source secondaire) |
| IRC 2018 R311.7.5.2.1 [28] | **6 in (152 mm)** en tout point de la largeur utile | giron ≥ 10 in (254 mm) sur la *walkline* (R311.7.4 : à 12 in du côté intérieur du tournant). Écart maximal de **3/8 in (9,5 mm)** entre marches balancées d'une même volée | [NORME, US], moyenne (citations revérifiées dans [28], source secondaire ; texte IRC non lu) |
| Approved Document K, édition 2013 [37] | **50 mm** à l'extrémité étroite (diagramme 1.9, **confirmé** sur le texte officiel) | escalier privé : giron de 220 à 300 mm, mesuré au milieu si la largeur est < 1 m, à 270 mm de chaque bord si elle est ≥ 1 m. Girons **identiques** pour des marches balancées consécutives (§1.26). Giron des marches balancées **au moins égal** à celui des marches droites (§1.27) | [NORME, UK], élevée |
| Exemple de métier FR | exemple : collet minimal de **7,4 cm** pour une cage de 2,20 × 2,40 m, 14 girons de 25 cm et 8 marches balancées | — | [USAGE], faible (extrait de recherche d'une page de calculateur, non lu en entier) |

**Recommandation [ANALYSE]** : le collet minimal doit être un **paramètre de règle** (fichier `rules.yaml` de l'axe A), avec une valeur par défaut prudente. Par exemple 100 mm en contrôle « avertissement » et 50 mm en « bloquant », tant qu'on n'a pas lu le DTU P3.

---

## 3. Méthodes de balancement

### 3.1 Formulation du problème

**Entrées communes**

- les bords en plan `C_i` (jour) et `C_e` (mur ou limon extérieur) ;
- la ligne de foulée `Γ` (§2.1) et les points de nez équidistants `P_k`, `k = 0…n_g` ;
- les **marches fixes** : première, dernière, marche palière, marche imposée par un poteau ou par la trémie, marche d'angle éventuellement imposée sur la bissectrice ;
- les **zones de balancement** : intervalles `[a, b]` d'indices situés entre deux marches fixes et contenant un tournant ;
- les paramètres de méthode.

**Sorties**

- pour chaque nez `k`, la direction `u_k`, ou de façon équivalente l'angle `φ_k` de la ligne de nez ;
- les points `Q_k` (collet, sur le jour) et `R_k` (sur le mur) ;
- les dérivés : collets `c_k`, girons côté mur, développés des limons (§4, §5).

**Invariant fondamental [USAGE]**, confiance élevée : le balancement **fait pivoter chaque ligne de nez autour de son point `P_k` sur la ligne de foulée**, qui reste fixe. On garde ainsi l'équipartition des girons sur la ligne de foulée. C'est la définition donnée par StairDesigner (« son angle de rotation autour de son intersection avec la ligne de foulée, ce point restant fixe ») [2]. C'est aussi le principe décrit dans le brevet US6845595 [7]. Un escalier est d'autant mieux balancé que le mouvement de celui qui le gravit « est proche du mouvement d'une personne qui gravit un escalier droit » [2].

**Contraintes**

| Id | Contrainte | Statut |
|---|---|---|
| K1 | Girons égaux sur la ligne de foulée (objectif de conception : écart nul). La tolérance d'exécution est de ± 10 mm pour les marches balancées | [NORME] [1] |
| K2 | Collet `c_k ≥ c_min` (valeur de référentiel, §2.4) | [NORME] étrangère, ou paramètre |
| K3 | Monotonie : les collets décroissent (ou restent constants) vers l'angle | [NORME, DE] [5] |
| K4 | Continuité : la courbe du limon intérieur développé est sans cassure (au moins G1). Sur un plan développé, la courbure finale doit être « linéaire sans cassure » | [USAGE] [13] |
| K5 | Les lignes de nez ne se croisent pas entre `C_i` et `C_e` : l'ordre des `Q_k` et celui des `R_k` sont strictement croissants | [ANALYSE], indispensable |
| K6 | Symétrie : la marche d'angle se place de préférence sur la bissectrice de l'angle | [USAGE] [13] |
| K7 | Étendue limitée du balancement sur les parties droites (exemple DIN : ≤ 3,5·a) | [NORME, DE] [5] |
| K8 | Échappée : une marche peut être pivotée pour que son nez passe sous la trémie (exemple StairDesigner : de 1975 à 2150 mm en pivotant la marche 3) | [USAGE] [2] |
| K9 | Giron côté mur ≤ un maximum de confort, et contrôles sur les lignes de mesure réglementaires (§2.2) | [ANALYSE] |

### 3.2 M0 — Rayonnant (référence, sans balancement)

```text
entrée : centre O du tournant, indices tournants T
pour k dans T :
    u_k ← normaliser(P_k − O)
Q_k ← ℓ_k ∩ C_i ;  R_k ← ℓ_k ∩ C_e
```

- Collet d'un tournant circulaire : `c = g · r_j / r_f`, avec `r_f = r_j + d_f` le rayon de la ligne de foulée **[ANALYSE]** (homothétie). Avec un angle vif (`r_j = 0`), `c = 0`, d'où la nécessité d'un noyau ou d'un poteau.
- Défauts : collet trop étroit pour poser le pied [15], cassure de pente du limon au raccord avec les parties droites.

### 3.3 M1 — Progression arithmétique des collets (« méthode proportionnelle linéaire »)

Sources : pas-à-pas de métier utilisant une « progression arithmétique » [10] ; « méthode de la progression linéaire » [35] ; ALLPLAN « Linear » : rotation croissante puis décroissante [6] **[USAGE]**, confiance moyenne. Formalisation **[ANALYSE]**.

Idée : on impose une **suite arithmétique** de collets, du collet de la partie droite (égal à `g`) jusqu'à un collet minimal près de l'angle, sous la contrainte que la somme remplisse exactement la longueur disponible sur le jour.

```text
entrée : demi-zone de m marches entre la marche fixe a (partie droite) et l'angle A,
         L_half = longueur de C_i entre Q_a et le point d'angle A (ou le milieu de la marche d'angle),
         g (collet de la partie droite = giron, marches perpendiculaires)
sortie : σ_i des points Q_{a+1..a+m}

# c_j = g − j·δ, j = 1..m,  Σ c_j = L_half
δ ← 2·(m·g − L_half) / (m·(m+1))
si δ < 0 : le jour est plus long que nécessaire → équipartition (δ = 0) ou diminuer m
pour j = 1..m :
    c_j ← g − j·δ
    si c_j < c_min : ÉCHEC(K2) → augmenter m (balancer plus de marches) ou élargir le jour
σ ← σ(Q_a)
pour j = 1..m :
    σ ← σ + c_j ;  Q_{a+j} ← C_i(σ)
    u_{a+j} ← normaliser(Q_{a+j} − P_{a+j})   # la ligne de nez passe par P et Q
R_k ← ℓ_k ∩ C_e ; vérifier K5
répéter en miroir pour l'autre demi-zone (marche d'angle sur la bissectrice, K6)
```

Défaut : la pente du limon développé (`h / c_j`) varie **par sauts** à l'entrée de la zone. On passe de `h/g` à `h/(g−δ)` d'un coup. Il reste donc une légère cassure (« jarret »), à lisser à la cerce [10]. La continuité K4 n'est qu'approchée.

### 3.4 M2 — Méthode de la herse / « Winkelmethode » (construction de proportion)

Sources : la méthode de la herse est présentée comme la plus utilisée en enseignement [8]. La « Winkelmethode » de trepedia [4] est une construction voisine, très détaillée. Toutes deux reportent les longueurs de la ligne de foulée sur la ligne des collets par une **construction de Thalès ou projection centrale**. **[USAGE]**, confiance moyenne sur l'équivalence : les figures de [8] ne sont pas lisibles dans l'extraction texte, et l'équivalence herse ≡ projection centrale est **ma reconstruction**.

**Construction graphique (trepedia [4])**, résumée. La source compte 9 étapes, dont la dernière regroupe les étapes 7 à 9 ci-dessous ; cela a été revérifié :

1. Tracer la bissectrice de l'angle. En cas d'asymétrie, répartir au prorata.
2. Tracer un segment horizontal de longueur égale à la **somme des collets** de la zone (exemple : 740 mm).
3. Depuis son origine, tracer une ligne inclinée d'environ **20°** et y reporter les **girons de la ligne de foulée** de la zone (exemple : 1129 mm au total).
4. Tracer la verticale à l'origine.
5. Joindre le dernier point de la ligne inclinée à l'extrémité du segment horizontal et prolonger jusqu'à la verticale.
6. Joindre tous les points de la ligne inclinée à ce point d'intersection.
7. Les intersections avec l'horizontale donnent les collets.
8. Relier chaque point de la ligne de foulée au collet correspondant.
9. Recommencer après l'angle.
10. Tracer les arrière-bords parallèles, au décalage du recouvrement.

**Formule fermée équivalente [ANALYSE]** (vérifiée numériquement) :

```text
entrée : L_c (longueur de jour de la demi-zone), m, g, α (≈ 20° usage [4])
O = (0,0) ; A = (L_c, 0) ; B_k = k·g·(cos α, sin α), k = 0..m
# S = intersection de la droite (B_m, A) avec l'axe x = 0
y_S ← m·g·sin α · L_c / (L_c − m·g·cos α)       # négatif quand L_c < m·g·cos α
pour k = 0..m :
    t   ← −y_S / (k·g·sin α − y_S)
    x_k ← t · k·g·cos α                            # projection centrale de B_k depuis S sur y = 0
c_k ← x_k − x_{k−1}          # collets, décroissants avec k : l'angle est côté A
```

Propriétés :

- `x_m = L_c` par construction. L'exemple numérique a été **revérifié** : 740 mm de collets et 5 girons de 225,8 mm à `α = 20°` donnent des collets de 195, 166, 144, 125 et 110 mm.
- **Corrigé lors de la vérification** : le texte initial disait que les collets tendent vers l'équipartition quand `α → 0`. C'est **faux**. Quand `α → 0`, la construction tend vers une **progression homographique limite** : `x_k = k·g·K/(k + K)`, avec `K = m·L_c/(m·g − L_c)`. Dans l'exemple, on obtient 204, 169, 142, 121 et 104 mm ; c'est la progression **la plus marquée**. L'équipartition `L_c/m` n'est atteinte qu'à `α_eq = arccos(L_c/(m·g))` (≈ 49° dans l'exemple) : la droite `(B_m, A)` devient alors verticale et `S` part à l'infini. Au-delà de `α_eq`, la progression **s'inverse** (collets croissants vers l'angle), ce qui est inutilisable. Le paramètre utile est donc `α ∈ ]0, α_eq[` : plus `α` augmente, plus la progression s'aplatit. Il faut borner le curseur de l'IHM à cet intervalle. Vérification numérique : 10° → 202/168/142/122/106 ; 30° → 184/163/145/130/118 ; 45° → 157/152/148/143/139 ; 60° → 118/131/145/162/183 (inversée).
- **Corrigé lors de la vérification** : le texte initial proposait de résoudre `α` pour que le premier collet vaille `g`. Ce n'est **pas possible** : le premier collet vaut au plus `g·K/(1 + K) < g`, et ce maximum n'est atteint qu'en limite `α → 0`. La herse ne raccorde donc **jamais** exactement la partie droite ; il reste toujours un saut de collet en entrée de zone.

Défaut : la continuité de la dérivée du limon n'est pas garantie, et le saut en entrée de zone est inévitable (voir ci-dessus). La progression est projective et non conçue pour le limon.

### 3.5 M3 — Méthode par développement du limon (« Abwicklungsmethode ») — **recommandée par défaut**

Sources : la « méthode par développement » fait partie des quatre méthodes classiques (herses, danoise, échelle de balancement, développement) [15]. Dans cette méthode, les marches sont d'abord tracées rayonnantes, puis « **modifiées suivant une courbe agréable à l'œil** » sur le développement du limon [11]. Côté allemand, on balance soit en plan (méthode de proportionnalité), soit « en plan et en élévation » par la méthode de développement, plus complexe (extrait de recherche). La règle K4 [13] en est le critère. **[USAGE]**, confiance élevée sur le principe. Formalisation, choix de la courbe et formule du collet minimal : **[ANALYSE]**.

**Principe** : on dessine le limon intérieur **déroulé** dans un plan `(σ, z)`, avec `σ` l'abscisse le long de la face du jour et `z` l'altitude. Les nez des parties droites y forment deux droites de pente `m = h/g`. Dans le tournant, on remplace la solution rayonnante, trop raide, par une **courbe lisse et monotone** tangente à ces deux droites. Chaque nez `k` se lit ensuite à l'intersection de la courbe avec l'horizontale `z = z_k`.

```text
entrée : C_i (plan du jour), P_k (ligne de foulée), h, g, zone [a,b] (marches fixes a et b)
sortie : u_k, Q_k pour a < k < b ; courbe F de rive du limon intérieur

1. m ← h / g                                   # pente des parties droites sur le développé
2. (σ_a, z_a) ← (σ_i(Q_a), a·h) ; (σ_b, z_b) ← (σ_i(Q_b), b·h)
   # Q_a, Q_b : collets des marches fixes (perpendiculaires dans les parties droites)
3. Δ ← σ_b − σ_a ; S ← (z_b − z_a) / Δ          # pente moyenne du tournant
4. choisir F : [σ_a, σ_b] → z, avec
       F(σ_a) = z_a, F'(σ_a) = m, F(σ_b) = z_b, F'(σ_b) = m, F strictement croissante
   variante A (C1) : Hermite cubique
       t = (σ−σ_a)/Δ
       F = z_a + Δ·[ m·(t − 2t² + t³) + S·(3t² − 2t³) + m·(t³ − t²) ]
   variante B (C2) : Hermite quintique (F'' = 0 aux extrémités) → pas de saut de courbure
   variante C : deux raccords paraboliques (Bézier quadratiques) + droite centrale de pente S_c
   variante D : B-spline à points de contrôle libres (pilotée par l'optimisation M7)
5. pour k = a+1 .. b−1 :
       σ_k ← F⁻¹(k·h)                           # dichotomie ou Newton (F monotone)
       Q_k ← C_i(σ_k)
       u_k ← normaliser(Q_k − P_k)
6. R_k ← ℓ_k ∩ C_e ; vérifier K2, K3, K5, K9
7. la rive haute du limon intérieur est z = F(σ) + d_rive (§4.1) : elle est lisse par construction
```

**Formules utiles pour la variante A [ANALYSE]** (vérifiées numériquement) :

- Pente sur le développé : `F'(t) = 6t(1−t)·S + m·(1 − 6t(1−t))`. Elle est maximale au milieu : `F'_max = (3S − m)/2`.
- **Collet minimal estimé** : `c_min ≈ h / F'_max = 2h / (3S − m)`. On obtient ainsi une **vérification analytique immédiate** : pour garantir `c ≥ c_min`, il faut `S ≤ (2h/c_min + m)/3`. Cela donne la **longueur minimale de jour** `Δ` à mobiliser, donc **le nombre de marches à balancer**.
- **Monotonie** : si les deux pentes d'extrémité valent `m` et la pente moyenne `S`, la condition de Fritsch–Carlson (`2·(m/S)² ≤ 9`) est vérifiée dès que `m ≤ 2,12·S`, ce qui est toujours le cas dans un tournant (`S > m`). Précision ajoutée à la vérification : c'est même immédiat, puisque `F' = m + 6t(1−t)·(S − m) > 0` dès que `S ≥ m`. Si `S < m` (jour plus long que nécessaire), `F'` est minimale au milieu et vaut `(3S − m)/2`. La variante A n'est donc monotone que si `S > m/3`.
- Exemple : `h = 0,18 m`, `g = 0,25 m` (donc `m = 0,72`), zone de 6 hauteurs (`z_b − z_a = 1,08 m`) sur `Δ = 0,90 m` de jour (donc `S = 1,2`). On obtient `F'_max = 1,44`, soit un collet minimal d'environ **125 mm**. Revérifié : l'inversion exacte de `F` donne les collets 184,6 / 138,7 / 126,7 / 126,7 / 138,7 / 184,6 mm. L'estimation est donc légèrement **prudente**, ce qui convient pour une règle bloquante.
- **Variante B (quintique C2), ajoutée à la vérification** : on a `F(t) = z_a + Δ·[m·t + (S − m)·(10t³ − 15t⁴ + 6t⁵)]`, d'où `F'(t) = m + 30t²(1−t)²·(S − m)` et `F'_max = m + 1,875·(S − m)`. Le **collet minimal** vaut donc `c_min ≈ h / (m + 1,875·(S − m))`. Dans le même exemple : `F'_max = 1,62`, soit un collet d'environ **111 mm**. L'inversion exacte donne 202,6 / 133,7 / 113,8 / 113,8 / 133,7 / 202,6 mm. La variante C2, recommandée pour les limons débillardés, donne un collet **plus étroit** que la variante cubique : **l'algorithme de choix de zone doit utiliser la formule de la variante retenue.**

**Algorithme de choix automatique de la zone [ANALYSE]** :

```text
pour nb = 1, 2, … marches balancées de chaque côté de l'angle :
    définir a, b ; calculer S
    c_est ← h / F'_max(variante)   # A : F'_max = (3S − m)/2 ; B : F'_max = m + 1,875·(S − m)
    si c_est ≥ c_min et K5 et K7 : retenir nb ; sortir
```

**Avantages** : la continuité du limon (K4) est garantie par construction, ce qui en fait la méthode naturelle pour un **limon débillardé** (§5). L'effet de « crosse » s'obtient par la variante D : StairDesigner montre qu'en resserrant le balancement près du collet, « l'effet de crosse » apparaît sur les limons [2].

**Défauts** : seul le limon **intérieur** est contrôlé. Le développé du limon extérieur en découle ; il faut vérifier qu'il reste lisse, ce qui est en général le cas car ses variations sont plus faibles. Il faut aussi une marche fixe de chaque côté.

### 3.6 M4 — Arc de cercle (« méthode par cercle »)

Source : Maison Hélice [9] **[USAGE]**, confiance faible (description partielle, sans figure). Étapes : tracer les marches non balancées (ligne de foulée et girons) ; tracer des parallèles à la ligne de foulée le long de chaque volée, qui coupent l'axe de symétrie en P ; tracer un arc de centre « l'intersection de la contremarche de la dernière marche droite et de la ligne D », de rayon égal à la distance au point P ; diviser l'arc selon le nombre de marches à balancer ; reporter jusqu'au limon extérieur.

**Implémentation [ANALYSE]** : c'est une paramétrisation des collets par des points équidistants **sur un arc** plutôt que sur le jour. Elle s'implémente comme M1, en remplaçant les `c_j` par les projections sur `C_i` des points `Θ_j = centre + ρ·(cos θ_j, sin θ_j)`, avec `θ_j` équiréparti. Le cas d'emploi indiqué est le quart tournant. Les mêmes contrôles que M1 s'appliquent.

### 3.7 M5 — Ligne de mesure à angle constant (brevet US6845595)

Source : brevet [7] **[USAGE / brevet]**, confiance élevée sur le contenu. **Statut vérifié** : Google Patents indique « Expired – Fee Related ». Le brevet est échu le **25/01/2013** pour défaut de paiement des annuités ; son échéance normale était le 24/07/2021. Priorité : 23/05/2000. Titulaire : MVL Internationale Unternehmen AG S.A. La méthode est donc **libre d'exploitation aux États-Unis** au regard de ce brevet. D'éventuels équivalents européens n'ont **pas été vérifiés** (⚠️).

- Constat de l'état de l'art selon le brevet : les méthodes anciennes divisent la ligne de foulée et mesurent les distances **sur** elle, ce qui rend les marches du tournant plus étroites.
- Méthode revendiquée : la distance constante `d` entre deux lignes de nez voisines se mesure sur une **ligne de mesure** propre à chaque paire. Cette ligne est centrée sur la ligne de foulée (ligne de foulée à **35 à 45 cm** du limon intérieur) et fait un **angle α constant** avec les nez : entre 80 et 100°, de préférence 85 à 95°, idéalement environ 90°. Les intersections des nez avec le limon intérieur sont espacées de façon constante, et le **limon intérieur reste droit** (main courante droite, économique).
- Variante (revendication 7) : un cercle de **diamètre égal à la distance `d`**, tangent aux nez successifs ; la ligne de mesure est formée par les deux rayons qui passent par les points de contact.

```text
entrée : nez fixes 1 et N, d initial, α initial
répéter :
    pour k = 1..N−1 :
        placer la ligne de mesure M_k de longueur d, milieu sur Γ, faisant l'angle α avec ℓ_k
        ℓ_{k+1} ← droite par l'extrémité de M_k, faisant l'angle α avec M_k
    err ← écart entre ℓ_N calculé et ℓ_N imposé
    ajuster d (et/ou α) par dichotomie / sécante
jusqu'à |err| < ε
```

Défaut : les « girons » ne sont plus mesurés sur la ligne de foulée au sens du DTU. Il faut vérifier K1 après coup.

### 3.8 M6 — Rotation paramétrée (familles « constant / linéaire / harmonique »)

Sources : ALLPLAN propose six modes [6] : **gleichmäßig** (angle de rotation constant d'une marche à l'autre), **linear** (rotation croissante puis décroissante, maximale au milieu), **harmonisch**, **geometrisch optimiert** (conseillé pour les escaliers une ou plusieurs fois tournants), **Proportionalteilung** et **Halbkreismethode** (demi-tournants seulement). StairDesigner utilise deux coefficients par collet, **CBL** (local) et **CBD** (distant), de 0 à 100 et à 50 par défaut [2]. Quand le CBL baisse, les collets tendent vers l'équipartition et le limon devient rectiligne, ce qui n'est possible strictement que si les deux volées ont la même longueur [2]. **[USAGE]**, confiance élevée pour la description. Les formules internes ne sont pas publiées.

**Famille proposée pour Blondel [ANALYSE]** (analogue CBL/CBD, **non issue des sources**) :

```text
φ_k^0 ← angle "rayonnant" (M0) ou "perpendiculaire" (partie droite) de chaque marche
d_k   ← distance (en nombre de marches) de k à la marche d'angle
w_k   ← exp(−(d_k/λ)^p)               # λ ≈ portée (≈ CBD), p ≈ raideur (≈ CBL)
φ_k   ← φ_perp,k + w_k·(φ_ray,k − φ_perp,k)
imposer φ_a, φ_b (marches fixes) par normalisation de w sur [a,b]
```

Utilisation : un réglage manuel intuitif (deux curseurs) ou l'espace de départ de l'optimisation M7.

### 3.9 M7 — Optimisation (approche algorithmique)

Aucune publication d'algorithme d'optimisation n'a été trouvée : la page MDPI sur les lignes de foulée IFC était inaccessible (403). Proposition **[ANALYSE]** :

- **Variables** : soit les angles `φ_k` des nez (a < k < b), soit, mieux, les **points de contrôle de la courbe F** de M3 (variante D). La seconde option garantit K4 et réduit la dimension.
- **Objectif** (à minimiser) :

```text
J = w1·Σ (c_{k+1} − 2c_k + c_{k−1})²          # lissage des collets (jour)
  + w2·Σ (e_{k+1} − 2e_k + e_{k−1})²          # lissage des girons côté mur e_k = |R_{k+1}−R_k|
  + w3·∫ F''(σ)² dσ                            # courbure du limon développé (jour)
  + w4·∫ G''(σ_e)² dσ_e                        # idem limon extérieur
  + w5·Σ (φ_k − φ_k^0)²                        # proximité d'une solution de référence (M3 ou M6)
```

- **Contraintes** : `c_k ≥ c_min` (K2) ; `c_{k+1} ≤ c_k` vers l'angle (K3) ; ordre strict de `Q_k` et `R_k` (K5) ; `|g_mesure,k − g| ≤ 10 mm` sur chaque ligne de mesure réglementaire (K1, K9) ; marches fixes ; échappée (K8).
- **Solveur** : SQP ou point intérieur sur une vingtaine de variables au plus. En web, une implémentation JS/wasm légère suffit (par exemple un Lagrangien augmenté à la main). On part de la solution M3 et on garantit la faisabilité par projection.
- **Sortie** : `u_k`, un rapport des contraintes actives et les marges.

### 3.10 Autres méthodes citées sans description exploitable

« Méthode danoise », « échelle de balancement » [15] ; « méthode par alignement », « progression arithmétique », « rayonnement », « arc de cercle » [8] ; « Leistenmethode » et « Koordinatenmethode » [4] ; « Trapèze de proportions » [9]. La plupart sont des **variantes graphiques de M1 et M2**, à ranger dans la même famille : répartition des collets par proportion ou progression. Les sources ne permettent pas de les formaliser exactement ; confiance faible.

### 3.11 Multi-tournants et cas particuliers

- **U, S, 3 volées et plus** : on insère une marche virtuelle dans chaque volée intermédiaire. Le problème se ramène alors à une suite de balancements à deux volées. Si l'utilisateur fixe une marche dans la volée intermédiaire, elle remplace la marche virtuelle [2] **[USAGE]**.
- **Zone sans collet** (entre deux marches fixes dans une partie droite) : équipartition, le « balancement équiparti » [2].
- **Jour très étroit** : la méthode classique donne un balancement quasi rayonnant. StairDesigner propose alors un « balancement centré » [2]. Le principe n'est pas détaillé ; **[ANALYSE]** on peut par exemple décaler le point de convergence de référence vers le mur.
- **Palier d'angle** : pas de balancement ; les nez de part et d'autre sont perpendiculaires.

### 3.12 Tableau comparatif et recommandation

| Méthode | Entrées spécifiques | Continuité du limon | Contrôle du collet | Complexité | Défauts |
|---|---|---|---|---|---|
| M0 Rayonnant | centre | cassure | aucun (collet ≈ g·r_j/r_f) | triviale | collet nul si angle vif |
| M1 Arithmétique | m, c_min | approchée | direct | faible | jarret en entrée de zone |
| M2 Herse / Winkel | m, α | non garantie | par α | faible | pensée pour le tracé à la main |
| **M3 Développement** | m, courbe F | **garantie (C1/C2)** | **formule `h/F'_max`** (A : `2h/(3S−m)` ; B : `h/(m+1,875(S−m))`) | moyenne | contrôle un seul limon |
| M4 Arc | rayon, centre | approchée | indirect | faible | peu documentée |
| M5 Brevet | d, α | limon intérieur droit | indirect | moyenne (itératif) | K1 à revérifier |
| M6 Rotation param. | λ, p | non garantie | indirect | faible | empirique |
| M7 Optimisation | poids | garantie si variables = F | contrainte dure | élevée | réglage des poids |

**Recommandation [ANALYSE]** : **M3 par défaut** (variante quintique C2 pour les limons débillardés), M1 et M2 en options pédagogiques (tracé traditionnel), M7 en affinage. Il faut toujours sortir les contrôles K1 à K9 et les lignes de mesure réglementaires.

---

## 4. Géométrie des limons et mains courantes

### 4.1 Limon droit

**[ANALYSE]**, géométrie élémentaire ; conventions de métier citées là où elles existent.

- Pente : `tan α = h / g`.
- Développé = élévation. Coordonnées `(u, v)` avec `u` horizontal le long du limon et `v` vertical.
- **Ligne des nez** : `v = m·u + v₀`, avec `m = h/g`.
- **Rive haute** : `v = m·u + v₀ + d_h`, où `d_h` est le dépassement vertical au-dessus des nez (paramètre d'atelier). Le dépassement mesuré perpendiculairement vaut `d_h·cos α`.
- **Rive basse** : `v = m·u + v₀ − d_b`. La **largeur du limon** (perpendiculaire à la pente) vaut `W = (d_h + d_b)·cos α`. Il faut `d_b ≥ (épaisseur de la marche) + (hauteur de la contremarche sous le nez) + (joue mini)`, ce qui fixe la largeur de débit.
- **Coupes d'extrémité** : aplomb (verticale) et coupe de niveau (horizontale) au départ et à l'arrivée ; intersection avec le plancher ou le chevêtre.
- **Mortaises ou encastrements** (limon « à la française ») : pour chaque marche `k`, on trace dans le plan de la face :
  - le dessus de marche, horizontale `v = z_k` ;
  - le dessous, `v = z_k − e_m` ;
  - la contremarche, verticale en `u` = trace de la ligne de contremarche ;
  - l'arrondi du nez : le profil du nez est **étiré horizontalement d'un facteur `1/sin β`**, avec `β` l'angle en plan entre la ligne de nez et la face du limon. `β = 90°` pour une marche droite, `β < 90°` pour une marche balancée.
  - Le tout est décalé de la profondeur d'encastrement. Cet étirement explique pourquoi les mortaises des marches balancées sont plus longues.

### 4.2 Limon courbe (plan quelconque)

**[ANALYSE]** Un limon dont les faces sont verticales, au-dessus d'une courbe plane `C(σ)`, a des faces qui sont des **cylindres généralisés**. Ces surfaces sont **développables** (génératrices verticales). Le développé d'une face est le plan `(σ, z)`, avec `σ` l'abscisse curviligne de la courbe **de cette face**.

- Une face décalée de `δ` (signé, positif vers le centre de courbure) de l'axe `C` a pour abscisse `dσ_δ/dσ = 1 − κ(σ)·δ`, avec `κ` la courbure en plan. Sur un arc de rayon `R` : `σ_δ = (R − δ)·θ`.
- Une même courbe 3D de rive `z(σ)` (définie sur l'axe) a sur la face `δ` une pente développée `dz/dσ_δ = z'(σ) / (1 − κδ)`. **La face intérieure est plus raide que la face extérieure** dans un tournant. C'est la cause des difficultés de raccord (§5.3).
- **Reports d'assemblage** sur le développé de chaque face : traces verticales des lignes de nez et de contremarche (`σ` d'intersection), horizontales de dessus et de dessous de marche, lignes de naissance (points de tangence droite/courbe), traits de joint.

### 4.3 Limon et main courante hélicoïdaux (formules exactes)

Hélice circulaire de rayon `r`, pas `P` (hauteur d'un tour) : `x = r cos θ`, `y = r sin θ`, `z = bθ`, avec `b = P/(2π)` [21] (confiance élevée, mathématiques).

Pour un escalier de hauteur de marche `h` et d'angle par marche `Δθ` : **`b = h / Δθ`** (Δθ en radians) **[ANALYSE]**.

| Grandeur | Formule | Note |
|---|---|---|
| Longueur d'arc pour un angle Θ | `L = Θ·√(r² + b²)` [21] | par marche : `√((rΔθ)² + h²)` |
| Pente sur le cylindre de rayon r | `tan α_r = b / r` | la pente dépend du rayon : raide au jour, douce au mur |
| Giron sur le rayon r (arc) | `g_r = r·Δθ` | corde : `2r·sin(Δθ/2)` (convention DIN : corde [5]) |
| Courbure | `κ = r / (r² + b²)` [21] | |
| **Rayon de courbure** (rayon de cintrage d'un tube ou d'un plat « à plat » sur hélice) | `ρ = (r² + b²) / r` | toujours supérieur à r. **À utiliser pour régler la cintreuse**, avant correction du retour élastique |
| Torsion | `τ = b / (r² + b²)` [21] | donne le vrillage de la section le long de l'hélice |
| Développé d'une face de rayon r | droite `z = (b/r)·σ` dans le plan `(σ = rθ, z)` | **une bande hélicoïdale de tôle se développe en parallélogramme exact** |

**Limon hélicoïdal en tôle** (faces cylindriques) **[ANALYSE]**, confirmé par l'usage « développer l'hélice en 3D pour obtenir le flan, découper au laser ou au jet d'eau, puis rouler ». Le flan peut aussi inclure les raccords aux paliers (extrait de recherche Eng-Tips, confiance moyenne).

- Développé exact : une bande entre deux droites parallèles de pente `b/r_n`, avec `r_n` le rayon de la **fibre neutre**, c'est-à-dire le milieu de l'épaisseur. En roulage, la fibre neutre est à `e/2` et la longueur développée d'une virole vaut `π·(Ø_int + e)` [27] **[USAGE]**, confiance élevée.
- Lignes de roulage : les génératrices, **verticales** sur l'ouvrage, donc perpendiculaires à l'axe `σ` sur le développé.
- Extrémités : raccords aux parties droites (§5), coupes d'about, trous de fixation des supports de marche, tous placés en `(σ, z)`.
- Les **rives haute et basse** d'une tôle mince sont de simples arêtes : aucun problème de développabilité.

**Faces supérieure et inférieure (rives épaisses, plats de caisson, sous-face)** : la surface engendrée par des horizontales radiales qui s'appuient sur une hélice est un **hélicoïde droit**. Cette surface réglée n'est **pas développable** (courbure de Gauss négative) [22]. Conséquences :

- **Bois** : la rive se taille (débillardage) ; on ne peut pas la dérouler.
- **Métal** (plat de dessus ou de dessous d'un limon caisson, sous-face de volée) : développement **approché** en couronne, comme pour une spire de vis sans fin. Formules **[ANALYSE]**, dérivées en conservant les longueurs des deux hélices de rive et la largeur :

```text
L_e = Θ·√(r_e² + b²)   # hélice de rive extérieure (Θ = angle total du tronçon)
L_i = Θ·√(r_i² + b²)   # hélice de rive intérieure
w   = r_e − r_i        # largeur radiale
R_i = w·L_i / (L_e − L_i)      # rayon intérieur de la couronne développée
R_e = R_i + w
ψ   = L_e / R_e                # angle du secteur découpé (rad)
# le flan est un secteur de couronne (R_i, R_e, ψ), mis en forme par étirage / vrillage
```

La formule du développé d'une spirale, `√(p² + (π·d)²)` par spire, est confirmée par une source de métier [36]. **Vérification** : les rayons de couronne ne sont pas une dérivation originale. Ils coïncident exactement avec la **formule classique de développement d'une spire de vis sans fin** : `G = F·D/(E − F)`, avec `E = √((πA)² + C²)`, `F = √((πB)² + C²)`, `A` et `B` les diamètres extérieur et intérieur, `C` le pas et `D` la largeur radiale [42]. Confiance moyenne : la source a été lue via l'extrait du moteur de recherche, la page étant injoignable. **À valider par un chaudronnier** (l'étirage réel dépend de l'épaisseur et du procédé).

**Main courante hélicoïdale** :

- Ligne d'axe : hélice de rayon `r_mc`, décalée en hauteur de la hauteur réglementaire (axe A) au-dessus de la ligne des nez prise au même rayon **[ANALYSE]**.
- Orientation de la section : soit un **repère de Frenet** (la section vrille avec la torsion `τ`), soit un repère « **vertical** » (un axe de la section reste dans le plan vertical tangent). Le second est l'usage visuel, avec une section toujours droite **[ANALYSE]**.
- Tube métallique : cintrage hélicoïdal au rayon `ρ = (r² + b²)/r`. Le cintrage hélicoïdal existe comme service industriel (extrait de recherche AngleRing, confiance faible).
- Bois : lamellé-collé sur moule, ou tronçons taillés dans la masse par le système des tangentes (§4.4). La méthode des tangentes « décompose les formes hélicoïdales en courbes elliptiques planes » [16] **[USAGE]**.

### 4.4 Main courante courbe hors hélice : système des tangentes (« tangent handrailing »)

Sources : Peter Nicholson (XVIIIᵉ s.) est à l'origine du système (extrait de recherche). W. H. Wood, *Practical Stair Building and Handrailing* [17] ; sbebuilders [18] ; KnoStairs [19][20]. **[USAGE]**, confiance élevée sur le principe, moyenne sur les formules (calculateur en ligne, non recoupé).

Principe : chaque tronçon courbe de main courante (le « wreath ») se taille dans un **plateau incliné** (« plank ») dont le plan passe par deux **tangentes** inclinées au plan de l'arc. Le **gabarit de face** (« face mould ») est la projection de l'arc en plan sur ce plan incliné, c'est-à-dire **une ellipse**.

| Grandeur | Formule [18] |
|---|---|
| Longueur de tangente (arc de rayon R, angle au centre Φ) | `T = R·sin(Φ/2) / cos(Φ/2) = R·tan(Φ/2)` |
| Pente du plateau | `pitch = arctan(hauteur de tangente haute / assise)` |
| Demi-grand axe de l'ellipse du gabarit | `a = R / cos(pitch)` (demi-petit axe `= R`) |
| Biais de gauche (twist bevel) haut / bas | `utb = 90° − arctan( sin(angle tangente haute) / tan(angle dièdre) )`, idem en bas |

Règles de métier associées :

- Ce sont « les tangentes qui s'adaptent à la ligne de rampe de la main courante, et non l'inverse » [17].
- Il faut **deux gabarits de face** (un par face du plateau) pour capter le vrillage [17].
- Les joints sont **d'équerre à la tangente** et placés **dans la partie droite, bien au-delà du raccord (« easing »)**, pour éviter un effet « estropié » [17].

**Écart connu entre CAO et méthode traditionnelle** : sur un tournant de 180° en « tangent boxes », l'axe de la main courante parcourt moins de longueur que la montée requise. Il perd environ **1½ in** de hauteur (exemple KnoStairs), que le main-courantier corrige à la main. En CNC, il faut le **corriger avant usinage**. Solution citée : choisir le rayon de sorte que la demi-circonférence de l'axe soit égale à un giron, soit `r = g/π` (exemple : 254 mm / π = 80,85 mm) [19]. **[USAGE]**, confiance moyenne.

**Recommandation Blondel [ANALYSE]** : générer les mains courantes courbes comme un **balayage 3D exact** (ligne d'axe = courbe lisse `(C_mc(σ), z_mc(σ))`, section orientée dans le repère « vertical »). Le système des tangentes ne sert qu'à **produire les gabarits d'atelier** : plateau, ellipse, biais. Pour chaque tronçon, le plateau optimal se calcule par l'algorithme d'épaisseur minimale du §5.5.

### 4.5 Délardement

- Définition : « coupe en diagonale que l'on fait au lit de dessous des marches d'un escalier ». Une **marche délardée** a son dessous taillé en chanfrein pour suivre le plafond rampant [33] (glossaire), confiance moyenne. Ne pas confondre avec le **débillardement** : tailler une pièce pour lui donner la forme gauche d'un quartier tournant (même glossaire, résultats de recherche).
- **[ANALYSE]** Pour Blondel, le délardement d'une marche balancée se définit comme l'intersection du volume de la marche avec la **surface de sous-face**. Cette surface est réglée par des horizontales qui s'appuient sur les rives basses des deux limons, `z_bas,i(σ_i)` et `z_bas,e(σ_e)`, appariées par la ligne de nez. On en tire, pour chaque marche, une face inférieure gauche (ou plane par approximation) et les angles de coupe.

---

## 5. Limon porteur débillardé

> Un **limon continu qui suit le tournant**, balancé ou hélicoïdal. En bois, il est « taillé dans un parallélépipède sur les faces duquel figure le tracé de la projection » [15]. Ses courbes « sont ainsi beaucoup plus fluides » qu'avec un poteau [15]. En métal, c'est une tôle découpée puis roulée ou soudée par tronçons.

### 5.1 Définition géométrique exacte [ANALYSE]

On se donne :

1. **Axe en plan** `C(σ)` du limon : segments, arcs et en option clothoïdes (§5.3). Courbure `κ(σ)`. Épaisseur `e`. Faces `C_±(σ) = C(σ) ± (e/2)·N(σ)`, où `N` est la normale en plan.
2. **Loi de rive haute** `z_h(σ)` et **loi de rive basse** `z_b(σ)`, définies sur l'axe :
   - `z_h(σ) = F(σ) + d_h` et `z_b(σ) = F(σ) − d_b`, avec `F` la courbe de nez issue du balancement M3, transportée de la face du jour sur l'axe par `σ ↦ σ_axe`. Autre option : une courbe lissée passant au-dessus des points `(σ(Q_k), z_k)`.
   - Condition : `z_h` et `z_b` au moins **C1**, **C2 recommandé** pour un reflet lisse en bois verni ou en inox poli.

**Volume du limon** : `V = { C(σ) + t·N(σ) + z·Z ; σ ∈ [σ₀, σ₁], t ∈ [−e/2, e/2], z ∈ [z_b(σ), z_h(σ)] }`.

- **Faces latérales** (`t = ±e/2`) : cylindres verticaux, **développables**.
- **Rive haute et rive basse** : surfaces réglées par les segments horizontaux `{ C(σ) + t·N(σ) + z_h(σ)·Z }`, normaux en plan à l'axe. C'est la convention la plus courante et la seule cohérente avec une taille dans un parallélépipède à « coupes de niveau ». Confiance moyenne **[USAGE implicite]**. Ces surfaces sont **gauches**. Elles ne sont planes que dans les parties droites à pente constante ; ce sont des hélicoïdes droits sur un arc à pente constante [22] ; ce sont des conoïdes généraux sur un arc à pente variable.
- **Courbes de rive** (arêtes, les 4 courbes à usiner ou découper) :
  - `Γ_{h,±}(σ) = C_±(σ) + z_h(σ)·Z` ;
  - `Γ_{b,±}(σ) = C_±(σ) + z_b(σ)·Z`.
- **Développé de la face ±** : courbes `(σ_±(σ), z_h(σ))` et `(σ_±(σ), z_b(σ))`, avec `σ_±(σ) = ∫ (1 ∓ κ·e/2) dσ` (signe selon le côté concave ou convexe).

Variante « rive normale à la pente » (plans de rive perpendiculaires à la face et à la pente locale) : c'est possible, mais cela complique la liaison marche/limon. Je ne l'ai pas trouvée dans les sources ; **déconseillée par défaut**.

### 5.2 Courbes de rive : construction numérique

```text
entrée : C (plan), e, F (M3), d_h, d_b, échantillonnage Δσ (ex. 5 mm)
pour σ de σ₀ à σ₁ pas Δσ :
    p ← C(σ) ; n ← N(σ) ; κ ← courbure(σ)
    zh ← F(σ) + d_h ; zb ← F(σ) − d_b
    émettre Γ_h+(σ) = p + (e/2)n + zh·Z   ;  Γ_h−(σ) = p − (e/2)n + zh·Z
    émettre Γ_b+(σ), Γ_b−(σ) idem
    σ+ += (1 − κ·e/2)·Δσ ;  σ− += (1 + κ·e/2)·Δσ         # abscisses développées
    émettre développé face+ : (σ+, zh), (σ+, zb) ; face− : (σ−, zh), (σ−, zb)
lisser / convertir en B-splines (tolérance 0,1 mm) → export DXF (développés) et STEP (3D)
```

### 5.3 Raccord tangent avec les parties droites

**Constat de métier** : sur un forum de menuisiers, on explique que, dans une forme hélicoïdale à un seul degré de liberté, « il n'est pas possible d'avoir un raccordement en tangence » entre partie droite et partie courbe. Les solutions proposées sont une rotation de section, des splines, ou « l'art de tricher » (faire varier la hauteur de main courante de 90 à 100 cm dans les tournants serrés, vérifier à la latte souple) [12] **[USAGE]**, confiance moyenne.

**Explication [ANALYSE]** : au point de naissance (jonction droite/arc), la pente développée de la partie droite vaut `m` sur **les deux faces**, puisqu'elles sont parallèles. Sur l'arc, la pente vaut `z'(σ)/(1 ∓ κe/2)`, différente sur chaque face. Si `κ` saute de `0` à `1/R` à la naissance, **au moins une face présente une cassure de pente**. La cassure est d'autant plus forte que le rayon est petit et le limon épais. C'est le « jarret ». La main courante suit le même raisonnement, avec son propre rayon.

**Solutions**, de la plus simple à la plus propre :

| Solution | Principe | Statut |
|---|---|---|
| S1 — Accepter, puis reprendre à la cerce ou à la latte | lisser la cassure localement à la main | [USAGE] [10][12] |
| S2 — Raccord de pente sur l'axe | `F` C1 sur l'axe ; la cassure sur les faces reste en `κe/2`, souvent négligeable si `e ≪ R` | [ANALYSE] |
| S3 — **Plan à courbure continue** (clothoïde / spirale d'Euler entre droite et arc) | à la naissance `κ = 0`, donc `1 ∓ κe/2 = 1` : **les deux faces ont la même pente `m`**, raccord G1 exact sur les 4 arêtes. **Corrigé lors de la vérification** : `F` C2 ne suffit **pas** pour un raccord G2 sur les faces. La dérivée de la pente développée sur la face `δ` vaut, à `κ = 0`, `z'' + z'·κ'·δ`. Or `κ'` saute de 0 à `1/(R·L_clothoïde)` à la naissance, ce qui laisse un saut de courbure développée de `m·κ'·e/2` sur chaque face. Le raccord G2 n'est exact que sur l'axe. Il faudrait une rampe de `κ'` continue (spirale d'ordre supérieur) ou une correction de `z''` propre à chaque face, ce qui est impossible sur les deux faces à la fois | [ANALYSE], confiance moyenne (dérivation propre, **non trouvée dans les sources**) |
| S4 — Variation de pente (« easing », « ramp ») concentrée près de la naissance | équivalent des corrections faites à la main en tangent handrailing [19][20] | [USAGE] |
| S5 — Crosse | balancement serré près du collet ; la rive se relève en crosse | [USAGE] [2] |

**Coût de S3 en métal [ANALYSE]** : un rayon variable ne se roule pas sur une rouleuse standard à rayon constant. Il faut un roulage à commande numérique, ou un **cintrage par pliages successifs (bump bending)**. Avec un pas de pli `p`, l'angle du pli `i` vaut `Δψ_i ≈ κ(σ_i)·p` et les lignes de pli sont verticales, perpendiculaires à `σ` sur le développé. On peut aussi discrétiser la clothoïde en 2 ou 3 arcs de rayons décroissants, ce qui donne des lignes de roulage par zone.

### 5.4 Découpage en tronçons et positionnement des joints

**Usages relevés** :

- Bois : épure d'un limon « à noyaux débillardés » avec **4 parties courbes** (noyaux) et **3 parties droites** intercalées, huit calibres rallongés (haut et bas pour chaque noyau, plus la volute), **joints d'équerre** qui facilitent l'assemblage à la défonceuse [11] **[USAGE]**, confiance moyenne. Cela correspond à un découpage **par quartier tournant**.
- Main courante : joints d'équerre à la tangente, placés **dans la partie droite, au-delà du raccord** [17]. Joint central possible au milieu d'un tournant de 180° [20] **[USAGE]**.
- Bois épais (> 60 mm) : couches collées sans moule. Bois fin (< 60 mm) : contreplaqué lamellé sur moule de forme puis placage de 2 mm [16] **[USAGE]**, confiance faible (source d'un seul atelier).

**Règles de découpage proposées [ANALYSE]** :

```text
entrée : limon complet (σ₀..σ₁), contraintes procédé
  bois  : plateau max (longueur, largeur, épaisseur), fil (angle max fil / tangente)
  métal : format de tôle (L×l), capacité de roulage (rayon mini selon épaisseur, largeur de rouleuse)
candidats de joint : points de naissance ± δ (δ ≥ longueur d'about), milieux de quartier
interdits : zone de mortaise ou de support de marche ± marge, zone de poteau, zone d'effort maxi (si calcul axe C)
pour chaque découpage candidat (programmation dynamique sur σ) :
    pour chaque tronçon :
        bois  : épaisseur mini de plateau t* (§5.5) ≤ épaisseur dispo ; longueur ≤ plateau
        métal : bounding box du développé (orientée, rotation libre dans la tôle) ≤ format ; κ_max ≤ 1/R_min
    coût = Σ (matière brute + nombre de joints·coût_joint + pénalité esthétique si joint visible en zone courbe)
retenir le découpage de coût minimal
orientation du joint : plan normal à la tangente 3D de l'axe du limon (« d'équerre »), ou vertical-normal au plan (option)
```

### 5.5 Développés de fabrication par tronçon

**Bois — plateau et calibres** :

- **Épaisseur de plateau minimale [ANALYSE]** : c'est la largeur minimale du nuage de points du tronçon (faces, rives et surlongueurs d'about) mesurée selon une direction `n` :

```text
pour n sur la sphère (recherche grossière puis Nelder–Mead) :
    t(n) = max_p (p·n) − min_p (p·n)
n* = argmin t(n) ; plan du plateau ⟂ n*
calibre rallongé (gabarit de face) = projection orthogonale du tronçon sur le plan du plateau (faces haut/bas)
reporter : traits de naissance, joints, traits de niveau (horizontales), repères de marches
```

  Le plan du plateau généralise le « plateau incliné » du système des tangentes (§4.4). Sur un quart hélicoïdal, il est proche du plan passant par les deux tangentes extrêmes.
- **Calibres rallongés** (projections sur les faces du parallélépipède), **calibres de développé** (face intérieure et face extérieure en `(σ_±, z)`) et **traits de niveau** pour contrôler la taille [11][15] **[USAGE]**.
- Sens du fil : contrôler l'angle entre le fil (axe long du plateau) et la tangente 3D, par exemple ≤ 15° à 20° en paramètre d'usage (**valeur non sourcée**). L'axe C doit préciser.

**Métal — tôle roulée par tronçons** :

- **Développé exact** de chaque face cylindrique en `(σ_n, z)` à la fibre neutre (`e/2`, [27]). Contour : `z_h(σ)` et `z_b(σ)` plus les coupes d'about.
- **Lignes de roulage** : génératrices verticales (perpendiculaires à `σ`), avec pour chaque zone le rayon `R_n = 1/κ − e/2` (ou `+`, selon le côté) ; en rayon variable, lignes de pli (§5.3).
- **Méplats d'extrémité** : une rouleuse à 3 rouleaux laisse des extrémités non roulées. La source [27] évoque le problème sans en donner la longueur. **[USAGE]**, à documenter par l'axe C. Solutions : **surlongueur à chuter**, pré-cintrage des extrémités, ou **joint placé dans une partie droite** (la solution la plus simple ; S3 facilite ce choix).
- **Repères d'assemblage à graver ou pointer sur le flan** : traces des nez et des supports de marche `(σ(Q_k), z_k)`, axes de trous, traits de naissance, traits de niveau de référence, repère du tronçon et sens (haut/bas, intérieur/extérieur), chanfreins de soudure aux abouts.
- **Gabarit de soudage** : les supports de gabarit se placent sur les génératrices en `σ` connus, avec leur hauteur `z_b(σ)` au sol de l'atelier. Cela revient à reporter l'« épure au sol » citée par les sources [15] et la galerie-creation (extrait, confiance faible).
- Limon **caisson** : deux faces roulées exactes et des plats de dessus et de dessous hélicoïdaux (ou gauches). Ces plats se développent de façon approchée en secteurs de couronne (§4.3), ou se remplacent par des bandes étroites vrillées.

### 5.6 Sorties à produire par Blondel pour un limon débillardé (synthèse)

| Sortie | Contenu | Format pressenti |
|---|---|---|
| Plan | axe, faces, joints, naissances, marches | SVG / DXF |
| Développé de chaque face, par tronçon | rives, abouts, mortaises ou supports, traits de niveau, lignes de roulage ou de pli, rayons | DXF 1:1, PDF coté |
| Calibres bois | projection sur le plateau (face mould), épaisseur de plateau, angles de coupe | DXF 1:1 |
| Modèle 3D | B-rep des tronçons | STEP (+ maillage pour three.js) |
| Nomenclature | tronçons, dimensions brutes, masse, longueur de soudure, nombre de plis | CSV |

---

## 6. Points incertains et questions ouvertes

1. **Collet minimal et annexe A du NF DTU 36.3 P3** : aucune valeur française trouvée pour le collet, ni pour la position de la ligne de foulée des hélicoïdaux. **Acheter ou consulter le P3.** En attendant, prendre DIN et IRC en valeurs de comparaison paramétrables.
2. **Ligne de foulée des escaliers tournants** : le DTU (milieu, ou 0,60 m au-delà de 1,20 m) s'oppose à l'usage des 50 cm et aux lignes de mesure d'accessibilité (0,35 m / 0,50 m du mur, circulaire de 2007, **ancienne réglementation**). À trancher avec l'axe A.
3. **Méthode de la herse** : les figures du cours [8] ne sont pas lisibles. L'équivalence herse ≡ projection centrale (M2) est ma reconstruction ; confiance moyenne.
4. **Méthodes « danoise », « échelle de balancement », « alignement »** : citées sans description exploitable.
5. **Formules internes des logiciels** (StairDesigner CBL/CBD, ALLPLAN « harmonisch » / « geometrisch optimiert ») : non publiées. Les familles M6 et M7 sont des propositions.
6. **Raccord tangent par clothoïde** (S3) : dérivation propre, cohérente mais non trouvée dans la littérature de métier. À valider par des prototypes et par un menuisier ou un métallier (faisabilité du roulage à rayon variable).
7. **Développement des plats hélicoïdaux** (couronne) : approximation classique dont les rayons sont ma dérivation ; à valider par un chaudronnier.
8. **Convention de rive** (horizontales normales à l'axe) : c'est l'usage implicite du débillardage, mais je ne l'ai pas vu écrit explicitement dans une source.
9. ~~**Règle UK des 50 mm** au collet~~ : **confirmée** par le texte officiel de l'Approved Document K 2013, diagramme 1.9 [37].
10. **Normes citées par EHI** : NF P21-210 existe (terminologie des escaliers en bois [40]). « NF P 85-015 » est probablement NF E85-015 (escaliers industriels, édition 2019 [41]). Leurs **contenus** restent ⚠️ non vérifiés.
11. **Brevet US6845595** : **échu en 2013** (annuités impayées) [7]. Reste à vérifier l'existence d'équivalents EP/DE (famille MVL).
12. **Herse (M2)** : le paramètre `α` doit être borné à `]0, arccos(L_c/(m·g))[`. Le raccord exact avec la partie droite est impossible (voir §3.4, correction).

---

## Sources

Toutes consultées le **2026-09-28**.

1. **Guide d'application du DTU 36.3 — Escaliers en bois**, FIBC / AFEB, Commission professionnelle Escaliers en bois, janvier 2016. https://www.uiccb.fr/wp-content/uploads/2021/07/AFEB-Guide-DTU-36.3-Janvier-2016.pdf (ancienne URL uicb.pro redirigée). Lu en entier (PDF de 20 pages).
2. **StairDesigner VI — Conception d'escaliers sur mesure, manuel**, Boole & Partners. https://boole.eu/pdf/Manuel_SD.pdf. Chapitres II (principes de balancement), III (pas de foulée) et IV (cage, raccords, échappée, paliers) lus.
3. **Normes sur la dimension des marches d'escalier**, Treppenmeister (FR). https://www.treppenmeister.com/fr/normes-sur-la-dimension-des-marches/
4. **Winkelmethode — Klassische Treppenverziehung**, trepedia. https://trepedia.de/entwerfen/treppenverziehung/winkelmethode
5. **Regelungen der Norm — DIN 18065 für Treppenverziehung**, trepedia. https://trepedia.de/entwerfen/treppenverziehung/regelungen-der-norm (source secondaire sur DIN 18065:2020-08, norme payante non lue).
6. **Verziehung : Verziehungsmethoden**, aide en ligne ALLPLAN 2026. https://help.allplan.com/Allplan/2026-0/1031/Allplan/6679.htm
7. **US6845595B2 — Method for constructing a balanced stair**, MVL S.A., Google Patents. https://patents.google.com/patent/US6845595B2/en (statut « Expired – Fee Related » depuis le 25/01/2013, vérifié).
8. **Escalier balancé à double quartier tournant** (cours de projet, 1ʳᵉ année architecture), I. Selka Oussadit, Université de Tlemcen. https://elearn.univ-tlemcen.dz/mod/resource/view.php?id=19298 (PDF de 5 pages ; figures non extraites).
9. **Comment tracer et balancer un escalier ?**, Maison Hélice. https://maison-helice.com/comment-tracer-escalier/
10. **Étude et tracé d'un escalier quartier tournant** (pas-à-pas), kaj, L'Air du Bois. https://www.lairdubois.fr/pas-a-pas/292-etude-et-trace-d-un-escalier-quartier-tournant.html
11. **Épure d'un limon à noyaux débillardés** (pas-à-pas), kaj, L'Air du Bois. https://www.lairdubois.fr/pas-a-pas/267-epure-dun-limon-a-noyaux-debillardes.html
12. **Escalier débillardé et problème de tracé** (question et réponses), L'Air du Bois. https://www.lairdubois.fr/questions/7464-escalier-debillarde-et-probleme-de-trace.html
13. **Balancement herse 91,5°** (plan et discussion), L'Air du Bois. https://www.lairdubois.fr/plans/1145-balancement-herse-91-5deg.html
14. **Balancement des marches : calcul de la ligne de foulée et du giron** (question), L'Air du Bois. https://www.lairdubois.fr/questions/6882-balancement-des-marches-calcul-de-la-ligne-de-foulee-et-du-giron.html
15. **Techniques de fabrication d'escalier bois**, Escalier Jura (Jura et Pays de Gex). https://www.escalier-jura.fr/techniques.htm
16. **Fabriquer un limon ou une rampe d'escalier débillardé**, atelierbois.net. https://atelierbois.net/fabriquer-limon-rampe-escalier-debillarde/
17. **Practical Stair Building and Handrailing**, W. H. Wood, Project Gutenberg (eBook 57348). https://www.gutenberg.org/files/57348/57348-h/57348-h.htm
18. **Tangent Handrailing — Trigonometric and Geometric Development** (calculateur), SBE Builders. http://www.sbebuilders.com/tools/geometry/tetrahedron_tangent.php
19. **Tangent handrail versus CAD**, KnoStairs. https://www.knostairs.com/kno-how/draw-stairs/tangent-handrail-versus-cad/
20. **Shallow pitch in – flight pitch out**, KnoStairs. https://www.knostairs.com/kno-how/draw-stairs/handrail-component-geometry/shallow-pitch-in-flight-pitch-out/
21. **Helix**, Wikipedia (EN). https://en.wikipedia.org/wiki/Helix
22. **Helicoid**, Wikipedia (EN). https://en.wikipedia.org/wiki/Helicoid
23. **Questions-réponses — ancienne réglementation — BHC neufs** (QR 81, escalier intérieur des logements, circulaire du 30 novembre 2007), accessibilite-batiment.fr (ministère). http://www.accessibilite-batiment.fr/questions-reponses/ancienne-reglementation/bhc-neufs.html
24. **Déterminer le giron pour un escalier tournant**, EHI (Escalier Hélicoïdal Industriel). https://www.escalier-ehi.fr/determiner-le-giron-pour-un-escalier-tournant/
25. **Échelle de meunier : caractéristiques et normes d'usage**, escaliers-bois.fr. https://www.escaliers-bois.fr/lechelle-de-meunier-ou-lescalier-echelle
26. **Norme escalier et échelle d'accès aux machines NF EN ISO 14122-3**, Pluceo (blog fabricant). https://www.pluceo.fr/blog/norme-escalier-et-echelle-d-acces-aux-machines-n52. Plages d'angle (escalier 20 à 45°, échelle à marches 45 à 75°) tirées des résultats de recherche (Échelle Européenne, AFNOR Norm'Info, ISO 14122-3:2016). Norme payante non lue.
27. **Cours sur le roulage (mise à jour 2020)**, Rocd@cier. https://www.rocdacier.com/cours-sur-le-roulage-mise-a-jour-2020/
28. **Winder Stair Requirements Explained**, Building Code Trainer (IRC 2018 R311.7.4, R311.7.5.2.1). https://buildingcodetrainer.com/winder-stair-tread/
29. **UK Staircase Building Regulations Explained**, DAB Stairs (Approved Document K). https://www.dabstairs.com/help-guides/building-regulations/. Source secondaire, remplacée par [37] pour les valeurs de marches balancées.
30. **Step Balancing on a Stair**, ideCAD Help Center. https://help.idecad.com/ideCAD/step-balancing-on-a-stair (méthodes Constant / Linear / Nonlinear ; contenu jugé peu exploitable).
31. **Balancement d'un escalier quart tournant**, galerie-creation.com. https://balancement.galerie-creation.com/_s/balancement-escalier-quart-tournant/814026/ (contenu superficiel ; confiance faible).
32. **Tracé d'un limon débillardé en métal**, galerie-creation.com. https://tracage.galerie-creation.com/_s/tracage-limon-debillarde-metal/812080/ (contenu superficiel ; confiance faible).
33. **Glossaire des escaliers**, Wikipédia (FR). https://fr.wikipedia.org/wiki/Glossaire_des_escaliers
34. **Balanced or Dancing Steps of Staircase**, *Cassell's Cyclopaedia of Mechanics* (P. N. Hasluck), chestofbooks.com. https://chestofbooks.com/crafts/mechanics/Cyclopaedia/Balanced-Or-Dancing-Steps-Of-Staircase.html
35. **Balancement des marches d'un escalier**, calcul-escaliers.web4me.fr. https://calcul-escaliers.web4me.fr/Balancement.htm (HTTP 403 à la lecture ; contenu connu seulement par l'extrait du moteur de recherche : méthodes « progression linéaire », « division par cercle », « herse », ligne de foulée « à 0,50 m du limon intérieur » ; confiance faible).
36. **Formule pour le développé d'une spirale**, forum Usinages. https://www.usinages.com/threads/formule-pour-le-developpe-dune-spirale.52575/ (connu par l'extrait de recherche : `√(p² + (π·d)²)` par spire ; confiance moyenne, formule confirmée par [21]).
37. **Approved Document K — Protection from falling, collision and impact**, édition 2013 (for use in England), HM Government / gov.uk. https://assets.publishing.service.gov.uk/media/60d5bdcde90e07716f516cfd/Approved_Document_K.pdf. Lu : §1.2–1.3 (tableau 1.1), §1.25–1.28, diagramme 1.9.
38. **Norm'Info — NF DTU 36.3 P3, Travaux de bâtiment — Escaliers en bois et garde-corps associés — Partie 3 : règles de conception**, AFNOR. https://norminfo.afnor.org/norme/nf-dtu-363-p3/travaux-de-batiment-escaliers-en-bois-et-garde-corps-associes-partie-3-regles-de-conception/103830 (statut vu via résultats de recherche : publication du 06/09/2014, en vigueur).
39. **DIN 18065:2020-08, Gebäudetreppen — Begriffe, Messregeln, Hauptmaße**, DIN Media. https://www.dinmedia.de/en/standard/din-18065/322316050 (fiche : édition 2020-08, remplace 2015-03).
40. **NF P21-210, Escaliers en bois — Terminologie / Vocabulaire**, Boutique AFNOR. https://www.boutique.afnor.org/en-gb/standard/nf-p21210/wooden-stairs-vocabulary/fa060192/57625 (existence vérifiée ; contenu non lu).
41. **Norm'Info — NF E85-015, Éléments d'installations industrielles — Moyens d'accès permanents — Escaliers, échelles à marches et garde-corps**, AFNOR. https://norminfo.afnor.org/norme/nf-e85-015/elements-dinstallations-industrielles-moyens-dacces-permanents-escaliers-echelles-a-marches-et-garde-corps/91316 (édition de juillet 2019, qui remplace celle de 2008, selon les résultats de recherche ; contenu non lu).
42. **Flat Form of a Flight of Screw Conveyor Formula**, EasyCalculation. https://www.easycalculation.com/formulas/flat-form-of-screw.html (page injoignable lors de la vérification (DNS) ; formule connue par l'extrait du moteur de recherche ; confiance moyenne).
43. **ISO 14122-3:2016 — Sécurité des machines — Moyens d'accès permanents — Partie 3 : escaliers, échelles à marches et garde-corps**, ISO. https://www.iso.org/standard/61282.html ; complété par L'Échelle Européenne, https://www.echelle-europeenne.com/page/47-norme-nf-en-iso-14122-3 (plages d'angles via résultats de recherche ; norme non lue).

---

## Journal de vérification

Vérification menée le 2026-09-28 par un second agent, en relecture sceptique. Méthode : relecture des sources primaires quand elles sont accessibles (PDF téléchargés et recherche plein texte), et recalcul numérique de chaque formule (scripts Python).

**Confirmé sans changement**

| Affirmation | Vérification |
|---|---|
| DTU 36.3 : ligne de foulée au milieu si `E ≤ 1,20 m`, sinon à 0,60 m de la rampe | Texte AFEB [1], p. « Ligne de foulée », renvoi RC 6-3 : identique. |
| Giron mesuré sur l'arc centré à l'intersection des faces internes des limons ; tolérances ± 5 / ± 10 mm ; giron minimal de 190 mm | [1], renvoi RC 6-5 : identique. |
| Module `2h + g` de 580 à 660 mm ; 600 mm au moins en ERP et parties communes de BHC | [1], renvoi RC 6-2 : identique. La valeur de 600 mm est une remarque du guide qui renvoie à la réglementation. |
| 25 marches au plus par volée sans palier | [1], renvoi RC 6-6 : identique. |
| Échelles de meunier et de grenier hors du domaine du DTU | [1], §4 « Présentation du DTU » : identique. |
| Annexe A du P3 (« gains de place » et hélicoïdaux) | [1] renvoie bien à RC Annexe A. Contenu toujours **non lu** (norme payante). |
| NF DTU 36.3 (septembre 2014) en vigueur | Norm'Info et CSTB [38]. |
| DIN 18065 : 100 / 50 / 0 mm, corde, monotonie, 3,5 × a, une seule méthode par volée | Citations en allemand retrouvées dans [5]. Édition 2020-08 en vigueur [39]. Confiance moyenne maintenue (source secondaire). |
| IRC : 6 in, 10 in sur la *walkline* à 12 in, 3/8 in | [28], citations mot pour mot (R311.7.4, R311.7.5.2.1). Texte IRC non lu. |
| StairDesigner : pivot autour du point de la ligne de foulée, CBL/CBD de 0 à 100 (50 par défaut), marche virtuelle, crosse, balancement centré et équiparti, 7 volées au plus, 1975 → 2150 mm, raccords 200/500 mm, « débillardée qui ne peut être usinée à plat » | PDF [2], recherche plein texte : tout est retrouvé. |
| Brevet US6845595 : 35 à 45 cm, 80 à 100° (préférence 85 à 95°, environ 90°) | [7] : conforme. |
| Accessibilité QR 81 : 0,50 m / 0,35 m, giron ≥ 24 cm, circulaire du 30/11/2007 | [23] : conforme. Arrêté de référence : 1er août 2006 (ancienne réglementation). |
| Roulage : `L = π·(Ø_int + e)` | [27] : conforme. En revanche, [27] ne traite **pas** les méplats d'extrémité : le texte a raison de dire qu'il faut les documenter. |
| Hermite cubique (formule, `F'`, `F'_max = (3S−m)/2`, exemple à 125 mm) | Recalcul exact : collets de 184,6 à 126,7 mm ; l'estimation est prudente. |
| M1 : `δ = 2(m·g − L_half)/(m(m+1))` | Somme arithmétique : correcte. |
| M0 : `c = g·r_j/r_f` | Homothétie : correcte. |
| Hélice : `L`, `κ`, `τ`, `ρ = (r²+b²)/r`, `b = h/Δθ`, développé en parallélogramme | Formules standard de l'hélice circulaire : correctes. |
| Limon droit : `W = (d_h + d_b)·cos α` ; étirement du nez en `1/sin β` | Géométrie : correcte. |
| Faces décalées : `dσ_δ/dσ = 1 − κδ` ; pentes développées différentes sur chaque face | Correct. |
| KnoStairs : `r = g/π` = 80,85 mm pour 254 mm | Calcul correct. |

**Corrigé**

1. **Herse (M2)** : le texte disait que les collets tendent vers l'équipartition quand `α → 0`. C'est faux. La limite est une progression homographique, et l'équipartition n'a lieu qu'à `α_eq = arccos(L_c/(m·g))`. Au-delà, la progression s'inverse. Le texte proposait aussi de « résoudre `α` pour que le premier collet vaille `g` » : c'est **impossible**, car ce collet vaut au plus `g·K/(1+K) < g`. Le §3.4 et le §6 sont corrigés.
2. **M3, variante quintique** : la formule du collet minimal ne valait que pour la variante cubique, alors que le document recommande la quintique. J'ai ajouté `c_min ≈ h/(m + 1,875·(S − m))` : environ 111 mm dans l'exemple, contre 125 mm en cubique. L'algorithme de choix de zone et le tableau comparatif sont corrigés.
3. **Raccord clothoïde (S3)** : le texte affirmait « avec `F` C2, raccord G2 ». C'est faux sur les faces : le saut de `κ'` à la naissance crée un saut de courbure développée de `m·κ'·e/2`. Le G1 reste exact sur les quatre arêtes.
4. **K1** : le ± 10 mm est une tolérance de mesure par rapport au nominal (réception), pas une marge de conception. La formulation est corrigée au §2.1 et au §3.1.
5. **Approved Document K** : la règle des 50 mm est **confirmée** (confiance relevée à élevée). La mesure à 270 mm ne vaut que pour une largeur d'au moins 1 m ; en dessous, le giron se mesure au milieu. J'ai ajouté les §1.26 (girons balancés identiques) et §1.27 (giron balancé au moins égal au giron droit).
6. **Brevet US6845595** : il n'est plus « à vérifier ». Il est **échu le 25/01/2013** pour défaut de paiement des annuités.
7. **Normes citées par EHI** : NF P21-210 existe (terminologie des escaliers en bois). « NF P 85-015 » est probablement NF E85-015 (installations industrielles, édition 2019, qui remplace celle de 2008).
8. **Couronne des plats hélicoïdaux** : présentée comme une dérivation originale, c'est en fait la formule classique de développement des spires de vis sans fin [42]. Le statut est requalifié.
9. **Trepedia, Winkelmethode** : la source compte 9 étapes, pas 10 (le fond est inchangé).
10. **ISO 14122-3** : la page [26] ne contient pas les plages d'angles. J'ai ajouté la source [43] (ISO, via extrait de recherche).

**Reste ⚠️ non vérifié**

- Annexe A du NF DTU 36.3 P3 : collet minimal français, ligne de foulée des hélicoïdaux, règles « gain de place ». Norme payante non accessible ; **c'est le point bloquant principal** pour les règles de collet.
- Contenu de NF P21-210 et de NF E85-015 (7/10 de la largeur de passage, milieu si moins de 1 m) : normes payantes.
- Texte IRC primaire (seule une source secondaire fidèle a été lue).
- Équivalents européens du brevet US6845595.
- Exemple de métier « collet de 7,4 cm » (§2.4) : source non relue, confiance faible maintenue.
- Échelle de meunier (60 à 75°, giron ≥ 20 cm, largeur de 60 à 80 cm) : source commerciale unique, confiance faible maintenue.
- Formules du système des tangentes [18] : calculateur non recoupé. `T = R·tan(Φ/2)` et `a = R/cos(pitch)` sont géométriquement justes pour un plateau de pente unique.
- Méthodes « danoise », « échelle de balancement », Maison Hélice (M4) : non relues ; descriptions toujours partielles.
- Règles de l'accessibilité en vigueur (arrêté du 24/12/2015 pour les BHC neufs) sur les lignes de mesure : à traiter par l'axe A.
