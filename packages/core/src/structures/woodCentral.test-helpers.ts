/**
 * Aides de test du limon central bois (trace et poutre), sans plugin enregistré : contexte de
 * structure calculé par `computeLayout` / `computeStepping` (pièces de base comprises),
 * paramètres complets, trace et poutre. Partagées par les tests de la poutre
 * (`woodCentralBeam.test.ts`) et du plugin (`woodCentral.test.ts`) ; à étendre sans en changer
 * les signatures.
 */
import { computeLayout } from "../layout/layout.js";
import type { StructureContext } from "../model/plugins.js";
import type { Project } from "../model/project.js";
import { buildBasicParts } from "../parts/basic.js";
import { computeStepping } from "../stepping/stepping.js";
import { buildCentralTrace, type CentralTrace } from "./centralTrace.js";
import { CheckCollector } from "./checks.js";
import { buildWoodCentralBeam, type WoodCentralBeamResult } from "./woodCentralBeam.js";
import { WoodCentralParamsSchema, type WoodCentralParams } from "./woodCentralParams.js";

export function woodCentralContext(project: Project): StructureContext {
  const layout = computeLayout(project);
  const stepping = computeStepping(project, layout);
  return { project, layout, stepping, baseParts: buildBasicParts(project, layout, stepping).parts };
}

export function woodCentralParams(over: Record<string, unknown> = {}): WoodCentralParams {
  return WoodCentralParamsSchema.parse(over);
}

/** Trace (lève si non calculée : réservé aux cas valides). */
export function woodTraceOf(ctx: StructureContext, params: WoodCentralParams): CentralTrace {
  const r = buildCentralTrace(ctx, params);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.trace;
}

/** Poutre seule (trace calculée, collecteur de contrôles neuf). */
export function woodBeamOf(
  ctx: StructureContext,
  params: WoodCentralParams,
): { readonly beam: WoodCentralBeamResult; readonly checks: CheckCollector } {
  const checks = new CheckCollector(ctx.project, ctx.stepping);
  const trace = woodTraceOf(ctx, params);
  return { beam: buildWoodCentralBeam({ ctx, params, trace, checks }), checks };
}
