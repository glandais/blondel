import { bbox, pointInPolygon, type Part } from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sheetStringerPart, treadPart, woodStringerPart } from "../testing/fixtures.js";
import { findAll, parseXml } from "../testing/xml.js";
import { flatLineStyle, flatPatternExtent, renderFlatPatternSvg, wrapWords } from "./flat.js";

describe("renderFlatPatternSvg", () => {
  it("limon bois : contour, mortaises et traçage sur styles distincts, cotes, repère", () => {
    const part = woodStringerPart();
    const svg = renderFlatPatternSvg(part);
    const root = parseXml(svg);
    expect(root.attrs.class).toBe("blondel-flat");
    const paths = findAll(root, "path");
    const mortise = paths.filter((p) => p.attrs["data-feature"] === "mortise");
    const mark = paths.filter((p) => p.attrs["data-kind"] === "mark" && !p.attrs["data-feature"]);
    const flat = part.flat!;
    expect(mortise).toHaveLength(flat.lines.filter((l) => l.feature === "mortise").length);
    expect(mark).toHaveLength(
      flat.lines.filter((l) => l.kind === "mark" && l.feature === undefined).length,
    );
    // Styles distincts : mortaise en trait plein, traçage en pointillés, couleurs différentes.
    expect(mortise[0]!.attrs["stroke-dasharray"]).toBeUndefined();
    expect(mark[0]!.attrs["stroke-dasharray"]).toBeDefined();
    expect(mortise[0]!.attrs.stroke).not.toBe(mark[0]!.attrs.stroke);
    // Cotes hors-tout = boîte englobante.
    const box = bbox(flat.outline.outer);
    const dims = findAll(root, "g").filter((g) => g.attrs["data-dimension"] !== undefined);
    const byName = Object.fromEntries(
      dims.map((g) => [
        g.attrs["data-dimension"],
        Number(findAll(g, "text")[0]!.attrs["data-value"]),
      ]),
    );
    expect(byName.length).toBeCloseTo(box.max.x - box.min.x, 2);
    expect(byName.height).toBeCloseTo(box.max.y - box.min.y, 2);
    // Repère, texte libre et ligne d'information.
    const texts = findAll(root, "text");
    expect(texts.find((t) => t.attrs["data-mark"] === part.mark)?.text).toBe(part.mark);
    expect(texts.some((t) => t.text === "Face jour")).toBe(true);
    expect(texts.some((t) => t.text.includes("mortaise 1 prof. 15"))).toBe(true);
    expect(texts.find((t) => t.attrs.class === "info")!.text).toContain("Chêne");
  });

  it("tôle : plis, roulage et joint sur styles distincts ; trous en pair-impair", () => {
    const root = parseXml(renderFlatPatternSvg(sheetStringerPart(), { theme: "dark" }));
    const kinds = new Set(
      findAll(root, "path")
        .map((p) => p.attrs["data-kind"])
        .filter(Boolean),
    );
    expect([...kinds].sort()).toEqual(["bend", "joint", "mark", "roll"]);
    const outline = parseXml(renderFlatPatternSvg(treadPart(1)));
    const o = findAll(outline, "path").find((p) => p.attrs.class === "outline")!;
    expect(o.attrs["fill-rule"]).toBe("evenodd");
    expect(o.attrs.d!.match(/M/g)).toHaveLength(2);
  });

  it("échelle 1:n : dimensions physiques en mm", () => {
    const root = parseXml(renderFlatPatternSvg(woodStringerPart(), { scale: 10 }));
    expect(root.attrs.width).toMatch(/mm$/);
    const w = parseFloat(root.attrs.width!);
    const extent = flatPatternExtent(woodStringerPart());
    expect(w).toBeGreaterThan(extent.width / 10);
  });

  it("options : sans cotes ni information", () => {
    const root = parseXml(
      renderFlatPatternSvg(treadPart(1), { dimensions: false, info: false, background: false }),
    );
    expect(findAll(root, "g").some((g) => g.attrs["data-dimension"])).toBe(false);
    expect(findAll(root, "text").some((t) => t.attrs.class === "info")).toBe(false);
    expect(findAll(root, "rect")).toHaveLength(0);
  });

  it("refus explicite sans développé", () => {
    const p = { ...treadPart(1), flat: undefined } as Part;
    expect(() => renderFlatPatternSvg(p)).toThrow(/développé à plat/);
  });

  it("style par nature de ligne", () => {
    const a = { x: 0, y: 0 };
    expect(flatLineStyle({ kind: "mark", a, b: a, feature: "mortise" })).toBe("mortise");
    expect(flatLineStyle({ kind: "mark", a, b: a })).toBe("mark");
    expect(flatLineStyle({ kind: "text", a, b: a, label: "x" })).toBeUndefined();
  });

  it("propriété : SVG bien formé, repère dans la matière, cotes = boîte englobante", () => {
    fc.assert(
      fc.property(
        fc.record({
          riserCount: fc.integer({ min: 3, max: 18 }),
          rise: fc.double({ min: 150, max: 190, noNaN: true }),
          going: fc.double({ min: 220, max: 300, noNaN: true }),
          above: fc.double({ min: 30, max: 80, noNaN: true }),
          below: fc.double({ min: 200, max: 320, noNaN: true }),
        }),
        fc.constantFrom("light" as const, "dark" as const),
        (o, theme) => {
          const part = woodStringerPart(o);
          const pxPerMm = 0.2;
          const svg = renderFlatPatternSvg(part, { theme, pxPerMm, margin: 0 });
          expect(svg).not.toMatch(/NaN|Infinity/);
          const root = parseXml(svg);
          const flat = part.flat!;
          const box = bbox(flat.outline.outer);
          const dims = findAll(root, "g").filter((g) => g.attrs["data-dimension"]);
          const values = dims.map((g) => Number(findAll(g, "text")[0]!.attrs["data-value"]));
          expect(values[0]).toBeCloseTo(box.max.x - box.min.x, 2);
          expect(values[1]).toBeCloseTo(box.max.y - box.min.y, 2);
          // Repère : position px ramenée en mm par le premier sommet du contour, dans la matière.
          const outline = findAll(root, "path").find((p) => p.attrs.class === "outline")!;
          const [x0, y0] = /^M([-\d.]+) ([-\d.]+)/.exec(outline.attrs.d!)!.slice(1).map(Number);
          const markText = findAll(root, "text").find((t) => t.attrs["data-mark"])!;
          const at = {
            x: flat.outline.outer[0]!.x + (Number(markText.attrs.x) - x0!) / pxPerMm,
            y: flat.outline.outer[0]!.y - (Number(markText.attrs.y) - y0!) / pxPerMm,
          };
          expect(pointInPolygon(at, flat.outline.outer)).toBe("inside");
        },
      ),
      { numRuns: 25 },
    );
  });
});

describe("wrapWords", () => {
  it("replie aux espaces sans dépasser la largeur, sans perdre de mot", () => {
    const text = "LI2 — Limon de jour, volée 2 — Référence : face tracée (x = abscisse)";
    const lines = wrapWords(text, 20);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(20);
    expect(lines.join(" ")).toBe(text);
    expect(wrapWords("mot_plus_long_que_la_largeur court", 5)).toEqual([
      "mot_plus_long_que_la_largeur",
      "court",
    ]);
    expect(wrapWords("", 10)).toEqual([""]);
  });
});
