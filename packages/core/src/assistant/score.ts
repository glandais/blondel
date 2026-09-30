/**
 * Résumé du modèle d'un candidat et score détaillé (CHALLENGE G8) : somme pondérée et affichée
 * de pénalités — écart |2h + g − module recommandé|, collet minimal en corde sous le collet
 * recommandé, échappée sous l'échappée recommandée, marge d'échappée (au-dessus du minimum
 * bloquant) sous une marge visée, nombre de marches balancées, régularité
 * des girons sur la ligne de foulée, avertissements du contrôle de conception. Les cibles sont
 * les valeurs `recommande` des règles actives (`bounds.ts`) ; les poids sont des choix à valider.
 */
import { msg, type Message } from "@blondel/i18n";
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
  fit: Message,
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

const fmtMm = (v: number): string => String(Math.round(v * 10) / 10);

function term(
  id: keyof ScoreWeights,
  label: Message,
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
  headroomMarginTarget: Mm,
): ScoreBreakdown {
  const target = bounds.blondelTarget;
  const terms: ScoreTerm[] = [
    term(
      "blondel",
      msg("assistant.score.blondel", { target: String(target) }),
      Math.abs(summary.blondel - target),
      "mm",
      weights,
    ),
    term(
      "collet",
      msg("assistant.score.collet", { value: String(bounds.colletRecommended ?? "—") }),
      summary.minCollet !== null && bounds.colletRecommended !== null
        ? bounds.colletRecommended - summary.minCollet
        : 0,
      "mm",
      weights,
    ),
    term(
      "headroom",
      msg("assistant.score.headroom", { value: String(bounds.headroomRecommended ?? "—") }),
      summary.headroom !== null && bounds.headroomRecommended !== null
        ? bounds.headroomRecommended - summary.headroom
        : 0,
      "mm",
      weights,
    ),
    // Marge nulle admise par la règle (`e >= 1900`) mais pénalisée : pas de rejet (LEDGER §2).
    term(
      "headroomMargin",
      msg("assistant.score.headroomMargin", { value: fmtMm(headroomMarginTarget) }),
      summary.headroomMargin !== null ? headroomMarginTarget - summary.headroomMargin : 0,
      "mm",
      weights,
    ),
    term("winders", msg("assistant.score.winders"), summary.winderCount, "nb", weights),
    term("regularity", msg("assistant.score.regularity"), goingIrregularity(model), "mm", weights),
    term(
      "warnings",
      msg("assistant.score.warnings"),
      summary.violations.avertissement,
      "nb",
      weights,
    ),
  ];
  return { total: terms.reduce((acc, t) => acc + t.penalty, 0), terms };
}
