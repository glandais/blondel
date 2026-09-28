/**
 * Plan coté en DXF (mm, 1:1), un calque par fonction : CONTOUR, MARCHES, NEZ, FOULEE,
 * TREMIE, COTES, TEXTE. Même dessin que le plan SVG (`buildPlanDrawing`).
 */
import type { Model } from "@blondel/core";
import { buildPlanDrawing, dimensionGeometry, type PlanDrawingOptions } from "../plan/drawing.js";
import { DEFAULT_PLAN_DXF_VERSION, createDxfWriter } from "./create.js";
import { declareLayers, type DxfLayerDef, type DxfVersion } from "./writer.js";

export const PLAN_LAYERS = {
  contour: { name: "CONTOUR", color: 7 },
  treads: { name: "MARCHES", color: 8 },
  nosings: { name: "NEZ", color: 4 },
  walkline: { name: "FOULEE", color: 1, lineType: "CENTER" },
  opening: { name: "TREMIE", color: 6, lineType: "DASHED" },
  dimensions: { name: "COTES", color: 3 },
  text: { name: "TEXTE", color: 7 },
} as const satisfies Record<string, DxfLayerDef>;

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
  const L = PLAN_LAYERS;
  declareLayers(w, Object.values(L));

  w.polyline(d.contour.vertices, true, L.contour.name);
  for (const t of d.treads) w.polyline(t.surface.vertices, true, L.treads.name);
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
