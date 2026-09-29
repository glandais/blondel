import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isRuleApplicable, resolveContexts } from "./contexts.js";
import { DEFAULT_EVALUATORS, createRegistry } from "./evaluators/index.js";
import {
  effectiveSeverity,
  evaluateCompliance,
  evaluateComplianceDetailed,
  ruleCoverage,
} from "./engine.js";
import { FORMULA_CONSTANTS } from "./formula-constants.js";
import { RULES, RULES_VERSION, findRule, getRule } from "./table.js";
import { makeInput, makeProject } from "./test-fixtures.js";

describe("moteur de conformité", () => {
  it("escalier droit courant (bois, logement) : aucune violation bloquante", () => {
    const report = evaluateCompliance(makeInput());
    expect(report.rulesVersion).toBe(RULES_VERSION);
    expect(report.profile).toBe("strict");
    expect(report.summary.bloquant).toBe(0);
    // 2 × 170 + 250 = 590 < 600 : hors zone de confort (conseil).
    const confort = report.results.find((r) => r.ruleId === "BLONDEL_CONFORT");
    expect(confort).toMatchObject({ status: "violation", severity: "conseil", measured: 590 });
  });

  it("chaque règle applicable apparaît au moins une fois (traçabilité)", () => {
    const input = makeInput();
    const report = evaluateCompliance(input);
    const active = new Set(resolveContexts(input.project.compliance, input.stepping).active);
    const expected = RULES.filter((r) => isRuleApplicable(r, active)).map((r) => r.id);
    expect(new Set(report.results.map((r) => r.ruleId))).toEqual(new Set(expected));
  });

  it("règle applicable sans évaluateur : non-evaluee", () => {
    const report = evaluateCompliance(makeInput());
    const r = report.results.find((x) => x.ruleId === "CHARGE_ESCALIER_A");
    expect(r?.status).toBe("non-evaluee");
    expect(r?.message).toMatch(/sans évaluateur/);
  });

  it("un évaluateur qui lève une erreur donne non-evaluee", () => {
    const reg = createRegistry({
      H_CONFORT: () => {
        throw new Error("boum");
      },
    });
    const r = evaluateCompliance(makeInput(), reg).results.find((x) => x.ruleId === "H_CONFORT");
    expect(r?.status).toBe("non-evaluee");
    expect(r?.message).toContain("boum");
  });

  it("registre : identifiant en double refusé", () => {
    const ev = () => [];
    expect(() => createRegistry({ A: ev }, { A: ev })).toThrow();
  });

  it("profil souple : bloquant + source secondaire → avertissement tracé", () => {
    const strict = evaluateCompliance(makeInput({ stepping: { going: 180 } }));
    const souple = evaluateCompliance(
      makeInput({ project: { profile: "souple" }, stepping: { going: 180 } }),
    );
    const gs = strict.results.find((r) => r.ruleId === "G_MIN_DTU" && r.status === "violation");
    const gl = souple.results.find((r) => r.ruleId === "G_MIN_DTU" && r.status === "violation");
    expect(gs?.severity).toBe("bloquant");
    expect(gl?.severity).toBe("avertissement");
    expect(gl?.declaredSeverity).toBe("bloquant");
    expect(gl?.downgradeReason).toMatch(/souple/);
    // Règle réglementaire (source primaire) : inchangée en profil souple.
    const gLog = souple.results.find(
      (r) => r.ruleId === "G_MIN_LOGEMENT" && r.status === "violation",
    );
    expect(gLog?.severity).toBe("bloquant");
  });

  it("surcharges utilisateur : justification obligatoire, `ignore` sort la règle des violations", () => {
    const base = { stepping: { going: 180 } };
    const input = makeInput({
      ...base,
      project: {
        overrides: [
          {
            ruleId: "G_MIN_LOGEMENT",
            severity: "ignore",
            justification: "Escalier secondaire de service",
          },
          { ruleId: "G_MIN_DTU", severity: "conseil", justification: "   " },
        ],
      },
    });
    const report = evaluateCompliance(input);
    const ignored = report.results.filter((r) => r.ruleId === "G_MIN_LOGEMENT");
    expect(ignored.every((r) => r.status === "non-evaluee")).toBe(true);
    expect(ignored[0]?.downgradeReason).toMatch(/Escalier secondaire/);
    const dtu = report.results.find((r) => r.ruleId === "G_MIN_DTU" && r.status === "violation");
    expect(dtu?.severity).toBe("bloquant");

    const eff = effectiveSeverity(
      getRule("G_MIN_DTU"),
      makeProject({
        overrides: [
          { ruleId: "G_MIN_DTU", severity: "avertissement", justification: "Validé par le BET" },
        ],
      }).compliance,
    );
    expect(eff).toMatchObject({ severity: "avertissement", ignored: false });
    expect(eff.downgradeReason).toMatch(/BET/);
  });

  it("sévérité propre au constat : une surcharge qui assouplit la règle ne la relève pas (revue A10)", () => {
    const settings = (severity: "avertissement" | "bloquant") =>
      makeProject({
        overrides: [{ ruleId: "GC_OBLIGATOIRE", severity, justification: "Avis du BET" }],
      }).compliance;
    const finding = { severity: "conseil" as const, severityReason: "Jour étroit" };
    // Surcharge « avertissement » (plus faible que « bloquant » déclaré) : le constat reste conseil.
    expect(
      effectiveSeverity(getRule("GC_OBLIGATOIRE"), settings("avertissement"), finding).severity,
    ).toBe("conseil");
    // Sans constat propre, la surcharge s'applique.
    expect(effectiveSeverity(getRule("GC_OBLIGATOIRE"), settings("avertissement")).severity).toBe(
      "avertissement",
    );
  });

  it("remarques : surcharges inopérantes (règle inconnue, justification vide)", () => {
    const e = evaluateComplianceDetailed(
      makeInput({
        project: {
          overrides: [
            { ruleId: "REGLE_FANTOME", severity: "ignore", justification: "test" },
            { ruleId: "G_MIN_DTU", severity: "conseil", justification: "  " },
          ],
        },
      }),
    );
    const notes = e.notes.join(" ");
    expect(notes).toMatch(/REGLE_FANTOME/);
    expect(notes).toMatch(/G_MIN_DTU : justification vide/);
  });

  it("remarques : régime supposé, contexte déduit, version de règles différente", () => {
    const e = evaluateComplianceDetailed(
      makeInput({
        project: { rulesVersion: RULES_VERSION + 1 },
        stepping: { treads: { 4: { kind: "winder" } } },
      }),
    );
    expect(e.report.contexts).toContain("tournant");
    expect(e.notes.join(" ")).toMatch(/2024 supposé/);
    expect(e.notes.join(" ")).toMatch(/tournant/);
    expect(e.notes.join(" ")).toMatch(/v2/);
  });

  it("propriété : la synthèse compte les violations par sévérité effective ; toute règle applicable est tracée", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2000, max: 4000 }),
        fc.integer({ min: 10, max: 22 }),
        fc.integer({ min: 150, max: 320 }),
        fc.integer({ min: 600, max: 1600 }),
        fc.subarray([
          "bois_dtu",
          "logement_interieur",
          "bhc_parties_communes",
          "erp_neuf",
          "erp_securite",
          "industriel",
          "echelle_meunier",
        ]),
        fc.constantFrom<"strict" | "souple">("strict", "souple"),
        (H, n, g, E, contexts, profile) => {
          const input = makeInput({
            project: { floorToFloor: H, width: E, contexts, profile },
            stepping: { riserCount: n, going: g },
          });
          const report = evaluateCompliance(input);
          const count = { bloquant: 0, avertissement: 0, conseil: 0 };
          for (const r of report.results) if (r.status === "violation") count[r.severity]++;
          expect(report.summary).toEqual(count);
          const active = new Set(report.contexts);
          for (const rule of RULES) {
            const present = report.results.some((r) => r.ruleId === rule.id);
            expect(present).toBe(isRuleApplicable(rule, active));
          }
          for (const r of report.results) {
            if (profile === "strict") expect(r.severity).toBe(r.declaredSeverity);
            if (r.status === "violation") expect(r.message.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("couverture des règles", () => {
  it("chaque évaluateur correspond à une règle de la table", () => {
    for (const id of DEFAULT_EVALUATORS.keys()) expect(findRule(id), id).toBeDefined();
  });

  it("liste implémentées / non implémentées", () => {
    const cov = ruleCoverage();
    expect(cov.implemented.length + cov.notImplemented.length).toBe(RULES.length);
    expect(cov.implemented).toEqual(
      expect.arrayContaining(["BLONDEL_DTU", "H_MAX_LOGEMENT", "G_COLLET_MIN", "ECHAPPEE_MIN_DTU"]),
    );
    // Garde-corps et mains courantes : jalon 4 (analyse de l'étape « garde-corps »).
    expect(cov.implemented).toEqual(
      expect.arrayContaining(["GC_HAUTEUR_2024", "GC_GABARIT_B_2024", "MC_HAUTEUR"]),
    );
    // Charges d'exploitation des escaliers : prédimensionnement (J3c).
    expect(cov.notImplemented).toEqual(expect.arrayContaining(["CHARGE_ESCALIER_A"]));
  });

  it("les constantes extraites des formules y figurent toujours", () => {
    for (const c of FORMULA_CONSTANTS) {
      expect(getRule(c.ruleId).formule).toContain(c.excerpt);
      expect(c.excerpt).toContain(String(c.value));
    }
    // G_BALANCE_VS_DROITE réutilise la tolérance de G_TOL_BALANCEE.
    expect(getRule("G_BALANCE_VS_DROITE").formule).toContain(
      `g_nom - ${-(getRule("G_TOL_BALANCEE").min ?? 0)}`,
    );
  });
});
