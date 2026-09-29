/**
 * Mains courantes des deux côtés (MC_DEUX_COTES) : applicabilité et exception, partagées par
 * l'étape « garde-corps » (valeur `auto` de `handrail.wallSides`) et l'évaluateur de la règle.
 *
 * QUESTIONS A2 (appliqué par défaut le 2026-09-30, à confirmer) : quand MC_DEUX_COTES
 * s'applique (ERP neuf, parties communes de BHC) et que son exception ne joue pas, `auto` pose
 * une main courante des deux côtés. L'utilisateur garde la main : toute autre valeur de
 * `wallSides` (`none`, `inner`, `outer`, `both`) est respectée telle quelle, et une surcharge
 * « ignore » de la règle rend à `auto` son comportement antérieur.
 */
import type { Stepping } from "../model/derived.js";
import type { Project } from "../model/project.js";
import { isRuleApplicable, resolveContexts } from "../rules/contexts.js";
import { MC_CORE_DIAMETER_MAX } from "../rules/formula-constants.js";
import { findRule } from "../rules/table.js";

/** Identifiant de la règle « une main courante de chaque côté ». */
export const HANDRAIL_BOTH_SIDES_RULE = "MC_DEUX_COTES";

/**
 * Diamètre du fût central (mm) si l'exception de MC_DEUX_COTES s'applique : ERP neuf (et non
 * BHC, « quelle que soit sa conception »), hélicoïdal à fût (`core.kind === "column"`) de
 * diamètre ≤ `MC_CORE_DIAMETER_MAX` ; `null` sinon (jour central : pas d'exception).
 */
export function smallCoreDiameter(contexts: ReadonlySet<string>, project: Project): number | null {
  if (
    !contexts.has("erp_neuf") ||
    contexts.has("bhc_parties_communes") ||
    !contexts.has("helicoidal")
  )
    return null;
  const layout = project.stair.layout;
  if (layout.kind !== "helical" || layout.core.kind !== "column") return null;
  const d = 2 * layout.core.radius;
  return d <= MC_CORE_DIAMETER_MAX.value ? d : null;
}

/**
 * Vrai si la valeur `auto` doit poser une main courante des deux côtés : MC_DEUX_COTES
 * applicable aux contextes actifs, non surchargée en « ignore », hors exception du fût.
 */
export function autoHandrailBothSides(project: Project, stepping: Stepping): boolean {
  const rule = findRule(HANDRAIL_BOTH_SIDES_RULE);
  if (!rule) return false;
  const ignored = project.compliance.overrides.some(
    (o) => o.ruleId === HANDRAIL_BOTH_SIDES_RULE && o.severity === "ignore",
  );
  if (ignored) return false;
  const active = new Set(resolveContexts(project.compliance, stepping).active);
  if (!isRuleApplicable(rule, active)) return false;
  return smallCoreDiameter(active, project) === null;
}
