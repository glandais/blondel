# Blondel — Spécification fonctionnelle (synthèse de la recherche)

> Logiciel web de conception paramétrique d'escaliers (bois, métal, mixte) : vue 3D texturée, plan 2D coté, développés de fabrication, nomenclature, chiffrage, conformité.
> Document de synthèse du prompt `docs/prompts/01-recherche.md`, entrée du prompt `docs/prompts/02-conception-dev.md`. Rédigé le 2026-09-28.
> **Ce document ne recopie pas la recherche : il renvoie aux fichiers qui font foi.**

| Fichier                                                      | Contenu                                                                                                   | Rôle pour le développement                                   |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [`research/A-regles.md`](research/A-regles.md)               | Règles de dimensionnement, textes en vigueur, Eurocodes                                                   | Source des règles de conformité                              |
| [`research/rules.yaml`](research/rules.yaml)                 | 98 règles machine-lisibles (id, formule, min/max, contexte, nature, source, confiance, sévérité)          | Alimente directement le moteur de règles                     |
| [`research/B-geometrie.md`](research/B-geometrie.md)         | Typologies, ligne de foulée, 8 méthodes de balancement (M0–M7), limons, mains courantes, limon débillardé | Algorithmes du cœur (`packages/core`, `packages/geometry`)   |
| [`research/C-structures.md`](research/C-structures.md)       | Structures bois et métal, garde-corps, contraintes de fabrication, coûts                                  | Plugins `StructureKind`, tables de capacités, modèle de coût |
| [`research/D-etat-de-l-art.md`](research/D-etat-de-l-art.md) | Concurrents, bibliothèques web, formats d'échange                                                         | Entrées des ADR du jalon 0                                   |

Chaque fichier contient un **journal de vérification** (relecture sceptique par un second agent) et ses **sources** (consultées le 2026-09-28). Les renvois de ce document prennent la forme **[A §1.3]**, **[B §3.5]**, etc. Les rares sources nouvelles utilisées ici pour trancher une contradiction sont listées en fin de fichier ([S1], [S2]).

---

## 0. Conventions communes

### 0.1 Nature des exigences (à conserver dans le modèle de données)

| Étiquette         | Sens                                                                                    | Force                                                               |
| ----------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **réglementaire** | CCH, arrêtés accessibilité, règlement de sécurité ERP                                   | Obligatoire dans son champ                                          |
| **normatif**      | NF DTU, NF, EN, ISO, Eurocodes + annexes nationales                                     | Volontaire, rendu obligatoire par le marché ou l'assurance [A §0.1] |
| **métier**        | Règles de l'art, usages d'atelier, pratiques de fabricants, capacités machines          | Recommandation                                                      |
| **analyse**       | Dérivation mathématique ou algorithme proposé pour Blondel, non trouvé dans les sources | À valider par tests et par un professionnel [B §0.1]                |

### 0.2 Confiance et sévérité

