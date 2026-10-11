/**
 * Entraxes et pinces des organes de type tige dans le bois (QUESTIONS A34 (b), A35 (b) (e) (l),
 * décisions du 2026-10-09) : NF EN 1995-1-1 § 8.5.1.1 (boulons, tableau 8.4) et § 8.6 (broches, tableau 8.5),
 * **norme non lue**, tableaux rapportés par C §1.11 [71] (Swedish Wood, tableaux 10.4 et 10.5,
 * p. 45 ; confiance moyenne), recoupés par [77]. Vis et tire-fonds de diamètre > 6 mm : règles
 * des boulons (EC5 § 8.7.1 via [71] § 10.6.1).
 *
 * d : diamètre de l'organe (mm, diamètre nominal : M10 → 10) ; α : angle entre l'effort et le
 * fil (radians). Fonctions pures, sans seuil caché : chaque coefficient est celui du tableau.
 *
 * `ec5Spacing(type, d)` sans angle rend les valeurs **« tous angles »** retenues par Blondel
 * faute de connaître l'angle de l'effort (convention **à valider**, C §1.11 [CALCUL]) : a1, a2,
 * a3,t, a4,t et a4,c sont l'enveloppe sur α (a1 au maximum de |cos α|, a4,t au maximum de
 * sin α) ; a3,c est pris pour l'extrémité non chargée la plus courante (150° ≤ α < 210°,
 * effort dirigé vers l'intérieur de la pièce) : 4·d pour un boulon, max(3,5·d ; 40 mm) pour une
 * broche (son maximum sur α vaudrait 7·d et a3,t, à 90°).
 *
 * **Convention unique de pince d'extrémité** (QUESTIONS A35 (e), décision du 2026-10-09, **à
 * valider**) pour boulons, tire-fonds et broches : la direction de l'effort est supposée par la
 * gravité (`Ec5EndLoading`, `ec5EndDistance`). La poutre porte les marches et descend sur ses
 * appuis : sous les broches de pied (coupe au sol) et aux bouts des assises (faces des dents),
 * l'organe pousse le bois vers l'intérieur de la pièce, extrémité **non chargée** (a3,c) ; en
 * tête, la poutre inclinée tend à glisser vers le bas et la broche retient le bois vers la coupe
 * de tête, extrémité **chargée** (a3,t).
 * Pince des broches de pied depuis la coupe au sol selon la filière (A35 (b), `footPinFloorDistance`) :
 * fil le long de la poutre (massif, couches droites, cintrage sur moule) → extrémité non chargée
 * a3,c ; couches empilées (fil horizontal, coupe au sol parallèle au fil) → **rive**, a4,t
 * (décision (b), plus sévère que la rive non chargée a4,c que donnerait la gravité).
 *
 * Tire-fonds de marche (A35 (l)) : entraxes et pinces au plus sévère des règles latérales
 * (règles des boulons, EC5 § 8.7.1 via [71] § 10.6.1) et axiales (EC5 § 8.7.2, tableau 8.6 lu
 * sur l'EN 1995-1-1:2004+A1:2008, C §1.11 [88], recoupé par [71] tableau 10.6 : a1 = 7·d,
 * a2 = 5·d, a1,CG = 10·d, a2,CG = 4·d ; `ec5AxialScrewSpacing`) : entraxe max(5·d ; 7·d), pince
 * latérale a3,c aux deux bouts de l'assise, distance aux faces max(a4,c ; a2,CG)
 * (`WoodCentralLagSpacing`).
 *
 * **Pince axiale a1,CG le long du fil** (QUESTIONS A36 (4), décision du 2026-10-09, convention
 * Blondel **à valider**) : la partie filetée d'un tire-fond est supposée occuper tout son
 * ancrage dans la poutre ; son centre de gravité CG est au milieu de l'ancrage. La distance de
 * CG au « bout de la pièce » est mesurée **le long du fil** dans le développement (σ, z) de la
 * poutre (`grainEndDistance`) : on lance un rayon depuis CG dans les deux sens du fil, et seul
 * compte le premier côté du contour rencontré s'il est une **surface de bout** (`isBeamEndSide` :
 * faces verticales de cran, face avant, coupe de tête, coupe au sol et plafond des entailles
 * arrière, coupés en biais du fil) ; un rayon qui sort par le dessus d'une assise ou par la
 * sous-face ne contraint pas. Fil le long de la pente (massif, couches droites, cintrage sur moule) ou
 * horizontal (couches empilées : la coupe au sol, parallèle au fil, y est une rive, a2,CG).
 * Remplace la pince a1,CG prise au seul bout avant de l'assise (A35 (l)). La même mesure sert à
 * la pince d'extrémité a3,c des boulons du sabot de pied dans le bois (A36 (10)).
 */
