/**
 * Paramètres du plugin `wood-central` : limon central bois (QUESTIONS A29, décisions de
 * l'utilisateur du 2026-10-06, vague 2 ; SPEC §2.4 ; C §1.4 à §1.6).
 *
 * Une **crémaillère centrale** unique sous les marches, à l'axe de l'emmarchement par défaut
 * (trace de `centralTrace.ts`, partagée avec `steel-central`) : poutre bois massif ou en couches
 * collées (lamellé-collé) sur un escalier droit, lamellé-collé **cintré sur moule** sur les
 * tournants et l'hélicoïdal (lamelles verticales cintrées en plan, règle k_r de SPEC §2.4 /
 * C-B-08, `LAMELLE_CINTRE_KR`). Marches posées sur les assises de la crémaillère, logées à
 * l'arrière dans la dent suivante (« entaille arrière », C §1.5 [54]) et boulonnées au travers de
 * la poutre (boulons de 10 ou 12 mm avec écrou, C §1.5 [54]) ; sabots métalliques en pied et en
 * tête (A29 n° 5).
 *
 * Suites du 2026-10-09 (QUESTIONS A32 à A34) : filière des couches empilées sur une trace
 * courbe (`section.curvedMethod`, A33 (e)), platine à âme noyée (`anchors.kind`,
 * `anchors.plate`, A33 (f), A34 (c)), tire-fonds des marches basses (`lagScrews`, A34 (a)),
 * entraxes et pinces de l'EC5 (`bolts.minSpacing`, `bolts.edgeDistance`, A34 (b)) ; sources :
 * C §1.11.
 *
 * Décisions du 2026-10-09 (QUESTIONS A35) : âme de pied prolongée (`anchors.plate.footWebLength`,
 * (a)), pente de fil maximale des planches d'une couche (`section.maxGrainSlope`, (h)), entraxe
 * et pince des tire-fonds au plus sévère des règles latérales et axiales (`lagScrews.minSpacing`,
 * `lagScrews.endDistance`, (l)), réduction de Hankinson du prédimensionnement des couches
 * empilées (`grainAngle`, (j)) ; sources : C §1.11.
 *
 * Contrat partagé de la vague « limon central bois » : la poutre (`woodCentralBeam.ts`) lit
 * `material`, `strengthClass`, `trace`, `section`, `notch`, `bolts`, `anchors` ; le plugin
 * (`woodCentral.ts`) lit tout ; l'interface (`apps/web`) présente chaque chemin. Noms et sens
 * **figés** pendant la vague (un ajout éventuel est signalé).
 *
 * Valeurs par défaut : sources de docs/research/C-structures.md citées ; toute valeur sans
 * source est un paramètre **« à valider »** (◆ dans l'interface), jamais une constante cachée.
 */
import { z } from "zod";
import { PrecheckSettingsSchema } from "../precheck/settings.js";
import { STEEL_GRADES } from "../workshop/metal.js";
import { WOOD_MATERIALS } from "../workshop/profile.js";

const mmInt = z.number().int();
const mmPos = mmInt.positive();
const mmNonNeg = mmInt.nonnegative();
const auto = <T extends z.ZodType>(s: T) => z.union([s, z.literal("auto")]).default("auto");

/**
 * Section de la poutre : lamellé-collé (couches collées droites sur un escalier droit, C §1.5
 * [7][8] ; lamelles cintrées sur moule sur une trace courbe, C §1.6 [7]) ou bois massif d'une
 * pièce (escalier droit seulement : le massif courbe par tronçons, C §1.6 [6], n'est pas pris en
 * charge, `unsupportedOptions`).
 */
export const WOOD_CENTRAL_SECTION_KINDS = ["glulam", "solid"] as const;
export type WoodCentralSectionKind = (typeof WOOD_CENTRAL_SECTION_KINDS)[number];

/** Classe de résistance du tableau FCBA (même sémantique que `wood-cut.strengthClass`). */
export const WOOD_CENTRAL_STRENGTH_CLASSES = ["C30", "D40", "unknown", "auto"] as const;

