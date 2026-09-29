/**
 * Encastrement des marches et contremarches dans les pièces réceptrices (limons à la
 * française, poteaux), en plan.
 *
 * - `extendIntoFaces` : prolonge le contour en plan d'une pièce (marche, contremarche) dans les
 *   faces qui la reçoivent, de la profondeur d'encastrement p. Chaque sommet du contour posé
 *   sur une face réceptrice est déplacé : au début ou à la fin d'une portion posée sur une face,
 *   le long de l'arête voisine prolongée (la ligne de nez prolongée : d'où l'étirement
 *   p / sin β des marches balancées, B §4.1) ; entre deux faces, à l'intersection des faces
 *   décalées de p (coin de poteau).
 * - `pocketInterval` : étendue, le long d'une face, de la partie d'une pièce prolongée située
 *   dans la bande [0 ; p] derrière la face (mortaise tracée sur la face, B §4.1 : « le tout est
 *   décalé de la profondeur d'encastrement »).
 */
import { ensureCCW, signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { Part, SolidDesc } from "../model/derived.js";
import type { Frame3, Mm, Polygon2, Vec2 } from "../model/primitives.js";
import { area, clipConvex, dedupe, isSimplePolygon, removeSpikes } from "./geom.js";
import type { ReceivingFace } from "./legs.js";

/** Tolérance de pose d'un sommet sur une face (mm). */
const ON_FACE_TOL = 1e-5;
/** Sous ce cosinus, l'arête voisine est jugée parallèle à la face : décalage perpendiculaire. */
const MIN_INCIDENCE = 0.05;

/** Pièce extrudée verticalement (pièces de base) : contour en plan monde et altitudes. */
export interface PlanExtrusion {
  readonly outline: Polygon2;
  readonly zBottom: Mm;
  readonly height: Mm;
}

/** Lit une extrusion verticale de repère aligné (pièces de `parts/basic.ts`), sinon `null`. */
export function readPlanExtrusion(solid: SolidDesc): PlanExtrusion | null {
  if (solid.kind !== "extrusion") return null;
  const f = solid.frame;
  const aligned =
    Math.abs(f.xAxis.x - 1) < 1e-12 &&
    Math.abs(f.yAxis.y - 1) < 1e-12 &&
    Math.abs(f.zAxis.z - 1) < 1e-12 &&
    Math.abs(f.xAxis.y) < 1e-12 &&
    Math.abs(f.yAxis.x) < 1e-12;
  if (!aligned) return null;
  const outline = solid.profile.outer.map((p) => ({ x: p.x + f.origin.x, y: p.y + f.origin.y }));
  return { outline, zBottom: f.origin.z, height: solid.depth };
}

/** Extrusion verticale d'un contour du plan monde (repère local à son premier sommet). */
export function verticalExtrusion(outline: Polygon2, zBottom: Mm, depth: Mm): SolidDesc {
  const o = outline[0]!;
  const frame: Frame3 = {
    origin: { x: o.x, y: o.y, z: zBottom },
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 1, z: 0 },
    zAxis: { x: 0, y: 0, z: 1 },
  };
  const outer = outline.map((p) => ({ x: p.x - o.x, y: p.y - o.y }));
  return { kind: "extrusion", frame, profile: { outer, holes: [] }, depth };
}

function onFace(p: Vec2, f: ReceivingFace): boolean {
  const ab = V.sub(f.b, f.a);
  const len = V.norm(ab);
  if (len <= 0) return false;
  const dir = V.scale(ab, 1 / len);
  const w = V.sub(p, f.a);
  const across = Math.abs(V.cross(dir, w));
  const along = V.dot(w, dir);
  return across <= ON_FACE_TOL && along >= -ON_FACE_TOL && along <= len + ON_FACE_TOL;
}

/** Indice de la face qui porte l'arête [a, b], ou −1. */
function edgeFace(a: Vec2, b: Vec2, faces: readonly ReceivingFace[]): number {
  if (V.distance(a, b) <= ON_FACE_TOL) return -1;
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i]!;
    if (onFace(a, f) && onFace(b, f) && onFace(V.lerp(a, b, 0.5), f)) return i;
  }
  return -1;
}

/**
 * Contour prolongé de `depth` dans les faces réceptrices. Rend le contour d'origine si aucune
 * arête n'est posée sur une face, `null` si le prolongement produit un contour non simple.
 *
 * Mode `oblique` (défaut) : aux extrémités d'une portion encastrée, les arêtes voisines (ligne
 * de nez…) sont prolongées jusqu'à la face décalée (étirement 1/sin β). Si le contour obtenu
 * n'est pas simple (arête voisine presque parallèle à une autre face, marche qui passe à
 * moins de p d'un angle), on se replie sur le mode `perpendicular` : bande de profondeur p
 * accolée à la portion encastrée, sans étirement.
 */