import { nominalDiameterFor } from "../fasteners/compute.js";
import type { Mm, Vec2 } from "../model/primitives.js";
import type { FastenerProfile } from "../workshop/fasteners.js";

/** Organe de type tige : boulon (vis et tire-fonds d > 6 mm compris) ou broche. */
export type WoodFastenerType = "bolt" | "dowel";

/** Entraxes et pinces minimaux (mm), notations de l'EC5. */
export interface Ec5Spacing {
  /** Entraxe parallèle au fil. */
  readonly a1: Mm;
  /** Entraxe perpendiculaire au fil. */
  readonly a2: Mm;
  /** Distance à une extrémité chargée. */
  readonly a3t: Mm;
  /** Distance à une extrémité non chargée. */
  readonly a3c: Mm;
  /** Distance à une rive chargée. */
  readonly a4t: Mm;
  /** Distance à une rive non chargée. */
  readonly a4c: Mm;
}

const DEG = Math.PI / 180;

/** Angle ramené dans [0 ; 360°[ (radians). */
function norm(alpha: number): number {
  const t = alpha % (2 * Math.PI);
  return t < 0 ? t + 2 * Math.PI : t;
}

/** a3,t = max(7·d ; 80 mm), boulons et broches. */
function a3tOf(d: Mm): Mm {
  return Math.max(7 * d, 80);
}

/**
 * Entraxes et pinces minimaux de l'EC5 pour un organe de diamètre `d` ; `alpha` (radians) :
 * angle effort / fil ; absent : valeurs « tous angles » (enveloppe, sauf a3,c : voir l'en-tête).
 */
export function ec5Spacing(type: WoodFastenerType, d: Mm, alpha?: number): Ec5Spacing {
  const a3t = a3tOf(d);
  if (alpha === undefined) {
    return type === "bolt"
      ? { a1: 5 * d, a2: 4 * d, a3t, a3c: 4 * d, a4t: 4 * d, a4c: 3 * d }
      : { a1: 5 * d, a2: 3 * d, a3t, a3c: Math.max(3.5 * d, 40), a4t: 4 * d, a4c: 3 * d };
  }
  const a = norm(alpha);
  const cos = Math.abs(Math.cos(a));
  const sin = Math.sin(a);
  // a4,t est défini pour 0° ≤ α ≤ 180° (sin α ≥ 0) ; hors de ce domaine, la rive est non chargée.
  const a4t = Math.max((2 + 2 * Math.max(0, sin)) * d, 3 * d);
  // a3,c est défini pour 90° ≤ α ≤ 270° ; hors de ce domaine, l'extrémité est chargée (a3,t).
  const inC = a >= 90 * DEG - 1e-12 && a <= 270 * DEG + 1e-12;
  const central = a >= 150 * DEG && a < 210 * DEG;
  if (type === "bolt") {
    const a3c = !inC ? a3t : central ? 4 * d : Math.max((1 + 6 * Math.abs(sin)) * d, 4 * d);
    return { a1: (4 + cos) * d, a2: 4 * d, a3t, a3c, a4t, a4c: 3 * d };
  }
  const a3c = !inC ? a3t : central ? Math.max(3.5 * d, 40) : Math.max(a3t * Math.abs(sin), 3 * d);
  return { a1: (3 + 2 * cos) * d, a2: 3 * d, a3t, a3c, a4t, a4c: 3 * d };
}

/**
 * Extrémité chargée (a3,t) ou non chargée (a3,c) selon la direction d'effort supposée par la
 * gravité (A35 (e), voir l'en-tête).
 */
export type Ec5EndLoading = "loaded" | "unloaded";

