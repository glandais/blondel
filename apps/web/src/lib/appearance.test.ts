import { ProjectSchema, buildModel, createProject } from "@blondel/core";
import { describe, expect, it } from "vitest";
import {
  APPEARANCE_MATERIALS,
  displayedMaterial,
  familiesOf,
  paintZone,
  partFamily,
  withAppearance,
} from "./appearance.js";

describe("apparence 3D par famille de pièces", () => {
  const project = ProjectSchema.parse({
    ...createProject("quarter-left"),
    stair: {
      ...createProject("quarter-left").stair,
      structure: { kind: "wood-housed", params: {} },
    },
    guards: {},
  });
  const model = buildModel(project);
  const parts = model.parts.map((p) => ({
    partId: p.id,
    category: p.category,
    material: p.material,
  }));

  it("classe chaque pièce dans une famille, garde-corps compris", () => {
    const families = new Set(parts.map(partFamily));
    expect(families).toEqual(new Set(["treads", "structure", "guards", "handrails"]));
    expect(partFamily({ partId: "guard-outer-1-post-1", category: "post" })).toBe("guards");
    expect(partFamily({ partId: "post-1", category: "post" })).toBe("structure");
    expect(partFamily({ partId: "guard-outer-1-handrail", category: "handrail" })).toBe(
      "handrails",
    );
    expect(partFamily({ partId: "tread-3", category: "tread" })).toBe("treads");
  });

  it("zone de peinture : marches, garde-corps (mains courantes comprises), ossature", () => {
    expect(paintZone({ partId: "tread-3", category: "tread" })).toBe("treads");
    expect(paintZone({ partId: "landing-1", category: "landing" })).toBe("treads");
    expect(paintZone({ partId: "guard-outer-1-baluster-2", category: "baluster" })).toBe("guards");
    expect(paintZone({ partId: "guard-outer-1-handrail", category: "handrail" })).toBe("guards");
    expect(paintZone({ partId: "post-1", category: "post" })).toBe("structure");
    expect(paintZone({ partId: "LE1", category: "stringer" })).toBe("structure");
  });

  it("liste les familles présentes et leurs matériaux", () => {
    const f = familiesOf(parts);
    expect(f.map((x) => x.family)).toEqual(["treads", "structure", "guards", "handrails"]);
    for (const x of f) expect(x.materials.length).toBeGreaterThan(0);
  });

  it("surcharge par famille, retour au matériau du modèle", () => {
    const tread = parts.find((p) => p.category === "tread")!;
    const stringer = parts.find((p) => p.category === "stringer")!;
    let o = withAppearance({}, "treads", "wood-ash");
    expect(displayedMaterial(tread, o)).toBe("wood-ash");
    expect(displayedMaterial(stringer, o)).toBe(stringer.material);
    o = withAppearance(o, "treads", null);
    expect(o).toEqual({});
    expect(displayedMaterial(tread, o)).toBe(tread.material);
  });

  it("propose tous les matériaux du modèle", () => {
    expect(APPEARANCE_MATERIALS).toContain("wood-oak");
    expect(APPEARANCE_MATERIALS).toContain("stainless-brushed");
  });
});
