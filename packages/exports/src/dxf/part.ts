/**
 * Développé d'une pièce en DXF 1:1 (mm) pour la découpe, le pliage et le traçage.
 *
 * Calques : CONTOUR (contour extérieur et intérieurs, polylignes fermées), PLI, TRACAGE,
 * MORTAISE et TENON (traçages `feature` « mortise » / « tenon » des limons bois), ROULAGE,
 * JOINT (lignes du `FlatPattern`), TEXTE (repère gravé et textes du développé), INFO
 * (désignation, matériau, épaisseur, hors pièce, non gravée).
 */
import {
  bbox,
  pointInPolygon,
  type FlatPattern,
  type Part,
  type Shape2,
  type Vec2,
} from "@blondel/core";
import { MATERIAL_LABELS } from "../csv/cutlist.js";
import { formatFr } from "../format.js";
import { polygonPath } from "../path.js";
import { DEFAULT_PART_DXF_VERSION, createDxfWriter } from "./create.js";
import { declareLayers, type DxfLayerDef, type DxfVersion } from "./writer.js";

export const PART_LAYERS = {
  contour: { name: "CONTOUR", color: 7 },
  bend: { name: "PLI", color: 1, lineType: "DASHED" },
  mark: { name: "TRACAGE", color: 3 },
  mortise: { name: "MORTAISE", color: 6 },
  tenon: { name: "TENON", color: 30 },
  roll: { name: "ROULAGE", color: 5, lineType: "DASHED" },
  joint: { name: "JOINT", color: 4 },
  text: { name: "TEXTE", color: 2 },
  info: { name: "INFO", color: 8 },
} as const satisfies Record<string, DxfLayerDef>;

export interface PartDxfOptions {
  /** Défaut : R12 (`DEFAULT_PART_DXF_VERSION`). */
  readonly version?: DxfVersion;
  /** Hauteur du repère gravé (mm). Défaut : ¼ de la plus petite dimension, borné à [5 ; 30]. */
  readonly markHeight?: number;
  /** Nombre de pièces identiques (même repère), écrit dans le calque INFO. */
  readonly quantity?: number;
}

const LINE_LAYER = {
  bend: PART_LAYERS.bend.name,
  mark: PART_LAYERS.mark.name,
  roll: PART_LAYERS.roll.name,
  joint: PART_LAYERS.joint.name,
  text: PART_LAYERS.text.name,
} as const;

type FlatLine = NonNullable<Part["flat"]>["lines"][number];

/** Calque d'une ligne du développé : les traçages de mortaise et de tenon ont le leur. */
export function partLineLayer(l: FlatLine): string {
  if (l.kind === "mark" && l.feature === "mortise") return PART_LAYERS.mortise.name;
  if (l.kind === "mark" && l.feature === "tenon") return PART_LAYERS.tenon.name;
  return LINE_LAYER[l.kind];
}

/** Segments usinés (mortaises, tenons) à éviter pour le repère gravé. */
export function machinedSegments(flat: NonNullable<Part["flat"]>): [Vec2, Vec2][] {
  return flat.lines
    .filter((l) => l.kind === "mark" && l.feature !== undefined)
    .map((l) => [l.a, l.b]);
}

/** Ligne d'information sur la fibre de référence du développé (CHALLENGE G6), si déclarée. */
export function referenceText(flat: NonNullable<Part["flat"]>): string | undefined {
  const r = flat.reference;
  if (r === undefined) return undefined;
  return `Référence : ${r.kind === "face" ? "face tracée" : "fibre neutre"}${r.description !== "" ? ` (${r.description})` : ""}`;
}

