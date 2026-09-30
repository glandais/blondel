/**
 * Planche d'un développé à plat (`FlatPattern`) en SVG : contour et trous, lignes de pli,
 * de traçage (mortaises et tenons sur un style dédié), de roulage et de joint, cotes
 * hors-tout, repère gravé et ligne d'information. Fonction pure, sans DOM ; réutilisée par
 * l'export PDF (une page par développé, à l'échelle indiquée).
 */
import { bbox, type Part, type Vec2 } from "@blondel/core";
import { MATERIAL_LABELS } from "../csv/cutlist.js";
import { flatEngravingPoint, partLineAnnotation, referenceText } from "../dxf/part.js";
import { formatFr } from "../format.js";
import { tr } from "../i18n.js";
import { polygonPath } from "../path.js";
import { dimensionGeometry, type Dimension } from "../plan/drawing.js";
import {
  el,
  n2,
  pathData,
  polylineData,
  resolvePxPerMm,
  resolveTheme,
  svgDocument,
  text,
  toPx,
  type SvgScaleOptions,
  type SvgTheme,
  type ThemeOption,
  type Viewport,
} from "./svg.js";

export interface FlatPatternSvgOptions extends SvgScaleOptions {
  readonly theme?: ThemeOption;
  /** Taille des textes (px, défaut 12). */
  readonly fontSize?: number;
  /** Fond plein (défaut : vrai). */
  readonly background?: boolean;
  readonly title?: string;
  /** Cotes hors-tout (défaut : vrai). */
  readonly dimensions?: boolean;
  /** Ligne d'information sous la pièce (défaut : vrai). */
  readonly info?: boolean;
  /** Décimales des cotes (défaut 1 : fabrication au 0,1 mm, ADR-0003). */
  readonly decimals?: number;
}

type FlatLine = NonNullable<Part["flat"]>["lines"][number];

/** Largeur minimale (caractères) d'une ligne d'information repliée. */
const INFO_MIN_CHARS = 60;
/** Interligne de l'information, en hauteurs de texte. */
const INFO_LINE_STEP = 1.3;

/** Replie un texte aux espaces en lignes d'au plus `maxChars` caractères (mot long : seul). */
export function wrapWords(textValue: string, maxChars: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of textValue.split(/\s+/).filter((w) => w !== "")) {
    if (cur === "") cur = word;
    else if (cur.length + 1 + word.length <= maxChars) cur += ` ${word}`;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines.length > 0 ? lines : [""];
}

/** Style d'une ligne du développé : chaque nature a son trait (et les mortaises le leur). */
export type FlatLineStyle = "bend" | "mark" | "mortise" | "tenon" | "roll" | "joint";

export function flatLineStyle(l: FlatLine): FlatLineStyle | undefined {
  if (l.kind === "text") return undefined;
  if (l.kind === "mark" && l.feature !== undefined) return l.feature;
  return l.kind;
}

function lineAttrs(theme: SvgTheme, style: FlatLineStyle): Record<string, string | number> {
  switch (style) {
    case "bend":
      return { stroke: theme.blocking, "stroke-width": 1, "stroke-dasharray": "8 4" };
    case "mark":
      return { stroke: theme.nosing, "stroke-width": 0.7, "stroke-dasharray": "4 3" };
    case "mortise":
      return { stroke: theme.nosingBalanced, "stroke-width": 1.4 };
    case "tenon":
      return { stroke: theme.opening, "stroke-width": 1.4 };
    case "roll":
      return { stroke: theme.walkline, "stroke-width": 1, "stroke-dasharray": "10 3 2 3" };
    case "joint":
      return { stroke: theme.dimension, "stroke-width": 1 };
  }
}

/** Dimensions hors-tout du développé (boîte englobante du contour), mm. */
export function flatPatternExtent(part: Part): { width: number; height: number } {
  const flat = part.flat;
  if (flat === undefined || flat.outline.outer.length < 3) return { width: 0, height: 0 };
  const b = bbox(flat.outline.outer);
  return { width: b.max.x - b.min.x, height: b.max.y - b.min.y };
}

/**
 * Planche SVG du développé d'une pièce ; lève `RangeError` si la pièce n'a pas de développé
 * (comme `exportPartDxf`). Coordonnées du développé en mm, Y vers le haut.
 */
