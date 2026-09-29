/**
 * Contrôles propres aux garde-corps, hors rules.yaml, ajoutés au rapport par le pipeline
 * (comme les contrôles de fabrication des structures, `mergeStructureChecks`).
 *
 * - `GC_CABLES_DETENTE` (avertissement) : remplissage à câbles. NF P01-012:2024 : les vides ne
 *   doivent pas augmenter dans le temps (« attention aux câbles qui se détendent ») [A §3.2,
 *   C §3.1] ; SPEC X12 : câbles traités comme des lisses **avec un avertissement de détente**.
 *   Actif avec un régime garde-corps (1988 ou 2024), comme les règles GC_*.
 * - `GC_CONFLIT_DALLE` (avertissement, toujours actif) : collision géométrique d'un garde-corps
 *   rampant avec le plancher haut. Hors de la trémie (sous la dalle), la main courante d'un
 *   rampant dont le dessus dépasse la sous-face de la dalle traverse celle-ci : cas d'un bord
 *   d'escalier au nu de la trémie avec un garde-corps décalé vers le vide. Constat géométrique
 *   sur le projet (aucun seuil métier) ; localisé sur la main courante.
 */
import * as V from "../geom2d/vec.js";
import { pointInPolygon } from "../geom2d/polygon.js";
import { ceilingOf, openingPolygon } from "../headroom/headroom.js";
import type { RuleResult } from "../model/derived.js";
import type { Project } from "../model/project.js";
import type { Stepping } from "../model/derived.js";
import { STAIR, fmt } from "../rules/check.js";
import { resolveContexts } from "../rules/contexts.js";
import { effectiveSeverity } from "../rules/engine.js";
import type { RuleDef } from "../rules/table.js";
import { sectionWidth } from "./parts.js";
import { cumulative, interp, pointAt, tangentAt } from "./polyline.js";
import type { GuardRun, GuardsAnalysis } from "./types.js";

export const CABLE_SLACK_RULE: RuleDef = {
  id: "GC_CABLES_DETENTE",
  description:
    "Câbles de garde-corps : les vides ne doivent pas augmenter dans le temps (détente des câbles) ; prévoir une retension",
  formule: "",
  min: null,
  max: null,
  recommande: null,
  unite: null,
  contexte: ["garde_corps_1988", "garde_corps_2024"],
  nature: "normatif",
  source: "NF P01-012:2024 via APAVE [12] (durabilité des vides) ; SPEC X12",
  source_secondaire: true,
  confiance: "eleve",
  severite: "avertissement",
};

export const SLAB_CLASH_RULE: RuleDef = {
  id: "GC_CONFLIT_DALLE",
  description:
    "Garde-corps rampant en conflit avec le plancher haut : hors de la trémie, la main courante dépasse la sous-face de la dalle",
  formule: "",
  min: null,
  max: null,
  recommande: null,
  unite: "mm",
  contexte: ["tous"],
  nature: "metier",
  source: "Géométrie du projet (Blondel) : trémie, épaisseur de plancher, lignes de garde-corps",
  source_secondaire: false,
  confiance: "eleve",
  severite: "avertissement",
};

/** Pas d'échantillonnage (mm) du contrôle de collision avec la dalle (précision géométrique). */
const CLASH_STEP = 10;

/**
 * Longueur (en plan) du garde-corps rampant `run` qui traverse la dalle haute : points de l'axe
 * (± demi-largeur de la main courante) strictement hors de la trémie, dont le niveau de
 * référence est sous le sol haut et le dessus du garde-corps au-dessus de la sous-face.
 */
