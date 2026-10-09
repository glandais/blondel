# Axe C — Structures, assemblages et coûts

> Projet **Blondel** — recherche préalable (prompt `docs/prompts/01-recherche.md`, axe C).
> Rédigé le 2026-09-28. Contexte réglementaire : France en priorité, puis EN / Eurocodes.

## 0. Mode d'emploi du document

### 0.1 Conventions

- Chaque valeur chiffrée est suivie d'une référence **[n]** (voir § Sources en fin de fichier) et d'un **niveau de confiance** :
  - **(élevé)** : texte normatif ou réglementaire lu directement, ou source primaire/officielle (Légifrance, extrait de norme, organisme technique : FCBA, CNC2M, président de commission AFNOR) ;
  - **(moyen)** : source secondaire sérieuse (guide professionnel, fabricant, sous-traitant), ou valeur normative rapportée par une source secondaire sans lecture du texte original ;
  - **(faible)** : blog, forum, page commerciale peu détaillée, extrait de moteur de recherche, ou valeur dont la méthode n'est pas décrite.
- Chaque exigence est typée :
  - **[NORME]** : exigence normative ou réglementaire (DTU, NF, EN, arrêté) ;
  - **[USAGE]** : usage de métier, règle de l'art, capacité de machine, pratique d'atelier ou prix de marché ;
  - **[CALCUL]** : calcul ou déduction faits pour Blondel à partir de valeurs sourcées. Ce ne sont pas des valeurs de référence.
- **Normes payantes non lues** : NF DTU 36.3 P1-1, P1-2 et P3, NF P01-012:2024, NF P01-013:2024, NF EN 1090-2, NF EN 1995-1-1, NF EN 1991-1-1/NA, NF EN 14080, NF DTU 39 P5. Elles sont connues ici par des sources secondaires (FCBA, AFEB, Apave, CNC2M, CBC, fabricants), qui sont signalées à chaque fois. **Aucun numéro d'article n'est cité sans source.** Là où la source ne donne pas le numéro, il n'est pas donné.

### 0.2 Synthèse en 12 points

1. **Bois — le NF DTU 36.3 (septembre 2014) est le référentiel de mise en œuvre et de conception** [1][2]. Sa partie P3 donne des « règles de moyens » valables à défaut de calcul pour un escalier d'**un étage au plus** et d'**emmarchement ≤ 1,20 m** [1] (élevé). Elle impose notamment une épaisseur de limon **≥ 29 mm** [1] (élevé) et donne un tableau des crémaillères (§ 1.4). Le calcul se fait selon l'**EN 1995-1-1 / NF EN 16481** [3][5] (élevé).
2. **NF EN 16481 (2014)**, valeurs par défaut en l'absence de valeur nationale : flèche **≤ L/200** (§ 6.2), fréquence propre **f₁ ≥ 5 Hz** sous une masse de 1 kN (§ 6.3), entaille marche/limon **≥ 14 mm** (§ 5.4.2 et 7.3.1 : assemblage résistant en flexion pour une marche *avec renfort*, semi-rigide pour une marche *sans renfort* ; torsion réputée vérifiée pour un limon entaillé), limon **≥ 44 mm** pour un modèle de ressort en torsion [3] (élevé, texte relu).
3. **Limon débillardé bois** : trois filières. (a) Massif par tronçons, raccordés traditionnellement par tenon + mortaise croisés, **boulon à écrou cannelé** et plates-bandes de fer [6] (élevé pour l'usage historique). (b) Lamellé-collé cintré sur gabarit, recommandé sous 60 mm d'épaisseur [7] (moyen). (c) « Couches collées » sans moule, pour les pièces épaisses [7][8] (moyen). En lamellé cintré, la résistance n'est pas réduite si **r_in/t ≥ 240**, et en pratique **r_in/t ≥ ≈ 170** [9] (moyen).
4. **Métal — la classe d'exécution dépend de la façon de fabriquer.** Les limons et supports d'escalier sont en famille B, donc en **CC1** quelle que soit la classe de l'ouvrage [13] (élevé). Un limon **soudé bout à bout** (c'est le cas du débillardé soudé par quartiers) passe en **PC2**, donc en **EXC2**. Un limon en profilé S235 sur cornières soudées, sans soudure de continuité, reste en **PC1 / EXC1** [13] (élevé). Ce choix pèse sur les coûts (qualification des soudeurs, contrôle de production en usine) et Blondel peut l'afficher.
5. **Limon débillardé métal** : la joue (flasque) verticale d'un limon qui suit un tracé en plan est une **portion de cylindre**, donc **développable**. On la découpe à plat au laser puis on la **roule**. Les faces de rive d'un caisson sont des surfaces gauches, **non développables** : on les forme par bandes étroites (formage « à la griffe ») [20] (moyen). Sur une rouleuse, le **diamètre** de cintrage minimum usuel vaut **1,3 × le diamètre D du rouleau supérieur** (soit un rayon ≥ 0,65 D), parfois 1,1 D [16] (moyen, usage, relu).
6. **Profilés du commerce** : barres de **6 m ou 12 m** [46] (moyen). Rayons de cintrage minimaux relevés chez un cintreur : **UPN aile intérieure r ≥ 650 mm, aile extérieure r ≥ 500 mm (≤ 260 × 90)**, sur chant r ≥ 200 mm (≤ 160 × 65), **IPE sur chant r ≥ 1 400 mm**, IPE à plat r ≥ 650 mm, **tube débillardé (hélicoïdal) Ø 88,9 × 5, r ≥ 250 mm** [15] (moyen, spécifique à la machine, relu). Un UPN cintré ne convient donc **pas au limon intérieur d'un hélicoïdal à petit jour** (déduction).
7. **Tôle pliée** : le rayon intérieur ne descend jamais sous l'épaisseur (≈ 1 × t en acier doux jusqu'à 3 mm). Valeurs standard : **2,6 mm pour t = 2 mm, 5 mm pour 4 mm, 6,5 mm pour 5 mm**, avec des longueurs de bord minimales de 9 à 23 mm [17] (moyen). Pour un S355 normalisé, le rayon garanti est de **1,5 × t jusqu'à 30 mm** [19] (moyen). Un grand sous-traitant en ligne plafonne le pliage à **8 mm et 2 980 × 1 200 mm** en S235 [18] (moyen).
8. **Tolérances** : bois, selon le NF DTU 36.3 (hauteur de la 1ʳᵉ marche **+10 / −30 mm**, cintrage des limons **5 mm/m**) [1][2] (élevé). Métal soudé, selon l'**ISO 13920:2023** (classe B : **±4 mm** de 1 à 2 m, **±6 mm** de 2 à 4 m, **±8 mm** de 4 à 8 m) [14] (élevé, texte FDIS).
9. **Garde-corps** : la **NF P01-012 a été révisée (publiée le 22/11/2024)**. Elle s'applique aux dossiers de PC/DP déposés à partir du **1/6/2025**, et aux travaux sans autorisation à partir du **1/1/2026** [34][73] (élevé). La hauteur est désormais fonction de l'épaisseur E (1,00 m si E ≤ 0,25 m, jusqu'à 0,80 m si E > 0,50 m). Les vides sont contrôlés par des gabarits (sphères **T1 = 0,11 m** jusqu'à 0,80 m, **T2 = 0,18 m** de 0,80 m à H, **T3 = 0,05 m** pour les mailles répétitives sur 0,60 m). Le **gabarit B** recherche les appuis **sur une hauteur de 0,60 m** (au lieu de 0,45 m en 1988) : un appui à une hauteur X comprise entre 0,10 m et 0,60 m impose H = 1,00 m + X [34][73] (élevé pour le principe, moyen pour le détail lu chez un fabricant). *Correction du vérificateur : la « plinthe de 0,60 m » de [34] désigne cette zone de recherche d'appuis, **pas une obligation de remplissage plein**.* Les règles propres aux **rampants d'escalier** dans la version 2024 **n'ont pas pu être lues** (norme payante), voir § 3.1.
10. **ERP (arrêté du 20/04/2017, art. 7-1)** : main courante **de chaque côté** (une seule si fût central ≤ 0,40 m), entre **0,80 et 1,00 m** au-dessus du nez de marche, prolongée **d'un giron** en haut et en bas, continue y compris aux paliers. Contremarches de 1ʳᵉ et dernière marche **≥ 0,10 m**, contrastées. Nez de marche sans débord de plus d'**une dizaine de mm** [39] (élevé).
11. **Coûts** : sur un devis de métallerie, la **main-d'œuvre d'atelier pèse 40 à 55 %**, la matière 20 à 35 % [26] (moyen). Acier S235 en négoce : **1,20 à 1,80 €/kg** en 2026 [26] (moyen). UPN au détail et coupé : **≈ 4,0 à 4,8 €/kg** [25] (moyen ; valeur corrigée par le vérificateur, voir § 5.1). Taux horaire d'un métallier : **45 à 70 € HT** [26] (moyen). Thermolaquage : **15 à 30 € HT/m²** [27] (moyen). Galvanisation : de l'ordre de **0,6 €/kg** (faible) [28].
12. **Prix de marché** (fourni-posé, 2026) : escalier métal droit à partir de **~3 500–3 945 € HT** ; quart tournant **4 333–11 000 €** ; hélicoïdal **6 000–15 000 €** ; **débillardé à partir de ~8 000 €** ; suspendu **10 000–25 000 €** [30][31] (faible à moyen, sources commerciales). La hiérarchie des coûts suit **le nombre de pièces uniques** et **le temps d'atelier**.

---

## 1. Structures bois (C.1)

### 1.1 Cadre normatif bois

| Texte | Objet | Statut / lecture | Réf. |
|---|---|---|---|
| **NF DTU 36.3** (sept. 2014) : P1-1 CCT, P1-2 CGM, P2 CCS, P3 Règles de conception | Escaliers en bois et garde-corps associés, intérieur et extérieur, neuf et réhabilitation, DROM compris | [NORME] payant, lu via FCBA et AFEB | [1][2] (élevé) |
| Remplace | le chap. VIII du NF DTU 31.1 (1993, A1 1998, A2 2002) et la XP P21-211 (2003) | [NORME] | [1] (élevé) |
| Exclusions | échelles de meunier et de grenier, escaliers escamotables (qui relèvent de la NF EN 14975+A1) | [NORME] | [2][5] (élevé) |
| **NF EN 16481** (août 2014) | Méthodes de calcul des escaliers en bois | [NORME] lu (extrait AFNOR diffusé par la commission) | [3] (élevé) |
| NF EN 1995-1-1 + AN | Calcul des structures bois (Eurocode 5) | [NORME] payant, non lu | [5] |
| Règles CB 71 | Encore admises si le DPM le spécifie, hors marchés publics, hors séisme et incendie | [NORME] | [5] (élevé) |
| NF EN 15644 | Escaliers préfabriqués de conception traditionnelle en bois massif. Les escaliers traditionnels doivent justifier des performances évaluées selon ce texte (CGM du DTU) | [NORME] | [5] (élevé) |
| EAD 340006-00-0506 (ex-ETAG 008) | Marquage CE **volontaire** des kits préfabriqués ou non traditionnels. **Pas de marquage CE réglementaire** pour les escaliers bois | [NORME] | [5] (élevé) |
| NF P21-210 / NF EN 14076 | Terminologie | [NORME] | [1][5] (élevé) |

