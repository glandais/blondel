# Axe A — Règles de dimensionnement des escaliers

> Projet **Blondel**, logiciel web de conception paramétrique d'escaliers (bois, métal, mixte).
> Document de recherche, axe A du prompt `docs/prompts/01-recherche.md`. Toutes les sources ont été consultées le 2026-09-28.
> Table machine-lisible associée : [`rules.yaml`](./rules.yaml).

## 0. Conventions de lecture

### 0.1 Nature des exigences

Chaque règle porte l'une des trois étiquettes suivantes. Le logiciel ne doit pas les confondre.

| Étiquette | Signification | Force juridique |
|---|---|---|
| **[RÉG]** exigence réglementaire | Code de la construction et de l'habitation (CCH), arrêtés « accessibilité », règlement de sécurité incendie ERP | Obligatoire dans son champ d'application, quel que soit le contrat. |
| **[NORM]** exigence normative | NF DTU, normes NF / EN / ISO, Eurocodes et leurs annexes nationales | D'application volontaire. Elle devient obligatoire quand le marché la cite, ce qui est l'usage (marchés publics, assurance décennale). Le code des assurances se réfère aux DTU en vigueur [1]. Quand une réglementation est plus exigeante que le DTU, c'est la réglementation qui s'applique [1]. |
| **[MÉTIER]** usage de métier | Règles de l'art non codifiées, guides de fabricants, pratiques d'atelier | Aucune force juridique. Ce sont des recommandations de confort ou de fabrication. |

### 0.2 Niveau de confiance

- **élevé** : valeur lue dans le texte officiel, ou dans un guide professionnel qui cite l'article exact (AFEB/UICB, FCBA, texte de l'arrêté).
- **moyen** : valeur rapportée par au moins une source secondaire sérieuse, sans lecture du texte primaire, ou texte primaire lu à travers un résumé.
- **faible** : source commerciale ou blog isolé, valeur divergente entre sources, ou interprétation.

### 0.3 Accessibilité des textes

- Les **NF DTU 36.3** (P1-1, P1-2, P2, P3), **NF P01-012** (1988 et 2024), **NF P01-013**, **NF EN 1995-1-1/NA**, **NF EN 1993-1-1/NA**, **NF EN ISO 14122-3**, **NF E85-015** et **DIN 18065** sont **payantes** (AFNOR, CSTB, Beuth) et **n'ont pas été lues dans leur texte intégral**. Les valeurs données ici viennent de sources secondaires identifiées : guide d'application AFEB, note UICB, FCBA Info, présentation APAVE du président de la commission AFNOR P01A, extrait gratuit ISO, guides de préventeurs.
- Deux textes ont été lus dans leur version primaire : l'**annexe nationale française NF P06-111-2** (= NF EN 1991-1-1/NA, juin 2004), dont une copie était en ligne [16], et l'**Approved Document K** (Royaume-Uni), qui est public [21]. *(Vérification : l'amendement **NF P06-111-2/A1 de mars 2009**, qui modifie le tableau 6.12 (NF) des garde-corps, n'a pas été lu dans son texte ; voir §3.6 [32][34].)*
- Les **arrêtés** (Légifrance) et le **règlement de sécurité ERP** sont publics. Ils ont été lus sur Légifrance ou sur des reproductions fidèles (accessibilite-batiment.fr, site du ministère ; sitesecurite.com).

### 0.4 Notations

| Symbole | Terme FR | Définition retenue |
|---|---|---|
| `h` | hauteur de marche | Distance verticale entre les dessus de deux marches consécutives. |
| `g` | giron | Distance horizontale entre deux nez de marche consécutifs, mesurée sur la ligne de foulée (ou sur la « ligne de mesure » en accessibilité). |
| `M = 2h + g` | module / pas (loi de Blondel) | — |
| `E` (L1) | emmarchement | Largeur entre les faces internes des limons [1]. |
| L2 | largeur de volée | Largeur entre les faces externes des limons ou des rives [1]. |
| L3 | largeur d'escalier (de passage) | Largeur entre parois, ou entre paroi et main courante / garde-corps si leur saillie dépasse 10 cm [1][4]. |
| `H` | hauteur à monter | Distance de sol fini à sol fini. |
| `n` | nombre de hauteurs de marche | Nombre de contremarches. On a `h = H / n`. |
| `R` | reculement | Projection horizontale de la volée, du nez de la 1re marche au nez d'arrivée. |
| `e` | échappée | Hauteur libre au-dessus de la ligne de pente. |
| — | collet | Extrémité étroite d'une marche balancée ou hélicoïdale, côté jour ou noyau. |

---

## 1. Loi de Blondel, hauteur, giron, emmarchement, reculement, échappée, ligne de foulée, collet (A.1)

### 1.1 Origine de la loi de Blondel

- **[MÉTIER]** François Blondel pose la règle dans son *Cours d'architecture* (1675). La somme de deux hauteurs et d'un giron doit rester constante, égale au pas moyen de l'homme, soit « deux pieds » (24 pouces ≈ 650 mm), d'après les sources secondaires [25][24]. La formulation exacte de 1675 n'a pas été vérifiée dans le fac-similé. Confiance : **moyen**.
- Le « 63 cm » souvent cité comme valeur idéale est un **usage de métier**. Aucun texte normatif consulté ne l'impose. Confiance : **moyen** [24].

### 1.2 Module 2h + g selon le contexte

| Contexte | Plage | Nature | Source | Confiance |
|---|---|---|---|---|
| Escalier bois, logements (MI, logements des BHC) | **580 ≤ 2h+g ≤ 660 mm**, mesuré sur la ligne de foulée | [NORM] NF DTU 36.3 P3 §6.2 | [1][4] | élevé |
| ERP et parties communes des BHC | **600 ≤ 2h+g ≤ 640 mm** selon l'UICB, qui cite le NF DTU 36.3 P3. L'AFEB écrit seulement « minimum 600 mm », qu'elle attribue à « la réglementation ». | [NORM] (d'après l'UICB). **Contradiction** : voir §5. | [4][1] | moyen |
| Zone de confort (tous contextes) | 600 à 640 mm | [MÉTIER] | [24][4] | moyen |
| Escaliers industriels / accès aux machines | **600 ≤ g+2h ≤ 660 mm** | [NORM] NF EN ISO 14122-3, NF E85-015 | [18][19][20] | moyen |
| Royaume-Uni (comparaison) | 550 ≤ 2R+G ≤ 700 mm (« normal relationship ») | [RÉG] ADK Table 1.1 | [21] | élevé |
| Allemagne (comparaison) | Schrittmaßregel 590 à 650 mm | [NORM] DIN 18065 | [22] | moyen |

**Classes de confort du NF DTU 36.3 P3 §6.1** [1], confiance **élevé**. Elles portent sur le rapport `h/g`, équivalent à la tangente de l'angle de pente :

| Classe | Rapport h/g | Angle équivalent (calcul) |
|---|---|---|
| Confortable | h/g < 0,78 | α < 37,9° |
| Courant | 0,78 < h/g < 1 | 37,9° < α < 45° |
| Raide | 1 < h/g < 1,32 | 45° < α < 52,9° |

- Au-delà de h/g = 1,32, l'escalier sort des classes définies. Il relève alors des escaliers « gain de place » (annexe A du DTU) ou n'est pas couvert par le DTU (échelle de meunier).
- La conversion en angles est un calcul (arc tangente), pas une valeur du DTU.

### 1.3 Hauteur de marche h