/** Pince d'extrémité « tous angles » d'un organe : a3,t (chargée) ou a3,c (non chargée). */
export function ec5EndDistance(type: WoodFastenerType, d: Mm, loading: Ec5EndLoading): Mm {
  const s = ec5Spacing(type, d);
  return loading === "loaded" ? s.a3t : s.a3c;
}

/**
 * Entraxes et pinces minimaux des vis chargées axialement (mm) : EN 1995-1-1 § 8.7.2, **non
 * lue**, via C §1.11 [71] tableau 10.6 (moyen).
 */
export interface Ec5AxialScrewSpacing {
  /** Entraxe parallèle au fil : 7·d. */
  readonly a1: Mm;
  /** Entraxe perpendiculaire au fil : 5·d. */
  readonly a2: Mm;
  /** Distance du centre de gravité de la partie filetée au bout de la pièce : 10·d. */
  readonly a1CG: Mm;
  /** Distance du centre de gravité de la partie filetée à la rive : 4·d. */
  readonly a2CG: Mm;
  /**
   * Pénétration minimale de la partie filetée côté pointe : 6·d (EN 1995-1-1 § 8.7.2 (3), C §1.11
   * [88] ; contrôlée, sans borner `lagScrews.minAnchorage`, QUESTIONS A37 (1)).
   */
  readonly penetration: Mm;
}

export function ec5AxialScrewSpacing(d: Mm): Ec5AxialScrewSpacing {
  return { a1: 7 * d, a2: 5 * d, a1CG: 10 * d, a2CG: 4 * d, penetration: 6 * d };
}

/**
 * Filière de la poutre vue par les pinces (même valeurs que `WoodCentralLaminationMethod` de
 * `woodCentralBeam.ts`, redéclarées ici pour éviter un import circulaire).
 */
export type WoodGrainMethod = "solid" | "straight" | "mould" | "stacked";

/**
 * Pince des broches de pied depuis la coupe au sol (A35 (b) et (e), à valider) : couches
 * empilées → rive a4,t (fil horizontal parallèle à la coupe) ; sinon extrémité non chargée a3,c.
 */
export function footPinFloorDistance(
  method: WoodGrainMethod,
  d: Mm,
): { readonly distance: Mm; readonly kind: "a3c" | "a4t" } {
  const s = ec5Spacing("dowel", d);
  return method === "stacked" ? { distance: s.a4t, kind: "a4t" } : { distance: s.a3c, kind: "a3c" };
}

/**
 * Bois minimal entre le filet d'un tire-fond et le bord d'un perçage horizontal (QUESTIONS
 * A37 (17), décision du 2026-10-10) : diamètre nominal `d` du tire-fond (filet) et épaisseur de
 * bois `thickness` (`lagScrews.holeWood` résolu).
 */
export interface LagHoleWood {
  readonly d: Mm;
  readonly thickness: Mm;
}

/**
 * Jeu d'un tire-fond vertical autour d'un perçage horizontal (boulon de sabot, broche de
 * platine), convention Blondel **à valider** (relecture A35, QUESTIONS A36 (10)) : aucune source
 * ne donne l'écart entre un organe vertical et un perçage horizontal (les entraxes de l'EC5
 * valent entre organes parallèles). Le tire-fond s'écarte en plan (`half`, axe à axe) de la
 * demi-somme des perçages plus le jeu d'atelier, et au moins du demi-perçage plus le demi-filet
 * plus l'épaisseur de bois `wood.thickness` (A37 (17), `lagScrews.holeWood`) ; ou il s'arrête
 * au-dessus, sa pointe à max(`tipCover`, `wood.thickness`) du haut du perçage (`above`, depuis
 * le centre du perçage). Sans `wood` : jeu géométrique seul (comportement antérieur à A37).
 */
export function lagHoleClearance(
  holeDiameter: Mm,
  lagHoleDiameter: Mm,
  clearance: Mm,
  tipCover: Mm,
  wood?: LagHoleWood,
): { readonly half: Mm; readonly above: Mm } {
  const geometric = (holeDiameter + lagHoleDiameter) / 2 + clearance;
  if (!wood) return { half: geometric, above: holeDiameter / 2 + tipCover };
  return {
    half: Math.max(geometric, holeDiameter / 2 + wood.d / 2 + wood.thickness),
    above: holeDiameter / 2 + Math.max(tipCover, wood.thickness),
  };
}

