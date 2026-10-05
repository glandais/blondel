# Handoff : Blondel — parcours guidé / parcours libre

Dépôt cible : `glandais/blondel`, branche `develop`, application `apps/web` (React + TypeScript, Zustand, Web Worker, CSS à variables, aucune bibliothèque de composants).

## Vue d'ensemble

Refonte de l'interface de conception d'escaliers. Deux parcours sur **un seul projet** :

- **Guidé** (démo, débutants) : 7 étapes cliquables dans n'importe quel ordre, chacune avec un formulaire court et une vue conseillée.
- **Libre** (artisans) : un rail de 8 sections ouvre **un panneau à la fois**, la vue occupe le centre, et un **inspecteur contextuel** à droite suit la sélection partagée. Une bascule **Conception / Fabrication** sépare la conception des sorties d'atelier.

La bascule Guidé ↔ Libre ne change ni le projet, ni l'historique d'annulation, ni la sélection, ni la vue active, ni l'unité, ni le thème.

## À propos des fichiers

Les fichiers `.dc.html` sont des **références de design en HTML**, pas du code de production. Il faut **recréer ces écrans dans `apps/web`** avec ses conventions : composants React, stores existants (`store/appStore.ts`, `projectStore.ts`, `modelStore.ts`), champs de `components/fields.tsx`, variables CSS de `styles.css`. Ouvrez les fichiers dans un navigateur (servis depuis ce dossier, `support.js` à côté) pour les consulter.

Principes de l'existant à conserver (voir le document « état de l'interface ») :

- l'interface ne calcule rien : elle édite le projet et affiche le modèle du worker ;
- les dessins 2D affichés sont les exports SVG eux-mêmes ;
- saisie en mm entiers, validation à Entrée ou à la perte de focus, Échap rétablit ;
- tout est annulable ;
- la mention « Contrôle de conception indicatif : il ne vaut pas attestation de conformité. » reste visible.

## Fidélité

| Fichier | Fidélité | Usage |
| --- | --- | --- |
| `Blondel Parcours Hi-fi.dc.html` — turn 1 (1a, 1b) et turn 2 (2a–2d) | **Haute** | Mise en page, hiérarchie, couleurs, typographie, textes à reproduire. |
| `Blondel Contenu Parcours.dc.html` | **Spécification normative** | Inventaire champ par champ : niveau de chaque paramètre, libellés unifiés. Fait foi pour le contenu. |
| `Blondel Refonte Wireframes.dc.html` | Basse | Contexte : pistes explorées (1a–1l) et scénario retenu (turn 2). Les zones 1h (Exporter), 1j (fenêtres), 1k (erreurs), 1l (couleurs) restent des intentions à détailler. |

Style visuel : système **Industry** (`_ds/…/styles.css`, guide dans `_ds/…/readme.md`). Deux options d'implémentation, à choisir avec le mainteneur : (a) adopter Industry, c'est-à-dire porter ses jetons dans `apps/web/src/styles.css` ; (b) garder les jetons actuels et ne reprendre que la structure. Les couleurs fonctionnelles (sévérités, sélection) sont conservées dans les deux cas.

## Écrans

Les dimensions sont données pour un écran de 1440 × 900 (référence) ; en 1920, le même gabarit s'élargit (colonnes latérales fixes, vue fluide).

### 1a — Parcours guidé (étape « Découpage »)

Grille : `grid-template-rows: 52px 68px 1fr 60px`.

