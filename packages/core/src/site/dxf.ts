/**
 * Lecture d'un plan de masse DXF (jalon 7) en calque de fond : entités LINE, LWPOLYLINE,
 * POLYLINE (2D), ARC et CIRCLE de l'espace objet, blocs (INSERT) développés, converties en
 * entités simplifiées **en mm** (`UnderlayEntity`).
 *
 * Point d'entrée séparé (`@blondel/core/dxf`) : le lecteur `dxf-parser` n'est chargé qu'à la
 * demande par l'interface et n'alourdit ni le paquet principal ni le worker de calcul.
 *
 * Unités : `$INSUNITS` de l'en-tête (1 pouce, 2 pied, 4 mm, 5 cm, 6 m…) donne l'échelle en mm
 * par unité ; sans unité reconnue (0, absente ou exotique), `needsScale` est vrai et l'échelle
 * doit être **demandée** à l'utilisateur (`unitScale`) : rien n'est deviné.
 *
 * Simplifications (calque de saisie, pas de relecture fidèle) : coordonnées arrondies au
 * centième de mm ; les arcs soumis à une transformation non conforme (bloc à échelles x ≠ y)
 * sont discrétisés en polylignes (pas angulaire `ARC_TESSELLATION_STEP_DEG`) ; élévations et
 * cotes Z ignorées (projection en plan) ; textes, cotes, hachures, splines, ellipses ignorés et
 * comptés dans `skipped`. Le nombre d'entités et de sommets est borné (`UNDERLAY_MAX_*`).
 */
import DxfParser from "dxf-parser";
import * as V from "../geom2d/vec.js";
import type { BBox } from "../geom2d/polygon.js";
import type { Vec2 } from "../model/primitives.js";
import {
  entityVertexCount,
  UNDERLAY_MAX_ENTITIES,
  UNDERLAY_MAX_VERTICES,
  type UnderlayEntity,
} from "./schema.js";
import { entitySegments, segmentsBounds } from "./underlay.js";

/** Millimètres par unité de dessin, par code `$INSUNITS` (unités usuelles seulement). */
export const INSUNITS_MM: Readonly<Record<number, { readonly mm: number; readonly name: string }>> =
  {
    1: { mm: 25.4, name: "pouce" },
    2: { mm: 304.8, name: "pied" },
    4: { mm: 1, name: "millimètre" },
    5: { mm: 10, name: "centimètre" },
    6: { mm: 1000, name: "mètre" },
    7: { mm: 1_000_000, name: "kilomètre" },
    9: { mm: 0.0254, name: "mil" },
    10: { mm: 914.4, name: "yard" },
    13: { mm: 0.001, name: "micromètre" },
    14: { mm: 100, name: "décimètre" },
    15: { mm: 10_000, name: "décamètre" },
    16: { mm: 100_000, name: "hectomètre" },
  };

/** Pas angulaire (degrés) de discrétisation des arcs déformés par un bloc. */
export const ARC_TESSELLATION_STEP_DEG = 10;
/** Profondeur maximale d'imbrication des blocs développés. */
export const MAX_INSERT_DEPTH = 8;
/** Nombre maximal de copies d'un bloc en réseau (colonnes × lignes). */
const MAX_INSERT_ARRAY = 1_000;

export class DxfImportError extends Error {
  override name = "DxfImportError";
}

export interface DxfReadOptions {
  /**
   * Millimètres par unité de dessin, saisis par l'utilisateur ; prioritaire sur `$INSUNITS`.
   * Absent et unité inconnue : échelle 1 appliquée et `needsScale` vrai.
   */
  readonly unitScale?: number;
  /** Calques à conserver (tous si absent). */
  readonly layers?: readonly string[];
  readonly maxEntities?: number;
  readonly maxVertices?: number;
}

export interface DxfReadResult {
  /** Entités simplifiées en mm, dans le repère du dessin. */
  readonly entities: UnderlayEntity[];
  /** Code `$INSUNITS` lu (null si absent). */
  readonly insUnits: number | null;
  /** Nom français de l'unité reconnue, sinon null. */
  readonly unitName: string | null;
  /** Échelle appliquée (mm par unité de dessin). */
  readonly unitScale: number;
  /** Vrai si l'unité est inconnue et qu'aucune échelle n'a été fournie. */
  readonly needsScale: boolean;
  /** Emprise des entités retenues (mm, repère du dessin) ; null si aucune. */
  readonly bounds: BBox | null;
  /** Calques des entités retenues, triés. */
  readonly layers: string[];
  /** Entités ignorées par type (TEXT, DIMENSION, HATCH, …, et `paperSpace`). */
  readonly skipped: Record<string, number>;
  /** Vrai si des entités ont été abandonnées à cause des bornes de taille. */
  readonly truncated: boolean;
}

