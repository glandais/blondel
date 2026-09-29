/**
 * Interprète SVG minimal vers une `PdfCanvas` : rejoue en vectoriel les SVG produits par
 * `@blondel/exports` (plan, élévation, développés), sans DOM.
 *
 * Pourquoi pas svg2pdf.js : il exige un DOM (`window`, éléments SVG) et échoue sous Node
 * (vérifié avec svg2pdf.js 2.8.1 / jsPDF 4.2.1 : « Cannot read properties of undefined
 * (reading 'jsPDF') ») ; nos SVG n'utilisent qu'un sous-ensemble connu, rendu ici à
 * l'identique dans le navigateur et dans les tests.
 *
 * Sous-ensemble pris en charge : `svg` (viewBox, width/height en mm), `g`, `path` (M L H V C
 * A Z, absolus et relatifs), `line`, `rect` (sans arrondi), `circle`, `polygon`, `polyline`,
 * `text` ; attributs de présentation hérités (fill, stroke, stroke-width, stroke-dasharray,
 * fill-opacity, stroke-opacity, opacity, fill-rule, font-size, font-weight, text-anchor,
 * dominant-baseline) ; `transform` (matrix, translate, scale, rotate). Couleurs `#rgb`,
 * `#rrggbb`, quelques noms. Le reste (`title`, `defs`, CSS) est ignoré.
 */
import type { PaintStyle, PathOp, PdfCanvas, Rgb } from "./canvas.js";

// ------------------------------------------------------------------ analyse XML