1. **Barre du haut (52 px)**, de gauche à droite, avec 16 px de marge latérale et 16 px d'écart :
   - « BLONDEL » (Barlow Condensed 600, 21 px, interlettrage 0,06em), suivi d'un filet vertical de 22 px ;
   - nom du projet en bouton ghost (Barlow 500, 14 px) avec un chevron : menu Nouveau / Ouvrir / Démos / Assistant ;
   - étiquette « Démo » (`.tag-accent`) quand le projet vient d'une démo ;
   - « ✓ Enregistré » (12 px, neutral-700) : état de l'autosauvegarde ;
   - à droite, un segmenté **Guidé | Libre** (Barlow Condensed 600, 14 px ; l'option active en fond `--color-text`, texte `--color-bg`) ;
   - Annuler / Rétablir (boutons icônes 36 × 36, secondaires) ;
   - ⋯ : unité, thème, profil d'atelier.
2. **Barre d'étapes (68 px)** : 7 cellules égales séparées par des filets. Chaque cellule contient :
   - une pastille de 24 × 24 : ✓ en accent si l'étape est faite, le numéro sinon ;
   - le titre (Barlow Condensed 600, 15 px) ;
   - le résumé (11,5 px, neutral-700 ; ocre `#9a6200` s'il contient des ◆) ;
   - pour l'étape active : fond neutral-100, soulignement `inset 0 -3px 0 var(--color-accent)` et pastille foncée.
3. **Corps** : `grid-template-columns: 400px 1fr`.
   - **Formulaire de l'étape** (marge intérieure 24 px, 18 px entre les blocs) :
     - surtitre « Étape 3 sur 7 » (10,5 px, majuscules, accent-700), titre en h2 de 30 px, phrase d'objectif ;
     - les champs ;
     - un cadre blueprint de chiffres clés (3 colonnes, chiffres en Barlow Condensed 32 px) avec la **jauge 2h + g** sur l'échelle 56–68 cm, la zone confortable 60–64 en accent-300 et un repère vertical à la valeur ;
     - un encart d'aide (fond neutral-100, icône info) ;
     - en pied, un lien « Réglage avancé… » qui déplie les champs « Plus ».
   - **Vue** (marge intérieure 16 × 20 px) :
     - en tête, un segmenté Élévation | Plan | 3D, la mention « Vue conseillée pour cette étape », et à droite les boutons − + Recadrer ;
     - la vue dans un cadre blueprint à fond blanc : c'est le SVG exporté, sélection en `#ff7a1a` ;
     - un encart flottant « Vous connaissez le métier ? » qui propose de passer en parcours libre, avec un bouton pour le fermer.
4. **Pied (60 px)**, fond neutral-100 :
   - à gauche, les boutons ghost « ▲ 1 avertissement » (ocre) et « ⓘ 1 conseil » (accent-700), qui ouvrent la liste du contrôle par-dessus la vue ;
   - la mention indicative (12,5 px) ;
   - à droite, « ← Étape précédente » (bouton secondaire) et « Étape suivante → » (bouton primaire blueprint).

### 1b — Parcours libre, mode Conception

Grille : `grid-template-rows: 52px 1fr` ; corps en `grid-template-columns: 76px 330px 1fr 340px`.

1. **Barre du haut**, de gauche à droite :
   - marque et nom du projet ;
   - petit segmenté Guidé | Libre (12 px, option active en accent-200) ;
   - au centre, le grand segmenté **Conception | Fabrication** (Barlow Condensed 600, 15 px, 6 × 20 px de marge intérieure, bordure `--color-text`) ;
   - à droite, le badge **Contrôle** : bouton secondaire bordé de la couleur de la sévérité la plus haute, avec les compteurs ▲ et ⓘ ;
   - Annuler / Rétablir, Importer, **Exporter** (bouton primaire blueprint, icône de téléchargement), ⋯.
2. **Rail (76 px)**, fond neutral-100 : 8 entrées (icône Lucide de 20 px en trait de 1,5, libellé de 11 px, compteur ◆ en ocre de 10 px).

   | Section | Icône |
   | --- | --- |
   | Site | square-dashed |
   | Tracé | corner-down-right |
   | Découpage | ruler |
   | Balancement | rotate-cw |
   | Marches | layers |
   | Structure | box |
   | Garde-corps | fence |
   | Contexte | shield-check |

   L'entrée active a le fond `--color-bg`, un filet `inset 3px 0 0 var(--color-accent)` et un texte accent-800.
3. **Panneau (330 px)**, ombre `--shadow-md` :
   - titre en h3 de 24 px, boutons Épingler et Fermer ;
   - les champs de la section, selon la spécification de contenu ;
   - une bande de chiffres clés ;
   - la note « Ouvert sur la section où vous étiez dans le parcours guidé ».
4. **Vue** :
   - en haut à gauche, un segmenté Plan | 3D | Élévation ; en haut à droite, − + Recadrer ;
   - en bas, une ligne de chiffres (n, h, g, 2h + g, E, échappée) et « Calculé en N ms » : elle remplace la barre d'état.
5. **Inspecteur (340 px)** : voir les écrans 2a à 2d.

### 2a à 2d — Inspecteur (340 × 848)

Ossature commune, avec 16 px d'écart vertical :

1. surtitre (type d'élément), pastille de sélection orange de 12 × 12 et nom en h3 de 24 px ;
2. tableau des valeurs (`.table`, chiffres tabulaires) ;
3. actions ;
4. « Règles sur cet élément » : cartes blueprint, avec la sévérité en Barlow Condensed 14 px et son icône ;
5. liens vers les éléments voisins ;
6. en pied, la mention indicative (11,5 px).

États :

- **2a — Marche** :
  - valeurs : giron, collet, hauteur, altitude du nez, échappée au nez ;
  - un bloc « Ligne de nez » : angle modifiable, valeur calculée en regard, « Fixer le nez (F) », « Retirer la retouche ». Il **remplace le mode expert actuel** (`views/PlanExpertEditor.tsx`, `lib/expert.ts`) ;
  - ‹ › pour passer à la marche voisine.
- **2b — Pièce** :
  - valeurs : matériau, section, longueur développée, masse, soudures ;
  - actions : Isoler en 3D, Développé → (bascule en Fabrication), DXF R12 ;
  - « Réglages d'atelier », communs à la famille de pièces ;
  - « Assemblée avec ».
- **2c — Règle** :
  - sévérité et titre, phrase d'explication ;
  - jauge mesuré / attendu ;
  - « Où », en étiquettes cliquables ;
  - « Pour corriger » : boutons de correction issus de `lib/fixes.ts`, annulables ;
  - nature, fiabilité, source, puis la référence en police à chasse fixe ;
  - formulaire de surcharge : sévérité en segmenté, justification obligatoire. « Surcharger » est désactivé tant que la justification est vide.
- **2d — Sans sélection** :
  - titre du projet et grille de 9 chiffres clés ;
  - coût, ou le lien « Compléter le profil d'atelier (n / 9) » ;
  - contrôle : compteurs (4 cellules), seules les cartes des groupes non vides, une ligne de liens repliés, la ligne du prédimensionnement ;
  - c'est aussi ce qu'ouvre le badge « Contrôle ».

## Comportements

- **Parcours à l'ouverture** :

  | Situation | Parcours ouvert |
  | --- | --- |
  | Première visite ou démo | Guidé |
  | Projet créé avec l'assistant | Guidé |
  | Projet importé ou repris | Libre |
  | Ensuite | Dernier choix (mémorisé en local) |

  Ne jamais demander « débutant ou expert ? ».
- **Correspondance étape ↔ panneau** : Site → Site ; Forme → Tracé + Balancement ; Découpage → Découpage ; Marches → Marches ; Structure → Structure (hors réglages d'atelier) ; Garde-corps → Garde-corps ; Fabrication → mode Fabrication. Le Contexte de contrôle n'a pas d'étape : il est réglé par l'assistant et modifiable depuis le contrôle.
- **Vue conseillée par étape** : Site → Plan « Site et saisie » ; Forme → Plan coté ; Découpage → Élévation ; Marches, Structure, Garde-corps → 3D ; Fabrication → Développés. C'est une proposition au changement d'étape, que l'utilisateur peut changer.
- **Étape cochée ✓** : vue au moins une fois et aucune règle bloquante rattachée à l'étape.
- **Rail** : un seul panneau ouvert ; si le panneau est épinglé, il reste ouvert au changement de section ; Échap le ferme.
- **Sélection** : partagée (orange) entre toutes les vues et l'inspecteur ; Échap ou un clic dans le vide revient à l'état 2d.
- **Champs Auto** : un seul contrôle « Auto | valeur ». Cliquer sur la valeur la fixe ; l'aide indique que l'on peut revenir à Auto.
- **◆** : valeur par défaut à valider. Le compteur remonte sur le groupe, l'icône du rail et le résumé de l'étape. L'étape 7 en dresse la liste à cocher.
- **Calcul en cours** : le dernier modèle reste affiché ; « Calcul… » apparaît dans la ligne de chiffres sous la vue.
- **Focus clavier** : contour de 2 px en accent, décalé de 2 px. Rail, étapes et segmentés suivent le modèle ARIA des onglets (flèches gauche / droite).

## État à ajouter

Dans `appStore`, hors projet, persisté avec les préférences :

```ts
journey: "guided" | "free";                 // parcours
guidedStep: 1 | 2 | 3 | 4 | 5 | 6 | 7;
visitedSteps: Set<number>;
freePanel: SectionId | null;                 // "site" | "layout" | "stepping" | "balancing" | "treads" | "structure" | "guards" | "compliance"
freePanelPinned: boolean;
workspace: "design" | "fabrication";
hintFreeJourneyDismissed: boolean;
```

La sélection partagée existe déjà ; l'inspecteur s'en sert pour choisir son gabarit (marche, pièce, règle, rien).

## Jetons

Industry (`_ds/…/styles.css`) :

- **Couleurs** :
  - fond `#f2f2f3`, surface `#e9e9ea`, texte `#1d1f20` ;
  - accent `#5980a6` (ramp 100 `#eef6ff`, 200 `#d6ebff`, 300 `#b5d9fd`, 600 `#597ea3`, 700 `#416180`, 800 `#2c455d`, 900 `#1d2d3d`) ;
  - neutres 100 `#f5f5f8`, 200 `#e7e7ea`, 300 `#d4d4d7`, 400 `#b7b7ba`, 500 `#98989b`, 600 `#7a7a7d`, 700 `#5d5d60`, 800 `#424244`, 900 `#2b2b2d` ;
  - filet `color-mix(in srgb, #1d1f20 16%, transparent)`.
- **Typographie** : Barlow Condensed 600 pour les titres (h2 30–32 px, h3 22–25 px), Barlow 400/500 pour le texte (UI à 13 px / 1,45, secondaire à 11,5–12,5 px), surtitres à 10,5 px en majuscules avec un interlettrage de 0,1em.
- **Formes** : angles vifs partout (rayon 0) ; cadres « blueprint » (filet de 1 px et repères + aux coins). Le bouton primaire est le seul objet plein.
- **Espacements** : 3,4 / 6,8 / 10,2 / 13,6 / 20,4 / 27,2 px.
- **Ombres** : sm `0 1px 2px`, md `0 3px 10px`, lg `0 12px 32px`, teintées neutral-900 à 14 %, 16 % et 22 %.

Couleurs fonctionnelles, conservées hors Industry :

| Rôle | Clair | Sombre |
| --- | --- | --- |
| Sélection | `#ff7a1a` | `#ff9a4d` |
| Bloquant | `#b3261e` | `#f28b82` |
| Avertissement | `#9a6200` | `#f0b85a` |
| Conseil | accent-700 `#416180` | `#94bce3` |
| Respecté | `#2e7d32` | `#81c995` |
| Trémie | `#6e40c9` | `#a58cf0` |

Elles sont à centraliser et à partager entre l'interface, la 3D (`three/materials.ts`) et les SVG exportés. Les documents d'atelier restent toujours sur la palette claire.

## Ressources

- Icônes : Lucide, trait de 1,5 (header, rail, sévérités). En React, utiliser `lucide-react` plutôt que les SVG recopiés à la main dans les maquettes.
- `assets/elevation-demo.png` : recadrage de la capture 07, qui ne sert qu'à remplir la maquette. Dans l'application, c'est le SVG d'élévation réel qui s'affiche.

## Fichiers

- `Blondel Parcours Hi-fi.dc.html` : écrans 1a, 1b et inspecteurs 2a–2d.
- `Blondel Contenu Parcours.dc.html` : spécification du contenu (étapes, panneaux, niveaux, libellés, questions ouvertes).
- `Blondel Refonte Wireframes.dc.html` : exploration et scénario.
- `_ds/…` : feuille de style et guide Industry.

## Correspondance avec le code existant

| Nouveau | Existant à réutiliser ou découper |
| --- | --- |
| Formulaires d'étapes et panneaux | `components/ParamsPanel.tsx` (une fonction par section, à extraire en composants autonomes), `StructureSection.tsx`, `GuardsSection.tsx`, `HelicalEditor.tsx`, `fields.tsx` |
| Niveaux Essentiel / Conception / Atelier | nouveau dictionnaire à côté de `lib/paramLabels.ts` (ajouter un `tier` par chemin) |
| Inspecteur Règle, badge Contrôle | `components/CompliancePanel.tsx`, `lib/compliance.ts`, `lib/fixes.ts` |
| Prédimensionnement | `components/PrecheckPanel.tsx` |
| Inspecteur Marche (ligne de nez) | `views/PlanExpertEditor.tsx`, `lib/expert.ts` |
| Inspecteur Pièce, mode Fabrication | `lib/parts.ts`, `views/FlatPatternView.tsx`, `views/BomView.tsx`, `views/CompareView.tsx`, `lib/exportFiles.ts` |
| Barre du haut | `components/Toolbar.tsx`, `ImportMenu.tsx`, `ExportMenu.tsx` |
| Assistant → parcours guidé | `components/AssistantDialog.tsx`, `lib/assistant.ts` |

## Ordre de mise en œuvre suggéré

1. Extraire chaque section de `ParamsPanel` en composant autonome et ajouter le `tier` de chaque champ.
2. Construire le parcours libre (rail, panneau unique, inspecteur dans l'état « sans sélection » 2d).
3. Ajouter les inspecteurs Règle (2c), Pièce (2b) et Marche (2a), puis retirer le mode expert.
4. Ajouter le mode Fabrication.
5. Construire le parcours guidé par-dessus les mêmes composants de section.
6. Unifier les libellés selon le tableau du § 4 de la spécification ; centraliser les couleurs fonctionnelles.
