import type { Severity } from "@blondel/core";
import { describe, expect, it } from "vitest";
import { FUNCTIONAL_COLORS, functionalColors, severityRole } from "./palette.js";
import { DARK_THEME, LIGHT_THEME, resolveTheme, severityColor } from "./svg/svg.js";
import { renderPlanSvg } from "./svg/plan.js";
import { renderElevationSvg } from "./svg/elevation.js";
import { ruleResult, sampleProject, straightModel } from "./testing/fixtures.js";

describe("palette fonctionnelle (ADR-0009, point 10)", () => {
  it("valeurs du tableau du handoff, clair / sombre", () => {
    expect(FUNCTIONAL_COLORS).toEqual({
      light: {
        selection: "#ff7a1a",
        blocking: "#b3261e",
        warning: "#9a6200",
        advice: "#416180",
        ok: "#2e7d32",
        opening: "#6e40c9",
      },
      dark: {
        selection: "#ff9a4d",
        blocking: "#f28b82",
        warning: "#f0b85a",
        advice: "#94bce3",
        ok: "#81c995",
        opening: "#a58cf0",
      },
    });
    expect(functionalColors("light")).toBe(FUNCTIONAL_COLORS.light);
    expect(functionalColors("dark")).toBe(FUNCTIONAL_COLORS.dark);
    expect(Object.isFrozen(FUNCTIONAL_COLORS.light)).toBe(true);
  });

  it("thèmes SVG : les couleurs fonctionnelles viennent de la palette", () => {
    for (const [theme, c] of [
      [LIGHT_THEME, FUNCTIONAL_COLORS.light],
      [DARK_THEME, FUNCTIONAL_COLORS.dark],
    ] as const) {
      expect(theme.blocking).toBe(c.blocking);
      expect(theme.warning).toBe(c.warning);
      expect(theme.advice).toBe(c.advice);
      expect(theme.opening).toBe(c.opening);
      expect(theme.headroom).toBe(c.ok);
    }
    expect(resolveTheme(undefined)).toBe(LIGHT_THEME);
  });

  it("sévérités : rôle et couleur", () => {
    const sevs: Severity[] = ["bloquant", "avertissement", "conseil"];
    expect(sevs.map(severityRole)).toEqual(["blocking", "warning", "advice"]);
    for (const s of sevs) {
      expect(severityColor(LIGHT_THEME, s)).toBe(FUNCTIONAL_COLORS.light[severityRole(s)]);
      expect(severityColor(DARK_THEME, s)).toBe(FUNCTIONAL_COLORS.dark[severityRole(s)]);
    }
  });

  it("SVG exportés par défaut : seulement des couleurs fonctionnelles claires", () => {
    const m = straightModel({
      results: [
        ruleResult("A", { kind: "tread", number: 3 }, "bloquant"),
        ruleResult("B", { kind: "nosing", index: 5 }, "avertissement"),
        ruleResult("C", { kind: "tread", number: 6 }, "conseil"),
        ruleResult("D", { kind: "point", at: { x: 450, y: 800, z: 0 } }, "bloquant"),
      ],
    });
    const light = new Set(Object.values(FUNCTIONAL_COLORS.light));
    const dark = Object.values(FUNCTIONAL_COLORS.dark);
    for (const svg of [
      renderPlanSvg(m, { project: sampleProject() }),
      renderElevationSvg(m, { project: sampleProject() }),
    ]) {
      const used = new Set(svg.toLowerCase().match(/#[0-9a-f]{6}/g) ?? []);
      for (const d of dark) expect(used.has(d), d).toBe(false);
      // Toute couleur du dessin est une couleur du thème clair (dont les couleurs fonctionnelles).
      const themeColors = new Set(Object.values(LIGHT_THEME).map((v) => v.toLowerCase()));
      for (const c of used) expect(themeColors.has(c), c).toBe(true);
      // Les sévérités et la trémie présentes sont bien celles de la palette claire.
      expect([...used].some((c) => light.has(c))).toBe(true);
    }
  });
});