/**
 * Longueur filetée b d'un tire-fond de longueur `length` (QUESTIONS A37 (5), décision du
 * 2026-10-10), mm : saisie (`lagScrews.threadLength`, bornée à la longueur) ou `auto` →
 * b = ⌊20 + L / 3⌋, loi qui redonne exactement les longueurs filetées des fiches Faynot de
 * tire-fonds Ø10 (L 60 à 160 : 40, 43, 46, 53, 60, 66, 73) et Ø12 (L 60 à 220 : … 80, 86, 93),
 * C §1.11 [78] (moyen) ; plus courte que « b ≥ 0,6·L » des tableaux DIN 571 des distributeurs
 * (C §1.11 [93]), donc plus sévère pour la pince a1,CG et la pénétration ; hors de 60 à 220 mm
 * et pour un autre diamètre : extrapolée, **à valider** (QUESTIONS A38). La partie filetée est au
 * bout côté pointe.
 */
export function lagThreadLength(length: Mm, threadLength: Mm | "auto" = "auto"): Mm {
  if (!(length > 0)) return 0;
  const b =
    threadLength !== "auto"
      ? threadLength
      : Math.floor(LAG_THREAD_BASE + length / LAG_THREAD_DIVISOR + 1e-9);
  return Math.min(length, Math.max(0, b));
}

/** Loi `auto` de la longueur filetée (C §1.11 [78], fiches Faynot Ø10 et Ø12) : b = ⌊20 + L / 3⌋. */
const LAG_THREAD_BASE: Mm = 20;
const LAG_THREAD_DIVISOR = 3;

/** Entraxe et pinces des tire-fonds de marche, résolus (A35 (l)). */
export interface WoodCentralLagSpacing {
  /** Valeurs axiales de l'EC5 pour d. */
  readonly axial: Ec5AxialScrewSpacing;
  /** Entraxe minimal retenu (`lagScrews.minSpacing`, `auto` : max(5·d ; 7·d) = 7·d). */
  readonly minSpacing: Mm;
  /**
   * Pince latérale au bout avant de l'assise (`lagScrews.endDistance`, `auto` : a3,c = 4·d) ;
   * la pince axiale a1,CG est mesurée à part, le long du fil (`threadEndDistance`, A36 (4)).
   */
  readonly frontEndDistance: Mm;
  /** Pince au bout arrière de l'assise : celle des boulons (`bolts.edgeDistance` résolu). */
  readonly rearEndDistance: Mm;
  /** Distance minimale aux faces de la poutre : max(a4,c ; a2,CG) = 4·d. */
  readonly faceDistance: Mm;
  /**
   * Pince axiale a1,CG (`lagScrews.threadEndDistance`, `auto` : a1,CG = 10·d), mesurée le long
   * du fil depuis le centre de gravité de la partie filetée jusqu'à la coupe au sol et aux faces
   * de cran (QUESTIONS A36 (4), décision du 2026-10-09, à valider).
   */
  readonly threadEndDistance: Mm;
  /**
   * Pénétration minimale de la partie filetée retenue (`lagScrews.minAnchorage`, QUESTIONS
   * A37 (1), A38 (14)) : saisie, ou `auto` → 6·d (`axial.penetration`). Porte toujours sur la
   * partie filetée (une valeur saisie aussi, depuis A38 (14)).
   */
  readonly minAnchorage: Mm;
  /** `lagScrews.minAnchorage` en `auto` (affichage de la valeur retenue, libellés). */
  readonly minAnchorageAuto: boolean;
  /**
   * Ancrage total minimal sous la marche (`lagScrews.minTotalAnchorage`, QUESTIONS A38 (14)) ;
   * 0 : aucun. Valeur d'un projet antérieur à A38 reportée par la migration du format.
   */
  readonly minTotalAnchorage: Mm;
  /**
   * Grandeur qui retient ou retire un tire-fond (QUESTIONS A38 (14), décision du 2026-10-11) :
   * - `thread` (défaut, `minTotalAnchorage` = 0) : pénétration de la partie filetée
   *   (`lagThreadInBeam`) ≥ `minAnchorage` ;
   * - `total` (`minTotalAnchorage` > 0, projets antérieurs à A38) : ancrage L − tm ≥
   *   `minTotalAnchorage`, la pénétration filetée sous `minAnchorage` restant un constat
   *   (comportement antérieur d'une valeur saisie).
   */
  readonly anchorageMode: "thread" | "total";
  /**
   * Longueur filetée d'un tire-fond de longueur L (`lagScrews.threadLength` résolu,
   * `lagThreadLength`, QUESTIONS A37 (5)).
   */
  readonly threadLengthOf: (length: Mm) => Mm;
  /**
   * Épaisseur de bois minimale entre le filet et un perçage horizontal (`lagScrews.holeWood`,
   * `auto` : 0,5·d, QUESTIONS A37 (17)) ; à passer à `lagHoleClearance` avec `d`.
   */
  readonly holeWood: Mm;
}