/** Annotation d'une ligne : libellé, angle et sens de pli, profondeur d'usinage. */
export function partLineAnnotation(l: FlatLine): string | undefined {
  const out: string[] = [];
  if (l.label !== undefined) out.push(l.label);
  if (l.kind === "bend" && l.bendAngle !== undefined) {
    const sense = l.bendUp === undefined ? "" : l.bendUp ? " haut" : " bas";
    out.push(`${formatFr(l.bendAngle, { decimals: 1, trimZeros: true, thousands: "" })}°${sense}`);
  }
  // Profondeur annotée seulement sur une ligne libellée (évite de la répéter sur chaque côté).
  if (l.label !== undefined && l.depth !== undefined && Number.isFinite(l.depth)) {
    out.push(`prof. ${formatFr(l.depth, { decimals: 1, trimZeros: true, thousands: "" })}`);
  }
  return out.length > 0 ? out.join(" ") : undefined;
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/**
 * Contours fermés formés par des segments bout à bout (tolérance 1e-6 mm), dans l'ordre de
 * parcours ; les chaînes ouvertes (report isolé, trait de tenon) sont ignorées. Sert à exclure
 * l'intérieur des mortaises (matière enlevée) et des tenons de la recherche du repère gravé.
 */
export function closedLoops(segments: readonly (readonly [Vec2, Vec2])[]): Vec2[][] {
  const eps = 1e-6;
  const same = (p: Vec2, q: Vec2): boolean =>
    Math.abs(p.x - q.x) <= eps && Math.abs(p.y - q.y) <= eps;
  const used = segments.map(() => false);
  const loops: Vec2[][] = [];
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const start = segments[i]![0];
    const ring: Vec2[] = [start];
    let end = segments[i]![1];
    const chain = [i];
    for (;;) {
      if (same(end, start)) break;
      ring.push(end);
      const j = segments.findIndex((s, k) => !used[k] && (same(s[0], end) || same(s[1], end)));
      if (j < 0) break;
      used[j] = true;
      chain.push(j);
      const s = segments[j]!;
      end = same(s[0], end) ? s[1] : s[0];
    }
    if (same(end, start) && ring.length >= 3) loops.push(ring);
    else for (const k of chain.slice(1)) used[k] = false; // chaîne ouverte : segments rendus
  }
  return loops;
}

/**
 * Distance d'un point de la matière au bord le plus proche (contour, trou ou segment à éviter) ;
 * −1 hors matière ou à l'intérieur d'un contour usiné fermé (`loops`).
 */
function clearance(
  shape: Shape2,
  p: Vec2,
  avoid: readonly (readonly [Vec2, Vec2])[],
  loops: readonly (readonly Vec2[])[] = [],
): number {
  if (pointInPolygon(p, shape.outer) !== "inside") return -1;
  if (shape.holes.some((h) => h.length >= 3 && pointInPolygon(p, h) !== "outside")) return -1;
  if (loops.some((l) => pointInPolygon(p, l) !== "outside")) return -1;
  let d = Infinity;
  for (const ring of [shape.outer, ...shape.holes]) {
    for (let i = 0; i < ring.length; i++) {
      d = Math.min(d, distanceToSegment(p, ring[i]!, ring[(i + 1) % ring.length]!));
    }
  }
  for (const [a, b] of avoid) d = Math.min(d, distanceToSegment(p, a, b));
  return d;
}

/**
 * Point de la matière le plus éloigné des bords (recherche sur grille puis raffinement) : le
 * repère gravé doit tomber **dans** la pièce, pas au centre de la boîte englobante, qui peut
 * être hors matière (pièce en L, limon cintré) ou dans un trou. `avoid` : segments à tenir à
 * distance aussi (contours de mortaises et de tenons : matière enlevée ou usinée) ; l'intérieur
 * de leurs contours fermés est exclu (un repère gravé au fond d'une mortaise disparaît).
 */
export function engravingPoint(
  shape: Shape2,
  avoid: readonly (readonly [Vec2, Vec2])[] = [],
): { at: Vec2; clearance: number } {
  const box = bbox(shape.outer);
  const loops = closedLoops(avoid);
  let best = { at: { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 }, d: -1 };
  best.d = clearance(shape, best.at, avoid, loops);
  let hx = (box.max.x - box.min.x) / 48;
  let hy = (box.max.y - box.min.y) / 48;
  let cx = best.at.x;
  let cy = best.at.y;
  for (let pass = 0; pass < 4; pass++) {
    for (let i = -24; i <= 24; i++) {
      for (let j = -24; j <= 24; j++) {
        const p = { x: cx + i * hx, y: cy + j * hy };
        const d = clearance(shape, p, avoid, loops);
        if (d > best.d) best = { at: p, d };
      }
    }
    cx = best.at.x;
    cy = best.at.y;
    hx /= 12;
    hy /= 12;
  }
  return { at: best.at, clearance: Math.max(0, best.d) };
}

