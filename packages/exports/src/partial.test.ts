import type { Model } from "@blondel/core";
import { describe, expect, it } from "vitest";
import { exportPlanDxf } from "./dxf/plan.js";
import { renderElevationSvg } from "./svg/elevation.js";
import { renderPlanSvg } from "./svg/plan.js";
import { readDxf } from "./testing/dxf-reader.js";
import { straightModel } from "./testing/fixtures.js";
import { parseXml } from "./testing/xml.js";

/**
 * `Model` partiel (paramètres impossibles, `Model.errors` non vide) : le contrat autorise un
 * découpage vide et des grandeurs non finies. Les rendus doivent rester affichables (l'interface
 * les appelle à chaque modification) au lieu de lever une erreur.
 */
describe("modèle partiel", () => {
  const base = straightModel();
  const partial: Model = {
    ...base,
    stepping: {
      ...base.stepping,
      riserCount: 0,
      rises: [],
      rise: NaN,
      going: NaN,
      blondel: NaN,
      run: NaN,
      nosings: [],
      treads: [],
      balancedZones: [],
    },
    errors: ["Nombre de hauteurs impossible"],
  };

  it("plan SVG : bords seuls, sans NaN", () => {
    const svg = renderPlanSvg(partial);
    parseXml(svg);
    expect(svg).not.toMatch(/NaN|Infinity/);
  });

  it("élévation SVG : sans NaN ni cote de hauteur nulle", () => {
    const svg = renderElevationSvg(partial);
    parseXml(svg);
    expect(svg).not.toMatch(/NaN|Infinity/);
  });

  it.each(["R12", "AC1021"] as const)("plan DXF %s relisible", (version) => {
    const f = readDxf(exportPlanDxf(partial, { version }));
    expect(f.entities.length).toBeGreaterThan(0);
  });

  it("un seul nez", () => {
    const m: Model = {
      ...base,
      stepping: { ...base.stepping, nosings: base.stepping.nosings.slice(0, 1), treads: [] },
    };
    parseXml(renderPlanSvg(m));
    parseXml(renderElevationSvg(m));
  });
});