/** Pinces et entraxe des boulons (et tire-fonds) de marche du limon central bois, résolus. */
export interface WoodCentralBoltSpacing {
  /**
   * Diamètre nominal de l'organe (mm) : plus grand diamètre de la série du profil de visserie
   * qui passe dans `bolts.holeDiameter` avec le jeu minimal (M10 dans 11 mm) ; à défaut (série
   * vide, perçage trop petit), perçage moins le jeu.
   */
  readonly d: Mm;
  /** Valeurs « tous angles » de l'EC5 pour un boulon de diamètre `d` (a3,c : voir l'en-tête). */
  readonly ec5: Ec5Spacing;
  /** Entraxe minimal retenu (`bolts.minSpacing`, `auto` : a1 = 5·d). */
  readonly minSpacing: Mm;
  /** Distance minimale aux bouts de l'assise retenue (`bolts.edgeDistance`, `auto` : a3,c = 4·d). */
  readonly edgeDistance: Mm;
  /** Tire-fonds (A35 (l)) : règles au plus sévère des règles latérales et axiales. */
  readonly lag: WoodCentralLagSpacing;
}

/**
 * Entraxe et pinces des boulons de marche (`bolts.*`, QUESTIONS A34 (b)) et des tire-fonds
 * (`lagScrews.minSpacing`, `lagScrews.endDistance`, A35 (l) ; `lagScrews.threadEndDistance`,
 * A36 (4)) : valeurs saisies, ou `auto` →
 * bornes « tous angles » de l'EC5 (C §1.11 [71]). Contrat partagé : la poutre place
 * les boulons et tire-fonds avec, le plugin expose les valeurs `auto` retenues.
 */
export function woodCentralBoltSpacing(
  bolts: {
    readonly holeDiameter: Mm;
    readonly minSpacing: Mm | "auto";
    readonly edgeDistance: Mm | "auto";
  },
  fasteners: Pick<FastenerProfile, "nominalDiameters" | "holeClearance">,
  lagScrews: {
    readonly minSpacing: Mm | "auto";
    readonly endDistance: Mm | "auto";
    readonly threadEndDistance?: Mm | "auto";
    readonly minAnchorage?: Mm | "auto";
    readonly minTotalAnchorage?: Mm;
    readonly threadLength?: Mm | "auto";
    readonly holeWood?: Mm | "auto";
  } = { minSpacing: "auto", endDistance: "auto" },
): WoodCentralBoltSpacing {
  const nominal = nominalDiameterFor(
    bolts.holeDiameter,
    fasteners.nominalDiameters,
    fasteners.holeClearance,
  );
  const d = Number.isFinite(nominal)
    ? nominal
    : Math.max(1, bolts.holeDiameter - fasteners.holeClearance);
  const ec5 = ec5Spacing("bolt", d);
  const edgeDistance = bolts.edgeDistance !== "auto" ? bolts.edgeDistance : ec5.a3c;
  const axial = ec5AxialScrewSpacing(d);
  return {
    d,
    ec5,
    minSpacing: bolts.minSpacing !== "auto" ? bolts.minSpacing : ec5.a1,
    edgeDistance,
    lag: {
      axial,
      minSpacing:
        lagScrews.minSpacing !== "auto" ? lagScrews.minSpacing : Math.max(ec5.a1, axial.a1),
      frontEndDistance: lagScrews.endDistance !== "auto" ? lagScrews.endDistance : ec5.a3c,
      rearEndDistance: edgeDistance,
      faceDistance: Math.max(ec5.a4c, axial.a2CG),
      threadEndDistance:
        lagScrews.threadEndDistance !== undefined && lagScrews.threadEndDistance !== "auto"
          ? lagScrews.threadEndDistance
          : axial.a1CG,
      minAnchorage:
        lagScrews.minAnchorage !== undefined && lagScrews.minAnchorage !== "auto"
          ? lagScrews.minAnchorage
          : axial.penetration,
      minAnchorageAuto: lagScrews.minAnchorage === undefined || lagScrews.minAnchorage === "auto",
      minTotalAnchorage: Math.max(0, lagScrews.minTotalAnchorage ?? 0),
      anchorageMode: (lagScrews.minTotalAnchorage ?? 0) > 0 ? "total" : "thread",
      threadLengthOf: (length: Mm): Mm => lagThreadLength(length, lagScrews.threadLength),
      holeWood:
        lagScrews.holeWood !== undefined && lagScrews.holeWood !== "auto"
          ? lagScrews.holeWood
          : HOLE_WOOD_RATIO * d,
    },
  };
}

