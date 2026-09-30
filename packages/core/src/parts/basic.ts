/**
 * Pièces de base de l'escalier, indépendantes de la structure (structure `none`, en attendant
 * les plugins `StructureKind` du jalon 3) : marches, contremarches pleines, paliers.
 *
 * Conventions [choix Blondel, à valider par la relecture métier] :
 * - **Marche** t (entre les nez t − 1 et t) : extrusion verticale de `Tread.outline` (débord de
 *   nez compris) sur l'épaisseur `treads.thickness`, **sous** le niveau du dessus z_t. Repère
 *   `M<t>`, identifiant `tread-<t>`.
 * - **Palier** (`Tread.kind = "landing"`) : même construction, repère `P<i>` (i = rang du palier),
 *   identifiant `tread-<t>` (même numérotation que les marches, pour le surlignage).
 * - **Contremarche** k (sous le nez k, k = 0 … n − 1), seulement si `treads.risers = "full"` :
 *   plaque verticale d'épaisseur `riserThickness`, le long de la ligne de nez k de Q_k à R_k,
 *   en retrait du débord : face avant = ligne de nez décalée de `treads.nosing` vers le haut de
 *   l'escalier (bord arrière de la marche inférieure, voir `outlineBetween`), face arrière
 *   décalée de `nosing + riserThickness` ; extrémités coupées sur C_i et C_e, ou sur la ligne
 *   du nez suivant si elle est rencontrée avant (collet plus petit que débord + épaisseur, ou
 *   ligne de nez par un angle vif du jour : la contremarche ne passe jamais sous la marche
 *   suivante) ; prolongement rectiligne au-delà des bords sinon (ex. nez d'arrivée). Hauteur : de la sous-face de la marche
 *   inférieure (sol bas pour k = 0) à la sous-face de la marche supérieure (ou du nez
 *   d'arrivée, supposé de même épaisseur), soit [z_{k−1} − e ; z_k − e]. Repère `CM<k+1>`,
 *   identifiant `riser-<k+1>`.
 * - Matériau : essence `stair.treads.material` du projet, sinon bois par défaut (`wood-oak`).
 * - Fil du bois : **selon le giron**, c'est-à-dire la tangente à Γ au milieu de la marche
 *   (horizontale) ; contremarches : fil horizontal le long de la ligne de nez.
 * - Quantités : `volume` (m³), `surface` (m², dessus de marche ou face de contremarche).
 * - Débit (`stock`) : rectangle englobant aligné sur la ligne de nez avant (longueur × largeur)
 *   × épaisseur, en mm.
 *
 * Les solides sont décrits dans un repère local centré sur la pièce (origine = premier sommet
 * du contour à l'altitude du dessous), pour la précision des maillages en float32.
 */
import { dec, msg, type Message } from "@blondel/i18n";
import { firstHit } from "../balancing/postprocess.js";
import { curveTangentAt } from "../geom2d/curve.js";
import { intersectLines } from "../geom2d/intersect.js";
import { ensureCCW, signedArea } from "../geom2d/polygon.js";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import * as V from "../geom2d/vec.js";
import type {
  Layout,
  MaterialId,
  NosingLine,
  Part,
  SolidDesc,
  Stepping,
  Tread,
} from "../model/derived.js";
import type { Frame3, Mm, Polygon2, Vec2, Vec3 } from "../model/primitives.js";
import type { Project } from "../model/project.js";

/** Clé de `Part.quantities` : volume de matière (m³). */
export const QUANTITY_VOLUME = "volume";
/** Clé de `Part.quantities` : surface utile (m²). */
export const QUANTITY_SURFACE = "surface";
/** Matériau par défaut des pièces de base (bois). */
export const DEFAULT_WOOD_MATERIAL: MaterialId = "wood-oak";

const MM3_PER_M3 = 1e9;
const MM2_PER_M2 = 1e6;

export interface BasicParts {
  readonly parts: readonly Part[];
  /** Remarques (pièces non générées). */
  readonly notes: readonly Message[];
}

