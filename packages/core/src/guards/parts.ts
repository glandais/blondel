/**
 * Construction des pièces de garde-corps : poteaux et balustres (extrusions verticales),
 * lisses, câbles et mains courantes (balayages `sweep`), panneaux (surfaces réglées épaissies).
 *
 * Repères : pièces identiques (même nature, même section, même longueur et même pente, au
 * millimètre / dixième de degré près) → même repère ; les mains courantes ont chacune le leur.
 * Des pièces de même repère ont **exactement** le même débit et les mêmes grandeurs (celles de
 * la première pièce du repère) : sans cela, des écarts d'arrondi (2e-13 mm sur un balustre)
 * séparaient une même pièce sur plusieurs lignes de la fiche de débit (QUESTIONS D1).
 */
import { msg, textMessage, type Message } from "@blondel/i18n";
import * as V from "../geom2d/vec.js";
import type { MaterialId, Part, PartCategory, SolidDesc } from "../model/derived.js";
import type { Mm, Shape2, Vec2, Vec3 } from "../model/primitives.js";
import { woodQuantities } from "../structures/quantities.js";
import type { WorkshopProfile } from "../workshop/profile.js";
import type { GuardSection } from "./spec.js";

/** Nombre de côtés du polygone approchant une section ronde. */
const ROUND_SIDES = 16;

/** Dimension de la section le long de la ligne (balustre) ou en travers (lisse, main courante). */
export function sectionWidth(s: GuardSection): Mm {
  return s.kind === "round" ? s.diameter : s.width;
}

/** Dimension verticale (lisse, main courante) ou en travers de la ligne (balustre). */
export function sectionHeight(s: GuardSection): Mm {
  return s.kind === "round" ? s.diameter : s.height;
}

/** Aire de la section (mm²), polygone d'approximation compris pour le rond. */
export function sectionArea(s: GuardSection): number {
  if (s.kind === "rect") return s.width * s.height;
  const r = s.diameter / 2;
  return 0.5 * ROUND_SIDES * r * r * Math.sin((2 * Math.PI) / ROUND_SIDES);
}

