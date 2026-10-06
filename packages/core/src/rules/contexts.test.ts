import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { translatorFor } from "@blondel/i18n";
import { frList } from "../i18n.test-helpers.js";
import {
  CONTEXT_LABEL_KEYS,
  CONTEXT_SHORT_LABEL_KEYS,
  DEDUCED_ONLY_CONTEXTS,
  SHAPE_CONTEXTS,
  contextLabel,
  contextShortLabel,
  guardRailRegime,
  isRuleApplicable,
  resolveContexts,
} from "./contexts.js";
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

describe("libellés des contextes (ADR-0007)", () => {
  it("une clé par contexte de rules.yaml, français identique à la table", () => {
    expect(Object.keys(CONTEXT_LABEL_KEYS).sort()).toEqual([...RULE_CONTEXTS].sort());
    const t = translatorFor("fr");
    for (const [id, text] of Object.entries(RULE_TABLE.contextes))
      expect(t.t(contextLabel(id))).toBe(text);
  });
  it("anglais traduit ; contexte inconnu rendu par son identifiant", () => {
    const en = translatorFor("en");
    expect(en.t(contextLabel("exterieur"))).toBe("External stair");
    expect(en.t(contextLabel("tous"))).toBe("Any stair");
    expect(en.t(contextLabel("contexte_inconnu"))).toBe("contexte_inconnu");
  });
  it("libellés courts (ADR-0009, libellés unifiés) : un par contexte, distincts de l'identifiant", () => {
    expect(Object.keys(CONTEXT_SHORT_LABEL_KEYS).sort()).toEqual([...RULE_CONTEXTS].sort());
    const fr = translatorFor("fr");
    const en = translatorFor("en");
    for (const id of RULE_CONTEXTS) {
      const short = fr.t(contextShortLabel(id));
      expect(short).not.toBe(id);
      expect(short).not.toContain("_");
      expect(en.t(contextShortLabel(id))).not.toBe(id);
    }
    expect(fr.t(contextShortLabel("logement_interieur"))).toBe("Logement (intérieur)");
    expect(fr.t(contextShortLabel("bois_dtu"))).toBe("Bois (DTU 36.3)");
    expect(en.t(contextShortLabel("bois_dtu"))).toBe("Timber (DTU 36.3)");
    // Libellés courts deux à deux distincts (une case par contexte).
    const all = RULE_CONTEXTS.map((id) => fr.t(contextShortLabel(id)));
    expect(new Set(all).size).toBe(all.length);
  });
  it("libellé court d'un contexte inconnu : repli sur la description, puis l'identifiant", () => {
    expect(translatorFor("fr").t(contextShortLabel("contexte_inconnu"))).toBe("contexte_inconnu");
  });
  it("remarque de régime supposé : texte français historique, anglais traduit", () => {
    const note = guardRailRegime(undefined).note!;
    expect(frList([note])[0]).toBe(
      "Date de dépôt PC/DP ou de marché absente : régime garde-corps NF P01-012:2024 supposé.",
    );
    expect(translatorFor("en").t(note)).toMatch(/^No planning application .* assumed\.$/);
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
    expect(frList(r.notes).join(" ")).toMatch(/helicoidal_fut/);
  });
  it("déduit `limon_bois_encastre` de la structure wood-housed seulement (QUESTIONS D2)", () => {
    const compliance = makeProject({ contexts: ["erp_neuf"] }).compliance;
    const r = resolveContexts(compliance, makeStepping(), undefined, "wood-housed");
    expect(r.active).toContain("limon_bois_encastre");
    expect(r.derived).toContain("limon_bois_encastre");
    for (const k of [undefined, "none", "wood-cut", "steel-profile"])
      expect(resolveContexts(compliance, makeStepping(), undefined, k).active).not.toContain(
        "limon_bois_encastre",
      );
    // Contexte de structure, jamais saisi : une déclaration à la main est ignorée.
    const declared = resolveContexts(
      makeProject({ contexts: ["erp_neuf", "limon_bois_encastre"] }).compliance,
      makeStepping(),
      undefined,
      "wood-cut",
    );
    expect(declared.active).not.toContain("limon_bois_encastre");
    expect(frList(declared.notes).join(" ")).toMatch(/limon_bois_encastre/);
    expect(DEDUCED_ONLY_CONTEXTS.has("limon_bois_encastre")).toBe(true);
    // LIMON_ENTAILLE_MIN : bois_dtu ou limons bois encastrés.
    const entaille = getRule("LIMON_ENTAILLE_MIN");
    expect(isRuleApplicable(entaille, ["tous", "erp_neuf", "limon_bois_encastre"])).toBe(true);
    expect(isRuleApplicable(entaille, ["tous", "bois_dtu"])).toBe(true);
    expect(isRuleApplicable(entaille, ["tous", "erp_neuf"])).toBe(false);
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