/**
 * `lagScrews.holeWood` `auto` : 0,5·d, par analogie avec l'entraxe minimal de 1,5·d entre deux vis
 * croisées (filets à 0,5·d l'un de l'autre), ETA-11/0024 § 3 via C §1.11 [94] ; à valider (A38).
 */
const HOLE_WOOD_RATIO = 0.5;

/**
 * Partie filetée d'un tire-fond vissé depuis le dessus d'une marche (QUESTIONS A37 (1) et (5),
 * décisions du 2026-10-10) : la partie filetée b = `threadLengthOf(L)` est au bout côté pointe ;
 * dans la poutre (ancrage A = L − épaisseur de marche), sa pénétration vaut p = min(b ; A) et son
 * centre de gravité est à `cgDepth` = A − p / 2 sous l'assise (au milieu de la seule partie
 * filetée comprise dans la poutre ; avant A37 : A / 2, tire-fond supposé fileté sur tout son
 * ancrage). Le CG sert à la pince axiale a1,CG et à a2,CG ; p à la pénétration minimale 6·d.
 */
export function lagThreadInBeam(
  length: Mm,
  anchorage: Mm,
  threadLengthOf: (length: Mm) => Mm,
): { readonly penetration: Mm; readonly cgDepth: Mm } {
  const a = Math.max(0, anchorage);
  const penetration = Math.max(0, Math.min(threadLengthOf(length), a));
  return { penetration, cgDepth: a - penetration / 2 };
}

/**
 * Un tire-fond de longueur `length` sous une marche d'épaisseur `tm` tient-il l'ancrage minimal
 * (QUESTIONS A37 (1), A38 (14)) ? Mode `thread` : pénétration de la partie filetée
 * (`lagThreadInBeam`) ≥ `minAnchorage` (saisi ou 6·d) ; mode `total` (projet antérieur à A38) :
 * ancrage (L − tm) ≥ `minTotalAnchorage`.
 */
export function lagAnchorageHolds(lag: WoodCentralLagSpacing, length: Mm, tm: Mm): boolean {
  return lagRetained(lag, length, tm) >= lagRequired(lag) - 1e-9;
}

/**
 * Borne comparée à `lagRetained` (QUESTIONS A38 (14)) : `minAnchorage` en mode `thread`,
 * `minTotalAnchorage` en mode `total`.
 */
export function lagRequired(lag: WoodCentralLagSpacing): Mm {
  return lag.anchorageMode === "total" ? lag.minTotalAnchorage : lag.minAnchorage;
}

/**
 * Grandeur comparée à `lagRequired` (QUESTIONS A37 (1), A38 (14)) : pénétration de la partie
 * filetée en mode `thread`, ancrage (L − tm) en mode `total`.
 */
export function lagRetained(lag: WoodCentralLagSpacing, length: Mm, tm: Mm): Mm {
  const anchorage = Math.max(0, length - tm);
  return lag.anchorageMode === "thread"
    ? lagThreadInBeam(length, anchorage, lag.threadLengthOf).penetration
    : anchorage;
}