/** Section centrée sur l'origine : u = largeur, v = hauteur. */
export function sectionShape(s: GuardSection): Shape2 {
  if (s.kind === "rect") {
    const w = s.width / 2;
    const h = s.height / 2;
    return {
      outer: [
        { x: -w, y: -h },
        { x: w, y: -h },
        { x: w, y: h },
        { x: -w, y: h },
      ],
      holes: [],
    };
  }
  const r = s.diameter / 2;
  const outer: Vec2[] = [];
  for (let i = 0; i < ROUND_SIDES; i++) {
    const a = (2 * Math.PI * i) / ROUND_SIDES;
    outer.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  return { outer, holes: [] };
}

function length3(path: readonly Vec3[]): Mm {
  let l = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    l += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return l;
}

/** Débit et grandeurs partagés par les pièces d'un même repère. */
interface MarkMeasures {
  readonly stock: { length: Mm; width: Mm; thickness: Mm };
  readonly quantities: Record<string, number>;
}

/** Attribution des repères (préfixe + numéro par signature). */
export class MarkRegistry {
  private readonly byKey = new Map<string, string>();
  private readonly counters = new Map<string, number>();
  private readonly measures = new Map<string, MarkMeasures>();

  /**
   * Débit et grandeurs du repère `prefix|signature` : ceux de la première pièce qui l'a reçu
   * (calculés par `make`), repris tels quels par les suivantes.
   */
  measuresOf(prefix: string, signature: string, make: () => MarkMeasures): MarkMeasures {
    const key = `${prefix}|${signature}`;
    const found = this.measures.get(key);
    if (found) return found;
    const m = make();
    this.measures.set(key, m);
    return m;
  }

  mark(prefix: string, signature: string): string {
    const key = `${prefix}|${signature}`;
    const found = this.byKey.get(key);
    if (found) return found;
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    const m = `${prefix}${n}`;
    this.byKey.set(key, m);
    return m;
  }
}

export interface PartFactoryContext {
  readonly marks: MarkRegistry;
  readonly profile: WorkshopProfile;
}

interface Common {
  readonly id: string;
  readonly prefix: string;
  readonly category: PartCategory;
  readonly name: Message;
  readonly material: MaterialId;
}

function makePart(
  ctx: PartFactoryContext,
  c: Common,
  solid: SolidDesc,
  signature: string,
  measures: { volumeMm3: number; surfaceMm2: number; length: Mm },
  stock: { length: Mm; width: Mm; thickness: Mm },
  section: Message,
): Part {
  const shared = ctx.marks.measuresOf(c.prefix, signature, () => ({
    stock,
    quantities: woodQuantities(measures, c.material, ctx.profile, stock),
  }));
  return {
    id: c.id,
    mark: ctx.marks.mark(c.prefix, signature),
    category: c.category,
    name: c.name,
    material: c.material,
    solid,
    section,
    stock: { ...shared.stock },
    quantities: { ...shared.quantities },
  };
}

const r1 = (x: number): string => (Math.round(x * 10) / 10).toFixed(1);
const r0 = (x: number): string => String(Math.round(x));

/** Désignation de la section (« Ø42 », « 40×40 ») : signature des repères, sans traduction. */
export function sectionLabel(s: GuardSection): string {
  return s.kind === "round" ? `Ø${s.diameter}` : `${s.width}×${s.height}`;
}

/** Section d'une pièce (`Part.section`) : désignation seule, non traduite. */
function sectionMessage(s: GuardSection): Message {
  return textMessage(sectionLabel(s));
}

/**
 * Élément vertical (poteau, balustre) de section `section` : `width` le long de `dir`, l'autre
 * dimension en travers ; de `zBottom` à `zTop`, centré en `center`.
 */
export function verticalMember(
  ctx: PartFactoryContext,
  c: Common,
  center: Vec2,
  dir: Vec2,
  section: GuardSection,
  zBottom: Mm,
  zTop: Mm,
): Part {
  const depth = Math.max(zTop - zBottom, 1);
  const x = V.normalize(dir);
  const y = V.perpLeft(x);
  const solid: SolidDesc = {
    kind: "extrusion",
    frame: {
      origin: { x: center.x, y: center.y, z: zBottom },
      xAxis: { x: x.x, y: x.y, z: 0 },
      yAxis: { x: y.x, y: y.y, z: 0 },
      zAxis: { x: 0, y: 0, z: 1 },
    },
    profile: sectionShape(section),
    depth,
  };
  const w = sectionWidth(section);
  const h = sectionHeight(section);
  const area = sectionArea(section);
  return makePart(
    ctx,
    c,
    solid,
    `${section.kind}${sectionLabel(section)}|${r0(depth)}`,
    { volumeMm3: area * depth, surfaceMm2: area, length: depth },
    { length: depth, width: Math.max(w, h), thickness: Math.min(w, h) },
    sectionMessage(section),
  );
}

/** Élément filant (lisse, câble, main courante) balayé le long d'un chemin 3D. */
export function sweptMember(
  ctx: PartFactoryContext,
  c: Common,
  path: readonly Vec3[],
  section: GuardSection,
  signatureExtra = "",
): Part {
  const length = length3(path);
  const area = sectionArea(section);
  const w = sectionWidth(section);
  const h = sectionHeight(section);
  const first = path[0]!;
  const last = path[path.length - 1]!;
  const slope =
    (Math.atan2(last.z - first.z, Math.hypot(last.x - first.x, last.y - first.y)) * 180) / Math.PI;
  return makePart(
    ctx,
    c,
    { kind: "sweep", path, section: sectionShape(section) },
    `${section.kind}${sectionLabel(section)}|${r0(length)}|${r1(slope)}|${path.length}${signatureExtra}`,
    { volumeMm3: area * length, surfaceMm2: w * length, length },
    { length, width: Math.max(w, h), thickness: Math.min(w, h) },
    sectionMessage(section),
  );
}

/**
 * Panneau (verre, tôle perforée, panneau plein) : surface réglée entre le bord bas et le bord
 * haut, épaissie de part et d'autre de l'axe (normales horizontales).
 */
export function panelMember(
  ctx: PartFactoryContext,
  c: Common,
  bottom: readonly Vec3[],
  top: readonly Vec3[],
  normals: readonly Vec2[],
  thickness: Mm,
): Part {
  const shift = (p: Vec3, n: Vec2): Vec3 => ({
    x: p.x - (n.x * thickness) / 2,
    y: p.y - (n.y * thickness) / 2,
    z: p.z,
  });
  const a = bottom.map((p, i) => shift(p, normals[i]!));
  const b = top.map((p, i) => shift(p, normals[i]!));
  let lengthPlan = 0;
  let areaMm2 = 0;
  for (let i = 1; i < bottom.length; i++) {
    const l = Math.hypot(bottom[i]!.x - bottom[i - 1]!.x, bottom[i]!.y - bottom[i - 1]!.y);
    const h0 = top[i - 1]!.z - bottom[i - 1]!.z;
    const h1 = top[i]!.z - bottom[i]!.z;
    lengthPlan += l;
    areaMm2 += (l * (h0 + h1)) / 2;
  }
  const heights = top.map((p, i) => p.z - bottom[i]!.z);
  const height = Math.max(...heights);
  const first = bottom[0]!;
  const last = bottom[bottom.length - 1]!;
  const slope = (Math.atan2(last.z - first.z, lengthPlan) * 180) / Math.PI;
  return makePart(
    ctx,
    c,
    { kind: "ruled", a, b, thickness, normals },
    // Hauteurs aux deux extrémités : un panneau de palier rehaussé (trapèze, QUESTIONS A1) ne
    // doit pas partager le repère — ni donc le débit et la masse — d'un panneau rectangulaire
    // de même longueur et de même hauteur maximale.
    `${thickness}|${r0(lengthPlan)}|${r0(height)}|${r0(heights[0]!)}|${r0(heights[heights.length - 1]!)}|${r1(slope)}|${r0(areaMm2 / 1000)}`,
    { volumeMm3: areaMm2 * thickness, surfaceMm2: areaMm2, length: lengthPlan },
    { length: lengthPlan, width: height, thickness },
    msg("part.section.thickness", { thickness: String(thickness) }),
  );
}