export interface SvgNode {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: SvgNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (m, e: string) => {
    if (e.startsWith("#x")) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith("#")) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

/** Analyse un document SVG (XML simple, sans DTD ni CDATA). */
export function parseSvg(src: string): SvgNode {
  const root: SvgNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: SvgNode[] = [root];
  const tag =
    /<(\/?)([A-Za-z_][-\w:.]*)((?:\s+[-\w:.]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g;
  const attr = /([-\w:.]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let last = 0;
  for (let m = tag.exec(src); m !== null; m = tag.exec(src)) {
    const between = src.slice(last, m.index);
    if (between.trim() !== "") stack[stack.length - 1]!.text += decodeEntities(between);
    last = tag.lastIndex;
    if (m[2] === undefined) continue; // déclaration ou commentaire
    if (m[1] === "/") {
      if (stack.length > 1 && stack[stack.length - 1]!.name === m[2]) stack.pop();
      else throw new Error(`SVG : balise fermante inattendue </${m[2]}>`);
      continue;
    }
    const attrs: Record<string, string> = {};
    for (let a = attr.exec(m[3] ?? ""); a !== null; a = attr.exec(m[3] ?? "")) {
      attrs[a[1]!] = decodeEntities(a[2] ?? a[3] ?? "");
    }
    attr.lastIndex = 0;
    const node: SvgNode = { name: m[2], attrs, children: [], text: "" };
    stack[stack.length - 1]!.children.push(node);
    if (m[4] !== "/") stack.push(node);
  }
  if (stack.length !== 1) throw new Error("SVG : balises non fermées");
  const svg = root.children.find((c) => c.name === "svg");
  if (!svg) throw new Error("SVG : élément racine <svg> absent");
  return svg;
}

// ------------------------------------------------------------------ géométrie

/** Matrice affine [a b c d e f] : x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function mul(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

const numbers = (s: string): number[] =>
  (s.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);

export function parseTransform(t: string | undefined): Matrix {
  if (t === undefined) return IDENTITY;
  let m = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  for (let r = re.exec(t); r !== null; r = re.exec(t)) {
    const v = numbers(r[2]!);
    let n: Matrix = IDENTITY;
    switch (r[1]) {
      case "matrix":
        if (v.length === 6) n = v as unknown as Matrix;
        break;
      case "translate":
        n = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
        break;
      case "scale":
        n = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
        break;
      case "rotate": {
        const a = ((v[0] ?? 0) * Math.PI) / 180;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const cx = v[1] ?? 0;
        const cy = v[2] ?? 0;
        n = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
        break;
      }
      case "skewX":
        n = [1, 0, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case "skewY":
        n = [1, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = mul(m, n);
  }
  return m;
}

/** Arc elliptique SVG (paramétrage par extrémités) → courbes de Bézier cubiques (≤ 90° chacune). */
export function arcToBeziers(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  phiDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): PathOp[] {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) {
    return x1 === x2 && y1 === y2 ? [] : [{ op: "L", x: x2, y: y2 }];
  }
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180;
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  // SVG 1.1 F.6.5
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy;
  const y1p = -sp * dx + cp * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2;
  const cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number): number =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  else if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const h = dt / n;
  const k = (4 / 3) * Math.tan(h / 4);
  const pt = (t: number): { x: number; y: number } => ({
    x: cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp,
    y: cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp,
  });
  const der = (t: number): { x: number; y: number } => ({
    x: -rx * Math.sin(t) * cp - ry * Math.cos(t) * sp,
    y: -rx * Math.sin(t) * sp + ry * Math.cos(t) * cp,
  });
  const out: PathOp[] = [];
  for (let i = 0; i < n; i++) {
    const a = t1 + i * h;
    const b = a + h;
    const pa = pt(a);
    const pb = i === n - 1 ? { x: x2, y: y2 } : pt(b);
    const da = der(a);
    const db = der(b);
    out.push({
      op: "C",
      x1: pa.x + k * da.x,
      y1: pa.y + k * da.y,
      x2: pb.x - k * db.x,
      y2: pb.y - k * db.y,
      x: pb.x,
      y: pb.y,
    });
  }
  return out;
}

/** Données de chemin SVG → opérations absolues (M, L, C, Z) dans le repère du SVG. */
export function parsePathData(d: string): PathOp[] {
  const tokens = d.match(/[MmLlHhVvCcAaZzSsQqTt]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const out: PathOp[] = [];
  let i = 0;
  let cmd = "";
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  const next = (): number => {
    const t = tokens[i++];
    if (t === undefined || /[A-Za-z]/.test(t)) throw new Error(`SVG : chemin invalide « ${d} »`);
    return Number(t);
  };
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (/[A-Za-z]/.test(t)) {
      cmd = t;
      i++;
    } else if (cmd === "" || cmd === "Z" || cmd === "z") {
      throw new Error(`SVG : chemin invalide « ${d} »`);
    }
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case "M":
        x = ox + next();
        y = oy + next();
        sx = x;
        sy = y;
        out.push({ op: "M", x, y });
        cmd = rel ? "l" : "L"; // paires suivantes = lignes
        break;
      case "L":
        x = ox + next();
        y = oy + next();
        out.push({ op: "L", x, y });
        break;
      case "H":
        x = ox + next();
        out.push({ op: "L", x, y });
        break;
      case "V":
        y = oy + next();
        out.push({ op: "L", x, y });
        break;
      case "C": {
        const x1 = ox + next();
        const y1 = oy + next();
        const x2 = ox + next();
        const y2 = oy + next();
        x = ox + next();
        y = oy + next();
        out.push({ op: "C", x1, y1, x2, y2, x, y });
        break;
      }
      case "A": {
        const rx = next();
        const ry = next();
        const rot = next();
        const large = next() !== 0;
        const sw = next() !== 0;
        const nx = ox + next();
        const ny = oy + next();
        out.push(...arcToBeziers(x, y, rx, ry, rot, large, sw, nx, ny));
        x = nx;
        y = ny;
        break;
      }
      case "Z":
        out.push({ op: "Z" });
        x = sx;
        y = sy;
        break;
      default:
        throw new Error(`SVG : commande de chemin non prise en charge « ${cmd} »`);
    }
  }
  return out;
}

// ------------------------------------------------------------------ style

const NAMED: Readonly<Record<string, Rgb>> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
};

/** Couleur SVG → RVB ; `none` / `transparent` → `null` ; inconnue → noir. */
export function parseColor(c: string): Rgb | null {
  const s = c.trim().toLowerCase();
  if (s === "none" || s === "transparent") return null;
  let m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) {
    const v = parseInt(m[1]!, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) {
    const [r, g, b] = m[1]!.split("").map((h) => parseInt(h + h, 16));
    return [r!, g!, b!];
  }
  m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return NAMED[s] ?? [0, 0, 0];
}

interface Inherited {
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly dash: string;
  readonly fillOpacity: number;
  readonly strokeOpacity: number;
  readonly opacity: number;
  readonly fillRule: string;
  readonly fontSize: number;
  readonly fontWeight: string;
  readonly anchor: string;
  readonly baseline: string;
}

const DEFAULT_STYLE: Inherited = {
  fill: "#000000",
  stroke: "none",
  strokeWidth: 1,
  dash: "none",
  fillOpacity: 1,
  strokeOpacity: 1,
  opacity: 1,
  fillRule: "nonzero",
  fontSize: 16,
  fontWeight: "normal",
  anchor: "start",
  baseline: "auto",
};

