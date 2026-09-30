/**
 * Plan 2D coté en SVG : fonction pure, sans DOM, utilisée par l'interface (insertion du
 * texte SVG) et par les exports (fichier SVG, puis PDF).
 */
import type { Model } from "@blondel/core";
import { translatorOf } from "../i18n.js";
import {
  buildPlanDrawing,
  dimensionGeometry,
  type PlanDrawing,
  type PlanDrawingOptions,
} from "../plan/drawing.js";
import {
  el,
  n2,
  pathData,
  polylineData,
  resolvePxPerMm,
  resolveTheme,
  severityColor,
  svgDocument,
  text,
  toPx,
  type SvgScaleOptions,
  type SvgTheme,
  type ThemeOption,
  type Viewport,
} from "./svg.js";

export interface PlanSvgLayers {
  readonly numbers?: boolean;
  readonly dimensions?: boolean;
  readonly compliance?: boolean;
  readonly cartouche?: boolean;
  readonly opening?: boolean;
}

export interface PlanSvgOptions extends SvgScaleOptions, Omit<PlanDrawingOptions, "textHeight"> {
  readonly theme?: ThemeOption;
  /** Taille des textes (px, défaut 12) : constante à l'écran quelle que soit l'échelle. */
  readonly fontSize?: number;
  /** Éléments affichés (tous par défaut). */
  readonly show?: PlanSvgLayers;
  /** Fond plein (défaut : vrai). */
  readonly background?: boolean;
  /** Titre (élément `<title>`). */
  readonly title?: string;
}

