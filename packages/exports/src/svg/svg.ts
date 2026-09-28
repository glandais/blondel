/**
 * Outils SVG sans DOM : construction de chaînes, transformation mm → px (Y vers le bas),
 * thèmes clair / sombre, conversion des chemins à arcs exacts.
 */
import type { Mm, Severity, Vec2 } from "@blondel/core";
import { escapeXml, formatNum } from "../format.js";
import { arcFromBulge, type PlanPath } from "../path.js";

export interface SvgTheme {
  readonly background: string;
  readonly edge: string;
  readonly treadFill: string;
  readonly winderFill: string;
  readonly landingFill: string;
  readonly nosing: string;
  readonly nosingBalanced: string;
  readonly walkline: string;
  readonly opening: string;
  readonly dimension: string;
  readonly text: string;
  readonly mutedText: string;
  /** Violations : bloquant (rouge), avertissement (orange), conseil. */
  readonly blocking: string;
  readonly warning: string;
  readonly advice: string;
  readonly ceiling: string;
  readonly headroom: string;
  readonly panelFill: string;
  readonly panelStroke: string;
  readonly fontFamily: string;
}

export const LIGHT_THEME: SvgTheme = {
  background: "#ffffff",
  edge: "#1f2328",
  treadFill: "#f3efe6",
  winderFill: "#e6dcc6",
  landingFill: "#ece8f5",
  nosing: "#57606a",
  nosingBalanced: "#8a5a00",
  walkline: "#0969da",
  opening: "#6e40c9",
  dimension: "#424a53",
  text: "#1f2328",
  mutedText: "#57606a",
  blocking: "#d1242f",
  warning: "#e8860c",
  advice: "#bf8700",
  ceiling: "#afb8c1",
  headroom: "#1a7f37",
  panelFill: "#f6f8fa",
  panelStroke: "#d0d7de",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
};

export const DARK_THEME: SvgTheme = {
  background: "#0d1117",
  edge: "#e6edf3",
  treadFill: "#2a2620",
  winderFill: "#3d3424",
  landingFill: "#2b2838",
  nosing: "#9198a1",
  nosingBalanced: "#e3b341",
  walkline: "#4493f8",
  opening: "#ab7df8",
  dimension: "#b7bdc8",
  text: "#e6edf3",
  mutedText: "#9198a1",
  blocking: "#f85149",
  warning: "#f0883e",
  advice: "#d29922",
  ceiling: "#484f58",
  headroom: "#3fb950",
  panelFill: "#161b22",
  panelStroke: "#30363d",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
};

export type ThemeOption =
  "light" | "dark" | (Partial<SvgTheme> & { readonly base?: "light" | "dark" });

export function resolveTheme(theme: ThemeOption | undefined): SvgTheme {
  if (theme === undefined || theme === "light") return LIGHT_THEME;
  if (theme === "dark") return DARK_THEME;
  const { base, ...rest } = theme;
  return { ...(base === "dark" ? DARK_THEME : LIGHT_THEME), ...rest };
}

export function severityColor(theme: SvgTheme, s: Severity): string {
  return s === "bloquant" ? theme.blocking : s === "avertissement" ? theme.warning : theme.advice;
}

/** Options d'échelle communes aux rendus SVG. */
export interface SvgScaleOptions {
  /** Pixels par millimètre (défaut 0,15). Ignoré si `scale` est fourni. */
  readonly pxPerMm?: number;
  /**
   * Échelle d'impression 1:`scale` (ex. 20 pour 1:20). Le SVG reçoit alors une largeur et une
   * hauteur en mm papier ; px/mm = dpi / 25,4 / scale.
   */
  readonly scale?: number;
  /** Résolution de référence pour `scale` (défaut 96 : px CSS). */
  readonly dpi?: number;
  /** Marge autour du dessin (px, défaut 16). */
  readonly margin?: number;
}

export function resolvePxPerMm(o: SvgScaleOptions): number {
  if (o.scale !== undefined) {
    if (!(o.scale > 0)) throw new RangeError(`Échelle invalide : 1:${o.scale}`);
    return (o.dpi ?? 96) / 25.4 / o.scale;
  }
  const k = o.pxPerMm ?? 0.15;
  if (!(k > 0) || !Number.isFinite(k)) throw new RangeError(`pxPerMm invalide : ${k}`);
  return k;
}