// ------------------------------------------------------------------ Transformations affines

/** Matrice affine 2D : (x, y) → (a·x + c·y + e, b·x + d·y + f). */
interface Affine {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function mul(m: Affine, n: Affine): Affine {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

const translate = (x: number, y: number): Affine => ({ ...IDENTITY, e: x, f: y });
const scaling = (sx: number, sy: number): Affine => ({ ...IDENTITY, a: sx, d: sy });
function rotation(deg: number): Affine {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { a: c, b: s, c: -s, d: c, e: 0, f: 0 };
}

const apply = (m: Affine, p: Vec2): Vec2 => ({
  x: m.a * p.x + m.c * p.y + m.e,
  y: m.b * p.x + m.d * p.y + m.f,
});
const applyVec = (m: Affine, p: Vec2): Vec2 => ({
  x: m.a * p.x + m.c * p.y,
  y: m.b * p.x + m.d * p.y,
});
const det = (m: Affine): number => m.a * m.d - m.b * m.c;

/** Facteur d'échelle si `m` est une similitude (rotation, symétrie, échelle uniforme), sinon null. */
function similarityScale(m: Affine): number | null {
  const sx = Math.hypot(m.a, m.b);
  const sy = Math.hypot(m.c, m.d);
  const ortho = m.a * m.c + m.b * m.d;
  const tol = 1e-9 * Math.max(1, sx, sy);
  if (Math.abs(sx - sy) > tol * 1e3 || Math.abs(ortho) > tol * 1e3 || !(sx > 0)) return null;
  return sx;
}

// ------------------------------------------------------------------ Lecture

interface RawPoint {
  x?: number;
  y?: number;
  bulge?: number;
}

interface RawEntity {
  type?: string;
  layer?: string;
  inPaperSpace?: boolean;
  vertices?: RawPoint[];
  center?: RawPoint;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  shape?: boolean;
  is3dPolyline?: boolean;
  is3dPolygonMesh?: boolean;
  isPolyfaceMesh?: boolean;
  extrusionDirectionZ?: number;
  extrusionDirection?: { z?: number };
  name?: string;
  position?: RawPoint;
  xScale?: number;
  yScale?: number;
  rotation?: number;
  columnCount?: number;
  rowCount?: number;
  columnSpacing?: number;
  rowSpacing?: number;
}

interface RawBlock {
  entities?: RawEntity[];
  position?: RawPoint;
}

const num = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
const pt = (p: RawPoint | undefined): Vec2 => ({ x: num(p?.x), y: num(p?.y) });
const round2 = (v: number): number => Math.round(v * 100) / 100;
const rp = (p: Vec2): Vec2 => ({ x: round2(p.x), y: round2(p.y) });
const roundAngle = (deg: number): number => Math.round(deg * 1e6) / 1e6;

/** Symétrie du repère d'objet (OCS) quand l'extrusion est (0, 0, −1) : x → −x. */
function ocs(e: RawEntity): Affine {
  const z = e.extrusionDirectionZ ?? e.extrusionDirection?.z;
  return typeof z === "number" && z < 0 ? scaling(-1, 1) : IDENTITY;
}

/** Points d'un arc (angles en radians, balayage signé), extrémités comprises. */
function arcPoints(center: Vec2, r: number, start: number, sweep: number): Vec2[] {
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / ((ARC_TESSELLATION_STEP_DEG * Math.PI) / 180)));
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = start + (sweep * i) / n;
    out.push({ x: center.x + r * Math.cos(t), y: center.y + r * Math.sin(t) });
  }
  return out;
}

class Collector {
  readonly entities: UnderlayEntity[] = [];
  readonly skipped: Record<string, number> = {};
  truncated = false;
  private vertices = 0;
  constructor(
    private readonly maxEntities: number,
    private readonly maxVertices: number,
    private readonly layers: ReadonlySet<string> | null,
  ) {}

  full(): boolean {
    return this.truncated;
  }

