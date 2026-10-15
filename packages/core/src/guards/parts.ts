/**
 * Construction des pièces de garde-corps : poteaux et balustres (extrusions verticales),
 * lisses, câbles et mains courantes (balayages `sweep`), panneaux (surfaces réglées épaissies).
 *
 * Repères (chantier guard-marks, G2b) : chaque pièce est enregistrée avec son descripteur de
 * forme (`guardShape.ts`, construit depuis les entrées : section, axe ou bords non décalés) et
 * rendue avec un repère provisoire vide ; `MarkRegistry.apply` (`marks.ts`, fin de
 * `computeGuards`) regroupe les pièces identiques à T près et recopie sur chaque membre le débit
 * et les grandeurs du représentant de son groupe (CG3, CG4). La désignation commune `markName`
 * (CG5) est le nom générique de la pièce, déjà commun au repère (il entre dans la clé).
 */
import { msg, textMessage, type Message } from "@blondel/i18n";
import * as V from "../geom2d/vec.js";
import type { MaterialId, Part, PartCategory, SolidDesc } from "../model/derived.js";
import type { Mm, Shape2, Vec2, Vec3 } from "../model/primitives.js";
import { woodQuantities } from "../structures/quantities.js";
import type { WorkshopProfile } from "../workshop/profile.js";
import { barShape, panelShape, prismShape, type GuardShape } from "./guardShape.js";
import { guardMarkKey, MarkRegistry } from "./marks.js";
import { sectionLabel, type GuardSection } from "./spec.js";

export { MarkRegistry };

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

/**
 * Pièce avec son débit et ses grandeurs propres, enregistrée pour le repérage (`shape` :
 * descripteur de forme ; `size` : taille de tri, la plus petite pièce d'un groupe en est
 * l'ancre). Repère provisoire vide, attribué par `MarkRegistry.apply`.
 */
function makePart(
  ctx: PartFactoryContext,
  c: Common,
  solid: SolidDesc,
  shape: GuardShape,
  size: number,
  measures: { volumeMm3: number; surfaceMm2: number; length: Mm },
  stock: { length: Mm; width: Mm; thickness: Mm },
  section: Message,
): Part {
  const part: Part = {
    id: c.id,
    mark: "",
    category: c.category,
    name: c.name,
    markName: c.name,
    material: c.material,
    solid,
    section,
    stock,
    quantities: woodQuantities(measures, c.material, ctx.profile, stock),
  };
  ctx.marks.add(part, {
    prefix: c.prefix,
    key: guardMarkKey(c.prefix, c.name.key, c.material, shape),
    shape,
    size,
  });
  return part;
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
    prismShape(section, depth),
    depth,
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
): Part {
  const length = length3(path);
  const area = sectionArea(section);
  const w = sectionWidth(section);
  const h = sectionHeight(section);
  return makePart(
    ctx,
    c,
    { kind: "sweep", path, section: sectionShape(section) },
    barShape(path, section),
    length,
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
  const height = Math.max(...top.map((p, i) => p.z - bottom[i]!.z));
  return makePart(
    ctx,
    c,
    { kind: "ruled", a, b, thickness, normals },
    // Bords non décalés : un panneau de palier rehaussé (trapèze, QUESTIONS A1) diffère d'un
    // panneau rectangulaire de même longueur et de même hauteur maximale par sa hauteur h(s).
    panelShape(bottom, top, thickness),
    areaMm2,
    { volumeMm3: areaMm2 * thickness, surfaceMm2: areaMm2, length: lengthPlan },
    { length: lengthPlan, width: height, thickness },
    msg("part.section.thickness", { thickness: String(thickness) }),
  );
}
