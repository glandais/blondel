/**
 * Poteau d'angle (pièce `post`) recevant les limons de jour d'un tournant (C §1.9).
 *
 * - Section : carré de côté a (`InnerCorner.size`), centré sur le coin intérieur K (ou décalé
 *   vers le jour, `InnerCorner.offset`), côtés parallèles aux volées (convention du tracé).
 * - Hauteur : du pied (sol bas, ou « poteau pendant » : sous la rive basse la plus basse des
 *   limons reçus et sous le plus bas des encastrements, d'un dépassement paramétré) jusqu'au-dessus du plus haut des éléments reçus
 *   (dessus des marches encastrées dans le poteau, rives hautes des limons au droit du
 *   poteau), d'un dépassement paramétré, et au moins au-dessus de la main courante d'un
 *   garde-corps qui le rejoint (QUESTIONS A3, `newelTopWithHandrail`). Valeurs par défaut à
 *   valider.
 * - Développé : les quatre faces déroulées côte à côte (x = abscisse le long du périmètre,
 *   parcours trigonométrique vu de dessus, y = altitude), avec les mortaises de réception des
 *   tenons des limons et les encastrements des marches qui touchent le poteau.
 */
import { intersectLines } from "../geom2d/intersect.js";
import { ensureCCW } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { FlatPattern, NosingLine, Part } from "../model/derived.js";
import type { StructureContext } from "../model/plugins.js";
import type { Mm, Polygon2, Vec2 } from "../model/primitives.js";
import { housingPolygons, type Housing } from "./development.js";
import { area } from "./geom.js";
import { pocketInterval, verticalExtrusion } from "./housing.js";
import { newelFaces, type NewelGeometry } from "./legs.js";

/**
 * Sommet du poteau d'angle du tournant `turn` : `top` (plus haut élément reçu + dépassement du
 * plugin), relevé si besoin au-dessus de la main courante de garde-corps qui y aboutit
 * (`StructureContext.newelHandrailTops`, QUESTIONS A3) : max(top, main courante + dépassement
 * `posts.newelOverrun` du garde-corps, 50 mm par défaut à valider).
 */
export function newelTopWithHandrail(
  top: Mm,
  ctx: Pick<StructureContext, "newelHandrailTops">,
  turn: number,
): { top: Mm; raisedBy: Mm; overrun: Mm } {
  const h = ctx.newelHandrailTops?.find((t) => t.turn === turn);
  if (!h || !Number.isFinite(h.top)) return { top, raisedBy: 0, overrun: 0 };
  const need = h.top + h.overrun;
  return need > top
    ? { top: need, raisedBy: need - top, overrun: h.overrun }
    : { top, raisedBy: 0, overrun: h.overrun };
}

/** Pièce encastrée (marche prolongée, contremarche prolongée) avec ses altitudes. */
export interface HousedPiece {
  readonly kind: "tread" | "riser";
  readonly number: number;
  readonly mark: string;
  readonly outline: Polygon2;
  readonly zBottom: Mm;
  readonly zTop: Mm;
}

/** Limon reçu par le poteau : extrémité de sa face de référence et son tenon. */
export interface ReceivedStringer {
  readonly mark: string;
  /** Point de la face de référence au droit du poteau (plan). */
  readonly endPoint: Vec2;
  /** Direction de l'épaisseur du limon (depuis la face de référence). */
  readonly into: Vec2;
  readonly thickness: Mm;
  /** Rives au droit du poteau. */
  readonly lowerZ: Mm;
  readonly upperZ: Mm;
  /** Tenon (altitudes), absent pour un assemblage bout à bout. */
  readonly tenon?: { readonly zBottom: Mm; readonly zTop: Mm };
}

export interface NewelOptions {
  readonly id: string;
  readonly mark: string;
  readonly name: string;
  readonly material: Part["material"];
  readonly housingDepth: Mm;
  readonly clearance: Mm;
  readonly noseRadius: Mm;
  readonly tenonLength: Mm;
  readonly tenonThickness: Mm;
  readonly foot: "floor" | "hanging";
  readonly bottomExtension: Mm;
  readonly topExtension: Mm;
  /**
   * Altitude minimale du sommet (main courante de garde-corps + dépassement, QUESTIONS A3) ;
   * absente : plus haut élément reçu + `topExtension` seulement.
   */
  readonly minTop?: Mm;
}

