import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SHAPE_CONTEXTS, guardRailRegime, isRuleApplicable, resolveContexts } from "./contexts.js";
import { makeHelicalProject } from "../layout/helical-test-helpers.js";
import { buildModel } from "../pipeline/build.js";
import { RULE_CONTEXTS, RULE_TABLE, getRule, type RuleDef } from "./table.js";
import { makeProject, makeStepping } from "./test-fixtures.js";

describe("régime garde-corps", () => {
  it("1988 avant le 1er juin 2025, 2024 à partir de cette date", () => {
    expect(guardRailRegime("2025-05-31")).toMatchObject({
      regime: "garde_corps_1988",
      assumed: false,
    });
    expect(guardRailRegime("2025-06-01")).toMatchObject({
      regime: "garde_corps_2024",
      assumed: false,
    });
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
    expect(r.active).toEqual(
      expect.arrayContaining(["tous", "bois_dtu", "logement_interieur", "garde_corps_1988"]),
    );
    expect(r.active).not.toContain("garde_corps_2024");
    expect(r.derived).toContain("garde_corps_1988");
  });
  it("respecte un régime choisi explicitement", () => {
    const r = resolveContexts(
      makeProject({ contexts: ["bois_dtu", "garde_corps_1988"], referenceDate: "2026-01-01" })
        .compliance,
    );
    expect(r.active).toContain("garde_corps_1988");
    expect(r.active).not.toContain("garde_corps_2024");
  });
  it("déduit `tournant` de la présence de marches balancées", () => {
    const s = makeStepping({ treads: { 3: { kind: "winder" } } });
    expect(resolveContexts(makeProject().compliance, s).derived).toContain("tournant");
    expect(resolveContexts(makeProject().compliance, makeStepping()).active).not.toContain(
      "tournant",
    );
  });
  it("déduit `helicoidal` d'un découpage hélicoïdal (et d'aucun autre)", () => {
    const helical = { ...makeStepping(), helical: true as const };
    const r = resolveContexts(makeProject().compliance, helical);
    expect(r.active).toContain("helicoidal");
    expect(r.derived).toContain("helicoidal");
    expect(resolveContexts(makeProject().compliance, makeStepping()).active).not.toContain(
      "helicoidal",
    );
    // Déjà choisi par l'utilisateur : pas « déduit ».
    const explicit = resolveContexts(
      makeProject({ contexts: ["bois_dtu", "helicoidal"] }).compliance,
      helical,
    );
    expect(explicit.derived).not.toContain("helicoidal");
  });
  it("pipeline : hélicoïdal sans contexte `helicoidal` saisi, règles hélicoïdales évaluées", () => {
    const h = makeHelicalProject({
      outerRadius: 900,
      coreRadius: 70,
      direction: "left",
      floorToFloor: 2700,
    });
    const p = {
      ...h,
      compliance: { ...h.compliance, contexts: ["bois_dtu", "logement_interieur"] },
    };
    const m = buildModel(p);
    expect(m.compliance.contexts).toContain("helicoidal");
    expect(m.compliance.results.some((x) => x.ruleId === "H_MAX_HELICOIDAL_DTU")).toBe(true);
  });
  it("G_COLLET_MIN : écartée sur un hélicoïdal à fût central, appliquée sur un jour central (A5)", () => {
    const collet = (core: "column" | "well", coreRadius: number) => {
      const h = makeHelicalProject({
        outerRadius: 1000,
        coreRadius,
        core,
        direction: "left",
        floorToFloor: 2700,
      });
      const m = buildModel({
        ...h,
        compliance: { ...h.compliance, contexts: ["bois_dtu", "logement_interieur"] },
      });
      return { m, rs: m.compliance.results.filter((x) => x.ruleId === "G_COLLET_MIN") };
    };
    const fut = collet("column", 70);
    expect(fut.m.compliance.contexts).toContain("helicoidal_fut");
    expect(fut.rs).toEqual([]);
    // Jour central de même rayon : collet r_j·Δθ sous 100 mm, la règle s'applique.
    const jour = collet("well", 70);
    expect(jour.m.compliance.contexts).not.toContain("helicoidal_fut");
    expect(jour.rs.some((r) => r.status === "violation")).toBe(true);
    // Contexte non déduit sans tracé hélicoïdal.
    expect(
      resolveContexts(makeProject().compliance, makeStepping(), "column").active,
    ).not.toContain("helicoidal_fut");
  });
  it("helicoidal_fut déclaré à la main : ignoré (déduit seulement), G_COLLET_MIN garde son effet (revue A5)", () => {
    const h = makeHelicalProject({
      outerRadius: 1000,
      coreRadius: 70,
      core: "well",
      direction: "left",
      floorToFloor: 2700,
    });
    const m = buildModel({
      ...h,
      compliance: {
        ...h.compliance,
        contexts: ["bois_dtu", "logement_interieur", "helicoidal_fut"],
      },
    });
    expect(m.compliance.contexts).not.toContain("helicoidal_fut");
    expect(
      m.compliance.results.some((r) => r.ruleId === "G_COLLET_MIN" && r.status === "violation"),
    ).toBe(true);
    const r = resolveContexts(makeProject({ contexts: ["bois_dtu", "helicoidal_fut"] }).compliance);
    expect(r.active).not.toContain("helicoidal_fut");
    expect(r.notes.join(" ")).toMatch(/helicoidal_fut/);
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
    expect(isRuleApplicable(getRule("LF_POSITION_HELICOIDAL"), act("bois_dtu", "helicoidal"))).toBe(
      true,
    );
    expect(isRuleApplicable(getRule("G_EXT_MAX_ERP_TOURNANT"), act("tournant"))).toBe(false);
    expect(isRuleApplicable(getRule("G_EXT_MAX_ERP_TOURNANT"), act("erp_securite"))).toBe(false);
    expect(
      isRuleApplicable(getRule("G_EXT_MAX_ERP_TOURNANT"), act("erp_securite", "helicoidal")),
    ).toBe(true);
    expect(isRuleApplicable(getRule("G_COLLET_MIN"), act("tournant"))).toBe(true);
    // Contexte exclu (`contexte_exclu`) : écarte la règle même si ses contextes sont actifs.
    expect(isRuleApplicable(getRule("G_COLLET_MIN"), act("helicoidal"))).toBe(true);
    expect(
      isRuleApplicable(getRule("G_COLLET_MIN"), act("tournant", "helicoidal", "helicoidal_fut")),
    ).toBe(false);
    expect(isRuleApplicable(getRule("G_TOL_BALANCEE"), act("bois_dtu"))).toBe(false);
  });
});

