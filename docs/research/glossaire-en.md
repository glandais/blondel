# Glossaire français → anglais de Blondel

> **À valider** par un utilisateur anglophone du métier (menuisier ou serrurier-métallier). Rédigé le 2026-09-30 pour l'internationalisation (ADR-0007).
> Ce glossaire fixe **un terme anglais par notion** pour les libellés de l'interface et des exports (`packages/i18n/src/locales/en.json`). Il complète le glossaire de la recherche, [`SPEC.md` §9](../SPEC.md#9-glossaire-fr--en), qui donne les définitions et les sources.

## Conventions

- **Anglais britannique par défaut** : les normes européennes (EN 1995, EN 1993, EN 1090, EN ISO 14122) et le Building Regulations Approved Document K emploient les termes britanniques (_going_, _string_, _headroom_). La colonne « US » donne l'usage américain quand il diffère ; l'interface ne l'emploie pas.
- Orthographe britannique pour les mots courants (_colour_, _metre_), sauf dans les identifiants techniques.
- Les **titres et références de normes** restent dans leur langue d'origine (« NF DTU 36.3 », « NF P01-012 », « arrêté du 1er août 2006 ») ; on peut ajouter une explication courte entre parenthèses (« French building code »).
- Les **repères** de pièces (`M5`, `L1`) ne sont pas traduits.
- « _(usage)_ » : traduction courante du métier sans source lue dans la recherche.
- **Sources citées** du contrôle de conception (décision de l'utilisateur du 2026-10-06, QUESTIONS A26 (b)) : traduites en anglais, une traduction par source (`source_en` dans `docs/research/rules.yaml` ; clés `compliance.source.*` et `catalog.source.*` pour les contrôles de plugin, le prédimensionnement, le catalogue de profilés et le profil d'atelier). Les titres et références restent dans leur langue (« NF DTU 36.3 P3 §6.2 », « NF EN 1991-1-1/NA », « CNC2M N0169 », numéros de sources « [4] », chemins `docs/research/…`) ; un arrêté est cité « Arrêté (French ministerial order) 24/12/2015 art. 12 », une circulaire « Circulaire 2007-53 (French ministerial circular…) », le règlement de sécurité « ERP fire safety regulations CO 55 §1 ». « consulté le » → « accessed » (date ISO dans les deux langues) ; « via » et « [ANALYSE] » → « via », « [ANALYSIS] » ; « usage » → « common practice » ; « (comparaison) » → « (comparison) ». Seuls « Arrêté(s) », « arrêté » et « Légifrance » restent en français dans une source anglaise (liste blanche du test anglais, `packages/exports/src/testing/french.ts`).

## Tracé et dimensions

