/**
 * Lecteur DXF ASCII minimal, indépendant des écrivains (réservé aux tests) : paires
 * code/valeur, en-tête, tables LAYER et LTYPE, entités LINE, ARC, CIRCLE, TEXT, POLYLINE
 * (VERTEX, SEQEND) et LWPOLYLINE.
 */

export interface DxfVertex {
  readonly x: number;
  readonly y: number;
  readonly bulge: number;
}

export type DxfEntity =
  | { readonly type: "LINE"; readonly layer: string; readonly a: Pt; readonly b: Pt }
  | { readonly type: "CIRCLE"; readonly layer: string; readonly c: Pt; readonly r: number }
  | {
      readonly type: "ARC";
      readonly layer: string;
      readonly c: Pt;
      readonly r: number;
      readonly start: number;
      readonly end: number;
    }
  | {
      readonly type: "TEXT";
      readonly layer: string;
      readonly at: Pt;
      readonly height: number;
      readonly value: string;
      readonly rotation: number;
    }
  | {
      readonly type: "POLYLINE" | "LWPOLYLINE";
      readonly layer: string;
      readonly closed: boolean;
      readonly vertices: readonly DxfVertex[];
    }
  | { readonly type: "OTHER"; readonly name: string; readonly layer: string };

interface Pt {
  readonly x: number;
  readonly y: number;
}

export interface DxfFile {
  readonly header: ReadonlyMap<string, readonly [number, string][]>;
  readonly layers: ReadonlyMap<string, { color: number; lineType: string }>;
  readonly lineTypes: readonly string[];
  readonly entities: readonly DxfEntity[];
}

type Pair = [number, string];

function pairs(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  if (lines.length % 2 !== 0) throw new Error("DXF : nombre de lignes impair");
  const out: Pair[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i]!.trim());
    if (!Number.isInteger(code)) throw new Error(`DXF : code de groupe invalide ligne ${i + 1}`);
    out.push([code, lines[i + 1]!.trim()]);
  }
  return out;
}

function num(v: string | undefined, what: string): number {
  const x = Number(v);
  if (v === undefined || !Number.isFinite(x))
    throw new Error(`DXF : nombre attendu (${what}) : ${v}`);
  return x;
}

/** Découpe une suite de paires en enregistrements commençant par un code 0. */
function records(ps: readonly Pair[]): Pair[][] {
  const out: Pair[][] = [];
  for (const p of ps) {
    if (p[0] === 0) out.push([p]);
    else {
      const last = out[out.length - 1];
      if (!last) throw new Error("DXF : paire hors enregistrement");
      last.push(p);
    }
  }
  return out;
}

const get = (r: readonly Pair[], code: number): string | undefined =>
  r.find((p) => p[0] === code)?.[1];

