/**
 * DXF des développés : deux développés de même repère que seul le bruit d'arrondi distingue
 * donnent un seul fichier (chantier `stable-tiebreaks`, S2, point 4) ; deux développés
 * réellement différents en donnent deux, jamais une fusion silencieuse.
 */
import type { FlatPattern, Part, Vec2 } from "@blondel/core";
import { msg, num, textMessage } from "@blondel/i18n";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { treadPart } from "../testing/fixtures.js";
import { exportPartsDxf } from "./parts.js";

const withFlat = (base: Part, id: string, flat: FlatPattern): Part => ({ ...base, id, flat });

/** Déplace le premier sommet du contour de (dx, dy). */
function shiftFirst(flat: FlatPattern, dx: number, dy: number): FlatPattern {
  const [p0, ...rest] = flat.outline.outer;
  return {
    ...flat,
    outline: { ...flat.outline, outer: [{ x: p0!.x + dx, y: p0!.y + dy }, ...rest] },
  };
}

describe("exportPartsDxf : regroupement au bruit près", () => {
  const base = treadPart(1, "M1");
  const flat = base.flat!;

  it("cas dédié : deux développés identiques à 1e-12 près → un seul fichier ×2", () => {
    const a = withFlat(base, "a", flat);
    const b = withFlat(base, "b", shiftFirst(flat, 1e-12, -1e-12));
    // Avant S2, la clé JSON en flottants exacts les séparait.
    expect(JSON.stringify(a.flat)).not.toBe(JSON.stringify(b.flat));
    const files = exportPartsDxf({ parts: [a, b] });
    expect(files.map((f) => [f.filename, f.quantity, f.partIds])).toEqual([
      ["M1.dxf", 2, ["a", "b"]],
    ]);
  });

  it("deux développés réellement différents (1e-3 mm) restent deux fichiers", () => {
    const a = withFlat(base, "a", flat);
    const b = withFlat(base, "b", shiftFirst(flat, 1e-3, 0));
    const files = exportPartsDxf({ parts: [a, b] });
    expect(files.map((f) => [f.filename, f.quantity, f.partIds])).toEqual([
      ["M1.dxf", 1, ["a"]],
      ["M1-2.dxf", 1, ["b"]],
    ]);
  });

  it("libellé ou paramètre de Message différent : deux fichiers", () => {
    const a = withFlat(base, "a", {
      ...flat,
      reference: { kind: "face", description: textMessage("P1") },
    });
    const b = withFlat(base, "b", {
      ...flat,
      reference: { kind: "face", description: textMessage("P2") },
    });
    expect(exportPartsDxf({ parts: [a, b] })).toHaveLength(2);
  });

  // ---------------------------------------------------------------- propriété

  const intPt = fc.record({
    x: fc.integer({ min: 0, max: 2000 }),
    y: fc.integer({ min: 0, max: 600 }),
  });

  /** Développé généré : contour entier, trou, lignes, `Message` à paramètre `num`. */
  const genFlat = fc
    .record({
      w: fc.integer({ min: 200, max: 2000 }),
      h: fc.integer({ min: 100, max: 600 }),
      lines: fc.array(fc.record({ a: intPt, b: intPt, angle: fc.integer({ min: 1, max: 179 }) }), {
        maxLength: 4,
      }),
      thickness: fc.integer({ min: 2, max: 60 }),
      depth: fc.integer({ min: 1, max: 40 }),
    })
    .map(({ w, h, lines, thickness, depth }): FlatPattern => ({
      outline: {
        outer: [
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: w, y: h },
          { x: 0, y: h },
        ],
        holes: [
          [
            { x: 20, y: 20 },
            { x: 20, y: 60 },
            { x: 60, y: 60 },
            { x: 60, y: 20 },
          ],
        ],
      },
      lines: lines.map((l, i) =>
        i % 2 === 0
          ? {
              kind: "bend" as const,
              a: l.a,
              b: l.b,
              bendAngle: l.angle,
              bendUp: true,
              bendRadius: 2,
            }
          : {
              kind: "mark" as const,
              a: l.a,
              b: l.b,
              feature: "mortise" as const,
              depth,
              label: msg("common.text", { text: "M", value: num(depth + 0.5, 1, "mm") }),
            },
      ),
      thickness,
      reference: { kind: "neutral-fiber", description: textMessage("fibre neutre") },
    }));

  /** Copie dont chaque nombre est décalé d'au plus `amp` (graines fast-check). */
  function perturbed(flat: FlatPattern, seeds: readonly number[], amp: number): FlatPattern {
    let n = 0;
    const d = (x: number): number => x + amp * seeds[n++ % seeds.length]!;
    const pt = (p: Vec2): Vec2 => ({ x: d(p.x), y: d(p.y) });
    return {
      ...flat,
      outline: {
        outer: flat.outline.outer.map(pt),
        holes: flat.outline.holes.map((h) => h.map(pt)),
      },
      lines: flat.lines.map((l) => ({
        ...l,
        a: pt(l.a),
        b: pt(l.b),
        ...(l.bendAngle !== undefined ? { bendAngle: d(l.bendAngle) } : {}),
        ...(l.bendRadius !== undefined ? { bendRadius: d(l.bendRadius) } : {}),
        ...(l.depth !== undefined ? { depth: d(l.depth) } : {}),
        ...(l.label !== undefined && l.label.params?.["value"] !== undefined
          ? {
              label: msg("common.text", {
                text: "M",
                value: num(d((l.label.params["value"] as { num: number }).num), 1, "mm"),
              }),
            }
          : {}),
      })),
      thickness: d(flat.thickness),
    };
  }

  const seeds = fc.array(fc.double({ min: -1, max: 1, noNaN: true }), {
    minLength: 4,
    maxLength: 32,
  });

  it("propriété : copie bruitée ≤ 1e-9 → un seul fichier, pièces dans l'ordre", () => {
    fc.assert(
      fc.property(genFlat, seeds, fc.boolean(), (f, s, swap) => {
        const a = withFlat(base, "a", f);
        const b = withFlat(base, "b", perturbed(f, s, 1e-9));
        const c = withFlat(treadPart(2, "M2"), "c", f);
        const parts = swap ? [c, a, b] : [a, c, b];
        const files = exportPartsDxf({ parts });
        expect(files.map((x) => [x.mark, x.quantity, x.partIds])).toEqual(
          swap
            ? [
                ["M2", 1, ["c"]],
                ["M1", 2, ["a", "b"]],
              ]
            : [
                ["M1", 2, ["a", "b"]],
                ["M2", 1, ["c"]],
              ],
        );
      }),
      { numRuns: 200 },
    );
  });

  it("propriété : un nombre décalé de 1e-5 ou plus → deux fichiers", () => {
    fc.assert(
      fc.property(genFlat, fc.double({ min: 1e-5, max: 10, noNaN: true }), (f, gap) => {
        const a = withFlat(base, "a", f);
        const b = withFlat(base, "b", { ...f, thickness: f.thickness + gap });
        expect(exportPartsDxf({ parts: [a, b] }).map((x) => x.quantity)).toEqual([1, 1]);
      }),
      { numRuns: 100 },
    );
  });

  it("propriété : le mélange de l'ordre d'entrée ne change pas la partition", () => {
    fc.assert(
      fc.property(
        genFlat,
        seeds,
        fc.array(fc.nat(), { minLength: 6, maxLength: 6 }),
        (f, s, keys) => {
          const parts = [
            withFlat(base, "p0", f),
            withFlat(base, "p1", perturbed(f, s, 1e-9)),
            withFlat(base, "p2", { ...f, thickness: f.thickness + 1 }),
            withFlat(base, "p3", perturbed({ ...f, thickness: f.thickness + 1 }, s, 1e-9)),
            withFlat(base, "p4", perturbed(f, [...s].reverse(), 1e-9)),
            withFlat(treadPart(9, "M9"), "p5", f),
          ];
          const shuffled = parts
            .map((p, i) => ({ p, k: keys[i]! * 8 + i }))
            .sort((x, y) => x.k - y.k)
            .map((e) => e.p);
          const partition = (ps: readonly Part[]): string[] =>
            exportPartsDxf({ parts: ps })
              .map((x) => [...x.partIds].sort().join(","))
              .sort();
          expect(partition(shuffled)).toEqual(partition(parts));
          expect(partition(parts)).toEqual(["p0,p1,p4", "p2,p3", "p5"]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
