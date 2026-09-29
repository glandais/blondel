import { describe, expect, it } from "vitest";
import { buildModel } from "../pipeline/build.js";
import { ProjectSchema } from "../model/project.js";
import { parseProject } from "./parse.js";
import { serializeProject } from "./serialize.js";
import { createProject } from "./presets.js";
import { ruleOverrideOf, withoutRuleOverride, withRuleOverride } from "./overrides.js";

describe("surcharges de règles (A18 b)", () => {
  const base = createProject("quarter-left");

  it("ajout, remplacement à la même place, retrait", () => {
    let p = withRuleOverride(base, { ruleId: "A", severity: "conseil", justification: " j1 " });
    p = withRuleOverride(p, { ruleId: "B", severity: "ignore", justification: "j2" });
    p = withRuleOverride(p, { ruleId: "A", severity: "avertissement", justification: "j3" });
    expect(p.compliance.overrides).toEqual([
      { ruleId: "A", severity: "avertissement", justification: "j3" },
      { ruleId: "B", severity: "ignore", justification: "j2" },
    ]);
    expect(ruleOverrideOf(p, "B")?.severity).toBe("ignore");
    const q = withoutRuleOverride(p, "A");
    expect(q.compliance.overrides.map((o) => o.ruleId)).toEqual(["B"]);
    expect(withoutRuleOverride(q, "Z")).toBe(q);
    // Le projet reste valide et se relit à l'identique.
    expect(ProjectSchema.parse(p)).toEqual(p);
    expect(parseProject(JSON.parse(serializeProject(p)))).toEqual(p);
  });

  it("justification obligatoire (vide ou blanche refusée)", () => {
    expect(() =>
      withRuleOverride(base, { ruleId: "A", severity: "conseil", justification: "   " }),
    ).toThrow(/justification est obligatoire/);
  });

  it("surcharge prise en compte par le contrôle de conception", () => {
    const m0 = buildModel(base);
    const r0 = m0.compliance.results.find((r) => r.status === "ok")!;
    const p = withRuleOverride(base, {
      ruleId: r0.ruleId,
      severity: "conseil",
      justification: "Validé par le bureau d'études",
    });
    const r = buildModel(p).compliance.results.find((x) => x.ruleId === r0.ruleId)!;
    expect(r.severity).toBe("conseil");
    if (r0.declaredSeverity !== "conseil")
      expect(r.downgradeReason).toContain("Validé par le bureau d'études");
  });
});
