/**
 * Plan coté en DXF (mm, 1:1), un calque par fonction : CONTOUR, MARCHES, NEZ, FOULEE,
 * TREMIE, COTES, TEXTE. Même dessin que le plan SVG (`buildPlanDrawing`).
 */
import type { Model } from "@blondel/core";
import { translatorOf, type Translator } from "../i18n.js";
import { buildPlanDrawing, dimensionGeometry, type PlanDrawingOptions } from "../plan/drawing.js";
import { DEFAULT_PLAN_DXF_VERSION, createDxfWriter } from "./create.js";
import { localizedLayers, type LayerSpec } from "./layers.js";
import { declareLayers, type DxfVersion } from "./writer.js";

/** Calques du plan : clé du nom (`dxf.layer.*`), couleur, type de ligne. */
const PLAN_LAYER_SPECS = {
  contour: { key: "dxf.layer.contour", color: 7 },
  treads: { key: "dxf.layer.treads", color: 8 },
  nosings: { key: "dxf.layer.nosings", color: 4 },
  walkline: { key: "dxf.layer.walkline", color: 1, lineType: "CENTER" },
  opening: { key: "dxf.layer.opening", color: 6, lineType: "DASHED" },
  dimensions: { key: "dxf.layer.dimensions", color: 3 },
  text: { key: "dxf.layer.text", color: 7 },
} as const satisfies Record<string, LayerSpec>;

export type PlanLayerId = keyof typeof PLAN_LAYER_SPECS;

/** Calques du plan dans la langue du traducteur (noms passés par `sanitizeLayerName`). */
export function planLayers(t: Translator = translatorOf()) {
  return localizedLayers(PLAN_LAYER_SPECS, t);
}

/** Calques du plan en français (noms historiques : CONTOUR, MARCHES, NEZ…). */
export const PLAN_LAYERS = planLayers();

export interface PlanDxfOptions extends PlanDrawingOptions {
  /** Défaut : AC1021 (`DEFAULT_PLAN_DXF_VERSION`). */
  readonly version?: DxfVersion;
}

export function exportPlanDxf(model: Model, options: PlanDxfOptions = {}): string {
  const d = buildPlanDrawing(model, options);
  const th = d.textHeight;
  const w = createDxfWriter(options.version ?? DEFAULT_PLAN_DXF_VERSION, {
    dashPattern: [th * 1.2, th * 0.6],
  });
  const L = planLayers(translatorOf(options));
  declareLayers(w, Object.values(L));

  w.polyline(d.contour.vertices, true, L.contour.name);
  for (const t of d.treads) w.polyline(t.surface.vertices, true, L.treads.name);
  if (d.landing) w.polyline(d.landing.vertices, true, L.treads.name);
  for (const n of d.nosings) w.line(n.a, n.b, L.nosings.name);
  w.polyline(d.walkline.vertices, false, L.walkline.name);
  w.circle(d.walklineStart.center, d.walklineStart.radius, L.walkline.name);
  w.polyline(d.arrow.vertices, true, L.walkline.name);
  if (d.opening) w.polyline(d.opening.vertices, true, L.opening.name);

  for (const dim of d.dimensions) {
    const g = dimensionGeometry(dim, th);
    for (const [a, b] of [g.line, ...g.extensions, ...g.ticks]) w.line(a, b, L.dimensions.name);
    w.text(g.textAt, th * 0.8, dim.text, L.dimensions.name, {
      rotationDeg: (g.textAngle * 180) / Math.PI,
      align: "center",
      middle: true,
    });
  }

  for (const t of d.treads) {
    w.text(t.label, th, String(t.number), L.text.name, { align: "center", middle: true });
  }

  // Cartouche sous le dessin.
  const x0 = d.bounds.min.x;
  let y = d.bounds.min.y - 2 * th;
  for (const line of d.cartouche) {
    w.text({ x: x0, y }, th * 0.8, line, L.text.name);
    y -= th * 1.4;
  }
  return w.toString();
}