  skip(type: string): void {
    this.skipped[type] = (this.skipped[type] ?? 0) + 1;
  }

  accepts(layer: string | undefined): boolean {
    return this.layers === null || this.layers.has(layer ?? "0");
  }

  push(e: UnderlayEntity): void {
    if (this.truncated) return;
    const n = entityVertexCount(e);
    if (this.entities.length + 1 > this.maxEntities || this.vertices + n > this.maxVertices) {
      this.truncated = true;
      return;
    }
    this.vertices += n;
    this.entities.push(e);
  }
}

function emit(
  raw: RawEntity,
  m: Affine,
  blocks: Readonly<Record<string, RawBlock>>,
  out: Collector,
  depth: number,
  layerOverride: string | undefined,
): void {
  if (out.full()) return;
  const type = raw.type ?? "?";
  if (raw.inPaperSpace) {
    out.skip("paperSpace");
    return;
  }
  // Calque « 0 » d'une entité de bloc : elle hérite du calque de l'insertion (convention DXF).
  const layer =
    (raw.layer === undefined || raw.layer === "0") && layerOverride ? layerOverride : raw.layer;
  if (type !== "INSERT" && !out.accepts(layer)) {
    out.skip(`calque:${layer ?? "0"}`);
    return;
  }
  const L = layer !== undefined ? { layer } : {};
  switch (type) {
    case "LINE": {
      const v = raw.vertices ?? [];
      if (v.length < 2) return out.skip(type);
      out.push({ kind: "line", ...L, a: rp(apply(m, pt(v[0]))), b: rp(apply(m, pt(v[1]))) });
      return;
    }
    case "LWPOLYLINE":
    case "POLYLINE": {
      if (raw.is3dPolygonMesh || raw.isPolyfaceMesh) return out.skip(`${type}:maillage`);
      const mm = raw.is3dPolyline ? m : mul(m, ocs(raw));
      const km = similarityScale(mm);
      const v = (raw.vertices ?? []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (v.length < 2) return out.skip(type);
      const closed = raw.shape === true;
      const hasBulge = v.some((p) => num(p.bulge) !== 0);
      if (!hasBulge || km !== null) {
        const flip = det(mm) < 0 ? -1 : 1;
        const points = v.map((p) => rp(apply(mm, pt(p))));
        const bulges = hasBulge ? v.map((p) => flip * num(p.bulge)) : undefined;
        out.push({
          kind: "polyline",
          ...L,
          points,
          ...(closed ? { closed: true } : {}),
          ...(bulges ? { bulges } : {}),
        });
        return;
      }
      // Transformation non conforme : arcs discrétisés dans le repère d'origine.
      const pts: Vec2[] = [];
      const count = closed ? v.length : v.length - 1;
      pts.push(pt(v[0]));
      for (let i = 0; i < count; i++) {
        const a = pt(v[i]);
        const b = pt(v[(i + 1) % v.length]);
        const bulge = num(v[i]!.bulge);
        if (bulge === 0) {
          pts.push(b);
          continue;
        }
        const seg = entitySegments({ kind: "polyline", points: [a, b], bulges: [bulge, 0] })[0]!;
        if (seg.kind === "line") pts.push(b);
        else pts.push(...arcPoints(seg.center, seg.radius, seg.startAngle, seg.sweep).slice(1));
      }
      if (closed) pts.pop();
      out.push({
        kind: "polyline",
        ...L,
        points: pts.map((p) => rp(apply(mm, p))),
        ...(closed ? { closed: true } : {}),
      });
      return;
    }
    case "ARC":
    case "CIRCLE": {
      const r = num(raw.radius);
      if (!(r > 0)) return out.skip(type);
      const mm = mul(m, ocs(raw));
      const km = similarityScale(mm);
      const c = pt(raw.center);
      const full = type === "CIRCLE";
      const s0 = full ? 0 : num(raw.startAngle);
      let sweep = full ? 2 * Math.PI : num(raw.endAngle) - s0;
      if (!full) {
        sweep %= 2 * Math.PI;
        if (sweep <= 0) sweep += 2 * Math.PI;
      }
      if (km !== null) {
        const center = rp(apply(mm, c));
        const radius = round2(r * km);
        if (!(radius > 0)) return out.skip(type);
        if (full) {
          out.push({ kind: "circle", ...L, center, radius });
          return;
        }
        const dir = (t: number): number => {
          const w = applyVec(mm, { x: Math.cos(t), y: Math.sin(t) });
          return (Math.atan2(w.y, w.x) * 180) / Math.PI;
        };
        // Une symétrie inverse le sens de parcours : l'arc trigonométrique va de l'image de la
        // fin à l'image du début.
        const [a0, a1] = det(mm) < 0 ? [dir(s0 + sweep), dir(s0)] : [dir(s0), dir(s0 + sweep)];
        out.push({ kind: "arc", ...L, center, radius, start: roundAngle(a0), end: roundAngle(a1) });
        return;
      }
      const pts = arcPoints(c, r, s0, sweep).map((p) => rp(apply(mm, p)));
      if (full) pts.pop();
      out.push({ kind: "polyline", ...L, points: pts, ...(full ? { closed: true } : {}) });
      return;
    }
    case "INSERT": {
      const block = raw.name !== undefined ? blocks[raw.name] : undefined;
      if (!block || depth >= MAX_INSERT_DEPTH) return out.skip(type);
      const base = pt(block.position);
      const sx = num(raw.xScale, 1);
      const sy = num(raw.yScale, 1);
      const cols = Math.max(1, Math.floor(num(raw.columnCount, 1)));
      const rows = Math.max(1, Math.floor(num(raw.rowCount, 1)));
      if (cols * rows > MAX_INSERT_ARRAY) return out.skip(`${type}:réseau`);
      const place = mul(
        mul(m, ocs(raw)),
        mul(translate(num(raw.position?.x), num(raw.position?.y)), rotation(num(raw.rotation))),
      );
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const mi = mul(
            mul(place, translate(i * num(raw.columnSpacing), j * num(raw.rowSpacing))),
            mul(scaling(sx, sy), translate(-base.x, -base.y)),
          );
          for (const child of block.entities ?? []) {
            emit(child, mi, blocks, out, depth + 1, layer);
            if (out.full()) return;
          }
        }
      }
      return;
    }
    default:
      out.skip(type);
  }
}