export function readDxf(text: string): DxfFile {
  const ps = pairs(text);
  const last = ps[ps.length - 1];
  if (!last || last[0] !== 0 || last[1] !== "EOF") throw new Error("DXF : EOF manquant");
  const sections = new Map<string, Pair[]>();
  let i = 0;
  while (i < ps.length) {
    const p = ps[i]!;
    if (p[0] === 0 && p[1] === "EOF") break;
    if (p[0] !== 0 || p[1] !== "SECTION") throw new Error(`DXF : SECTION attendue, lu ${p[1]}`);
    const name = ps[i + 1];
    if (!name || name[0] !== 2) throw new Error("DXF : nom de section manquant");
    let j = i + 2;
    while (j < ps.length && !(ps[j]![0] === 0 && ps[j]![1] === "ENDSEC")) j++;
    if (j >= ps.length) throw new Error(`DXF : section ${name[1]} non fermée`);
    sections.set(name[1], ps.slice(i + 2, j));
    i = j + 1;
  }

  const header = new Map<string, [number, string][]>();
  let current: [number, string][] | undefined;
  for (const p of sections.get("HEADER") ?? []) {
    if (p[0] === 9) header.set(p[1], (current = []));
    else current?.push(p);
  }

  const layers = new Map<string, { color: number; lineType: string }>();
  const lineTypes: string[] = [];
  for (const r of records(sections.get("TABLES") ?? [])) {
    if (r[0]![1] === "LAYER") {
      const name = get(r, 2);
      if (name !== undefined) {
        layers.set(name, { color: num(get(r, 62), "couleur"), lineType: get(r, 6) ?? "" });
      }
    } else if (r[0]![1] === "LTYPE") {
      const name = get(r, 2);
      if (name !== undefined) lineTypes.push(name);
    }
  }

  const entities: DxfEntity[] = [];
  const recs = records(sections.get("ENTITIES") ?? []);
  for (let k = 0; k < recs.length; k++) {
    const r = recs[k]!;
    const type = r[0]![1];
    const layer = get(r, 8) ?? "0";
    const pt = (cx: number, cy: number): Pt => ({
      x: num(get(r, cx), `${type} ${cx}`),
      y: num(get(r, cy), `${type} ${cy}`),
    });
    switch (type) {
      case "LINE":
        entities.push({ type, layer, a: pt(10, 20), b: pt(11, 21) });
        break;
      case "CIRCLE":
        entities.push({ type, layer, c: pt(10, 20), r: num(get(r, 40), "rayon") });
        break;
      case "ARC":
        entities.push({
          type,
          layer,
          c: pt(10, 20),
          r: num(get(r, 40), "rayon"),
          start: num(get(r, 50), "angle 50"),
          end: num(get(r, 51), "angle 51"),
        });
        break;
      case "TEXT": {
        const aligned = Number(get(r, 72) ?? 0) !== 0 || Number(get(r, 73) ?? 0) !== 0;
        entities.push({
          type,
          layer,
          at: aligned ? pt(11, 21) : pt(10, 20),
          height: num(get(r, 40), "hauteur"),
          value: get(r, 1) ?? "",
          rotation: Number(get(r, 50) ?? 0),
        });
        break;
      }
      case "POLYLINE": {
        const vertices: DxfVertex[] = [];
        let m = k + 1;
        for (; m < recs.length && recs[m]![0]![1] === "VERTEX"; m++) {
          const v = recs[m]!;
          if ((get(v, 8) ?? "0") !== layer) throw new Error("DXF : VERTEX sur un autre calque");
          vertices.push({
            x: num(get(v, 10), "VERTEX x"),
            y: num(get(v, 20), "VERTEX y"),
            bulge: Number(get(v, 42) ?? 0),
          });
        }
        if (recs[m]?.[0]?.[1] !== "SEQEND") throw new Error("DXF : SEQEND manquant");
        k = m;
        entities.push({ type, layer, closed: (Number(get(r, 70) ?? 0) & 1) === 1, vertices });
        break;
      }
      case "LWPOLYLINE": {
        const count = num(get(r, 90), "nombre de sommets");
        const vertices: { x: number; y: number; bulge: number }[] = [];
        for (const p of r) {
          if (p[0] === 10) vertices.push({ x: num(p[1], "x"), y: NaN, bulge: 0 });
          else if (p[0] === 20) vertices[vertices.length - 1]!.y = num(p[1], "y");
          else if (p[0] === 42) vertices[vertices.length - 1]!.bulge = num(p[1], "renflement");
        }
        if (vertices.length !== count) throw new Error("DXF : LWPOLYLINE incohérente");
        entities.push({ type, layer, closed: (Number(get(r, 70) ?? 0) & 1) === 1, vertices });
        break;
      }
      default:
        entities.push({ type: "OTHER", name: type, layer });
    }
  }
  return { header, layers, lineTypes, entities };
}

/** Polylignes (POLYLINE ou LWPOLYLINE) d'un calque. */
export function polylines(f: DxfFile, layer: string) {
  return f.entities.filter(
    (e): e is Extract<DxfEntity, { type: "POLYLINE" | "LWPOLYLINE" }> =>
      (e.type === "POLYLINE" || e.type === "LWPOLYLINE") && e.layer === layer,
  );
}

export function entitiesOn<T extends DxfEntity["type"]>(
  f: DxfFile,
  type: T,
  layer?: string,
): Extract<DxfEntity, { type: T }>[] {
  return f.entities.filter(
    (e): e is Extract<DxfEntity, { type: T }> =>
      e.type === type && (layer === undefined || e.layer === layer),
  );
}