export function extendIntoFaces(
  outline: Polygon2,
  faces: readonly ReceivingFace[],
  depth: Mm,
  mode: "oblique" | "perpendicular" | "auto" = "auto",
): Polygon2 | null {
  if (mode === "auto") {
    return (
      extendIntoFaces(outline, faces, depth, "oblique") ??
      extendIntoFaces(outline, faces, depth, "perpendicular")
    );
  }
  const P = ensureCCW(removeSpikes(outline));
  const n = P.length;
  if (n < 3 || faces.length === 0 || !(depth > 0)) return P;
  const housed = P.map((p, i) => edgeFace(p, P[(i + 1) % n]!, faces));
  if (housed.every((h) => h < 0)) return P;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const v = P[i]!;
    const prev = P[(i - 1 + n) % n]!;
    const next = P[(i + 1) % n]!;
    const fIn = housed[(i - 1 + n) % n]!; // arête entrante (prev → v)
    const fOut = housed[i]!; // arête sortante (v → next)
    if (fIn < 0 && fOut < 0) {
      out.push(v);
    } else if (fIn < 0) {
      // Début d'une portion encastrée : prolonger l'arête entrante jusqu'à la face décalée.
      const into = faces[fOut]!.into;
      if (mode === "oblique") out.push(extendAlong(v, V.normalize(V.sub(v, prev)), into, depth));
      else out.push(v, V.addScaled(v, into, depth));
    } else if (fOut < 0) {
      // Fin : prolonger l'arête sortante en arrière.
      const into = faces[fIn]!.into;
      if (mode === "oblique") out.push(extendAlong(v, V.normalize(V.sub(v, next)), into, depth));
      else out.push(V.addScaled(v, into, depth), v);
    } else {
      const a = faces[fIn]!.into;
      const b = faces[fOut]!.into;
      const det = V.cross(a, b);
      if (fIn === fOut || Math.abs(det) < 1e-9) out.push(V.addScaled(v, a, depth));
      else {
        // w·a = depth et w·b = depth.
        const w = {
          x: (depth * b.y - depth * a.y) / det,
          y: (a.x * depth - b.x * depth) / det,
        };
        out.push(V.add(v, w));
      }
    }
  }
  const res = ensureCCW(dedupe(out));
  if (res.length < 3 || !isSimplePolygon(res) || area(res) < area(P) - 1e-6) return null;
  return res;
}

function extendAlong(v: Vec2, d: Vec2, into: Vec2, depth: Mm): Vec2 {
  const c = V.dot(d, into);
  if (c < MIN_INCIDENCE) return V.addScaled(v, into, depth);
  return V.addScaled(v, d, depth / c);
}

/**
 * Étendue [u0 ; u1] (abscisses le long de la face depuis `face.a`) de la partie du contour
 * située dans la bande de profondeur `depth` derrière la face, limitée à [uMin ; uMax] le long
 * de la face ; `null` si la pièce n'entre pas dans la face (aire nulle).
 */
export function pocketInterval(
  outline: Polygon2,
  face: { readonly a: Vec2; readonly dir: Vec2; readonly into: Vec2 },
  depth: Mm,
  uMin: Mm,
  uMax: Mm,
): { u0: Mm; u1: Mm } | null {
  if (!(uMax > uMin)) return null;
  const p0 = V.addScaled(face.a, face.dir, uMin);
  const p1 = V.addScaled(face.a, face.dir, uMax);
  const rect = ensureCCW([
    p0,
    p1,
    V.addScaled(p1, face.into, depth),
    V.addScaled(p0, face.into, depth),
  ]);
  const clipped = clipConvex(ensureCCW(outline), rect);
  if (clipped.length < 3 || Math.abs(signedArea(clipped)) < 1e-3) return null;
  let u0 = Infinity;
  let u1 = -Infinity;
  for (const p of clipped) {
    const u = V.dot(V.sub(p, face.a), face.dir);
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
  }
  return u1 - u0 > 1e-6 ? { u0, u1 } : null;
}

/** Numéro de marche / contremarche d'une pièce de base (`tread-N`, `riser-K`), sinon `null`. */
export function baseNumber(part: Part): { kind: "tread" | "riser"; number: number } | null {
  const m = /^(tread|riser)-(\d+)$/.exec(part.id);
  return m ? { kind: m[1] as "tread" | "riser", number: Number(m[2]) } : null;
}
