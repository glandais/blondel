# Axe D — État de l'art logiciel

> Projet **Blondel** : logiciel web de conception paramétrique d'escaliers (bois, métal, mixte).
> Recherche menée le 2026-09-28. Chaque affirmation factuelle renvoie à une source [n] (section « Sources » en fin de fichier) et porte un niveau de confiance : **élevé** (source primaire vérifiée : dépôt, registre npm, spécification officielle), **moyen** (page commerciale de l'éditeur, article de presse spécialisée), **faible** (source secondaire ancienne, extrait non vérifié, déduction).
>
> **Sur la distinction « exigence normative » / « usage de métier »** : l'axe D ne traite presque pas de règles dimensionnelles. Les seuls éléments de nature **normative** ici sont les standards de formats d'échange (IFC = ISO 16739-1, STEP = ISO 10303, BTLx = spécification design2machine, DSTV-NC = standard de l'association allemande de la construction métallique). Tout le reste (flux utilisateur, versions DXF acceptées par les ateliers, conventions de calques…) relève de l'**usage de métier** ou de choix d'éditeurs, et est signalé comme tel.
>
> Les données npm/GitHub (versions, dates, tailles) ont été **mesurées directement** le 2026-09-28 via le registre npm, l'API GitHub et le CDN jsDelivr (tailles gzip/brotli recalculées localement).

---

## 1. Logiciels concurrents

### 1.1 Panorama

| Logiciel | Éditeur / origine | Plateforme | Matériaux | Cible | Prix indicatif | Conf. |
|---|---|---|---|---|---|---|
| **StairDesigner** (v7) | Boole & Partners (Champs-sur-Marne, FR), distribué par Atelier Bois / Kessel EDV / Powell CNC | Poste Windows (plateforme non précisée sur le site éditeur) | Bois, marbre/pierre, métal, verre | Menuisier, TPE | Pro : 2 245 £ HT ; Pro PP (post-processeurs CNC) : 4 145 £ HT [9] (vérifié) ; en 2018 : base 1 750 € (1 990 € avec DXF), 3 450 € avec post-processeur [13] (vérifié) | moyen |
| **Compass Software** (v10 en 2018) | Compass Software GmbH (DE) | Poste + configurateur cloud | Bois, verre, métal, pierre, béton coulé | Fabricant d'escaliers bois, PME à industriel | « à partir de 2 800 € » en packages (2018) [13] | moyen |
| **Staircon** | Elecosoft / Eleco (première version en 1999 [15] ; développement en Suède ⚠️ non vérifié) | Windows + outils web (Showroom, Online Designer) | Bois, métal (peint/verni) | Fabricant bois | Staircon Limited 2 630 € (2018) [13] | moyen |
| **StairBiz** | StairBiz (Australie) | Windows (réseau) | Bois principalement | Fabricant (gestion d'entreprise intégrée) | non publié | moyen |
| **cadwork Escalier / Treppe** | cadwork (CH) — module du modeleur 3D cadwork | Poste Windows | Bois, acier | Charpente-menuiserie | cadwork base ≈ 9 000 € + module Treppe 2 500 € (2018) [13] | moyen |
| **TopSolid'Wood / TopSolid'Steel** (« Épure d'escalier ») | TopSolid (FR) | Poste Windows | Bois, acier | Industriel, bureau d'études | non publié | moyen |
| **SEMA Treppe** | SEMA GmbH (DE) | Poste | Bois, acier, béton, pierre, verre | Menuisier / fabricant bois | 2 980 € + modules (Stahltreppe 990 €, Spindeltreppe 990 €, CAD/CAM 3 190 €…) (2018) [13] | moyen |
| **TENADO TREPPE** | TENADO GmbH (DE) — add-on de TENADO METALL 2D | Poste | Acier, inox, laiton, alu, bois | **Métallier** | 595 €/licence (2018) [13] | moyen |
| **TrepCAD** | GRAITEC (DE) | Poste | Bois, acier, pierre, verre | Métal / pierre | 980 € (2018) [13] | moyen |
| **AICADstair** | BauCAD GmbH (DE) — sur AutoCAD/BricsCAD | Plugin | Bois, pierre, acier | Menuisier | 4 500 € + modules (2018) [13] | moyen |
| **Palette CAD** | Palette CAD GmbH (DE) | Poste | — | Agencement / intérieur | — ; qualifié de fonctions escalier « plutôt basiques » et export DXF « rudimentaire » par des utilisateurs [14] | faible |
| **MétalCad Escaliers** (suite Métalusoft) | Métalusoft (FR) | Poste (environnement 3D) | **Métal** (serrurerie) | Serrurier-métallier | non publié | moyen |
| **Tekla Structures** (composants S71, S72, S73, S74, S82… ; extension *Spiral staircase* sur Tekla Warehouse) | Trimble | Poste | Acier | Charpente métallique | licence Tekla | élevé (doc) |
| **Advance Steel** (macros escalier droit / hélicoïdal) | Autodesk (+ PowerPack GRAITEC) | Poste (AutoCAD) | Acier | Charpente métallique | licence Autodesk | moyen |

**Fourchette de marché** : en 2018, la revue professionnelle allemande BM écrivait que « les prix des logiciels se situent entre 600 et 6 000 euros » [13] ; les prix du tableau sont HT (« zzgl. Mehrwertsteuer », état octobre 2018), et la formation et la maintenance y sont chiffrées à part (confiance moyen, donnée de 2018 à reconfirmer). **Nuance (vérification)** : le tableau de BM sort lui-même de cette fourchette, avec S+S Treppenplaner dès 490 € et cadwork ≈ 9 000 € (logiciel de base) + 2 500 € (module Treppe) + module Maschine de 3 500 à 6 000 € [13].

**Configurateurs web de fabricants** (grand public ou revendeurs) : Staircon Online Designer [4], configurateur cloud Compass [6], StairBox StairBuilder (UK) [16], Mon Escalier Métal [17], Escamétal, ESCA Studio (Escaliers Échelle Européenne), Renaud Créations (colimaçon) [18] — voir §1.4.

### 1.2 Fiches détaillées

#### StairDesigner (Boole & Partners)
- **Fonctions** : calcul instantané de toutes les pièces (limons, marches, contremarches, poteaux, lisses, mains courantes) ; optimisation automatique hauteur de marche / giron / longueur de volée « selon les codes » ; balancement réglable manuellement ou par un **coefficient de balancement** ; paramètres par pièce (rotation, épaisseur, recouvrement) [1][2] (moyen).
- **Typologies** : droit, quart tournant, U, L, courbe, hélicoïdal, S, multi-volées [2][9] (moyen).
- **Flux utilisateur** : *Fichier > Nouvel escalier multi-volées balancé* → choix d'un **modèle de départ** (droit, quart tournant, demi-tournant, une volée…) → saisie de la **hauteur à monter**, longueur et largeur de chaque volée, longueur de palier, sens de rotation, puis activation des éléments (limons, garde-corps, poteaux) [1] (moyen). L'éditeur annonce la saisie rapide d'une **cage d'escalier** et le contrôle de la loi de Blondel et de l'échappée [8] (moyen).
- **Sorties** : listes de débit, plans, coûts, présentation 3D (module StairRender), **gabarits 1:1** imprimables pour les ateliers sans CNC, DXF par calques propres à chaque pièce, export 3DS, **post-processeurs natifs** Homag, Biesse, SCM/Morbidelli, Holz-Her, Felder, Vitap, Brema, Busellato [1][2] (moyen). Éditions : Architect (DXF/3DS), Standard, Professional (gabarits 1:1), Pro-DXF, Post-Processor [8] (moyen).
- **Modèle commercial** : version gratuite complète en conception mais sans documents de fabrication [1][3] (moyen) — produit d'appel intéressant.
- **Forces** : référence francophone, très complet sur le bois, gabarits 1:1, prix d'entrée bas. **Faiblesses** : application de poste, interface ancienne (d'après les retours d'utilisateurs, « quelques défauts si on les cherche ») [19] (faible) ; métal traité comme un matériau plutôt que comme un métier (pas de débit de profilés/tôles identifié).

#### Compass Software
- **Typologies** (12 familles) : encastrée/fermée, ouverte, gain de place / pas japonais, **à boulons** (Bolzentreppe), pliée (Faltwerk), **Z-riser**, limon central, hélicoïdale, béton coulé, **acier double limon**, **acier limon**, HPL [5] (moyen).
- **Flux** : le projet démarre par la définition de la **trémie, du plan et des murs** ; gestion de cages complètes sur plusieurs niveaux avec garde-corps de palier ; murs avec fenêtres et portes, rampants de toiture [5] (moyen). Import DXF, outils de **relevé** (Flexijet, Bosch GLM100C) [5][13] (moyen).
- **Sorties** : nomenclatures détaillées, sorties 1:1, calcul de prix, 3D, **réalité augmentée** (HoloLens mentionné en 2018), **commande CNC directe sans post-processeur externe, jusqu'à 5 axes** ; interfaces DXF import/export, XML, **export IFC**, import BTL [5][13] (moyen).
- **Configurateur en ligne** : le client final configure via menus, les données partent sur un **serveur hébergeant le logiciel de fabrication**, qui complète la conception et renvoie la 3D ; prix et plans accessibles ; **transfert direct en production** sans ressaisie ; personnalisable (logo, couleurs) pour le fabricant [6] (moyen).
- **Forces** : chaîne complète vente → CNC, architecture serveur déjà « cloud ». **Faiblesses** : orienté bois, prix sur devis, produit lourd.

#### Staircon (Elecosoft)
- **Flux** : trois vues — **vue en plan** (forme de l'escalier, trémie, murs), **vue latérale** (forme des limons et du garde-corps), **vue 3D** [10] (moyen, extrait de presse).
- **Gamme modulaire** : Sales (vente avec 3D), Limited (formes de base + plans de fabrication 1:1), Professional (+ export DXF), CAM 3/4 axes, CAM 5 axes, CAM 5+ (arcs, Z-riser) ; plus Online Designer et Showroom web [11] (moyen).
- **Sorties** : nomenclature, plans de fabrication, prix, **DXF par calques** pour FAO, code NC 3/4/5 axes ; interfaces DXF, O2C, Collada, **IFC**, NC-Hops, woodWOP, Xilog, bSolid (2018) [10][13] (moyen).
- **Online Designer** : pan/zoom/rotation, changement de matériaux/finitions, géométries générées depuis la base Staircon partagée avec les logiciels de poste ; module optionnel *Pricing* ; **ne permet pas de commander** ; nécessite WebGL [4] (moyen).

#### StairBiz
- Suite intégrée : conception (droits, balancés, courbes, « live 3D »), spécification, estimation, devis, stock, comptabilité, CNC, planning, gestion client ; **vérification automatique de conformité** au code australien (BCA/NCC) [7][12] (moyen).
- Modules : Professional (cœur), Estimating (matières, main-d'œuvre, frais, marge, remises, taxes), **CNC** (placement des pièces sur une table CNC simulée, licence par machine), Receptionist ; Windows en réseau [12] (moyen).
- **Leçon pour Blondel** : le chiffrage (matière + MO + frais + marge) calculé *pendant* la conception est un argument central [7] (moyen).

#### cadwork Escalier
- Module du modeleur 3D cadwork : choix d'un **modèle paramétrique** → maquette 3D → retouches dans le modeleur 3D → **plans et listes automatiques** [20] (moyen).
- Réglages : hauteur de passage (échappée), ligne de foulée, nombre de marches, formes de limon et balustres, dimensions des marches, **formule de Blondel** ; **retouche graphique du balancement en vue en plan** et de la forme du limon en élévation [20][21] (moyen).
- CNC via module Maschine : **BTL, DSTV-NC, DXF**, 3 à 5 axes (2018) [13] (moyen).

#### TopSolid (« Épure d'escalier »)
- Entrées : **par tableau** (panneau Volées), **par points** dans la zone graphique, **par profils** définissant l'encombrement [22] (élevé, doc officielle).
- Modes de répartition : *Même hauteur* (« les marches droites possèdent la même hauteur mais des girons différents ») ou *Même marche* (marches droites identiques, « les reliquats sont rattrapés sur les paliers ou marches extrêmes ») ; contraintes min/max/objectif sur **hauteur de marche, giron, angle de foulée, pas de foulée, nombre de hauteurs** [22] (élevé).
- Paliers : *standard ou fractionné*, *rayonnant* (« les nez de marche se joignent en un point »), *balancé* [22] (élevé).
- Sorties : épure 2D au sol, esquisses 3D par marche, formes locales par marche ; les limons s'appuient sur un **modèle de document** définissant la forme à conserver sur chaque volée [22][23] (élevé/moyen).
- **Leçon** : la séparation *épure* (tracé de répartition, indépendant de la structure) / *constituants* (marches, limons générés depuis l'épure) est un bon modèle d'architecture pour Blondel.

#### SEMA Treppe
- « Assistant escalier » : choix de la forme, saisie des cotes, l'escalier apparaît en 3D sur n'importe quel plan ou tracé ; bois, acier, noyau béton avec habillage ; **escaliers à boulons/suspendus** (connecteurs définissables par l'utilisateur), hélicoïdaux intégrés ; **relevé 3D laser** ; sorties 1:1, listes, CNC via SEMA Connect (multi-faces à 5 axes interpolés) [24] (moyen). Interfaces DXF, SCI, **IFC, BTL** (2018) [13] (moyen).

#### Logiciels côté métallerie
- **TENADO TREPPE** : génère automatiquement escaliers à limons (Wangen) et à poutres (Holm) à partir du type, du matériau et des cotes ; types : droit, droit avec palier, balancé 1/4 et 1/2, U avec demi-palier, **limons tôle, mono-poutre, bi-poutre, limon en U, limon en fer plat** ; **nomenclature automatique avec cotes de coupe et poids**, DXF, DWG, PDF, **PDF 3D** [25][26] (moyen). Pas de commande CNC directe (2018) [13] (moyen).
- **MétalCad Escaliers** (Métalusoft, FR) : droit, quart tournant, deux quarts tournants, hélicoïdal, suspendu, limon central, pas japonais ; limons **tube, caisson, caisson débillardé, UPN, fer plat** ; balancement personnalisable en temps réel, marches en tôle pliée personnalisées, perçages des supports et limons ; intègre trémie, murs et paliers ; intégré à une suite allant jusqu'à la facturation [27][28] (moyen). Formats d'export non détaillés publiquement.
- **Tekla Structures** : composants S71, S72 (marches bois), S73, S74 (Z pan : supports par équerres horizontales/verticales ou tôle pliée), S75 (plinthe), S82, échelles S35/S60 — **tous pour escaliers droits** avec paliers optionnels ; aucun escalier balancé ni hélicoïdal dans les composants standard [29][30] (élevé). **Correction (vérification)** : Trimble diffuse sur Tekla Warehouse une extension ***Spiral staircase*** (v2.6), avec un limon et un poteau central ou deux limons, en tôle cintrée ou en poutre hélicoïdale, et des marches paramétrables [52] (élevé) ; sa page d'aide ne mentionne que les versions 2017i à 2020 de Tekla Structures (compatibilité avec les versions récentes ⚠️ non vérifiée). Aucune extension pour **escaliers balancés** n'a été trouvée. Export **NC1/DSTV** [31] (élevé).
- **Advance Steel** : outil escalier droit (1 à 3 volées, U, L balancé à 90°, Z) proposant nombre de marches, hauteur, giron ; outil **hélicoïdal** défini par centre, hauteur, rayon extérieur, sens et angle total [32] (moyen).

### 1.3 Flux utilisateur observés — synthèse

| Étape | Pratique dominante | Exemples | Conf. |
|---|---|---|---|
| Initialisation | **Choix d'un modèle/gabarit** de forme puis saisie des cotes | StairDesigner [1], cadwork [20], TENADO [25], SEMA [24] | moyen |
| Contexte bâti | Saisie de la **trémie, des murs, du plan**, parfois cage multi-niveaux | Compass [5], Staircon [10], MétalCad [27], StairDesigner [8] | moyen |
| Relevé | Import DXF / appareils de relevé (Flexijet, Leica Disto, tachymètre, scanner BLK360) | Compass, cadwork, SEMA, Staircon [13] | moyen |
| Répartition | Calcul automatique (hauteur de marche, giron, Blondel) avec contraintes min/max/cible ; mode « même hauteur » vs « même marche » | TopSolid [22], cadwork [21] | élevé/moyen |
| Balancement | Automatique + **retouche graphique en plan** ou coefficient | cadwork [20], StairDesigner [2], MétalCad [27] | moyen |
| Limons | Édition du profil en **élévation / vue latérale** | Staircon [10], cadwork [20] | moyen |
| Contrôle | Alertes réglementaires en direct (Blondel, échappée ; codes nationaux) | StairDesigner [8], StairBiz [7], StairBox [16], Mon Escalier Métal [17] | moyen |
| Sorties | Plans 2D, 1:1, nomenclature/débit, prix, CNC | tous | moyen |

**Constat** : aucun des logiciels étudiés n'est une application **web-native de conception professionnelle** ; les produits web existants sont des **configurateurs de vente** (géométries prédéfinies, souvent sans données de fabrication côté client). Seul Compass relie explicitement configurateur web et données de production, via un serveur [6] (moyen). → **Créneau pour Blondel**.

### 1.4 Configurateurs web de fabricants
- **Mon Escalier Métal** : saisie de dimensions/options, **contrôle en temps réel** empêchant une configuration non réalisable ou non conforme, prix à chaque étape, rendu 3D, récapitulatif des cotes, plans de pose ; types droit, quart tournant, limon central [17] (moyen).
- **StairBox StairBuilder (UK)** : visualiseur 3D mis à jour à chaque clic, alerte automatique si le projet sort de la réglementation (« building regulations » ; la page consultée ne nomme pas l'*Approved Document K*, qui est le texte anglais applicable aux escaliers), devis par e-mail, **plan CAO reçu sous 24 h après la commande**, optimisé mobile [16] (moyen, vérifié).
- **Escamétal, ESCA Studio, Renaud Créations, MétaluSoft configurateur** : configuration pas-à-pas en 3D et devis en ligne [18][27] (moyen).
- **Leçon** : le contrôle bloquant en temps réel + prix instantané est devenu la norme côté vente ; la validation finale reste humaine (plans CAO renvoyés au client).

### 1.5 Forces / faiblesses du marché et opportunités pour Blondel

| Constat | Source | Opportunité Blondel |
|---|---|---|
| Logiciels de poste Windows, licences 600–6 000 € + maintenance | [13] | Web, multiplateforme, pas d'installation |
| Spécialisation **bois** (CNC 5 axes, BTL, woodWOP) ; métal traité en add-on ou dans des outils de charpente génériques | [13][29] | Traiter **bois, métal et mixte** comme métiers à part entière |
| Outils de charpente métallique (Tekla) limités aux escaliers **droits** en standard ; hélicoïdal seulement via une extension ancienne, aucun balancé | [29][52] | Balancés, hélicoïdaux et **limons débillardés** métal (développés de tôle) |
| Débit métal (profilés, poids, coupes) : présent chez TENADO, absent/non documenté ailleurs | [25] | Nomenclature profilés + DSTV-NC + DXF laser |
| IFC export seulement chez quelques acteurs (Compass, Staircon, SEMA) | [13] | IFC 4.3 natif (IfcStair/IfcStairFlight + Psets) |
| Configurateurs de vente séparés des outils de fabrication | [4][6] | Même modèle paramétrique de la vente à l'atelier |

---

## 2. Bibliothèques web

Mesures effectuées le 2026-09-28 (registre npm, API GitHub, CDN jsDelivr ; tailles compressées recalculées localement avec `gzip -9` et `brotli`) [33] (élevé).

### 2.1 Rendu 3D

| Bibliothèque | Version (date) | Licence | Activité (dernier push) | Taille | Remarques | Conf. |
|---|---|---|---|---|---|---|
| **three.js** | 0.186.1 (24/09/2026) | MIT | 28/09/2026, ~116 k étoiles | `three.module.min.js` + `three.core.min.js` ≈ 90 + 104 ko gzip | Écosystème le plus large ; `WebGPURenderer` avec repli WebGL 2 automatique, mais encore qualifié d'« expérimental » par sa doc ; TSL remplace `ShaderMaterial`/`onBeforeCompile` côté WebGPU [34][35] | élevé |
| **@react-three/fiber** | 9.8.1 (24/09/2026) | MIT | 26/09/2026 | ≈ 2,4 Mo décompressé | Requiert **React ≥ 19 < 19.4**, three ≥ 0.156 ; écosystème `drei` (MIT, actif) | élevé |
| **Babylon.js** | 9.28.0 (24/09/2026) | Apache-2.0 | 28/09/2026 | bundle UMD complet ≈ 1,85 Mo gzip (arbre de modules ES tree-shakable plus léger) | Moteur plus « intégré » (inspecteur, PBR, GUI), bon support WebGPU | élevé |
| three-gpu-pathtracer | actif (28/09/2026) | MIT | — | — | Rendu photoréaliste progressif pour visuels commerciaux | élevé |
| three-bvh-csg | 0.0.18 (02/2026) | MIT | 27/09/2026 | — | Booléens maillage rapides pour l'aperçu, pas de B-Rep | élevé |

**Textures PBR libres** : **Poly Haven** — licence **CC0**, usage commercial, redistribution et revente autorisés, sans attribution [36] (élevé) ; **ambientCG** — **CC0 1.0**, attribution non requise, inclusion dans un logiciel autorisée [37] (élevé). → On peut embarquer des textures bois (chêne, hêtre, frêne…), acier brut/galvanisé/thermolaqué, verre, béton dans Blondel sans contrainte de licence.

### 2.2 Noyaux géométriques

| Bibliothèque | Version (date) | Licence | Activité | Taille wasm | Modèle | Exports | Conf. |
|---|---|---|---|---|---|---|---|
| **opencascade.js** (donalffons) | `latest` 1.1.1 (**2020**), `beta` 2.0.0-beta.b5ff984 (03/2023) | LGPL-2.1 | dernier push **08/2023** | build complet volumineux (paquet 66,7 Mo décompressé en 1.1.1, 64,3 Mo en beta) | B-Rep (OCCT 7.x) | tout OCCT (STEP, IGES, STL…) | élevé |
| **replicad** + `replicad-opencascadejs` | 1.1.0 (04/09/2026) | MIT (replicad) / LGPL-2.1 (build OCCT) | actif (09/2026) | `replicad_single.wasm` : **23,0 Mo brut, 7,2 Mo gzip, 4,8 Mo brotli** | B-Rep OCCT (build personnalisé, image Docker `ghcr.io/taucad/opencascade.js`, **OCCT 8.0.1** d'après `docs/occt-v8-migration.md`) | **STEP AP242** (`blobSTEP`, `exportSTEP` avec assemblages nommés/colorés ; le code force `write.step.schema = 5`, soit AP242DIS dans OCCT [53]), **STL**, **SVG** ; import STEP/STL ; **projection avec suppression des lignes cachées** (`drawProjection`, HLRBRep) ; sweep (`MakePipeShell`), loft (`ThruSections`), congés/chanfreins | élevé |
| **manifold-3d** | 3.5.4 (25/09/2026) | Apache-2.0 | actif (28/09/2026) | `manifold.wasm` : **0,54 Mo brut, 0,20 Mo gzip, 0,16 Mo brotli** | Maillage triangulé, **booléens garantis manifold** | E/S intégrées limitées (OBJ, pour les tests) ; le README **recommande** 3MF et glTF (`EXT_mesh_manifold`) et fournit un exemple `gltf-io.ts` pour le paquet npm, mais aucun écrivain 3MF natif (correction) ; **pas de B-Rep ni STEP** ; utilisé par OpenSCAD, Blender, Godot, IFCjs [38] | élevé |
| **@jscad/modeling** | 2.13.0 (02/2026) | MIT | actif | JS pur, ≈ 59 ko gzip | CSG maillage/polygones | via `@jscad/io` : DXF, STL, 3MF, SVG (pas de STEP) | élevé |
| **CGAL wasm** | ports communautaires (CGALWebAssembly, arrangement-2d-js, cgaljs) | GPL/LGPL (CGAL) | non officiel | — | Exact/robuste en natif | — ; en wasm : pas de modes d'arrondi configurables (confirmé par un mainteneur d'Emscripten [39]) ; l'effet sur l'arithmétique d'intervalles des prédicats filtrés de CGAL est ⚠️ non vérifié. Gels du navigateur lors de booléens : l'auteur de l'issue [39] les a finalement attribués à un **débordement de pile** (récursion), pas aux modes d'arrondi (correction). Les ports communautaires sont inactifs depuis 2022-2023. | moyen |
| **OCCT** (natif) | 8.0.0 publié le **07/05/2026**, 8.0.1 le **30/07/2026** (GitHub) | LGPL-2.1 + « Open CASCADE exception » | actif | — | B-Rep | notes de version 8.0.0 : suppression des entités dupliquées en export STEP, fichiers ~20 % plus petits en moyenne ; C++17 minimum ; nouvelle représentation BRepGraph [40] (élevé). « Lecture STEP jusqu'à +75 % vs 7.7 » : chiffre absent des notes de version, repris d'une communication commerciale OCCT3D (moyen) | élevé/moyen |
| truck (Rust) | — | Apache-2.0 | actif (09/2026) | — | B-Rep NURBS en Rust/wasm | jeune, écosystème limité | moyen |
| chili3d | — | **AGPL-3.0** | actif | — | Application CAO web sur OCCT | licence incompatible avec un produit fermé | élevé |
| Fornjot | — | — | **archivé** | — | — | à exclure | élevé |

**Point d'attention — développés** : aucune des bibliothèques étudiées ne fournit de fonction « dépliage de tôle » ou « développé de limon hélicoïdal » prête à l'emploi (constat de revue des API, confiance moyen). Les développés (limons débillardés, crémaillères, gabarits de main courante) devront être **calculés analytiquement dans le code métier de Blondel** (voir axe B), le noyau servant à la validation 3D, à la projection 2D et à l'export STEP.

### 2.3 2D, export DXF / SVG / PDF / tableurs

| Bibliothèque | Version (date) | Licence | Capacités | Conf. |
|---|---|---|---|---|
| **@tarikjabiri/dxf** (dxfjs/writer) | 2.9.0 (15/09/2026) | MIT | Écrit du DXF **AC1021 (AutoCAD 2007)** ; calques, types de lignes, styles, **LWPOLYLINE**, arcs, cercles, ellipses, splines, hachures, textes/MText, **cotations** (alignée, linéaire, angulaire, radiale, diamètre), blocs/inserts, images, tableaux, fenêtres | élevé |
| dxf-writer (js-dxf) | 1.18.4 (**11/2022**) | MIT | Basique ; dépôt GitHub introuvable via l'API (supprimé ou renommé) | élevé |
| maker.js (Microsoft) | 0.19.2 (01/2026) | Apache-2.0 | Modèles 2D paramétriques, export **DXF, SVG, PDF**, chaînage de contours, offsets — adapté aux gabarits de découpe | élevé |
| dxf-parser | 1.1.2 (**11/2021**) | MIT | Import DXF (relevés, plans d'architecte) — ancien mais stable | élevé |
| jsPDF + svg2pdf.js | 4.2.1 (03/2026) / 2.8.1 (08/2026) | MIT | PDF vectoriel côté client, conversion SVG→PDF pour plans cotés | élevé |
| pdfmake | 0.3.11 (06/2026) | MIT | Documents tabulaires (devis, nomenclatures) | élevé |
| pdf-lib | 1.17.1 (**11/2021**) | MIT | Manipulation de PDF ; plus maintenu (dernier push 07/2024) | élevé |
| exceljs | 4.4.0 (**10/2023**) | MIT | Écriture XLSX ; peu de sorties récentes | élevé |
| SheetJS (xlsx) | npm figé à 0.18.5 (03/2022), **vulnérable** : CVE-2023-30533 (pollution de prototype jusqu'à 0.19.2, seulement à la **lecture** de fichiers malveillants ; l'export seul n'est pas concerné) et CVE-2024-22363 (ReDoS avant 0.20.2) [41][54] ; versions corrigées **uniquement sur cdn.sheetjs.com** | Apache-2.0 | Lecture/écriture tableurs [41] | élevé |
| opentype.js | 2.0.0 (05/2026) | MIT | Conversion de texte en contours vectoriels (marquage/gravure laser des repères de pièces) | élevé |

### 2.4 BIM / IFC

| Bibliothèque | Version (date) | Licence | Capacités | Conf. |
|---|---|---|---|---|
| **web-ifc** (That Open Company) | 0.0.78 (21/09/2026) | MPL-2.0 | Lecture **et écriture** : `CreateModel`, `CreateIfcEntity`, `WriteLine(s)`, `SaveModel` ; schémas **IFC2X3, IFC4, IFC4X3** ; extraction de géométrie (`StreamAllMeshes`, `GetFlatMesh`) ; `web-ifc.wasm` **1,6 Mo brut, 0,57 Mo gzip, 0,44 Mo brotli** ; version mono- et multi-thread | élevé |
| @thatopen/components, @thatopen/fragments | 3.4.x (07/2026) | MIT | Visionneuse BIM sur three.js | élevé |
| **IfcOpenShell** (via Pyodide) | 0.8.x (0.9 en alpha, 09/2026) | LGPL-3.0 | API Python complète (`root.create_entity`, `geometry.add_*_representation`…) dans le navigateur via des **wheels wasm** hébergées par le projet ; démo wasm.ifcopenshell.org ; chargement lourd (runtime Python) [42][43] | moyen |

---

## 3. Formats d'échange utiles au métier

### 3.1 DXF — atelier, découpe laser/plasma, pliage
- **Statut** : format propriétaire Autodesk documenté, **non normatif** ; les exigences ci-dessous sont des **usages de métier** relevés chez des sous-traitants de découpe.
- **Version** : les recommandations divergent (attributions corrigées lors de la vérification) :
  - **DXF 2000 et R12** : ENSA Paris-Belleville (« DXF2000, DXF R12 ») [44] et L'Atelier du Laser (« R12 ou 2000 (compatibilité large) ») [55] ;
  - **R14 ou 2007**, « formats les plus compatibles » quand l'import échoue : CutOptim, éditeur de logiciel d'optimisation de découpe [56] ;
  - **R2010/R2013 ASCII, jamais binaire** : AICC Laser [45] ;
  - SECMI et Tole Factory [44] ne précisent **aucune version**.
  
  (moyen, **sources contradictoires**) → Blondel doit proposer un **choix de version** à l'export. Vérifié dans le code de @tarikjabiri/dxf 2.9.0 : l'en-tête `$ACADVER` est codé en dur à **AC1021 (2007)** [33] (élevé) ; il faudra donc un écrivain R12 ou 2000 pour les ateliers qui les exigent.
- **Géométrie** : **mm, échelle 1:1**, contours **fermés exactement** (« quelques dixièmes de millimètre entre deux extrémités suffisent à provoquer une erreur », SECMI [44]), sans doublons superposés ; **splines à convertir en polylignes ou arcs** (AICC [45], Tole Factory [44]) ; pas de cotes, hachures, blocs texte ni cartouche (AICC [45]) ; épaisseur de trait nulle, export 2D (SECMI [44]) (moyen, vérifié).
- **Calques** : un calque par fonction (découpe, perçage, gravure, pliage), couleurs distinctes [44][45] (moyen).
- **Règles DFM** citées par un sous-traitant (usage, non normatif) : diamètre de trou ≥ épaisseur de tôle ; distance entre découpes ≥ 1 × épaisseur ; rayon intérieur ≥ 0,5 × épaisseur [45] (moyen) — à croiser avec l'axe C.
- **Bois (CNC)** : les logiciels de la profession exportent un DXF par calques propre à chaque pièce, lu par la FAO (woodWOP, Xilog, bSolid, NC-Hops…) [2][13] (moyen). Les conventions de calques (profondeur de fraisage codée dans le nom de calque, etc.) sont **propres à chaque FAO** — à documenter avec les utilisateurs pilotes (question ouverte).

### 3.2 STEP — échange CAO
- **Normatif** : ISO 10303. **Résolu lors de la vérification** : OCCT écrit par défaut de l'AP214 (CD) (`write.step.schema = 1`), mais replicad force `write.step.schema = 5` dans `shapeFunctions/export.ts` et `export/assemblyExporter.ts`, soit **AP242, version DIS** dans la nomenclature OCCT [33][53] (élevé). L'en-tête produit porte donc le schéma AP242 « DIS » ; son acceptation par les logiciels des sous-traitants reste à tester (usage).
- Usage : STEP utile « si une opération de pliage ou de finition 3D suit » ; le PDF est un « plan coté d'accompagnement, jamais de fichier de découpe » [45] (moyen, vérifié).
- Dans le navigateur, seul un noyau B-Rep OCCT (replicad / opencascade.js) produit du STEP [§2.2] (élevé).

### 3.3 IFC — BIM
- **Normatif** : IFC 4.3 publié comme **ISO 16739-1:2024** ; buildingSMART a annoncé l'approbation par l'ISO le 04/01/2024 [47][57] (élevé). Publication ISO effective courant 2024 (avril 2024 selon des sources secondaires ; la page ISO [46] a renvoyé une erreur 403 et n'a pas pu être relue : mois ⚠️ non vérifié). La documentation en ligne de buildingSMART en est à IFC 4.3.2.
- Entités pertinentes (IFC 4.3) [48] (élevé) :
  - `IfcStair` (agrège via `IfcRelAggregates`) → `IfcStairFlight` (une volée ; « un balancement fait aussi partie d'une volée »), paliers en `IfcSlab` (PredefinedType LANDING), `IfcRailing`, `IfcMember` pour les limons (le type prédéfini **STRINGER** existe dans `IfcMemberTypeEnum` en IFC 4.3, vérifié).
  - `IfcStairTypeEnum` : STRAIGHT_RUN_STAIR, TWO_STRAIGHT_RUN_STAIR, QUARTER_WINDING_STAIR, QUARTER_TURN_STAIR, HALF_WINDING_STAIR, HALF_TURN_STAIR, TWO_QUARTER_WINDING_STAIR, TWO_QUARTER_TURN_STAIR, THREE_QUARTER_WINDING_STAIR, THREE_QUARTER_TURN_STAIR, SPIRAL_STAIR, DOUBLE_RETURN_STAIR, CURVED_RUN_STAIR, TWO_CURVED_RUN_STAIR, LADDER, USERDEFINED, NOTDEFINED.
  - `IfcStairFlightTypeEnum` : STRAIGHT, WINDER, SPIRAL, CURVED, FREEFORM, USERDEFINED, NOTDEFINED.
  - Attributs `NumberOfRisers`, `NumberOfTreads`, `RiserHeight`, `TreadLength` de `IfcStairFlight` **dépréciés depuis IFC4** (valeur NIL) au profit de **`Pset_StairFlightCommon`** : Reference, Status, NumberOfRiser, NumberOfTreads, RiserHeight, TreadLength, NosingLength, WalkingLineOffset, TreadLengthAtOffset, TreadLengthAtInnerSide, Headroom, WaistThickness [48][49] (élevé, liste vérifiée dans le gabarit IFC4X3). **Piège d'implémentation** : dans le gabarit de Pset, la propriété s'écrit `NumberOfRiser` (singulier), alors que la documentation de `IfcStairFlight` renvoie à `Pset_StairFlightCommon.NumberOfRisers` (pluriel). Blondel doit écrire le nom du gabarit officiel `NumberOfRiser`, à valider avec un vérificateur IDS ou IfcOpenShell.
- → Mapping quasi direct avec le modèle Blondel (hauteur de marche, giron, ligne de foulée, giron au collet, échappée).

### 3.4 PDF coté
- Plans de fabrication, plans de pose, gabarits 1:1 multi-pages (pratique de StairDesigner, Compass, Staircon [1][5][11]) (moyen). Génération côté client : SVG (projection HLR du noyau) → svg2pdf.js/jsPDF [§2.3] (élevé). TENADO propose aussi du **PDF 3D** pour la présentation client [25] (moyen).

### 3.5 CSV / Excel — débit et nomenclature
- Tous les logiciels étudiés produisent des listes de débit/nomenclatures ; TENADO y ajoute **cotes de coupe et poids** [25] ; StairBiz lie la nomenclature au chiffrage [7][12] (moyen). CSV (universel, trivial) + XLSX via exceljs ou SheetJS (depuis le CDN officiel uniquement) [41] (élevé).

### 3.6 BTL / BTLx — CNC bois
- **Spécification** design2machine (coopération constructeurs de machines / éditeurs) : description **paramétrique** des pièces bois et de leurs usinages ; BTLx est en **XML** avec schéma XSD validable ; schémas publiés : 1.0 (09/06/2020), 2.0 (03/03/2021), 2.1 (29/06/2022), 2.2 (14/03/2024), 2.3 (11/03/2025), **2.3.1 (08/07/2025)** ; la documentation HTML ou PDF « courante » est celle de la version 2.3, datée du 08/07/2025 [50] (élevé, vérifié sur la page Schema).
- Adoption dans l'escalier : cadwork (BTL), SEMA (BTL), Compass (import BTL) [13] (moyen). Plutôt orienté charpente/ossature ; pour l'escalier bois, le DXF par calques + post-processeurs FAO reste dominant [2][13] (moyen). → Priorité **V2**.

### 3.7 DSTV-NC (NC1) — CNC métal (ajout)
- Standard de l'association allemande de la construction métallique (DSTV) : fichier texte par pièce décrivant profil (codes I, L, **U**, B tôle, RU rond, RO tube rond, M tube rectangulaire, C, T, SO), nuance, dimensions et usinages (blocs ST en-tête, BO perçages, AK/IK contours extérieur/intérieur, SI numérotation, KO marquage, PU poudre…) [51] (élevé pour les codes relevés chez Klietsch ; l'éditeur actuel de la spécification n'est pas précisé par cette source) ; lu par les lignes de perçage/sciage et découpe plasma/laser de profilés ; exporté par Tekla, Advance Steel, cadwork [13][31][51] (élevé/moyen).
- → Pertinent pour les **limons en UPN/IPE du commerce** (axe C) : Blondel pourrait générer directement les perçages et coupes d'onglet. Priorité V1/V2.

### 3.8 glTF / USDZ (présentation)
- glTF : export natif via l'exemple `GLTFExporter` de three.js et format recommandé par manifold [38] ; utile pour la RA et le partage client. Compass, Staircon, cadwork proposent déjà VR/AR [13] (moyen).

### 3.9 Matrice format × besoin × priorité proposée

| Format | Destinataire | Nature | Bibliothèque | Priorité |
|---|---|---|---|---|
| PDF coté / 1:1 | Client, poseur, atelier sans CNC | usage | projection noyau → SVG → jsPDF | **MVP** |
| CSV / XLSX nomenclature | Atelier, achats | usage | natif / exceljs | **MVP** |
| DXF 2D par pièce | Laser, plasma, CNC bois | usage (format Autodesk) | @tarikjabiri/dxf | **MVP** |
| glTF | Client, RA | spéc. Khronos | three.js | V1 |
| STEP (AP242) | Sous-traitant pliage, BE | **normatif** ISO 10303 | replicad (OCCT) | V1 |
| IFC 4.3 | Architecte, BIM | **normatif** ISO 16739-1:2024 | web-ifc | V1 |
| DSTV-NC | Ligne profilés métal | standard DSTV | à écrire (format texte simple) | V2 |
| BTLx | CNC charpente | spécification design2machine | à écrire (XML + XSD) | V2 |
| Post-processeurs CNC bois natifs | Homag, Biesse, SCM… | propriétaire | hors périmètre (passer par DXF/FAO) | V2+ |

---

## 4. Recommandation argumentée

### 4.1 Noyau géométrique : architecture à deux niveaux

**Recommandation : un modèle métier analytique en TypeScript (source de vérité) + replicad/OpenCascade chargé à la demande pour le B-Rep et les exports de fabrication ; manifold-3d optionnel pour l'aperçu.**

1. **Couche métier analytique (TS pur, sans dépendance)** — répartition des marches, balancement, ligne de foulée, courbes de rive des limons, **développés** (dépliage analytique des surfaces réglées/hélicoïdales), contrôles réglementaires. Justification : aucune bibliothèque ne fournit de développés de limon [§2.2] ; cette couche doit être testable unitairement, déterministe et rapide (recalcul à chaque frappe). Les données produites (polylignes 2D, surfaces paramétrées) alimentent directement le DXF, le PDF et le maillage d'aperçu.
2. **Aperçu 3D interactif** — maillages générés directement depuis la couche métier (extrusions, surfaces réglées triangulées) et, si besoin de découpes (trous, entailles), **manifold-3d** : 0,20 Mo gzip, Apache-2.0, booléens robustes garantis, très actif [§2.2][38]. Pas besoin du noyau B-Rep pour manipuler l'escalier.
3. **B-Rep et exports de fabrication — replicad** (OCCT 8, MIT + LGPL) chargé **paresseusement dans un Web Worker** au moment de l'export ou de la génération de plans : seul choix web qui donne à la fois **STEP**, sweep/loft (limons hélicoïdaux, mains courantes), congés, et **projections 2D avec lignes cachées** pour les plans cotés [§2.2]. Il est maintenu (09/2026) contrairement à opencascade.js (bloqué en 2023). Coût : **~4,8 Mo brotli** de wasm, acceptable s'il n'est pas sur le chemin critique du premier affichage.
   - Contrainte licence : le build OCCT est **LGPL-2.1** (avec l'exception Open CASCADE, qui ne porte que sur l'inclusion de fichiers d'en-tête) → le livrer comme module wasm séparé, remplaçable, non modifié (ou publier les modifications) ; compatible avec un produit propriétaire à condition de respecter ces obligations (point à faire valider — confiance moyen). **Remarque du vérificateur** : contrairement à un SaaS purement serveur, le wasm est **téléchargé et exécuté sur le poste de l'utilisateur**. C'est vraisemblablement une « distribution » au sens de la LGPL, qui déclenche donc ses obligations : notice, texte de licence, accès au code source correspondant du build, possibilité de remplacer le module. C'est une analyse, pas un avis juridique ⚠️.
4. **À écarter** : CGAL wasm (ports non officiels et inactifs, absence de modes d'arrondi en wasm dont l'effet sur les prédicats exacts n'est pas vérifié, gels observés et attribués à un débordement de pile [39]) ; JSCAD (pas de STEP, CSG polygonal moins robuste que manifold) ; opencascade.js direct (non maintenu) ; chili3d (AGPL) ; Fornjot (archivé).

### 4.2 Rendu 3D

**Recommandation : three.js + react-three-fiber (+ drei), rendu WebGL 2 par défaut, WebGPU en option progressive ; textures CC0 Poly Haven / ambientCG ; three-gpu-pathtracer pour les visuels commerciaux.**

Arguments :
- **Taille** : ~0,19 Mo gzip pour three.js (`three.module.min.js` + `three.core.min.js`, remesuré : 89,8 + 104,1 ko) contre ~1,85 Mo pour le bundle UMD Babylon complet (`babylon.js`, remesuré : 1,85 Mo gzip, 1,28 Mo brotli) [§2.1]. La comparaison est défavorable à Babylon : un build ES tree-shaké de `@babylonjs/core` serait plus léger, et l'écart réel n'a pas été mesuré (⚠️). Le critère reste important pour un configurateur embarquable sur le site d'un fabricant.
- **Écosystème** : le plus grand (≈ 116 k étoiles), releases mensuelles, **replicad fournit un paquet d'intégration three.js** (`replicad-threejs-helper`), That Open (IFC) est bâti sur three.js, manifold exporte en glTF [33][38].
- **React** : r3f permet de lier déclarativement le modèle paramétrique (état) à la scène ; attention à la contrainte de version React 19.x [33].
- **WebGPU** : disponible par défaut dans Chrome, Edge, Safari 26 et Firefox (141 sous Windows, 145 sous macOS 26 Apple Silicon) [35][58], avec repli automatique WebGL 2 dans three.js. Le manuel three.js indique toutefois : « The renderer itself is still in an experimental state » [34] (élevé, vérifié) → rester en WebGL 2 pour le MVP, n'utiliser que des matériaux standard (`MeshStandardMaterial`/`MeshPhysicalMaterial`) pour faciliter une migration WebGPU/TSL ultérieure.
- **Alternative crédible** : Babylon.js (Apache-2.0, très actif) si l'équipe préfère un moteur « tout intégré » (inspecteur, GUI) ; pénalité de poids et intégrations CAO/BIM moins nombreuses.

### 4.3 Exports (résumé)
- DXF : **@tarikjabiri/dxf** (MIT, actif, cotations incluses) — vérifier auprès des sous-traitants l'acceptation de l'AC1021/2007 ; prévoir un écrivain R12/2000 minimal, puisque deux sources sur quatre donnant une version recommandent R12/2000 [§3.1].
- PDF : projection HLR (replicad) ou tracé 2D métier → SVG → **jsPDF + svg2pdf.js**.
- IFC : **web-ifc** (MPL-2.0, 0,44 Mo brotli, écriture IFC4X3) plutôt qu'IfcOpenShell/Pyodide (runtime Python lourd) [§2.4].
- Tableurs : CSV natif + **exceljs** (MIT ; dernière version 4.4.0 d'octobre 2023, dernier push GitHub en janvier 2025 : maintenance faible, à surveiller) ; éviter le paquet npm `xlsx` (figé et vulnérable) [41][54].

---

## 5. Points incertains et questions ouvertes

1. **Prix des concurrents** : la seule comparaison chiffrée multi-éditeurs date de **2018** [13] ; prix actuels publics seulement pour StairDesigner (Powell CNC, en £) [9]. Confiance faible sur les prix 2026.
2. **SEMA, Palette CAD, Staircon** : leurs pages officielles n'ont pas pu être lues en détail (contenu minimal ou 403) ; informations issues de presse spécialisée [10][14][24].
3. **Version DXF** exigée par les ateliers : sources contradictoires (R12/2000 vs R14/2007 vs R2010/2013) [44][45][55][56] ; dxfjs n'écrit que 2007 → à tester avec des découpeurs réels.
4. ~~**Protocole STEP** produit par replicad : non vérifié.~~ **Résolu** : AP242 (valeur `write.step.schema = 5`, « AP242DIS ») [33][53]. Reste à vérifier : la tolérance des logiciels de pliage et de FAO des sous-traitants à un en-tête AP242 « DIS ».
5. **Obligations LGPL** du wasm OCCT dans un SaaS propriétaire : lecture juridique à faire. Point à noter : le wasm est exécuté côté client, ce qui en fait probablement une distribution (voir §4.1).
6. **Taille du wasm replicad** : 4,8 Mo brotli mesurés sur le build complet ; un build réduit (symboles limités) est possible mais son gain n'a pas été mesuré.
7. **Conventions de calques DXF des FAO bois** (woodWOP, Xilog, bSolid…) : non documentées publiquement → à recueillir auprès d'utilisateurs pilotes.
8. **Développés de tôle** : aucune bibliothèque web identifiée ; implémentation analytique propre à prévoir (lien axe B).

---

## Sources

Toutes consultées le **2026-09-28**.

1. Atelier Bois — « Tutoriel StairDesigner conception de base » — https://atelierbois.net/centre-assistance/stairdesigner-conception-de-base/
2. Atelier Bois — « StairDesigner | Logiciel Stair Designer » — https://atelierbois.net/logiciel-stairdesigner/
3. Atelier Bois — « Télécharger StairDesigner version gratuite » — https://atelierbois.net/telechargement-stairdesigner/
4. Staircon (Elecosoft) — « Staircon Online Designer » — https://www.staircon.com/product/staircon-online-designer
5. Compass Software — « Stair Design Software » — https://www.compass-software.de/us/stair-manufacturing/design
6. Compass Software — « Planning stairs online (staircase configurator) » — https://www.compass-software.de/en/stair-manufacturing/staircase-configurator
7. StairBiz — « The Intelligent Stair Software » — https://www.stairbiz.com/
8. Boole & Partners — « StairDesigner – Logiciel de conception d'escaliers sur mesure » — https://boole.eu/fr/stairdesigner.php
9. Powell CNC (revendeur) — « StairDesigner Pro PP » (prix) — https://shop.powellcnc.com/stairdesigner-pro-pp
10. Woodworking Network — « Staircon software aids design and production of staircases » (extrait de moteur de recherche ; page en 403) — https://www.woodworkingnetwork.com/wms/wms-products/staircon-software-aids-design-and-production-staircases
11. Staircon — « CAD/CAM software for design and production of stairs » — https://www.staircon.com/product
12. StairBiz — « The Modules » — https://stair.biz/modules
13. BM (Fachzeitschrift Tischler/Schreiner), M. Behaneck — « BM-Marktübersicht: Treppen-CAD-Programme — Die Treppenplaner », BM 11/2018, p. 86-91 (tableau comparatif, données éditeurs, octobre 2018) — https://www.bm-online.de/wp-content/uploads/M/U/MU_TreppenCAD_BM1118_B381764A-278E-41B1-AB1F-D70E6101B5D51.pdf
14. woodworker.de — forum « Treppenbausoftware » (avis utilisateurs, Palette CAD) — https://www.woodworker.de/forum/threads/treppenbausoftware.134742/
15. Eleco — « Staircon® – Staircase Design Software » — https://eleco.com/products/staircon/
16. StairBox — « Interactive Staircase Design Tool | StairBuilder » — https://www.stairbox.com/stairbuilder
17. Mon Escalier Métal — page d'accueil / configurateur — https://www.mon-escalier-metal.com/
18. Escaliers Échelle Européenne — « ESCA studio » — https://www.escaliers-echelle-europeenne.com/pages/esca-studio-votre-configurateur-3d-descalier-sur-mesure ; Escamétal — https://www.escametal.fr/ ; Renaud Créations — https://www.renaudcreations.fr/escalier-colimacon-sur-mesure-configurateur-3d/
19. Usinages.com / L'Air du Bois — discussions utilisateurs StairDesigner — https://www.lairdubois.fr/logiciels/13-stairdesigner.html ; https://usinages.com/threads/qui-sy-connait-en-escalier-metal-upn-ipn.71676/page-2
20. cadwork — « Cadwork Escalier – Le paramétrique, mais pas seulement » — https://www.04.cadwork.com/escalier-module-cadwork/
21. cadwork — « Escalier » — https://www.04.cadwork.com/escalier/
22. TopSolid — aide en ligne 7.17 « Épure d'escalier » — https://help.topsolid.com/7.17/fr/TopSolid'Design/TopSolid/Cad/Design/UI/buildings/MultiFlightStaircase/Draft/multiflightstaircasedraftcommand.htm
23. TopSolid — Nouveautés 7.19 « Épure d'escalier » / « Bâtiment » — https://help.topsolid.com/7.19/fr/Nouveaut%C3%A9s/main/fr/WN/2025/7.19/sections/design/staircase_layout.html
24. BM online / dds / treppen.de — articles sur SEMA Treppe — https://www.bm-online.de/messespezial-holz-handwerk-2020/sema-treppe-eine-software-fuer-alle-bereiche/ ; https://www.treppen.de/blog-details/sema-treppenbausoftware
25. TENADO — « TENADO TREPPE » — https://tenado.de/de/tenado-treppe/
26. TENADO — « ADD ONs für TENADO METALL 2D » — https://tenado.de/en/produkte/tenado-metall/tenado-metall-2d/add-on/
27. Métalusoft — « Logiciel professionnel de conception d'escaliers 3D – MétalCad » — https://www.metalusoft.fr/nos-logiciels/metalcad/escaliers/ ; « Configurateur escalier » — https://www.metalusoft.fr/configurateur-escalier/
28. Métalusoft — « Logiciel Calcul Escalier » — https://www.metalusoft.fr/logiciel-calcul-escalier/
29. Trimble — Tekla Structures 2026 « Stairs, handrails and ladders » — https://support.tekla.com/doc/tekla-structures/2026/com_steel_stairs
30. Trimble — Tekla Structures 2026 « Stairs (S71) » — https://support.tekla.com/doc/tekla-structures/2026/macro_s71_help
31. Trimble — Tekla Structures 2026 « NC files » — https://support.tekla.com/doc/tekla-structures/2026/int_create_nc_files
32. Go Measure 4 me in 3D — « Spiral Stairs in Advance Steel Complete Guide » / « Stairs in Advance Steel » — https://gomeasure4me.com/spiral-stairs-in-advance-steel-complete-guide/ ; GRAITEC PowerPack — https://graitec.com/uk/resources/technical-support/documentation/powerpack-for-advance-steel-technical-articles/stairs/
33. Mesures directes : registre npm (https://registry.npmjs.org/<paquet>), API GitHub (https://api.github.com/repos/<dépôt>), CDN jsDelivr (https://data.jsdelivr.com/v1/packages/npm/<paquet>) ; code source replicad (https://github.com/sgenoud/replicad, fichiers `packages/replicad/src/shapes.ts`, `export/assemblyExporter.ts`, `projection/makeProjectedEdges.ts`, `replicad-opencascadejs/package.json`) ; définitions TypeScript web-ifc 0.0.78 (`web-ifc-api.d.ts`) et @tarikjabiri/dxf 2.9.0 (`lib/index.d.ts`).
34. three.js — « WebGPURenderer » (manuel) — https://threejs.org/manual/#en/webgpurenderer (source : https://github.com/mrdoob/three.js/blob/dev/manual/pages/webgpurenderer.html ; l'URL d'origine `threejs.org/manual/en/webgpurenderer.html` renvoie une 404, corrigée)
35. Utsubo — « Migrate Three.js to WebGPU (2026) » — https://www.utsubo.com/blog/webgpu-threejs-migration-guide
36. Poly Haven — « License » — https://polyhaven.com/license
37. ambientCG — « License » — https://docs.ambientcg.com/license/
38. manifold (E. Alish et al.) — dépôt GitHub / README — https://github.com/elalish/manifold
39. Ports CGAL wasm : https://github.com/ademola-lou/CGALWebAssembly ; https://github.com/LokiResearch/arrangement-2d-js ; emscripten issue #21580 « CGAL freezes on boolean operations » — https://github.com/emscripten-core/emscripten/issues/21580
40. Open Cascade — « Open CASCADE Technology 8.0.0 Release » — https://dev.opencascade.org/content/open-cascade-technology-800-release ; OCCT3D — https://occt3d.com/performance-stability-long-term-vision-occt-8-0-0-arriving-q1-2026/
41. SheetJS — « NodeJS installation » (npm obsolète, CDN officiel) — https://docs.sheetjs.com/docs/getting-started/installation/nodejs/ ; avis GitLab CVE-2023-30533 — https://advisories.gitlab.com/pkg/npm/xlsx/CVE-2023-30533/
42. IfcOpenShell — « wasm-wheels » — https://github.com/IfcOpenShell/wasm-wheels
43. Opening BIM — « How to create a basic wall using IfcOpenShell WebAssembly » — https://openingbim.org/posts/ifcopenshell_wasm_simple_wall/
44. Recommandations DXF découpe laser (pages relues le 2026-09-28 ; seule l'ENSA cite une version DXF) : SECMI — https://www.secmi-sa.com/preparer-un-fichier-dxf/ ; ENSA Paris-Belleville — https://www.paris-belleville.archi.fr/app/uploads/2019/08/Pre%CC%81paration-Fichiers-de%CC%81coupe-laser.pdf ; Tole Factory — https://tolefactory.com/guidelines/
45. AICC Laser — « Fichiers DXF/STEP : bien préparer sa découpe laser » — https://aicclaser.com/blog/guide-preparation-fichiers-dxf-step
46. ISO — « ISO 16739-1:2024 Industry Foundation Classes (IFC) — Part 1: Data schema » — https://www.iso.org/standard/84123.html
47. buildingSMART International — « IFC 4.3 APPROVED as a Final Standard » — https://www.buildingsmart.org/ifc-4-3-approved-as-a-final-standard/
48. buildingSMART — dépôt IFC4.3.x-development, `IfcStairFlight.md`, `IfcStairTypeEnum.md`, `IfcStairFlightTypeEnum.md` — https://github.com/buildingSMART/IFC4.3.x-development/tree/master/docs/schemas/shared/IfcSharedBldgElements
49. IfcOpenShell — gabarits de property sets IFC4X3 (`Pset_IFC4X3.ifc`, Pset_StairFlightCommon) — https://github.com/IfcOpenShell/IfcOpenShell/blob/v0.8.0/src/ifcopenshell-python/ifcopenshell/util/schema/Pset_IFC4X3.ifc
50. design2machine — « BTLx » (versions, schéma XSD) — https://www.design2machine.com/btlx/index.html ; BTLx 2.1 — https://www.design2machine.com/btlx/BTLx_2_1_0.pdf
51. Klietsch GmbH — « DSTV NC Data / NC1 Data – general information » — https://klietsch.com/?m=page&action=240827&lang=en
52. Trimble — « Spiral staircase » (extension Tekla Warehouse, v2.6) — https://support.tekla.com/help/tekla-structures/not-version-specific/spiral_staircase_2_1
53. Open Cascade — « STEP Translator » (guide utilisateur, paramètre `write.step.schema` : 1 AP214CD par défaut … 5 AP242DIS) — https://occt3d.com/dev/doc/overview/html/occt_user_guides__step.html ; notes de version V8_0_0 et V8.0.1 — https://github.com/Open-Cascade-SAS/OCCT/releases
54. OSV / GitHub Advisory — GHSA-4r6h-8v6p-xvw6 (CVE-2023-30533) et GHSA-5pgg-2g8v-p4x9 (CVE-2024-22363) — https://osv.dev/vulnerability/GHSA-4r6h-8v6p-xvw6 ; https://osv.dev/vulnerability/GHSA-5pgg-2g8v-p4x9
55. L'Atelier du Laser (Drôme) — « Fichier DXF pour découpe laser » (24/02/2026) — https://latelierdulaser.fr/2026/02/24/fichier-dxf-pour-decoupe-laser/
56. CutOptim — « Exporter un plan de découpe vers une CNC : DXF et G-code » — https://cutoptim.com/fr/guides/comment-exporter-plan-decoupe-cnc
57. BibLus (ACCA software) — « IFC 4.3 Standard Approved as Final » (12/01/2024) — https://biblus.accasoftware.com/en/ifc-4-3-standard/
58. GPU for the Web — « Implementation Status » (wiki) — https://github.com/gpuweb/gpuweb/wiki/Implementation-Status ; mdn/browser-compat-data issue #28555 (Firefox 145, macOS 26 Apple Silicon) — https://github.com/mdn/browser-compat-data/issues/28555

---

## Journal de vérification

Vérification menée le 2026-09-28 par un second agent, relecteur sceptique. Méthode : nouvelle interrogation directe du registre npm, de l'API GitHub et de jsDelivr ; nouveau téléchargement et nouvelle compression des wasm et des bundles (`gzip -9`, `brotli`) ; lecture du code source de replicad (clone du dépôt), des définitions TypeScript de web-ifc et @tarikjabiri/dxf, du dépôt buildingSMART IFC4.3.x et du gabarit Pset d'IfcOpenShell ; extraction du texte du PDF BM 11/2018 ; relecture des pages éditeurs et sous-traitants citées.

**Rappel de nature** : cet axe ne contient **aucune règle dimensionnelle bloquante** (ce sont les axes A et C qui en portent). Les seuls éléments normatifs sont les formats (ISO 16739-1, ISO 10303, BTLx, DSTV-NC). Il n'y a ni formule ni pseudo-code à contrôler mathématiquement. Les seuls calculs sont des sommes de tailles, recontrôlées : 89,8 + 104,1 ko ≈ 0,19 Mo ✔.

### Confirmé sans changement (élevé)
- Versions, dates, licences npm de three 0.186.1, @react-three/fiber 9.8.1 (peer React ≥ 19 < 19.4, three ≥ 0.156), babylonjs 9.28.0, replicad et replicad-opencascadejs 1.1.0 (MIT / LGPL-2.1-only), manifold-3d 3.5.4, @jscad/modeling 2.13.0, opencascade.js (1.1.1 de 2020, beta du 23/03/2023, dernier push le 15/08/2023), @tarikjabiri/dxf 2.9.0, dxf-writer 1.18.4, makerjs 0.19.2, dxf-parser 1.1.2, jspdf 4.2.1, svg2pdf.js 2.8.1, pdfmake 0.3.11, pdf-lib 1.17.1, exceljs 4.4.0, xlsx 0.18.5, opentype.js 2.0.0, web-ifc 0.0.78 (MPL-2.0), three-bvh-csg 0.0.18, @thatopen 3.4.x.
- Activité GitHub : three.js ≈ 116 k étoiles ; chili3d en AGPL-3.0 ; Fornjot archivé ; truck en Apache-2.0.
- Tailles remesurées à l'octet près : replicad_single.wasm 22 980 267 o (7,21 Mo gzip, 4,84 Mo brotli) ; manifold.wasm 541 470 o (0,20 / 0,16 Mo) ; web-ifc.wasm 1 595 268 o (0,57 / 0,44 Mo) ; @jscad/modeling 59 ko gzip.
- API de web-ifc : `CreateModel`, `CreateIfcEntity`, `WriteLine(s)`, `SaveModel`, `StreamAllMeshes`, `GetFlatMesh` ; schémas IFC2X3, IFC4, IFC4X3. API de replicad : `blobSTEP`, `exportSTEP`, `blobSTL`, `toSVG`, `drawProjection` (HLRBRep_Algo), `MakePipeShell`, `ThruSections`.
- @tarikjabiri/dxf : `$ACADVER` fixé à AC1021 ; cotations alignée, linéaire, angulaire, radiale, diamètre et arc.
- IFC 4.3 : liste complète de `IfcStairTypeEnum` (17 valeurs) et de `IfcStairFlightTypeEnum` (7 valeurs) ; attributs dépréciés depuis IFC4 ; phrase « A winder is also regarded a part of a stair flight » ; les 12 propriétés de `Pset_StairFlightCommon`.
- BM 11/2018 : prix de Compass (dès 2 800 €), Staircon Limited (2 630 €), SEMA (2 980 €, Stahltreppe et Spindeltreppe à 990 €, CAD/CAM 3 190 €), TENADO (595 €), TrepCAD (980 €), AICADstair (4 500 €), cadwork (9 000 € + Treppe 2 500 €), StairDesigner (1 750 € / 3 450 €) ; interfaces (IFC chez Compass, Staircon et SEMA ; BTL, DSTV-NC et DXF chez cadwork) ; pas de CNC directe chez TENADO.
- Prix Powell CNC (2 245 £ et 4 145 £ HT) ; licences CC0 de Poly Haven et ambientCG ; doc TopSolid ; pages cadwork, MétalCad, Compass (configurateur) ; règles DFM d'AICC Laser (trou ≥ épaisseur, écart ≥ 1 × épaisseur, rayon ≥ 0,5 × épaisseur : **usage de métier d'un seul sous-traitant**, non normatif).
- OCCT 8.0.0 publié le 07/05/2026, avec C++17 minimum, BRepGraph et des fichiers STEP ≈ 20 % plus petits ; exception LGPL Open CASCADE.

### Corrigé
1. **STEP** : l'AP n'était « pas vérifié » ; c'est désormais **résolu**, replicad écrivant de l'**AP242 (DIS)** via `write.step.schema = 5` [53].
2. **replicad** s'appuie précisément sur **OCCT 8.0.1** (et non « OCCT 8 » sans précision) ; ajout d'OCCT 8.0.1 (30/07/2026).
3. **OCCT « +75 % en lecture STEP »** : chiffre absent des notes de version officielles, requalifié en communication commerciale OCCT3D (moyen).
4. **Tekla** : « aucun hélicoïdal » était faux hors composants standard ; une **extension officielle *Spiral staircase*** existe [52], mais sa doc ne couvre que Tekla 2017i à 2020. Aucune extension pour escaliers balancés n'a été trouvée.
5. **CGAL wasm** : la cause du gel dans l'issue #21580 est un **débordement de pile**, pas les modes d'arrondi ; le lien entre modes d'arrondi et prédicats exacts est marqué ⚠️ non vérifié.
6. **manifold-3d** : pas d'écrivain 3MF ou glTF natif ; le README *recommande* ces formats (E/S glTF via un exemple).
7. **SheetJS** : deux CVE distinctes (CVE-2023-30533, pollution de prototype en lecture ≤ 0.19.2 ; CVE-2024-22363, ReDoS < 0.20.2) [54].
8. **DXF** : attributions des versions corrigées. Les pages SECMI et Tole Factory ne donnent aucune version ; « R14 ou 2007 » vient de CutOptim [56] ; R12/2000 vient de l'ENSA [44] et de L'Atelier du Laser [55].
9. **BTLx** : ajout des schémas 1.0 (2020) et 2.0 (2021) ; la documentation courante est celle de la 2.3 (08/07/2025).
10. **IFC** : signalement de l'incohérence `NumberOfRiser` / `NumberOfRisers` ; ajout de `IfcMemberTypeEnum.STRINGER`.
11. **BM 2018** : nuance sur la fourchette 600–6 000 €, dont le tableau lui-même sort (490 € ; cadwork > 11 000 €). « Hors formation et maintenance » est reformulé : ces postes sont chiffrés à part dans le tableau.
12. **StairBox** : plan CAO « sous 24 h après la commande » ; la page ne cite pas l'Approved Document K.
13. **TopSolid** : reliquats « sur les paliers ou marches extrêmes » ; palier « standard ou fractionné ».
14. **three.js** : URL de la source [34] corrigée (404) ; citation exacte du statut « experimental » ; versions de Firefox précisées [58].
15. **Babylon** : la comparaison de taille porte sur le bundle UMD complet et non tree-shaké, ce qui la biaise.
16. **LGPL** : ajout d'une remarque, le wasm servi au navigateur constituant probablement une distribution.

### Non vérifiable (conservé, marqué ou laissé en confiance moyen/faible)
- Page ISO 16739-1:2024 (403) : mois de publication non confirmé en source primaire.
- Pages buildingSMART (403) : date du 04/01/2024 confirmée par une source secondaire (BibLus) [57].
- « Staircon développé en Suède » : absent de la page Eleco (qui confirme 1999) → ⚠️.
- Compatibilité de l'extension Tekla *Spiral staircase* avec Tekla 2026.
- SEMA, Palette CAD, page Woodworking Network sur Staircon : non relues, comme l'indiquait déjà l'auteur.
- Prix 2026 des concurrents, hors StairDesigner.
- Pages Atelier Bois / Boole (StairDesigner), StairBiz, TENADO, Advance Steel, Mon Escalier Métal : non relues par le vérificateur (confiance moyen conservée).
