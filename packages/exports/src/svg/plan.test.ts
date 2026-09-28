import { curvePointAt, fromPolyline, vec2 } from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { quarterTurnModel, ruleResult, sampleProject, straightModel } from "../testing/fixtures.js";
import { layoutArb, quarterArb, straightArb } from "../testing/arbitraries.js";
import { findAll, parseXml, type XmlElement } from "../testing/xml.js";
import { renderPlanSvg } from "./plan.js";
import { DARK_THEME, LIGHT_THEME } from "./svg.js";

const dims = (root: XmlElement) =>
  findAll(root, "g")
    .filter((g) => g.attrs["data-dimension"] !== undefined)
    .map((g) => ({
      role: g.attrs["data-dimension"]!,
      value: Number(findAll(g, "text")[0]!.attrs["data-value"]),
      text: findAll(g, "text")[0]!.text,
    }));

describe("renderPlanSvg", () => {
  it("escalier droit : SVG bien formé, marches numérotées, cotes", () => {
    const m = straightModel({ floorToFloor: 2700, riserCount: 15, going: 250, width: 900 });
    const svg = renderPlanSvg(m, { project: sampleProject() });
    const root = parseXml(svg);
    expect(root.name).toBe("svg");
    expect(root.attrs.xmlns).toBe("http://www.w3.org/2000/svg");
    const treads = findAll(root, "path").filter((p) => p.attrs["data-tread"] !== undefined);
    expect(treads).toHaveLength(14);
    const numbers = findAll(root, "text").filter((t) => t.attrs["data-tread"] !== undefined);
    expect(numbers.map((t) => t.text)).toEqual(Array.from({ length: 14 }, (_, i) => String(i + 1)));
    const nosings = findAll(root, "line").filter((l) => l.attrs["data-nosing"] !== undefined);
    expect(nosings).toHaveLength(15);
    const d = dims(root);
    expect(d.find((x) => x.role === "width")?.value).toBeCloseTo(900, 2);
    expect(d.find((x) => x.role === "width")?.text).toBe("900");
    // Reculement = longueur de volée ici : une seule cote.
    expect(d.some((x) => x.role === "run")).toBe(false);
    expect(d.find((x) => x.role === "leg")?.value).toBeCloseTo(3500, 2);
    expect(d.find((x) => x.role === "going")?.text).toBe("g = 250,0");
    // Trémie en pointillés.
    const opening = findAll(root, "path").find((p) => p.attrs.class === "opening");
    expect(opening?.attrs["stroke-dasharray"]).toBeDefined();
    // Cartouche : hauteur, 2h + g.
    const texts = findAll(root, "text").map((t) => t.text);
    expect(texts).toContain("Hauteur à monter H = 2 700 mm");
    expect(texts).toContain("2h + g = 610,0 mm");
    // Flèche de montée et cercle de départ.
    const walk = findAll(root, "g").find((g) => g.attrs.class === "walkline")!;
    expect(findAll(walk, "circle")).toHaveLength(1);
    expect(findAll(walk, "path")).toHaveLength(2);
  });

  it("reculement coté séparément quand il diffère de la volée", () => {
    const m = straightModel({ riserCount: 15, going: 250, width: 900 });
    const outer = fromPolyline([
      { x: 900, y: 0 },
      { x: 900, y: 3800 },
    ]);
    const root = parseXml(renderPlanSvg({ ...m, layout: { ...m.layout, outer } }));
    const d = dims(root);
    expect(d.find((x) => x.role === "run")?.value).toBeCloseTo(3500, 6);
    expect(d.find((x) => x.role === "leg")?.value).toBeCloseTo(3800, 6);
  });

  it("sans projet, pas de trémie", () => {
    const root = parseXml(renderPlanSvg(straightModel()));
    expect(findAll(root, "path").some((p) => p.attrs.class === "opening")).toBe(false);
  });

  it("marqueurs de conformité localisés : marche en rouge, nez en orange", () => {
    const m = straightModel({
      results: [
        ruleResult("G_MIN", { kind: "tread", number: 3 }, "avertissement"),
        ruleResult("G_MAX", { kind: "tread", number: 3 }, "bloquant"),
        ruleResult("K5", { kind: "nosing", index: 5 }, "avertissement"),
        ruleResult("PT", { kind: "point", at: { x: 450, y: 800, z: 0 } }, "bloquant"),
        ruleResult("OK", { kind: "tread", number: 4 }, "bloquant", { status: "ok" }),
      ],
    });
    const root = parseXml(renderPlanSvg(m));
    const t3 = findAll(root, "path").find((p) => p.attrs["data-tread"] === "3")!;
    expect(t3.attrs.fill).toBe(LIGHT_THEME.blocking);
    expect(t3.attrs["data-severity"]).toBe("bloquant");
    const t4 = findAll(root, "path").find((p) => p.attrs["data-tread"] === "4")!;
    expect(t4.attrs["data-severity"]).toBeUndefined();
    const n5 = findAll(root, "line").find((l) => l.attrs["data-nosing"] === "5")!;
    expect(n5.attrs.stroke).toBe(LIGHT_THEME.warning);
    const markers = findAll(root, "g").find((g) => g.attrs.class === "markers")!;
    expect(findAll(markers, "circle")).toHaveLength(1);
    // Masquage des marqueurs.
    const hidden = parseXml(renderPlanSvg(m, { show: { compliance: false } }));
    expect(findAll(hidden, "path").find((p) => p.attrs["data-tread"] === "3")!.attrs.fill).toBe(
      LIGHT_THEME.treadFill,
    );
  });

  it("quart tournant : balancement visible, pas de reculement linéaire", () => {
    const m = quarterTurnModel();
    const root = parseXml(renderPlanSvg(m, { theme: "dark" }));
    const winders = findAll(root, "path").filter((p) => p.attrs["data-kind"] === "winder");
    expect(winders.length).toBeGreaterThan(2);
    for (const w of winders) expect(w.attrs.fill).toBe(DARK_THEME.winderFill);
    const balanced = findAll(root, "line").filter((l) => l.attrs["data-balanced"] === "true");
    expect(balanced.length).toBeGreaterThan(0);
    for (const b of balanced) expect(b.attrs.stroke).toBe(DARK_THEME.nosingBalanced);
    const d = dims(root);
    expect(d.filter((x) => x.role === "leg").map((x) => Math.round(x.value))).toEqual([1400, 3000]);
    expect(d.some((x) => x.role === "run")).toBe(false);
    // Le contour garde un arc exact ? (jour vif ici : aucun) — la ligne de foulée, oui.
    const walk = findAll(root, "g").find((g) => g.attrs.class === "walkline")!;
    expect(findAll(walk, "path")[0]!.attrs.d).toMatch(/A/);
    const bg = findAll(root, "rect").find((r) => r.attrs.class === "background")!;
    expect(bg.attrs.fill).toBe(DARK_THEME.background);
  });

  it("échelle d'impression : dimensions en mm papier", () => {
    const m = straightModel();
    const root = parseXml(renderPlanSvg(m, { scale: 20 }));
    expect(root.attrs.width).toMatch(/mm$/);
    const [, , vw] = root.attrs.viewBox!.split(" ").map(Number);
    // 96 dpi : 1 mm papier = 96 / 25,4 px.
    expect(Number(root.attrs.width!.replace("mm", "")) * (96 / 25.4)).toBeCloseTo(vw!, 1);
    expect(() => renderPlanSvg(m, { pxPerMm: 0 })).toThrow(RangeError);
    expect(() => renderPlanSvg(m, { scale: -1 })).toThrow(RangeError);
  });

  it("thème personnalisé et échappement des textes", () => {
    const m = straightModel();
    const svg = renderPlanSvg(m, {
      theme: { base: "dark", edge: "#ff00ff" },
      title: 'A & B <"x">',
    });
    const root = parseXml(svg);
    expect(findAll(root, "title")[0]!.text).toBe('A & B <"x">');
    expect(findAll(root, "path").find((p) => p.attrs.class === "contour")!.attrs.stroke).toBe(
      "#ff00ff",
    );
  });

  it("propriété : SVG bien formé, n − 1 numéros, cote d'emmarchement exacte", () => {
    fc.assert(
      fc.property(fc.oneof(straightArb, quarterArb, layoutArb), (m) => {
        const root = parseXml(renderPlanSvg(m));
        const numbers = findAll(root, "text").filter((t) => t.attrs["data-tread"] !== undefined);
        expect(numbers).toHaveLength(m.stepping.riserCount - 1);
        const w = vec2.distance(curvePointAt(m.layout.inner, 0), curvePointAt(m.layout.outer, 0));
        expect(Math.abs(dims(root).find((x) => x.role === "width")!.value - w)).toBeLessThan(0.01);
        // Aucune coordonnée NaN.
        expect(/NaN|Infinity/.test(renderPlanSvg(m))).toBe(false);
      }),
      { numRuns: 60 },
    );
  });
});
