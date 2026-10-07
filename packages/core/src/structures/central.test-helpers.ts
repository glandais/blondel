/**
 * Aides de test du limon central (trace et poutre), sans plugin enregistré : contexte de
 * structure calculé par `computeLayout` / `computeStepping`, portées de supports factices
 * (une par marche, au milieu de sa portée sur la trace).
 */
import { computeLayout } from "../layout/layout.js";
import type { StructureContext } from "../model/plugins.js";
import type { Project } from "../model/project.js";
import { computeStepping } from "../stepping/stepping.js";
import { buildBasicParts } from "../parts/basic.js";
import { CheckCollector } from "./checks.js";
import { buildCentralBeam, type CentralBeamResult, type SigmaSpan } from "./centralBeam.js";
import { buildCentralTrace, type CentralTrace } from "./centralTrace.js";
import { SteelCentralParamsSchema, type SteelCentralParams } from "./steelCentralParams.js";

export function centralContext(project: Project): StructureContext {
  const layout = computeLayout(project);
  const stepping = computeStepping(project, layout);
  return { project, layout, stepping, baseParts: buildBasicParts(project, layout, stepping).parts };
}

export function centralParams(over: Record<string, unknown> = {}): SteelCentralParams {
  return SteelCentralParamsSchema.parse(over);
}

/** Trace (lève si non calculée : réservé aux cas valides). */
export function traceOf(ctx: StructureContext, params: SteelCentralParams): CentralTrace {
  const r = buildCentralTrace(ctx, params);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.trace;
}

/**
 * Portées factices des supports : une par marche, de largeur `bearing` centrée au milieu de la
 * marche sur la trace (supports du plugin simulés).
 */
export function fakeSpans(trace: CentralTrace, bearing = 60): SigmaSpan[] {
  const out: SigmaSpan[] = [];
  const s = trace.nosingSigma;
  for (let k = 0; k + 1 < s.length; k++) {
    const mid = (s[k]! + s[k + 1]!) / 2;
    out.push({ sigma0: mid - bearing / 2, sigma1: mid + bearing / 2, treadNumber: k + 1 });
  }
  return out;
}

/** Distance ligne des nez → dessus de poutre par défaut des tests (mm). */
export const TEST_TOP_OFFSET = 260;

export function beamOf(
  project: Project,
  over: Record<string, unknown> = {},
  opts: { topOffset?: number; spans?: (t: CentralTrace) => SigmaSpan[] } = {},
): {
  ctx: StructureContext;
  params: SteelCentralParams;
  trace: CentralTrace;
  beam: CentralBeamResult;
  checks: CheckCollector;
} {
  const ctx = centralContext(project);
  const params = centralParams(over);
  const trace = traceOf(ctx, params);
  const checks = new CheckCollector(project, ctx.stepping);
  const beam = buildCentralBeam({
    ctx,
    params,
    trace,
    topOffset: opts.topOffset ?? TEST_TOP_OFFSET,
    supportSpans: (opts.spans ?? fakeSpans)(trace),
    checks,
  });
  return { ctx, params, trace, beam, checks };
}