**Justification mécanique** (DTU P3 chap. 4 selon l'AFEB) : par règles de moyens, par calcul Eurocode 5, par calcul CB 71 ou par essais. Il faut vérifier les marches, les limons ou crémaillères, et **les liaisons marches-limons** (P3 chap. 5) [2] (élevé).

Renvois utiles du guide AFEB vers le DTU (numéros donnés par l'AFEB, non relus dans le texte) [2] (moyen) : flèche maximale des limons et crémaillères **RC 5-2**, flèche maximale des marches **RC 5-3**, profondeur d'entaille **RC 5-4**, jeux d'assemblage **RC 10**, humidité des bois **CCT 6-2**, escaliers hélicoïdaux et gain de place **RC annexe A**, escaliers extérieurs **RC annexe C**, acoustique **RC annexe D**. **Les valeurs de ces articles n'ont pas été trouvées en accès libre.**

### 1.2 Actions à prendre en compte

| Action | Valeur | Contexte | Type | Réf. |
|---|---|---|---|---|
| Charge répartie qk, catégorie A (habitation), **escaliers** | **2,5 kN/m²** | NF EN 1991-1-1/NA (NF P 06-111-2, tableau 6.2(NF)), rappelée par FCBA pour le DTU 36.3 | [NORME] | [1][72] (élevé, AN relue) |
| Charge concentrée Qk, catégorie A, escaliers | **2 kN** | idem | [NORME] | [1][72] (élevé) |
| qk,1 par défaut (sans valeur nationale) | 3 kN/m² | NF EN 16481 § 4.2 | [NORME] | [3] (élevé) |
| Qk,1 par défaut | 2 kN | NF EN 16481 § 4.2 | [NORME] | [3] (élevé) |
| qk,2 horizontale sur garde-corps, par défaut | 0,5 kN/m | NF EN 16481 § 4.2 | [NORME] | [3] (élevé) |
| Masse unique pour la fréquence Mk,2 | 1 kN | NF EN 16481 § 4.2 | [NORME] | [3] (élevé) |
| Charge horizontale sur garde-corps, cat. A et B | **0,6 kN/m** | NF P 06-111-2 (AN), tableau 6.12(NF), relu | [NORME] | [72][41] (élevé) |
| idem, cat. C1 à C4 et D | **1 kN/m** | NF P 06-111-2/A1 (2009) via guide PACTE/CTB ; C1 était à 0,6 kN/m dans l'AN de 2004 | [NORME] | [72] ; SPEC X4 (moyen, A1 non lu) |
| idem, cat. C5 | 3 kN/m | idem | [NORME] | [72] (élevé) |
| idem, cat. E | 2 kN/m (minimum) | idem | [NORME] | [72] (élevé) |

> *Vérification* : un fabricant [73] classe C1 à 1,0 kN/m ; l'AN de 2004 relue donne 0,6 kN/m pour B et C1, mais l'amendement A1 (2009), cité par le guide PACTE/CTB, porte **C1 à 1,0 kN/m**. On retient la valeur A1 (voir SPEC X4). Point d'application théorique : 1,0 m au-dessus de la zone d'activité selon la NF P01-012:2024 rapportée par [73] (moyen).

> Pour Blondel : les valeurs françaises (AN) priment sur les valeurs par défaut de l'EN 16481. Stocker les deux, avec leur provenance.

### 1.3 Critères de service (flèche, vibration)

| Critère | Valeur | Type | Réf. |
|---|---|---|---|
| Flèche wG + wq,k1 et wG + wQ,k1 | **≤ L/200** par défaut (valeur reprise de l'ETAG 008), L = largeur d'appui de la marche pour une marche, longueur de volée sur la ligne médiane pour l'escalier entier | [NORME] | [3] § 6.2 (élevé) |
| Fréquence fondamentale de l'escalier entier | **f₁ ≥ 5 Hz** (combinaison « fréquence fondamentale Mk,2 ») | [NORME] | [3] § 6.3 (élevé) |
| Flèche courante adoptée en résidentiel | L/300 à L/400 (≈ 7 à 10 mm pour un limon de 3 m) | [USAGE] | [52] (faible) |
| Flèches maximales propres au DTU 36.3 (RC 5-2, 5-3) | **non trouvées en accès libre** | [NORME] | [2] |

### 1.4 Limon à la française (marches encastrées) et limon à l'anglaise (crémaillère)

**Définitions.** Le limon est la « pièce de bois principale recevant les marches et, éventuellement, des contremarches et une rampe » [4] (élevé). À la française, les marches sont logées dans des **entailles** (rainures) du limon, qui les dépasse en haut et en bas. À l'anglaise, le limon est découpé en **crémaillère** et les marches reposent à plat sur les dents [23] (moyen).

**Règles et valeurs.**

| Paramètre | Valeur | Type | Réf. |
|---|---|---|---|
| Épaisseur minimale du limon (règles de moyens P3) | **≥ 29 mm** | [NORME] | [1] (élevé) |
| Domaine des règles de moyens | escalier d'**un étage au plus**, emmarchement **≤ 1,20 m** | [NORME] | [1] (élevé) |
| Entaille marche/limon (EN 16481 § 5.4.2) | **d_entaille ≥ 14 mm** (d'autres valeurs admises si démontrées). Effet : marche **avec renfort**, assemblage modélisé comme résistant en flexion autour de y ; marche **sans renfort**, assemblage semi-rigide (ressort k_y = 3EI_y/(4L_marche)) | [NORME] | [3] (élevé, relu) |
| Limon permettant un modèle de ressort en torsion (combinaison « fréquence ») | **d_limon ≥ 44 mm**, marche sans renfort liée au limon en traction (k_y = EI_y/(2L_marche)) | [NORME] | [3] (élevé, relu) |
| Section résiduelle sous entailles | > 100 mm (résineux), > 80 mm (feuillus) | [NORME ?] rapportée par un moteur de recherche, **article non identifié** ⚠️ non vérifié (valeur absente de [1], [2] et [3]) | (faible) |
| Règle historique d'épaisseur (1900) | 0,08 m pour 1 m d'emmarchement, ± 0,005 m par 0,03 m d'emmarchement en plus ou en moins | [USAGE] historique | [6] (élevé pour l'usage historique) |
| Épaisseurs de limon usuelles, fabricants | 40–46 mm ; section 45 × 250 mm courante en kit extérieur | [USAGE] | [53] (faible) |
| Épaisseur historique des limons (1900) | 80 à 110 mm | [USAGE] | [6] (élevé pour l'usage historique) |
| Arasement du limon | débord constant au-dessus du nez et au-dessous de la marche sur tout le développement | [USAGE] | [6] (élevé) |

**Crémaillère, règles de conception du DTU** (exemple publié par FCBA : crémaillère non fixée au mur, escalier droit, hauteur d'étage 2,70 m, pente 38°) [1] (élevé) :

| Bois | Épaisseur (mm) | Distance mini entre le fond des entailles et la sous-face rampante (mm) |
|---|---|---|
| Résineux ≥ C30 (E = 12 000 MPa) | 33 | 179 |
| | 44 | 163 |
| | 70 | 141 |
| Feuillus ≥ D40 (E = 13 000 MPa) | 35 | 177 |
| | 44 | 162 |
| | 70 | 139 |

Valables **pour des crémaillères allant par paire**. Pour une **crémaillère centrale unique, les épaisseurs sont à multiplier par 2** [1] (élevé).

**Paramètres Blondel.** Type de limon (français / anglais), essence et classe de résistance, épaisseur, hauteur utile (débord haut `d_h`, débord bas `d_b`), profondeur d'entaille, reste sous entaille (`h_res`), présence de contremarches, fixation murale (limon mural) ou non.

### 1.5 Limon central (bois)

- Une crémaillère centrale unique demande **deux fois l'épaisseur** du tableau § 1.4 [1] (élevé). En pratique, on obtient une poutre épaisse en **couches collées** [7][8] (moyen).
- La torsion de la marche sur le limon est à vérifier (moment de torsion M_x,d ≤ M_x,Rd, EN 16481 § 7.3.1). Pour un limon entaillé, la vérification est considérée comme satisfaite si **d_logement ≥ 14 mm** [3] (élevé, relu).
- Assemblage marche/limon central, pratiques observées : entaille arrière de la marche dans le limon pour renforcer, et **boulons de 10 ou 12 mm** qui traversent le limon, avec écrou [54] (faible, forum).

### 1.6 Limon débillardé bois

**Définition.** Débillarder, c'est tailler la rive du limon selon une courbe **dans le plan vertical et dans le plan horizontal**, pour suivre le tournant sans jarret [12] (faible, vulgarisation). En termes géométriques, c'est la « courbe rampante » de Storck [6].

**Filières de fabrication.**

| Filière | Principe | Domaine | Réf. |
|---|---|---|---|
| **Massif par tronçons** (quartiers) | Tracé sur épure grandeur réelle, gabarits reportés sur madriers, sciage et toupillage. Chaque courbe rampante est prise dans un bloc dont l'**équarrissage** augmente avec la longueur du tronçon et la présence de tenons | Historique ; pièces épaisses | [6] (élevé), [12] (faible) |
| **Lamellé-collé cintré sur moule** | Paquets de plis (exemple : contreplaqué souple 7 mm + placage chêne 2 mm) collés et serrés sur un moule en chevrons boulonnés à un contreplaqué épais, par serre-joints progressifs | Recommandé **si l'épaisseur est < 60 mm** | [7] (moyen) |
| **Couches collées sans moule** | Empilement de couches découpées selon le plan, collées puis délardées | Limons **épais** (> 60 mm), crémaillères centrales | [7][8] (moyen) |

**Lamellé-collé cintré : lien entre rayon et épaisseur de lame.**

| Règle | Valeur | Type | Réf. |
|---|---|---|---|
| Pas de réduction de résistance (k_r = 1) | **r_in/t ≥ 240** | [NORME] EN 1995-1-1 (poutres courbes, zone d'apex) | [9][71] (élevé : formule reproduite par Swedish Wood) |
| k_r si r_in/t < 240 | **k_r = 0,76 + 0,001 · r_in/t**, soit 0,93 / 0,86 / 0,83 pour r_in/t = 170 / 100 / 70 | [NORME] EN 1995-1-1 | [71] (élevé) |
| Limite pratique de fabrication | **r_in/t ≥ ≈ 170** (« en aucun cas inférieur à environ 170 ») | [USAGE] | [9] (moyen, relu) |
| Lame usuelle en charpente cintrée | 33 mm. **Lames plus fines si le rayon est < 7 m** | [USAGE] | [10] (moyen, relu) |

> **Correction du vérificateur.** La version précédente donnait k_r = 0,83 / 0,67 / 0,50 pour r_in/t = 170 / 100 / 70. Ces valeurs sont **fausses**. Le tableau 7.2 de [9] est une image non lisible en texte, et la formule EC5 reproduite par [71] donne 0,93 / 0,86 / 0,83. La pénalité de résistance est donc faible. La limite de **170 est une limite de fabrication** (risque de rupture des lames au cintrage, contraintes résiduelles), pas un seuil de calcul. Pour Blondel : k_r = 1 si r_in/t ≥ 240 ; k_r = 0,76 + 0,001·r_in/t de 170 à 240 ; blocage sous 170.
>
> **Exemple [CALCUL]** (recalculé) : limon de jour, r_in = 300 mm → t ≤ 300/240 = 1,25 mm (k_r = 1) ou t ≤ 300/170 ≈ 1,76 mm (limite pratique, k_r = 0,93). On obtient des placages de 1,5 à 2 mm, ce qui cadre avec le placage de 2 mm de [7]. Pour r_in = 1 200 mm → t ≤ 5,0 à 7,1 mm.
> ⚠️ non vérifié : avec des plis de 1 à 7 mm (contreplaqué cintrable + placage, [7]), la pièce **n'est plus un lamellé-collé structurel au sens de la NF EN 14080**. L'application de l'EC5 (k_r, classes GL) à ces empilements n'est pas démontrée et relève d'un calcul ou d'essais.

**Assemblages entre tronçons (raccords de limon).**

| Assemblage | Description | Réf. |
|---|---|---|
| **Coupe à crochet boulonnée** + **plates-bandes de fer** entaillées et vissées sur le chant | Mode le plus courant pour les limons courbes (1900) | [6] (élevé) |
| Tenon + mortaise **croisés** (chaque partie porte un tenon et une mortaise) | Préféré à la clef (faux tenon), qui affaiblit les deux abouts | [6] (élevé) |
| **Boulon d'escalier** (« boulon à clavette par un bout et à écrou par l'autre ») | Introduit avant la mise en joint. L'écrou, **circulaire à circonférence cannelée**, se loge dans une mortaise et se serre au ciseau frappé | [6] (élevé) |
| Clef / faux tenon | Joint simple + clef dans deux mortaises. Déconseillé | [6] (élevé) |
| Tourillons | Ø 10 mm, excentrement de tirage ≤ 1 mm sur feuillu, à 2,5 cm de l'épaulement (pour les tenons limon/poteau) | [11] (faible, forum) |
| Boulon d'escalier moderne | Ex. M10 × 250 à écrou à cliquet, inox | [55] (faible, catalogue) |

**Position des joints.**
- Storck place les joints **au milieu des courbes rampantes** (raccord limon de palier / limon de rampe) « pour éviter un trop grand nombre d'assemblages » [6] (élevé). Les boulons sont dans l'axe des limons droits [6] (élevé).
- Une courbe rampante qui ne porte **que des mortaises** (pas de tenons) réduit la longueur et l'équarrissage du bloc dans lequel on la taille [6] (élevé). **Implication Blondel** : le logiciel doit pouvoir choisir le côté du tenon pour minimiser le bloc brut de la pièce courbe.
- [USAGE] non sourcé à confirmer auprès d'un atelier : joint à la tangence droite/courbe ou décalé dans la partie droite pour que la pièce courbe ait une section de départ rectiligne. Voir aussi l'axe B.4.

**Paramètres Blondel.** Filière (massif / lamellé / couches), essence, épaisseur finie `e`, épaisseur de lame `t` (lamellé), rayons r_in / r_ext en plan, découpage (par quart, par demi, au milieu du tournant), type de raccord (crochet, tenon-mortaise croisés, boulon), surlongueur, bloc brut (L × l × e) par tronçon, sens du fil (voir § 4).

### 1.7 Marches, contremarches, nez de marche

| Élément | Règle / valeur | Type | Réf. |
|---|---|---|---|
| Marches bois massif (épaisseurs courantes) | 32–35 mm avec contremarche, ≈ 42 mm sans contremarche ; « au moins 35, 40, 45 mm » selon les fabricants | [USAGE] | [53] (faible) |
| Marches sur limon central acier | 35–40 mm pour un emmarchement ≤ 80 cm (exemple de fabricant) | [USAGE] | [42] (faible) |
| Marches en porte-à-faux (bois massif) | 80–100 mm | [USAGE] | [47] (faible) |
| Arrondi du nez de marche | rayon **≤ 10 mm** (XP P21-211, reprise dans le DTU 36.3) | [NORME] (historique) | [4] (moyen) |
| Nez de marche en ERP | contrastés visuellement **sur au moins 3 cm en horizontal**, non glissants, **débord ≤ « une dizaine de millimètres »** par rapport à la contremarche | [NORME] | [39] (élevé, relu) |
| Contremarches en ERP | 1ʳᵉ et dernière marche : contremarche **≥ 0,10 m**, contrastée par rapport à la marche sur au moins 0,10 m de hauteur | [NORME] | [39] (élevé, relu) |
| Glissance (XP P21-211) | mesurée selon NF P 90-106, < 100 à sec | [NORME] (historique) | [4] (moyen) |
| Épaisseurs minimales de marche du DTU 36.3 P3 (règles de moyens) | **non trouvées en accès libre** | [NORME] | — |

### 1.8 Marches en porte-à-faux (murales) et escalier suspendu

- **Porte-à-faux** : chaque marche est encastrée d'un côté dans un mur porteur. Support **béton armé ou maçonnerie pleine**. Une cloison légère, une brique creuse ou un parpaing creux ne conviennent pas [48] (faible à moyen). Des fabricants citent un mur porteur d'au moins **10–12 cm** (brique pleine, béton) ou **≥ 18 cm** en béton plein, ou bien une structure métallique d'environ 9 cm sur dalle, et une platine acier de 10 mm [47] (faible : plusieurs fabricants, valeurs non harmonisées).
- **Escalier suspendu** : les marches sont ancrées au mur d'un côté et **suspendues à la main courante porteuse** par des balustres de l'autre (système Treppenmeister, qui revendique l'invention). Trois modes de support existent : encastrement en maçonnerie porteuse, poutre acier centrale cachée, câbles ancrés au plafond [48][56] (faible à moyen).
- **Implication Blondel** : ces solutions **sortent du domaine des règles de moyens** du DTU (qui suppose des limons). Il faut imposer un **calcul ou un avis technique fabricant** (sévérité « bloquant sans justification »).

### 1.9 Poteaux, assemblages limon/poteau, fausses marches

- Poteau d'angle de 90–100 mm sur un escalier à 2 quarts tournants : jugé non affaibli par deux tenons fourchus chevillés [11] (faible).
- Les limons droits rencontrant un quartier tournant peuvent s'assembler **à tenons et mortaises**. Les limons droits formant un angle quelconque s'assemblent **à queues**, maintenus par plates-bandes [6] (élevé).
- Écartement des limons tenu par des **boulons (tirants)** qui traversent sous l'emmarchement et se scellent dans le mur ou relient les deux limons [6] (élevé).
- Pied de limon : **patin** horizontal + **jambette**, et souvent **volute** au départ, qui reçoit le premier balustre [6] (élevé, historique).
- [USAGE] : le boulonnage des limons aux poteaux est souvent préféré au tenon-mortaise parce qu'on peut **resserrer après retrait** du bois [54] (faible).

### 1.10 Humidité et tolérances de fabrication bois (NF DTU 36.3)

| Classe de destination | Exemple | Humidité visée | Tolérance | Réf. |
|---|---|---|---|---|
| 1 | local couvert et chauffé | 10 % | −1 / +6 | [1] (élevé) |
| 2 | local couvert non chauffé, ou extérieur abrité | 15 % | ±3 | [1] (élevé) |
| 3 | exposé aux intempéries | 20 % | ±5 | [1] (élevé) |

| Élément | Cintrage (longueur) | Tuilage (largeur l) | Réf. |
|---|---|---|---|
| Marches et contremarches | 5 mm/m | 3 mm si l < 350 mm ; 0,7 mm/10 cm si l > 350 mm | [1] (élevé) |
| Poteaux et mains courantes | 5 mm/m | sans objet | [1] (élevé) |
| Limons et crémaillères | 5 mm/m | 3 mm si l < 350 mm ; 0,7 mm/10 cm au-delà | [1] (élevé) |
| Balustres ou palines | 3 mm/m | 5 mm si l < 350 mm | [1] (élevé) |

Autres tolérances du DTU : hauteur de marche **±5 mm** ; hauteur de la 1ʳᵉ marche après pose **+10 / −30 mm** ; giron **±5 mm** (droit), **±10 mm** (balancé) [2] (élevé). Support maçonné : cotes de maçonnerie brute **±7 mm** ; aplomb **±7 mm** pour une hauteur d'étage ≤ 3,00 m ; hauteur à monter (sol fini à sol fini) **±7 mm** jusqu'à 3,00 m, puis intervalle de tolérance **10 × h^(1/3) mm** (h en m) au-delà ; implantation des trémies **[0 ; +7 mm]** [1][2] (élevé, relu dans [1]).

**Durabilité extérieure** : conception drainante, classe d'emploi 3.2 (non abrité) ou 3.1 (abrité). Le plus souvent **classe 4** si la conception est piégeante. Choix des essences selon le FD P 20-651 [1] (élevé).

### 1.11 Limon central bois : lamellé-collé GL, entraxes et pinces, tire-fonds, platine à âme noyée

Complément du **2026-10-09** (QUESTIONS A33 (a), (e), (f), A34 (a), (b), (c) ; sources consultées le 2026-10-09). Les deux normes en jeu, **NF EN 14080** (lamellé-collé) et **NF EN 1995-1-1** (Eurocode 5), ne sont **pas lues** : leurs valeurs viennent de [71], guide de calcul de Swedish Wood qui reproduit les tableaux et en donne la source (« Table according to EN 14080:2013 », « according to EN 1995-1-1:2004, 8.5.1.1 »). Confiance **moyenne** (valeur normative rapportée par une source secondaire sérieuse). Valeurs relues dans le texte du PDF de [71] (extraction `pdftotext`).

**Classes de lamellé-collé homogène (NF EN 14080:2013, non lue ; [71] tableau 3.4, p. 12)** :

| Classe | f_m,g,k (MPa) | f_t,0,g,k | f_c,0,g,k | f_v,g,k | E_0,g,mean (MPa) | E_0,g,05 (MPa) | ρ_g,k (kg/m³) | ρ_g,mean (kg/m³) | Réf. |
|---|---|---|---|---|---|---|---|---|---|
| GL24h | 24 | 19,2 | 24 | 3,5 | 11 500 | 9 600 | 385 | 420 | [71] (moyen) |
| GL28h | 28 | 22,4 | 28 | 3,5 | 12 600 | 10 500 | 425 | 460 | [71] (moyen) |
| GL32h | 32 | 25,6 | 32 | 3,5 | 14 200 | 11 800 | 440 | 490 | [71] (moyen) |

- Résistances en flexion et en traction valables pour une hauteur de 600 mm (effet de hauteur au § 3.3 de [71], non repris) [71] (moyen).
- Coefficient partiel du lamellé-collé **γ_M = 1,25** (bois massif 1,3 ; assemblages 1,3), « according to EN 1995-1-1:2004, 2.4.1 » [71] tableau 3.1, p. 7 (moyen ; valeurs recommandées, l'annexe nationale française n'est pas lue).
- k_mod du lamellé-collé identique à celui du bois massif (classes de service 1 et 2 : 0,60 / 0,70 / 0,80 / 0,90 / 1,10 de la charge permanente à instantanée) [71] tableau 3.2, p. 8 (moyen).
- Bois massif, pour mémoire : C24 E_0,mean = 11 000 MPa, f_m,k = 24 MPa ; C30 12 000 MPa, 30 MPa (EN 338 via [71] tableau 3.3, p. 10, moyen), ce qui recoupe les valeurs « à valider » de `precheck/`.
- ⚠️ Rappel (§ 1.6) : des plis de 1 à 7 mm ne font pas un lamellé-collé NF EN 14080 ; ces classes ne s'appliquent qu'à des lamelles conformes à la norme (épaisseur des lamelles non trouvée en accès libre).

**Entraxes et pinces des boulons et des broches dans le bois (NF EN 1995-1-1 § 8.5.1.1 et § 8.6, non lue ; [71] tableaux 10.4 et 10.5, p. 45)**. d : diamètre du boulon ou de la broche ; α : angle entre l'effort et le fil.

| Distance | Boulons | Broches | Réf. |
|---|---|---|---|
| a1, entraxe parallèle au fil (0° ≤ α ≤ 360°) | (4 + \|cos α\|)·d | (3 + 2·\|cos α\|)·d | [71] (moyen) |
| a2, entraxe perpendiculaire au fil | 4·d | 3·d | [71] (moyen) |
| a3,t, extrémité chargée (−90° ≤ α ≤ 90°) | max(7·d ; 80 mm) | max(7·d ; 80 mm) | [71] (moyen) |
| a3,c, extrémité non chargée | 90° ≤ α < 150° : (1 + 6·sin α)·d ; 150° ≤ α < 210° : 4·d ; 210° ≤ α ≤ 270° : (1 + 6·\|sin α\|)·d | 90° ≤ α < 150° : a3,t·\|sin α\| ; 150° ≤ α < 210° : max(3,5·d ; 40 mm) ; 210° ≤ α ≤ 270° : a3,t·\|sin α\| | [71] (moyen) |
| a4,t, rive chargée (0° ≤ α ≤ 180°) | max((2 + 2·sin α)·d ; 3·d) | max((2 + 2·sin α)·d ; 3·d) | [71] (moyen) |
| a4,c, rive non chargée (180° ≤ α ≤ 360°) | 3·d | 3·d | [71] (moyen) |

- Recoupé par [77] (faible, page de vulgarisation : mêmes formules).
- Pour des assemblages bois-acier boulonnés ou brochés, [71] renvoie à sa section 10.3 (non relue ici) [71].
- **[CALCUL]** Valeurs « tous angles » retenues par Blondel faute de connaître α (à valider) : boulons a1 = 5·d, a3,c = 4·d (extrémité non chargée, effort dirigé vers l'intérieur de la pièce), a4,c = 3·d ; broches a1 = 5·d, a3,t = max(7·d ; 80 mm), a4,t = 4·d. Pour M10 : a1 = 50 mm, a3,c = 40 mm, a4,c = 30 mm ; broche Ø12 : a1 = 60 mm, a3,t = 84 mm, a4,t = 48 mm. a1, a2, a3,t, a4,t et a4,c sont l'enveloppe sur α ; **a3,c ne l'est pas** (son maximum sur α vaut 7·d pour un boulon et a3,t pour une broche, à 90°). Les deux organes ne suivent pas la même convention : les boulons et tire-fonds de marche gardent a3,c aux bouts de l'assise, les broches de platine prennent a3,t depuis la coupe au sol ou la coupe de tête (extrémité supposée chargée) ; choix à trancher (QUESTIONS A35 (e)).

**Vis et tire-fonds dans le bois.**

| Règle | Valeur | Type | Réf. |
|---|---|---|---|
| Vis chargées latéralement, d > 6 mm | règles des boulons (§ 8.5 de l'EC5) ; d ≤ 6 mm : règles des pointes ; d (diamètre extérieur du filet) sert aux entraxes et pinces | [NORME] EN 1995-1-1 § 8.7.1 rapporté | [71] § 10.6.1, p. 46 (moyen) |
| Vis chargées axialement, entraxes et pinces | a1 = 7·d ; a2 = 5·d ; a1,CG = 10·d ; a2,CG = 4·d | [NORME] EN 1995-1-1 § 8.7.2 rapporté | [71] tableau 10.6, p. 48 (moyen) |
| Tire-fond DIN 571 Ø10, classe 4.6 | longueurs 60 à 160 mm ; avant-trou **Ø 6,5 mm** ; « longueur telle que la profondeur d'ancrage soit d'au moins **50 mm** » ; arrachement caractéristique 732 daN (essai XP P30-310, bois à 15 %, 450 kg/m³) | [USAGE] fiche fabricant | [78] (moyen) |
| Gamme DIN 571 du négoce | Ø 5 à 20 mm, longueurs 25 à 500 mm | [USAGE] | [79] (faible, catalogue) |

**Platine à âme noyée (ferrure en T).** Aucune source escalier ; la ferrure la plus proche est le **pied de poteau à âme intérieure** du commerce [80] (moyen, fiche fabricant) :

| Grandeur | Valeur relevée | Réf. |
|---|---|---|
| Âme et platine | tôle de **4 mm** (deux modèles) | [80] (moyen) |
| Rainure à scier dans le bois | **6 mm** pour une âme de 4 mm (1 mm de jeu par face) | [80] (moyen) |
| Fixation dans le bois | **2 broches Ø12** (ou boulons Ø12) au travers du bois et de l'âme | [80] (moyen) |
| Platine | 100 × 100 ou 130 × 130 mm, 4 chevilles M10 (perçages Ø12) | [80] (moyen) |
| Hauteur de l'âme | 60 à 80 mm (largeur 60 à 80 mm) pour des poteaux jusqu'à 200 × 200 | [80] (moyen) |

- **Implication Blondel** : un pied de poteau n'est pas un appui de limon central (efforts horizontaux et moments différents) ; les dimensions par défaut de la platine d'un limon central restent **à valider** par un atelier. Seuls le principe (âme dans un trait de scie de l'épaisseur de l'âme plus le jeu, broches au travers) et l'ordre de grandeur (broches Ø12, jeu de 1 mm par face) sont repris de [80].

**Couches collées sans moule (complément de § 1.6).** « Quand le limon est très épais par exemple dans le cas d'un limon crémaillère centrale, j'utilise la technique de couches collées » ; « utilisable pour les limons de plus de 60 mm d'épaisseur » ; « [cela] me permet de construire simplement le limon sans construire un moule et dans le cas d'une crémaillère, de ne pas avoir à couper les crans » [8] (moyen, relu le 2026-10-09). La source ne donne **ni l'épaisseur des couches, ni leur orientation, ni la surcote de délardement** : épaisseur, orientation (couches horizontales découpées selon le plan, décision de l'utilisateur A33 (e)) et surcote sont des conventions Blondel **à valider**.

---

## 2. Structures métal (C.2)

### 2.1 Cadre normatif métal

| Texte | Objet | Lecture | Réf. |
|---|---|---|---|
| NF EN 1090-2 | Exécution des structures acier | payant ; lu via la CNC2M | [13] (élevé) |
| **CNC2M N0169 (janvier 2015)** | Recommandations pour choisir la classe d'exécution | lu | [13] (élevé) |
| NF EN 1993-1-1 (EC3) | Calcul acier | non lu | — |
| **ISO 13920:2023** (remplace l'éd. 1996) | Tolérances générales des constructions soudées | lu (texte FDIS) | [14] (élevé) |
| NF E85-015 (version de **juillet 2019**) | Éléments d'installations industrielles, moyens d'accès permanents : escaliers, échelles à marches et garde-corps (cité par un fabricant d'hélicoïdaux) ; complète la NF EN ISO 14122-3 pour les zones non accessibles au public (domaine exact ⚠️ non vérifié) | payant, non lu ; version vérifiée sur la notice AFNOR | [51][76] (moyen) |
| NF EN ISO 14122-3 | Escaliers d'accès aux machines. Essai des marches caillebotis cité : 1,5 kN sur 10 × 10 cm | non lu | [44] (moyen) |

**Classe d'exécution d'un escalier métallique** [13] (élevé) :
- Famille **B** (« éléments de circulation courants ») : « poutraison, limons, et supports d'escaliers ». Elle donne **CC1** pour toutes les classes d'ouvrage CCO.1 à CCO.3 (tableau 3).
- Catégorie de service : **SC1** en général. Une note précise que « **certains escaliers de secours** » peuvent relever de SC2 (actions induites par la foule).
- Catégorie de production : **PC1** pour les éléments non soudés, ou soudés en nuance < S355. **PC2** pour les « éléments soudés (toutes nuances) comportant des **assemblages de continuité par soudures bout à bout** », les nuances ≥ S355, le soudage sur chantier d'éléments essentiels et le **formage à chaud**.
- Tableau 6 : CC1 + SC1 + PC1 donne **EXC1** ; CC1 + SC1 + PC2 donne **EXC2** ; CC1 + SC2 donne EXC2.

> **Implication Blondel [CALCUL]** : un limon **débillardé soudé par quartiers bout à bout**, un limon en **S355** ou un limon **forgé à chaud** passent en **EXC2**. Un limon UPN/plat S235 en une pièce, avec cornières soudées d'angle, reste en **EXC1**. Blondel peut **déduire et afficher la classe d'exécution** à partir des choix de conception.

### 2.2 Limon en plat découpé (laser) et limon en tube

- Limons latéraux : deux plats acier ou deux U. Limon central : une poutre sous les marches. Crémaillère : plat découpé en dents [23] (moyen).
- Exemples relevés : limon hélicoïdal extérieur plat de **250 mm** de haut, main courante Ø 42 mm à 3 sous-lisses [50] (faible) ; limons en tôle de 8 mm, consoles de marche en tôle de 8 mm [20] (moyen) ; limon central tube **200 × 100** avec supports en tôle **4 mm** pliée en triangle ouvert et marches chêne 40 mm [42] (faible) ; limon central tube 220 × 80 avec supports « aile de mouette » découpés dans du 10 mm [43] (faible).
- **Tube cintré** : le « court rayon » vaut **2 à 3 fois** la section du tube, le « grand rayon » commence **à partir de 10 fois** la section [57] (moyen, cintreur). Capacité d'un cintreur : tube carré ≤ 100 × 100 × 10 avec **r_min 700 mm** [15] (moyen).
- **Imbrication (nesting)** [CALCUL] : un limon droit est une **bande rectiligne** qui s'imbrique bien dans la longueur d'une tôle. Un limon débillardé développé est une **bande courbe** (sauf pour un hélicoïdal à pas constant, où la bande développée est rectiligne, voir § 2.4), avec plus de chutes.

### 2.3 Limon en profilé du commerce UPN / IPN / IPE / HEA

**Intérêt** [USAGE] : pas de découpe laser pour le limon lui-même, barres standard, coût matière maîtrisé. Les ailes du U « offrent une assise toute trouvée aux marches » [23] (moyen). Les limons peuvent être en larges plats, tubes rectangulaires, UPAF (U formés à froid) ou poutrelles UPN, UPE, IPN, IPE [23] (moyen).

**Données de section (UPN)** [24] (moyen) :

| Profil | h × b × tw (mm) | kg/m | Iy (cm⁴) | Wel,y (cm³) |
|---|---|---|---|---|
| UPN 120 | 120 × 55 × 7,0 | 13,4 | 364 | 60,7 |
| UPN 140 | 140 × 60 × 7,0 | 16,0 | 605 | 86,4 |
| UPN 160 | 160 × 65 × 7,5 | 18,85 | 925 | 116 |
| UPN 180 | 180 × 70 × 8,0 | 22,0 | 1 350 | 150 |

**Supports de marche sur UPN** [USAGE] [58] (faible) : cornières pointées puis soudées, positionnées **au gabarit**. Pointage de 2–3 mm d'abord pour contrôler aplomb et niveau, puis soudure complète. Entretoises entre limons. Jeu d'environ **1 cm de chaque côté** entre marche et limons pour glisser les cornières. Marches en tôle larmée soudée ou en caillebotis vissé.

**Cintrage des profilés** : capacités d'un cintreur français, **indicatives et propres aux machines** [15] (moyen) :

| Profil | Sens | Section max | r_min (mm) |
|---|---|---|---|
| UPN/UAP | sur chant | 160 × 65 | **200** |
| UPN/UAP | aile intérieure | 260 × 90 | **650** |
| UPN/UAP | aile extérieure | 260 × 90 | **500** |
| IPN/IPE | sur chant | 180 × 82 | **1 400** |
| IPE/IPN | à plat | 260 × 113 | **650** |
| Cornière L | extérieure | 140 × 15 | 700 |
| Cornière L | intérieure | 120 × 12 | 650 |
| Fer plat | sur chant | 140 × 30 | 650 |
| Fer plat | à plat | 220 × 50 | 600 |
| Tube carré | — | 100 × 100 × 10 | 700 |
| Tube rond débillardé (hélicoïdal) | — | Ø 88,9 × 5 | **250** |
| Tube rond | — | Ø 330 × 15 | 3 D |

> *Vérification* : tableau relu sur [15] le 2026-09-28. Les rayons sont donnés pour la **section maximale** de chaque ligne ; une section plus petite peut accepter un rayon plus faible (non précisé par la source).

Un autre cintreur précise que les rayons minimaux de roulage « ne pourront être indiqués qu'après essai ou étude » [59] (moyen).

**Limites [CALCUL / USAGE]** :
- Un limon UPN qui suit un plan courbe se cintre « aile intérieure » ou « aile extérieure », avec **r ≥ 500 à 650 mm** [15]. Cela exclut le **limon intérieur (côté jour)** d'un hélicoïdal ou d'un balancé à jour étroit. C'est compatible avec le **limon extérieur** d'un hélicoïdal de diamètre ≥ 1,4 m, gamme courante chez un fabricant : Ø 1 400 à 3 800 mm [51] (moyen).
- Un cintrage **hélicoïdal** (plan courbe + pente) d'un profilé est une opération spéciale, à valider chez le cintreur. **Aucune capacité chiffrée trouvée pour les profilés ouverts (U, I)** ; pour un **tube rond débillardé**, un cintreur annonce Ø 88,9 × 5 à r ≥ 250 mm [15] (moyen), ce qui concerne surtout les mains courantes.
- Esthétique : le U laisse voir ses ailes et impose une hauteur de limon fixée par le profil (120 à 200 mm environ). Sur un tournant, le raccord droit/courbe d'un profilé impose une coupe d'onglet soudée ou un cintrage.
- **Flèche indicative [CALCUL, non normatif]** : UPN 160 en appui simple sur 4,8 m, charge d'environ 1,6 kN/m par limon (moitié de 2,5 kN/m² × 0,9 m = 1,125 kN/m, plus poids propre et marches estimés). On obtient 5qL⁴/(384EI) ≈ **5,7 mm ≈ L/840** (recalculé : 5,69 mm, E = 210 000 MPa, I = 925 cm⁴). Un plat 300 × 10 (I = 2 250 cm⁴) donne ≈ 2,3 mm, mais le **déversement** et la **torsion** gouvernent alors. *Vérification* : pour 14 girons de 250 mm et 2,70 m, le rampant théorique vaut √(3,50² + 2,70²) ≈ **4,42 m** ; 4,8 m est donc un **majorant** (surlongueurs d'about comprises), ce qui va dans le sens de la sécurité. La charge est rapportée à la longueur inclinée, ce qui est une simplification. Ordre de grandeur à faire vérifier par un calcul EC3.

### 2.4 Limon porteur débillardé soudé (métal)

**Principe observé** (réalisation d'un limon central débillardé) [20] (moyen) :
1. âme en HEB (partie droite) « la plus minimaliste possible » ;
2. **deux flasques débillardées obtenues par roulage** ;
3. mise en place avec **entretoises** à espacement régulier pour tenir la distance et renforcer le bas ;
4. **formage « à la griffe » des faces haute et basse**, décrit comme délicat ;
5. **pointage complet**, puis **soudage MAG** ;
6. **meulage et ponçage** des soudures ;
7. consoles de marches en tôle de **8 mm**, positionnées **au gabarit**.

D'autres métalliers décrivent : découpe laser ou jet d'eau des grandes formes, cintrage, soudure, meulage [60] (faible) ; tube découpé selon les courbes, chaque section cintrée puis soudée ; pliage de tôle pour les courbes faibles ; forge à environ 900 °C pour les formes complexes [21] (faible).

**Géométrie et fabricabilité [CALCUL, à relier à l'axe B.4]** :
- La **joue verticale** d'un limon dont la trace en plan est une courbe C est un **morceau de cylindre de directrice C** (génératrices verticales). Elle est **développable** : son développé s'obtient en déroulant l'abscisse curviligne de C, avec les cotes verticales conservées. On la **découpe à plat puis on la roule**. Si C est un arc de cercle, le roulage se fait à rayon constant. Si C est une courbe à courbure variable (raccord droite-arc, clothoïde), il faut un **roulage progressif** ou des tronçons à rayon constant.
- Hélicoïdal à pas constant sur cylindre : les rives sont des hélices, et le **développé est une bande rectiligne inclinée**, simple à imbriquer. Quart tournant balancé : les rives ne sont pas des hélices, le développé est une **bande en S**.
- Les **faces de rive** (dessus/dessous d'un caisson, perpendiculaires à la joue) forment une surface réglée **gauche, non développable**. On les réalise par bandes étroites formées « à la griffe » [20], par segments courts soudés, ou en les supprimant (limon « lame » en simple joue épaisse).
- **Rouleuse** : capacité nominale définie pour une **largeur de tôle égale à la longueur totale des rouleaux**, Re = 240 N/mm² (S235) et **diamètre de cintrage = 1,3 × D du rouleau supérieur**, « valeur minimum usuelle » [16] (relu). Attention : c'est un **diamètre** ; en rayon, r_min ≈ 0,65 D. On obtient parfois **1,1 D**. Une tôle étroite (< 1/4 de la longueur des rouleaux) ne doit pas dépasser 1,7 × l'épaisseur nominale [16] (moyen). Exemple d'équivalence : e = 8 mm à F = 1,3 D équivaut à e = 12 mm à F = 10 D [16] (moyen). Un limon est une **bande étroite et longue** : il faut vérifier la **longueur de rouleaux** (le développé doit y tenir en largeur) et le rapport rayon / Ø du rouleau.
- **Découpage en quartiers** [USAGE / CALCUL] : un tronçon par quart tournant limite la longueur à rouler et la taille de la tôle. Les joints soudés bout à bout se placent de préférence **hors des zones de console de marche** et à **courbure constante** de part et d'autre (même rayon), pour ne pas cumuler une discontinuité de courbure et une soudure. C'est une recommandation de conception, **non sourcée**, à valider avec un atelier.

**Déformations de soudage et reprise** [22][61] (moyen) :
- Types : retrait **transversal**, **longitudinal** (effet de cintrage, « ±1,2 mm par mètre » sur tôle mince) et **angulaire**. Ordres de grandeur pour un chanfrein en V : 30° → ≈ 1°, 60° → ≈ 4°, 90° → ≈ 8° de déformation angulaire.
- Parades : **surlongueur de 1 à 2 mm** avant soudage, soudage **symétrique**, **pas de pèlerin**, **pré-déformation** égale et opposée au retrait, bridage le plus tard possible (matériaux sensibles à la fissuration), moins de métal déposé, moins de passes.
- Reprise : redressage mécanique (presse, martelage) ou **chaudes de retrait** [22][61] (moyen).
- **Gabarit de soudage** [USAGE] : pour les consoles, gabarit de position [20] (moyen). Pour le limon, un marbre avec des **cales de profil développé** (une cale par génératrice) est une pratique courante supposée, **non sourcée**. Blondel peut générer ces cales (DXF).

**Tolérances des constructions soudées (ISO 13920:2023)** [14] (élevé, texte FDIS) :

| Longueur nominale (mm) | 2–30 | 30–120 | 120–400 | 400–1 000 | 1 000–2 000 | 2 000–4 000 | 4 000–8 000 | 8 000–12 000 |
|---|---|---|---|---|---|---|---|---|
| Classe A (±mm) | 1 | 1 | 1 | 2 | 3 | 4 | 5 | 6 |
| Classe B (±mm) | 1 | 2 | 2 | 3 | 4 | 6 | 8 | 10 |
| Classe C (±mm) | 1 | 3 | 4 | 6 | 8 | 11 | 14 | 18 |
| Classe D (±mm) | 1 | 4 | 7 | 9 | 12 | 16 | 21 | 27 |

Angles (plus petit côté ≤ 400 / 400–1 000 / > 1 000 mm) : A ±20'/±15'/±10' ; **B ±45'/±30'/±20'** ; C ±1°/±45'/±30' ; D ±1°30'/±1°15'/±1° [14] (élevé). Rectitude, planéité, parallélisme (classes E à H), exemple de 2 000 à 4 000 mm : E 3, **F 6**, G 11, H 18 mm [14] (élevé). Désignation sur plan : par ex. « ISO 13920-BF ».

> La première colonne (2–30 mm = ±1 pour toutes les classes) est reconstituée à partir d'un tableau mal extrait. Confiance **moyenne** pour cette colonne.
> **Écart à signaler** : le DTU bois admet 5 mm/m de cintrage [1], alors que l'ISO 13920 classe F admet 6 mm de 2 à 4 m. Pour un escalier mixte (limon acier, marches bois), il faut **combiner** les tolérances dans la chaîne de cotes.

### 2.5 Limon central (poutre caisson, tube) et crémaillère métal

- Limon central : **effet flottant**. Supports de marche soudés, marche vissée par-dessous [23] (moyen).
- Section rectangulaire (ex. 100 × 200) : facilite le **traçage des repères** pour souder ou boulonner les supports [42] (faible).
- Caisson débillardé : deux flasques roulées + entretoises + faces formées [20] (moyen), voir § 2.4.
- Crémaillère métal : plat découpé laser en dents de scie [23] (moyen). Épaisseurs relevées : 8 à 10 mm (voir § 2.2).

### 2.6 Supports de marche, marches métalliques

| Solution | Données | Type | Réf. |
|---|---|---|---|
| Cornières soudées sur limon | pointage puis soudage, gabarit de pose | [USAGE] | [58] (faible) |
| Supports en tôle pliée découpée laser (U, Z, triangle) | adaptés à la largeur du limon central et à l'angle de pente, qui fixent la profondeur et la longueur des plis ; plan validé avant découpe ; marches bois **≥ 38 mm** recommandées | [USAGE] | [43] (faible) |
| Consoles tôle 8 mm | positionnées au gabarit | [USAGE] | [20] (moyen) |
| Tôle pliée « auto-porteuse » (marche + contremarche en Z) | **4 à 6 mm**, structure principalement fixée au mur | [USAGE] | [62] (faible) |
| Marche caillebotis | largeurs 500 à 1 500 mm, profondeurs 200 à 305 mm, maille 30 × 30, flasques perforées boulonnables, nez soudé, galvanisation à chaud ; **1,5 kN sur 10 × 10 cm** (≈ 5 kN/m²) selon ISO 14122-3 | [USAGE] + [NORME rapportée] | [44] (moyen) |
| Tôle larmée | épaisseurs 3/5, 4/6, 5/7, 6/8, 8/10, 10/12 (base / relief). ≥ 5 mm pour les usages exigeants. **Aucune table portée/charge trouvée** | [USAGE] | [45] (faible) |
| Marches en tôle pleine | ex. 10 mm | [USAGE] | [60] (faible) |
| Bois sur ossature métal | marches vissées sur supports soudés | [USAGE] | [23] (moyen) |

**Tôle pliée : règles de fabrication.**

| Paramètre | Valeur | Type | Réf. |
|---|---|---|---|
| Règle générale | le rayon intérieur **ne doit jamais être inférieur à l'épaisseur** | [USAGE] | [17] (moyen) |
| Acier Rm 40–45 daN/mm², valeurs classiques (r_int / L_int mini) | 1 mm : 1,3 / 4,5 ; 2 mm : 2,6 / 9 ; 3 mm : 4,0 / 14,5 ; 4 mm : 5,0 / 18 ; **5 mm : 6,5 / 23** ; 6 mm : 8 / 29 ; **8 mm : 10 / 37** ; 10 mm : 13 / 45 | [USAGE] | [17] (moyen, relu) |
| Valeurs serrées (r_int / L_int mini) | 1 : 1,0 / 3 ; 2 : 2,0 / 6,5 ; 3 : 3,3 / 11 ; 4 : 4,0 / 13,5 ; 5 : 5,0 / 17 ; 6 : 6,5 / 22 ; 8 : 8 / 27 ; 10 : 10 / 35 | [USAGE] | [17] (moyen, relu) |
| S235/S355, t ≤ 3 mm | r_min ≈ 1 × t, pli de préférence **en travers du sens de laminage** | [USAGE] | [63] (faible) |
| S355 normalisé (EN 10025-2) | rayon garanti **1,5 × t** dans toutes les directions jusqu'à 30 mm (produit SSAB S355J2+N) | [USAGE fabricant] | [19] (moyen, recoupé sur la page produit) |
| S355 thermomécanique (EN 10025-4) | **1,0 × t** en travers, 1,5 × t en long, jusqu'à 20 mm (produit SSAB Domex 355ML) | [USAGE fabricant] | [19] (moyen, recoupé sur la page produit) |
| Sous-traitant en ligne (S235) | épaisseur de pliage **0,63 à 8 mm** ; pièce max **2 980 × 1 200 mm**, 45 kg ; tolérance angulaire ±0,5° ; aile ±0,2 mm ; largeur mini de pliage 21 mm (valeurs pour des plis à 90°) ; trous en zone de pli Ø ≤ 5 mm, et longueur cumulée des trous ≤ 10 % de la longueur de pli | [USAGE] | [18] (moyen) |
| Trous et filetages | à éviter dans la zone de pli ; distance au pli ≥ L_min | [USAGE] | [17] (moyen) |

> **Implication Blondel** : une marche pliée (en U ou en Z) de plus de **~3 m** de développé ou plus épaisse que **8 mm** sort des capacités de la presse-plieuse standard d'un sous-traitant en ligne [18]. Le logiciel doit **vérifier les longueurs de pli, l'épaisseur, le rayon et le bord minimal** à partir d'une table de capacités propre à l'atelier.

### 2.7 Assemblages et fixations

- **Soudure** : MAG pour les limons [20] (moyen). Au-delà du pointage, le passage en EXC2 impose des modes opératoires qualifiés et l'ISO 3834-3 [64] (moyen).
- **Boulonnage** : marches bois vissées par-dessous sur supports [23] (moyen). Boulonnage des marches et du palier contre le fût central pour un hélicoïdal industriel [51] (moyen).
- **Fixations murales et dalle** : pour les garde-corps d'étage sur chape flottante ou plancher chauffant, l'ancrage peut demander une **ceinture béton**, à prévoir par le maître d'œuvre [2] (élevé). Le poseur vérifie que les supports sont conformes aux réservations et prévient le maître d'œuvre sinon [2] (élevé). **Aucune règle chiffrée de cheville trouvée** : Blondel doit renvoyer à l'ETE ou au calcul du fabricant de cheville (sévérité : conseil).

### 2.8 Finitions (impact fabrication)

- Galvanisation : facturée **au poids après galvanisation** (pesage « à blanc »). Majorations pour pièces encombrantes ou double trempe, de **+50 % à +200 %**, et main-d'œuvre annexe à **52 €/h** minimum chez un galvaniseur [65] (moyen). Les **corps creux** (tubes, caissons) demandent des **perçages d'évent** [28] (faible). Blondel doit placer automatiquement les évents sur les caissons si « galva » est choisi.
- Thermolaquage : poudre polymérisée au four **vers 200 °C** selon [27] (moyen ; la version précédente indiquait 180 °C, valeur absente de [27]). Taille de cabine et de four à demander au laqueur (**non trouvée**).

---

## 3. Garde-corps et mains courantes (C.3)

### 3.1 NF P01-012 : version 2024 et transition

| Élément | Valeur | Type | Réf. |
|---|---|---|---|
| Publication de la version révisée | **22 novembre 2024** (versions précédentes 1967, 1978, 1988) | [NORME] | [34][35] (élevé) |
| Application : travaux soumis à autorisation d'urbanisme | dépôt PC/DP **à partir du 1ᵉʳ juin 2025** : version 2024 obligatoire ; avant cette date, marché établi avec la version 1988 ou 2024 | [NORME] | [34] (élevé) |
| Travaux non soumis à autorisation | marché **à partir du 1ᵉʳ janvier 2026** : version 2024 | [NORME] | [34] (élevé) |
| NF P01-013 (essais) | révisée en 2024 pour être cohérente | [NORME] | [34][35] (élevé) |
| Nouveau titre | « Solutions techniques relatives aux éléments de protection visant à limiter le risque de chute accidentelle de hauteur des personnes dans le cadre d'un usage normal des bâtiments » | [NORME] | [34] (élevé) |
| Déclencheur | élément de protection requis si la **hauteur de chute > 1 m** | [NORME] | [34] (élevé) |
| Charges statiques | Eurocode 1 ; charges dynamiques NF P01-013 (2024) | [NORME] | [34] (élevé) |

**Hauteur minimale h depuis la zone d'activité, selon l'épaisseur E de l'élément** (version 2024) [34] (élevé) :

| E (m) | ≤ 0,25 | 0,25–0,30 | 0,30–0,35 | 0,35–0,40 | 0,40–0,45 | 0,45–0,50 | > 0,50 |
|---|---|---|---|---|---|---|---|
| h (m) | 1,00 | 0,975 | 0,95 | 0,925 | 0,90 | 0,85 | 0,80 |

Les valeurs 0,85 et 0,80 m portent un renvoi (b) dans [34], dont le contenu n'est pas reproduit ⚠️ non vérifié.

H = h + x, où x est la hauteur des **appuis éventuels** (gabarit B). H est aussi rehaussée en fonction des **dénivelés intérieurs** [34] (élevé). *Précision du vérificateur* d'après un fabricant qui reprend la norme [73] (moyen) : les dénivelés pris en compte sont ceux situés à **moins de 1,60 m du nu intérieur** de la protection (et latéralement à moins de 0,30 m). Il s'agit d'une **distance**, pas d'une hauteur. Formule citée : H = max(1,00 ; 1,60 + X − Y), avec l'exemple d'une marche de 0,40 m qui donne H = 1,20 m. La définition exacte de Y n'est pas lisible dans [73] ⚠️ non vérifié.

**Gabarit B (appuis), 2024** [73] (moyen, fabricant ; principe confirmé par [34]) :
- zone d'application : **sur une hauteur de 0,60 m depuis la zone d'activité**, sur l'élément de protection, dans l'environnement intérieur jusqu'à **0,60 m** du nu intérieur (latéralement 0,30 m), et dans l'environnement extérieur accessible à travers la protection ;
- un appui à la hauteur X, avec **0,10 m ≤ X < 0,60 m**, impose **H = 1,00 m + X** ;
- une lisse basse à X < 0,10 m n'entraîne pas de rehausse. Un vide ≤ 0,05 m n'offre pas d'appui ;
- tolérances en œuvre : H **0 mm** ; appui à 0,10 m **+15 mm** ; appui à 0,60 m **−0 mm** ; discontinuité de 0,05 m **+20 mm** ; vides B, T1, T2, T3 **+0 mm**.

**Vides maximaux (2024)** [34][73] (élevé) : gabarit **T1 = sphère Ø 0,11 m** (cas général ; pour les garde-corps, de la zone d'activité jusqu'à 0,80 m) ; **T2 = sphère Ø 0,18 m** (garde-corps, de 0,80 m à H) ; **T3 = sphère Ø 0,05 m** (remplissages à mailles répétitives, **sur 0,60 m** depuis la zone d'activité [73]) ; gabarits appliqués **sans effort** [73] ; discontinuité maximale de la partie supérieure **0,05 m**. Résumé de la commission : « **plinthe de 0,60 m au lieu de 0,45 m** » et vigilance sur les **appuis parasites** (gabarit B). *Interprétation corrigée* : cette « plinthe » correspond à la **zone de recherche d'appuis de 0,60 m**. Le fabricant [73] parle d'une « hauteur d'allège minimale 0,60 m ». **Aucune source primaire n'impose un remplissage plein sur 0,60 m.**

**Durabilité (2024)** : les vides ne doivent **pas augmenter dans le temps**. Attention **aux câbles qui se détendent** et au **retrait des profilés bois** [34] (élevé).

**Escaliers, version 2024 : points non vérifiés sur le texte**
- Hauteur en escalier **≥ 90 cm, mesurée à la verticale depuis le nez de marche** [36] (moyen).
- Vide entre la première lisse et le nez de marche **≤ 5 cm** s'il n'y a pas de limon [66] (faible).
- Un fabricant affirme pour les escaliers : lisses < 18 cm, **câbles < 14,5 cm**, barreaux < 11 cm, et des charges de 60 daN/ml (habitation) / 100 daN/ml (ERP) [37] (faible). Le 14,5 cm **n'apparaît ni dans [34] ni dans [73]**. Ces deux sources ne connaissent que les gabarits T1 (0,11 m jusqu'à 0,80 m) et T2 (0,18 m au-dessus). **⚠️ non vérifié, à ne pas implémenter.** Pour Blondel, par défaut : câbles horizontaux traités comme des lisses (T1 jusqu'à 0,80 m, T2 au-dessus, et contrôle d'appui au gabarit B entre 0,10 et 0,60 m), avec un avertissement sur la détente des câbles [34]. Le traitement propre au **rampant** reste à lire dans la norme.

**Régime 1988 (encore applicable aux marchés antérieurs)**, rampes d'escalier d'après la fiche POB [4] (moyen) :
- barreaux verticaux : vide **≤ 11 cm** (±3 mm) ;
- éléments parallèles à la pente : vide **≤ 18 cm** (±3 mm), mesuré perpendiculairement à la pente, **ou ≤ 5 cm** entre le dessous de la 1ʳᵉ lisse (ou du panneau) et les nez de marche ;
- autres remplissages : pas de passage d'un gabarit **11 × 11 × 25 cm**.

> **Implication Blondel** : stocker **deux jeux de règles** (1988 / 2024) avec une **date de dépôt PC/DP ou de marché** comme paramètre du projet. Les règles 2024 propres aux rampants restent à confirmer (« question ouverte » pour SPEC.md).

### 3.2 Typologies de remplissage

| Remplissage | Points de conformité et de fabrication | Réf. |
|---|---|---|
| Barreaudage vertical | T1 (0,11 m) sur toute la hauteur. Pas d'appui escaladable | [34] (élevé) |
| Lisses horizontales | 2024 : vides < T1 (0,11 m) jusqu'à 0,80 m, puis < T2 (0,18 m) au-dessus. **Entre 0,10 et 0,60 m, toute lisse qui offre un appui au gabarit B rehausse H de X** (H = 1,00 + X) [73] (moyen). En pratique, une zone basse pleine ou barreaudée verticalement évite cette rehausse (déduction du vérificateur). **Risque d'escalade** : la commission juge qu'il n'a « aucune réponse raisonnable possible par les dispositions constructives » | [34][73] (élevé pour T1/T2, moyen pour le gabarit B) |
| Câbles inox | Ils se détendent, ce qui pose un problème de durabilité des vides [34] (élevé). Selon des fabricants, ils seraient **interdits en zone basse (0–0,60 m)** en 2024 [37][38] (faible). Plus exactement, ce sont des éléments horizontaux soumis au contrôle d'appui du gabarit B (voir ci-dessus) ⚠️ interdiction non vérifiée sur le texte | [34][37][38][73] |
| Verre (pincé, sur platines, encastré en pied) | NF DTU 39 P5 (révisé 2016) : verre **feuilleté PVB (1B1 selon NF EN 12600)** ; autres intercalaires 1B1 + P1A (NF EN 356) ; **trempé monolithique** seulement avec protection résiduelle (1C1). Essais dynamiques NF P01-013 : **M50 à 600 J** (50 kg, chute 1,20 m) au centre du remplissage (à 500 mm d'un bord libre) ; bille **D0,5** (50 mm, 500 g) pour les plaques ; D1/10 J + M50/900 J possible à hauteur de main courante ; pour le verre encastré en pied, **D0,5/3 J** complémentaire selon le Cahier CSTB 3034 ; les pinces et agrafes doivent être **justifiées par configuration** | [40] (élevé, relu). ⚠️ Les énergies d'essai reprises par [40] ne précisent pas la version de la NF P01-013 (1988 ou 2024). La correspondance avec la NF P01-013:2024 n'est pas vérifiée |
| Tôle perforée | T3 (0,05 m) applicable aux mailles répétitives, à vérifier selon le motif | [34] (élevé) |
| Remplissage bois | retrait du bois : le vide doit rester conforme dans le temps | [34] (élevé) |

### 3.3 Main courante

| Règle | Valeur | Type | Réf. |
|---|---|---|---|
| Prise de main (écart main / paroi) | **D ≥ 3 cm** en logement individuel, **D ≥ 5 cm** dans les autres cas (DTU 36.3 CCT 6.2.6) | [NORME] | [2] (élevé) |
| Nombre en ERP | **une de chaque côté** ; une seule si fût central de Ø ≤ 0,40 m | [NORME] | [39] (élevé, relu) |
| Hauteur en ERP | **0,80 à 1,00 m** au-dessus du nez de marche. Si un garde-corps tient lieu de main courante, il est à la hauteur minimale du garde-corps ; si le garde-corps dépasse 1 m, il porte une main courante entre 0,80 et 1,00 m | [NORME] | [39] (élevé, relu) |
| Prolongement en ERP | horizontalement, **d'un giron** au-delà de la 1ʳᵉ et de la dernière marche | [NORME] | [39] (élevé) |
| Continuité en ERP | « continue, rigide et facilement préhensible y compris sur chaque palier intermédiaire », contrastée par rapport à la paroi | [NORME] | [39] (élevé) |
| Diamètre usuel | Ø 42 mm (bois ou inox) ; Ø 42,4 mm (tube inox) | [USAGE] | [50][67] (faible) |
| Ø ≥ 40 mm (ERP) | valeur **non trouvée dans l'arrêté** ; rapportée par des sites commerciaux | [USAGE] | (faible) |
| Raccords de main courante bois | raccords inox doubles vissés et collés, manchons de liaison, supports à vis double filetage M8 | [USAGE] | [67] (faible) |
| Charges | cat. A, B : 0,6 kN/m ; C1–C4, D : 1 kN/m (voir § 1.2) | [NORME] | [41] (moyen) |

**Main courante courbe** (gabarit, développé, délardement) : voir l'axe B.3. Les **retours et raccords** d'une main courante bois débillardée reprennent les assemblages du § 1.6 (boulon à écrou cannelé [6]).

---

## 4. Paramètres géométriques et contraintes de fabrication, par solution (C.4)

### 4.1 Table de contraintes (candidates à `rules` / `capabilities` dans Blondel)

| id | Solution | Paramètre | Valeur | Type | Sévérité proposée | Réf. |
|---|---|---|---|---|---|---|
| C-B-01 | Limon bois (règles de moyens) | épaisseur mini | ≥ 29 mm | NORME | bloquant hors calcul | [1] |
| C-B-02 | Crémaillère bois (paire) | tableau épaisseur / reste | § 1.4 | NORME | bloquant hors calcul | [1] |
| C-B-03 | Crémaillère centrale | épaisseur | × 2 | NORME | bloquant hors calcul | [1] |
| C-B-04 | Entaille marche/limon | profondeur | ≥ 14 mm (hypothèse de modèle et vérification de torsion EN 16481 § 5.4.2 / 7.3.1 ; sinon démonstration) | NORME | avertissement | [3] |
| C-B-05 | Flèche escalier et marche | w | ≤ L/200 (défaut EN) | NORME | bloquant si calcul | [3] |
| C-B-06 | Fréquence propre | f₁ | ≥ 5 Hz | NORME | avertissement | [3] |
| C-B-07 | Domaine des règles de moyens | emmarchement, hauteur | ≤ 1,20 m ; ≤ 1 étage | NORME | bloquant (bascule vers calcul) | [1] |
| C-B-08 | Lamellé cintré | r_in/t | ≥ 240 : k_r = 1 ; 170–240 : k_r = 0,76 + 0,001·r_in/t ; < 170 : refus | NORME (EC5) / USAGE | information / bloquant sous 170 | [9][71] |
| C-B-09 | Humidité du bois | selon la classe | 10 / 15 / 20 % | NORME | conseil (fiche fabrication) | [1] |
| C-B-10 | Cintrage limon (tolérance) | | 5 mm/m | NORME | contrôle qualité | [1] |
| C-M-01 | Classe d'exécution | soudure bout à bout ou S355 | EXC2, sinon EXC1 | NORME (reco.) | information / coût | [13] |
| C-M-02 | Pli tôle | r_int | ≥ t (S235) ; ≥ 1,5 t (S355N) | USAGE | bloquant | [17][19] |
| C-M-03 | Pli tôle | bord mini | table [17] | USAGE | bloquant | [17] |
| C-M-04 | Presse-plieuse (sous-traitant type) | e_max, L_max | 8 mm ; 2 980 mm | USAGE (paramétrable) | avertissement | [18] |
| C-M-05 | Rouleuse | Ø_min (diamètre, pas rayon) | 1,3 × D rouleau (parfois 1,1 D), soit r_min ≈ 0,65 D | USAGE (paramétrable) | avertissement | [16] |
| C-M-06 | Cintrage UPN | r_min | 500 (aile ext.) / 650 (aile int.) / 200 (chant) | USAGE (paramétrable) | bloquant | [15] |
| C-M-07 | Cintrage IPE | r_min | 1 400 (chant) / 650 (à plat) | USAGE (paramétrable) | bloquant | [15] |
| C-M-08 | Longueur de barre | L | 6 m / 12 m | USAGE | avertissement (aboutage) | [46] |
| C-M-09 | Tolérance soudé | classe | ISO 13920-BF par défaut | NORME (choix) | information plan | [14] |
| C-M-10 | Caisson galvanisé | évents | obligatoires | USAGE | bloquant si galva | [28] |
| C-G-01 | Garde-corps 2024 | h(E) | tableau § 3.1 | NORME | bloquant | [34] |
| C-G-02 | Garde-corps 2024 | vides | T1 0,11 jusqu'à 0,80 m / T2 0,18 de 0,80 m à H / T3 0,05 (mailles, sur 0,60 m) ; vides strictement inférieurs, tolérance +0 | NORME | bloquant | [34][73] |
| C-G-03 | Garde-corps 2024 | appuis (gabarit B) | zone 0–0,60 m : appui à X ∈ [0,10 ; 0,60[ m ⇒ H ≥ 1,00 + X (corrigé : ce n'est pas une obligation de plein) | NORME (via fabricant) | bloquant | [34][73] |
| C-G-03b | Garde-corps 2024 | dénivelés | dénivelé à < 1,60 m du nu intérieur ⇒ rehausse (formule ⚠️ à relire dans la norme) | NORME (via fabricant) | avertissement | [73] |
| C-G-04 | Garde-corps 1988 | rampe | 11 cm / 18 cm // pente / 5 cm sous 1ʳᵉ lisse | NORME | bloquant (si régime 1988) | [4] |
| C-G-05 | Main courante | écart paroi | ≥ 3 cm (MI) / ≥ 5 cm | NORME | bloquant | [2] |
| C-G-06 | Main courante ERP | nombre, hauteur, prolongement | 2 (1 si fût ≤ 0,40 m) ; 0,80–1,00 m ; + 1 giron | NORME | bloquant (ERP) | [39] |
| C-G-07 | Verre | produit | feuilleté 1B1 ; pinces justifiées | NORME | bloquant | [40] |

### 4.2 Sens du fil, débit bois, épaisseurs brutes

- [USAGE] Une courbe rampante taillée dans le massif **coupe le fil** en travers sur les parties très courbes. C'est la raison historique du **découpage en tronçons** et du choix de tronçons « à mortaises seulement », pour limiter l'équarrissage [6] (élevé).
- [CALCUL] Bloc brut d'un tronçon courbe massif = boîte englobante (en plan : corde + flèche de l'arc + épaisseur ; en hauteur : dénivelé du tronçon + hauteur du limon). Blondel peut calculer ce volume et le **taux de perte** (volume fini / volume brut) pour comparer massif, couches collées et lamellé.
- Chêne en plateaux, 2025, selon la qualité : **1 500 à 2 160 €/m³** [68] (moyen). Qualité charpente : 625–750 €/m³ [68] (moyen). Le taux de perte d'un débillardé massif est donc un **poste de coût majeur**.

### 4.3 Longueurs et formats métal

- Poutrelles UPN, IPE, HEA : barres de **6 m ou 12 m**, parfois 14–15 m, ou coupe à longueur [46] (moyen). Au détail, coupe de 1 à 4 m selon la section [25] (moyen).
- Formats de tôle : **aucune source fiable trouvée pour les formats standard de table laser** (3 000 × 1 500, 4 000 × 2 000, 6 000 × 2 000 sont courants dans le métier, **à confirmer** par l'atelier). À paramétrer dans Blondel.

---

## 5. Coûts comparés (C.5)

### 5.1 Coûts unitaires (France, 2025-2026)

| Poste | Valeur | Date source | Type | Réf. | Confiance |
|---|---|---|---|---|---|
| Acier S235, prix matière indicatif | 1,20–1,80 €/kg (±15–20 %) | janv. 2026 | USAGE | [26] | moyen |
| Inox 304 / 316 | 4–6 / 6–9 €/kg | janv. 2026 | USAGE | [26] | moyen |
| UPN 80–160 au détail (S235/S275), coupé | 41,51 €/m (UPN 80) à 87,49 €/m (UPN 160), soit **≈ 4,0 à 4,8 €/kg** (corrigé : 4,80 €/kg pour l'UPN 80, 3,99 €/kg pour l'UPN 120, 4,64 €/kg pour l'UPN 160) ; HT/TTC non précisé ; longueurs au détail 1 à 4 m (UPN 80) et **1 à 2 m seulement pour l'UPN 160** | consulté 2026-09-28 | USAGE | [25] | moyen |
| Taux horaire métallerie générale | 45–60 € HT | janv. 2026 | USAGE | [26] | moyen |
| Serrurerie-métallerie | 50–70 € HT | janv. 2026 | USAGE | [26] | moyen |
| Ferronnerie d'art | 60–90 € HT | janv. 2026 | USAGE | [26] | moyen |
| Pose sur chantier (métal) | 55–80 € HT/h | janv. 2026 | USAGE | [26] | moyen |
| Répartition d'un devis de métallerie | **matière 20–35 %, main-d'œuvre atelier 40–55 %**, puis traitement de surface, pose, frais | janv. 2026 | USAGE | [26] | moyen |
| Thermolaquage acier | **15–30 € HT/m²** (moyenne ≈ 22 € HT/m²) ; teintes standard 10–25, effets spéciaux jusqu'à 30 ; au kg 7–12 € HT (petites pièces) ; sablage ou métallisation +200 à 400 € ; **thermolaquage d'un escalier complet : 2 000 à 5 500 €** (≈ 2 000 € pour un droit de 2,50 m sans rampe, préparation comprise) | sept. 2026 | USAGE | [27] | moyen |
| Galvanisation à chaud | ~0,60 €/kg (construction légère) ; 0,25–0,6 €/kg (profilés) | 2025 | USAGE | [28] | **faible** (source primaire payante, chiffre vu en extrait) |
| Galvanisation, majorations | +50 % (saillie > 300 mm), +100 à +200 % (encombrant), +50 / +100 % (double trempe) ; 52 €/h mini | consulté 2026-09 | USAGE | [65] | moyen |
| Découpe laser | 50–150 €/m² (1–3 mm) ; 150–300 (4–7 mm) ; 300–500 (≥ 8 mm) | févr. 2025 | USAGE | [29] | **faible** (on ne sait pas si la matière est incluse) |
| Menuisier, taux horaire | 40–70 € TTC | févr. 2026 | USAGE | [69] | faible à moyen |
| Chêne plateaux | 1 500–2 160 €/m³ | déc. 2025 | USAGE | [68] | moyen |
| Pose d'un escalier métal (artisan) | 800–1 500 € | 2026 | USAGE | [30][31] | faible |

### 5.2 Prix de marché d'un escalier complet

| Type | Métal (fourni-posé sauf mention) | Bois | Réf. | Confiance |
|---|---|---|---|---|
| Droit | à partir de 3 945 € HT, pose incluse [30] (borne haute de 6 500 € ⚠️ non retrouvée sur [30]) ; « à partir de 3 500 € » HT [31] ; exemple : limon central, 13 marches pin brut, acier brut, garde-corps, 2,70 m : **3 320 € TTC sans livraison** | — | [30][31][32] | moyen (prix affichés) |
| Quart tournant | à partir de 4 333 € HT [30] (borne haute de 8 000 € ⚠️ non retrouvée) ; 4 500–11 000 € [31] ; exemple : limon central, 13 marches hêtre, thermolaqué : **4 385 € TTC** | — | [30][31][32] | moyen |
| Deux quarts tournants | à partir de 4 983 € HT [30] (borne haute de 10 000 € ⚠️ non retrouvée) ; 6 000–13 000 € [31] | — | [30][31] | faible à moyen |
| Hélicoïdal | 6 000–15 000 € | hélicoïdal chêne > 8 000 € ; gamme générale 1 500–15 000 € | [31][70] | faible |
| Limon débillardé | **à partir de 8 000 €** ; le débillardé est « le plus coûteux car très chronophage en atelier » | idem | [31][70] | faible |
| Suspendu, porte-à-faux | 10 000–25 000 € | — | [31] | faible |
| Gamme générale | 3 500–40 000 € et plus | 1 200–7 000 € ; 1 200–18 000 € | [31][70] | faible |
| Options | chêne au lieu d'hévéa : +800 à 1 500 € ; thermolaquage : +300 à 600 € ; verre au lieu de barreaux : +1 000 à 3 000 € ; hauteur ≥ 3,50 m : +20 à 30 % | — | [30] | moyen |

> **Incertitude** : ces fourchettes viennent de fabricants en ligne ou de comparateurs. Elles mélangent HT et TTC, pose incluse ou non, et incluent parfois le garde-corps. Écart typique **×2 à ×3** entre bas et haut de fourchette. Aucune ne sépare matière, main-d'œuvre et sous-traitance. Il faut les prendre comme des **bornes de vraisemblance** pour calibrer un modèle, **pas comme des coûts de revient**.

### 5.3 Modèle de coût proposé pour Blondel (à calibrer)

Coût de revient = Σ matière + Σ temps × taux + Σ sous-traitance + finitions + pose + marge.

| Poste | Variable pilotée par la géométrie | Profilé UPN/IPN | Plat laser | Débillardé soudé | Bois massif | Lamellé-collé |
|---|---|---|---|---|---|---|
| Matière | masse (kg) ou volume brut (m³), taux de chute | faible (barres standard, peu de chutes) | moyen (chutes d'imbrication faibles si droit) | moyen à fort (bandes courbes) | **fort** (bloc brut / fini élevé en courbe) | moyen (lames minces, colle) |
| Débit / découpe | nombre de coupes, périmètre découpé | coupes droites et onglets | **laser** (périmètre × épaisseur) | laser + **roulage** | sciage + toupie + gabarits | débit des lames + moule |
| Formage | nombre de pièces formées, rayons | cintrage éventuel (sous-traité) | pliage des supports | **roulage de chaque quartier + griffes** | — | **moule par rayon** |
| Assemblage | nombre de soudures, longueur de cordon, nombre de joints | cornières (2 par marche) | supports soudés | **soudures bout à bout + reprise** (EXC2) | tenons, boulons, entailles | collage + serrage |
| Finition | surface (m²), masse (kg) | galva ou laquage | idem | idem + **meulage-ponçage** | ponçage, vernis | idem |
| Pièces uniques | nombre de gabarits et références distinctes | ≈ 0 | faible | **élevé** (un gabarit par quartier) | **élevé** | élevé (un moule par rayon) |

**Ordres de grandeur matière et sous-traitance [CALCUL, confiance faible]** pour un escalier **droit** de 2,70 m, 14 girons de 250 mm, emmarchement 900 mm, 2 limons de 4,8 m :

| Solution limon | Masse limons | Matière (1,2–1,8 €/kg) | Matière (détail, ~4 €/kg) | Laquage (15–30 €/m²) |
|---|---|---|---|---|
| 2 × UPN 160 | 2 × 4,8 × 18,85 ≈ **181 kg** | ≈ 220–330 € | ≈ 720–870 € (4,0–4,8 €/kg, corrigé) | surface à peindre **0,546 m²/m** [74] (corrigé, au lieu de ≈ 0,58), soit ≈ 5,2 m² → ≈ 80–160 € |
| 2 × plats 300 × 10 découpés | 2 × 0,3 × 4,8 × 0,01 × 7 850 ≈ **226 kg** | ≈ 270–410 € | — | ≈ 2 × 2 × 1,44 m² + chants ≈ 6 m² → ≈ 90–180 € |
| Découpe laser des plats (≥ 8 mm) | 2 × 1,44 m² | — | — | 300–500 €/m² → ≈ 860–1 440 € **(faible)** |

> *Vérification des calculs* (script du vérificateur) : 2 × 4,8 × 18,85 = 180,96 kg ; 2 × 0,3 × 4,8 × 0,01 × 7 850 = 226,1 kg ; 181 × 1,2–1,8 = 217–326 € ; 226 × 1,2–1,8 = 271–407 € ; faces des plats 2 × 2 × 1,44 = 5,76 m² + chants ≈ 0,2 m² ≈ 6 m² ; laser 2,88 m² × 300–500 = 864–1 440 €. Tout est cohérent, sauf les deux valeurs corrigées dans le tableau (€/kg au détail et surface de l'UPN). Deux réserves : le détaillant [25] ne vend l'UPN 160 qu'en 1 à 2 m, donc la colonne « détail » ne vaut pas pour un limon d'un seul tenant de 4,8 m ; et le tarif laser au m² de [29] n'inclut probablement pas la matière. **Écart à signaler** : le laquage des seuls limons (≈ 80–180 € au tarif au m²) est très inférieur au prix constaté pour le thermolaquage d'un escalier complet (2 000 à 5 500 € [27]) et à l'option « thermolaqué » à +300–600 € [30]. Minimums de facturation, manutention, préparation et pièces annexes dominent sans doute, ce qui reste à calibrer.

Non inclus : supports de marche, marches, garde-corps, heures d'atelier (au taux de 45–70 €/h [26]), pose, minimums de facturation des sous-traitants. Même avec ces approximations, on retrouve le constat de [26] : **la matière des limons est un petit poste (quelques centaines d'euros) comparée aux prix de marché de 3 500 à 15 000 €**. La différence vient du **temps d'atelier** et des **opérations uniques**.

**Quels postes pèsent le plus**
- Profilé du commerce : la main-d'œuvre de pose des supports (2 par marche) et la finition. **Solution la moins chère**, limitée esthétiquement et géométriquement (rayons de cintrage [15]).
- Plat laser : la sous-traitance laser et le pliage des supports. La main-d'œuvre reste modérée si le plan est bien calepiné.
- Débillardé soudé : **les heures** (développés, roulage par quartier, pointage sur gabarit, soudure bout à bout, reprise des déformations, meulage-ponçage [20][22]) et le **passage en EXC2** [13]. C'est la solution la plus chère des métaux (« à partir de 8 000 € » [31]).
- Bois massif débillardé : **les heures d'épure et de gabarits**, puis la **perte matière** en chêne à 1 500–2 160 €/m³ [68].
- Lamellé-collé : le **moule** (un par rayon) et le temps de collage. Il est amorti si plusieurs pièces partagent le même rayon (cas des 5 étages de [7]).

### 5.4 Comment Blondel peut réduire les coûts

1. **Standardiser les sections** : proposer par défaut des profilés du catalogue (UPN, IPE, tubes) et des épaisseurs de tôle courantes. Afficher le surcoût d'une section « hors stock ».
2. **Limiter les pièces uniques** :
   - balancer les marches pour **répéter le même giron de collet et le même rayon** (un seul moule ou un seul rayon de roulage) ;
   - choisir des **tronçons à rayon constant** plutôt qu'une courbure variable ;
   - rendre **identiques les supports de marche** (même pli, même angle) sur les parties droites.
3. **Calepiner les tôles** (nesting) à partir des développés, avec le **taux de chute** et le format de tôle paramétrable ; regrouper par épaisseur.
4. **Contrôler la fabricabilité en amont** : rayons de pliage, bords minimaux, longueur de presse, rayons de cintrage et de roulage (tables §§ 2.3, 2.4 et 2.6), longueurs de barres (aboutage), présence d'évents si galva.
5. **Afficher la classe d'exécution** (EXC1 / EXC2) et l'**impact des choix** (soudure bout à bout, S355) [13].
6. **Nomenclature et temps** : exporter la nomenclature (masse, surface à laquer, longueur de cordon, nombre de coupes et de plis, nombre de gabarits). Le temps d'atelier est **l'entrée la plus incertaine** : Blondel doit l'exposer comme **paramètres calibrables par l'atelier** (min par coupe, par pli, par mètre de cordon, par gabarit), sans valeurs par défaut non sourcées.

---

## 6. Points incertains et questions ouvertes

1. **NF P01-012:2024, règles propres aux escaliers** (hauteur rampante, définition de la zone d'activité dans un escalier, vide sous la lisse basse, câbles) : non lues. Les sources secondaires se contredisent (14,5 cm contre 11/18 cm pour les câbles). Le 14,5 cm ne figure dans aucune des deux sources qui reprennent le texte ([34], [73]). **Priorité haute.** Le gabarit B et la zone 0–0,60 m sont désormais documentés via [73], mais seulement par une source fabricant : **à confirmer sur le texte**, ainsi que la formule des dénivelés et les renvois (b) du tableau h(E).
2. **NF DTU 36.3 P3** : épaisseurs minimales de marche, flèches RC 5-2 et 5-3, section résiduelle sous entaille (valeur 100/80 mm vue seulement en extrait non attribué). Il faut acheter le DTU (CSTB) ou le **calepin de chantier FCBA**.
3. **Eurocode 5, poutres courbes** : *résolu par le vérificateur*, k_r = 0,76 + 0,001·r_in/t sous 240 [71]. Il reste à savoir si l'EC5 s'applique à des limons en plis minces (contreplaqué et placage), hors NF EN 14080 ⚠️.
4. **Capacités machines** (cintrage, roulage, pliage, laser, formats de tôle) : très **dépendantes de l'atelier**. Il faut les gérer comme une **table de capacités par atelier ou sous-traitant**, pas comme des constantes.
5. **Galvanisation** : prix au kg peu sourcé (la source primaire n'était pas accessible).
6. **Découpe laser au m²** : on ne sait pas si la matière est incluse ; le chiffre est probablement surévalué pour un limon.
7. **Heures d'atelier par solution** : **aucune donnée publique fiable trouvée**. À recueillir auprès d'ateliers partenaires (menuisier, métallier).
8. **Joints du débillardé** (position optimale, tolérance au raccord, gabarit de soudage) : la pratique est décrite qualitativement [6][20], **pas quantitativement**.
9. **Marches en porte-à-faux et escaliers suspendus** : valeurs de mur et d'épaisseur hétérogènes selon les fabricants. Il faut **exiger une justification** (calcul ou avis technique).
10. **Tôle larmée, caillebotis** : pas de table portée/charge trouvée en accès libre pour la tôle larmée.
11. **Thermolaquage** : écart d'un ordre de grandeur entre le tarif au m² appliqué aux limons et le prix constaté pour un escalier complet ([27] contre [30]). À calibrer avec un laqueur.

---

## Sources

Toutes consultées le **2026-09-28**, sauf [77] à [80] (consultées le **2026-10-09**) ; [8] et [71] relues le 2026-10-09 pour le § 1.11.

1. S. Graissaguel, « Norme DTU 36.3 Travaux de bâtiment — Escaliers en bois et garde-corps associés », *FCBA INFO*, FCBA, octobre 2015. https://www.fcba.fr/wp-content/uploads/2021/01/fcbainfo_2015_28_norme_dtu_36_3_travaux_de_batiment_escaliers_en_bois_et_garde_corps_associes_stephane_graissaguel.pdf
2. AFEB – Commission professionnelle, *Escaliers en bois — Guide d'application du DTU 36.3*, FIBC / AFEB, janvier 2016. https://www.uiccb.fr/wp-content/uploads/2021/07/AFEB-Guide-DTU-36.3-Janvier-2016.pdf (ancienne URL uicb.pro redirigée)
3. AFNOR, *NF EN 16481 — Escaliers en bois — Conception de la structure — Méthodes de calcul*, 30 août 2014 (exemplaire de travail de la commission BNBA/BF 018, diffusion restreinte). https://extranet.batibois.org/documents/NF-EN-16481--Aout-2014-.pdf
4. FCBA / IRABOIS, fiche P.O.B. 81.04 « Composants de menuiserie — Escaliers bois », Catalogue Bois Construction, janvier 2015. https://catalogue-bois-construction.fr/wp-content/uploads/2017/05/8104-escaliers.pdf
5. Catalogue Bois Construction, fiche « Menuiserie — Escalier en bois : référentiels principaux », mise à jour du 13 juillet 2026. https://catalogue-bois-construction.fr/wp-content/uploads/2024/12/Fiches-Menuiserie-Escalier-en-bois.pdf
6. J. Justin Storck, *Dictionnaire pratique de menuiserie, ébénisterie, charpente*, éd. 1900, entrée « Limon ». http://justinstorck.free.fr/l/limon.php
7. Atelier Bois, « Construire un limon débillardé en lamellé-collé ». https://atelierbois.net/construire-un-limon-dbillard-en-lamell-coll/
8. Atelier Bois, « Fabriquer un limon ou une rampe d'escalier débillardé ». https://atelierbois.net/fabriquer-limon-rampe-escalier-debillarde/
9. Glulam Handbook (FR), « Volume 2 — 7. Poutres à inertie variable, courbes et bananes ». https://handbook.glulam.org/volume-2-7-poutres-a-inertie-variable-courbes-et-bananes/
10. Swedish Wood, *The Glulam Handbook — Volume 1*, édition 1:2024. https://www.swedishwood.com/siteassets/5-publikationer/pdfer/glulamhandbook1-240508.pdf
11. L'Air du Bois, « Escalier bois 2 quarts tournants : questions sur assemblage limons-poteau » (question 7122). https://www.lairdubois.fr/questions/7122-escalier-bois-2-quarts-tournants-questions-sur-assemblage-limons-poteau.html
12. Escaliers-bois.fr, « L'escalier débillardé en bois : authenticité et savoir-faire », 5 février 2026, mis à jour le 19 août 2026. https://www.escaliers-bois.fr/lescalier-debillarde-en-bois-le-retour-de-lauthenticite
13. BNCM / CNC2M, *N0169 — Recommandations pour la détermination des classes d'exécution selon la NF EN 1090-2*, janvier 2015 (diffusé par l'Union des Métalliers). https://www.metal-pro.org/files/union-des-metalliers/espace-public/publications/guides/recommandations_classes_dexecution-janvier2015v2.pdf
14. ISO, *ISO/FDIS 13920:2023 — Soudage — Tolérances générales relatives aux constructions soudées* (extrait iTeh). https://cdn.standards.iteh.ai/samples/86032/0b66574d261a42c2aca19c7c78ecea47/ISO-FDIS-13920.pdf ; notice AFNOR NF EN ISO 13920 : https://norminfo.afnor.org/norme/nf-en-iso-13920/soudage-tolerances-generales-relatives-aux-constructions-soudees-dimensions-des-longueurs-et-angles-formes-et-positions/201947
15. Cosne Cintrage, « Nos capacités ». https://cosne-cintrage.com/capacites-de-cintrage
16. Didelon, « Capacités de roulage » (fiche PDF). https://www.didelon.fr/files/capacites-de-roulage-1711700054.pdf
17. H7G6, « Tôles pliées : rayon et longueur de bord ». https://www.h7g6.fr/data/article/18/toles-pliees-rayon-longueur-bord
18. 247TailorSteel, « Les directives pour pliage ». https://247tailorsteel.com/fr/a-propos-de-nous/centre-de-connaissances/blog/les-directives-pour-pliage
19. SSAB, pages produit « SSAB S355J2+N Zero » (rayon garanti 1,5 × t jusqu'à 30 mm) et « SSAB Domex 355ML » (1,0 × t en travers, 1,5 × t en long, jusqu'à 20 mm). https://www.ssab.com/en/brands-and-products/ssab-zero/s355j2-plus-n-zero ; https://www.ssab.com/en/brands-and-products/ssab-domex/product-offer/355ml (la page générale https://www.ssab.com/en/support/how-to-process/how-to-bend/how-to-press-brake/how-to-set-up-the-work-piece/recommendations ne rend pas ses tableaux)
20. Métallerie Nessel (lycée, section métallerie), « Escalier à limon central débillardé avec garde-corps et petite verrière », octobre 2018. https://metallerienessel.over-blog.com/2018/10/probablement-l-une-des-plus-belles-realisation-dans-nos-ateliers-un-superbe-ensemble-escalier-a-limon-central-debillarde-avec-garde
21. Galerie Création, « Techniques pour la fabrication d'un limon débillardé en acier ». https://technique.galerie-creation.com/_s/technique-limon-debillarde-acier/1108455/
22. Soudeurs.com, « Comment réduire les déformations lors du soudage ? ». https://www.soudeurs.com/site/comment-reduire-les-deformations-lors-du-soudage-252/
23. Metallo Détail, « Escalier métallique : quelle forme et quel limon choisir ? », mis à jour le 13 août 2026. https://metallo-detail.fr/blog/actus/escalier-metallique-guide-formes-limons
24. Dimension-D, « Liste des profilés UPN » (valeurs lues dans les extraits de recherche). https://www.dimension-d.com/listes/profiles/upn
25. Le Roi du Fer, « Poutre UPN acier S235 — 80 à 160 mm ». https://www.leroidufer.fr/64-poutre-upn
26. Le Savoir Fer, « Devis métallerie : comprendre les tarifs et bien négocier », 22 janvier 2026. https://metallier-lesavoirfer.fr/artisanat-metallier/devis-metallerie-comprendre-tarifs/
27. HelloPro Conseils, « Prix du thermolaquage au m² en 2026 », septembre 2026. https://conseils.hellopro.fr/quel-est-le-tarif-de-thermolaquage-au-m-4139.html
28. Extraits de recherche sur le prix de la galvanisation (sources citées : Jactio, « Galvanisation — processus et coûts », https://jactio.com/fr/verzinken-verfahren-und-kosten/ (HTTP 402, non lue) ; TopGalva, https://topgalva.fr/tarif-galvanisation-chaud/ (aucun prix affiché)).
29. Le Tandem, « Quel est le prix pour une tôle découpée au laser ? », 5 février 2025. https://www.letandem.fr/tole-decoupe-laser-prix/
30. Klatem, « Prix escalier métallique sur mesure », 22 mars 2026. https://www.klatem.fr/blog/prix-escalier-sur-mesure
31. Welding Design, « Prix d'un escalier sur mesure en 2026 », 31 août 2026. https://www.welding-design.fr/prix-escalier-sur-mesure/
32. Mon Escalier Métal, « Nos tarifs ». https://www.mon-escalier-metal.com/nos-tarifs.html
33. (non utilisée)
34. Apave (N. Marchal ; P. Martin, président de la commission AFNOR P01A), *Révision de la norme NF P 01-012 — Fonction garde-corps dans les bâtiments*, webinaire du 7 novembre 2024 (diffusé par la CAPEB). https://www.capeb.fr/www/capeb/media/somme/document/apave-presentation-webinaire-garde-corps-7-novembre-2024.pptx.pdf
35. BNIB, « Publication des normes garde-corps révisées », 18 décembre 2024. https://www.bnib.fr/2024/12/18/publication-normes-garde-corps-revisees/
36. Anoxa, « Norme NF P01-012 garde-corps : exigences, révision et conformité ». https://www.anoxa.fr/tout-savoir-sur-la-norme-nf-p01-012-pour-les-garde-corps/
37. Inox Direct, « Normes garde-corps NF P01-012 : hauteur, remplissage, résistance ». https://www.inoxdirect.fr/documentation/normes/normes-garde-corps-2024.html
38. Erminox, « Garde-corps câble inox : guide pose, tension et espacement ». https://www.erminox-france.fr/blog/garde-corps-cable-inox
39. Légifrance, arrêté du 20 avril 2017 relatif à l'accessibilité aux personnes handicapées des ERP lors de leur construction, article 7-1 (escaliers). https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000034485474
40. VIT / STOP-CHOC, *Garde-corps vitrés — Vérifications selon le DTU 39.5*, septembre 2025. https://www.vit.fr/wp-content/uploads/2025/09/STOP-CHOC_Exigences-garde-corps-vitres-selon-DTU-39-P5.pdf
41. ICAB, « EN1991-1-1 charges d'exploitation » (tableau 6.12 de l'AN française rapporté ; remplacé comme source principale par [72]). https://www.icab.eu/guide/eurocode/en1991/en1991-1-1.htm
42. Semak, « Escalier limon central acier bois » (via extraits de recherche). https://www.semaksarl.fr/escaliers/escalier-limon-central-acier-bois/
43. Metal en Kit, « Supports de marche tôle pliée » (via extraits de recherche). https://metalenkit.com/supports-de-marches/56-support-de-marche-tole-pliee-modern-metal.html
44. Fenau, « Marches d'escalier en caillebotis ». https://www.fenau.fr/informations-sur/marches-d-escalier-standard.html
45. Le Métal / Metallo Détail, tôle larmée (épaisseurs commerciales, via extraits de recherche). https://metallo-detail.fr/blog/actus/tole-larmee-acier-epaisseur-format
46. HelloPro et négociants (poutrelles HEB, HEA, UPE, IPE, UPN : longueurs 6, 12, 14 et 15 m, via extraits de recherche). https://www.hellopro.fr/poutrelle-acier-heb-hea-hem-upe-ipe-upn-ipn-vente-par-lot-de-2-5-tonnes-minimum-2002865-5763822-produit.html
47. Fabricants d'escaliers en porte-à-faux (Siller, Marretti, Mobirolo ; via extraits de recherche). https://www.escalier-siller.fr/escaliers-en-porte-a-faux/
48. Escaliers-bois.fr, « Escalier suspendu : ce qui porte réellement les marches », septembre 2026. https://www.escaliers-bois.fr/escalier-suspendu
49. (non utilisée)
50. EHI — Escalier Hélicoïdal Industriel, « Escalier hélicoïdal avec limon ». https://www.escalier-ehi.fr/escalier-helicoidal-avec-limon/
51. Ysofer, « YSO-Industrie, escalier métallique hélicoïdal ». https://www.ysofer.fr/escaliers/yso-industrie.html
52. Univ-Escaliers, « Concevoir un limon bois solide » (via extraits de recherche). https://www.univ-escaliers.fr/comment-concevoir-un-limon-en-bois-solide-et-esthetique/
53. Fabricants de limons et marches bois (Deck-linea, Otiva, CCTB Wallonie 57.11.4a ; via extraits de recherche). https://batiments.wallonie.be/files/live/sites/SMD_CCT/files/unzip/html_CCTB_01.05/Content/57-11-4a-Escaliers-en-bois.html
54. Forum Copain des copeaux, « Quelle fixation de marche sur un escalier à limon central ? ». https://forum.copaindescopeaux.fr/viewtopic.php?t=17171
55. Motedis, « Boulon d'escalier M10 × 250 avec écrou à cliquet, inox ». https://www.motedis.fr/fr/Boulon-descalier-M10x250-avec-ecrou-a-cliquet-en-acier-inoxydable
56. Treppenmeister, « Escalier suspendu — système ». https://www.treppenmeister.com/fr/escalier-suspendu-systeme/
57. SFCMM, « Tuto SFCMM épisode 18 : différence entre cintrage court et grand rayon ». https://www.sfcmm.fr/tuto-sfcmm-episode-18-difference-entre-cintrage-court-et-grand-rayon-par-antoine-et-damien/
58. Soudeurs.com (forum), « Suivi de projet : un escalier extérieur ». https://www.soudeurs.com/les-novices-les-neophytes-et-les-bricoleurs-soudeurs/18889-suivi-de-projet-un-escalier-exterieur.html
59. Jouanin-Marchand, « Cintrage et roulage ». https://jouanin-marchand.com/content/34-cintrage-et-roulage
60. AMSD Métallier (Isère) et Art Métal Concept (via extraits de recherche). https://metallier-soudeur.fr/escalier-metallique-sur-mesure-droit-helicoidale/
61. Soudeurs.com, « Comment prévenir et contrôler les déformations du soudage ? » ; Rocd@cier, « Effets thermiques du soudage ». https://www.soudeurs.com/site/comment-prevenir-et-controler-les-deformations-du-soudage-1012/ ; https://www.rocdacier.com/effets-thermiques-soudage-deformations/
62. Calade Design, « Escalier tôle acier pliée », © 2022. https://www.caladedesign.fr/escalier-tole-acier-pliee/
63. Organisation-industrielle.fr, « Plier une tôle : méthodes » (via extraits de recherche). https://www.organisation-industrielle.fr/plier-une-tole-methodes/
64. FFB / CAPEB, fiches NF EN 1090-2 (exigences EXC2 : ISO 3834-3, qualification ; via extraits de recherche). https://www.ffbatiment.fr/techniques-batiment/gros-oeuvre-structure/construction-charpente-metallique/dossier-bam/comment-la-mettre-en-uvre
65. ZINQ, « Prix de la galvanisation à chaud ». https://www.zinq.com/fr/connaissances/prix-galvanisation-a-chaud/
66. Synthèse de recherche sur la NF P01-012:2024 pour les escaliers (sources : Menuiseries Françaises, GIMM ; non recoupée). https://menuiseries-francaises.fr/actualites/nf-p01-012-balustrades-garde-corps-escalier/
67. Inoxkit / Metalenstock, raccords de main courante bois Ø 42 mm (via extraits de recherche). https://inoxkit.fr/59-kit-raccord-double-pour-bois.html
68. Boud'bOis, « Prix du chêne au m³ : guide complet », 7 décembre 2025. https://www.boudbois.fr/ressources/prix-chene-guide-complet
69. Obat, « Tarif horaire menuisier », 24 décembre 2023, mis à jour le 23 février 2026. https://travaux.obat.fr/guides/tarif-horaire-menuisier/
70. Guides de prix (HelloPro, « Combien coûte un escalier hélicoïdal » ; Tarif-menuisier.fr, « Prix d'un escalier bois sur mesure 2026 » ; via extraits de recherche). https://conseils.hellopro.fr/combien-coute-un-escalier-helicoidal-1228.html ; https://tarif-menuisier.fr/guide/prix-escalier-bois
71. Swedish Wood, *Design of timber structures — Volume 2 : Rules and formulas according to Eurocode 5*, édition 3:2022, § 8.2 « Double tapered, curved and pitched cambered beams », p. 29 (formule k_r de l'EN 1995-1-1) ; tableaux 3.1 (γ_M, p. 7), 3.2 (k_mod, p. 8), 3.3 (bois massif EN 338, p. 10), 3.4 (lamellé-collé EN 14080, p. 12), 10.4 et 10.5 (entraxes et pinces des boulons et des broches, p. 45), § 10.6.1 (vis chargées latéralement, p. 46) et tableau 10.6 (vis chargées axialement, p. 48), relus le 2026-10-09. https://www.swedishwood.com/siteassets/5-publikationer/pdfer/sw-design-of-timber-structures-vol2-2022.pdf
72. AFNOR, *NF P 06-111-2 — Eurocode 1 — Annexe nationale à la NF EN 1991-1-1*, juin 2004, tableaux 6.2(NF) et 6.12(NF) (copie en ligne, également citée par l'axe A). http://fewslinux.free.fr/CSB/Echange/Regt/NF%20P06-111-2%20-%20Eurocodes.%20Bases%20de%20calcul%20des%20structures.%20Partie%202%20%20%20annexe%20nationale%20%E0%20l%20EN%201991-1-1%202002.pdf
73. Horizal (fabricant de garde-corps aluminium), *Évolution de la norme NF P01-012 — 1988 / 2024*, document commercial de septembre 2025 : dates d'application, gabarit B, zones d'application, T1/T2/T3, dénivelés, tolérances, charges. https://www.horizal.com/data/medias/2413/style/default/HORIZAL_NORME_NF.pdf
74. Dlubal Software, « UPN 160, EN 10365:2017, ArcelorMittal (2018), propriétés de section » (surface à peindre A_L = 0,546 m²/m, valeur lue dans l'extrait de recherche). https://www.dlubal.com/fr/proprietes-des-sections/upn-160-en-10365-2017-arcelormittal-2018
75. (non utilisée)
76. AFNOR Norm'Info, notice « NF E85-015 — Éléments d'installations industrielles — Moyens d'accès permanents — Escaliers, échelles à marches et garde-corps » (version de juillet 2019 selon les extraits de recherche). https://norminfo.afnor.org/norme/nf-e85-015/elements-dinstallations-industrielles-moyens-dacces-permanents-escaliers-echelles-a-marches-et-garde-corps/91316
77. RoyMech, « Timber Connections Design (EC5) » (tableaux des entraxes et pinces des boulons et des broches de l'EN 1995-1-1), consulté le 2026-10-09. https://www.roymech.co.uk/Related/Construction/Timber_connections.html
78. Ets Faynot, fiche technique « Tirefond à visser Ø 10 mm, tête hexagonale, pour fixation sur support bois » (DIN 571 classe 4.6, NF E 27-140), consultée le 2026-10-09. https://www.faynot.com/catalogue/pdf/039.pdf
79. Würth France, « Tirefond bois DIN 571 » (gamme de diamètres et de longueurs), consulté le 2026-10-09. https://eshop.wurth.fr/v/tirefond-bois-din-571
80. Simpson Strong-Tie, « Pied de poteau en âme avec platine — PPS » (dimensions, rainure, broches, chevilles), consulté le 2026-10-09. https://www.simpson.fr/fr-FR/produits/pied-de-poteau-en-ame-avec-platine-pps

---

## Journal de vérification

Vérification faite le **2026-09-28** par un agent vérificateur distinct de l'auteur. Méthode : relecture des sources primaires téléchargées (texte des PDF extrait avec `pdftotext`, pages HTML lues en brut), recherches web complémentaires en français et en anglais, et recalcul de toutes les valeurs dérivées par script (Python).

### Confirmé sur la source (valeur, contexte et numéro d'article)

| Affirmation | Source relue | Résultat |
|---|---|---|
| Limon ≥ 29 mm ; règles de moyens pour un étage au plus et un emmarchement ≤ 1,20 m ; tableau 4 des crémaillères (33/179 … 70/139), épaisseurs × 2 pour une crémaillère centrale ; humidités 10/15/20 % ; tolérances de cintrage et de tuilage ; 1ʳᵉ marche +10/−30 ; ±7 mm ; 10 × h^(1/3) | [1] FCBA 2015, texte intégral | conforme |
| Tolérances ±5 mm (marche), ±5/±10 mm (giron), D ≥ 3 / 5 cm (CCT 6.2.6), renvois RC 5-2, 5-3, 5-4, RC 10, annexes A, C, D, ceinture béton | [2] AFEB 2016 | conforme (numéros tels que donnés par l'AFEB) |
| qk,1 = 3 kN/m², Qk,1 = 2 kN, qk,2 = 0,5 kN/m, Mk,2 = 1 kN (§ 4.2) ; L/200 (§ 6.2, repris de l'ETAG 008) ; f₁ ≥ 5 Hz (§ 6.3) ; 14 mm (§ 5.4.2 et 7.3.1) ; 44 mm (§ 5.4) ; définition de L (§ 6.1) | [3] NF EN 16481:2014 (F) | conforme ; **précision ajoutée** sur la marche avec ou sans renfort |
| Famille B = « poutraison, limons, et supports d'escaliers » ; CC1 pour CCO.1 à CCO.3 (tab. 3) ; PC2 en cas de soudure bout à bout, de nuance ≥ S355 ou de formage à chaud (tab. 5) ; EXC1 / EXC2 (tab. 6) ; note (d) sur les escaliers de secours | [13] CNC2M N0169 | conforme |
| Tableaux 1, 2 et 3 (classes A–D, E–H) ; 2ᵉ édition qui remplace l'ISO 13920:1996 | [14] ISO/FDIS 13920 | conforme (texte FDIS, pas la version publiée) |
| Dates : 22/11/2024, 1/6/2025, 1/1/2026 ; tableau h(E) ; T1, T2, T3 ; 0,05 m ; « plinthe 0,60 m » ; câbles et retrait du bois | [34] Apave/CAPEB, recoupé par [73] | conforme |
| Art. 7-1 : 0,80–1,00 m, prolongement d'un giron, continuité, contremarche 0,10 m, nez ≤ une dizaine de mm | [39] Légifrance | conforme ; **compléments ajoutés** (deux mains courantes, fût ≤ 0,40 m, nez contrastés sur 3 cm, garde-corps tenant lieu de main courante) |
| Classement 1B1 / 1B1 + P1A / 1C1 ; M50 600 J, D0,5, D1/10 J + M50/900 J, D0,5/3 J (Cahier CSTB 3034) ; pinces justifiées par configuration | [40] VIT/STOP-CHOC | conforme (version de la NF P01-013 non précisée) |
| AN tableau 6.2(NF) : escaliers cat. A 2,5 kN/m² / 2 kN ; tableau 6.12(NF) : A, B, C1 0,6 ; C2–C4, D 1 ; C5 3 ; E 2 kN/m | [72] NF P 06-111-2 | conforme, confiance relevée à **élevé** |
| Capacités de cintrage (UPN, IPE, cornières, plats, tubes) | [15] Cosne Cintrage | conforme ; **ligne « tube débillardé » ajoutée** |
| 1,3 D (diamètre), 1,1 D, tôle étroite ≤ 1,7 × l'épaisseur nominale, exemples d'équivalence | [16] Didelon | conforme ; **précision diamètre / rayon** ajoutée |
| Rayons et bords minimaux (valeurs classiques et serrées) | [17] H7G6, tableau HTML relu | conforme ; lignes 6, 8 et 10 mm ajoutées |
| 0,63–8 mm, 2 980 × 1 200 mm, 45 kg, ±0,5°, ±0,2 mm, 21 mm, trous ≤ 5 mm | [18] 247TailorSteel | conforme |
| 1,5 t (S355 normalisé) ; 1,0 t / 1,5 t (thermomécanique) | [19] pages produit SSAB | conforme ; URL remplacée |
| Coupe à crochet et plates-bandes, tenon et mortaise croisés, boulon à clavette et à écrou cannelé, clef déconseillée, joints au milieu des courbes rampantes, pièce « à mortaises seulement », queues, patin et jambette, épaisseur de 0,08 à 0,11 m | [6] Storck | conforme ; règle historique d'épaisseur ajoutée |
| Seuil de 60 mm ; contreplaqué 7 mm + placage 2 mm ; moule ; 5 étages | [7] Atelier Bois | conforme |
| r/t < 240 ⇒ réduction ; « en aucun cas inférieur à environ 170 » | [9] Glulam Handbook FR | conforme |
| 33 mm ; lames plus fines sous 7 m de rayon | [10] Swedish Wood Glulam Handbook vol. 1 | conforme |
| 20–35 % / 40–55 % ; 1,20–1,80 €/kg ; inox ; taux horaires | [26] Le Savoir Fer (22/01/2026) | conforme |
| 15–30 €/m², 7–12 €/kg, +200 à 400 € | [27] HelloPro | conforme |
| Majorations +50 / +100 / +200 %, 52 €/h, pesage après galvanisation | [65] ZINQ | conforme (tarifs de principe ; minimum de 100 € cité pour la Belgique) |
| 50–150 / 150–300 / 300–500 €/m² | [29] Le Tandem | conforme (matière probablement non incluse) |
| Prix de marché (à partir de 3 500 €, 4 500–11 000, 6 000–13 000, 6 000–15 000, débillardé à partir de 8 000 €, 10 000–25 000, 3 500–40 000, pose 800–1 500 €) | [31] Welding Design | conforme (HT) |
| 1 500–2 160 €/m³ ; 625–750 €/m³ | [68] Boud'bOis | conforme |
| Rayon court 2–3 × la section, grand rayon à partir de 10 × | [57] SFCMM | conforme |
| Fiche POB : barreaux 11 cm ±3 mm, 18 cm // pente, 5 cm sous la 1ʳᵉ lisse, gabarit 11 × 11 × 25 cm, nez arrondi ≤ 10 mm, glissance < 100 | [4] | conforme |
| Classes GL24h / GL28h / GL32h (EN 14080), γ_M = 1,25, k_mod ; entraxes et pinces des boulons et des broches (EN 1995-1-1 § 8.5.1.1, § 8.6), vis (§ 8.7) | [71], texte extrait du PDF le 2026-10-09 | conforme (§ 1.11, valeurs rapportées, normes non lues) |
| Tire-fond Ø10 : avant-trou 6,5 mm, ancrage ≥ 50 mm ; pied de poteau à âme : âme 4 mm, rainure 6 mm, 2 broches Ø12 ; couches collées > 60 mm sans moule, crans non coupés | [78], [80], [8], relus le 2026-10-09 | conforme (§ 1.11) |

### Corrigé

1. **k_r (lamellé cintré)** : 0,83 / 0,67 / 0,50 **remplacés par 0,93 / 0,86 / 0,83**, soit k_r = 0,76 + 0,001·r_in/t (EN 1995-1-1, reproduit par [71]). Le tableau de [9] est une image non lisible : les anciennes valeurs n'étaient pas sourcées. Règle C-B-08 réécrite, et la limite de 170 requalifiée en limite de fabrication.
2. **Garde-corps 2024, zone de 0,60 m** : ce n'est **pas** une obligation de remplissage plein. C'est la hauteur de recherche d'appuis au gabarit B (appui à 0,10 ≤ X < 0,60 m ⇒ H = 1,00 + X) [73]. Synthèse n° 9, § 3.1, § 3.2 (lisses, câbles) et règle C-G-03 corrigés ; règle C-G-03b ajoutée.
3. **Dénivelés** : il s'agit d'une distance de 1,60 m au nu intérieur, pas d'une hauteur.
4. **T1** : jusqu'à 0,80 m pour les garde-corps, puis T2 ; **T3** : sur 0,60 m.
5. **UPN au détail** : 3,8–4,6 €/kg **devient 4,0–4,8 €/kg** (recalcul à partir des prix au mètre de [25]) ; la ligne correspondante du calcul de coût passe à 720–870 €.
6. **Surface à peindre de l'UPN 160** : ≈ 0,58 **devient 0,546 m²/m** [74], soit 5,2 m² et 80–160 €.
7. **Thermolaquage** : cuisson à 180 °C **devient ≈ 200 °C** (valeur de [27]).
8. **Charges horizontales sur garde-corps** : désormais sourcées sur l'AN primaire [72] (confiance élevée) ; catégorie E ajoutée ; écart avec le fabricant [73] (C1) signalé.
9. **NF EN 16481, 14 mm** : l'effet « résistant en flexion » ne vaut que pour une marche **avec renfort** ; sans renfort, l'assemblage est semi-rigide.
10. **Klatem [30]** : seuls les prix « à partir de » ont été retrouvés ; les bornes hautes (6 500, 8 000, 10 000 €) sont marquées ⚠️.
11. **NF E85-015** : version de juillet 2019 ajoutée.
12. **Cintrage hélicoïdal** : ce n'est plus « aucune capacité chiffrée » ; un tube débillardé Ø 88,9 × 5 à r ≥ 250 mm est annoncé [15].

### Marqué ⚠️ non vérifié

- Section résiduelle sous entaille 100 / 80 mm (aucune source identifiable).
- Câbles < 14,5 cm [37] (absent des sources qui reprennent la norme ; à ne pas implémenter).
- Interdiction des câbles en zone basse (2024).
- Renvois (b) du tableau h(E) ; formule des dénivelés H = max(1,00 ; 1,60 + X − Y) (définition de Y).
- Application de l'EC5 / NF EN 14080 aux limons en plis minces.
- Correspondance entre les énergies d'essai de [40] et la NF P01-013:2024.
- Domaine exact de la NF E85-015.
- Bornes hautes des prix Klatem.

### Cohérence mathématique

Recalculés par script : flèche de l'UPN 160 (5,69 mm, L/843), du plat 300 × 10 (2,34 mm), masses (180,96 kg ; 226,1 kg), coûts matière (217–326 € ; 271–407 €), laquage, laser (864–1 440 €), charge linéique (1,125 kN/m + poids propre ≈ 1,6), exemples lamellés (1,25 / 1,76 / 5,0 / 7,06 mm), k_r. **Écart relevé** : le rampant théorique de l'exemple (14 × 250 mm, 2,70 m) vaut 4,42 m, pas 4,8 m. 4,8 m est conservé comme majorant, et le texte est annoté.

### Non vérifiable (normes payantes ou sources inaccessibles)

NF DTU 36.3 (valeurs RC 5-2, 5-3, 5-4, épaisseurs minimales de marche), NF P01-012:2024 et NF P01-013:2024 (texte intégral, dispositions propres aux rampants), NF EN 1090-2, NF EN 14080, NF DTU 39 P5 (lu seulement via [40]), prix de la galvanisation au kg ([28], source primaire en HTTP 402).
