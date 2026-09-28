import { describe, expect, it } from "vitest";
import { guardRailRegime, isRuleApplicable, resolveContexts } from "./contexts.js";
import { getRule } from "./table.js";
import { makeProject, makeStepping } from "./test-fixtures.js";

describe("régime garde-corps", () => {
  it("1988 avant le 1er juin 2025, 2024 à partir de cette date", () => {
    expect(guardRailRegime("2025-05-31")).toMatchObject({ regime: "garde_corps_1988", assumed: false });
    expect(guardRailRegime("2025-06-01")).toMatchObject({ regime: "garde_corps_2024", assumed: false });
    expect(guardRailRegime("2020-01-15T10:00:00Z").regime).toBe("garde_corps_1988");
  });
  it("sans date ou date illisible : 2024 supposé, avec une remarque", () => {
    const r = guardRailRegime(undefined);
    expect(r).toMatchObject({ regime: "garde_corps_2024", assumed: true });
    expect(r.note).toBeDefined();
    expect(guardRailRegime("demain")).toMatchObject({ regime: "garde_corps_2024", assumed: true });
  });
});

describe("résolution des contextes", () => {
  it("ajoute `tous` et le régime garde-corps déduit", () => {
    const r = resolveContexts(makeProject({ referenceDate: "2024-03-01" }).compliance);
    expect(r.active).toEqual(expect.arrayContaining(["tous", "bois_dtu", "logement_interieur", "garde_corps_1988"]));
    expect(r.active).not.toContain("garde_corps_2024");
    expect(r.derived).toContain("garde_corps_1988");
  });
  it("respecte un régime choisi explicitement", () => {
    const r = resolveContexts(makeProject({ contexts: ["bois_dtu", "garde_corps_1988"], referenceDate: "2026-01-01" }).compliance);
    expect(r.active).toContain("garde_corps_1988");
    expect(r.active).not.toContain("garde_corps_2024");
  });
  it("déduit `tournant` de la présence de marches balancées", () => {
    const s = makeStepping({ treads: { 3: { kind: "winder" } } });
    expect(resolveContexts(makeProject().compliance, s).derived).toContain("tournant");
    expect(resolveContexts(makeProject().compliance, makeStepping()).active).not.toContain("tournant");
  });
  it("signale et ignore les contextes inconnus", () => {
    const r = resolveContexts(makeProject({ contexts: ["bois_dtu", "martien"] }).compliance);
    expect(r.unknown).toEqual(["martien"]);
    expect(r.active).not.toContain("martien");
  });
});

describe("applicabilité des règles", () => {
  const act = (...c: string[]) => new Set(["tous", ...c]);
  it("contextes de destination : disjonction", () => {
    expect(isRuleApplicable(getRule("H_TOLERANCE_DTU"), act("erp_neuf"))).toBe(true);
    expect(isRuleApplicable(getRule("H_TOLERANCE_DTU"), act("industriel"))).toBe(false);
    expect(isRuleApplicable(getRule("H_CONFORT"), act())).toBe(true);
  });
  it("contextes de forme : qualifient la destination", () => {
    expect(isRuleApplicable(getRule("LF_POSITION_HELICOIDAL"), act("bois_dtu"))).toBe(false);
    expect(isRuleApplicable(getRule("LF_POSITION_HELICOIDAL"), act("bois_dtu", "helicoidal"))).toBe(true);
    expect(isRuleApplicable(getRule("G_EXT_MAX_ERP_TOURNANT"), act("tournant"))).toBe(false);
    expect(isRuleApplicable(getRule("G_EXT_MAX_ERP_TOURNANT"), act("erp_securite"))).toBe(false);
    expect(isRuleApplicable(getRule("G_EXT_MAX_ERP_TOURNANT"), act("erp_securite", "helicoidal"))).toBe(true);
    expect(isRuleApplicable(getRule("G_COLLET_MIN"), act("tournant"))).toBe(true);
    expect(isRuleApplicable(getRule("G_TOL_BALANCEE"), act("bois_dtu"))).toBe(false);
  });
});
