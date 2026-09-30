import { PRESET_IDS, buildModel, createProject } from "@blondel/core";
import { MessageError, msg, textMessage } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { renderElevationForScreen, renderPlanForScreen, renderWith } from "./planSvg.js";

describe("rendus SVG pour l'écran", () => {
  it("rend le SVG ou l'erreur", () => {
    expect(renderWith(() => "<svg/>")).toEqual({ svg: "<svg/>" });
    expect(
      renderWith(() => {
        throw new Error("cote impossible");
      }),
    ).toEqual({ error: textMessage("cote impossible") });
    // Exception métier : son `Message`, rendu dans la langue d'affichage.
    const failed = renderWith(() => {
      throw new MessageError(msg("ui.label.export.noModel"));
    });
    expect("error" in failed && failed.error.key).toBe("ui.label.export.noModel");
  });

  it("plan et élévation réels sur chaque préréglage, avec une cible data-tread par marche", () => {
    for (const id of PRESET_IDS) {
      const project = createProject(id);
      const model = buildModel(project);
      for (const theme of ["light", "dark"] as const) {
        const plan = renderPlanForScreen(model, { project, theme, locale: "fr" });
        const elev = renderElevationForScreen(model, { project, theme, locale: "fr" });
        if (!("svg" in plan) || !("svg" in elev)) throw new Error(`${id} : rendu en échec`);
        expect(plan.svg, id).toMatch(/^<svg/);
        expect(plan.svg, id).not.toContain("NaN");
        expect(elev.svg, id).not.toContain("NaN");
        for (const t of model.stepping.treads) {
          expect(plan.svg, `${id} plan M${t.number}`).toContain(`data-tread="${t.number}"`);
          expect(elev.svg, `${id} élévation M${t.number}`).toContain(`data-tread="${t.number}"`);
        }
      }
    }
  });
});