| Français                           | Anglais (interface)            | US (si différent)             | Remarque                                               |
| ---------------------------------- | ------------------------------ | ----------------------------- | ------------------------------------------------------ |
| Escalier                           | Staircase, stair               | —                             | « stair » dans les libellés courts                     |
| Tracé                              | Layout                         | —                             | Étape du pipeline                                      |
| Épure                              | Setting-out drawing _(usage)_  | Layout drawing                | Tracé indépendant de la structure                      |
| Volée                              | Flight                         | —                             |                                                        |
| Palier                             | Landing                        | —                             |                                                        |
| Palier de repos                    | Intermediate landing           | —                             |                                                        |
| Marche                             | Step (ensemble), tread (dessus)| —                             | « tread » pour la pièce                                |
| Marche de départ                   | Bottom step                    | Starting step                 |                                                        |
| Marche palière                     | Top step / landing tread _(usage)_ | —                         |                                                        |
| Hauteur de marche (h)              | Rise                           | Riser height                  |                                                        |
| Hauteur à monter (H)               | Total rise                     | —                             | Sol fini à sol fini                                    |
| Giron (g)                          | Going                          | Run, tread depth              |                                                        |
| Reculement                         | Total going                    | Total run                     |                                                        |
| Emmarchement                       | Stair width                    | —                             | Entre faces internes des limons                        |
| Largeur de passage                 | Clear width                    | —                             |                                                        |
| Loi de Blondel (2h + g)            | Blondel formula (2R + G)       | —                             | « Blondel » est un nom propre ; dans les cartouches des dessins : « 2 × rise + going » (voir Notations) |
| Pente                              | Pitch                          | Slope                         |                                                        |
| Ligne de pente                     | Pitch line                     | —                             |                                                        |
| Ligne de foulée                    | Walking line                   | Walkline                      |                                                        |
| Nez de marche                      | Nosing                         | —                             |                                                        |
| Ligne des nez                      | Nosing line                    | —                             |                                                        |
| Débord du nez                      | Nosing projection              | —                             |                                                        |
| Nez d'arrivée                      | Top nosing                     | —                             | Dernier nez, au palier haut (A28)                      |
| Palier d'arrivée                   | Top landing                    | —                             |                                                        |
| Contremarche                       | Riser                          | —                             |                                                        |
| Recouvrement                       | Overlap                        | —                             |                                                        |
| Échappée                           | Headroom                       | —                             | Hauteur libre verticale                                |
| Trémie                             | Stairwell opening              | Stair opening                 |                                                        |
| Chevêtre                           | Trimmer                        | Header                        |                                                        |
| Mur porteur / non porteur          | Load-bearing / non-load-bearing wall | —                       |                                                        |
| Sol fini                           | Finished floor level (FFL)     | Finished floor                |                                                        |
| Épaisseur de plancher              | Floor thickness                | —                             |                                                        |
| Revêtement                         | Floor finish                   | Flooring                      |                                                        |
| Implantation                       | Setting out                    | Layout                        |                                                        |
| Escalier droit                     | Straight stair                 | —                             |                                                        |
| Quart tournant (quartier tournant) | Quarter-turn (winding) stair   | —                             | « quartier tournant » = la zone tournante : winder section |
| Demi-tournant                      | Half-turn stair                | —                             |                                                        |
| Escalier hélicoïdal                | Spiral stair                   | —                             | « helical stair » pour un vide central sans fût        |
| Tournant, zone tournante           | Turn, winder section           | —                             |                                                        |
| Jour                               | Well                           | —                             | Vide côté intérieur ; « jour nul » : no well           |
| Noyau, fût                         | Centre column                  | Center pole                   | « newel » est réservé au poteau                         |
| Côté mur / côté jour               | Wall side / well side          | —                             |                                                        |
| À gauche / à droite (sens de montée)| Left-hand / right-hand         | —                             |                                                        |

## Notations des cartouches

Décision de l'utilisateur du 2026-10-06 (QUESTIONS A26 (a)) : une lettre ne désigne qu'une grandeur dans un même cartouche.

| Grandeur                    | Français        | Anglais (cartouche)            | Remarque                                                      |
| --------------------------- | --------------- | ------------------------------ | ------------------------------------------------------------- |
| Rayon                       | R               | R                              | Préfixe d'une cote de rayon (« R 800 »), convention ISO 129-1 |
| Hauteur de marche           | h               | rise (en toutes lettres)       | « 15 rises of 175.0 mm », « 15 × rise 175.0 mm », « First rise = … » ; jamais « R = » ni « R1 » |
| Loi de Blondel              | 2h + g          | 2 × rise + going               | Cartouches du plan et de l'élévation ; « 2R + G » reste le nom de la formule ailleurs (interface, règles), où aucun rayon n'est coté |
| Giron                       | g               | G                              | « Going G = … »                                               |
| Hauteur à monter            | H               | H                              | « Total rise H = … »                                          |
| Rayon extérieur / intérieur (hélicoïdal) | R_e, r | R_e, r                        | Indice explicite : pas d'ambiguïté avec la hauteur            |

En français, rien ne change : la hauteur de marche s'écrit déjà h (h1 pour la première), R est réservé au rayon.

## Balancement

| Français                              | Anglais (interface)           | US | Remarque                                    |
| ------------------------------------- | ----------------------------- | -- | ------------------------------------------- |
| Balancement                           | Winder balancing              | —  |                                             |
| Marche balancée, dansante             | Balanced winder               | —  | « winder » seul dans les libellés courts ; « dancing step » dans les textes anciens |
| Marche rayonnante                     | Radial winder _(usage)_       | —  |                                             |
| Collet                                | Narrow end                    | —  |                                             |
| Méthode du rayonnant (M0)             | Radial method                 | —  |                                             |
| Progression arithmétique des collets  | Arithmetic progression of narrow ends | — |                                      |
| Herse                                 | Herse method (French graphical method) | — | Nom conservé, explication ajoutée   |
| Développement du limon                | String development method     | —  |                                             |
| Rotation paramétrée                   | Parametric rotation           | —  |                                             |
| Régularité                            | Evenness                      | —  |                                             |
| Confort                               | Comfort                       | —  |                                             |

## Structures bois et métal