/**
 * Filière de la poutre lamellé-collé sur une trace courbe (QUESTIONS A33 (e), décision du
 * 2026-10-09 ; C §1.6 [7][8], §1.11) :
 * - `mould` : lamelles verticales cintrées sur moule (plis minces, contrôle k_r
 *   `LAMELLE_CINTRE_KR`, débit en placages, A34 (e)) ;
 * - `stacked` : couches **horizontales** découpées selon le plan, empilées et collées puis
 *   délardées au profil, sans moule (aucun cintrage : k_r = 1) ; chaque couche est une pièce
 *   composante (`Part.componentOf`) avec son gabarit et son débit.
 * `auto` (réglage) : `stacked` si la largeur b dépasse `section.mouldMaxWidth`, sinon `mould`.
 */
export const WOOD_CENTRAL_CURVED_METHODS = ["mould", "stacked"] as const;
export type WoodCentralCurvedMethod = (typeof WOOD_CENTRAL_CURVED_METHODS)[number];

/**
 * Ancrage de la poutre en pied et en tête (A29 n° 5 « sabots ou platines métalliques » ;
 * QUESTIONS A33 (f), A34 (c), décisions du 2026-10-09) :
 * - `shoe` : sabot en tôle pliée en U (`woodCentralShoes.ts`) ;
 * - `embeddedPlate` : platine à âme noyée — platine d'appui chevillée au sol (pied) ou fixée au
 *   chevêtre (tête), âme (plat soudé en T) noyée dans un trait de scie de la poutre et brochée
 *   au travers du bois (`woodCentralPlates.ts`, C §1.11 [80]).
 * `auto` (réglage) : platine à âme noyée sur une poutre cintrée (trace tournante ou
 * hélicoïdale), sabot en U sur une poutre droite.
 */
export const WOOD_CENTRAL_ANCHOR_KINDS = ["shoe", "embeddedPlate"] as const;
export type WoodCentralAnchorKind = (typeof WOOD_CENTRAL_ANCHOR_KINDS)[number];