/** Extrusion verticale d'un contour du plan XY monde, de `zBottom` sur `depth`. */
function verticalExtrusion(outline: Polygon2, zBottom: Mm, depth: Mm): SolidDesc {
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

/** Étendue d'un nuage de points le long d'un axe unitaire. */
function extent(points: readonly Vec2[], axis: Vec2): Mm {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    const d = V.dot(p, axis);
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return hi - lo;
}

const horizontal = (v: Vec2): Vec3 => ({ x: v.x, y: v.y, z: 0 });

/** Direction « montée » de la ligne de nez (perpendiculaire orientée comme Γ). */
function upOf(layout: Layout, nosing: NosingLine): Vec2 {
  const tangent = curveTangentAt(layout.walkline, nosing.s);
  const up = V.perpLeft(nosing.dir);
  return V.dot(up, tangent) < 0 ? V.scale(up, -1) : up;
}

/**
 * Ligne de nez décalée de `d` vers le haut, coupée sur C_i et C_e **ou sur la ligne du nez
 * suivant** si elle la rencontre avant (première coupure de chaque côté). Sans cette seconde
 * coupure, une ligne de nez passant par un angle vif du jour et presque parallèle à la volée
 * suivante (U, demi-tournant) ne recoupe C_i que très loin, sous les marches suivantes.
 */
function offsetNosing(
  layout: Layout,
  nosing: NosingLine,
  next: NosingLine | undefined,
  d: Mm,
): [Vec2, Vec2] {
  const up = upOf(layout, nosing);
  const tangent = curveTangentAt(layout.walkline, nosing.s);
  const origin = V.addScaled(nosing.p, up, d);
  const qi = firstHit(origin, nosing.dir, layout.inner, "back", tangent);
  const ro = firstHit(origin, nosing.dir, layout.outer, "forward", tangent);
  // Paramètres t (mm, `dir` unitaire) des coupures retenues : t < 0 côté jour, t > 0 côté mur.
  let tInner = qi && qi.s >= nosing.sigmaInner - GEOM_EPS ? qi.t : null;
  let tOuter = ro && ro.s >= nosing.sigmaOuter - GEOM_EPS ? ro.t : null;
  if (next) {
    const span = V.sub(next.r, next.q);
    const len = V.norm(span);
    const hit =
      len > GEOM_EPS
        ? intersectLines({ origin, dir: nosing.dir }, { origin: next.q, dir: span })
        : null;
    const tol = len > GEOM_EPS ? GEOM_EPS / len : 0;
    if (hit && hit.t2 >= -tol && hit.t2 <= 1 + tol) {
      if (hit.t1 < 0 && (tInner === null || hit.t1 > tInner)) tInner = hit.t1;
      if (hit.t1 > 0 && (tOuter === null || hit.t1 < tOuter)) tOuter = hit.t1;
    }
  }
  const q =
    tInner !== null ? V.addScaled(origin, nosing.dir, tInner) : V.addScaled(nosing.q, up, d);
  const r =
    tOuter !== null ? V.addScaled(origin, nosing.dir, tOuter) : V.addScaled(nosing.r, up, d);
  return [q, r];
}

function treadPart(
  layout: Layout,
  tread: Tread,
  front: NosingLine,
  back: NosingLine,
  thickness: Mm,
  mark: string,
  material: MaterialId,
): Part {
  const outline = tread.outline;
  const area = Math.abs(signedArea(outline));
  const across = front.dir;
  const along = V.perpLeft(across);
  const sMid = (front.s + back.s) / 2;
  const grain = curveTangentAt(layout.walkline, sMid);
  const landing = tread.kind === "landing";
  return {
    id: `tread-${tread.number}`,
    mark,
    category: landing ? "landing" : "tread",
    name: msg(landing ? "part.landing.name" : "part.tread.name", { n: tread.number }),
    material,
    solid: verticalExtrusion(outline, tread.z - thickness, thickness),
    stock: { length: extent(outline, across), width: extent(outline, along), thickness },
    quantities: {
      [QUANTITY_VOLUME]: (area * thickness) / MM3_PER_M3,
      [QUANTITY_SURFACE]: area / MM2_PER_M2,
    },
    grain: horizontal(grain),
    family: "treads",
    treadNumber: tread.number,
  };
}

/**
 * Pièces de base d'un découpage complet. Une pièce impossible (épaisseur de marche ≥ hauteur,
 * contour dégénéré) est omise et signalée dans `notes`.
 */
export function buildBasicParts(project: Project, layout: Layout, stepping: Stepping): BasicParts {
  const spec = project.stair.treads;
  const material = spec.material ?? DEFAULT_WOOD_MATERIAL;
  const thickness = spec.thickness;
  const nosings = stepping.nosings;
  const parts: Part[] = [];
  const notes: Message[] = [];

  let landingRank = 0;
  for (const tread of stepping.treads) {
    const front = nosings[tread.number - 1];
    const back = nosings[tread.number];
    if (!front || !back) continue;
    if (!(Math.abs(signedArea(tread.outline)) > GEOM_EPS)) {
      notes.push(msg("part.note.treadDegenerate", { n: tread.number }));
      continue;
    }
    const mark = tread.kind === "landing" ? `P${++landingRank}` : `M${tread.number}`;
    parts.push(treadPart(layout, tread, front, back, thickness, mark, material));
  }

  if (spec.risers === "full") {
    const riserThickness = spec.riserThickness;
    for (const nosing of nosings) {
      const k = nosing.index;
      const bottom = k === 0 ? 0 : nosings[k - 1]!.z - thickness;
      const top = nosing.z - thickness;
      const height = top - bottom;
      if (!(height > GEOM_EPS)) {
        notes.push(
          msg("part.note.riserNoHeight", {
            n: k + 1,
            height: dec(height),
            thickness: dec(thickness),
          }),
        );
        continue;
      }
      const next = nosings[k + 1];
      const [qf, rf] = offsetNosing(layout, nosing, next, spec.nosing);
      const [qb, rb] = offsetNosing(layout, nosing, next, spec.nosing + riserThickness);
      const outline = ensureCCW([qf, rf, rb, qb]);
      const area = Math.abs(signedArea(outline));
      const length = Math.max(V.distance(qf, rf), V.distance(qb, rb));
      if (!(area > GEOM_EPS) || !(length > GEOM_EPS)) {
        notes.push(msg("part.note.riserDegenerate", { n: k + 1 }));
        continue;
      }
      parts.push({
        id: `riser-${k + 1}`,
        mark: `CM${k + 1}`,
        category: "riser",
        name: msg("part.riser.name", { n: k + 1 }),
        material,
        solid: verticalExtrusion(outline, bottom, height),
        stock: { length, width: height, thickness: riserThickness },
        quantities: {
          [QUANTITY_VOLUME]: (area * height) / MM3_PER_M3,
          [QUANTITY_SURFACE]: (V.distance(qf, rf) * height) / MM2_PER_M2,
        },
        grain: horizontal(nosing.dir),
        family: "treads",
      });
    }
  }
  return { parts, notes };
}
