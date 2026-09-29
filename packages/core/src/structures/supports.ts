/**
 * Supports de marche des structures métal (C §2.3, §2.6) : **cornières** (L à ailes égales)
 * soudées ou vissées sur la joue du limon ou sur la face du poteau, ou **plats** (consoles)
 * soudés à plat sous la marche.
 *
 * Placement [choix Blondel, à valider] : un support par marche et par face porteuse (limon,
 * poteau) que la marche longe ; le support court sous la marche le long de la face, sur la
 * portion de marche comprise entre deux retraits : à l'avant, l'aile de nez ou la contremarche
 * de la pièce (tôle pliée : t + r + marge ; bois : débord + contremarche + marge) ; à l'arrière,
 * le retour de la pièce suivante (Z : L_r + marge ; U : t + r + marge ; bois : marge). Dessus
 * du support = dessous de la marche ; aile verticale contre la face, vers le bas.
 */
import * as V from "../geom2d/vec.js";
import type { Part } from "../model/derived.js";
import type { Frame3, Mm, Polygon2, Vec2 } from "../model/primitives.js";
import { fmt } from "../rules/check.js";
import type { WorkshopProfile } from "../workshop/profile.js";
import { pocketInterval } from "./housing.js";
import { steelQuantities } from "./steelCommon.js";

export type SupportKind = "angle" | "plate";
export type SupportFixing = "welded" | "bolted";

export interface SupportSpec {
  readonly kind: SupportKind;
  readonly fixing: SupportFixing;
  /** Cornière : aile (mm) et épaisseur (mm). */
  readonly angleLeg: Mm;
  readonly angleThickness: Mm;
  /** Plat : largeur (horizontale, sous la marche) et épaisseur. */
  readonly plateWidth: Mm;
  readonly plateThickness: Mm;
  /** Vissé : nombre de boulons dans la joue, diamètre de perçage, lumière (longueur hors tout). */
  readonly bolts: number;
  readonly holeDiameter: Mm;
  readonly slotLength: Mm;
  /** Distance d'un perçage à l'extrémité du support. */
  readonly holeEdgeDistance: Mm;
  /** Perçages de fixation de la marche dans l'aile horizontale (par support). */
  readonly treadScrews: number;
}

/** Face porteuse (joue de limon ou face de poteau), vue en plan. */
export interface SupportFace {
  /** Clé unique de la face (id de la pièce porteuse, suffixé pour les faces de poteau). */
  readonly key: string;
  /** Pièce porteuse (id) et son repère. */
  readonly owner: string;
  readonly ownerMark: string;
  readonly kind: "stringer" | "post";
  readonly side: "inner" | "outer";
  readonly a: Vec2;
  readonly dir: Vec2;
  /** Normale vers l'intérieur de la pièce porteuse. */
  readonly into: Vec2;
  /** Portée utilisable le long de la face (u depuis `a`). */
  readonly uMin: Mm;
  readonly uMax: Mm;
}

/** Support placé sous une marche. */
export interface SupportPlacement {
  readonly tread: number;
  readonly treadMark: string;
  readonly face: SupportFace;
  readonly u0: Mm;
  readonly u1: Mm;
  /** Altitude du dessus du support (dessous de la marche). */
  readonly zTop: Mm;
}

/** Hauteur du support sous la marche. */
export function supportDepth(spec: SupportSpec): Mm {
  return spec.kind === "angle" ? spec.angleLeg : spec.plateThickness;
}

/** Aire de la section du support (mm²). */
export function supportSectionArea(spec: SupportSpec): number {
  return spec.kind === "angle"
    ? spec.angleThickness * (2 * spec.angleLeg - spec.angleThickness)
    : spec.plateWidth * spec.plateThickness;
}

export function supportSection(spec: SupportSpec): string {
  return spec.kind === "angle"
    ? `L ${fmt(spec.angleLeg, 0)} × ${fmt(spec.angleLeg, 0)} × ${fmt(spec.angleThickness, 0)}`
    : `plat ${fmt(spec.plateWidth, 0)} × ${fmt(spec.plateThickness, 0)}`;
}

/** Fixation effective (un plat posé à plat sous la marche ne peut être que soudé). */
export function effectiveFixing(spec: SupportSpec): SupportFixing {
  return spec.kind === "plate" ? "welded" : spec.fixing;
}