| Contexte | Valeur | Nature | Source | Confiance |
|---|---|---|---|---|
| Escalier bois, cas général | **h ≤ 210 mm**, hors marche de départ | [NORM] DTU 36.3 P3 §6.4 | [1][3] | élevé |
| Tolérance sur h | **± 5 mm** | [NORM] DTU 36.3 | [1][4] | élevé |
| Tolérance de la 1re marche après pose, par rapport au sol fini | **+10 / −30 mm** | [NORM] DTU 36.3 P1-1 §6.5.1 | [1][2][4] | élevé |
| Escalier intérieur de logement neuf (accessibilité) | **h ≤ 180 mm** | [RÉG] arrêté du 24/12/2015, art. 12 | [8][4] | élevé |
| Parties communes des BHC neufs | **h ≤ 170 mm** | [RÉG] arrêté du 24/12/2015, art. 6.1 | [7][9][4] | élevé |
| ERP neufs | **h ≤ 160 mm** | [RÉG] arrêté du 20/04/2017, art. 7-1 | [5][6] | élevé |
| ERP existants | h ≤ 170 mm (les dimensions initiales peuvent être conservées si les travaux ne visent pas à modifier l'escalier) | [RÉG] arrêté du 08/12/2014, art. 7, point 7.1 | [31][4] | élevé (texte Légifrance vérifié) |
| Escalier hélicoïdal bois | h ≤ 230 mm | [NORM] DTU 36.3 P3 annexe A, **source unique** | [24] | faible |
| Échelle à marches industrielle | h ≤ 250 mm | [NORM] ISO 14122-3 / NF E85-015 | [18][19][20] | moyen |
| Royaume-Uni, escalier privatif | 150 ≤ h ≤ 220 mm, pente ≤ 42° | [RÉG] ADK | [21] | élevé |
| Allemagne, maisons de 1 à 2 logements | 140 ≤ h ≤ 200 mm | [NORM] DIN 18065 | [22] | moyen |
| Confort usuel | 160 à 180 mm | [MÉTIER] | [24] | faible |

**Autres points**

- **[MÉTIER] / circulaire** : toutes les marches d'un même escalier doivent avoir la même hauteur. C'est « fortement recommandé » par la circulaire interministérielle n° 2007-53 [4], et la tolérance du DTU impose de fait la régularité.
- **Règle logicielle** : on calcule `n = arrondi(H / h_cible)` puis `h = H / n`, et on vérifie `|h_i − h| ≤ 5 mm` pour chaque marche.
- **Marche de départ** : le DTU l'exclut de la limite de 210 mm [1]. Le logiciel doit gérer une hauteur de 1re marche distincte, par exemple pour compenser une chape ou un revêtement posé plus tard. Elle reste dans la tolérance +10 / −30 mm [1].

### 1.4 Giron g

| Contexte | Valeur | Nature | Source | Confiance |
|---|---|---|---|---|
| Escalier bois, cas général | **g ≥ 190 mm** | [NORM] DTU 36.3 P3 §6.5 | [1] | élevé |
| Tolérance, marche droite | **± 5 mm** | [NORM] DTU 36.3 P3 | [1][4] | élevé |
| Tolérance, marche balancée | **± 10 mm** | [NORM] DTU 36.3 P3 | [1][4] | élevé |
| Logement neuf (accessibilité) | **g ≥ 240 mm** | [RÉG] arrêté du 24/12/2015, art. 12 | [8][4] | élevé |
| Parties communes des BHC | **g ≥ 280 mm** | [RÉG] arrêté du 24/12/2015, art. 6.1 | [7][9] | élevé |
| ERP neufs | **g ≥ 280 mm** | [RÉG] arrêté du 20/04/2017, art. 7-1 | [5][6] | élevé |
| ERP existants | g ≥ 280 mm (même réserve sur les dimensions initiales) | [RÉG] arrêté du 08/12/2014, art. 7, point 7.1 | [31] | élevé |
| Escalier tournant d'ERP, giron extérieur | **g_ext < 420 mm** | [RÉG] règlement de sécurité ERP, CO 56 §2 | [10] | élevé |
| Échelle à marches industrielle | profondeur de marche ≥ 80 mm | [NORM] ISO 14122-3 | [18][19] | moyen |
| Royaume-Uni, escalier privatif | 220 ≤ g ≤ 300 mm | [RÉG] ADK | [21] | élevé |
| Allemagne, maisons de 1 à 2 logements | 230 ≤ g ≤ 370 mm | [NORM] DIN 18065 | [22] | moyen |
| Confort usuel | 240 à 300 mm | [MÉTIER] | [24] | faible |

**Mesure du giron** [1][4], confiance **élevé** :

- Partie droite : le giron se mesure sur la ligne de foulée (§1.6).
- Partie tournante : le DTU le mesure sur l'arc de cercle centré à l'intersection des faces internes des limons [1]. Pour le logiciel, la ligne de foulée devient un arc dans le tournant, et le giron se mesure comme une longueur d'arc ou une corde sur cet arc.
- En accessibilité, le giron se mesure sur une « ligne de mesure » (question-réponse n° 81 du site ministériel) [4] :
  - emmarchement > 1,20 m : à 60 cm de la rampe, côté intérieur ;
  - emmarchement ≤ 1,20 m : au milieu de l'emmarchement ;
  - « en cas de difficulté », dans les escaliers de logement : entre le milieu et 35 cm du mur extérieur.

  Cette dernière tolérance est une **interprétation ministérielle** (FAQ), pas le texte de l'arrêté. Confiance : **moyen**.

### 1.5 Emmarchement et largeur

| Contexte | Valeur | Nature | Source | Confiance |
|---|---|---|---|---|
| Escalier bois, cas général (maison individuelle) | **emmarchement ≥ 700 mm**. L'AFEB écrit « emmarchement mini : 0,70 m » sans préciser la destination ; la fiche CODIFAB parle de « largeur de passage minimum 0,70 m pour maison individuelle ». Le RC §6.9 donne d'autres minima selon la configuration, **non lus**. | [NORM] DTU 36.3 P3 §6.7 | [1][3] | élevé (valeur) / moyen (champ) |
| Escalier de logement neuf | **largeur ≥ 800 mm**, mesurée à l'aplomb de la main courante si elle empiète de plus de 10 cm | [RÉG] arrêté du 24/12/2015, art. 12 | [8][4] | élevé |
| Parties communes des BHC | **≥ 1,00 m entre mains courantes** | [RÉG] arrêté du 24/12/2015, art. 6.1 | [9][4] | élevé |
| ERP neufs | **≥ 1,20 m entre mains courantes** | [RÉG] arrêté du 20/04/2017, art. 7-1 | [5][6] | élevé |
| ERP existants | ≥ 1,00 m entre mains courantes | [RÉG] arrêté du 08/12/2014, art. 7, point 7.1 | [31][4] | élevé |
| ERP, sécurité incendie | Largeur en unités de passage (UP) : 1 UP = 0,90 m, 2 UP = 1,40 m, puis n × 0,60 m | [RÉG] règlement ERP, CO 36 | [11] | élevé (article CO 36 relu sur Légifrance) |
| Industriel | largeur libre ≥ 600 mm, de préférence 800 mm | [NORM] ISO 14122-3 | [18] | moyen |
| Échelle à marches | 450 ≤ largeur ≤ 800 mm, 600 mm préconisé | [NORM] ISO 14122-3 | [19] | moyen |

Précisions :

- **[RÉG] / circulaire** : dans un escalier encloisonné, les 1,00 m (BHC) ou 1,20 m (ERP) entre mains courantes donnent des largeurs entre parois de 1,20 m ou 1,40 m, avec des mains courantes qui occupent 10 cm chacune [4]. Le logiciel doit donc déduire la saillie des mains courantes. Confiance : **élevé**.
- **Interprétation UICB / DTU** : la « largeur d'escalier » de l'arrêté BHC est une largeur de passage [4]. Elle se mesure entre deux parois, entre une paroi et l'intérieur du garde-corps rampant (poteaux compris), ou entre deux garde-corps.
- **[RÉG] CO 55** : au-delà de 4 UP, l'escalier doit être recoupé par des mains courantes intermédiaires [10]. Confiance : **élevé**.

### 1.6 Ligne de foulée

| Contexte | Position | Nature | Source | Confiance |
|---|---|---|---|---|
| Escalier bois, emmarchement ≤ 1,20 m | **au milieu de l'emmarchement** | [NORM] DTU 36.3 P3 §6.3 | [1][3] | élevé |
| Escalier bois, emmarchement > 1,20 m | **à 0,60 m de la rampe, côté intérieur** (jour ou noyau) | [NORM] DTU 36.3 P3 §6.3 | [1][3] | élevé |
| Escalier hélicoïdal bois | à 0,60 m du fût central | [NORM] DTU 36.3 annexe A (source secondaire) | [24] | faible |
| ERP, escalier tournant | ligne de foulée à **0,60 m du noyau ou du vide central** | [RÉG] CO 56 §2 | [10] | élevé |
| Usage courant pour les balancés | 50 cm de la rampe intérieure | [MÉTIER] | [30] | faible |

Pour un escalier de 70 à 120 cm d'emmarchement, la règle du DTU (milieu) et l'usage (50 cm) donnent des positions différentes. **Le logiciel doit suivre le DTU par défaut, avec une valeur modifiable.**

### 1.7 Échappée et trémie

| Contexte | Valeur | Nature | Source | Confiance |
|---|---|---|---|---|
| Escalier bois de logement | **échappée ≥ 1,90 m** | [NORM] DTU 36.3 P1-1 §6.5.2 | [1][3] | élevé |
| Recommandation, locaux privatifs | 2,10 m | [MÉTIER] / guide | [3] | moyen |
| Recommandation, locaux publics | 2,20 m | [MÉTIER] / guide | [3] | moyen |
| PMR, ERP, Code du travail | « peuvent exiger d'autres valeurs » : **valeur non trouvée** | — | [1] | — |
| Industriel (ISO 14122-3, NF E85-015) | hauteur de tête (verticale) ≥ 2,30 m ; dégagement (perpendiculaire à la ligne de pente) ≥ 1,90 m pour un escalier, ≥ 0,85 m pour une échelle à marches | [NORM] | [17][18][20] | moyen (définitions lues dans l'extrait ISO ; valeurs via CFST) |
| Royaume-Uni | ≥ 2,0 m (1,9 m au centre dans les combles aménagés) | [RÉG] ADK §1.11 | [21] | élevé |
| Allemagne | ≥ 2,00 m | [NORM] DIN 18065 | [22] | moyen |

**Mode de mesure**

- Selon l'AFEB, l'échappée « se mesure sur la ligne de pente depuis la ligne de foulée » [1]. Le texte ne dit pas si la mesure est verticale ou perpendiculaire ; le schéma de l'AFEB (figure 4) n'a pas pu être interprété à partir du texte extrait.
- *(Correction de vérification : la version précédente attribuait à Batirama [27] une mesure « perpendiculairement ». L'article [27] relu dit seulement que « l'échappée ne doit pas être inférieure à 1,90 m », sans mode de mesure.)*
- L'ISO 14122-3 distingue deux grandeurs [17] : la **hauteur de tête**, « distance verticale minimale » au-dessus de la ligne de pente (§3.1.4), et le **dégagement**, « mesuré perpendiculairement à la ligne de pente » (§3.1.16). L'Approved Document K mesure l'échappée à la verticale (diagramme 1.3) [21]. **L'ambiguïté du DTU reste entière** (voir §5).
- Pour une pente α, `e_perp = e_vert · cos α`. À 40°, 1,90 m à la verticale correspondent à 1,46 m en perpendiculaire (cos 40° ≈ 0,766), soit environ 23 % de moins. L'écart est important.
- **Recommandation Blondel** : mesurer à la verticale au-dessus de la ligne de pente, sur la ligne de foulée, ce qui est la convention de la « hauteur de tête » ISO et la convention britannique. Signaler l'hypothèse dans l'interface. C'est un **choix de conception**, pas une exigence vérifiée du DTU.

**Longueur de trémie (dérivation géométrique, pas une valeur normative)**

Pour une volée droite qui arrive au bord de la trémie, avec `ep` l'épaisseur du plancher haut (sol fini à sous-face) et une mesure verticale :

```
L_tremie ≥ (e_min + ep) · g / h       (mesurée depuis le nez d'arrivée, dans le sens de la volée)
```

- Confiance en la formule : **élevé**, c'est de la géométrie.
- Confiance en son application : dépend de la convention de mesure retenue ci-dessus.
- Le logiciel doit plutôt **calculer l'échappée point par point** sur la ligne de foulée, en 3D. C'est la seule méthode valable pour les escaliers tournants.

**Tolérances des trémies et du gros œuvre** (DTU 36.3 P1-1 §5.2), confiance **élevé** [1][2] :

| Élément | Tolérance |
|---|---|
| Écart d'implantation des trémies finies | [0 ; +7 mm] |
| Dimensions linéaires des trémies finies | [0 ; +7 mm] |
| Hauteur à monter, étage ≤ 3 m | ± 7 mm |
| Aplomb, étage ≤ 3 m | ± 7 mm |
| Étage > 3 m | « intervalle de tolérance » `10 · H^(1/3)` mm, avec H en m |

- **Interprétation (vérification)** : à H = 3 m, `10 · 3^(1/3) ≈ 14,4 mm`, ce qui correspond à la **largeur totale** de l'intervalle ± 7 mm (14 mm). La formule donne donc un intervalle total, soit une tolérance de **± 5 · H^(1/3)** mm. Lire « ± 10 · H^(1/3) » créerait un saut de 7 à 14 mm à 3 m. Confiance : **moyen** (déduction de continuité, texte du CCT non lu).

### 1.8 Reculement

- Définition géométrique [MÉTIER] : pour une volée droite de `n` hauteurs dont la dernière arrive au niveau du plancher, `R = (n − 1) · g`. Il faut ajouter le débord du nez de la 1re marche et, le cas échéant, l'épaisseur du limon ou de la marche palière.
- Aucun texte ne fixe de valeur de reculement : c'est une **donnée de sortie**. Confiance : **élevé**.

### 1.9 Marches balancées et giron minimal au collet

**Exigences normatives et réglementaires trouvées**

- **[NORM] DTU 36.3** :
  - le giron minimal de 190 mm se mesure sur la ligne de foulée (§1.4) ;
  - la tolérance sur les marches balancées est de ± 10 mm [1][4].
  - **Aucune valeur minimale de giron au collet n'a été trouvée** dans les sources secondaires du DTU. Le texte intégral du P3, notamment l'annexe A, n'a pas pu être vérifié. Confiance : **à confirmer**.
- **[RÉG] ERP, CO 56** [10], confiance **élevé** :
  - §1 : les escaliers tournants doivent être « à balancement continu sans autre palier que ceux desservant les étages » ;
  - §2 : le giron et la hauteur se mesurent sur la ligne de foulée à 0,60 m du noyau ou du vide central ; **giron extérieur < 0,42 m** ;
  - §3 : pour une seule UP, la main courante est placée côté extérieur.
- **[RÉG] accessibilité** : le giron minimal (240 / 280 mm) s'applique sur la ligne de mesure (§1.4), y compris pour les marches balancées. Au collet, le giron est plus faible.

**Usages de métier trouvés**, confiance **faible** :

- giron au collet d'au moins 100 mm pour les balancés [30] ;
- giron au collet d'au moins 150 mm pour un hélicoïdal [26b] ;
- ces valeurs n'ont pas de base normative identifiée.

**Comparaisons étrangères** utiles pour fixer un seuil d'avertissement :

- **Royaume-Uni (ADK §1.25–1.27, diagramme 1.9)** [21], confiance **élevé** :
  - tapered treads : **au moins 50 mm au bout étroit** ;
  - giron mesuré au centre de la marche si la largeur est inférieure à 1 m, et à **270 mm de chaque rive** si elle est d'au moins 1 m ;
  - girons constants entre marches balancées consécutives ;
  - giron des balancées au moins égal à celui des marches droites.
- **Allemagne (DIN 18065)** [22], confiance **moyen** :
  - giron minimal à la limite intérieure de la largeur utile : **100 mm** en général, **50 mm** dans les maisons de 1 à 2 logements (0 mm pour les escaliers à noyau) ;
  - giron côté étroit décroissant ou constant vers l'angle.

**Proposition pour Blondel**

- **bloquant** : giron sur la ligne de foulée < minimum du contexte ;
- **avertissement** : giron au collet < 100 mm, mesuré à la limite intérieure de l'emmarchement ;
- **conseil** : giron au collet < 150 mm ;
- **avertissement** : giron variable le long de la ligne de foulée au-delà de ± 10 mm ;
- **avertissement** : variation non monotone des girons au collet.

La méthode de balancement elle-même est traitée dans l'axe B.

### 1.10 Hélicoïdal, gain de place, pas japonais, échelle de meunier

**Escalier hélicoïdal**

- Le NF DTU 36.3 P3 annexe A contient des spécifications particulières pour les escaliers « gain de place » et hélicoïdaux [1][3]. **Leur contenu exact n'a pas été vérifié.**
- Valeurs rapportées par des sources secondaires, confiance **faible** : h ≤ 230 mm, ligne de foulée à 0,60 m du fût [24].
- **[RÉG] ERP** :
  - CO 56 s'applique (§1.9) ;
  - l'arrêté du 20/04/2017, art. 7-1, admet **une seule main courante pour les escaliers à fût central de diamètre ≤ 0,40 m** [5][6] (confiance **élevé**). Autrement dit, une main courante de chaque côté reste la règle.

**Pas japonais, pas décalés (alternating tread)**

- Aucun texte français spécifique n'a été trouvé en dehors de l'annexe A du DTU (non lue).
- **Royaume-Uni (ADK §1.29–1.30)** [21], confiance **élevé** :
  - admis seulement dans une conversion de combles, pour desservir une pièce, et s'il n'y a pas la place d'un escalier normal ;
  - hauteur ≤ 220 mm, giron ≥ 220 mm mesuré entre nez alternés ;
  - main courante des deux côtés, antidérapant, échappée ≥ 2 m.
- Des fabricants publient des plages de valeurs, mais aucune n'est rattachée à un texte : elles ne sont **pas retenues** ici.

**Échelle de meunier**

- Elle est **explicitement hors du domaine du NF DTU 36.3**, tout comme les échelles de grenier [1][3]. Les échelles escamotables relèvent de la NF EN 14975+A1 [3]. Confiance : **élevé**.
- Il n'existe **pas de référentiel normatif** pour une échelle de meunier en logement. On peut s'appuyer, par analogie, sur l'« échelle à marches » industrielle, confiance **moyen** [18][19][20] :

| Critère (ISO 14122-3 / NF E85-015) | Valeur |
|---|---|
| Angle | 45° à 75° (escalier : 20° à 45°) |
| Hauteur de marche | ≤ 250 mm |
| Profondeur de marche | ≥ 80 mm |
| Recouvrement | ≥ 10 mm |
| Largeur | 450 à 800 mm |
| Mains courantes | 2 obligatoires |
| Hauteur par volée | ≤ 3 m |
| Échappée | hauteur de tête ≥ 2,30 m ; dégagement perpendiculaire ≥ 0,85 m |

### 1.11 Nez de marche, recouvrement, contremarches

**Recouvrement et débord du nez**

| Contexte | Exigence | Nature | Source | Confiance |
|---|---|---|---|---|
| ERP, marches sans contremarche | recouvrement **0,05 m** entre marches successives | [RÉG] CO 51 §1 | [10] | élevé |
| ERP neufs | débord du nez sur la contremarche **≤ environ 10 mm** (« une dizaine de millimètres ») | [RÉG] art. 7-1 | [5][6] | élevé |
| BHC | débord « non excessif » | [RÉG] | [4] | élevé |
| Logements (MI et BHC), interprétation CRC | ≤ 10 mm si l'arête est vive, ≤ 20 mm si elle est arrondie | [RÉG] interprétation (guide de contrôle CRC) | [4] | moyen |
| Parties communes des BHC, interprétation CRC | ≤ 15 mm | [RÉG] interprétation (guide de contrôle CRC) | [4] | moyen |
| Industriel, sans contremarche | recouvrement ≥ 50 mm | [NORM] NF E85-015 | [20] | faible |
| Industriel, avec contremarche | recouvrement ≥ 10 mm | [NORM] NF E85-015 | [20] | faible |

**Contrastes et bandes d'éveil** (ERP neufs, art. 7-1 ; BHC, art. 6.1) [5][6][9], confiance **élevé** :

- 1re et dernière marches : **contremarche d'au moins 0,10 m**, contrastée visuellement sur au moins 0,10 m de hauteur ;
- nez de marche contrastés sur **au moins 3 cm à l'horizontale**, et non glissants ;
- **bande d'éveil de vigilance à 0,50 m de la 1re marche** en haut de l'escalier. Cette distance peut être réduite à un giron si la configuration l'impose, **en ERP comme en parties communes de BHC** *(correction de vérification : la réduction figure aussi dans le texte BHC [9])* ;
- en ERP, les escaliers extérieurs de trois marches ou plus sur un cheminement doivent respecter l'art. 7-1, sauf pour l'éclairage [26], confiance **moyen**.

### 1.12 Mains courantes (géométrie)

**Nombre et position**

| Contexte | Exigence | Nature | Source | Confiance |
|---|---|---|---|---|
| ERP neufs, BHC parties communes | **une main courante de chaque côté** | [RÉG] | [5][9] | élevé |
| ERP neufs | hauteur **0,80 à 1,00 m**, mesurée depuis le nez de marche | [RÉG] art. 7-1 | [5][6] | élevé |
| BHC parties communes | hauteur **0,80 à 1,00 m** | [RÉG] art. 6.1 | [7][9] | élevé |
| Logement, escalier entre murs | au moins une main courante | [RÉG] art. 12 | [8] | élevé |
| Logement, côté sans paroi | le garde-corps tient lieu de main courante | [RÉG] art. 12 | [8] | élevé |
| ERP, sécurité incendie | 1 UP ou plus : une main courante ; 2 UP ou plus : de chaque côté | [RÉG] CO 51 §2 | [10] | élevé |
| Industriel (NF E85-015) | 900 à 1000 mm depuis le nez de marche | [NORM] | [20] | faible |

**Prolongement horizontal aux extrémités**, confiance **élevé** [4] :

- ERP neufs : **d'un giron** au-delà de la 1re et de la dernière marche ;
- BHC et logements : **d'une marche** ;
- ce prolongement ne doit pas créer d'obstacle ;
- côté vide, c'est le garde-corps qui se prolonge (circulaire).

**Continuité, rigidité, préhension**

- La main courante doit être continue, rigide et facilement préhensible [RÉG]. Côté mur, une discontinuité de moins de 0,10 m est admise [4]. Confiance : **élevé**.
- Interprétation du guide de contrôle CRC [4], confiance **moyen** :
  - une main courante de plus de 7 cm d'épaisseur est non conforme ;
  - une déformation de plus de 5 cm à l'appui manuel entre deux fixations la rend non rigide.

**Prise de main (dégagement main courante / mur)** [NORM] DTU 36.3 [1], confiance **élevé** :

- **D ≥ 30 mm** en logement individuel ;
- **D ≥ 50 mm** dans les autres cas.

### 1.13 Glissance

- Le DTU 36.3 P3 §7.1 traite la glissance [1].
- Pour les marches extérieures, une source secondaire indique une valeur minimale d'« antidérapance » de 110 [27]. Son unité et sa méthode de mesure (NF P 90-106 citée par [3]) sont **non vérifiées**. Confiance : **faible**.
- Hors géométrie : le logiciel peut seulement afficher un rappel de type *conseil*.

---

## 2. Paliers et nombre de marches par volée (A.2)

### 2.1 Nombre de marches par volée

| Contexte | Maximum | Nature | Source | Confiance |
|---|---|---|---|---|
| Escalier bois (DTU) | **25 marches sans palier** | [NORM] DTU 36.3 P3 §6.6 | [1] | élevé |
| ERP, escaliers droits | **25 marches par volée** (hors gradins) | [RÉG] CO 55 §1 | [10] | élevé |
| ERP, escaliers tournants | balancement continu, sans palier intermédiaire : la limite de 25 marches ne s'applique pas telle quelle | [RÉG] CO 56 §1 | [10] | élevé |
| Industriel | 25 marches ou 4 000 mm par volée unique (NF E85-015) ; ISO 14122-3 : hauteur de volée ≤ 3 000 mm, portée à 4 000 mm pour un escalier à volée unique (selon la CFST) | [NORM] | [18][20] | moyen |
| Royaume-Uni, hors logements | 16 hauteurs (utility), 12 hauteurs (general access) | [RÉG] ADK §1.18 | [21] | élevé |
| Royaume-Uni, tous bâtiments | plus de 36 hauteurs consécutives : un changement de direction d'au moins 30° | [RÉG] ADK §1.17 | [21] | élevé |

### 2.2 Dimensions des paliers

- **[RÉG] ERP, CO 55 §2** [10], confiance **élevé** :
  - largeur du palier = largeur de l'escalier ;
  - volées non contrariées (même direction) : **longueur du palier > 1 m** ;
  - « dans la mesure du possible », les volées doivent se contrarier (CO 55 §1).
- **[RÉG] accessibilité** : aucune dimension de palier propre aux escaliers n'a été trouvée.
  - Le prolongement horizontal des mains courantes (1 giron en ERP, 1 marche en BHC) impose une longueur libre minimale au départ et à l'arrivée.
  - La bande d'éveil se place à 0,50 m de la 1re marche en haut.
  - Confiance : **moyen**, par déduction.
- **[NORM] DTU 36.3** : **aucune valeur minimale de palier** n'apparaît dans les sources secondaires consultées. **À vérifier dans le P3.**
- **[NORM] ISO 14122-3** : palier d'au moins 800 mm de longueur quand il est requis, et au moins égal à la largeur de l'escalier [18]. Confiance : **moyen**.
- **Royaume-Uni (ADK §1.20)** : un palier en haut et en bas de chaque volée, de largeur et de longueur **au moins égales à la plus petite largeur de la volée** [21]. Confiance : **élevé**.
- **[MÉTIER]** : longueur du palier intermédiaire au moins égale à l'emmarchement. Pour garder le rythme de marche, on retient souvent une longueur de palier égale à `g + k × (2h+g)`, soit un nombre entier de pas. Confiance : **faible** (usage répandu, non sourcé normativement).

---

## 3. Textes de référence : identification, versions en vigueur, résumé (A.3)

### 3.1 NF DTU 36.3 — Escaliers en bois et garde-corps associés

**Versions**

- P1-1 (CCT), P1-2 (CGM), P2 (CCS) et P3 (règles de conception) ont été **publiés en septembre 2014** [1][3].
- Le P3 a été **confirmé le 30/11/2019**, avec un prochain réexamen systématique prévu en 2029 [23]. **Aucune révision publiée n'a été trouvée** au 2026-09-28. Confiance : **élevé**.

**Documents remplacés** [2] :

- le chapitre VIII de la NF P 21-203-1 (DTU 31.1) ;
- la XP P 21-211 (« Escaliers en bois – spécifications », 2003), annulée en septembre 2014 [1].

**Domaine**

- Escaliers bois intérieurs et extérieurs, tous bâtiments, en neuf ou en réhabilitation, DROM compris [2][3].
- Sont exclus : échelles de meunier, échelles de grenier, escaliers escamotables [1][3].
- Les garde-corps non associés à un escalier relèvent des NF P01-012 et NF P01-013 [3].

**Contenu utile pour Blondel**, localisé grâce au glossaire AFEB [1] :

| Clause | Contenu |
|---|---|
| RC 6.1 | classes de confort |
| RC 6.2 | module 2h+g |
| RC 6.3 | ligne de foulée |
| RC 6.4 | h max 210 mm |
| RC 6.5 | giron |
| RC 6.6 | nombre de marches par volée |
| RC 6.7 | emmarchement |
| RC 6.8 | largeur de volée |
| RC 6.9 | largeur d'escalier |
| RC 5.2 | flèche maximale des limons et crémaillères |
| RC 5.3 | flèche maximale des marches |
| RC 5.4 | profondeur d'entaille |
| RC 10 | jeux d'assemblage |
| RC annexe A | gain de place et hélicoïdaux |
| RC annexe C | escaliers extérieurs |
| RC annexe D | acoustique |
| CCT 6.5.1 | 1re marche |
| CCT 6.5.2 | échappée |
| CCT 6.5.6 | fixation de la main courante |
| CCT 7 | tolérances sur l'ouvrage terminé |

**Justification mécanique** [1][2][3] :

- par « règles de moyens », pour un escalier d'un étage au plus et d'un emmarchement ≤ 1,20 m [2] ;
- par calcul selon l'Eurocode 5 (NF EN 1995-1-1 + AN), selon les règles CB 71 si les DPM le prévoient (hors marchés publics, sismique et incendie) [3], ou par essai.
- **Règles de moyens rapportées par le FCBA** [2], confiance **élevé** :
  - limon d'épaisseur **≥ 29 mm** ;
  - tableau des crémaillères (table 1 ci-dessous).

*Table 1 — Crémaillères selon FCBA [2] (présentées par le FCBA comme un « exemple de résultats de calcul », tableau 4 « Règles de conception de crémaillère » ; le lien exact avec un tableau du P3 n'est pas établi) : escalier droit, hauteur d'étage 2,70 m, pente 38°, crémaillère non fixée au mur. Valeurs pour des crémaillères allant par paire ; pour une crémaillère centrale unique, les épaisseurs sont à multiplier par 2.*

| Bois | Épaisseur (mm) | Distance minimale fond d'entaille → sous-face (mm) |
|---|---|---|
| Résineux C30 | 33 | 179 |
| Résineux C30 | 44 | 163 |
| Résineux C30 | 70 | 141 |
| Feuillus D40 | 35 | 177 |
| Feuillus D40 | 44 | 162 |
| Feuillus D40 | 70 | 139 |

- Les **valeurs de flèche admissible** des RC 5.2 et 5.3 **n'ont pas été trouvées** dans les sources secondaires. Il faut les lire dans le texte intégral.

**Tolérances de déformation** des éléments en bois (CCT) [2], confiance **élevé** :

| Élément | Cintrage (sur la longueur) | Tuilage (sur la largeur l) |
|---|---|---|
| Marches et contremarches | 5 mm/m | 3 mm si l < 350 mm ; 0,7 mm/10 cm si l > 350 mm |
| Poteaux et mains courantes | 5 mm/m | non pertinent |
| Limons et crémaillères | 5 mm/m | 3 mm si l < 350 mm ; 0,7 mm/10 cm si l > 350 mm |
| Balustres | 3 mm/m | 5 mm si l < 350 mm |

- Défaut d'horizontalité des marches et d'aplomb des éléments verticaux : ≤ 1 % [27]. Confiance : **moyen**.

**Humidité du bois selon la destination** [2], confiance **élevé** :

| Classe | Destination | Humidité visée | Tolérance |
|---|---|---|---|
| 1 | local couvert et chauffé | 10 % | −1 / +6 |
| 2 | local couvert non chauffé, ou extérieur abrité | 15 % | ± 3 |
| 3 | exposé aux intempéries | 20 % | ± 5 |

**Normes connexes** [3] :

- NF EN 15644 : escaliers préfabriqués de conception traditionnelle en bois massif ;
- NF EN 16481 : méthode de calcul des escaliers en bois ;
- XP CEN/TS 15680 : essais mécaniques ;
- XP CEN/TS 15676 : glissance ;
- NF P 21-210 et NF EN 14076 : terminologie ;
- EAD 340006-00-0506 (ex-ETAG 008) : marquage CE volontaire des kits.

### 3.2 NF P01-012 — Garde-corps (dimensions)

**Versions en vigueur, avec une période de coexistence** [12][13][3], confiance **élevé** :

| Version | Titre |
|---|---|
| **Juillet 1988** | « Règles de sécurité relatives aux dimensions des garde-corps et rampes d'escalier » |
| **22 novembre 2024** | « Solutions techniques relatives aux éléments de protection visant à limiter le risque de chute accidentelle de hauteur des personnes dans le cadre d'un usage normal des bâtiments » |

**Application de la version 2024** [12][13] :

- travaux soumis à autorisation d'urbanisme : dossier (PC ou DP) déposé **à partir du 1er juin 2025** ;
- travaux non soumis : marché établi **à partir du 1er janvier 2026** ;
- avant ces dates, le marché pouvait viser la version 1988 ou la version 2024.
- Les projets anciens restent donc sous la version 1988 : **le logiciel doit proposer les deux référentiels.**
- Pour les escaliers et garde-corps bois associés, l'UICCB rappelle que le NF DTU 36.3 est la référence prioritaire [13].

**Principe (inchangé)** : un élément de protection est exigé **lorsque la hauteur de chute dépasse 1 m** [12]. Confiance : **élevé**.

**Version 1988**, d'après des sources secondaires uniquement [14][15] :

- Hauteur :
  - **1,00 m** en zone de stationnement normal ;
  - zone de stationnement précaire : hauteur totale supérieure à 1 m, garde-corps seul d'au moins 0,90 m ;
  - **rampe d'escalier : 0,90 m au-dessus du nez des marches**.
- Vides :
  - barreaudage vertical ≤ **110 mm** ;
  - lisses horizontales ≤ **180 mm** au-dessus de la partie basse ;
  - **partie basse de 0 à 0,45 m non escaladable**.
- Confiance : **moyen**. Ces valeurs sont très souvent citées de façon concordante, mais le texte n'a pas été lu. Les règles de vide sous la lisse basse et entre nez de marche et garde-corps n'ont pas été confirmées.

**Version 2024**, d'après l'APAVE, dont l'intervenant est président de la commission AFNOR P01A [12] :

- Hauteur minimale H depuis la « zone d'activité », fonction de l'épaisseur E de l'élément de protection :

  | E (m) | ≤ 0,25 | 0,25–0,30 | 0,30–0,35 | 0,35–0,40 | 0,40–0,45 | 0,45–0,50 | > 0,50 |
  |---|---|---|---|---|---|---|---|
  | h (m) | 1,00 | 0,975 | 0,95 | 0,925 | 0,90 | 0,85 (b) | 0,80 (b) |

  Confiance : **élevé** pour les valeurs lues sur la diapositive. **⚠️ non vérifié** : les deux dernières valeurs portent un renvoi « (b) » dont la condition n'est pas donnée dans la présentation. Le logiciel ne doit pas appliquer 0,85 m ou 0,80 m sans cette condition ; par défaut, plafonner la réduction à 0,90 m.
- Domaine d'application (inchangé) : **constructions neuves et leurs abords** (bâtiment nouveau ou extension) [12].
- H est rehaussée de la hauteur des appuis éventuels (gabarit B) et des dénivelés intérieurs, jusqu'à 1,60 m [12].
- Les notions de zone de stationnement normal / précaire disparaissent au profit de la « zone d'activité » [12].
- Vides contrôlés par gabarits sphériques [12], confiance **élevé** :

  | Gabarit | Diamètre | Domaine |
  |---|---|---|
  | T1 | 0,11 m | cas général, sur toute la hauteur H |
  | T2 | 0,18 m | garde-corps, de 0,80 m à H |
  | T3 | 0,05 m | mailles répétitives |

  Discontinuité maximale de la partie supérieure : 0,05 m.
- « **Plinthe de 0,60 m au lieu de 0,45 m** » [12]. Une source commerciale parle d'un remplissage obligatoire sur 60 cm minimum et de lisses espacées de moins de 11 cm jusqu'à 80 cm [15]. Confiance : **moyen**.
- Résistance mécanique : charges statiques selon l'Eurocode 1 ; charges dynamiques selon la NF P01-013 (version 2024) [12].
- **Durabilité** : les vides ne doivent pas augmenter dans le temps, par exemple par détente des câbles ou retrait du bois [12].
- **Garde-corps rampant d'escalier en 2024** : des sources secondaires indiquent que la hauteur de **0,90 m mesurée à la verticale du nez de marche** est maintenue [15]. Confiance : **faible à moyen**. Ce point n'est pas couvert par la présentation APAVE ; **à vérifier dans le texte 2024**.

### 3.3 NF P01-013 — Garde-corps (essais)

- Elle définit les méthodes et critères d'essais des garde-corps [2][3], notamment les chocs et les charges dynamiques.
- Une **version 2024** accompagne la NF P01-012:2024 [12]. Son contenu chiffré n'a pas été consulté (norme payante). Confiance : **moyen** sur l'existence de la version 2024.
- Pour Blondel, c'est un point **hors calcul géométrique** : la conformité s'obtient par essai ou par une solution déjà justifiée.

### 3.4 Accessibilité (PMR)

| Texte | Champ | Articles utiles | Source |
|---|---|---|---|
| **Arrêté du 24 décembre 2015** | BHC et maisons individuelles neufs ; permis déposés à partir du 1er avril 2016 | art. 6.1 (escaliers des parties communes) ; art. 12 (escaliers des logements) | [7][8][9] |
| **Arrêté du 20 avril 2017** | ERP neufs et IOP ; en vigueur depuis le 1er juillet 2017 | art. 7-1 (escaliers) ; art. 2 (cheminements extérieurs) | [5][6][26] |
| **Arrêté du 8 décembre 2014** | ERP situés dans un cadre bâti existant | art. 7, point 7.1 : h ≤ 170, g ≥ 280, 1,00 m entre mains courantes ; dimensions initiales conservables sans travaux sur l'escalier | [31][4] |
| Circulaire interministérielle n° 2007-53 DGUHC | Interprétations | — | [4] |
| Guide de contrôle CRC du MEEDDM | Interprétations | — | [4] |
| Questions-réponses du site ministériel | Interprétations | — | [4] |

- Les valeurs sont détaillées au §1. Confiance : **élevé** pour les valeurs des arrêtés.
- Les exigences de l'arrêté de 2015 sur les logements (art. 12) ne concernent que les escaliers **à l'intérieur** des logements. Selon le texte, les escaliers adaptés doivent permettre un usage en sécurité, y compris aux personnes malvoyantes, « avec des aides si nécessaire ».
- Les exigences d'éclairage (art. 10 BHC, art. 14 ERP) sont hors géométrie.

### 3.5 Règlement de sécurité incendie ERP (arrêté du 25 juin 1980 modifié)

- **CO 36** : unité de passage [11].
- **CO 51** :
  - recouvrement de 5 cm entre marches sans contremarche ;
  - mains courantes selon les UP [10].
- **CO 55** [10] :
  - « les marches répondent aux règles de l'art » ;
  - au plus 25 marches par volée ;
  - mains courantes intermédiaires au-delà de 4 UP ;
  - rampe de pente ≤ 12 % admise à la place d'un escalier ;
  - paliers : voir §2.2.
- **CO 56** : escaliers tournants (§1.9) [10].
- Confiance : **élevé**.
- Remarque : le règlement renvoie aux « règles de l'art » (CO 55 §1) **sans chiffrer h ni g**. Les valeurs chiffrées viennent de l'arrêté accessibilité et du DTU.

### 3.6 Eurocode 1 — NF EN 1991-1-1 et son annexe nationale (NF P06-111-2, juin 2004)

Texte primaire lu [16]. Confiance : **élevé**.

*Table 2 — Tableau 6.2 (NF) : charges d'exploitation sur les planchers, balcons et escaliers*

| Catégorie | qk (kN/m²) | Qk (kN) |
|---|---|---|
| A — planchers | 1,5 | 2,0 |
| **A — escaliers** (1) | **2,5** | **2,0** |
| A — balcons | 3,5 | 2,0 |
| B | 2,5 | 4,0 |
| C1 | 2,5 | 3,0 |
| C2 | 4,0 | 4,0 |
| C3 | 4,0 | 4,0 |
| C4 | 5,0 | 7,0 |
| C5 | 5,0 | 4,5 |
| D1 | 5,0 | 5,0 |
| D2 | 5,0 | 7,0 |

(1) « Sauf pour des marches indépendantes, qui relèvent d'une approche dynamique. »

- L'AN (clause 2.2(3)) range explicitement « les charges de personnes sur les escaliers à marches légères indépendantes ou semi-indépendantes » parmi les effets dynamiques à définir dans les DPM.
- Si la catégorie n'est pas spécifiée, on prend **D1**.
- Les coefficients αA et αn ne s'appliquent qu'à certaines catégories.

*Table 3 — Tableau 6.12 (NF) : charges horizontales sur les garde-corps (qk en kN/m)*

**Correction de vérification** : le tableau 6.12 (NF) de juin 2004 a été **modifié par l'amendement NF P06-111-2/A1 (mars 2009)**, toujours en vigueur selon la boutique AFNOR [34]. Le texte de l'A1 n'a pas été lu (payant). Le guide *Conception et mise en œuvre des garde-corps* (PACTE / CTB, septembre 2020), qui cite l'A1, donne les valeurs suivantes [32] :

| Catégorie | qk 2004 (lu [16]) | qk selon A1:2009 (via [32]) |
|---|---|---|
| A (habitation) | 0,6 | **0,6** |
| B (bureaux) | 0,6 | **0,6** |
| C1 | 0,6 | **1,0** |
| C2 à C4 | 1,0 | **1,0** |
| D | 1,0 | **1,0** |
| C5 (hors tribunes NF EN 13200-3) | 3,0 | **3,0** |
| E | 2,0 (minimum) | non donnée par [32], **⚠️ non vérifié** |

- Le logiciel doit retenir la **colonne A1:2009**. Confiance : **moyen** (source secondaire de premier rang, texte de l'amendement non lu).
- Selon le même guide [32], la charge horizontale s'applique à **1,0 m au-dessus du sol fini**, quelle que soit la hauteur du garde-corps. Si l'on remplace les essais statiques de la NF P01-013 par un calcul, on applique **0,4 kN** de l'extérieur vers l'intérieur et **0,67 kN** verticalement sur la main courante (valeurs non pondérées). Confiance : **moyen**.

- **Seconde génération des Eurocodes** : selon la FFB [33], les textes européens sont publiés progressivement, les annexes nationales doivent être votées d'ici septembre 2027, et la première génération doit être retirée en **mars 2028**. En France, chaque partie ne s'appliquera qu'avec son annexe nationale. **Le calendrier propre à EN 1991-1-1 et EN 1995-1-1 n'a pas été vérifié.** Le logiciel doit donc pouvoir changer de jeu de valeurs d'Eurocode. Confiance : **moyen** pour le calendrier général.

### 3.7 Eurocode 3 — NF EN 1993-1-1 et son AN (acier)

- Il sert au dimensionnement des limons, crémaillères, marches en tôle et consoles en acier.
- Les limites de flèche sont fixées par projet selon l'EN 1993-1-1 §7.2 et l'EN 1990 A1.4, l'AN française donnant des valeurs indicatives (AN non lue). **Aucune valeur spécifique aux escaliers n'a été trouvée.**
- Pour les marches, on peut prendre pour référence l'**ISO 14122-3 §4.2.2** [17], confiance **élevé** (extrait officiel) :
  - charge de **1,5 kN sur 100 × 100 mm** au nez de marche, au milieu de l'emmarchement ;
  - deux charges de 1,5 kN à 600 mm d'entraxe si w ≥ 1 200 mm ;
  - **flèche ≤ 1/300 de la portée, avec un maximum absolu de 6 mm**.

  Cette norme concerne les machines, pas les bâtiments : c'est une **analogie**.
- Détails renvoyés à l'axe C.

### 3.8 Eurocode 5 — NF EN 1995-1-1 et son AN (bois)

- Méthode de justification reconnue par le NF DTU 36.3 [1][3], ainsi que la NF EN 16481 [3].
- Les limites de flèche de l'AN (tableau 7.2) n'ont pas été lues. Les valeurs ne sont pas reproduites ici faute de source fiable. Les flèches des marches et limons du DTU 36.3 P3 (§5.2 et §5.3) priment pour les escaliers bois.
- Détails renvoyés à l'axe C.

### 3.9 Référentiels complémentaires

- **NF EN ISO 14122-3 (2016)** et **NF E85-015** : escaliers, échelles à marches et garde-corps industriels [17][18][19][20].
  - Utiles pour l'escalier de service technique et comme analogie pour l'échelle de meunier.
  - Les valeurs sont données au §1. Confiance : **moyen** (texte payant ; extrait officiel partiel ; guides).
  - **Version (vérifiée)** : la NF E85-015 en vigueur est celle de **juillet 2019** (AFNOR Norm'Info : « norme publiée », réexamen prévu en 2029). Elle remplace la version d'avril 2008. Selon un fabricant, seule la version 2019 s'applique depuis juillet 2020 [20][35]. Confiance : **élevé** pour la date d'édition.
- **Code du travail (lieux de travail)** : **aucune règle chiffrée sur h, g ou l'échappée** n'a été trouvée dans cette recherche. Le DTU signale que le Code du travail « peut exiger d'autres valeurs » [1]. **Question ouverte.**

---

## 4. Table machine-lisible (A.4)

- Le fichier [`rules.yaml`](./rules.yaml) reprend les règles ci-dessus.
- **Schéma** :
  - `variables` : définitions des symboles utilisés dans les formules ;
  - `contextes` : énumération des contextes d'application ;
  - `regles[]`, avec les champs `id`, `description`, `formule`, `min`, `max`, `recommande`, `unite`, `contexte`, `nature`, `source`, `confiance`, `severite`.
- **Sévérités** :

  | Sévérité | Emploi |
  |---|---|
  | `bloquant` | exigence réglementaire ou normative de sécurité (h, g, 2h+g, échappée, largeurs, garde-corps) |
  | `avertissement` | exigence normative de tolérance, valeur rapportée avec une confiance faible ou moyenne, seuil d'usage de sécurité (collet) |
  | `conseil` | confort, usage de métier |

- **Priorité des contextes** : le logiciel applique **toutes** les règles des contextes actifs. Un escalier bois en ERP neuf cumule `bois_dtu` et `erp_neuf`, et c'est la valeur la plus contraignante qui l'emporte.
- **Réglage utilisateur** : une règle `bloquant` issue d'une source de confiance `faible` doit pouvoir être rétrogradée par l'utilisateur, avec une trace dans le rapport.

---

## 5. Contradictions, incertitudes et questions ouvertes

1. **Borne haute de 2h+g en ERP et dans les parties communes des BHC.**
   - L'UICB (2020) écrit 600–640 mm « NF DTU 36.3 P3 » [4].
   - L'AFEB (2016) écrit 580–660 mm, avec « minimum 600 » exigé « par la réglementation » en ERP et BHC [1].
   - Or les arrêtés de 2015 et 2017 ne contiennent pas de formule de Blondel (seulement h et g).
   - *Hypothèse* : le P3 contient un tableau par destination. **À vérifier dans le texte du DTU.**
2. **Mode de mesure de l'échappée** : vertical ou perpendiculaire à la ligne de pente. Le DTU (via [1]) ne tranche pas ; [27] ne le dit pas (correction de vérification). L'ISO distingue une hauteur de tête verticale et un dégagement perpendiculaire [17]. L'impact est d'environ 23 % à 40° de pente.
3. **Giron minimal au collet** : aucune valeur normative française trouvée. Les usages vont de 100 à 150 mm, contre 50 mm au Royaume-Uni et 50 ou 100 mm en Allemagne.
4. **Annexe A du DTU 36.3 (hélicoïdaux, gain de place)** : contenu non vérifié. La valeur de 230 mm vient d'une source unique [24] ; d'autres sources parlent de 220 mm pour le gain de place.
5. **NF P01-012:2024 pour les rampants d'escalier** : maintien des 0,90 m au nez de marche non confirmé par une source de premier rang. Il faut aussi confirmer le traitement du vide entre le nez de marche ou le limon et le remplissage, et la hauteur de la partie non escaladable dans le rampant.
6. **Paliers** : aucune dimension minimale trouvée dans le DTU (sources secondaires) ni dans les arrêtés accessibilité. Seul le règlement ERP (CO 55) donne un minimum.
7. **Escaliers sans contremarche en logement** : pas de règle de vide entre marches trouvée (le Royaume-Uni applique une sphère de 100 mm). En BHC, le guide CRC ne pose aucune exigence hors 1re et dernière marches [4]. **Question ouverte** pour la sécurité des enfants.
8. **Flèches admissibles** (DTU 36.3 P3 §5.2 et §5.3, AN EC3 et EC5) : à lire dans les textes intégraux avant l'axe C.
9. **Code du travail et escaliers de service** : règles chiffrées non trouvées.
10. ~~**NF E85-015** : version en vigueur contradictoire~~ → **résolu** : édition de juillet 2019 [20][35].
11. **Seconde génération des Eurocodes** : calendrier général connu (retrait de la 1re génération en mars 2028 [33]) ; dates des annexes nationales EN 1991-1-1 et EN 1995-1-1 non vérifiées.
12. **Tableau 6.12 (NF) après l'amendement A1 (2009)** : valeurs connues seulement via le guide PACTE/CTB [32] ; valeur de la catégorie E et conditions « (b) » du tableau des hauteurs NF P01-012:2024 à lire dans les textes.

---

## Sources

*Toutes consultées le 2026-09-28.*

- **[1]** AFEB – Commission professionnelle (FIBC), *Escaliers en bois — Guide d'application du DTU 36.3*, janvier 2016, 20 p. <https://www.uiccb.fr/wp-content/uploads/2021/07/AFEB-Guide-DTU-36.3-Janvier-2016.pdf> *(guide professionnel qui cite les clauses du DTU)*
- **[2]** S. Graissaguel (FCBA), « Norme DTU 36.3 Travaux de bâtiment – Escaliers en bois et garde-corps associés », *FCBA Info*, octobre 2015. <https://www.fcba.fr/wp-content/uploads/2021/01/fcbainfo_2015_28_norme_dtu_36_3_travaux_de_batiment_escaliers_en_bois_et_garde_corps_associes_stephane_graissaguel.pdf>
- **[3]** Catalogue Bois Construction (CODIFAB / FCBA et partenaires), fiche « Escalier en bois — Exigences de performance et règlementations », mise à jour du 13 juillet 2026. <https://catalogue-bois-construction.fr/wp-content/uploads/2024/12/Fiches-Menuiserie-Escalier-en-bois.pdf>
- **[4]** UICB – Groupement escalier, *Accessibilité — Récapitulatif des exigences applicables aux escaliers en bois*, octobre 2020. <https://www.uicb.pro/wp-content/uploads/2021/07/Note-Accessibilite-applicable-aux-escaliers-en-bois-Octobre-2020.pdf>
- **[5]** Légifrance, Arrêté du 20 avril 2017 relatif à l'accessibilité des ERP neufs et IOP, article 7-1. <https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000034485956>
- **[6]** Ministère (site accessibilite-batiment.fr), « ERP neufs — Circulations intérieures verticales — Escalier — Arrêté ». <https://www.accessibilite-batiment.fr/erp-neufs/circulation-interieures-verticales/escalier/arrete.html>
- **[7]** Légifrance, Arrêté du 24 décembre 2015 relatif à l'accessibilité des BHC et maisons individuelles lors de leur construction. <https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000031692481>
- **[8]** Légifrance, Arrêté du 24 décembre 2015, article 12 (escaliers des logements). <https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000031830909>
- **[9]** Ministère (accessibilite-batiment.fr), « Logements neufs — Circulations intérieures verticales des parties communes — Escalier — Arrêté ». <https://www.accessibilite-batiment.fr/bhc-neufs/circulations-interieures-verticales-des-parties-communes/escalier/arrete.html>
- **[10]** Légifrance, Arrêté du 25 juin 1980 (règlement de sécurité ERP), articles CO 49 à CO 56. <https://www.legifrance.gouv.fr/codes/section_lc/JORFTEXT000000290033/LEGISCTA000020304155/> ; reproduction intégrale : SiteSecurite.com, « ERP – Art CO 49 à 56 ». <https://sitesecurite.com/contenu/_erp/erp/co49a56.php?id=top>
- **[11]** Légifrance, Arrêté du 25 juin 1980, article CO 36 (unités de passage). <https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000020304265> ; résumé lu via ssiap.pro, « Unité de passage (UP) ». <https://ssiap.pro/glossaire/up-unite-de-passage/> *(texte primaire non lu en détail ; confiance moyenne)*
- **[12]** APAVE (N. Marchal, P. Martin, président de la commission AFNOR P01A), *Révision de la norme NF P 01-012 – Fonction garde-corps dans les bâtiments*, webinaire du 7 novembre 2024, diffusé par la CAPEB. <https://www.capeb.fr/www/capeb/media/somme/document/apave-presentation-webinaire-garde-corps-7-novembre-2024.pptx.pdf>
- **[13]** UICCB, « Entrée en vigueur de la norme NF P 01-012 et hiérarchie des textes », 07/08/2025. <https://www.uiccb.fr/norme-garde-corps-escalier-bois/>
- **[14]** Sources secondaires sur la NF P01-012:1988 : French Art Concept, « Normes escaliers : rampes et garde-corps » <https://www.french-art-concept.fr/normes-escaliers-rampes-garde-corps.html> ; Wikiarchex (CEACAP), « garde_corps » <https://www.ceacap.org/dokuwiki2020/doku.php?id=garde_corps> *(fabricant et wiki pédagogique d'école d'architecture ; confiance moyenne)*
- **[15]** Sources secondaires sur la NF P01-012:2024 : Anoxa, « Norme NF P01-012 garde-corps » <https://www.anoxa.fr/tout-savoir-sur-la-norme-nf-p01-012-pour-les-garde-corps/> ; Menuiseries Françaises, « NF P01-012 balustrades et garde-corps d'escalier » <https://menuiseries-francaises.fr/actualites/nf-p01-012-balustrades-garde-corps-escalier/> *(fabricants ; confiance faible à moyenne)*
- **[16]** AFNOR, NF P 06-111-2, *Eurocode 1 — Annexe nationale à la NF EN 1991-1-1*, juin 2004 (copie en ligne). <http://fewslinux.free.fr/CSB/Echange/Regt/NF%20P06-111-2%20-%20Eurocodes.%20Bases%20de%20calcul%20des%20structures.%20Partie%202%20%20%20annexe%20nationale%20%E0%20l%20EN%201991-1-1%202002.pdf>
- **[17]** ISO, ISO 14122-3:2016 *Sécurité des machines — Moyens d'accès permanents — Partie 3 : escaliers, échelles à marches et garde-corps*, extrait gratuit (iTeh). <https://cdn.standards.iteh.ai/samples/61282/a82567ebbff3476ab7179a3c91d48ecb/ISO-14122-3-2016.pdf>
- **[18]** CFST (Commission fédérale de coordination pour la sécurité au travail, Suisse), « Moyens d'accès permanents aux machines ». <https://guide.cfst.ch/survol-des-directives/batiments-et-autres-constructions/escaliers-dans-les-batiments-et-les-autres-constructions-ainsi-que-dans-leur-enceinte/moyens-dacces-permanents-aux-machines-_moyens-de-travail_>
- **[19]** Pluceo, « Norme escalier et échelle d'accès aux machines NF EN ISO 14122-3 » <https://www.pluceo.fr/blog/norme-escalier-et-echelle-d-acces-aux-machines-n52> ; L'Échelle Européenne, « Norme NF EN ISO 14122-3 » <https://www.echelle-europeenne.com/actualites/normes/nf-en-iso-14122-3> *(fabricants)*
- **[20]** Anoxa, « Norme NF E 85-015 » <https://www.anoxa.fr/norme-ne-f-85-015/> ; AFNOR Norm'Info, NF E85-015 <https://norminfo.afnor.org/norme/nf-e85-015/elements-dinstallations-industrielles-moyens-dacces-permanents-escaliers-echelles-a-marches-et-garde-corps/91316> *(fabricant ; confiance faible)*
- **[21]** HM Government, *Approved Document K — Protection from falling, collision and impact*, édition 2013 (Angleterre). <https://assets.publishing.service.gov.uk/media/60d5bdcde90e07716f516cfd/Approved_Document_K.pdf>
- **[22]** Sources secondaires sur la DIN 18065 (édition 2020-08) : Trepedia, « Regelungen der Norm – DIN 18065 für Treppenverziehung » <https://trepedia.de/entwerfen/treppenverziehung/regelungen-der-norm> ; Bau mal Schlau, « DIN 18065 Treppe 2026 » <https://bau-mal-schlau.de/din-18065-treppe-2026-steigung-masse-fehler/> ; Baunormenlexikon <https://www.baunormenlexikon.de/norm/din-18065/121acd2d-2c5d-4569-976e-a104eca0e486>
- **[23]** AFNOR Norm'Info, NF DTU 36.3 P3 (statut, confirmation, réexamen). <https://norminfo.afnor.org/norme/nf-dtu-363-p3/travaux-de-batiment-escaliers-en-bois-et-garde-corps-associes-partie-3-regles-de-conception/103830>
- **[24]** Dolum, « Giron escalier : définition, calcul et normes DTU [2026] ». <https://www.dolum.fr/artisanat/calcul-giron-escalier-formule-blondel/> *(blog d'artisan ; confiance faible)*
- **[25]** Architectura (CESR, Université de Tours), notice « Cours d'architecture… » de François Blondel. <https://architectura.univ-tours.fr/en/livres-notice/ensba161a8c490/>
- **[26]** Légifrance, Arrêté du 20 avril 2017, article 2 (cheminements extérieurs). <https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000034485467> *(lu via extrait de recherche ; confiance moyenne)*
- **[26b]** Osaupt, *Guide des dimensions d'escalier*, janvier 2026. <https://osaupt.com/wp-content/uploads/2026/01/Guide-des-dimensions-escalier-Osaupt.pdf> *(commercial ; confiance faible)*
- **[27]** Batirama, « NF DTU 36.3 – Escaliers en bois et garde-corps associés », 04/10/2016. <https://www.batirama.com/article/13569-nf-dtu-36.3-escaliers-en-bois-et-garde-corps-associes.html>
- **[30]** Maizhome, « Calcul escalier quart tournant : la méthode des pros ». <https://maizhome.fr/calcul-escalier-quart-tournant/> *(blog ; aucune source citée ; confiance faible)*
- **[31]** Légifrance, Arrêté du 8 décembre 2014 (ERP situés dans un cadre bâti existant), article 7, point 7.1 « Escaliers ». <https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000034797421> *(ajoutée lors de la vérification)*
- **[32]** PACTE / CTB Composants et Systèmes (FCBA), *Guide Conception et mise en œuvre des garde-corps*, septembre 2020, §5.2 et tableau 1. <https://ctb-composants-systemes.fr/wp-content/uploads/2024/01/gconcmoegarde-corpssept20216web.pdf> *(guide professionnel qui cite la NF P06-111-2/A1 ; ajoutée lors de la vérification)*
- **[33]** FFB, *Bâtimétiers* n° 67, « Eurocodes : une nouvelle génération en préparation », juin 2022. <https://www.ffbatiment.fr/revues-guides/bam/67-juin-2022/eurocodes-une-nouvelle-generation-en-preparation> ; voir aussi Buildwise, « La nouvelle génération d'Eurocodes » <https://www.buildwise.be/fr/nouvelles/nouvelle-generation-eurocodes/> *(ajoutée lors de la vérification ; calendrier lu via extrait de recherche, confiance moyenne)*
- **[34]** AFNOR Éditions, fiche NF P06-111-2/A1 (mars 2009, « norme en vigueur »). <https://www.boutique.afnor.org/en-gb/standard/nf-p061112-a1/eurocode-1-actions-on-structures-part-11-general-actions-densities-self-wei/fa161515/32867> *(ajoutée lors de la vérification)*
- **[35]** L'Échelle Européenne, « Quelles sont les évolutions de la norme NF E85-015 sur les garde-corps ? ». <https://www.echelle-europeenne.com/page/69-quelles-sont-les-evolutions-de-la-norme-nf-e85-015-sur-les-garde-corps> ; AFNOR Norm'Info, NF E85-015 (édition du 19/07/2019, réexamen 2029) [20] *(fabricant + AFNOR ; ajoutée lors de la vérification)*

---

## Journal de vérification

*Vérification sceptique du 2026-09-28. Relecture des sources primaires ou secondaires citées : les PDF ont été téléchargés et leur texte intégral extrait (AFEB [1], FCBA [2], CODIFAB [3], UICB [4], APAVE [12], NF P06-111-2 [16], extrait ISO 14122-3 [17], ADK [21], guide PACTE garde-corps [32]). Les pages Légifrance [5][8][11][31], les pages ministérielles [6][9], le règlement ERP [10], Batirama [27], AFNOR [20][23][34], la CFST [18] et Trepedia [22] ont été relus. Environ 70 affirmations chiffrées ont été contrôlées, en priorité celles qui alimentent des règles `bloquant` ou des formules.*

### Confirmé sans changement (source relue, valeur identique)

- **DTU 36.3 via AFEB [1]** : 580 ≤ 2h+g ≤ 660 sur la ligne de foulée, « minimum 600 » attribué à la réglementation en ERP et BHC ; classes h/g 0,78 / 1 / 1,32 ; h ≤ 210 hors marche de départ ; ± 5 mm ; 1re marche +10 / −30 (CCT 6.5.1) ; g ≥ 190 ; ± 5 mm en droit, ± 10 mm en balancé ; giron mesuré sur l'arc centré à l'intersection des faces internes des limons ; 25 marches sans palier ; emmarchement ≥ 0,70 m ; ligne de foulée au milieu jusqu'à 1,20 m, à 0,60 m de la rampe côté intérieur au-delà ; échappée ≥ 1,90 m dans les logements (CCT 6.5.2) ; prise de main courante D ≥ 3 cm / 5 cm ; tolérances de trémie [0 ; +7] et ± 7 mm ; clauses du glossaire (RC 5.2, 5.3, 6.1 à 6.9, annexes A, C, D).
- **UICB [4]** : 600 ≤ 2H+G ≤ 640 en ERP et parties communes de BHC ; 580–660 en MI et logements de BHC, les deux attribués au « NF DTU 36.3 P3 ». Débords de nez CRC (10 / 20 / 15 mm), main courante de 7 cm maximum, déformation de 5 cm, discontinuité < 0,10 m, prolongements, largeurs, ligne de mesure QR 81.
- **FCBA [2]** : limon ≥ 29 mm ; règles de moyens (un étage au plus, emmarchement ≤ 1,20 m) ; tableau des crémaillères ; humidités ; cintrage et tuilage ; qk 2,5 kN/m² et Qk 2 kN (catégorie A, escaliers).
- **Arrêté du 20/04/2017, art. 7-1 [5][6]** : 1,20 m, 16 cm, 28 cm, bande d'éveil à 0,50 m, contremarche ≥ 0,10 m visuellement contrastée, nez contrastés sur 3 cm, débord d'« une dizaine de millimètres », main courante de 0,80 à 1,00 m depuis le nez, une seule main courante pour un fût central de diamètre **≤ 0,40 m**, prolongement d'un giron.
- **Arrêté du 24/12/2015, art. 6.1 [9] et art. 12 [8]** : 1,00 m, 17 / 28 cm ; 0,80 m, 18 / 24 cm ; garde-corps tenant lieu de main courante ; renvoi de l'art. 12 à l'art. 6.1.
- **Règlement ERP, CO 51, 55 et 56 [10]** : recouvrement de 0,05 m, mains courantes selon les UP, 25 marches, plus de 4 UP, rampe ≤ 12 %, palier de même largeur et > 1 m, balancement continu, mesure à 0,60 m du noyau, giron extérieur < 0,42 m, main courante extérieure pour 1 UP.
- **NF P06-111-2 (2004) [16]** : tableau 6.2 (NF) intégralement conforme ; note (1) sur les marches indépendantes ; clause 2.2(3) ; catégorie D1 par défaut.
- **ISO 14122-3:2016 §4.2.2 [17]** : 1,5 kN sur 100 × 100 mm ; deux charges à 600 mm si w ≥ 1 200 mm ; flèche ≤ 1/300 de la portée, 6 mm au maximum.
- **NF P01-012:2024 via APAVE [12]** : tableau H(E), gabarits T1, T2 et T3, discontinuité de 0,05 m, « plinthe de 0,60 m au lieu de 0,45 m », calendrier au 1er juin 2025 et au 1er janvier 2026, principe d'une hauteur de chute > 1 m.
- **DTU 36.3 P3, statut [23]** : publié le 06/09/2014, confirmé le 30/11/2019, réexamen en 2029, aucune révision en cours signalée.
- **ADK [21]** : Table 1.1 (150–220 / 220–300, 42°, 2R+G de 550 à 700) ; échappée de 2 m, réduite à 1,9 m / 1,8 m en combles ; 50 mm au collet, mesure à 270 mm ; 12 / 16 / 36 hauteurs ; pas décalés 220 / 220.
- **DIN 18065 via Trepedia [22]** : collet de 100 mm en général, 50 mm dans les maisons de 1 à 2 logements (0 mm pour les escaliers à noyau).
- **Mathématiques** : arctan 0,78 = 37,95°, arctan 1 = 45°, arctan 1,32 = 52,85° ; `L_tremie ≥ (e_min + ep)·g/h` exact pour une volée droite dont le nez d'arrivée est au bord de la trémie (mesure verticale) ; `R = (n − 1)·g` exact (n hauteurs donnent n − 1 girons entre le 1er nez et le nez d'arrivée) ; `e_perp = e_vert·cos α` exact.

### Corrigé

1. **Tableau 6.12 (NF), charges sur garde-corps** : le tableau de 2004 a été modifié par l'**amendement A1 (mars 2009)**. D'après [32], C1 passe de 0,6 à **1,0 kN/m** ; A et B restent à 0,6. Corrigé en §3.6 et dans `CHARGE_GC_HORIZONTALE` (confiance abaissée à moyen).
2. **ERP existants (arrêté du 08/12/2014)** : texte relu sur Légifrance (art. 7, point 7.1). Confiance relevée de moyen à **élevé** ; exception « dimensions initiales conservées » ajoutée ; source [31] ajoutée.
3. **CO 36 (UP)** : article relu sur Légifrance. Confiance relevée à **élevé**.
4. **Échappée** : l'attribution à Batirama [27] d'une mesure « perpendiculaire » était **inexacte** et a été retirée. Définitions ISO (hauteur de tête verticale, dégagement perpendiculaire) ajoutées ; écart ramené de « ≈ 25 % » à **≈ 23 %**.
5. **Tolérance de hauteur d'étage > 3 m** : `10·H^(1/3)` est un intervalle **total**, donc une tolérance de ± 5·H^(1/3) (continuité avec ± 7 mm à 3 m). La formule de `HAUTEUR_ETAGE_TOLERANCE` était fausse d'un facteur 2 ; elle est corrigée.
6. **Bande d'éveil** : la réduction à un giron vaut aussi en BHC, pas seulement en ERP (§1.11, `BANDE_EVEIL`).
7. **NF P01-012:2024** : ajout du renvoi « (b) » sur les hauteurs de 0,85 et 0,80 m (condition inconnue, ⚠️ non vérifié) et du domaine « constructions neuves ».
8. **NF E85-015** : question ouverte résolue, édition de **juillet 2019** (remplace celle d'avril 2008).
9. **ISO 14122-3 (via CFST)** : hauteur de volée de 4 000 mm admise aussi par l'ISO pour une volée unique ; palier ≥ 800 mm **et** ≥ largeur de l'escalier ; dégagement de 1 900 / 850 mm ajouté.
10. **Seconde génération des Eurocodes** : calendrier général ajouté [33].
11. **Crémaillères FCBA** : le FCBA présente ce tableau comme un « exemple de résultats de calcul » ; le rattachement direct au P3 est nuancé.
12. **Emmarchement de 700 mm** : nuance sur le champ (AFEB : général ; CODIFAB : MI, en « largeur de passage »).

### ⚠️ Non vérifié (inchangé ou signalé)

- Borne haute de 2h+g en ERP et BHC (640, selon l'UICB, contre aucune borne propre selon l'AFEB) : **conflit maintenu**. Le texte du P3 est payant et aucune source trouvée ne reproduit le tableau.
- Annexe A du DTU (hélicoïdal : 230 mm, ligne de foulée à 0,60 m du fût) : source unique [24], non recoupée.
- Hauteur du rampant (0,90 m) dans la NF P01-012:2024 : seulement des sources de fabricants, non confirmée par l'APAVE.
- Valeurs de la NF P01-012:1988 : sources secondaires concordantes, texte non lu.
- Flèches admissibles du DTU (RC 5.2 et 5.3), tableau 7.2 de l'AN de l'EC5, AN de l'EC3 : non lus.
- Valeur de la catégorie E dans le tableau 6.12 (NF) modifié par l'A1.
- Code du travail : aucune règle chiffrée trouvée.
- Valeurs « usage » du collet (100 / 150 mm), glissance de « 110 » (unité inconnue ; Batirama [27] confirme seulement le chiffre).
- **Remarque de nature** : l'Approved Document K est un document d'orientation approuvé au titre des Building Regulations (Angleterre). L'étiquette [RÉG] est conservée pour la comparaison, mais ce n'est pas un texte réglementaire au sens strict.

### Cohérence de `rules.yaml`

- YAML valide (`yaml.safe_load`), 98 règles, identifiants uniques, `severite` / `nature` / `confiance` dans les énumérations, contextes tous déclarés. Contrôle relancé après correction.
- Règles modifiées : `H_MAX_ERP_EXISTANT`, `G_MIN_ERP_EXISTANT`, `LARGEUR_MC_ERP_EXISTANT`, `LARGEUR_UP_ERP`, `HAUTEUR_ETAGE_TOLERANCE`, `CHARGE_GC_HORIZONTALE`, `BANDE_EVEIL`, `GC_HAUTEUR_2024`, `ECHAPPEE_MIN_DTU`, `ECHAPPEE_INDUSTRIEL`, `VOLEE_HAUTEUR_INDUSTRIEL`, `PALIER_INDUSTRIEL`, `CREMAILLERE_REGLE_MOYENS`, `MC_DEUX_COTES`.