| Français                              | Anglais (interface)                 | US                      | Remarque                                         |
| ------------------------------------- | ----------------------------------- | ----------------------- | ------------------------------------------------ |
| Structure                             | Structure                           | —                       |                                                  |
| Limon                                 | String                              | Stringer                |                                                  |
| Limon mural / limon de jour           | Wall string / outer string          | Wall stringer / outer stringer |                                           |
| Limon à la française                  | Closed string (housed)              | Housed stringer         | Marches encastrées                               |
| Limon à l'anglaise, crémaillère       | Cut string                          | Cut (open) stringer     | Aussi « open string » : marches posées sur le limon |
| Limon central                         | Mono-stringer _(usage)_             | —                       |                                                  |
| Limon central bois                    | Timber mono-stringer                | —                       | Structure `wood-central` (A29, vague 2)          |
| Crémaillère centrale                  | Central cut string                  | —                       | Crémaillère unique sous l'axe de l'emmarchement  |
| Limon débillardé                      | Wreathed string _(usage)_           | —                       |                                                  |
| Débillardement, débillarder           | Wreathing _(usage)_                 | —                       |                                                  |
| Délardement, marche délardée          | Soffit chamfering _(usage)_         | —                       | Délardement du dessous des marches (soffite continu) |
| Courbe rampante                       | Wreath                              | —                       |                                                  |
| Jarret                                | Knee _(usage)_                      | —                       | Changement brusque de pente du limon ou de la main courante |
| Point de naissance                    | Springing point _(usage)_           | —                       |                                                  |
| Raccord, adoucissement                | Easing                              | —                       |                                                  |
| Poteau                                | Newel post                          | —                       | « newel » dans les libellés courts               |
| Entaille                              | Housing (bois), notch (métal)       | Dado (bois)             | « Fond des entailles » : housing bottom          |
| Entaille arrière                      | Rear housing                        | —                       | Arrière de la marche logé dans la dent suivante  |
| Assise (d'une crémaillère)            | Seat                                | —                       | Appui horizontal de la marche                    |
| Dent (d'une crémaillère)              | Tooth                               | —                       |                                                  |
| Joue (de bois restant)                | Cheek                               | —                       |                                                  |
| Tenon                                 | Tenon                               | —                       |                                                  |
| Mortaise                              | Mortise                             | —                       | Orthographe britannique « mortice » acceptée     |
| Assemblage à queues                   | Dovetail joint                      | —                       |                                                  |
| Enture                                | Scarf joint                         | —                       |                                                  |
| Boulon d'escalier                     | Handrail bolt _(usage)_             | —                       |                                                  |
| Lamellé-collé                         | Glulam                              | —                       |                                                  |
| Lamellé-collé cintré                  | Curved glulam                       | —                       | Lamelles cintrées sur moule                      |
| Lamelle                               | Lamination                          | —                       | Épaisseur de lamelle : lamination thickness      |
| Moule de cintrage                     | Bending form                        | —                       |                                                  |
| Joint de colle                        | Glue line                           | Bond line               | Boulons du limon central bois hors du joint central |
| Entraxe (de perçages)                 | Spacing (of holes)                  | Pitch                   | Entraxe minimal des perçages de la poutre        |
| Bois massif                           | Solid timber                        | Solid wood / lumber     |                                                  |
| Section, équarrissage                 | Section                             | —                       |                                                  |
| Plat (acier)                          | Flat bar / plate                    | —                       | Limon en plat : plate string                     |
| Tôle                                  | Sheet (≤ 3 mm), plate (> 3 mm)      | —                       |                                                  |
| Tôle pliée                            | Folded plate, press-braked plate    | Bent plate              |                                                  |
| Pliage                                | Bending (presse plieuse : press brake) | —                    |                                                  |
| Rayon de pliage                       | Bend radius                         | —                       |                                                  |
| Tôle roulée, roulage                  | Rolled plate, plate rolling         | —                       |                                                  |
| Cintrage                              | Bending (of sections / tubes)       | —                       |                                                  |
| Tôle larmée                           | Chequer plate                       | Diamond plate           |                                                  |
| Caillebotis                           | Grating                             | —                       |                                                  |
| Cornière                              | Angle                               | —                       |                                                  |
| Profilé du commerce (UPN, IPN, IPE, HEA) | Rolled section (channel UPN, I-beam IPN / IPE, H-beam HEA) | Rolled shape | Désignations européennes conservées |
| Platine                               | Base plate                          | —                       |                                                  |
| Sabot                                 | (Steel) shoe                        | —                       | Tôle pliée en U au pied ou en tête d'une poutre bois |
| Console                               | Bracket                             | —                       |                                                  |
| Plat d'appui (d'une console)          | Bearing plate                       | —                       | Limon central : bracket bearing plate            |
| Caisson (tôles soudées)               | Box section                         | Box girder              | Limon central en caisson                         |
| Flasque (de caisson)                  | Web                                 | Side plate              | Âme verticale roulée du caisson                  |
| Semelle (de caisson)                  | Flange                              | —                       | Semelle haute : top flange ; basse : bottom flange |
| Entretoise (de caisson)               | Diaphragm                           | Stiffener               |                                                  |
| Tube rectangulaire                    | Rectangular hollow section (RHS), rectangular tube | Rectangular tubing | Désignation H × b × t              |
| Évent (corps creux galvanisé)         | Vent hole                           | —                       |                                                  |
| Patte de fixation                     | Fixing lug _(usage)_                | Mounting tab            |                                                  |
| Soudure d'angle                       | Fillet weld                         | —                       |                                                  |
| Découpe laser                         | Laser cutting                       | —                       |                                                  |
| Fibre neutre                          | Neutral axis                        | —                       |                                                  |
| Classe d'exécution (EXC)              | Execution class (EXC)               | —                       | EN 1090-2                                        |
| Porte-à-faux                          | Cantilever                          | —                       |                                                  |
| Flèche                                | Deflection                          | —                       |                                                  |
| Fausse marche                         | Dummy tread _(usage)_               | —                       |                                                  |

## Garde-corps et mains courantes

| Français                  | Anglais (interface)      | US              | Remarque                         |
| ------------------------- | ------------------------ | --------------- | -------------------------------- |
| Garde-corps               | Guarding                 | Guardrail       | « guard » dans les libellés courts |
| Rampe (d'escalier)        | Balustrade               | Banister        |                                  |
| Main courante             | Handrail                 | —               |                                  |
| Main courante murale      | Wall handrail            | —               |                                  |
| Lisse                     | Rail                     | —               | Lisse basse : bottom rail        |
| Balustre, barreau         | Baluster                 | Spindle         |                                  |
| Remplissage               | Infill                   | —               |                                  |
| Volute                    | Volute                   | —               |                                  |
| Zone d'activité (NF P01-012) | Activity zone (NF P01-012 term) | —    | Terme normatif français          |
| Hauteur de protection     | Guarding height          | Guard height    |                                  |
| Verre feuilleté           | Laminated glass          | —               |                                  |

## Fabrication, plans et exports

| Français                     | Anglais (interface)          | US                  | Remarque                              |
| ---------------------------- | ---------------------------- | ------------------- | ------------------------------------- |
| Pièce                        | Part                         | —                   |                                       |
| Repère                       | Mark                         | Part mark           | Les valeurs (`M5`) ne sont pas traduites |
| Développé                    | Flat pattern (tôle, acier), development (limon bois) | —  | Décision du 2026-10-06 (A26 (a)) : « Development » pour le développé d'un limon ou d'une crémaillère en bois (titres de dessin et de page, inspecteur, gabarit) ; « Flat pattern » pour la tôle, l'acier et les libellés génériques (onglet, menu d'export, nomenclature) ; point unique : `packages/exports/src/flatTerms.ts` |
| Gabarit                      | Template                     | —                   |                                       |
| Calibre rallongé             | Face mould                   | Face mold           |                                       |
| Calepinage                   | Nesting                      | —                   |                                       |
| Plan                         | Plan (view), drawing         | —                   |                                       |
| Élévation                    | Elevation                    | —                   |                                       |
| Coupe                        | Section                      | —                   |                                       |
| Échelle                      | Scale                        | —                   |                                       |
| Cote, coter                  | Dimension, to dimension      | —                   |                                       |
| Cotation                     | Dimensioning                 | —                   |                                       |
| Cartouche                    | Title block                  | —                   |                                       |
| Nomenclature                 | Bill of materials (BOM)      | —                   |                                       |
| Fiche de débit               | Cutting list                 | Cut list            |                                       |
| Fiche de pose                | Installation sheet           | —                   |                                       |
| Débit (bois)                 | Cutting (stock)              | —                   |                                       |
| Brut / fini                  | Rough / finished (dimension) | —                   |                                       |
| Calque (DXF)                 | Layer                        | —                   |                                       |
| Contour                      | Outline                      | —                   |                                       |
| Perçage                      | Hole, drilling               | —                   |                                       |
| Ligne de pliage              | Bend line                    | —                   |                                       |
| Matériau                     | Material                     | —                   |                                       |
| Épaisseur                    | Thickness                    | —                   |                                       |
| Quantité                     | Quantity                     | —                   |                                       |
| Masse                        | Mass (weight)                | Weight              |                                       |
| Chiffrage, coût              | Costing, cost                | Estimate            |                                       |
| Aperçu 3D                    | 3D preview                   | —                   |                                       |

## Contrôle de conception

| Français                     | Anglais (interface)          | Remarque                                              |
| ---------------------------- | ---------------------------- | ----------------------------------------------------- |
| Contrôle de conception       | Design check                 | Jamais « compliance » seul : pas de certification     |
| Règle                        | Rule                         |                                                       |
| Constat                      | Finding                      |                                                       |
| Bloquant                     | Blocking                     |                                                       |
| Avertissement                | Warning                      |                                                       |
| Conseil                      | Advice                       |                                                       |
| Non évaluée                  | Not evaluated                |                                                       |
| Rétrogradée                  | Downgraded                   |                                                       |
| Réglementaire / normatif / métier | Regulatory / standard / trade practice |                                  |
| Confiance (élevée, moyenne, faible) | Confidence (high, medium, low) |                                          |
| « À valider »                | “To be validated”            | Valeurs non sourcées (profil d'atelier, plugins)      |
| Profil d'atelier             | Workshop profile             |                                                       |
| Prédimensionnement           | Preliminary sizing           |                                                       |
| Profil strict / souple       | Strict / Lenient profile     | « Profile Lenient » dans une phrase (dossier PDF) ; libellé traduit, jamais l'identifiant (`strict`, `souple`) |
| Source citée                 | Source                       | Traduite, titres de normes dans leur langue (voir Conventions) |
| Profil d'atelier Blondel (valeur par défaut à valider) | Blondel workshop profile (default value to be validated) | Source des contrôles de fabrication |
| ERP (établissement recevant du public) | Public building (French ERP category) | Sigle conservé entre parenthèses       |
| Logement                     | Dwelling                     |                                                       |
| Assistant                    | Wizard                       |                                                       |
| Typologie                    | Stair type                   |                                                       |

## Visserie

Termes fixés avec la modélisation de la visserie (décision de l'utilisateur du 2026-10-06, QUESTIONS A27) ; libellés `fastener.*` des dictionnaires.

| Français                         | Anglais (interface)         | US                 | Remarque                                  |
| -------------------------------- | --------------------------- | ------------------ | ----------------------------------------- |
| Visserie                         | Fixings                     | Fasteners          | Groupe du mode Fabrication, page du dossier, liste CSV |
| Boulon                           | Bolt                        | —                  |                                           |
| Vis à métaux                     | Machine screw               | —                  |                                           |
| Vis à bois                       | Wood screw                  | —                  |                                           |
| Tire-fond                        | Coach screw                 | Lag screw          |                                           |
| Cheville mécanique               | Expansion anchor            | —                  |                                           |
| Scellement chimique              | Chemical anchor             | —                  |                                           |
| Cheville pour cloison creuse     | Cavity wall anchor          | Hollow-wall anchor |                                           |
| Classe 4.6, 8.8, 10.9            | Grade 4.6, 8.8, 10.9        | —                  | « grade 8.8 » dans une désignation        |
| Inox A2-70, A4-70                | Stainless A2-70, A4-70      | —                  |                                           |
| Acier zingué                     | Zinc-plated steel           | —                  |                                           |
| Galvanisé à chaud                | Hot-dip galvanised          | Hot-dip galvanized |                                           |
| Liste de visserie                | Fixings schedule            | Fastener schedule  | Export CSV, page du dossier               |
| Assemblage d'origine             | Joint                       | —                  |                                           |
| Nature (d'un élément de visserie) | Type                       | —                  |                                           |
| Classe ou matière                | Grade or material           | —                  |                                           |
| Diamètre nominal                 | Nominal diameter            | —                  |                                           |
| Jeu de perçage (minimal)         | (Minimum) hole clearance    | —                  |                                           |
| Série des diamètres nominaux     | Nominal diameter series     | —                  | Saisie « 6 ; 8 ; 10 » (point-virgule)     |
| Poteau de garde-corps sur l'escalier bois / métal | Guard post to timber / steel stair | — | Assemblage selon le support (A27)  |
| Mur non décrit par le site : porteur | Wall not described by the site: load-bearing | — | Réglage d'atelier « à valider » |
| Entraxe maximal des supports de main courante | Maximum handrail bracket spacing | — |                              |
| Quantité par point de fixation   | Quantity per fixing point   | —                  |                                           |
| Mur porteur / cloison            | Load-bearing / non-load-bearing wall | —         |                                           |
| ETE (évaluation technique européenne) | ETA                    | —                  | Fiche du fabricant de chevilles           |
