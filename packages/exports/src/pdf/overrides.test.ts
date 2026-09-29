import { describe, expect, it } from "vitest";
import { report, ruleResult, sampleProject, straightModel } from "../testing/fixtures.js";
import { RecordingCanvas } from "./canvas.js";
import { overrideText } from "./compliance.js";
import { renderPdf } from "./document.js";

/** Textes imprimés sur les pages du contrôle de conception. */
function complianceText(
  overrides: readonly { ruleId: string; severity: string; justification: string }[],
) {
  const base = sampleProject();
  const project = {
    ...base,
    compliance: { ...base.compliance, overrides: overrides as typeof base.compliance.overrides },
  };
  const model = {
    ...straightModel(),
    compliance: report([ruleResult("GIRON_MIN", { kind: "stair" }, "bloquant")]),
  };
  const cv = new RecordingCanvas();
  renderPdf(cv, model, {
    project,
    pages: {
      toc: false,
      plan: false,
      elevation: false,
      installation: false,
      bom: false,
      cutsheet: false,
      compliance: true,
      flats: false,
      templates: false,
    },
  });
  return cv.ops
    .filter((op): op is Extract<typeof op, { type: "text" }> => op.type === "text")
    .map((op) => op.value)
    .join(" ");
}

describe("dossier PDF : surcharges de règles (A18 b)", () => {
  it("chaque surcharge est reprise avec sa sévérité et sa justification", () => {
    const t = complianceText([
      { ruleId: "GIRON_MIN", severity: "avertissement", justification: "Escalier de service" },
      { ruleId: "INCONNUE", severity: "ignore", justification: "Avis du bureau de contrôle" },
    ]);
    expect(t).toContain("Surcharges de règles par l'utilisateur (2)");
    expect(t).toContain("Escalier de service");
    expect(t).toContain("Avis du bureau de contrôle");
  });

  it("aucune section sans surcharge", () => {
    expect(complianceText([])).not.toContain("Surcharges de règles");
  });

  it("texte d'une surcharge : sévérité déclarée → choisie, ou règle non évaluée", () => {
    const results = [ruleResult("GIRON_MIN", { kind: "stair" }, "bloquant")];
    expect(
      overrideText({ ruleId: "GIRON_MIN", severity: "ignore", justification: "J" }, results),
    ).toMatch(/^GIRON_MIN : sévérité déclarée \S+ → ignorée\. Justification : J$/);
    expect(overrideText({ ruleId: "X", severity: "conseil", justification: "J" }, results)).toBe(
      "X : conseil (règle non évaluée dans les contextes actifs). Justification : J",
    );
  });
});
