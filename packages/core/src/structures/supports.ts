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
import { dec, msg, type Message } from "@blondel/i18n";
import * as V from "../geom2d/vec.js";
import type { Part, PartFixing } from "../model/derived.js";
import type { PartAssembly } from "../model/plugins.js";
import type { Frame3, Mm, Polygon2, Vec2 } from "../model/primitives.js";
import type { WorkshopProfile } from "../workshop/profile.js";
import { pocketInterval } from "./housing.js";
import { steelQuantities } from "./steelCommon.js";
import {
  DEFAULT_TREAD_HOLE_DIAMETER,
  treadSupportJoint,
  type TreadFixing,
  type TreadMaterialKind,
  type TreadSupportJoint,
} from "./treadFixing.js";

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
  /**
   * Fixation d'une marche en tôle pliée sur le support (A31, `supports.treadFixing`) : vissée
   * (défaut, « à valider ») ou soudée. Sans effet sous une marche bois (toujours vissée).
   */
  readonly treadFixing?: TreadFixing;
  /** Diamètre de perçage des vis d'une marche en tôle vissée (A31, défaut 9 mm, « à valider »). */
  readonly treadHoleDiameter?: Mm;
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

/** Désignation de la section (« L 40 × 40 × 4 », « plat 60 × 8 »). */
export function supportSection(spec: SupportSpec): Message {
  return spec.kind === "angle"
    ? msg("structure.common.section.angle", {
        leg: dec(spec.angleLeg, 0),
        thickness: dec(spec.angleThickness, 0),
      })
    : msg("structure.common.section.flat", {
        width: dec(spec.plateWidth, 0),
        thickness: dec(spec.plateThickness, 0),
      });
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

/**
 * Points de fixation d'une marche sur le support (A31), en plan (repère monde) : `treadScrews`
 * points au milieu de l'aile horizontale (cornière : partie libre de l'aile, entre l'épaisseur
 * de l'aile verticale et son bout ; plat : milieu de sa largeur), répartis le long du support
 * entre `holeEdgeDistance` de ses bouts (un seul : au milieu ; support trop court : répartis
 * régulièrement sur sa longueur). Mêmes points dans l'aile du support et dans la marche.
 */
export function treadScrewPoints(p: SupportPlacement, spec: SupportSpec): Vec2[] {
  const n = Number.isFinite(spec.treadScrews) ? Math.max(0, Math.floor(spec.treadScrews)) : 0;
  if (n === 0) return [];
  const across =
    spec.kind === "angle" ? (spec.angleLeg + spec.angleThickness) / 2 : spec.plateWidth / 2;
  const at = (u: Mm): Vec2 =>
    V.addScaled(V.addScaled(p.face.a, p.face.dir, u), p.face.into, -across);
  const lo = p.u0 + spec.holeEdgeDistance;
  const hi = p.u1 - spec.holeEdgeDistance;
  if (n === 1) return [at((p.u0 + p.u1) / 2)];
  if (!(hi > lo)) {
    return Array.from({ length: n }, (_, i) => at(p.u0 + ((p.u1 - p.u0) * (i + 1)) / (n + 1)));
  }
  return Array.from({ length: n }, (_, i) => at(lo + ((hi - lo) * i) / (n - 1)));
}

/**
 * Fixation de la marche portée sur le support (A31), selon son matériau. `drilledPoints` : sous
 * une marche en tôle vissée, nombre de points réellement percés dans la marche
 * (`drillTreadsAtSupports`) ; le support n'est percé, et la visserie comptée, qu'à ces points.
 * Absent : `treadScrews`.
 */
export function supportTreadJoint(
  p: SupportPlacement,
  spec: SupportSpec,
  tread: TreadMaterialKind = "wood",
  drilledPoints?: number,
): TreadSupportJoint {
  return treadSupportJoint(
    {
      fixing: spec.treadFixing ?? "screwed",
      screws: tread === "steel" && drilledPoints !== undefined ? drilledPoints : spec.treadScrews,
      holeDiameter: spec.treadHoleDiameter ?? DEFAULT_TREAD_HOLE_DIAMETER,
    },
    tread,
    p.u1 - p.u0,
  );
}

/**
 * Pièce « support » (barre sciée), solide extrudé le long de la face. `tread` : matériau de la
 * marche portée (A31 ; défaut bois) — perçages et cordons de la fixation de la marche ;
 * `drilledPoints` : points réellement percés dans une marche en tôle vissée (`supportTreadJoint`).
 */
export function supportPart(
  p: SupportPlacement,
  spec: SupportSpec,
  mark: string,
  material: Part["material"],
  profile: WorkshopProfile,
  tread: TreadMaterialKind = "wood",
  drilledPoints?: number,
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
      ? fixing === "welded"
        ? msg("structure.common.support.angleWelded")
        : msg("structure.common.support.angleBolted")
      : msg("structure.common.support.plateWelded");
  const joint = supportTreadJoint(p, spec, tread, drilledPoints);
  const fixings = supportFixings(p, spec, tread, drilledPoints);
  return {
    id: `support-${p.tread}-${p.face.key}`,
    mark,
    category: "support",
    name: msg("structure.common.support.name", {
      kind: kindLabel,
      tread: p.treadMark,
      owner: p.face.ownerMark,
    }),
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
        weld: (fixing === "welded" ? 2 * L : 0) + joint.weld,
        cuts: 2,
        holes: bolts + joint.holes,
      },
      profile,
    ),
    ...(fixings.length > 0 ? { fixings } : {}),
  };
}

/**
 * Fixations du support (`Part.fixings`, QUESTIONS A27) : boulons dans la joue du limon ou la
 * face du poteau (support vissé : un par perçage, une lumière comptant pour un, diamètre de
 * perçage `holeDiameter`) et fixation de la marche dans l'aile horizontale (A31) : vis à bois
 * sous une marche bois (`treadScrewed`, perçage non dimensionné), vis à métaux sous une marche
 * en tôle vissée (`treadBolted`, perçage `treadHoleDiameter`), rien sous une marche soudée. La
 * marche portée est résolue par l'étape « Visserie » (assemblage support ↔ marche).
 */
export function supportFixings(
  p: SupportPlacement,
  spec: SupportSpec,
  tread: TreadMaterialKind = "wood",
  drilledPoints?: number,
): PartFixing[] {
  const out: PartFixing[] = [];
  const bolts = boltCenters(p, spec).length;
  if (bolts > 0)
    out.push({
      joint: "supportBolted",
      points: bolts,
      holeDiameter: spec.holeDiameter,
      with: [p.face.owner],
    });
  out.push(...supportTreadJoint(p, spec, tread, drilledPoints).fixings);
  return out;
}

/**
 * Assemblages des supports (`StructureOutput.assemblies`) : chaque support est assemblé à la
 * marche qu'il porte (désignée par son numéro, résolue par le pipeline) et à la pièce porteuse
 * de sa face (limon ou poteau, `face.owner`).
 */
export function supportAssemblies(
  supports: readonly { readonly placement: SupportPlacement; readonly part: Part }[],
): PartAssembly[] {
  return supports.flatMap(({ placement, part }) => [
    { a: { partId: part.id }, b: { treadNumber: placement.tread } },
    { a: { partId: part.id }, b: { partId: placement.face.owner } },
  ]);
}