export const WoodCentralParamsSchema = z.object({
  /**
   * Essence de la poutre (lamelles ou massif) ; masse volumique du profil d'atelier. Chêne par
   * défaut, comme `wood-cut` (classe FCBA `auto` : D40, hypothèse à valider).
   */
  material: z.enum(WOOD_MATERIALS).default("wood-oak"),
  /**
   * Classe de résistance pour le tableau FCBA (`CREMAILLERE_REGLE_MOYENS`) ; `auto` : C30 pour
   * le pin, D40 pour chêne, hêtre, frêne, inconnue pour `wood-glulam` (mêmes hypothèses « à
   * valider » que `wood-cut`). Classes de lamellé-collé (GL…) non sourcées : QUESTIONS A33.
   */
  strengthClass: z.enum(WOOD_CENTRAL_STRENGTH_CLASSES).default("auto"),
  trace: z
    .object({
      /**
       * Décalage de l'axe de la poutre par rapport à l'axe de l'emmarchement, mm, positif vers
       * la **gauche** dans le sens de la montée (0 : axe de l'emmarchement, A29 n° 2, **à
       * valider**). Même sens que `steel-central.trace.lateralOffset`.
       */
      lateralOffset: mmInt.default(0),
    })
    .prefault({}),
  section: z
    .object({
      kind: z.enum(WOOD_CENTRAL_SECTION_KINDS).default("glulam"),
      /**
       * Largeur b de la poutre (épaisseur de la crémaillère centrale), mm : 88 = 2 × 44, épaisseur
       * tabulée par FCBA et épaisseur usuelle des limons (C §1.4 [1][53]) multipliée par le
       * facteur de la crémaillère centrale (C §1.4, §1.5 : « × 2 ») ; **à valider**. Contrôlée
       * par `CREMAILLERE_REGLE_MOYENS` (tableau lu à b / `facteur_centrale`).
       */
      width: mmPos.default(88),
      /**
       * Reste sous entaille h_res (distance perpendiculaire à la sous-face entre le fond des
       * entailles et la sous-face), mm ; `auto` : distance exigée par le tableau FCBA à
       * b / `facteur_centrale` quand il est exploitable (escalier droit, classe connue…), sinon
       * `residualFallback`. Même sémantique que `wood-cut.residual`.
       */
      residual: auto(mmPos),
      /** Reste sous entaille retenu quand le tableau FCBA n'est pas exploitable (à valider). */
      residualFallback: mmPos.default(180),
      /**
       * Épaisseur **maximale** t d'une lamelle (lamellé-collé), mm : la poutre compte n = ⌈b / t⌉
       * lamelles **égales** d'épaisseur b / n (≤ t), de sorte que leur composition redonne b.
       * `auto` : sur une trace droite, couches collées les plus épaisses que l'atelier débite
       * (t_max = plus forte épaisseur de débit du profil moins la surcote de corroyage), en
       * nombre **impair** quand des organes de marche sont posés (`bolts.perTread` > 0 : organe
       * au milieu de la couche centrale, hors des joints de colle, QUESTIONS A35 (f)) ; une
       * épaisseur saisie est respectée (n = ⌈b / t⌉, pair compris, avec le décalage d'une
       * demi-couche et son constat de pince s'il y a lieu) ; sur une
       * trace courbe, plus grande épaisseur entière donnant r_in / t ≥ `recommande` de
       * `LAMELLE_CINTRE_KR` (k_r = 1), 1 mm au moins. Sans effet sur une section massive.
       */
      lamellaThickness: auto(mmPos),
      /**
       * Plis minces (SPEC Q10) : lamelle cintrée d'épaisseur ≤ ce seuil ⇒ avertissement « hors
       * NF EN 14080, justification requise » (C §1.6 ⚠️ : plis de 1 à 7 mm [7]) ; **à valider**.
       */
      thinPlyMax: mmPos.default(7),
      /**
       * Filière sur une trace courbe (`WOOD_CENTRAL_CURVED_METHODS`) ; `auto` : couches
       * empilées au-delà de `mouldMaxWidth`, cintrage sur moule sinon (A33 (e)). Sans effet
       * sur une trace droite ou une section massive.
       */
      curvedMethod: z.enum([...WOOD_CENTRAL_CURVED_METHODS, "auto"]).default("auto"),
      /**
       * Largeur b au-delà de laquelle `auto` choisit les couches empilées, mm : 60 (C §1.6 [7] :
       * moule « recommandé si l'épaisseur est < 60 mm » ; [8] : couches collées « pour les
       * limons de plus de 60 mm ») ; **à valider**.
       */
      mouldMaxWidth: mmPos.default(60),
      /**
       * Couches empilées : épaisseur finie **maximale** t_max d'une couche horizontale, mm.
       * Les joints sont calés sur les assises (QUESTIONS A35 (g), décision du 2026-10-09) :
       * chaque intervalle de hauteur h entre deux niveaux (base de l'empilement, dessous des
       * marches) compte ⌈h / t_max⌉ couches égales, de sorte que les crans ne sont pas coupés.
       * `auto` : plus forte épaisseur de débit du profil d'atelier moins la surcote de corroyage
       * (comme les couches droites) ; aucune source sur l'épaisseur des couches (C §1.11) :
       * **à valider**.
       */
      layerThickness: auto(mmPos),
      /**
       * Couches empilées : surcote de délardement de chaque couche, mm, ajoutée en plan de
       * chaque côté de la poutre (faces) et à chaque bout de la couche, retirée au délardement.
       * `auto` : surcote de corroyage du profil d'atelier (`wood.planingAllowance`) ; aucune
       * source (C §1.11) : **à valider**.
       */
      dressingAllowance: auto(mmNonNeg),
      /**
       * Couches empilées : pente de fil maximale d'une planche, en % (écart en plan entre le fil
       * d'une planche, pris selon sa corde, et la tangente à la trace sur toute sa longueur ;
       * angle = atan(valeur / 100)). Au-delà, ou quand le gabarit d'une couche dépasse la plus
       * large planche du profil d'atelier, la couche est composée de plusieurs planches aboutées
       * (ou collées sur chant), chacune au débit (QUESTIONS A35 (h), décision du 2026-10-09).
       * Décimal (non lié aux mm entiers). 20 % (1:5) : pente de fil générale admise pour le chêne
       * en **petites sections** (épaisseur de 22 à 100 mm, celle des couches), toutes classes
       * visuelles (NF B 52-001-1, non lue, via FNB fiche C10, C §1.11 [82]) ; 1:10 en grosses
       * sections (> 100 mm) ; relecture A35 ; **à valider** (QUESTIONS A36 (7)).
       */
      maxGrainSlope: z.number().positive().max(100).default(20),
    })
    .prefault({}),
  notch: z
    .object({
      /**
       * Entaille arrière (C §1.5 [54] : « entaille arrière de la marche dans le limon ») :
       * profondeur d'engagement de l'arrière de la marche dans la dent suivante, mesurée le
       * long de la trace, mm. `auto` : profondeur d'encastrement du profil d'atelier
       * (`wood.housingDepth`, 15 mm, à valider) ; contrôlée par `LIMON_ENTAILLE_MIN` (≥ 14 mm,
       * NF EN 16481). 0 : marche simplement posée sur l'assise.
       */
      rearDepth: auto(mmNonNeg),
    })
    .prefault({}),
  bolts: z
    .object({
      /**
       * Boulons traversants par marche (C §1.5 [54] : boulons de 10 ou 12 mm qui traversent le
       * limon, avec écrou ; source faible) : nombre, **à valider**. Verticaux, de la face du
       * dessus de la marche à la sous-face de la poutre, répartis le long de l'assise.
       */
      perTread: mmNonNeg.default(2),
      /** Diamètre de perçage, mm (M10 : 11 mm, jeu 1 mm ; C §1.5 [54] « 10 ou 12 mm »), à valider. */
      holeDiameter: mmPos.default(11),
      /**
       * Distance mini d'un perçage aux bouts de l'assise (faces des dents, entaille arrière), mm.
       * `auto` : a3,c = 4·d, extrémité non chargée d'un boulon (EN 1995-1-1 § 8.5.1.1 via
       * C §1.11 [71]), d = diamètre nominal lu sur le perçage (`nominalDiameterFor`, profil de
       * visserie) ; borne « tous angles » **à valider** (QUESTIONS A34 (b)).
       */
      edgeDistance: auto(mmPos),
      /**
       * Entraxe minimal de deux perçages de la poutre (boulons ou tire-fonds d'une même marche,
       * avec les perçages d'ancrage), mm. `auto` : a1 = (4 + |cos α|)·d au plus défavorable,
       * soit 5·d (EN 1995-1-1 § 8.5.1.1 via C §1.11 [71]), d nominal lu sur le perçage ; **à
       * valider** (QUESTIONS A34 (b)).
       */
      minSpacing: auto(mmPos),
      /** Dépassement sous la poutre (rondelle, écrou, filet), ajouté à la longueur, à valider. */
      protrusion: mmNonNeg.default(20),
      /** Pas d'arrondi supérieur de la longueur (longueurs commerciales), à valider. */
      lengthStep: mmPos.default(10),
    })
    .prefault({}),
  /**
   * Tire-fonds des marches où le boulon traversant ne passe pas (sous-face trop basse pour
   * l'écrou au-dessus de la coupe au sol, QUESTIONS A34 (a), décision du 2026-10-09) : vissés
   * depuis le dessus de la marche dans la poutre, au perçage de passage `bolts.holeDiameter`
   * dans la marche (diamètre nominal lu sur ce perçage, comme les boulons) et à l'avant-trou
   * `pilotDiameter` dans la poutre ; mêmes nombre, pinces et entraxe que les boulons. Longueur =
   * épaisseur de marche + ancrage, ancrage borné par le bois disponible sous l'assise moins
   * `tipCover`, arrondie au pas inférieur `bolts.lengthStep`, au plus `maxLength`.
   */
  lagScrews: z
    .object({
      /**
       * Avant-trou dans la poutre, mm (C §1.11 [78] : 6,5 mm pour un tire-fond Ø10), arrondi à
       * 7 mm faute de saisie décimale (mm entiers, ADR-0003), à valider (QUESTIONS A35 (l)).
       */
      pilotDiameter: mmPos.default(7),
      /**
       * Ancrage minimal dans la poutre, mm (C §1.11 [78] : « profondeur d'ancrage d'au moins
       * 50 mm » pour un Ø10) ; en dessous, pas de tire-fond (constat
       * `FAB_LIMON_CENTRAL_BOIS_BOULONS`). À valider.
       */
      minAnchorage: mmPos.default(50),
      /** Bois laissé sous la pointe (au-dessus de la sous-face ou de la coupe au sol), à valider. */
      tipCover: mmNonNeg.default(10),
      /** Longueur maximale du tire-fond, mm (C §1.11 [78] : 60 à 160 mm pour un Ø10), à valider. */
      maxLength: mmPos.default(160),
      /**
       * Entraxe minimal de deux tire-fonds (et d'un tire-fond aux autres perçages), mm. `auto` :
       * le plus sévère des règles latérales (a1 = 5·d, boulons) et axiales (a1 = 7·d, vis
       * chargées axialement, EN 1995-1-1 § 8.7.2 via C §1.11 [71] tableau 10.6), soit 7·d ;
       * d nominal lu sur `bolts.holeDiameter` ; **à valider** (QUESTIONS A35 (l)).
       */
      minSpacing: auto(mmPos),
      /**
       * Pince d'un tire-fond au bout **avant** de l'assise (face de la dent précédente ou face
       * avant de la poutre, bois de bout à côté de la partie filetée), mm. `auto` : le plus
       * sévère de a3,c = 4·d (latéral, extrémité non chargée, A35 (e)) et a1,CG = 10·d (axial,
       * distance du centre de gravité de la partie filetée au bout, [71] tableau 10.6), soit
       * 10·d ; au bout arrière, `bolts.edgeDistance` ; **à valider** (QUESTIONS A35 (l)).
       */
      endDistance: auto(mmPos),
    })
    .prefault({}),
  anchors: z
    .object({
      /** Ancrage de pied (au sol) et de tête (contre le chevêtre), A29 n° 5. */
      foot: z.boolean().default(true),
      head: z.boolean().default(true),
      /**
       * Nature de l'ancrage (`WOOD_CENTRAL_ANCHOR_KINDS`) ; `auto` : platine à âme noyée sur une
       * poutre cintrée, sabot en U sur une poutre droite (A34 (c)). Les réglages ci-dessous de
       * nuance, finition, chevilles et pinces valent pour les deux ; `thickness`, `cheekDepth`,
       * `bolts` et `boltHoleDiameter` pour le sabot seul ; `plate` pour la platine seule.
       */
      kind: z.enum([...WOOD_CENTRAL_ANCHOR_KINDS, "auto"]).default("auto"),
      /** Nuance et finition de la tôle des sabots (matériau `steel-*`), à valider. */
      grade: z.enum(STEEL_GRADES).default("S235"),
      finish: z.enum(["raw", "painted", "galvanized"]).default("painted"),
      /** Épaisseur de la tôle pliée en U du sabot, mm (aucune source, **à valider**). */
      thickness: mmPos.default(6),
      /**
       * Saillie des deux joues du sabot perpendiculairement à son âme, mm : au pied, hauteur des
       * joues sur les faces de la poutre (âme = semelle au sol) ; en tête, longueur des joues
       * le long de la poutre (âme verticale contre le chevêtre). Aucune source, **à valider**.
       */
      cheekDepth: mmPos.default(150),
      /**
       * Longueur de l'âme du sabot, mm : au pied, semelle le long de la poutre (sur la coupe au
       * sol) ; en tête, hauteur de l'âme contre le chevêtre. Aucune source, **à valider**.
       */
      length: mmPos.default(200),
      /** Chevilles dans l'âme du sabot (sol ou chevêtre) et perçage (M12 : 13 mm, comme `steel-flat`). */
      anchors: mmNonNeg.default(2),
      anchorHoleDiameter: mmPos.default(13),
      /** Boulons traversant les joues et la poutre, et perçage (M12 : 13 mm), à valider. */
      bolts: mmNonNeg.default(2),
      boltHoleDiameter: mmPos.default(13),
      /** Pince des perçages (même défaut que `steel-flat.plates.holeEdgeDistance`), à valider. */
      holeEdgeDistance: mmPos.default(25),
      /**
       * Platine à âme noyée (A33 (f) ; C §1.11 [80], pied de poteau à âme du commerce, seule
       * source : dimensions **à valider** par un atelier). Au pied : platine d'appui posée au sol
       * sous la poutre (longueur `anchors.length` le long de la trace), âme verticale dans le
       * plan médian de la poutre, noyée vers le haut dans un trait de scie de la sous-face. En
       * tête : platine verticale contre le chevêtre (hauteur `anchors.length`), âme dans le plan
       * médian, noyée le long de la trace dans un trait de scie de la coupe de tête. Trait de
       * scie : épaisseur de l'âme + 2 × jeu d'atelier (`wood.clearance` ; [80] : rainure de
       * 6 mm pour une âme de 4 mm). Broches horizontales au travers des faces de la poutre et
       * de l'âme, placées selon les entraxes et pinces des broches (EC5 § 8.6 via [71]).
       */
      plate: z
        .object({
          /** Épaisseur de la platine d'appui, mm ([80] : 4 mm pour un poteau), à valider. */
          thickness: mmPos.default(8),
          /**
           * Largeur de la platine en travers de la poutre, mm ; `auto` : b + 4 ×
           * `anchors.holeEdgeDistance` (chevilles de part et d'autre de la poutre, à la pince
           * du bord et de la poutre). À valider.
           */
          width: auto(mmPos),
          /** Épaisseur de l'âme, mm ([80] : 4 mm), à valider. */
          webThickness: mmPos.default(6),
          /** Profondeur de l'âme dans la poutre (perpendiculaire à la platine), mm, à valider. */
          webDepth: mmPos.default(120),
          /**
           * Longueur de l'âme, mm, au plus la longueur de la platine ([80] : 60 à 80 mm pour un
           * poteau) : hauteur de l'âme de **tête** ; au pied, l'âme suit
           * `anchors.plate.footWebLength` (A35 (a)) et cette valeur ne sert que lorsque la coupe
           * au sol ne permet pas de la prolonger (âme centrée sur la platine sous la première
           * marche, comportement antérieur). À valider.
           */
          webLength: mmPos.default(150),
          /** Broches au travers de la poutre et de l'âme ([80] : 2 broches Ø12), à valider. */
          pins: mmNonNeg.default(2),
          /** Diamètre des broches, mm ([80] : Ø12), à valider. */
          pinDiameter: mmPos.default(12),
          /** Perçage des broches dans l'âme, mm (broche + 1 mm de jeu), à valider. */
          pinHoleDiameter: mmPos.default(13),
          /**
           * Âme de **pied** prolongée le long de la trace (QUESTIONS A35 (a), décision du
           * 2026-10-09) : longueur de l'âme sur la platine, mm, mesurée depuis le bout de la
           * coupe au sol vers la face avant. `auto` : la plus longue âme plane qui finit au bout
           * de la coupe au sol (moins le jeu) et dont la flèche dans une poutre cintrée reste
           * dans le bois (flèche + demi-trait ≤ b/2 − a4,c), sans dépasser la face avant ; son
           * dessus suit les assises (en escalier) en laissant sous chaque marche la place d'un
           * tire-fond (ancrage arrondi au pas et bois sous la pointe), et ses bouts trop bas
           * (moins de deux pinces de perçage) sont retirés. Les broches vont où la poutre est
           * haute (sous les marches 2 et 3). La platine d'appui couvre l'âme (longueur au moins
           * `anchors.length`). Aucune source (extrapolé de C §1.11 [80]) : **à valider**.
           */
          footWebLength: auto(mmPos),
        })
        .prefault({}),
    })
    .prefault({}),
  /**
   * Réduction de la résistance et du module selon l'angle θ entre le fil et l'axe de la poutre,
   * pour une poutre en **couches empilées** (fil horizontal, poutre inclinée ; QUESTIONS A35 (j),
   * décision du 2026-10-09) : formule de type Hankinson N = P·Q / (P·sinⁿθ + Q·cosⁿθ)
   * (Wood Handbook FPL-GTR-190, chap. 5, éq. 5-2, C §1.11 [81]) ; Q/P et n de la flexion
   * (MOR : n = 1,5 à 2, Q/P = 0,04 à 0,10) : Q/P = 0,10 et n = 1,5, courbe à laquelle la
   * source rapporte les essais de pente de fil (tableau 5-12) ; module (n = 2, Q/P = 0,04 à
   * 0,12) pris à la borne défavorable, faute d'ajustement donné (relecture A35) ;
   * θ = acos(cos α · cos β) (α : pente de la poutre, β : plus grand écart du fil des planches en
   * plan). Valeurs **à valider** (QUESTIONS A36 (8)).
   */
  grainAngle: z
    .object({
      /** Q/P de la résistance en flexion (MOR), [81] : 0,04 à 0,10 ; 0,10 ajuste ses essais. */
      strengthRatio: z.number().positive().max(1).default(0.1),
      /** Exposant n de la résistance en flexion, [81] : 1,5 à 2. */
      strengthExponent: z.number().positive().default(1.5),
      /** Q/P du module d'élasticité, [81] : 0,04 à 0,12. */
      modulusRatio: z.number().positive().max(1).default(0.04),
      /** Exposant n du module d'élasticité, [81] : 2. */
      modulusExponent: z.number().positive().default(2),
    })
    .prefault({}),
  /** Réglages du prédimensionnement indicatif (`precheck/settings.ts`), flexion seule. */
  precheck: PrecheckSettingsSchema.prefault({}),
  /**
   * Justification du double porte-à-faux et de la torsion (`LIMON_CENTRAL_PORTE_A_FAUX`, A29
   * n° 4, comme A12) : l'avertissement reste, la justification lui est jointe (dossier PDF).
   */
  cantileverJustification: z.string().default(""),
  /**
   * Justification du lamellé-collé cintré en plis minces (SPEC Q10 : avertissement + champ de
   * justification repris dans le dossier) ; même traitement que `cantileverJustification`.
   */
  laminationJustification: z.string().default(""),
});
export type WoodCentralParams = z.output<typeof WoodCentralParamsSchema>;

/**
 * Filière retenue sur une trace courbe (`curved` : tournant ou hélicoïdal) pour une section
 * lamellé-collé ; `null` sur une trace droite ou une section massive (couches droites ou
 * massif). Contrat partagé (poutre, couches, interface).
 */
export function resolveCurvedMethod(
  params: WoodCentralParams,
  curved: boolean,
): WoodCentralCurvedMethod | null {
  if (!curved || params.section.kind !== "glulam") return null;
  const m = params.section.curvedMethod;
  if (m !== "auto") return m;
  return params.section.width > params.section.mouldMaxWidth ? "stacked" : "mould";
}

/**
 * Ancrage retenu (`curved` : trace tournante ou hélicoïdale, poutre cintrée) : celui du
 * réglage, ou `auto` → platine à âme noyée sur une poutre cintrée, sabot en U sur une poutre
 * droite (A34 (c)). Contrat partagé (poutre, ancrages, interface).
 */
export function resolveAnchorKind(
  params: WoodCentralParams,
  curved: boolean,
): WoodCentralAnchorKind {
  const k = params.anchors.kind;
  if (k !== "auto") return k;
  return curved ? "embeddedPlate" : "shoe";
}