export function renderFlatPatternSvg(part: Part, options: FlatPatternSvgOptions = {}): string {
  const flat = part.flat;
  if (flat === undefined) {
    throw new RangeError(`La pièce ${part.mark} (${part.id}) n'a pas de développé à plat.`);
  }
  if (flat.outline.outer.length < 3) {
    throw new RangeError(`Le développé de la pièce ${part.mark} n'a pas de contour.`);
  }
  const k = resolvePxPerMm({ pxPerMm: 0.5, ...options });
  const theme = resolveTheme(options.theme);
  const fontSize = options.fontSize ?? 12;
  const margin = options.margin ?? 16;
  const decimals = options.decimals ?? 1;
  const th = fontSize / k; // hauteur de texte en mm du développé
  const showDims = options.dimensions !== false;
  const showInfo = options.info !== false;

  const box = bbox(flat.outline.outer);
  const w0 = box.max.x - box.min.x;
  const h0 = box.max.y - box.min.y;
  const fmt = (v: number): string => formatFr(v, { decimals, trimZeros: true });

  // Cotes hors-tout : longueur sous la pièce, hauteur à gauche.
  const off = 2.5 * th;
  const dims: { dim: Dimension; name: "length" | "height" }[] = showDims
    ? [
        {
          name: "length",
          dim: {
            role: "width",
            a: { x: box.min.x, y: box.min.y },
            b: { x: box.max.x, y: box.min.y },
            normal: { x: 0, y: -1 },
            offset: off,
            value: w0,
            text: fmt(w0),
          },
        },
        {
          name: "height",
          dim: {
            role: "height",
            a: { x: box.min.x, y: box.min.y },
            b: { x: box.min.x, y: box.max.y },
            normal: { x: -1, y: 0 },
            offset: off,
            value: h0,
            text: fmt(h0),
          },
        },
      ]
    : [];

  // Emprise du dessin (mm) : pièce, lignes, cotes et ligne d'information.
  const pts: Vec2[] = [...flat.outline.outer];
  for (const l of flat.lines) pts.push(l.a, l.b);
  let minX = Math.min(...pts.map((p) => p.x));
  let maxX = Math.max(...pts.map((p) => p.x));
  let minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y)) + th;
  if (showDims) {
    minX -= off + 2 * th;
    minY -= off + 2 * th;
  }
  const infoY = minY - 1.2 * th;
  const t = formatFr(flat.thickness, { decimals: 1, trimZeros: true, thousands: "" });
  const info = `${part.mark} — ${tr(part.name)} — ${MATERIAL_LABELS[part.material] ?? part.material} — épaisseur ${t} mm${part.section !== undefined ? ` — ${tr(part.section)}` : ""}`;
  const ref = referenceText(flat);
  const infoText = ref !== undefined ? `${info} — ${ref}` : info;
  // Ligne d'information repliée à la largeur du dessin (au moins INFO_MIN_CHARS caractères) :
  // sur une seule ligne, sa largeur physique ne dépend pas de l'échelle et une planche longue
  // (description de la fibre de référence) ne tenait dans le cadre du PDF à aucune échelle.
  const charW = th * 0.55;
  const infoLines = showInfo
    ? wrapWords(infoText, Math.max(INFO_MIN_CHARS, Math.floor((maxX - minX) / charW)))
    : [];
  if (showInfo) {
    minY = infoY - (infoLines.length - 1) * INFO_LINE_STEP * th - 0.8 * th;
    maxX = Math.max(maxX, minX + Math.max(...infoLines.map((l) => l.length)) * charW);
  }

  const vp: Viewport = { k, minX, maxY, margin };
  const width = (maxX - minX) * k + 2 * margin;
  const height = (maxY - minY) * k + 2 * margin;
  const font = { "font-family": theme.fontFamily, "font-size": fontSize };

  const body: string[] = [];
  if (options.background !== false) {
    body.push(
      el("rect", { class: "background", x: 0, y: 0, width, height, fill: theme.background }),
    );
  }

  // Contour et trous (règle pair-impair).
  const rings = [flat.outline.outer, ...flat.outline.holes.filter((h) => h.length >= 3)];
  body.push(
    el("path", {
      class: "outline",
      d: rings.map((r) => pathData(vp, polygonPath(r))).join(""),
      fill: theme.treadFill,
      "fill-rule": "evenodd",
      stroke: theme.edge,
      "stroke-width": 1.5,
      "stroke-linejoin": "round",
    }),
  );

  // Lignes du développé, groupées par style.
  const lines: string[] = [];
  const labels: string[] = [];
  for (const l of flat.lines) {
    const style = flatLineStyle(l);
    if (style === undefined) {
      if (l.label === undefined) continue;
      const p = toPx(vp, l.a);
      const deg = (-Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x) * 180) / Math.PI;
      labels.push(
        text(
          {
            x: p.x,
            y: p.y,
            transform: `rotate(${n2(deg)} ${n2(p.x)} ${n2(p.y)})`,
            ...font,
            fill: theme.text,
            "data-kind": "text",
          },
          tr(l.label),
        ),
      );
      continue;
    }
    lines.push(
      el("path", {
        d: polylineData(vp, [l.a, l.b]),
        ...lineAttrs(theme, style),
        "data-kind": l.kind,
        "data-feature": l.feature,
      }),
    );
    const annotation = partLineAnnotation(l);
    if (annotation !== undefined) {
      const mid = toPx(vp, { x: (l.a.x + l.b.x) / 2, y: (l.a.y + l.b.y) / 2 });
      let a = (Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x) * 180) / Math.PI;
      if (a > 90) a -= 180;
      else if (a <= -90) a += 180;
      labels.push(
        text(
          {
            x: mid.x,
            y: mid.y - fontSize * 0.3,
            transform: `rotate(${n2(-a)} ${n2(mid.x)} ${n2(mid.y)})`,
            ...font,
            "font-size": fontSize * 0.85,
            "text-anchor": "middle",
            fill: lineAttrs(theme, style).stroke!,
            "data-kind": l.kind,
          },
          annotation,
        ),
      );
    }
  }
  body.push(el("g", { class: "lines", fill: "none" }, lines));
  body.push(el("g", { class: "labels" }, labels));

  // Cotes hors-tout.
  if (dims.length > 0) {
    body.push(
      el(
        "g",
        { class: "dimensions", stroke: theme.dimension, "stroke-width": 0.8, fill: "none" },
        dims.map(({ dim, name }) => {
          const g = dimensionGeometry(dim, th);
          const segs = [g.line, ...g.extensions, ...g.ticks];
          const p = toPx(vp, g.textAt);
          const deg = (-g.textAngle * 180) / Math.PI;
          return el("g", { "data-dimension": name }, [
            el("path", { d: segs.map((s) => polylineData(vp, s)).join("") }),
            text(
              {
                x: p.x,
                y: p.y,
                transform: `rotate(${n2(deg)} ${n2(p.x)} ${n2(p.y)})`,
                ...font,
                "text-anchor": "middle",
                "dominant-baseline": "central",
                fill: theme.text,
                stroke: "none",
                "data-value": n2(dim.value),
              },
              dim.text,
            ),
          ]);
        }),
      ),
    );
  }

  // Repère gravé, dans la matière (même point que le DXF).
  const spot = flatEngravingPoint(flat);
  const markPx = Math.max(fontSize * 0.8, Math.min(fontSize * 2, 1.6 * spot.clearance * k));
  const sp = toPx(vp, spot.at);
  body.push(
    text(
      {
        class: "mark",
        x: sp.x,
        y: sp.y,
        "font-family": theme.fontFamily,
        "font-size": markPx,
        "font-weight": "bold",
        "text-anchor": "middle",
        "dominant-baseline": "central",
        fill: theme.text,
        "data-mark": part.mark,
      },
      part.mark,
    ),
  );

  infoLines.forEach((line, i) => {
    const ip = toPx(vp, { x: minX, y: infoY - i * INFO_LINE_STEP * th });
    body.push(text({ class: "info", x: ip.x, y: ip.y, ...font, fill: theme.mutedText }, line));
  });

  const physical =
    options.scale !== undefined
      ? { w: width / k / options.scale, h: height / k / options.scale }
      : undefined;
  return svgDocument(width, height, body, {
    ...(physical ? { physicalMm: physical } : {}),
    title: options.title ?? `Développé ${part.mark}`,
    className: "blondel-flat",
  });
}