function inherit(p: Inherited, a: Readonly<Record<string, string>>): Inherited {
  const num = (v: string | undefined, d: number): number => {
    if (v === undefined) return d;
    const x = parseFloat(v);
    return Number.isFinite(x) ? x : d;
  };
  return {
    fill: a.fill ?? p.fill,
    stroke: a.stroke ?? p.stroke,
    strokeWidth: num(a["stroke-width"], p.strokeWidth),
    dash: a["stroke-dasharray"] ?? p.dash,
    fillOpacity: num(a["fill-opacity"], p.fillOpacity),
    strokeOpacity: num(a["stroke-opacity"], p.strokeOpacity),
    // `opacity` n'est pas héritée en SVG mais s'applique au groupe : produit (approximation).
    opacity: p.opacity * num(a.opacity, 1),
    fillRule: a["fill-rule"] ?? p.fillRule,
    fontSize: num(a["font-size"], p.fontSize),
    fontWeight: a["font-weight"] ?? p.fontWeight,
    anchor: a["text-anchor"] ?? p.anchor,
    baseline: a["dominant-baseline"] ?? p.baseline,
  };
}

// ------------------------------------------------------------------ rendu

export interface SvgPlacement {
  /** Coin haut gauche sur la page, mm. */
  readonly x: number;
  readonly y: number;
  /** Échelle px SVG → mm page (défaut : width en mm / largeur du viewBox). */
  readonly scale?: number;
}

/** Taille physique d'un SVG (mm) et viewBox (px). */
export function svgSize(svg: SvgNode): {
  widthMm?: number;
  heightMm?: number;
  viewBox: readonly [number, number, number, number];
} {
  const vb = numbers(svg.attrs.viewBox ?? "");
  const w = svg.attrs.width;
  const h = svg.attrs.height;
  const mm = (v: string | undefined): number | undefined =>
    v !== undefined && /mm\s*$/.test(v) ? parseFloat(v) : undefined;
  const viewBox: [number, number, number, number] =
    vb.length === 4
      ? [vb[0]!, vb[1]!, vb[2]!, vb[3]!]
      : [0, 0, parseFloat(w ?? "0") || 0, parseFloat(h ?? "0") || 0];
  const widthMm = mm(w);
  const heightMm = mm(h);
  return {
    ...(widthMm !== undefined ? { widthMm } : {}),
    ...(heightMm !== undefined ? { heightMm } : {}),
    viewBox,
  };
}

const SHAPES = new Set(["path", "line", "rect", "circle", "polygon", "polyline"]);

/**
 * Dessine un SVG sur la page. Échelle : `placement.scale` (mm par px) sinon largeur physique
 * (`width="…mm"`) / largeur du viewBox, sinon 25,4 / 96 (px CSS). Renvoie l'emprise (mm).
 */
export function drawSvg(
  canvas: PdfCanvas,
  source: string | SvgNode,
  placement: SvgPlacement,
): { width: number; height: number } {
  const svg = typeof source === "string" ? parseSvg(source) : source;
  const size = svgSize(svg);
  const [vx, vy, vw, vh] = size.viewBox;
  const k =
    placement.scale ?? (size.widthMm !== undefined && vw > 0 ? size.widthMm / vw : 25.4 / 96);
  const root: Matrix = [k, 0, 0, k, placement.x - vx * k, placement.y - vy * k];

  const visit = (node: SvgNode, m: Matrix, st: Inherited): void => {
    const style = inherit(st, node.attrs);
    const mat = mul(m, parseTransform(node.attrs.transform));
    if (node.name === "g" || node.name === "svg") {
      for (const c of node.children) visit(c, mat, style);
      return;
    }
    if (node.name === "text") {
      drawText(canvas, node, mat, style);
      return;
    }
    if (!SHAPES.has(node.name)) return;
    const ops = shapeOps(node);
    if (ops.length === 0) return;
    const scale = Math.sqrt(Math.abs(mat[0] * mat[3] - mat[1] * mat[2]));
    const tops = ops.map((o): PathOp => {
      if (o.op === "Z") return o;
      const p = apply(mat, o.x, o.y);
      if (o.op === "C") {
        const p1 = apply(mat, o.x1, o.y1);
        const p2 = apply(mat, o.x2, o.y2);
        return { op: "C", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p.x, y: p.y };
      }
      return { op: o.op, x: p.x, y: p.y };
    });
    const isLine = node.name === "line" || node.name === "polyline";
    const fill = isLine ? null : parseColor(style.fill);
    const stroke = parseColor(style.stroke);
    const dash = style.dash === "none" ? [] : numbers(style.dash).map((v) => v * scale);
    const paint: PaintStyle = {
      ...(fill ? { fill, fillOpacity: style.fillOpacity * style.opacity } : {}),
      fillRule: style.fillRule === "evenodd" ? "evenodd" : "nonzero",
      ...(stroke && style.strokeWidth > 0
        ? {
            stroke,
            strokeOpacity: style.strokeOpacity * style.opacity,
            lineWidth: style.strokeWidth * scale,
            ...(dash.length > 0 && dash.some((v) => v > 0) ? { dash } : {}),
          }
        : {}),
    };
    if (paint.fill === undefined && paint.stroke === undefined) return;
    canvas.path(tops, paint);
  };
  visit(svg, root, DEFAULT_STYLE);
  return { width: vw * k, height: vh * k };
}