export interface NewelResult {
  readonly outline: Polygon2;
  readonly foot: Mm;
  readonly top: Mm;
  readonly housings: readonly Housing[];
  /** Mortaises de réception des tenons, en (x, y) du développé. */
  readonly mortises: readonly { label: string; polygon: Polygon2 }[];
  readonly flat: FlatPattern;
  readonly solid: Part["solid"];
  /** Volume fini (mm³) et surface des faces (mm²). */
  readonly volumeMm3: number;
  readonly surfaceMm2: number;
}

export function buildNewel(
  newel: NewelGeometry,
  pieces: readonly HousedPiece[],
  nosings: readonly NosingLine[],
  stringers: readonly ReceivedStringer[],
  o: NewelOptions,
): NewelResult {
  const a = newel.size;
  const faces = newelFaces(newel, o.id);
  const frames = faces.map((f, k) => ({
    a: f.a,
    dir: V.normalize(V.sub(f.b, f.a)),
    into: f.into,
    offset: k * a,
  }));
  const toX = (k: number, p: Vec2): Mm =>
    frames[k]!.offset + V.dot(V.sub(p, frames[k]!.a), frames[k]!.dir);

  // Encastrements des marches et contremarches, face par face.
  const housings: Housing[] = [];
  const treads = pieces.filter((p) => p.kind === "tread");
  const risers = new Map(pieces.filter((p) => p.kind === "riser").map((p) => [p.number, p]));
  let highestTread = -Infinity;
  frames.forEach((f, k) => {
    const shift = (iv: { u0: Mm; u1: Mm }): { u0: Mm; u1: Mm } => ({
      u0: iv.u0 + f.offset,
      u1: iv.u1 + f.offset,
    });
    const used = new Set<number>();
    for (const t of treads) {
      const tp = pocketInterval(t.outline, f, o.housingDepth, 0, a);
      const riser = risers.get(t.number);
      const rp = riser ? pocketInterval(riser.outline, f, o.housingDepth, 0, a) : null;
      if (!tp && !rp) continue;
      if (riser) used.add(riser.number);
      const nosing = nosings[t.number - 1];
      let noseU: Mm | null = null;
      let sinBeta = 1;
      if (nosing && tp) {
        const hit = intersectLines(
          { origin: nosing.p, dir: nosing.dir },
          { origin: f.a, dir: f.dir },
        );
        if (hit) noseU = toX(k, hit.point);
        sinBeta = Math.abs(V.cross(nosing.dir, f.dir));
      }
      if (tp) highestTread = Math.max(highestTread, t.zTop);
      housings.push(
        housingPolygons(
          {
            label: t.mark,
            tread: t.number,
            ...(tp
              ? {
                  treadPocket: {
                    ...shift(tp),
                    zBottom: t.zBottom - o.clearance,
                    zTop: t.zTop,
                    noseU,
                    sinBeta,
                  },
                }
              : {}),
            ...(rp && riser
              ? {
                  riserPocket: {
                    ...shift(rp),
                    zBottom: riser.zBottom,
                    zTop: Math.min(riser.zTop, t.zBottom - o.clearance),
                  },
                }
              : {}),
          },
          o.noseRadius,
        ),
      );
    }
    for (const [num, riser] of risers) {
      if (used.has(num) || treads.some((t) => t.number === num)) continue;
      const rp = pocketInterval(riser.outline, f, o.housingDepth, 0, a);
      if (!rp) continue;
      housings.push(
        housingPolygons(
          {
            label: riser.mark,
            riserPocket: { ...shift(rp), zBottom: riser.zBottom, zTop: riser.zTop },
          },
          o.noseRadius,
        ),
      );
    }
  });

  // Hauteur.
  // Poteau pendant : sous le plus bas des limons reçus **et** des encastrements de marches (un
  // poteau jointif peut recevoir des marches sans limon de jour sous elles).
  const lowest = Math.min(
    ...stringers.map((s) => s.lowerZ),
    ...housings.flatMap((h) => h.polygons.flatMap((poly) => poly.map((p) => p.y))),
  );
  const foot =
    o.foot === "floor" || !Number.isFinite(lowest) ? 0 : Math.max(0, lowest - o.bottomExtension);
  const highest = Math.max(highestTread, ...stringers.map((s) => s.upperZ));
  const top = Math.max(
    (Number.isFinite(highest) ? highest : foot) + o.topExtension,
    o.minTop ?? -Infinity,
  );

  // Mortaises de réception des tenons.
  const mortises: { label: string; polygon: Polygon2 }[] = [];
  for (const s of stringers) {
    if (!s.tenon) continue;
    const center = V.addScaled(s.endPoint, s.into, s.thickness / 2);
    let best = -1;
    let bestD = Infinity;
    frames.forEach((f, k) => {
      const d = Math.abs(V.dot(V.sub(center, f.a), f.into));
      const along = V.dot(V.sub(center, f.a), f.dir);
      if (along >= -1e-6 && along <= a + 1e-6 && d < bestD) {
        bestD = d;
        best = k;
      }
    });
    if (best < 0) continue;
    const xc = toX(best, center);
    const half = o.tenonThickness / 2 + o.clearance;
    // Jeu sous le tenon, sans descendre sous le pied du poteau (tenon posé au sol).
    const y0 = Math.max(s.tenon.zBottom - o.clearance, foot);
    const y1 = Math.min(s.tenon.zTop + o.clearance, top);
    mortises.push({
      label: `Mortaise ${s.mark}`,
      polygon: [
        V.vec(xc - half, y0),
        V.vec(xc + half, y0),
        V.vec(xc + half, y1),
        V.vec(xc - half, y1),
      ],
    });
  }

  const outline: Polygon2 = [V.vec(0, foot), V.vec(4 * a, foot), V.vec(4 * a, top), V.vec(0, top)];
  const lines: FlatPattern["lines"][number][] = [];
  for (let k = 1; k < 4; k++) {
    lines.push({
      kind: "mark",
      a: V.vec(k * a, foot),
      b: V.vec(k * a, top),
      ...(k === 1 ? { label: "Arêtes" } : {}),
    });
  }
  for (const h of housings) {
    for (const poly of h.polygons) {
      poly.forEach((p, i) => {
        lines.push({
          kind: "mark",
          a: p,
          b: poly[(i + 1) % poly.length]!,
          feature: "mortise",
          depth: o.housingDepth,
          ...(i === 0 ? { label: h.label } : {}),
        });
      });
    }
  }
  for (const m of mortises) {
    m.polygon.forEach((p, i) => {
      lines.push({
        kind: "mark",
        a: p,
        b: m.polygon[(i + 1) % m.polygon.length]!,
        feature: "mortise",
        depth: o.tenonLength + o.clearance,
        ...(i === 0 ? { label: m.label } : {}),
      });
    });
  }
  const ym = (foot + top) / 2;
  lines.push({ kind: "text", a: V.vec(a / 2 - 10, ym), b: V.vec(a / 2 + 10, ym), label: o.mark });

  const plan = ensureCCW(faces.map((f) => f.a));
  const pocketVolume =
    housings.reduce((s, h) => s + h.polygons.reduce((t, p) => t + area(p), 0), 0) * o.housingDepth +
    mortises.reduce((s, m) => s + area(m.polygon), 0) * (o.tenonLength + o.clearance);
  const height = top - foot;
  return {
    outline,
    foot,
    top,
    housings,
    mortises,
    flat: {
      outline: { outer: outline, holes: [] },
      lines,
      thickness: a,
      reference: {
        kind: "face",
        description:
          "Faces du poteau déroulées côte à côte, vues de l'extérieur, dans le sens trigonométrique vu de dessus ; x = abscisse le long du périmètre (mm), y = altitude (sol fini bas = 0).",
      },
    },
    solid: verticalExtrusion(plan, foot, height),
    volumeMm3: a * a * height - pocketVolume,
    surfaceMm2: 4 * a * height,
  };
}