export function slabClash(
  project: Project,
  analysis: GuardsAnalysis,
  run: GuardRun,
): { length: number; at: { x: number; y: number; z: number } } | null {
  const poly = openingPolygon(project.site.opening);
  if (!poly || run.kind !== "rake" || run.path.length < 2) return null;
  const ceiling = ceilingOf(project.site);
  const floor = project.site.floorToFloor;
  const half = sectionWidth(analysis.spec.handrail.section) / 2;
  const w = cumulative(run.path);
  const total = w[w.length - 1]!;
  const steps = Math.max(1, Math.ceil(total / CLASH_STEP));
  let length = 0;
  let at: { x: number; y: number; z: number } | null = null;
  for (let i = 0; i <= steps; i++) {
    const s = (total * i) / steps;
    const ref = interp(w, run.ref, s);
    if (ref >= floor - 1e-6 || ref + run.height <= ceiling + 1e-6) continue;
    const p = pointAt(run.path, w, s);
    const n = V.perpLeft(tangentAt(run.path, w, s));
    const under = [p, V.addScaled(p, n, half), V.addScaled(p, n, -half)].some(
      (q) => pointInPolygon(q, poly) === "outside",
    );
    if (!under) continue;
    length += i === 0 || i === steps ? total / steps / 2 : total / steps;
    at ??= { x: p.x, y: p.y, z: ceiling };
  }
  return at ? { length, at } : null;
}

/** Contrôles hors table des garde-corps (vide si rien à signaler). */
export function guardChecks(
  project: Project,
  stepping: Stepping,
  analysis: GuardsAnalysis,
): RuleResult[] {
  return [...slabClashChecks(project, analysis), ...cableChecks(project, stepping, analysis)];
}

function slabClashChecks(project: Project, analysis: GuardsAnalysis): RuleResult[] {
  const rule = SLAB_CLASH_RULE;
  const eff = effectiveSeverity(rule, project.compliance);
  const out: RuleResult[] = [];
  for (const run of analysis.runs) {
    const clash = slabClash(project, analysis, run);
    if (!clash) continue;
    out.push({
      ruleId: rule.id,
      description: rule.description,
      status: eff.ignored ? "non-evaluee" : "violation",
      severity: eff.severity,
      declaredSeverity: rule.severite,
      measured: clash.length,
      max: 0,
      unit: "mm",
      location: { kind: "part", partId: run.handrailPartId ?? run.primaryPartId },
      nature: rule.nature,
      confidence: rule.confiance,
      source: rule.source,
      secondarySource: rule.source_secondaire,
      ...(eff.downgradeReason !== undefined ? { downgradeReason: eff.downgradeReason } : {}),
      message: `${run.label[0]!.toUpperCase()}${run.label.slice(1)} : traverse le plancher haut sur ${fmt(clash.length, 0)} mm en plan (hors trémie, dessus du garde-corps au-dessus de la sous-face de la dalle) ; élargir la trémie, réduire le décalage du garde-corps ou déclarer ce côté « mur ».`,
    });
  }
  return out;
}

function cableChecks(project: Project, stepping: Stepping, analysis: GuardsAnalysis): RuleResult[] {
  const cableRuns = analysis.runs.filter((r) => r.infill === "cables");
  if (cableRuns.length === 0) return [];
  const active = new Set(resolveContexts(project.compliance, stepping).active);
  if (!CABLE_SLACK_RULE.contexte.some((c) => active.has(c))) return [];
  const rule = CABLE_SLACK_RULE;
  const eff = effectiveSeverity(rule, project.compliance);
  return cableRuns.map((run) => ({
    ruleId: rule.id,
    description: rule.description,
    status: eff.ignored ? "non-evaluee" : "violation",
    severity: eff.severity,
    declaredSeverity: rule.severite,
    location: run.infillPartIds[0] ? { kind: "part", partId: run.infillPartIds[0] } : STAIR,
    nature: rule.nature,
    confidence: rule.confiance,
    source: rule.source,
    secondarySource: rule.source_secondaire,
    ...(eff.downgradeReason !== undefined ? { downgradeReason: eff.downgradeReason } : {}),
    message: `Câbles du ${run.label} : traités comme des lisses (SPEC X12) ; la détente des câbles augmente les vides dans le temps, prévoir un dispositif de retension et un contrôle périodique.`,
  }));
}
