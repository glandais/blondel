import {
  buildModel,
  createProject,
  findRule,
  type ComplianceReport,
  type Model,
  type RuleResult,
} from "@blondel/core";
import { describe, expect, it } from "vitest";
import { BLONDEL_GAUGE_RULE, blondelGauge } from "./blondelGauge.js";

const rule = findRule(BLONDEL_GAUGE_RULE)!;
const MIN = rule.min!;
const MAX = rule.max!;
const W = MAX - MIN;

/** Modèle minimal : module 2h + g et résultats de la règle. */
function fake(
  blondel: number,
  statuses: RuleResult["status"][],
): Pick<Model, "stepping" | "compliance"> {
  const results = statuses.map((status) => ({ ruleId: BLONDEL_GAUGE_RULE, status }) as RuleResult);
  return {
    stepping: { blondel } as Model["stepping"],
    compliance: { results } as unknown as ComplianceReport,
  };
}

describe("blondelGauge", () => {
  it("zone de confort = bornes de la table, échelle prolongée de sa largeur", () => {
    const g = blondelGauge(fake(MIN + W / 2, ["ok"]))!;
    expect(g.zone).toEqual({ min: MIN, max: MAX });
    expect(g.scale).toEqual({ min: MIN - W, max: MAX + W });
    expect(g.position.zoneStart).toBeCloseTo(1 / 3);
    expect(g.position.zoneEnd).toBeCloseTo(2 / 3);
    expect(g.position.value).toBeCloseTo(0.5);
  });

  it("repère borné à l'échelle", () => {
    expect(blondelGauge(fake(MIN - 10 * W, ["violation"]))!.position.value).toBe(0);
    expect(blondelGauge(fake(MAX + 10 * W, ["violation"]))!.position.value).toBe(1);
  });

  it("statut lu dans le rapport, sans comparaison aux bornes", () => {
    // Valeur dans la zone mais rapport en violation : le rapport fait foi.
    expect(blondelGauge(fake(MIN + 1, ["violation"]))!.status).toBe("outside");
    expect(blondelGauge(fake(MIN - 100, ["ok"]))!.status).toBe("comfortable");
    expect(blondelGauge(fake(MIN + 1, ["non-evaluee"]))!.status).toBe("unknown");
    expect(blondelGauge(fake(MIN + 1, []))!.status).toBe("unknown");
  });

  it("modèle absent ou sans découpage : null", () => {
    expect(blondelGauge(null)).toBeNull();
    expect(blondelGauge(undefined)).toBeNull();
    expect(blondelGauge(fake(Number.NaN, ["ok"]))).toBeNull();
  });

  it("modèle calculé : valeur du modèle, statut du rapport", () => {
    const model = buildModel(createProject("quarter-left"));
    const g = blondelGauge(model)!;
    expect(g.value).toBe(model.stepping.blondel);
    const r = model.compliance.results.find((x) => x.ruleId === BLONDEL_GAUGE_RULE);
    expect(g.status).toBe(
      r === undefined
        ? "unknown"
        : r.status === "ok"
          ? "comfortable"
          : r.status === "violation"
            ? "outside"
            : "unknown",
    );
  });
});