function shapeOps(node: SvgNode): PathOp[] {
  const a = node.attrs;
  const f = (v: string | undefined): number => parseFloat(v ?? "0") || 0;
  switch (node.name) {
    case "path":
      return a.d ? parsePathData(a.d) : [];
    case "line":
      return [
        { op: "M", x: f(a.x1), y: f(a.y1) },
        { op: "L", x: f(a.x2), y: f(a.y2) },
      ];
    case "rect": {
      const x = f(a.x);
      const y = f(a.y);
      const w = f(a.width);
      const h = f(a.height);
      if (!(w > 0 && h > 0)) return [];
      return [
        { op: "M", x, y },
        { op: "L", x: x + w, y },
        { op: "L", x: x + w, y: y + h },
        { op: "L", x, y: y + h },
        { op: "Z" },
      ];
    }
    case "circle": {
      const cx = f(a.cx);
      const cy = f(a.cy);
      const r = f(a.r);
      if (!(r > 0)) return [];
      return [
        { op: "M", x: cx + r, y: cy },
        ...arcToBeziers(cx + r, cy, r, r, 0, false, true, cx - r, cy),
        ...arcToBeziers(cx - r, cy, r, r, 0, false, true, cx + r, cy),
        { op: "Z" },
      ];
    }
    case "polygon":
    case "polyline": {
      const v = numbers(a.points ?? "");
      const ops: PathOp[] = [];
      for (let i = 0; i + 1 < v.length; i += 2) {
        ops.push({ op: i === 0 ? "M" : "L", x: v[i]!, y: v[i + 1]! });
      }
      if (node.name === "polygon" && ops.length > 0) ops.push({ op: "Z" });
      return ops;
    }
  }
  return [];
}

function drawText(canvas: PdfCanvas, node: SvgNode, m: Matrix, st: Inherited): void {
  const value = node.text.replace(/\s+/g, " ").trim();
  const fill = parseColor(st.fill);
  if (value === "" || fill === null) return;
  const x = parseFloat(node.attrs.x ?? "0") || 0;
  const y = parseFloat(node.attrs.y ?? "0") || 0;
  // Axe du texte (x local) et échelle dans le repère de la page.
  const ux = m[0];
  const uy = m[1];
  const scale = Math.hypot(ux, uy);
  if (!(scale > 0)) return;
  const dir = { x: ux / scale, y: uy / scale };
  const down = { x: -dir.y, y: dir.x }; // perpendiculaire vers le bas du texte
  const size = st.fontSize * scale;
  const bold = st.fontWeight === "bold" || Number(st.fontWeight) >= 600;
  const w = canvas.textWidth(value, size, bold);
  const p = apply(m, x, y);
  const shift = st.anchor === "middle" ? -w / 2 : st.anchor === "end" ? -w : 0;
  // Ligne de base : `central` / `middle` → centre de l'œil (≈ 0,35 corps sous le centre).
  const drop =
    st.baseline === "central" || st.baseline === "middle"
      ? 0.35 * size
      : st.baseline === "hanging" || st.baseline === "text-before-edge"
        ? 0.75 * size
        : 0;
  const px = p.x + dir.x * shift + down.x * drop;
  const py = p.y + dir.y * shift + down.y * drop;
  // Angle à l'écran (Y vers le bas) : trigonométrique = −atan2(dir.y, dir.x).
  const angle = (-Math.atan2(dir.y, dir.x) * 180) / Math.PI;
  canvas.text(value, px, py, {
    size,
    color: fill,
    bold,
    ...(Math.abs(angle) > 1e-6 ? { angle } : {}),
    ...(st.opacity * st.fillOpacity < 1 ? { opacity: st.opacity * st.fillOpacity } : {}),
  });
}