/**
 * Étendue [u0 ; u1] le long de la face de la zone d'appui `zone` (polygone en plan) située
 * dans la bande de largeur `band` devant la face ; `null` si la marche ne longe pas la face.
 */
export function supportInterval(
  zone: Polygon2,
  face: SupportFace,
  band: Mm,
): { u0: Mm; u1: Mm } | null {
  if (zone.length < 3) return null;
  return pocketInterval(
    zone,
    { a: face.a, dir: face.dir, into: V.scale(face.into, -1) },
    band,
    face.uMin,
    face.uMax,
  );
}

/** Centres des perçages de boulons dans la joue, en (u, z) de la face. */
export function boltCenters(p: SupportPlacement, spec: SupportSpec): Vec2[] {
  if (effectiveFixing(spec) !== "bolted" || spec.bolts <= 0) return [];
  const z = p.zTop - spec.angleThickness - (spec.angleLeg - spec.angleThickness) / 2;
  const lo = p.u0 + spec.holeEdgeDistance;
  const hi = p.u1 - spec.holeEdgeDistance;
  if (spec.bolts === 1 || !(hi > lo)) return [V.vec((p.u0 + p.u1) / 2, z)];
  return Array.from({ length: spec.bolts }, (_, i) =>
    V.vec(lo + ((hi - lo) * i) / (spec.bolts - 1), z),
  );
}

/** Pièce « support » (barre sciée), solide extrudé le long de la face. */
export function supportPart(
  p: SupportPlacement,
  spec: SupportSpec,
  mark: string,
  material: Part["material"],
  profile: WorkshopProfile,
): Part {
  const L = p.u1 - p.u0;
  const x = V.scale(p.face.into, -1);
  // Repère direct : Z = X × (0, 0, 1) = perpRight(X) ; origine à l'extrémité correspondante.
  const zDir = V.perpRight(x);
  const forward = V.dot(zDir, p.face.dir) > 0;
  const o = V.addScaled(p.face.a, p.face.dir, forward ? p.u0 : p.u1);
  const frame: Frame3 = {
    origin: { x: o.x, y: o.y, z: p.zTop },
    xAxis: { x: x.x, y: x.y, z: 0 },
    yAxis: { x: 0, y: 0, z: 1 },
    zAxis: { x: zDir.x, y: zDir.y, z: 0 },
  };
  const a = spec.angleLeg;
  const t = spec.angleThickness;
  const outer: Vec2[] =
    spec.kind === "angle"
      ? [V.vec(0, 0), V.vec(0, -a), V.vec(t, -a), V.vec(t, -t), V.vec(a, -t), V.vec(a, 0)]
      : [
          V.vec(0, 0),
          V.vec(0, -spec.plateThickness),
          V.vec(spec.plateWidth, -spec.plateThickness),
          V.vec(spec.plateWidth, 0),
        ];
  const fixing = effectiveFixing(spec);
  const bolts = boltCenters(p, spec).length;
  const sectionPerimeter =
    spec.kind === "angle" ? 4 * a : 2 * (spec.plateWidth + spec.plateThickness);
  const areaS = supportSectionArea(spec);
  const kindLabel =
    spec.kind === "angle"
      ? `Cornière ${fixing === "welded" ? "soudée" : "vissée"}`
      : "Plat support soudé";
  return {
    id: `support-${p.tread}-${p.face.key}`,
    mark,
    category: "support",
    name: `${kindLabel} sous ${p.treadMark} (${p.face.ownerMark})`,
    material,
    solid: { kind: "extrusion", frame, profile: { outer, holes: [] }, depth: L },
    section: supportSection(spec),
    stock: {
      length: L,
      width: spec.kind === "angle" ? a : spec.plateWidth,
      thickness: spec.kind === "angle" ? a : spec.plateThickness,
    },
    quantities: steelQuantities(
      {
        volumeMm3: areaS * L,
        treatedSurfaceMm2: sectionPerimeter * L + 2 * areaS,
        length: L,
        weld: fixing === "welded" ? 2 * L : 0,
        cuts: 2,
        holes: bolts + spec.treadScrews,
      },
      profile,
    ),
  };
}
