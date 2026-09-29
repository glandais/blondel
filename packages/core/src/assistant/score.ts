/**
 * Résumé du modèle d'un candidat et score détaillé (CHALLENGE G8) : somme pondérée et affichée
 * de pénalités — écart |2h + g − module recommandé|, collet minimal en corde sous le collet
 * recommandé, échappée sous l'échappée recommandée, nombre de marches balancées, régularité
 * des girons sur la ligne de foulée, avertissements du contrôle de conception. Les cibles sont
 * les valeurs `recommande` des règles actives (`bounds.ts`) ; les poids sont des choix à valider.
 */
import type { Model } from "../model/derived.js";
import type { Mm } from "../model/primitives.js";
import type { Project } from "../model/project.js";
import type { EnumerationBounds } from "./bounds.js";
import type { ModelSummary, ScoreBreakdown, ScoreTerm, ScoreWeights } from "./types.js";

export function summarizeModel(
  project: Project,
  model: Model,
  bounds: EnumerationBounds,
  grossWidth: Mm,
  fit: string,
): ModelSummary {
  const st = model.stepping;
  const winders = st.treads.filter((t) => t.kind === "winder");
  const minCollet = winders.length > 0 ? Math.min(...winders.map((t) => t.colletChord)) : null;
  const headroom = model.headroom?.min ?? null;
  const warnings = model.compliance.results.filter(
    (r) => r.status === "violation" && r.severity === "avertissement",
  );
  return {
    riserCount: st.riserCount,
    rise: st.rise,
    going: st.going,
    blondel: st.blondel,
    width: project.stair.layout.width,
    grossWidth,
    run: st.run,
    minCollet,
    headroom,
    headroomMargin:
      headroom !== null && bounds.headroomMin ? headroom - bounds.headroomMin.value : null,
    winderCount: winders.length,
    landingCount: st.treads.filter((t) => t.kind === "landing").length,
    violations: {
      avertissement: model.compliance.summary.avertissement,
      conseil: model.compliance.summary.conseil,
    },
    warningRules: [...new Set(warnings.map((r) => r.ruleId))],
    placement: {
      origin: project.stair.placement.origin,
      rotation: project.stair.placement.rotation,
    },
    fit,
  };
}

/** Écart maximal des girons (hors paliers) au giron nominal, sur la ligne de foulée. */
export function goingIrregularity(model: Model): Mm {
  const g = model.stepping.going;
  let worst = 0;
  for (const t of model.stepping.treads) {
    if (t.kind === "landing") continue;
    worst = Math.max(worst, Math.abs(t.going - g));
  }
  return worst;
}

function term(
  id: keyof ScoreWeights,
  label: string,
  value: number,
  unit: "mm" | "nb",
  weights: ScoreWeights,
): ScoreTerm {
  const v = Math.max(0, value);
  return { id, label, value: v, unit, weight: weights[id], penalty: v * weights[id] };
}

export function scoreModel(
  model: Model,
  summary: ModelSummary,
  bounds: EnumerationBounds,
  weights: ScoreWeights,
): ScoreBreakdown {
  const target = bounds.blondelTarget;
  const terms: ScoreTerm[] = [
    term(
      "blondel",
      `Écart du module 2h + g à ${target} mm`,
      Math.abs(summary.blondel - target),
      "mm",
      weights,
    ),
    term(
      "collet",
      `Collet minimal (corde) sous ${bounds.colletRecommended ?? "—"} mm`,
      summary.minCollet !== null && bounds.colletRecommended !== null
        ? bounds.colletRecommended - summary.minCollet
        : 0,
      "mm",
      weights,
    ),
    term(
      "headroom",
      `Échappée sous ${bounds.headroomRecommended ?? "—"} mm`,
      summary.headroom !== null && bounds.headroomRecommended !== null
        ? bounds.headroomRecommended - summary.headroom
        : 0,
      "mm",
      weights,
    ),
    term("winders", "Marches balancées", summary.winderCount, "nb", weights),
    term(
      "regularity",
      "Écart maximal des girons au giron nominal",
      goingIrregularity(model),
      "mm",
      weights,
    ),
    term("warnings", "Avertissements du contrôle", summary.violations.avertissement, "nb", weights),
  ];
  return { total: terms.reduce((acc, t) => acc + t.penalty, 0), terms };
}
