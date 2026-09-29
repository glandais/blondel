import { buildModel, createProject } from "@blondel/core";
import { describe, expect, it } from "vitest";
import {
  realign,
  WALKLINE_SIDE_HINT,
  walklineSideApplies,
  walklineSideChoice,
  withWalklineSide,
} from "./realign.js";

describe("recalage des volées et de la trémie (A18 a)", () => {
  it("H modifié : volées et trémie du préréglage, message", () => {
    const p = createProject("quarter-left");
    const edited = { ...p, site: { ...p.site, floorToFloor: 2900 } };
    const r = realign(edited);
    const expected = createProject("quarter-left", { floorToFloor: 2900 });
    expect(r.project.stair.layout.legs).toEqual(expected.stair.layout.legs);
    expect(r.project.site.opening).toEqual(expected.site.opening);
    expect(r.notice).toMatch(/Volées recalées/);
    expect(r.notice).toMatch(/Trémie recalée/);
  });

  it("hélicoïdal : refus explicite", () => {
    expect(() => realign(createProject("helical"))).toThrow(/hélicoïdal/);
  });
});

describe("bord de mesure de la ligne de foulée (A16)", () => {
  it("auto par défaut, gauche / droite imposés, retour à auto", () => {
    const s = createProject("straight");
    const p = { ...s, stair: { ...s.stair, layout: { ...s.stair.layout, width: 1400 } } };
    expect(walklineSideApplies(p)).toBe(true);
    expect(walklineSideChoice(p)).toBe("auto");
    const right = withWalklineSide(p, "right");
    expect(right.stair.walkline).toEqual({ mode: "dtu", side: "right" });
    expect(buildModel(right).layout.walklineSide).toBe("right");
    const back = withWalklineSide(right, "auto");
    expect(back.stair.walkline).toEqual({ mode: "dtu" });
    expect(walklineSideApplies(createProject("quarter-left"))).toBe(false);
  });
});

describe("aide du bord de mesure (relecture adverse)", () => {
  it("aucun seuil en dur : ni 600 mm ni 1 200 mm recopiés de rules.yaml", () => {
    expect(WALKLINE_SIDE_HINT).not.toMatch(/\d/);
    expect(WALKLINE_SIDE_HINT).toMatch(/main courante principale/);
  });
});
