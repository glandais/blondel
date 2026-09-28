/**
 * Primitives géométriques et unités.
 *
 * Unités (ADR-0003) : longueurs en millimètres, angles en degrés dans le projet sérialisé.
 * Les **saisies** utilisateur sont des mm entiers (validés par zod) ; les grandeurs **dérivées**
 * (h = H / n, points de nez, développés) sont des flottants float64 en mm. L'arrondi n'a lieu
 * qu'à l'affichage et à l'export (règle d'arrondi de fabrication explicite).
 *
 * Repère : plan XY horizontal, Z vertical vers le haut, origine = point de départ défini par
 * le placement de l'escalier (voir `Placement`). Sens trigonométrique positif.
 */

/** Longueur en millimètres (float64). */
export type Mm = number;
/** Angle en degrés. */
export type Deg = number;
/** Angle en radians (interne aux algorithmes uniquement, jamais sérialisé). */
export type Rad = number;

export interface Vec2 {
  readonly x: Mm;
  readonly y: Mm;
}

export interface Vec3 {
  readonly x: Mm;
  readonly y: Mm;
  readonly z: Mm;
}

/** Polygone simple fermé (dernier point ≠ premier), orienté CCW pour un contour extérieur. */
export type Polygon2 = readonly Vec2[];

/** Polygone avec trous (trous orientés CW). */
export interface Shape2 {
  readonly outer: Polygon2;
  readonly holes: readonly Polygon2[];
}

/** Segment de droite d'une courbe composée. */
export interface LineSeg {
  readonly kind: "line";
  readonly a: Vec2;
  readonly b: Vec2;
}

/**
 * Arc de cercle d'une courbe composée : centre, rayon, angle de départ, balayage signé
 * (positif = CCW). Rayon 0 autorisé pour représenter un angle vif « pivot » (longueur nulle).
 */
export interface ArcSeg {
  readonly kind: "arc";
  readonly center: Vec2;
  readonly radius: Mm;
  readonly startAngle: Rad;
  readonly sweep: Rad;
}

export type CurveSeg = LineSeg | ArcSeg;

/**
 * Courbe plane composée (segments + arcs), continue, paramétrée par abscisse curviligne.
 * Sert aux bords (jour / mur), à la ligne de foulée et aux lignes de mesure.
 * Clothoïdes : V1 (ajout d'un `ClothoidSeg`).
 */
export interface Curve2 {
  readonly segments: readonly CurveSeg[];
}

/** Repère 3D affine (origine + 3 axes orthonormés), pour placer des profils extrudés. */
export interface Frame3 {
  readonly origin: Vec3;
  readonly xAxis: Vec3;
  readonly yAxis: Vec3;
  readonly zAxis: Vec3;
}