- Confiance : **élevé** (texte primaire ou guide citant l'article), **moyen** (source secondaire sérieuse), **faible** (source commerciale isolée, divergente, interprétation) [A §0.2].
- Sévérité : **bloquant** / **avertissement** / **conseil** [A §4].
- Règle de gestion : une règle `bloquant` de confiance `faible` doit pouvoir être **rétrogradée par l'utilisateur**, avec trace dans le rapport de conformité [A §4].

### 0.3 Normes payantes non lues (limite majeure de la recherche)

NF DTU 36.3 (P1-1, P1-2, P3), NF P01-012:2024, NF P01-013:2024, NF EN 1995-1-1/NA, NF EN 1993-1-1/NA, NF EN 1090-2, NF EN 14080, NF EN ISO 14122-3, NF E85-015, DIN 18065. Les valeurs correspondantes viennent de sources secondaires identifiées (AFEB, FCBA, UICB, APAVE, CNC2M, fabricants) [A §0.3] [C §0.1]. Tout ce qui dépend de ces textes est marqué ⚠️ dans les fichiers de recherche.

---

## 1. Vision et parcours (rappel)

Voir `02-conception-dev.md` §1–3. La recherche confirme le créneau : **aucun concurrent n'est une application web de conception professionnelle** ; les outils web existants sont des configurateurs de vente, et seul Compass relie configurateur et production via un serveur [D §1.3]. Les logiciels de poste sont spécialisés bois ; le métal (profilés, tôles, débillardé soudé) est peu ou mal traité [D §1.5].

Enseignements de parcours à reprendre [D §1.2, §1.3] :

- initialisation par **modèle de forme** + saisie des cotes, _ou_ par **trémie / murs / plan** (Compass, Staircon) — Blondel fait les deux via l'assistant ;
- séparation **épure** (tracé, répartition des marches, indépendante de la structure) / **constituants** (pièces générées depuis l'épure) : modèle TopSolid, cohérent avec le pipeline Site → Tracé → Découpage → Structure ;
- modes de répartition « même hauteur » / « même marche » avec contraintes min / max / cible (TopSolid) ;
- balancement automatique + **retouche graphique en plan** (cadwork, StairDesigner) ; profil de limon en **élévation** ;
- contrôle réglementaire **en temps réel** + prix instantané (standard côté vente) ;
- chiffrage calculé pendant la conception (StairBiz).

---

## 2. Synthèse fonctionnelle priorisée

### 2.1 Définition des niveaux (alignés sur les jalons du prompt 2)

| Niveau  | Jalons                                                               | Objectif                                                                                                                                                                       |
| ------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **MVP** | 0 à 4 + exports essentiels (PDF, DXF, CSV) avancés depuis le jalon 6 | Satisfaire les critères d'acceptation n° 1 (quart tournant bois conçu en < 2 min, conforme, exporté PDF + DXF) et n° 3 (DXF de limon et de tôle pliée exploitables en atelier) |
| **V1**  | 5 et 6                                                               | Débillardé, hélicoïdal, multi-volées, comparateur de coûts (critère n° 2), rendu PBR, glTF, STEP                                                                               |
| **V2**  | 7 et au-delà                                                         | Import de plan, IFC, formats CNC métier, optimisation du balancement, typologies hors DTU                                                                                      |

**Remarque de priorisation** : le prompt 2 place tous les exports au jalon 6, alors que les critères d'acceptation n° 1 et n° 3 exigent PDF et DXF dès le quart tournant bois et la tôle pliée. **Recommandation** : un export DXF 1:1 par pièce et un PDF coté minimal dès les jalons 1 et 3 ; le jalon 6 garde l'habillage (cartouches, multi-pages 1:1, impression, glTF, STEP).

### 2.2 Site et assistant

| Fonction                                                                                                                                          | Niveau        | Jalon | Références                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----- | ------------------------------------------------------ |
| Hauteur à monter sol fini à sol fini, épaisseurs de revêtement, épaisseur de plancher                                                             | MVP           | 1     | [A §1.3, §1.7]                                         |
| Trémie rectangulaire, puis polygonale                                                                                                             | MVP           | 1 → 2 | [A §1.7]                                               |
| Tolérances de gros œuvre affichées (trémie [0 ; +7 mm], hauteur ± 7 mm jusqu'à 3 m)                                                               | MVP (conseil) | 1     | `TREMIE_TOLERANCE`, `HAUTEUR_ETAGE_TOLERANCE` [A §1.7] |
| Murs porteurs / non porteurs (conditionne porte-à-faux et fixations)                                                                              | MVP           | 2     | [C §1.8, §2.7]                                         |
| Obstacles (poteaux, fenêtres, portes)                                                                                                             | V1            | 5     | [D §1.2 Compass]                                       |
| Assistant : typologies compatibles classées par score de confort (Blondel, régularité, échappée)                                                  | MVP           | 1 → 2 | [A §1.2 classes h/g] [B §1.1]                          |
| Profil de conformité du projet (contextes cumulables, voir §3.1) + **date de dépôt PC/DP ou de marché** (choix du régime garde-corps 1988 / 2024) | MVP           | 1     | [A §3.2] [C §3.1]                                      |
| Import DXF de plan de masse, image calibrée, tracé assisté trémie / murs                                                                          | V2            | 7     | [D §2.3 dxf-parser]                                    |

### 2.3 Tracé et découpage des marches

| Fonction                                                                                                                           | Niveau                                | Jalon | Références                                             |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----- | ------------------------------------------------------ |
| Escalier droit, calcul `n = arrondi(H / h_cible)`, `h = H / n`, reculement `R = (n − 1)·g`                                         | MVP                                   | 1     | [A §1.3, §1.8]                                         |
| Hauteur de première marche distincte (compensation de revêtement), tolérance +10 / −30 mm                                          | MVP                                   | 1     | `H_PREMIERE_MARCHE_TOL` [A §1.3]                       |
| Échappée calculée **point par point en 3D** sur la ligne de foulée (pas seulement la formule de trémie)                            | MVP                                   | 1     | [A §1.7]                                               |
| Quart tournant bas / haut / médian, deux quarts (U, S), demi-tournant, paliers                                                     | MVP                                   | 2     | [B §1.1, §3.11]                                        |
| Raccords de jour : angle vif, poteau, arc, pan coupé ; bords modélisés en courbes composées (segments, arcs, clothoïdes en option) | MVP (sans clothoïde) / V1 (clothoïde) | 2 / 5 | [B §1.2, §5.3]                                         |
| **Ligne de foulée de conception** calculée par décalage du bord intérieur (`d_f = E/2` si E ≤ 1,20 m, sinon 0,60 m), modifiable    | MVP                                   | 2     | [A §1.6] [B §2.1]                                      |
| **Lignes de mesure réglementaires** indépendantes de la ligne de conception (DTU, accessibilité, ERP à 0,60 m du noyau)            | MVP                                   | 2     | [B §2.2]                                               |
| Collet mesuré en longueur d'arc (fabrication) et en corde (conformité)                                                             | MVP                                   | 2     | [B §2.3]                                               |
| Interface `BalancingStrategy` ; **au moins 2 algorithmes** : M3 (développement du limon, défaut) et M1 (progression arithmétique)  | MVP                                   | 2     | [B §3.3, §3.5, §3.12]                                  |
| M2 herse (option pédagogique, α borné à `]0, arccos(L_c/(m·g))[`)                                                                  | V1                                    | 5     | [B §3.4] — voir question ouverte Q9                    |
| Choix automatique du nombre de marches balancées (formule du collet minimal de la variante retenue)                                | MVP                                   | 2     | [B §3.5]                                               |
| Marches fixes (première, dernière, palière, sous trémie) et pivot d'une marche pour gagner de l'échappée                           | MVP                                   | 2     | [B §3.1 K8]                                            |
| Édition directe des points de la ligne de foulée et des lignes de nez en plan (mode expert)                                        | MVP                                   | 2     | [D §1.3]                                               |
| M6 rotation paramétrée (deux curseurs)                                                                                             | V1                                    | 5     | [B §3.8]                                               |
| M7 optimisation sous contraintes (SQP / Lagrangien augmenté)                                                                       | V2                                    | —     | [B §3.9]                                               |
| M5 (brevet US6845595, échu en 2013 aux États-Unis)                                                                                 | V2                                    | —     | [B §3.7]                                               |
| Hélicoïdal : fût central, à jour, sur limon central                                                                                | V1                                    | 5     | [B §1.1, §4.3]                                         |
| Multi-volées hétérogènes (jusqu'à 7 volées chez StairDesigner)                                                                     | V1                                    | 5     | [B §1.1]                                               |
| Pas japonais / gain de place, échelle de meunier                                                                                   | V2                                    | —     | [A §1.10] ; bloqués par l'annexe A du DTU non lue (Q1) |

**Invariants à tester par propriétés** (fast-check) [B §3.1] : somme des hauteurs = H ; girons **exactement égaux** sur la ligne de foulée (la tolérance ± 5 / ± 10 mm est une tolérance de réception, pas une marge de conception, [B §2.1]) ; lignes de nez sans croisement entre les deux bords (K5) ; collets décroissants ou constants vers l'angle (K3) ; échappée ≥ minimum du contexte ; monotonie de la courbe F de M3.

### 2.4 Structures (plugins `StructureKind`)

| Solution                                                                                        | Niveau        | Jalon | Points clés                                                                                                                               | Références                                  |
| ----------------------------------------------------------------------------------------------- | ------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Bois, limon à la française (marches encastrées)                                                 | MVP           | 3     | limon ≥ 29 mm (règles de moyens), domaine des règles de moyens : ≤ 1 étage, E ≤ 1,20 m ; mortaises étirées en `1/sin β` sur les balancées | [C §1.4] [B §4.1] `LIMON_EPAISSEUR_MIN_DTU` |
| Bois, limon à l'anglaise (crémaillère)                                                          | MVP           | 3     | tableau FCBA épaisseur / reste sous entaille ; × 2 pour une crémaillère centrale                                                          | [C §1.4] `CREMAILLERE_REGLE_MOYENS`         |
| Métal, limon en plat découpé laser                                                              | MVP           | 3     | développé = bande rectiligne en droit                                                                                                     | [C §2.2]                                    |
| Métal, limon en profilé du commerce **UPN / IPN / IPE / HEA** (catalogue de sections)           | MVP           | 3     | barres de 6 / 12 m ; rayons de cintrage mini par sens (UPN : 500 / 650 / 200 mm) ; exclu en limon de jour à petit rayon                   | [C §2.3]                                    |
| Supports de marche : cornières, platines, consoles, tôle pliée Z / U                            | MVP           | 3     | r_int ≥ t ; bords mini ; capacité presse (ex. 8 mm, 2 980 mm)                                                                             | [C §2.6]                                    |
| Marches en tôle pliée, caillebotis, tôle larmée                                                 | MVP           | 3     | développé avec lignes de pli repérées                                                                                                     | [C §2.6]                                    |
| Mixte : ossature métal + marches bois                                                           | MVP           | 3     | chaîne de tolérances bois (5 mm/m) + soudé (ISO 13920 BF)                                                                                 | [C §2.4]                                    |
| Contremarches (pleines, ajourées, aucune), nez, débord, poteaux                                 | MVP           | 3     | débord nez ERP ≈ 10 mm ; recouvrement 50 mm sans contremarche en ERP                                                                      | [A §1.11]                                   |
| Limon central (bois couches collées, métal caisson / tube)                                      | V1            | 5     |                                                                                                                                           | [C §1.5, §2.5]                              |
| **Limon porteur débillardé** bois (massif par quartiers, lamellé-collé cintré, couches collées) | V1            | 5     | lamellé : k_r = 1 si r_in/t ≥ 240, k_r = 0,76 + 0,001·r_in/t entre 170 et 240, refus sous 170                                             | [B §5] [C §1.6]                             |
| **Limon porteur débillardé soudé** métal (tronçons roulés par quart, soudés bout à bout)        | V1            | 5     | passe en **EXC2** (soudure bout à bout) ; faces de rive non développables                                                                 | [B §5] [C §2.1, §2.4]                       |
| Marches murales en porte-à-faux, escalier suspendu                                              | V1            | 5     | hors règles de moyens : **justification obligatoire** (calcul ou avis fabricant)                                                          | [C §1.8]                                    |
| Fixations murales / dalle                                                                       | MVP (conseil) | 3     | aucune règle chiffrée : renvoi à l'ETE du fabricant de cheville                                                                           | [C §2.7]                                    |

**Exigences transverses structure** :

- **Classe d'exécution EN 1090-2 déduite et affichée** : S235 non soudé bout à bout → EXC1 ; soudure bout à bout, S355 ou formage à chaud → EXC2 [C §2.1].
- **Tables de capacités par atelier / sous-traitant** (cintrage, roulage, pliage, laser, formats de tôle, longueurs de barres) : ce ne sont **pas des constantes** ; les valeurs de C servent de valeurs d'exemple [C §4.1, §6 Q4].
- Évents automatiques sur les corps creux si galvanisation [C §2.8].
- Les critères de flèche et de vibration sont **indicatifs** tant que le DTU P3 (RC 5-2, 5-3) n'est pas lu ; valeurs par défaut EN 16481 : L/200 et f₁ ≥ 5 Hz [C §1.3].

### 2.5 Garde-corps et mains courantes

| Fonction                                                                                                                                              | Niveau                | Jalon | Références                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ----- | ------------------------------------- |
| Garde-corps le long de la volée et autour de la trémie ; déclenchement si hauteur de chute > 1 m                                                      | MVP                   | 4     | `GC_OBLIGATOIRE` [A §3.2]             |
| **Deux régimes** NF P01-012 : 1988 et 2024, choisis par la date de dépôt PC/DP (1/6/2025) ou de marché (1/1/2026)                                     | MVP                   | 4     | [A §3.2] [C §3.1]                     |
| 2024 : h(E) selon l'épaisseur, gabarits T1 / T2 / T3, **gabarit B (appuis 0,10–0,60 m ⇒ H = 1,00 + X)**, discontinuité 0,05 m                         | MVP                   | 4     | [C §3.1] (voir contradictions X5, X6) |
| Remplissages : barreaudage, lisses, câbles (traités comme des lisses + avertissement de détente), verre feuilleté 1B1, tôle perforée, bois            | MVP (sauf verre : V1) | 4     | [C §3.2]                              |
| Main courante : nombre, hauteur 0,80–1,00 m (ERP / BHC), prolongement (1 giron ERP, 1 marche BHC / logement), dégagement mur ≥ 30 / 50 mm, continuité | MVP                   | 4     | [A §1.12] [C §3.3]                    |
| Main courante courbe / hélicoïdale : balayage 3D exact, gabarits d'atelier par système des tangentes (plateau, ellipse, biais)                        | V1                    | 5     | [B §4.3, §4.4]                        |
| Charges horizontales sur garde-corps (tableau 6.12 (NF) modifié A1) : information de dimensionnement                                                  | MVP (information)     | 4     | `CHARGE_GC_HORIZONTALE` (voir X4)     |

### 2.6 Solides, vues et exports

| Fonction                                                                                                                      | Niveau                                        | Jalon | Références          |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----- | ------------------- |
| 3D non texturée (maillage issu de la couche métier)                                                                           | MVP                                           | 1     | [D §4.1]            |
| Plan 2D coté (SVG) : ligne de foulée, numérotation, balancement ; élévations                                                  | MVP                                           | 1 → 2 | [D §3.4]            |
| Développés : limons droits, crémaillères, tôles pliées (lignes de pli, repères)                                               | MVP                                           | 3     | [B §4.1] [C §2.6]   |
| Développés de limon débillardé par tronçon (rives, lignes de roulage, repères, cales de gabarit de soudage, calibres bois)    | V1                                            | 5     | [B §5.4–5.6]        |
| Nomenclature / fiche de débit (masse, surface à traiter, longueur de cordon, nombre de coupes et de plis, nombre de gabarits) | MVP                                           | 3     | [C §5.4]            |
| Rapport de conformité localisé (pièce / marche, 2D et 3D), traçable jusqu'à la source                                         | MVP                                           | 1     | [A §4]              |
| Export **DXF 1:1 par pièce**, mm, contours fermés, splines converties, un calque par fonction                                 | MVP                                           | 1 → 3 | [D §3.1]            |
| Export **PDF coté** (plan, élévations, développés, nomenclature)                                                              | MVP (minimal) / V1 (complet, 1:1 multi-pages) | 1 → 6 | [D §3.4]            |
| Export **CSV** de débit ; XLSX                                                                                                | MVP / V1                                      | 3 / 6 | [D §3.5]            |
| Rendu PBR (bois avec sens du fil par pièce, acier, inox, verre), vue éclatée, coupe, mesure                                   | V1                                            | 6     | [D §2.1]            |
| Export glTF (présentation, RA)                                                                                                | V1                                            | 6     | [D §3.8]            |
| Export STEP AP242 (B-Rep)                                                                                                     | V1                                            | 6     | [D §3.2]            |
| Export IFC 4.3 (`IfcStair` / `IfcStairFlight` / `Pset_StairFlightCommon`)                                                     | V2                                            | —     | [D §3.3] (voir X13) |
| Export DSTV-NC (profilés métal), BTLx (CNC bois)                                                                              | V2                                            | —     | [D §3.6, §3.7]      |

### 2.7 Coûts et comparateur

| Fonction                                                                                                                                                     | Niveau                  | Jalon | Références                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ----- | ------------------------------------- |
| Coût de revient = matière + temps × taux + sous-traitance + finitions + pose + marge ; barèmes **modifiables**                                               | MVP (premier chiffrage) | 3     | [C §5.3]                              |
| Temps d'atelier en **paramètres calibrables par l'atelier** (min / coupe, / pli, / m de cordon, / gabarit), **sans valeur par défaut non sourcée**           | MVP                     | 3     | [C §5.4]                              |
| Comparateur de variantes pour un même tracé (UPN / plat laser / débillardé soudé ; massif / lamellé) : poids, nombre de pièces, pièces uniques, coût         | V1                      | 5     | [C §5.3] ; critère d'acceptation n° 2 |
| Aides à la réduction de coût : sections standard, répétition des collets et des rayons, tronçons à rayon constant, supports identiques, calepinage des tôles | V1                      | 5     | [C §5.4]                              |
| Prix de marché affichés seulement comme **bornes de vraisemblance** (écart × 2 à × 3, HT / TTC mélangés)                                                     | —                       | —     | [C §5.2]                              |

### 2.8 Persistance et transverse

Sans apport particulier de la recherche : JSON versionné validé par zod, migrations, undo/redo, sauvegarde locale, import/export de fichier (MVP) ; lien partageable (V1). Unités : mm entiers en interne, angles en degrés (prompt 2 §3). **Ajout issu de la recherche** : le projet enregistre la **version du jeu de règles** (`rules.yaml`, régime garde-corps, génération d'Eurocode) utilisée pour le rapport, car la seconde génération d'Eurocodes remplacera la première d'ici mars 2028 [A §3.6].

---

## 3. Moteur de conformité

### 3.1 Principes

- Alimenté par `research/rules.yaml` (98 règles, 15 contextes) [A §4].
- Les **contextes sont cumulatifs** : un escalier bois en ERP neuf active `bois_dtu` + `erp_neuf` + `erp_securite` ; la valeur la plus contraignante l'emporte [A §4]. Profils prédéfinis proposés : _maison individuelle bois_, _logement collectif (parties communes)_, _ERP neuf_, _ERP existant_, _extérieur_, _service / industriel_.
- Chaque résultat porte : id de règle, valeur mesurée, seuil, nature, confiance, source, localisation (marche, pièce).
- Les règles de **fabrication** de l'axe C (préfixes `C-B-*`, `C-M-*`, `C-G-*`, [C §4.1]) ne sont pas encore dans `rules.yaml`. **Recommandation** : un second fichier `capabilities.yaml` (capacités machines paramétrables par atelier) et l'intégration des règles normatives `C-G-*` et `C-B-*` dans `rules.yaml`.

### 3.2 Valeurs clés (rappel ; la table complète est `rules.yaml`)

| Grandeur          | Bois DTU            | Logement neuf    | BHC parties communes                  | ERP neuf                     | Réf.     |
| ----------------- | ------------------- | ---------------- | ------------------------------------- | ---------------------------- | -------- |
| 2h + g (mm)       | 580–660             | —                | ≥ 600 (borne haute 640 contestée, X1) | idem                         | [A §1.2] |
| h max (mm)        | 210                 | 180              | 170                                   | 160                          | [A §1.3] |
| g min (mm)        | 190                 | 240              | 280                                   | 280                          | [A §1.4] |
| Largeur (m)       | emmarchement ≥ 0,70 | ≥ 0,80           | ≥ 1,00 entre mains courantes          | ≥ 1,20 entre mains courantes | [A §1.5] |
| Échappée (m)      | ≥ 1,90              | ≥ 1,90 (via DTU) | conseil 2,20                          | conseil 2,20                 | [A §1.7] |
| Marches par volée | ≤ 25                | —                | —                                     | ≤ 25 (CO 55)                 | [A §2.1] |

Toutes ces valeurs sont de confiance **élevé**, sauf mention contraire [A]. ERP existant : h ≤ 170, g ≥ 280, 1,00 m, avec possibilité de conserver les dimensions initiales [A §1.3].

### 3.3 Corrections à apporter à `rules.yaml` avant le jalon 1

Incohérences relevées entre `rules.yaml` et l'axe C vérifié (détail en §6) :

1. `GC_PARTIE_BASSE_2024` (« partie basse ≥ 600 mm ») : à **remplacer** par une règle gabarit B (appui à 0,10 ≤ X < 0,60 m ⇒ H ≥ 1,00 + X), conformément à la correction de l'axe C (X5).
2. `GC_GABARIT_T1_2024` (« sur toute la hauteur H ») et `GC_GABARIT_T2_2024` se recouvrent : pour un garde-corps, T1 s'applique jusqu'à 0,80 m et T2 de 0,80 m à H [C §3.1] (X6).
3. Ajouter la règle des dénivelés (`C-G-03b`, avertissement, formule ⚠️) [C §3.1].
4. `LF_POSITION_ACCESSIBILITE` : préciser que la tolérance « entre le milieu et 35 cm du mur extérieur » provient de la QR 81, classée « ancienne réglementation » sur le site ministériel mais reprise par l'UICB en 2020 (X8) ; la garder hors du caractère bloquant.
5. Corriger en retour `C-structures.md` §1.2 : C1 = 1,0 kN/m (A1:2009), et non 0,6 (X4).

---

## 4. Recommandations géométriques (axe B)

1. **Pivot autour du point de la ligne de foulée** : le balancement fait tourner chaque ligne de nez autour de son point sur la ligne de foulée, qui reste fixe (définition StairDesigner) [B §3.1].
2. **M3 par défaut**, avec formule de collet minimal propre à la variante : cubique `c_min ≈ 2h/(3S − m)` ; quintique `c_min ≈ h/(m + 1,875(S − m))`. La quintique donne un limon C2 mais un collet environ 10 % plus étroit (111 contre 125 mm dans l'exemple de B) [B §3.5]. Choix de la variante par défaut : Q7.
3. La **herse ne raccorde jamais exactement** la partie droite (saut de collet inévitable) et son paramètre α doit être borné [B §3.4].
4. Limon débillardé : axe en plan + lois de rive haute / basse au moins C1 (C2 recommandé) ; faces latérales développables, rives gauches ; découpage en tronçons par programmation dynamique sous contraintes de procédé ; joints hors zones de marche / console [B §5.1–5.4] [C §2.4].
5. Le raccord par **clothoïde** donne un G1 exact sur les quatre arêtes, **pas** un G2 sur les faces [B §5.3] ; en métal il impose un roulage à rayon variable ou un cintrage par pliages successifs.
6. Tous les **développés sont calculés analytiquement** dans la couche métier : aucune bibliothèque web ne les fournit [D §2.2].
7. Plats hélicoïdaux (dessus / dessous de caisson) : développé approché en couronne (formule classique des spires de vis) ; à valider par un chaudronnier [B §4.3].

---

## 5. Recommandations techniques (axe D, entrées des ADR du jalon 0)

| Sujet                        | Recommandation                                                                                                                                                       | Alternatives écartées                                                                                    | Réf.           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------- |
| **Architecture géométrique** | Couche métier analytique TS pur (source de vérité : répartition, balancement, rives, développés, conformité) ; maillage d'aperçu généré par cette couche             | —                                                                                                        | [D §4.1]       |
| Booléens d'aperçu            | **manifold-3d** (Apache-2.0, 0,20 Mo gzip) si trous et entailles nécessaires                                                                                         | three-bvh-csg (aperçu seulement), JSCAD                                                                  | [D §2.2]       |
| B-Rep, STEP, projections HLR | **replicad** (MIT) + build OCCT 8.0.1 (LGPL-2.1), **chargé paresseusement dans un Web Worker** (≈ 4,8 Mo brotli), hors chemin critique                               | opencascade.js (non maintenu depuis 2023), CGAL wasm (ports inactifs), chili3d (AGPL), Fornjot (archivé) | [D §4.1]       |
| Licence OCCT                 | Module wasm séparé, remplaçable, notice + source du build : le wasm exécuté côté client est **probablement une distribution** LGPL ⚠️ avis juridique à obtenir       | —                                                                                                        | [D §4.1]       |
| Rendu 3D                     | **three.js + react-three-fiber + drei**, WebGL 2 par défaut ; matériaux standard (`MeshStandardMaterial` / `MeshPhysicalMaterial`) pour migrer vers WebGPU plus tard | Babylon.js (crédible, plus lourd, moins d'intégrations CAO/BIM)                                          | [D §4.2]       |
| Contrainte de version        | r3f 9.8 exige React ≥ 19 et < 19.4                                                                                                                                   | —                                                                                                        | [D §2.1]       |
| Textures                     | **Poly Haven, ambientCG (CC0)** embarquables sans attribution                                                                                                        | —                                                                                                        | [D §2.1]       |
| DXF                          | **@tarikjabiri/dxf** (MIT, cotations) : écrit **uniquement AC1021 (2007)** ; prévoir un écrivain R12 / 2000 minimal ; choix de version à l'export                    | dxf-writer (abandonné)                                                                                   | [D §3.1, §4.3] |
| PDF                          | Tracé 2D métier ou projection HLR → SVG → **jsPDF + svg2pdf.js** ; pdfmake pour les tableaux                                                                         | pdf-lib (non maintenu)                                                                                   | [D §2.3]       |
| Tableurs                     | CSV natif ; **exceljs** (maintenance faible, à surveiller) ; **ne pas utiliser le paquet npm `xlsx`** (figé et vulnérable)                                           | SheetJS npm                                                                                              | [D §2.3]       |
| IFC                          | **web-ifc** (MPL-2.0, écriture IFC4X3, 0,44 Mo brotli) ; écrire `NumberOfRiser` (nom du gabarit de Pset), à valider par un vérificateur IDS                          | IfcOpenShell / Pyodide (runtime lourd)                                                                   | [D §2.4, §3.3] |
| Marquage des pièces          | opentype.js (texte → contours pour gravure)                                                                                                                          | —                                                                                                        | [D §2.3]       |
| Performance                  | Recalcul < 100 ms (prompt 2) : garanti par la couche analytique ; OCCT réservé aux exports                                                                           | —                                                                                                        | [D §4.1]       |

---

## 6. Contradictions entre sources

| #   | Sujet                                                                     | Source(s) A                                                                                                 | Source(s) B                                                                                                | Statut                                                                                                                                                                             | Décision provisoire pour Blondel                                                                                                                                    |
| --- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X1  | Borne haute de 2h+g en ERP et parties communes de BHC                     | UICB 2020 : 600–640 mm, attribué au DTU P3 [A §1.2]                                                         | AFEB 2016 : 580–660 avec « minimum 600 » par la réglementation ; arrêtés sans formule de Blondel [A §5]    | **Ouvert** (texte P3 payant)                                                                                                                                                       | ≥ 600 bloquant ; > 640 **avertissement** (`BLONDEL_ERP_BHC`, confiance moyen)                                                                                       |
| X2  | Mode de mesure de l'échappée                                              | DTU via AFEB : « sur la ligne de pente », sans préciser [A §1.7]                                            | ISO 14122-3 : hauteur de tête verticale + dégagement perpendiculaire ; ADK : verticale. Écart ≈ 23 % à 40° | **Ouvert**                                                                                                                                                                         | Verticale au-dessus de la ligne de pente sur la ligne de foulée, hypothèse affichée dans l'interface (choix de conception)                                          |
| X3  | Giron minimal au collet                                                   | Aucune valeur FR trouvée ; usage 100 mm (balancé), 150 mm (hélicoïdal) [A §1.9]                             | ADK 50 mm ; DIN 18065 100 / 50 / 0 mm ; IRC 152 mm [B §2.4]                                                | **Ouvert** (annexe A du P3)                                                                                                                                                        | `G_COLLET_MIN` = 100 mm en avertissement, 150 mm en conseil ; paramètre de règle. B suggérait aussi 50 mm bloquant : non retenu tant que rien ne le fonde en France |
| X4  | Charge horizontale sur garde-corps, catégorie C1                          | A : 1,0 kN/m selon l'amendement NF P06-111-2/A1 (2009) via le guide PACTE/CTB [A §3.6]                      | C : 0,6 kN/m selon l'AN de juin 2004 relue [C §1.2] ; un fabricant donne 1,0                               | **Tranché** : le tableau 1 du guide PACTE (§5.2.2), relu pour cette synthèse [S1], cite l'A1 et regroupe « catégories C1 à C4 » à 1 kN/m. C a lu la version 2004 sans l'amendement | **C1 = 1,0 kN/m** (valeur A1, plus sûre) ; confiance moyen (texte de l'A1 non lu) ; catégorie E ⚠️                                                                  |
| X5  | « Plinthe de 0,60 m » en NF P01-012:2024                                  | A et `rules.yaml` (`GC_PARTIE_BASSE_2024`) : partie basse non escaladable / remplissage sur 0,60 m [A §3.2] | C (vérifié) : zone de **recherche d'appuis** du gabarit B, pas une obligation de plein [C §3.1]            | **Tranché en faveur de C** (fabricant Horizal cohérent avec APAVE) ; texte primaire non lu                                                                                         | Règle gabarit B ; corriger `rules.yaml` (§3.3)                                                                                                                      |
| X6  | Domaine du gabarit T1 (2024)                                              | `rules.yaml` : T1 sur toute la hauteur H                                                                    | C : T1 jusqu'à 0,80 m, puis T2 jusqu'à H (garde-corps)                                                     | **Tranché en faveur de C** (sinon T2 n'a pas d'objet)                                                                                                                              | Corriger `rules.yaml`                                                                                                                                               |
| X7  | Hauteur du garde-corps rampant en 2024                                    | Fabricants : 0,90 m à la verticale du nez maintenu [A §3.2] [C §3.1]                                        | Non couvert par la présentation APAVE                                                                      | **Ouvert**                                                                                                                                                                         | 0,90 m, confiance faible (`GC_HAUTEUR_RAMPANT_2024`), rétrogradable                                                                                                 |
| X8  | Ligne de mesure du giron en accessibilité (QR 81 : milieu ↔ 35 cm du mur) | A : interprétation ministérielle applicable [A §1.4]                                                        | B : QR 81 classée « ancienne réglementation » (circulaire de 2007) [B §2.2]                                | **Partiellement tranché** : la note UICB d'octobre 2020, postérieure aux arrêtés de 2015 et 2017, reprend la QR 81 [S2]                                                            | Ligne de mesure : milieu (E ≤ 1,20 m) ou 0,60 m ; tolérance 35 cm en option, non bloquante                                                                          |
| X9  | Position de la ligne de foulée des tournants                              | DTU : milieu, ou 0,60 m au-delà de 1,20 m                                                                   | Usage 50 cm ; brevet 35–45 cm ; IRC 305 mm ; EHI 60 cm du noyau [B §2.2]                                   | **Découplé**                                                                                                                                                                       | Ligne de conception = DTU par défaut, modifiable ; contrôles sur lignes de mesure séparées                                                                          |
| X10 | Hélicoïdal et gain de place (annexe A du DTU)                             | h ≤ 230 mm, ligne de foulée à 0,60 m du fût (source unique, blog) [A §1.10]                                 | Autres sources : 220 mm pour le gain de place                                                              | **Ouvert**                                                                                                                                                                         | Avertissement seulement (`H_MAX_HELICOIDAL_DTU`, faible)                                                                                                            |
| X11 | Champ de l'emmarchement ≥ 700 mm                                          | AFEB : minimum général                                                                                      | CODIFAB : largeur de passage en maison individuelle [A §1.5]                                               | **Ouvert** (RC §6.9 non lu)                                                                                                                                                        | 700 mm bloquant en `bois_dtu`                                                                                                                                       |
| X12 | Espacement des câbles de garde-corps                                      | Un fabricant : < 14,5 cm, interdits en zone basse [C §3.1]                                                  | APAVE et Horizal : seulement T1 / T2 et gabarit B                                                          | **Tranché** : 14,5 cm non implémenté                                                                                                                                               | Câbles traités comme des lisses + avertissement de détente                                                                                                          |
| X13 | Priorité de l'export IFC                                                  | D : V1 [D §3.9]                                                                                             | Prompt 2 : IFC en V2                                                                                       | **Arbitrage produit**                                                                                                                                                              | V2 (le prompt 2 fait foi) ; le modèle de données prévoit dès le jalon 0 les champs de `Pset_StairFlightCommon`                                                      |
| X14 | Version DXF attendue par les ateliers                                     | R12 / 2000 (ENSA, L'Atelier du Laser)                                                                       | R14 / 2007 (CutOptim) ; R2010/2013 ASCII (AICC) [D §3.1]                                                   | **Ouvert** (usage)                                                                                                                                                                 | Version sélectionnable ; AC1021 par défaut, R12 à prévoir                                                                                                           |
| X15 | Nom de propriété IFC                                                      | Gabarit `Pset_StairFlightCommon` : `NumberOfRiser`                                                          | Doc `IfcStairFlight` : `NumberOfRisers` [D §3.3]                                                           | **Ouvert**                                                                                                                                                                         | `NumberOfRiser`, à valider par IDS                                                                                                                                  |
| X16 | Charge d'exploitation des escaliers                                       | AN française : 2,5 kN/m², 2 kN (cat. A) [A §3.6]                                                            | EN 16481, valeurs par défaut : 3 kN/m², 2 kN [C §1.2]                                                      | **Tranché** : l'AN prime en France                                                                                                                                                 | Stocker les deux avec leur provenance                                                                                                                               |
| X17 | Flèche admissible                                                         | EN 16481 : L/200 ; ISO 14122-3 : 1/300 et ≤ 6 mm (machines)                                                 | Usage résidentiel : L/300 à L/400 [C §1.3] ; DTU RC 5-2 / 5-3 non lus                                      | **Ouvert**                                                                                                                                                                         | L/200 bloquant si calcul ; L/300 en conseil                                                                                                                         |
| X18 | Coût du thermolaquage                                                     | Au m² appliqué aux limons : 80–180 €                                                                        | Escalier complet : 2 000–5 500 € ; option +300–600 € [C §5.3]                                              | **Ouvert** (calibrage)                                                                                                                                                             | Barème paramétrable avec forfait minimum                                                                                                                            |
| X19 | Tolérance de hauteur d'étage > 3 m                                        | Texte : « intervalle de tolérance 10·H^(1/3) »                                                              | Lecture ± 10·H^(1/3) créerait un saut à 3 m                                                                | **Tranché par continuité** [A §1.7] : ± 5·H^(1/3)                                                                                                                                  | Conseil seulement                                                                                                                                                   |

Contradictions internes déjà corrigées par les vérificateurs (pour mémoire) : herse et α → 0 [B §3.4], G2 de la clothoïde [B §5.3], k_r du lamellé cintré [C §1.6], mesure « perpendiculaire » attribuée à tort à Batirama [A §1.7], Tekla sans hélicoïdal [D §1.2].

---

## 7. Questions ouvertes (priorisées)

### 7.1 Achats de normes (déblocage le plus rentable)

| #   | Question                                                                                                                                                                                                                                        | Impact                                                            | Jalon bloqué |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------ |
| Q1  | Acheter le **NF DTU 36.3 P3** (ou le calepin FCBA) : annexe A (hélicoïdal, gain de place, collet), tableau 2h+g par destination (X1), RC 5-2 / 5-3 (flèches), RC 5-4, épaisseurs minimales de marche, RC 6.9, mode de mesure de l'échappée (X2) | Règles bloquantes de collet, d'échappée, de flèche                | 2, 3, 5      |
| Q2  | Acheter la **NF P01-012:2024** et la **NF P01-013:2024** : règles du rampant (X7), gabarit B et dénivelés (définition de Y), renvois (b) du tableau h(E), vide sous lisse basse, zone d'activité dans un escalier                               | Conformité garde-corps 2024, obligatoire pour les projets récents | 4            |
| Q3  | Lire l'**amendement NF P06-111-2/A1** : catégorie E, confirmation de C1 (X4)                                                                                                                                                                    | Charges garde-corps                                               | 4            |

### 7.2 Décisions produit à valider par l'utilisateur

| #   | Question                                                                                                                | Proposition                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Q4  | Échappée mesurée à la verticale par défaut (X2) ?                                                                       | Oui, avec hypothèse affichée                                              |
| Q5  | En ERP / BHC, 2h+g > 640 mm : bloquer ou avertir (X1) ?                                                                 | Avertir tant que Q1 n'est pas levée                                       |
| Q6  | Seuils de collet (X3) : 100 mm avertissement / 150 mm conseil, sans bloquant ?                                          | Oui ; bloquant réservé à `c ≤ 0` et au croisement des lignes de nez       |
| Q7  | Variante M3 par défaut : cubique (collet plus large) ou quintique C2 (limon plus lisse) ?                               | Cubique pour limons à la française et poteaux, quintique pour débillardés |
| Q8  | Faut-il une règle distincte de dégagement perpendiculaire en contexte industriel ?                                      | Oui, au jalon 5                                                           |
| Q9  | Garder la herse (M2) malgré l'impossibilité de raccord exact ?                                                          | Oui, en option pédagogique avec α borné                                   |
| Q10 | Limon lamellé en plis minces (hors NF EN 14080) : bloquer ou avertir ?                                                  | Avertir + exiger une justification                                        |
| Q11 | Export IFC en V1 ou V2 (X13) ?                                                                                          | V2                                                                        |
| Q12 | Escaliers sans contremarche en logement : ajouter un contrôle de vide entre marches (sphère de 100 mm au Royaume-Uni) ? | Conseil                                                                   |

### 7.3 Validations par des professionnels (ateliers pilotes)

| #   | Question                                                                                             | Réf.              |
| --- | ---------------------------------------------------------------------------------------------------- | ----------------- |
| Q13 | Temps d'atelier par opération (coupe, pli, cordon, gabarit) : **aucune donnée publique**             | [C §6]            |
| Q14 | Tables de capacités réelles (cintrage, roulage, pliage, formats de tôle laser)                       | [C §4.3, §6]      |
| Q15 | Position et tolérance des joints de débillardé ; gabarit de soudage ; méplats d'extrémité en roulage | [B §5.5] [C §2.4] |
| Q16 | Le G1 du raccord clothoïde suffit-il en fabrication ? Roulage à rayon variable faisable ?            | [B §5.3]          |
| Q17 | Développé en couronne des plats hélicoïdaux (chaudronnier)                                           | [B §4.3]          |
| Q18 | Version DXF et conventions de calques des FAO bois (woodWOP, Xilog, bSolid) (X14)                    | [D §3.1]          |
| Q19 | Acceptation d'un STEP AP242 « DIS » par les logiciels des sous-traitants                             | [D §3.2]          |
| Q20 | Calibrage des coûts de galvanisation et de thermolaquage (X18)                                       | [C §5]            |

### 7.4 Juridique et technique

| #   | Question                                                                                    | Réf.     |
| --- | ------------------------------------------------------------------------------------------- | -------- |
| Q21 | Obligations LGPL précises du wasm OCCT servi au navigateur (avis juridique)                 | [D §4.1] |
| Q22 | Calendrier des annexes nationales de la seconde génération d'EN 1991-1-1 et EN 1995-1-1     | [A §3.6] |
| Q23 | Code du travail : règles chiffrées pour escaliers de service (aucune trouvée)               | [A §3.9] |
| Q24 | Équivalents européens du brevet US6845595 avant d'implémenter M5                            | [B §3.7] |
| Q25 | Écart de taille réel entre three.js et Babylon tree-shaké (utile seulement si l'ADR hésite) | [D §4.2] |

---

## 7bis. Décisions validées (2026-09-28)

| #     | Sujet                                              | Décision                                                                                                                                                                                                      |
| ----- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1–Q3 | Achat des normes payantes                          | **Non.** On s'appuie sur les sources secondaires ; les règles concernées portent `source_secondaire: true` dans `rules.yaml` (51 règles, dont 28 bloquantes).                                                 |
| —     | Traitement des règles `source_secondaire`          | **Profil de conformité au choix par projet** : `strict` (sévérité telle quelle, défaut) ou `souple` (les bloquantes à source secondaire deviennent des avertissements). Défini dans `rules.yaml` → `profils`. |
| Q4    | Mesure de l'échappée                               | **Verticale** au-dessus de la ligne de pente, sur la ligne de foulée ; hypothèse affichée.                                                                                                                    |
| Q5    | 2h+g en ERP / parties communes de BHC              | **Avertir, ne jamais bloquer**, sur les deux bornes (600 et 640 mm).                                                                                                                                          |
| Q6    | Giron au collet                                    | **100 mm avertissement / 150 mm conseil** ; bloquant seulement si collet ≤ 0 ou lignes de nez croisées ; seuils modifiables.                                                                                  |
| Q7    | Variante du balancement par développement du limon | **Selon la structure** : cubique pour limons à la française et poteaux, quintique pour débillardés ; modifiable.                                                                                              |
| Q8    | Dégagement perpendiculaire industriel              | **Non retenu** pour l'instant.                                                                                                                                                                                |
| Q9    | Méthode de la herse                                | **Option V1**, paramètre α borné, avertissement sur le raccord.                                                                                                                                               |
| Q10   | Lamellé-collé cintré en plis minces                | **Avertissement + champ de justification** repris dans le dossier.                                                                                                                                            |
| Q11   | Export IFC                                         | **V2.**                                                                                                                                                                                                       |
| Q12   | Vide entre marches sans contremarche               | **Oui, en conseil** (`VIDE_ENTRE_MARCHES`, sphère de 100 mm, logement).                                                                                                                                       |
| X14   | DXF R12 dès le MVP                                 | **Non** : DXF 2007 (AC1021) au MVP, R12 plus tard.                                                                                                                                                            |

Décisions complémentaires du 2026-09-28 issues du challenge de conception (`CHALLENGE.md`) :

| #              | Sujet                    | Décision                                                                                                                                                                                                       |
| -------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 (challenge) | Unités                   | **Saisies en mm entiers, calcul en float64 (radians en interne), arrondi unique en sortie** par plus fort reste (ADR-0003). Dérogation au prompt 2 §3.                                                         |
| P3 (challenge) | Nom et portée du rapport | **« Contrôle de conception »** (et non « conformité ») ; nature, confiance, source secondaire affichées ; règles non évaluées listées ; **règles de l'art** (valeurs DTU en avertissement) actives par défaut. |
| P4 (challenge) | Jalons                   | **Bois d'abord** : J3a bois, J3b métal, J3c profilés + prédimensionnement + nomenclature ; J5a hélicoïdal, J5b débillardé soudé, J5c débillardé bois (V2).                                                     |
| X14 / P6       | Version DXF              | **R12 maison par défaut pour les pièces**, AC1021 (2007) pour les plans cotés, choix à l'export. Remplace la ligne X14 ci-dessus.                                                                              |

Corrections du §3.3 appliquées à `rules.yaml` : `GC_PARTIE_BASSE_2024` remplacée par `GC_GABARIT_B_2024`, domaine de `GC_GABARIT_T1_2024` ramené à 0–800 mm, ajout de `GC_DENIVELES_2024`, note sur la tolérance QR 81 de `LF_POSITION_ACCESSIBILITE` ; C1 = 1,0 kN/m corrigé dans `C-structures.md`.

---

## 8. Décisions recommandées (synthèse pour le jalon 0)

1. Pipeline en fonctions pures avec **couche métier analytique** (source de vérité, développés compris) ; OCCT / replicad seulement pour STEP et projections, dans un worker chargé à la demande.
2. **Ligne de foulée de conception** (DTU par défaut) **découplée** des **lignes de mesure réglementaires**.
3. **M3 + M1** au jalon 2, M2 / M6 au jalon 5, M7 en V2.
4. Moteur de règles à **contextes cumulatifs**, avec nature, confiance, source et rétrogradation tracée ; **double régime garde-corps** piloté par une date du projet ; jeu de règles versionné dans le projet.
5. **Capacités machines et temps d'atelier = paramètres d'atelier**, jamais des constantes codées.
6. Classe d'exécution EN 1090-2 déduite des choix de conception et affichée ; elle entre dans le comparateur de coûts.
7. Exports DXF 1:1 et PDF minimal avancés aux jalons 1 et 3 pour tenir les critères d'acceptation.
8. ~~Corriger `rules.yaml` (§3.3) avant le jalon 1.~~ Fait (voir §7bis).

---

## 9. Glossaire FR ↔ EN

Termes du métier. La colonne « Réf. » indique où le terme est défini ou utilisé dans la recherche. Les équivalents anglais sans source dans la recherche sont marqués _(usage)_ : ce sont des traductions courantes du métier, à confirmer par un utilisateur anglophone.

| Français                           | English                                                      | Définition courte                                                                                         | Réf.                                      |
| ---------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Escalier                           | Stair, staircase                                             | —                                                                                                         | —                                         |
| Volée                              | Flight                                                       | Suite ininterrompue de marches entre deux paliers ; en IFC, les marches balancées font partie de la volée | [D §3.3]                                  |
| Palier                             | Landing                                                      | Plate-forme entre deux volées ou à l'arrivée                                                              | [A §2.2]                                  |
| Marche palière                     | Landing tread / top tread _(usage)_                          | Dernière marche, au niveau du palier                                                                      | [B §3.1]                                  |
| Marche de départ                   | Bottom step / starting step _(usage)_                        | Première marche, hauteur éventuellement distincte                                                         | [A §1.3]                                  |
| Hauteur de marche (h)              | Rise                                                         | Distance verticale entre deux dessus de marche                                                            | [A §0.4] [ADK via A §1.3]                 |
| Hauteur à monter (H)               | Total rise                                                   | Sol fini à sol fini                                                                                       | [A §0.4]                                  |
| Giron (g)                          | Going (UK), tread depth / run (US)                           | Distance horizontale entre deux nez, sur la ligne de foulée                                               | [A §0.4] [B §2.4]                         |
| Loi de Blondel, module 2h + g      | Stair formula, 2R + G (UK), Schrittmaßregel (DE)             | Module de confort                                                                                         | [A §1.1, §1.2]                            |
| Emmarchement (E)                   | Stair width (clear width between strings) _(usage)_          | Largeur entre faces internes des limons                                                                   | [A §0.4]                                  |
| Largeur de passage                 | Clear width                                                  | Entre parois ou mains courantes saillantes                                                                | [A §0.4]                                  |
| Reculement (R)                     | Total run / total going                                      | Projection horizontale de la volée                                                                        | [A §1.8]                                  |
| Échappée (e)                       | Headroom (UK : vertical), clearance (ISO : perpendiculaire)  | Hauteur libre au-dessus de la ligne de pente                                                              | [A §1.7]                                  |
| Ligne de pente                     | Pitch line                                                   | Ligne joignant les nez de marche                                                                          | [A §1.7]                                  |
| Ligne de foulée                    | Walking line (UK), walkline (US)                             | Trajet théorique du pied, où l'on mesure le giron                                                         | [A §1.6] [B §2.2]                         |
| Ligne de mesure (accessibilité)    | Measuring line _(usage)_                                     | Ligne réglementaire de mesure du giron, distincte de la ligne de foulée                                   | [A §1.4]                                  |
| Trémie                             | Stairwell opening                                            | Ouverture du plancher haut                                                                                | [A §1.7]                                  |
| Chevêtre                           | Trimmer                                                      | Pièce qui borde la trémie                                                                                 | [B §4.1]                                  |
| Contremarche                       | Riser                                                        | Face verticale entre deux marches                                                                         | [A §1.11]                                 |
| Nez de marche                      | Nosing                                                       | Arête avant de la marche                                                                                  | [A §1.11]                                 |
| Débord du nez                      | Nosing projection                                            | Saillie du nez sur la contremarche                                                                        | [A §1.11]                                 |
| Recouvrement                       | Overlap                                                      | Recouvrement horizontal entre deux marches sans contremarche                                              | [A §1.11]                                 |
| Marche balancée, dansante          | Balanced step, dancing step, winder (tapered tread)          | Marche dont la ligne de nez ne passe pas par le centre du tournant                                        | [B §1.1]                                  |
| Marche rayonnante                  | Radial winder _(usage)_                                      | Ligne de nez passant par le centre du tournant                                                            | [B §3.2]                                  |
| Balancement                        | Balancing (of winders), Verziehung (DE)                      | Répartition des marches dans un tournant                                                                  | [B §3]                                    |
| Collet                             | Narrow end (of a tapered tread)                              | Extrémité étroite d'une marche balancée, côté jour                                                        | [A §0.4] [B §2.4]                         |
| Jour                               | Well                                                         | Vide central côté intérieur du tournant                                                                   | [B §1.1]                                  |
| Noyau, fût                         | Newel, central column                                        | Pièce centrale d'un hélicoïdal                                                                            | [B §1.1]                                  |
| Quartier tournant (quart tournant) | Quarter turn (winding)                                       | Changement de direction à 90°                                                                             | [B §1.1] [D §3.3 `QUARTER_WINDING_STAIR`] |
| Demi-tournant                      | Half turn                                                    | Changement de direction à 180°                                                                            | [D §3.3 `HALF_WINDING_STAIR`]             |
| Escalier hélicoïdal                | Spiral stair (helical stair)                                 | Marches autour d'un axe                                                                                   | [D §3.3 `SPIRAL_STAIR`]                   |
| Pas japonais, pas décalés          | Alternating tread stair                                      | Marches alternées gauche / droite                                                                         | [A §1.10]                                 |
| Échelle de meunier                 | Ship's ladder / stepladder _(usage)_ ; ISO : step ladder     | Escalier très raide, hors DTU                                                                             | [A §1.10]                                 |
| Limon                              | String, stringer                                             | Pièce portant les marches                                                                                 | [C §1.4] [D §3.3 `STRINGER`]              |
| Limon à la française               | Closed / housed string                                       | Marches encastrées dans des entailles du limon                                                            | [C §1.4]                                  |
| Limon à l'anglaise, crémaillère    | Cut / open string                                            | Limon découpé en dents, marches posées dessus                                                             | [C §1.4]                                  |
| Limon central                      | Central stringer, mono-stringer _(usage)_                    | Poutre unique sous les marches                                                                            | [C §1.5]                                  |
| Limon débillardé                   | Wreathed string _(usage)_                                    | Limon continu qui suit le tournant (surface gauche)                                                       | [B §5]                                    |
| Débillarder, débillardement        | Wreathing _(usage)_                                          | Tailler une pièce à la forme gauche d'un tournant                                                         | [B §4.5]                                  |
| Délardement, marche délardée       | Splayed / chamfered soffit _(usage)_                         | Coupe en biais du dessous de la marche pour suivre le rampant                                             | [B §4.5]                                  |
| Courbe rampante                    | Wreath (portion courbe d'un limon ou d'une main courante)    | Tronçon courbe et rampant                                                                                 | [C §1.6] [B §4.4]                         |
| Jarret                             | Kink _(usage)_                                               | Cassure de pente au raccord droit / courbe                                                                | [B §5.3]                                  |
| Crosse                             | Ramp / crook _(usage)_                                       | Relevé de la rive du limon près du collet                                                                 | [B §5.3]                                  |
| Point de naissance                 | Springing point _(usage)_                                    | Jonction droite / courbe                                                                                  | [B §5.3]                                  |
| Raccord, adoucissement             | Easing                                                       | Transition progressive de pente                                                                           | [B §4.4, §5.3]                            |
| Calibre rallongé, gabarit de face  | Face mould                                                   | Gabarit projeté sur le plateau incliné                                                                    | [B §4.4, §5.5]                            |
| Système des tangentes              | Tangent handrailing                                          | Méthode de tracé des mains courantes courbes                                                              | [B §4.4]                                  |
| Herse                              | — (méthode graphique française), Winkelmethode (DE, voisine) | Méthode graphique de balancement                                                                          | [B §3.4]                                  |
| Poteau                             | Newel post                                                   | Pièce verticale recevant limons et rampe                                                                  | [C §1.9]                                  |
| Volute                             | Volute                                                       | Enroulement de départ de la rampe                                                                         | [C §1.9]                                  |
| Main courante                      | Handrail                                                     | Élément saisi à la main                                                                                   | [A §1.12]                                 |
| Garde-corps                        | Guard, guarding, balustrade                                  | Protection contre la chute                                                                                | [A §3.2]                                  |
| Rampe (d'escalier)                 | Stair balustrade / banister                                  | Garde-corps rampant                                                                                       | [A §3.2]                                  |
| Balustre, barreau                  | Baluster, spindle                                            | Élément vertical de remplissage                                                                           | [C §3.2]                                  |
| Lisse                              | Rail (horizontal)                                            | Élément horizontal de remplissage                                                                         | [C §3.2]                                  |
| Zone d'activité (NF P01-012:2024)  | — (terme normatif français)                                  | Surface depuis laquelle on mesure H                                                                       | [A §3.2]                                  |
| Bande d'éveil de vigilance         | Tactile warning strip                                        | Revêtement podotactile en haut d'escalier                                                                 | [A §1.11]                                 |
| Unité de passage (UP)              | Exit unit width _(usage)_                                    | 0,90 / 1,40 / n × 0,60 m (ERP)                                                                            | [A §1.5]                                  |
| Tôle pliée                         | Folded / press-braked sheet                                  | —                                                                                                         | [C §2.6]                                  |
| Tôle larmée                        | Chequer plate (UK), diamond plate (US) _(usage)_             | Tôle à relief antidérapant                                                                                | [C §2.6]                                  |
| Caillebotis                        | Grating                                                      | Marche en grille                                                                                          | [C §2.6]                                  |
| Cornière                           | Angle                                                        | Profil en L, support de marche                                                                            | [C §2.6]                                  |
| Platine                            | Base plate / plate _(usage)_                                 | Plaque de fixation                                                                                        | [C §2.6]                                  |
| Console                            | Bracket                                                      | Support en porte-à-faux                                                                                   | [C §2.6]                                  |
| Profilé UPN / IPN / IPE / HEA      | Channel (UPN), I-beam (IPN / IPE), H-beam (HEA)              | Profilés du commerce                                                                                      | [C §2.3]                                  |
| Cintrage                           | Bending (of sections / tubes)                                | Mise en courbe d'un profilé                                                                               | [C §2.3]                                  |
| Roulage                            | Plate rolling                                                | Mise en forme cylindrique d'une tôle                                                                      | [C §2.4]                                  |
| Fibre neutre                       | Neutral axis / neutral fibre                                 | Fibre de longueur inchangée au formage                                                                    | [B §4.3]                                  |
| Développé                          | Flat pattern, development                                    | Mise à plat d'une pièce                                                                                   | [B §4–5]                                  |
| Calepinage                         | Nesting                                                      | Imbrication des pièces dans la tôle                                                                       | [C §2.2]                                  |
| Classe d'exécution                 | Execution class (EXC)                                        | EN 1090-2                                                                                                 | [C §2.1]                                  |
| Lamellé-collé cintré               | Curved glulam                                                | —                                                                                                         | [C §1.6]                                  |
| Enture                             | Scarf joint                                                  | Assemblage bout à bout de deux pièces de bois                                                             | _(usage)_                                 |
| Boulon d'escalier                  | Handrail bolt / stair bolt _(usage)_                         | Boulon à clavette et écrou cannelé                                                                        | [C §1.6]                                  |
| Tenon et mortaise                  | Mortise and tenon                                            | —                                                                                                         | [C §1.6]                                  |
| Fausse marche                      | Dummy tread _(usage)_                                        | Marche non porteuse d'habillage                                                                           | _(usage)_                                 |

---

## Sources

Sources de la recherche : voir les sections « Sources » de chacun des fichiers `research/A-regles.md`, `B-geometrie.md`, `C-structures.md` et `D-etat-de-l-art.md` (toutes consultées le 2026-09-28).

Sources relues pour cette synthèse, uniquement pour trancher des contradictions :

- **[S1]** PACTE / CTB Composants et Systèmes (FCBA), _Guide Conception et mise en œuvre des garde-corps_, septembre 2020, §5.2.2 et tableau 1 « Valeur de la charge horizontale répartie de l'intérieur vers l'extérieur » (cite la NF P 06-111-2/A1 ; « Catégories C1 à C4 » : 1 kN/m). <https://ctb-composants-systemes.fr/wp-content/uploads/2024/01/gconcmoegarde-corpssept20216web.pdf> — consulté le 2026-09-28. Confiance : moyen (source secondaire de premier rang ; l'extraction texte du tableau ne montre que trois valeurs, 0,6 / 1 / 3 kN/m, pour six lignes, d'où une lecture par regroupement).
- **[S2]** UICB – Groupement escalier, _Accessibilité — Récapitulatif des exigences applicables aux escaliers en bois_, octobre 2020, p. 2 « Giron minimal et position de la ligne de mesure » (reprend la tolérance de 35 cm de la QR 81 aux côtés des arrêtés de 2015 et 2017). <https://www.uicb.pro/wp-content/uploads/2021/07/Note-Accessibilite-applicable-aux-escaliers-en-bois-Octobre-2020.pdf> — consulté le 2026-09-28. Confiance : moyen.