/** Tolérance de colinéarité et d'appartenance des intersections rayon / côté (mm). */
const RAY_EPS = 1e-9;

/**
 * Premier côté du polygone rencontré par le rayon p + t·u (t > 0) : distance t et indice du
 * côté [poly[i] ; poly[i + 1]] ; côtés parallèles au rayon ignorés. Plusieurs côtés à la même
 * distance (sommet) : tous rendus.
 */
function firstHits(p: Vec2, u: Vec2, poly: readonly Vec2[]): { t: number; sides: number[] } {
  let best = Infinity;
  let sides: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = u.x * ey - u.y * ex;
    if (Math.abs(den) < RAY_EPS * Math.hypot(ex, ey)) continue;
    const wx = a.x - p.x;
    const wy = a.y - p.y;
    const t = (wx * ey - wy * ex) / den;
    const k = (wx * u.y - wy * u.x) / den;
    if (!(t > RAY_EPS) || k < -RAY_EPS || k > 1 + RAY_EPS) continue;
    if (t < best - 1e-7) {
      best = t;
      sides = [i];
    } else if (t <= best + 1e-7) sides.push(i);
  }
  return { t: best, sides };
}

/**
 * Distance le long du fil d'un point à la plus proche surface de bout d'une pièce (QUESTIONS
 * A36 (4), convention **à valider**, voir l'en-tête) : rayon depuis `p` dans les deux sens de
 * `dir` (normalisée ici) ; dans chaque sens, le premier côté du contour `polygon` rencontré
 * compte s'il est une surface de bout (`isEnd(a, b)`, côté [a ; b]) ; sinon (dessus d'assise,
 * sous-face) ce sens ne contraint pas. Plusieurs côtés à la même distance (sommet) : la distance
 * compte si l'un d'eux est une surface de bout. `Infinity` si aucun sens ne rencontre de bout.
 * Fonction pure ; `p` est supposé à l'intérieur du contour.
 */
export function grainEndDistance(
  p: Vec2,
  dir: Vec2,
  polygon: readonly Vec2[],
  isEnd: (a: Vec2, b: Vec2) => boolean,
): Mm {
  const n = Math.hypot(dir.x, dir.y);
  if (!(n > 0) || polygon.length < 3) return Infinity;
  let out = Infinity;
  for (const sgn of [1, -1]) {
    const u = { x: (sgn * dir.x) / n, y: (sgn * dir.y) / n };
    const hit = firstHits(p, u, polygon);
    if (!Number.isFinite(hit.t)) continue;
    const end = hit.sides.some((i) => isEnd(polygon[i]!, polygon[(i + 1) % polygon.length]!));
    if (end) out = Math.min(out, hit.t);
  }
  return out;
}

/**
 * Direction du fil d'une poutre dans son développement (σ, z) (A36 (4)) : horizontale en couches
 * empilées (`stacked`), le long de la pente nominale `slope` (tan α) sinon.
 */
export function grainDirection(method: WoodGrainMethod, slope: number): Vec2 {
  if (method === "stacked" || !Number.isFinite(slope)) return { x: 1, y: 0 };
  const n = Math.hypot(1, slope);
  return { x: 1 / n, y: slope / n };
}

/**
 * Surfaces de bout du développement d'une poutre (A36 (4), convention à valider), contour en
 * sens trigonométrique : côtés verticaux (faces de cran, face avant, coupe de tête) et côtés
 * horizontaux qui ont le bois **au-dessus** (coupe au sol, plafond des entailles arrière où se
 * loge l'arrière de la marche précédente : faces de cran horizontales, coupées en biais du fil
 * comme la coupe au sol). Le dessus des assises (bois au-dessous) et la sous-face ne sont pas
 * des surfaces de bout. En couches empilées (fil horizontal), un rayon horizontal n'atteint
 * jamais un côté horizontal (côté parallèle ignoré) : la coupe au sol y est une rive.
 */
export function isBeamEndSide(a: Vec2, b: Vec2): boolean {
  const dx = b.x - a.x;
  if (Math.abs(dx) < 1e-6) return true;
  return Math.abs(b.y - a.y) < 1e-6 && dx > 0;
}
