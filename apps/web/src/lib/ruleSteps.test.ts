import { RULES, type ComplianceReport, type RuleResult, type Severity } from "@blondel/core";
import { msg } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { blockingCountByStep, checkedSteps, ruleSteps } from "./ruleSteps.js";
import type { GuidedStep } from "./sectionIds.js";

function result(
  ruleId: string,
  severity: Severity,
  status: RuleResult["status"] = "violation",
): RuleResult {
  return {
    ruleId,
    status,
    severity,
    declaredSeverity: severity,
    location: { kind: "stair" },
    nature: "",
    confidence: "",
    source: "",
    secondarySource: false,
    message: msg("ui.structure.none"),
  };
}

function report(results: readonly RuleResult[]): ComplianceReport {
  return {
    rulesVersion: 1,
    contexts: [],
    profile: "strict",
    results,
    summary: { bloquant: 0, avertissement: 0, conseil: 0 },
  };
}

describe("rattachement règle → étape", () => {
  it("toute règle de rules.yaml a au moins une étape", () => {
    const orphans = RULES.map((r) => r.id).filter((id) => ruleSteps(id).length === 0);
    expect(orphans).toEqual([]);
  });

  it("cas nommés", () => {
    expect(ruleSteps("ECHAPPEE_MIN_DTU")).toEqual([1, 3]);
    expect(ruleSteps("G_COLLET_MIN")).toEqual([2]);
    // Régularité des balancées : étape Forme ; tolérance des marches droites : Découpage.
    expect(ruleSteps("G_TOL_BALANCEE")).toEqual([2]);
    expect(ruleSteps("G_TOL_DROITE")).toEqual([3]);
    expect(ruleSteps("G_MIN_DTU")).toEqual([3]);
    expect(ruleSteps("G_EXT_MAX_ERP_TOURNANT")).toEqual([2]);
    expect(ruleSteps("VIDE_ENTRE_MARCHES")).toEqual([4]);
    expect(ruleSteps("FAB_SUPPORT_DEBORD")).toEqual([7]);
    expect(ruleSteps("EXC_CLASSE_EXECUTION")).toEqual([7]);
    expect(ruleSteps("GC_HAUTEUR_2024")).toEqual([6]);
    expect(ruleSteps("PRECHECK_FLECHE")).toEqual([5]);
    expect(ruleSteps("CHARGE_GC_HORIZONTALE")).toEqual([6]);
    expect(ruleSteps("CHARGE_ESCALIER_A")).toEqual([5]);
    expect(ruleSteps("ECHELLE_MEUNIER_MC")).toEqual([6]);
    expect(ruleSteps("ECHELLE_MEUNIER_HORS_DTU")).toEqual([3]);
    expect(ruleSteps("LARGEUR_MC_ERP_NEUF")).toEqual([2]);
    // Limon central bois (A29, vague 2) : lamellé-collé cintré à l'étape Structure.
    expect(ruleSteps("LAMELLE_CINTRE_KR")).toEqual([5]);
    expect(ruleSteps("LAMELLE_PLIS_MINCES")).toEqual([5]);
  });

  it("replis : famille du cœur, puis section du panneau, sinon aucune étape", () => {
    // Contrôle de plugin hors table et sans préfixe connu : famille fabrication → 7.
    expect(ruleSteps("PLUGIN_INCONNU_X")).toEqual([7]);
  });
});

describe("bloquants par étape et étapes cochées", () => {
  const r = report([
    result("ECHAPPEE_MIN_DTU", "bloquant"),
    result("GC_HAUTEUR_2024", "bloquant"),
    result("H_MAX_DTU", "avertissement"),
    result("FAB_SUPPORT_DEBORD", "bloquant", "ok"),
    result("LIMON_EPAISSEUR_MIN_DTU", "bloquant", "non-evaluee"),
  ]);

  it("compte les violations bloquantes (sévérité effective) de chaque étape", () => {
    expect(blockingCountByStep(r)).toEqual({ 1: 1, 2: 0, 3: 1, 4: 0, 5: 0, 6: 1, 7: 0 });
    expect(blockingCountByStep(undefined)).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 });
  });

  it("cochée = vue et aucune règle bloquante rattachée", () => {
    const visited = new Set<GuidedStep>([1, 2, 3, 5, 6]);
    expect([...checkedSteps(visited, r)].sort()).toEqual([2, 5]);
    expect([...checkedSteps(visited, undefined)].sort()).toEqual([1, 2, 3, 5, 6]);
    expect(checkedSteps(new Set(), undefined).size).toBe(0);
  });
});