/** Transformation affine mm (Y vers le haut) → px (Y vers le bas). */
export interface Viewport {
  readonly k: number;
  readonly minX: Mm;
  readonly maxY: Mm;
  readonly margin: number;
}

export function toPx(vp: Viewport, p: Vec2): Vec2 {
  return { x: (p.x - vp.minX) * vp.k + vp.margin, y: (vp.maxY - p.y) * vp.k + vp.margin };
}

/** Nombre px pour un attribut (2 décimales). */
export const n2 = (v: number): string => formatNum(v, 2);

export type Attrs = Readonly<Record<string, string | number | undefined>>;

function attrs(a: Attrs): string {
  let out = "";
  for (const [k, v] of Object.entries(a)) {
    if (v === undefined) continue;
    out += ` ${k}="${escapeXml(typeof v === "number" ? n2(v) : v)}"`;
  }
  return out;
}

/** Élément SVG ; `children` est du SVG déjà construit (non échappé). */
export function el(name: string, a: Attrs = {}, children?: string | readonly string[]): string {
  const body =
    children === undefined
      ? undefined
      : typeof children === "string"
        ? children
        : children.join("");
  return body === undefined || body === ""
    ? `<${name}${attrs(a)}/>`
    : `<${name}${attrs(a)}>${body}</${name}>`;
}

/** Élément texte (contenu échappé). */
export function text(a: Attrs, content: string): string {
  return `<text${attrs(a)}>${escapeXml(content)}</text>`;
}

/** Attribut `d` d'un chemin à arcs exacts, en px. */
export function pathData(vp: Viewport, path: PlanPath): string {
  const vs = path.vertices;
  if (vs.length === 0) return "";
  const parts: string[] = [];
  const p0 = toPx(vp, vs[0]!);
  parts.push(`M${n2(p0.x)} ${n2(p0.y)}`);
  const count = path.closed ? vs.length : vs.length - 1;
  for (let i = 0; i < count; i++) {
    const a = vs[i]!;
    const b = vs[(i + 1) % vs.length]!;
    const pb = toPx(vp, b);
    if (a.bulge === 0) {
      if (path.closed && i === vs.length - 1) break; // fermé par Z
      parts.push(`L${n2(pb.x)} ${n2(pb.y)}`);
    } else {
      const arc = arcFromBulge(a, b, a.bulge);
      const r = arc.radius * vp.k;
      const large = Math.abs(arc.sweep) > Math.PI ? 1 : 0;
      // Y inversé : un arc trigonométrique (monde) est horaire à l'écran → drapeau 1.
      const sweepFlag = arc.sweep > 0 ? 1 : 0;
      parts.push(`A${n2(r)} ${n2(r)} 0 ${large} ${sweepFlag} ${n2(pb.x)} ${n2(pb.y)}`);
    }
  }
  if (path.closed) parts.push("Z");
  return parts.join("");
}

/** Chemin d'une polyligne de points monde. */
export function polylineData(vp: Viewport, pts: readonly Vec2[], closed = false): string {
  return (
    pts
      .map((p, i) => {
        const q = toPx(vp, p);
        return `${i === 0 ? "M" : "L"}${n2(q.x)} ${n2(q.y)}`;
      })
      .join("") + (closed ? "Z" : "")
  );
}

/** Document SVG complet. */
export function svgDocument(
  widthPx: number,
  heightPx: number,
  body: readonly string[],
  o: {
    readonly physicalMm?: { w: number; h: number };
    readonly title?: string;
    readonly className?: string;
  },
): string {
  const w = o.physicalMm ? `${n2(o.physicalMm.w)}mm` : n2(widthPx);
  const h = o.physicalMm ? `${n2(o.physicalMm.h)}mm` : n2(heightPx);
  const title = o.title !== undefined ? `<title>${escapeXml(o.title)}</title>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${n2(widthPx)} ${n2(heightPx)}"` +
    (o.className !== undefined ? ` class="${escapeXml(o.className)}"` : "") +
    `>` +
    title +
    body.join("") +
    `</svg>`
  );
}