const engravingCache = new WeakMap<FlatPattern, { at: Vec2; clearance: number }>();

/**
 * Repère gravé d'un développé (`engravingPoint` sur son contour, loin des usinages),
 * mémorisé par développé : la recherche sur grille coûte de l'ordre de 100 ms sur un limon à
 * nombreuses mortaises, et le PDF rend chaque planche à plusieurs échelles.
 */
export function flatEngravingPoint(flat: FlatPattern): { at: Vec2; clearance: number } {
  let spot = engravingCache.get(flat);
  if (spot === undefined) {
    spot = engravingPoint(flat.outline, machinedSegments(flat));
    engravingCache.set(flat, spot);
  }
  return spot;
}

/** Exporte le développé d'une pièce ; lève une erreur si la pièce n'a pas de développé. */
export function exportPartDxf(part: Part, options: PartDxfOptions = {}): string {
  const flat = part.flat;
  if (flat === undefined) {
    throw new RangeError(`La pièce ${part.mark} (${part.id}) n'a pas de développé à plat.`);
  }
  if (flat.outline.outer.length < 3) {
    throw new RangeError(`Le développé de la pièce ${part.mark} n'a pas de contour.`);
  }
  const box = bbox(flat.outline.outer);
  const w0 = box.max.x - box.min.x;
  const h0 = box.max.y - box.min.y;
  const markH = options.markHeight ?? Math.min(30, Math.max(5, Math.min(w0, h0) / 4));
  const w = createDxfWriter(options.version ?? DEFAULT_PART_DXF_VERSION, {
    dashPattern: [markH * 0.6, markH * 0.3],
  });
  declareLayers(w, Object.values(PART_LAYERS));

  w.polyline(polygonPath(flat.outline.outer).vertices, true, PART_LAYERS.contour.name);
  for (const hole of flat.outline.holes) {
    if (hole.length >= 3) w.polyline(polygonPath(hole).vertices, true, PART_LAYERS.contour.name);
  }

  for (const l of flat.lines) {
    const layer = partLineLayer(l);
    const angle = (Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x) * 180) / Math.PI;
    if (l.kind === "text") {
      if (l.label !== undefined) w.text(l.a, markH * 0.5, l.label, layer, { rotationDeg: angle });
      continue;
    }
    w.line(l.a, l.b, layer);
    const annotation = partLineAnnotation(l);
    if (annotation !== undefined) {
      const mid = { x: (l.a.x + l.b.x) / 2, y: (l.a.y + l.b.y) / 2 };
      const upright = angle > 90 || angle <= -90 ? angle - 180 * Math.sign(angle) : angle;
      w.text(mid, markH * 0.4, annotation, layer, {
        rotationDeg: upright,
        align: "center",
      });
    }
  }

  // Repère gravé dans la matière, au point le plus éloigné des bords.
  const spot = flatEngravingPoint(flat);
  // Hauteur par défaut réduite si la matière est étroite à cet endroit.
  const engraveH = options.markHeight ?? Math.max(1, Math.min(markH, 1.6 * spot.clearance));
  w.text(spot.at, engraveH, part.mark, PART_LAYERS.text.name, { align: "center", middle: true });

  // Informations hors pièce.
  const t = formatFr(flat.thickness, { decimals: 1, trimZeros: true, thousands: "" });
  const info = [
    `${part.mark} - ${part.name}`,
    `Matériau ${MATERIAL_LABELS[part.material] ?? part.material} - épaisseur ${t} mm${part.section !== undefined ? ` - ${part.section}` : ""}`,
  ];
  const ref = referenceText(flat);
  if (ref !== undefined) info.push(ref);
  if (options.quantity !== undefined) info.push(`Quantité ${options.quantity}`);
  let y = box.min.y - 1.5 * markH;
  for (const line of info) {
    w.text({ x: box.min.x, y }, markH * 0.4, line, PART_LAYERS.info.name);
    y -= markH * 0.6;
  }
  return w.toString();
}
