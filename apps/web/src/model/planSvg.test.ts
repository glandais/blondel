import { PRESET_IDS, buildModel, createProject } from "@blondel/core";
import { MessageError, msg, textMessage } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { renderElevationSvg, renderPlanSvg } from "@blondel/exports";
import {
  NOSING_TARGET_HALF_WIDTH_PX,
  renderElevationForScreen,
  renderPlanForScreen,
  renderWith,
  withNosingTarget,
} from "./planSvg.js";

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

describe("cible du nez d'arrivée (QUESTIONS A28)", () => {
  const project = createProject("quarter-left");
  const model = buildModel(project);
  const k = model.stepping.nosings.length - 1;
  const o = { project, theme: "light", locale: "fr" } as const;

  it("plan : rectangle transparent autour de la ligne de nez, en dernier, focalisable et nommé", () => {
    const plan = renderPlanForScreen(model, o);
    const out = withNosingTarget(plan, k, "Nez d'arrivée");
    if (!("svg" in plan) || !("svg" in out)) throw new Error("rendu en échec");
    const found = new RegExp(`<polygon [^>]*data-nosing-target="${k}"[^>]*/></svg>$`).exec(out.svg);
    expect(found).not.toBeNull();
    const target = found![0].replace(/<\/svg>$/, "");
    expect(target).toContain('fill="transparent"');
    expect(target).toContain('pointer-events="all"');
    expect(target).toContain(`tabindex="0" role="button" aria-label="Nez d'arrivée"`);
    // Rectangle centré sur la ligne de nez exportée, de largeur 2 × demi-largeur.
    const line = new RegExp(`<line ([^>]*)data-nosing="${k}"`).exec(plan.svg)![1]!;
    const [x1, y1, x2, y2] = ["x1", "y1", "x2", "y2"].map((a) =>
      Number(new RegExp(`\\b${a}="([^"]+)"`).exec(line)![1]),
    );
    const pts = /points="([^"]+)"/
      .exec(target)![1]!
      .split(" ")
      .map((p) => p.split(",").map(Number) as [number, number]);
    expect(pts).toHaveLength(4);
    const cx = pts.reduce((s, p) => s + p[0], 0) / 4;
    const cy = pts.reduce((s, p) => s + p[1], 0) / 4;
    expect(cx).toBeCloseTo((x1! + x2!) / 2, 1);
    expect(cy).toBeCloseTo((y1! + y2!) / 2, 1);
    const width = Math.hypot(pts[1]![0] - pts[2]![0], pts[1]![1] - pts[2]![1]);
    expect(width).toBeCloseTo(2 * NOSING_TARGET_HALF_WIDTH_PX, 1);
    const len = Math.hypot(pts[0]![0] - pts[1]![0], pts[0]![1] - pts[1]![1]);
    expect(len).toBeCloseTo(Math.hypot(x2! - x1!, y2! - y1!) + 2 * NOSING_TARGET_HALF_WIDTH_PX, 1);
    // Le reste du dessin est inchangé (rendu par défaut des exports).
    expect(out.svg.replace(target, "")).toBe(plan.svg);
  });

  it("élévation : disque transparent sur le point du nez", () => {
    const elev = renderElevationForScreen(model, o);
    const out = withNosingTarget(elev, k, "Top nosing");
    if (!("svg" in out)) throw new Error("rendu en échec");
    const r = NOSING_TARGET_HALF_WIDTH_PX + 2;
    expect(out.svg).toMatch(
      new RegExp(`<circle [^>]*r="${r}"[^>]*data-nosing-target="${k}"[^>]*"Top nosing"/></svg>$`),
    );
  });

  it("libellé échappé ; sans nez, sans rendu ou indice inconnu : inchangé", () => {
    const plan = renderPlanForScreen(model, o);
    const out = withNosingTarget(plan, k, 'a"<b>&');
    if (!("svg" in out)) throw new Error("rendu en échec");
    expect(out.svg).toContain('aria-label="a&quot;&lt;b&gt;&amp;"');
    expect(withNosingTarget(plan, null, "x")).toBe(plan);
    expect(withNosingTarget(plan, 999, "x")).toBe(plan);
    const failed = { error: textMessage("x") };
    expect(withNosingTarget(failed, k, "x")).toBe(failed);
    expect(withNosingTarget({ svg: "<svg/>" }, k, "x")).toEqual({ svg: "<svg/>" });
  });

  it("exports par défaut : aucune cible (instantanés inchangés)", () => {
    expect(renderPlanSvg(model, { project })).not.toContain("data-nosing-target");
    expect(renderElevationSvg(model, { project })).not.toContain("data-nosing-target");
  });
});