describe("sémantique des listes de contextes (rules.yaml, ADR-0004)", () => {
  const rule = (contexte: string[], contexte_exclu?: string[]): RuleDef => ({
    ...getRule("H_CONFORT"),
    contexte,
    ...(contexte_exclu ? { contexte_exclu } : {}),
  });
  const act = (...c: string[]) => new Set(["tous", ...c]);

  it("contextes de forme lus dans rules.yaml (`contextes_forme`)", () => {
    expect([...SHAPE_CONTEXTS].sort()).toEqual([...RULE_TABLE.contextes_forme].sort());
    expect([...SHAPE_CONTEXTS].sort()).toEqual(["helicoidal", "helicoidal_fut", "tournant"]);
    for (const c of SHAPE_CONTEXTS) expect(RULE_CONTEXTS).toContain(c);
  });

  it("table de vérité : disjonction dans chaque groupe, conjonction entre les groupes", () => {
    // Groupe « autres » seul : disjonction.
    expect(isRuleApplicable(rule(["erp_neuf", "erp_existant"]), act("erp_existant"))).toBe(true);
    expect(isRuleApplicable(rule(["erp_neuf", "erp_existant"]), act("bois_dtu"))).toBe(false);
    // Groupe « forme » seul : disjonction.
    expect(isRuleApplicable(rule(["tournant", "helicoidal"]), act("helicoidal"))).toBe(true);
    expect(isRuleApplicable(rule(["tournant", "helicoidal"]), act("bois_dtu"))).toBe(false);
    // Les deux groupes : conjonction.
    const both = rule(["erp_securite", "tournant", "helicoidal"]);
    expect(isRuleApplicable(both, act("erp_securite", "tournant"))).toBe(true);
    expect(isRuleApplicable(both, act("erp_securite"))).toBe(false);
    expect(isRuleApplicable(both, act("tournant", "helicoidal"))).toBe(false);
    // `tous` : toujours, sauf contexte exclu.
    expect(isRuleApplicable(rule(["tous"]), act())).toBe(true);
    expect(isRuleApplicable(rule(["tous"], ["helicoidal_fut"]), act("helicoidal_fut"))).toBe(false);
  });

  it("la sémantique est écrite en tête de rules.yaml et dans ADR-0004", () => {
    const root = fileURLToPath(new URL("../../../../", import.meta.url));
    const yaml = readFileSync(root + "docs/research/rules.yaml", "utf8");
    const adr = readFileSync(root + "docs/adr/0004-moteur-de-regles.md", "utf8");
    for (const doc of [yaml, adr]) {
      expect(doc).toMatch(/DISJONCTION|disjonction/);
      expect(doc).toMatch(/CONJONCTION|conjonction/);
      expect(doc).toMatch(/contextes_forme/);
    }
  });
});
