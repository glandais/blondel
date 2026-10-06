import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { RecordingCanvas, toWinAnsi, type PathOp } from "./canvas.js";
import {
  arcToBeziers,
  drawSvg,
  parseColor,
  parsePathData,
  parseSvg,
  parseTransform,
} from "./svg-draw.js";

const bez = (p0: { x: number; y: number }, c: Extract<PathOp, { op: "C" }>, t: number) => {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
    y: u * u * u * p0.y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
  };
};

describe("interprète SVG → PdfCanvas", () => {
  it("chemins : M L H V Z, relatifs, lignes implicites", () => {
    expect(parsePathData("M1 2L3 4H5V6Z")).toEqual([
      { op: "M", x: 1, y: 2 },
      { op: "L", x: 3, y: 4 },
      { op: "L", x: 5, y: 4 },
      { op: "L", x: 5, y: 6 },
      { op: "Z" },
    ]);
    expect(parsePathData("m1 1 2 0 0 2z")).toEqual([
      { op: "M", x: 1, y: 1 },
      { op: "L", x: 3, y: 1 },
      { op: "L", x: 3, y: 3 },
      { op: "Z" },
    ]);
    expect(() => parsePathData("Q1 1 2 2")).toThrow(/non prise en charge/);
  });

  it("propriété : les arcs convertis en Bézier restent sur le cercle (±0,1 % du rayon)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 1000, noNaN: true }),
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        fc.double({ min: 0.05, max: 2 * Math.PI - 0.05, noNaN: true }),
        fc.boolean(),
        (r, a0, sweepAbs, positive) => {
          const sweep = positive ? sweepAbs : -sweepAbs;
          const p0 = { x: 50 + r * Math.cos(a0), y: 20 + r * Math.sin(a0) };
          const p1 = { x: 50 + r * Math.cos(a0 + sweep), y: 20 + r * Math.sin(a0 + sweep) };
          const ops = arcToBeziers(
            p0.x,
            p0.y,
            r,
            r,
            0,
            Math.abs(sweep) > Math.PI,
            sweep > 0,
            p1.x,
            p1.y,
          );
          let from = p0;
          for (const op of ops) {
            expect(op.op).toBe("C");
            const c = op as Extract<PathOp, { op: "C" }>;
            for (const t of [0.25, 0.5, 0.75]) {
              const q = bez(from, c, t);
              expect(Math.abs(Math.hypot(q.x - 50, q.y - 20) - r)).toBeLessThanOrEqual(r * 1e-3);
            }
            from = { x: c.x, y: c.y };
          }
          expect(Math.hypot(from.x - p1.x, from.y - p1.y)).toBeLessThan(1e-9 + r * 1e-9);
        },
      ),
    );
  });

  it("transformations et couleurs", () => {
    const m = parseTransform("rotate(90 10 0)");
    // (20, 0) tourné de 90° autour de (10, 0) → (10, 10) (Y vers le bas : sens horaire à l'écran).
    expect(m[0] * 20 + m[2] * 0 + m[4]).toBeCloseTo(10, 9);
    expect(m[1] * 20 + m[3] * 0 + m[5]).toBeCloseTo(10, 9);
    expect(parseTransform("translate(3 4) scale(2)")).toEqual([2, 0, 0, 2, 3, 4]);
    expect(parseColor("#0969da")).toEqual([9, 105, 218]);
    expect(parseColor("#fff")).toEqual([255, 255, 255]);
    expect(parseColor("none")).toBeNull();
  });

  it("mise à l'échelle par la largeur physique, styles hérités, texte centré", () => {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="25mm" viewBox="0 0 100 50">` +
      `<title>t</title><g stroke="#ff0000" stroke-width="2" fill="none">` +
      `<rect x="0" y="0" width="100" height="50"/>` +
      `<path d="M0 0L100 50" stroke-dasharray="4 2"/></g>` +
      `<text x="50" y="25" font-size="10" text-anchor="middle" fill="#000">AB &amp; C</text></svg>`;
    const c = new RecordingCanvas();
    const size = drawSvg(c, svg, { x: 10, y: 20 });
    expect(size).toEqual({ width: 50, height: 25 });
    const paths = c.ops.filter((o) => o.type === "path");
    expect(paths).toHaveLength(2);
    const rect = paths[0]!;
    expect(rect.ops[0]).toEqual({ op: "M", x: 10, y: 20 });
    expect(rect.ops[2]).toEqual({ op: "L", x: 60, y: 45 });
    expect(rect.style.stroke).toEqual([255, 0, 0]);
    expect(rect.style.lineWidth).toBeCloseTo(1, 9);
    expect(rect.style.fill).toBeUndefined();
    expect(paths[1]!.style.dash).toEqual([2, 1]);
    const t = c.ops.find((o) => o.type === "text")!;
    expect(t.value).toBe("AB & C");
    expect(t.style.size).toBeCloseTo(5, 9);
    // Centré : décalé de la moitié de la largeur mesurée.
    expect(t.x).toBeCloseTo(10 + 25 - c.textWidth("AB & C", 5) / 2, 9);
    expect(t.y).toBeCloseTo(20 + 12.5, 9);
  });

  it("texte tourné : angle trigonométrique à l'écran", () => {
    const svg =
      `<svg width="10mm" height="10mm" viewBox="0 0 10 10">` +
      `<text x="5" y="5" transform="rotate(-90 5 5)" font-size="1">V</text></svg>`;
    const c = new RecordingCanvas();
    drawSvg(c, svg, { x: 0, y: 0 });
    const t = c.ops.find((o) => o.type === "text")!;
    expect(t.style.angle).toBeCloseTo(90, 9);
  });

  it("SVG mal formé refusé", () => {
    expect(() => parseSvg("<svg><g></svg>")).toThrow();
    expect(() => parseSvg("<g/>")).toThrow(/racine/);
  });

  it("toWinAnsi : cp1252 conservé, le reste remplacé", () => {
    expect(toWinAnsi("Élévation — 2h + g ≥ 600 × 1 000 mm œ €")).toBe(
      "Élévation — 2h + g >= 600 × 1 000 mm œ €",
    );
    expect(toWinAnsi("a\u0001b 中")).toBe("ab ?");
  });

  it("toWinAnsi : lettres grecques des libellés (δ, γ, λ…) écrites en toutes lettres", () => {
    expect(toWinAnsi("joint / naissance δ, γ_M0, λ = 3")).toBe(
      "joint / naissance delta, gamma_M0, lambda = 3",
    );
  });
});
