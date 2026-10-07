import { msg, translatorFor, type MessageKey } from "@blondel/i18n";
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
import { segmentedPartName, segmentedParts } from "./joints.js";

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
    // Nom du groupe : celui du premier tronçon, tel quel.
    for (const g of groups) expect(segmentedPartName(g)).toBe(g.segments[0]!.part.name);
  });

  it("nom commun des tronçons : fondé sur la clé du nom, dans chaque langue", () => {
    const g = segmentedParts(buildModel(parseProjectText(j5bText))).find(
      (x) => x.base === "stringer-inner-curved",
    )!;
    expect(g.segments[0]!.part.name.key).toBe("structure.steelCurved.part.segment");
    const name = segmentedPartName(g);
    expect(name.key).toBe("structure.steelCurved.part.outerString");
    expect(FR.t(name)).toBe(FR.t("structure.steelCurved.part.outerString"));
    expect(FR.t(name)).not.toMatch(/tronçon/);
    const EN = translatorFor("en");
    expect(EN.t(name)).toBe(EN.t("structure.steelCurved.part.outerString"));
    expect(EN.t(name)).not.toMatch(/segment/i);
  });
});

describe("tronçons du limon central (A29)", () => {
  /** Tronçon fabriqué : développé rectangulaire portant un trait de joint. */
  const segment = (id: string, key: MessageKey, index: number): Part =>
    ({
      id,
      mark: `LC${index}`,
      name: msg(key, { index, count: 2 }),
      category: "stringer",
      quantities: {},
      flat: {
        outline: {
          outer: [
            { x: 0, y: 0 },
            { x: 1000, y: 0 },
            { x: 1000, y: 200 },
            { x: 0, y: 200 },
          ],
          holes: [],
        },
        lines: [{ kind: "joint", a: { x: 1000, y: 0 }, b: { x: 1000, y: 200 } }],
      },
    }) as unknown as Part;

  it("nom de la pièce entière pour chaque tôle du caisson et pour le tube", () => {
    const cases: [string, MessageKey, MessageKey][] = [
      ["central-tube", "structure.steelCentral.part.tube", "structure.steelCentral.part.tubeWhole"],
      [
        "central-web-left",
        "structure.steelCentral.part.webLeft",
        "structure.steelCentral.part.webLeftWhole",
      ],
      [
        "central-web-right",
        "structure.steelCentral.part.webRight",
        "structure.steelCentral.part.webRightWhole",
      ],
      [
        "central-flange-top",
        "structure.steelCentral.part.flangeTop",
        "structure.steelCentral.part.flangeTopWhole",
      ],
      [
        "central-flange-bottom",
        "structure.steelCentral.part.flangeBottom",
        "structure.steelCentral.part.flangeBottomWhole",
      ],
    ];
    for (const [base, key, whole] of cases) {
      const parts = [segment(`${base}-1`, key, 1), segment(`${base}-2`, key, 2)];
      const [g] = segmentedParts({ parts });
      expect(g!.base).toBe(base);
      expect(g!.joints).toHaveLength(1);
      expect(segmentedPartName(g!).key).toBe(whole);
    }
  });

  it("quart tournant en caisson : tronçons regroupés par tôle, nom sans « tronçon »", () => {
    const base = createProject("quarter-left");
    const p = ProjectSchema.parse({
      ...base,
      stair: {
        ...base.stair,
        structure: { kind: "steel-central", params: { section: { kind: "box" } } },
      },
    });
    const groups = segmentedParts(buildModel(p)).filter((g) => g.base.startsWith("central-"));
    for (const g of groups) {
      expect(g.segments.length).toBeGreaterThanOrEqual(2);
      expect(segmentedPartName(g).key).toMatch(/Whole$/);
    }
  });
});
