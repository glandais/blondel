/**
 * Attribution des repères sur les exemples (chantier part-marks R2a, décisions F10 Q1a, Q1b,
 * Q2) : cornières et supports regroupés autour de la plus courte à T près (T =
 * `workshop.identicalPartTolerance`), signature des perçages dans la clé, entretoises comparées
 * à la plus petite.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import type { Model, Part } from "../model/derived.js";
import type { Project } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { parseProjectText } from "../project/parse.js";
import { markGroups } from "./steelFlat.js";
import { supportGroupKey } from "./supports.js";
import "./index.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");

const example = (name: string): Project =>
  parseProjectText(readFileSync(join(EXAMPLES_DIR, `${name}.blondel.json`), "utf8"));

const withTolerance = (p: Project, t: number): Project => ({
  ...p,
  workshop: { ...p.workshop, identicalPartTolerance: t },
});

const build = (p: Project): Model => buildModel(p, { memo: false });

const markOf = (m: Model, id: string): string | undefined => m.parts.find((p) => p.id === id)?.mark;

/** Pièces d'un repère, groupées. */
const byMark = (parts: readonly Part[]): Map<string, Part[]> => {
  const out = new Map<string, Part[]>();
  for (const p of parts) out.set(p.mark, [...(out.get(p.mark) ?? []), p]);
  return out;
};

describe("repères des cornières et supports (F10 Q1a, Q2)", () => {
  it("cage-45-palier-acier : CR2 réunit 139,964 et 139,507 mm (écart 0,457), séparés à T = 0,4", () => {
    const p = example("cage-45-palier-acier");
    const m = build(p);
    const a = "support-4-stringer-inner-1";
    const b = "support-7-stringer-inner-j1";
    expect(markOf(m, a)).toBe("CR2");
    expect(markOf(m, b)).toBe("CR2");
    const m4 = build(withTolerance(p, 0.4));
    expect(markOf(m4, a)).not.toBe(markOf(m4, b));
  });

  it("j3c-acceptance-01-upn (steel-profile) : CR3 (72,424 et 72,728 mm) séparé à T = 0,2", () => {
    const p = example("j3c-acceptance-01-upn");
    const a = "support-2-stringer-inner-1";
    const b = "support-3-stringer-inner-1";
    const m = build(p);
    expect(markOf(m, a)).toBe("CR3");
    expect(markOf(m, b)).toBe("CR3");
    const m2 = build(withTolerance(p, 0.2));
    expect(markOf(m2, a)).not.toBe(markOf(m2, b));
  });

  it("deux supports de même longueur dont le diamètre de perçage diffère : deux repères", () => {
    const m = build(example("cage-45-palier-acier"));
    const cr1 = m.parts.filter((p) => p.mark === "CR1").slice(0, 2);
    expect(cr1).toHaveLength(2);
    const drilled = (p: Part, d: number): Part => ({
      ...p,
      fixings: [{ joint: "treadBolted", points: 2, holeDiameter: d }],
    });
    const same = markGroups([drilled(cr1[0]!, 7), drilled(cr1[1]!, 7)], "CR", supportGroupKey, 0.5);
    expect(new Set(same.map((p) => p.mark)).size).toBe(1);
    const diff = markGroups([drilled(cr1[0]!, 7), drilled(cr1[1]!, 9)], "CR", supportGroupKey, 0.5);
    expect(diff.map((p) => p.mark)).toEqual(["CR1", "CR2"]);
  });

  it("propriété : T tiré dans [0, 2], tout repère CR / PS a un écart de longueur ≤ T + ε et une seule clé", () => {
    const projects = [
      "cage-45-palier-acier",
      "demo-cage-flared-steel",
      "j3c-acceptance-01-upn",
    ].map(example);
    fc.assert(
      fc.property(
        fc.constantFrom(...projects),
        fc.double({ min: 0, max: 2, noNaN: true }),
        (p, t) => {
          const m = build(withTolerance(p, t));
          expect(m.errors).toEqual([]);
          const supports = m.parts.filter((x) => /^(CR|PS)\d+$/.test(x.mark));
          expect(supports.length).toBeGreaterThan(0);
          for (const [, g] of byMark(supports)) {
            const ls = g.map((x) => x.stock?.length ?? 0);
            expect(Math.max(...ls) - Math.min(...ls)).toBeLessThanOrEqual(t + GEOM_EPS);
            expect(new Set(g.map(supportGroupKey)).size).toBe(1);
          }
        },
      ),
      { numRuns: 12 },
    );
  }, 120_000);
});

describe("repères des entretoises (F10 Q1b) : comparaison à la plus petite", () => {
  it("cage-60-palier-central : EC1 = {1, 2, 6, 7, 8, 9}, EC2 = {3, 4}, EC3 = {5}", () => {
    const m = build(example("cage-60-palier-central"));
    const ec = m.parts.filter((p) => p.id.startsWith("central-diaphragm-"));
    const groups = [...byMark(ec)]
      .map(([mark, g]): [string, number[]] => [
        mark,
        g.map((p) => Number(p.id.slice("central-diaphragm-".length))).sort((a, b) => a - b),
      ])
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
    expect(groups).toEqual([
      ["EC1", [1, 2, 6, 7, 8, 9]],
      ["EC2", [3, 4]],
      ["EC3", [5]],
    ]);
  });

  it("T = 0 : mêmes repères qu'à T = 1e-9 (développés identiques au bruit près réunis)", () => {
    for (const name of ["cage-60-palier-central", "j5c-limon-central-helicoidal"]) {
      const p = example(name);
      const marks = (t: number): number =>
        new Set(build(withTolerance(p, t)).parts.map((x) => x.mark)).size;
      expect(marks(0)).toBe(marks(1e-9));
    }
  }, 60_000);
});