/**
 * Lit un DXF texte et rend ses entités simplifiées en mm (voir l'en-tête du module).
 * Lève `DxfImportError` si le fichier est illisible.
 */
export function readDxfUnderlay(text: string, options: DxfReadOptions = {}): DxfReadResult {
  let dxf: {
    header?: Record<string, unknown>;
    entities?: RawEntity[];
    blocks?: Record<string, RawBlock>;
  } | null;
  try {
    dxf = new DxfParser().parseSync(text) as typeof dxf;
  } catch (e) {
    throw new DxfImportError(
      `Fichier DXF illisible : ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!dxf) throw new DxfImportError("Fichier DXF illisible : contenu vide.");
  const rawUnits = dxf.header?.["$INSUNITS"];
  const insUnits = typeof rawUnits === "number" && Number.isFinite(rawUnits) ? rawUnits : null;
  const known = insUnits !== null ? INSUNITS_MM[insUnits] : undefined;
  if (
    options.unitScale !== undefined &&
    !(options.unitScale > 0 && Number.isFinite(options.unitScale))
  ) {
    throw new DxfImportError(`Échelle invalide : ${options.unitScale} mm par unité.`);
  }
  const unitScale = options.unitScale ?? known?.mm ?? 1;
  const needsScale = options.unitScale === undefined && known === undefined;
  const out = new Collector(
    options.maxEntities ?? UNDERLAY_MAX_ENTITIES,
    options.maxVertices ?? UNDERLAY_MAX_VERTICES,
    options.layers ? new Set(options.layers) : null,
  );
  const m = scaling(unitScale, unitScale);
  for (const e of dxf.entities ?? []) {
    emit(e, m, dxf.blocks ?? {}, out, 0, undefined);
    if (out.full()) break;
  }
  const layers = [...new Set(out.entities.map((e) => e.layer ?? "0"))].sort();
  const bounds = segmentsBounds(out.entities.flatMap((e) => entitySegments(e)));
  return {
    entities: out.entities,
    insUnits,
    unitName: known?.name ?? null,
    unitScale,
    needsScale,
    bounds,
    layers,
    skipped: out.skipped,
    truncated: out.truncated,
  };
}

/** Centre d'une boîte englobante. */
export function boundsCenter(b: BBox): Vec2 {
  return V.lerp(b.min, b.max, 0.5);
}
