import { translatorFor } from "@blondel/i18n";
import {
  textMessage,
  ProjectSchema,
  buildModel,
  createProject,
  parseProjectText,
  type Part,
  type Project,
} from "@blondel/core";
import { describe, expect, it } from "vitest";
import j5bText from "../../../../examples/j5b-debillarde-soude.blondel.json?raw";
import { segmentedParts } from "./joints.js";

const FR = translatorFor("fr");

describe("tronçons et joints (limon de jour débillardé)", () => {
  it("exemple j5b : tronçons dans l'ordre de la montée, joints J1, J2 entre tronçons consécutifs", () => {
    const model = buildModel(parseProjectText(j5bText));
    const groups = segmentedParts(model);
    const g = groups.find((x) => x.base === "stringer-inner-curved")!;
    expect(g).toBeDefined();
    const marks = g.segments.map((s) => s.part.mark);
    expect(marks.length).toBeGreaterThanOrEqual(2);
    // Repères uniques dans le modèle, consécutifs dans la montée de chaque pièce.
    const all = groups.flatMap((x) => x.joints.map((j) => j.mark));
    expect(new Set(all).size).toBe(all.length);
    const first = Number(g.joints[0]!.mark.slice(1));
    expect(g.joints.map((j) => j.mark)).toEqual(marks.slice(1).map((_, i) => `J${first + i}`));
    g.joints.forEach((j, i) => {
      expect(j.from.mark).toBe(marks[i]);
      expect(j.to.mark).toBe(marks[i + 1]);
      expect(j.weldMm).toBeGreaterThan(0);
      expect(FR.t(j.label)).toMatch(/Joint/);
    });
    // Cordons des joints = soudures bout à bout des tronçons (chaque joint compté une fois).
    const butt = g.segments.reduce((s, x) => s + (x.part.quantities["butt_weld_mm"] ?? 0), 0);
    const joints = g.joints.reduce((s, j) => s + (j.weldMm ?? NaN), 0);
    expect(joints).toBeCloseTo(butt, 6);
    for (const s of g.segments) expect(s.developed).toBeGreaterThan(0);
    expect(g.segments.some((s) => s.rolled > 0)).toBe(true);
  });

  it("pièce seule avec un trait de joint, ou sans suffixe : pas de groupe", () => {
    const part = (id: string): Part => ({
      id,
      mark: id,
      category: "stringer",
      name: textMessage(id),
      material: "steel-raw",
      solid: { kind: "sweep", path: [], section: { outer: [], holes: [] } },
      flat: {
        outline: {
          outer: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
          holes: [],
        },
        lines: [{ kind: "joint", a: { x: 10, y: 0 }, b: { x: 10, y: 10 } }],
        thickness: 8,
      },
      quantities: { weld_mm: 0 },
    });
    expect(segmentedParts({ parts: [part("a-1")] })).toEqual([]);
    expect(segmentedParts({ parts: [part("a"), part("b")] })).toEqual([]);
    const g = segmentedParts({ parts: [part("x-2"), part("x-1")] });
    expect(g[0]!.segments.map((s) => s.part.id)).toEqual(["x-1", "x-2"]);
    expect(g[0]!.joints[0]!.weldMm).toBe(10);
  });

  it("jour à droite (développé miroir) : chaque joint est celui qui relie les deux tronçons", () => {
    // Même projet que j5b, tournant à droite : la montée va vers les x décroissants des
    // développés ; un tronçon intermédiaire porte deux traits de joint.
    const text = j5bText.replace('"direction": "left"', '"direction": "right"');
    expect(text).not.toBe(j5bText);
    for (const t of [j5bText, text]) {
      const g = segmentedParts(buildModel(parseProjectText(t))).find(
        (x) => x.base === "stringer-inner-curved",
      )!;
      expect(g.segments.length).toBeGreaterThanOrEqual(3);
      for (const j of g.joints) {
        expect(FR.t(j.label)).toMatch(new RegExp(`avec ${j.to.mark}\\b`));
        // Cordon = soudure bout à bout comptée par le cœur sur le tronçon amont.
        expect(j.weldMm).toBeCloseTo(j.from.quantities["butt_weld_mm"] ?? NaN, 6);
      }
    }
  });

  it("assemblage bois (angle mural à queues) : pas de cordon de soudure", () => {
    const p: Project = createProject("quarter-left");
    const wood = ProjectSchema.parse({
      ...p,
      stair: { ...p.stair, structure: { kind: "wood-housed", params: {} } },
    });
    const groups = segmentedParts(buildModel(wood));
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) for (const j of g.joints) expect(j.weldMm).toBeNull();
  });
});
