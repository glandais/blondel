import { translatorFor } from "@blondel/i18n";
import { createProject, suggestFixes, buildModel } from "@blondel/core";
import { describe, expect, it } from "vitest";
import { chooseStructure } from "./structureChoice.js";

const FR = translatorFor("fr");

describe("changement de structure (décisions A4 et A13)", () => {
  it("limons à la française sur le quart tournant : jour vif → poteau de 100 mm, message", () => {
    const p = createProject("quarter-left");
    const c = chooseStructure(p, "wood-housed", {});
    expect(c.project.stair.structure.kind).toBe("wood-housed");
    expect(c.project.stair.layout.turns[0]!.inner).toEqual({ kind: "newel", size: 100 });
    expect(FR.t(c.notice!)).toMatch(/jour vif → poteau de 100 mm/);
    const m = buildModel(c.project);
    expect(m.errors).toEqual([]);
    expect(suggestFixes(c.project, m).map((f) => f.id)).not.toContain("jour-newel");
  });

  it("sans structure : jour vif conservé, aucun message", () => {
    const p = createProject("quarter-left");
    const c = chooseStructure(p, "none", {});
    expect(c.project.stair.layout).toEqual(p.stair.layout);
    expect(c.notice).toBeNull();
  });

  it("profilés : poteau élargi décalé vers le jour", () => {
    const c = chooseStructure(createProject("quarter-left"), "steel-profile", { family: "UPN" });
    const inner = c.project.stair.layout.turns[0]!.inner;
    expect(inner.kind === "newel" && (inner.offset ?? 0) > 0).toBe(true);
    expect(FR.t(c.notice!)).toMatch(/décalé de \d+ mm vers le jour/);
  });
});