function renderDrawing(
  d: PlanDrawing,
  vp: Viewport,
  theme: SvgTheme,
  fontSize: number,
  show: Required<PlanSvgLayers>,
): string[] {
  const out: string[] = [];
  const font = { "font-family": theme.fontFamily, "font-size": fontSize };

  // Palier d'arrivée d'un hélicoïdal (sous les marches : les tours supérieurs le recouvrent).
  if (d.landing) {
    out.push(
      el("path", {
        class: "landing",
        d: pathData(vp, d.landing),
        fill: theme.landingFill,
        stroke: "none",
        "data-kind": "landing",
      }),
    );
  }

  // Marches (remplissage : balancées, paliers, violations).
  out.push(
    el(
      "g",
      { class: "treads", stroke: "none" },
      d.treads.map((t) => {
        const base =
          t.kind === "winder"
            ? theme.winderFill
            : t.kind === "landing"
              ? theme.landingFill
              : theme.treadFill;
        const sev = show.compliance ? t.severity : undefined;
        const fill = sev !== undefined ? severityColor(theme, sev) : base;
        return el("path", {
          d: pathData(vp, t.surface),
          fill,
          "fill-opacity": sev !== undefined ? 0.45 : undefined,
          "data-tread": t.number,
          "data-kind": t.kind,
          "data-severity": sev,
        });
      }),
    ),
  );

  // Trémie en pointillés.
  if (d.opening && show.opening) {
    out.push(
      el("path", {
        class: "opening",
        d: pathData(vp, d.opening),
        fill: "none",
        stroke: theme.opening,
        "stroke-width": 1.2,
        "stroke-dasharray": "8 5",
      }),
    );
  }

  // Lignes de nez.
  out.push(
    el(
      "g",
      { class: "nosings", "stroke-linecap": "round" },
      d.nosings.map((nz) => {
        const a = toPx(vp, nz.a);
        const b = toPx(vp, nz.b);
        const sev = show.compliance ? nz.severity : undefined;
        return el("line", {
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          stroke:
            sev !== undefined
              ? severityColor(theme, sev)
              : nz.balanced
                ? theme.nosingBalanced
                : theme.nosing,
          "stroke-width": sev !== undefined ? 2.5 : nz.balanced ? 1.4 : 1,
          "data-nosing": nz.index,
          "data-balanced": nz.balanced ? "true" : undefined,
        });
      }),
    ),
  );

  // Bords.
  out.push(
    el("path", {
      class: "contour",
      d: pathData(vp, d.contour),
      fill: "none",
      stroke: theme.edge,
      "stroke-width": 1.8,
      "stroke-linejoin": "round",
    }),
  );

  // Ligne de foulée : trait mixte, cercle de départ, flèche de montée.
  const c = toPx(vp, d.walklineStart.center);
  out.push(
    el("g", { class: "walkline" }, [
      el("path", {
        d: pathData(vp, d.walkline),
        fill: "none",
        stroke: theme.walkline,
        "stroke-width": 1.3,
        "stroke-dasharray": "10 3 2 3",
      }),
      el("circle", {
        cx: c.x,
        cy: c.y,
        r: Math.max(2.5, d.walklineStart.radius * vp.k),
        fill: theme.background,
        stroke: theme.walkline,
        "stroke-width": 1.3,
      }),
      el("path", { d: pathData(vp, d.arrow), fill: theme.walkline, stroke: "none" }),
    ]),
  );

  // Numéros de marche.
  if (show.numbers) {
    out.push(
      el(
        "g",
        {
          class: "numbers",
          ...font,
          "text-anchor": "middle",
          "dominant-baseline": "central",
          fill: theme.text,
        },
        d.treads.map((t) => {
          const p = toPx(vp, t.label);
          return text({ x: p.x, y: p.y, "data-tread": t.number }, String(t.number));
        }),
      ),
    );
  }

  // Cotes.
  if (show.dimensions) {
    const th = d.textHeight;
    out.push(
      el(
        "g",
        { class: "dimensions", stroke: theme.dimension, "stroke-width": 0.8, fill: "none" },
        d.dimensions.map((dim) => {
          const g = dimensionGeometry(dim, th);
          const segs = [g.line, ...g.extensions, ...g.ticks];
          const p = toPx(vp, g.textAt);
          const deg = (-g.textAngle * 180) / Math.PI;
          return el("g", { "data-dimension": dim.role }, [
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

  // Marqueurs ponctuels du contrôle de conception.
  if (show.compliance && d.markers.length > 0) {
    out.push(
      el(
        "g",
        { class: "markers", fill: "none", "stroke-width": 2 },
        d.markers.map((m) => {
          const p = toPx(vp, m.at);
          return el("circle", {
            cx: p.x,
            cy: p.y,
            r: Math.max(4, m.radius * vp.k),
            stroke: severityColor(theme, m.severity),
            "data-severity": m.severity,
          });
        }),
      ),
    );
  }
  return out;
}

/** Cartouche : bloc de texte sous le dessin (px). */
export function renderCartouche(
  lines: readonly string[],
  x: number,
  y: number,
  width: number,
  theme: SvgTheme,
  fontSize: number,
): { svg: string; height: number } {
  const lh = fontSize * 1.4;
  const pad = fontSize * 0.6;
  const height = lines.length * lh + 2 * pad;
  const svg = el("g", { class: "cartouche" }, [
    el("rect", { x, y, width, height, fill: theme.panelFill, stroke: theme.panelStroke, rx: 3 }),
    ...lines.map((l, i) =>
      text(
        {
          x: x + pad,
          y: y + pad + (i + 0.5) * lh,
          "font-family": theme.fontFamily,
          "font-size": fontSize,
          "dominant-baseline": "central",
          fill: theme.text,
        },
        l,
      ),
    ),
  ]);
  return { svg, height };
}

/**
 * Plan 2D coté (chaîne SVG). Les cotes sont en mm (arrondies au mm par défaut) ; les
 * éléments portent des attributs `data-*` (numéro de marche, indice de nez, sévérité) pour
 * l'interaction dans l'interface.
 */
export function renderPlanSvg(model: Model, options: PlanSvgOptions = {}): string {
  const k = resolvePxPerMm(options);
  const theme = resolveTheme(options.theme);
  const fontSize = options.fontSize ?? 12;
  const margin = options.margin ?? 16;
  const show: Required<PlanSvgLayers> = {
    numbers: true,
    dimensions: true,
    compliance: true,
    cartouche: true,
    opening: true,
    ...options.show,
  };
  const tx = translatorOf(options);
  const drawing = buildPlanDrawing(model, { ...options, textHeight: fontSize / k });
  const { min, max } = drawing.bounds;
  const vp: Viewport = { k, minX: min.x, maxY: max.y, margin };
  const wDraw = (max.x - min.x) * k + 2 * margin;
  const hDraw = (max.y - min.y) * k + 2 * margin;

  const body: string[] = [];
  const parts = renderDrawing(drawing, vp, theme, fontSize, show);
  let height = hDraw;
  let width = wDraw;
  let cartouche = "";
  if (show.cartouche) {
    const longest = Math.max(...drawing.cartouche.map((l) => l.length));
    const cw = Math.max(wDraw - 2 * margin, longest * fontSize * 0.55 + fontSize * 1.2);
    const c = renderCartouche(drawing.cartouche, margin, hDraw, cw, theme, fontSize);
    cartouche = c.svg;
    height = hDraw + c.height + margin;
    width = Math.max(wDraw, cw + 2 * margin);
  }
  if (options.background !== false) {
    body.push(
      el("rect", { class: "background", x: 0, y: 0, width, height, fill: theme.background }),
    );
  }
  body.push(el("g", { class: "plan" }, parts), cartouche);
  const physical =
    options.scale !== undefined
      ? { w: width / k / options.scale, h: height / k / options.scale }
      : undefined;
  return svgDocument(width, height, body, {
    ...(physical ? { physicalMm: physical } : {}),
    title: options.title ?? tx.t("drawing.plan.title", { count: model.stepping.riserCount }),
    className: "blondel-plan",
  });
}
