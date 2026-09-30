import { describe, expect, it } from "vitest";
import { fr } from "../../i18n.test-helpers.js";
import { computeLayout } from "../../layout/layout.js";
import type { RuleResult } from "../../model/derived.js";
import { ProjectSchema, type Project, type ProjectInput } from "../../model/project.js";
import { computeStepping } from "../../stepping/stepping.js";
import { createProject } from "../../project/presets.js";
import { makeSteppingProject } from "../../stepping/test-helpers.js";
import { evaluateCompliance } from "../engine.js";
import { GC_LOAD_HOUSING, GC_LOAD_PUBLIC } from "../params.js";
import { getRule } from "../table.js";
import { guardHeightTable, requiredGuardHeight2024 } from "./guards.js";

function project(
  guards: ProjectInput["guards"],
  opts: { width?: number; contexts?: string[]; date?: string } = {},
): Project {
  const base = makeSteppingProject({ width: opts.width ?? 900, legs: ["auto"] });
  return ProjectSchema.parse({
    ...base,
    guards,
    compliance: {
      ...base.compliance,
      ...(opts.contexts ? { contexts: opts.contexts } : {}),
      referenceDate: opts.date ?? "2026-01-01",
    },
  });
}

function evaluate(p: Project, id: string): RuleResult[] {
  const layout = computeLayout(p);
  const stepping = computeStepping(p, layout);
  // Sans `guards` dans l'entrée : analyse calculée à la demande par les évaluateurs.
  return evaluateCompliance({ project: p, layout, stepping }).results.filter(
    (r) => r.ruleId === id,
  );
}

const statuses = (rs: readonly RuleResult[]): string[] => rs.map((r) => r.status);

describe("table h(E) de GC_HAUTEUR_2024", () => {
  it("valeurs à condition (b) plafonnées à 900 mm", () => {
    const t = guardHeightTable();
    expect(t?.steps).toHaveLength(7);
    expect(t?.floorB).toBe(900);
    expect(requiredGuardHeight2024(80)).toBe(1000);
    expect(requiredGuardHeight2024(250)).toBe(1000);
    expect(requiredGuardHeight2024(275)).toBe(975);
    expect(requiredGuardHeight2024(450)).toBe(900);
    expect(requiredGuardHeight2024(480)).toBe(900); // 850 (b) → 900
    expect(requiredGuardHeight2024(600)).toBe(900); // 800 (b) → 900
  });

  it("lue dans le champ structuré `tables.h_E`, pas dans la description", () => {
    const rule = getRule("GC_HAUTEUR_2024");
    expect(rule.tables?.["h_E"]).toHaveLength(7);
    expect(rule.parametres?.["H_plancher_condition_b"]).toBe(900);
    // Charges horizontales par catégorie : champ structuré de CHARGE_GC_HORIZONTALE.
    expect(GC_LOAD_HOUSING.value).toBe(0.6);
    expect(GC_LOAD_PUBLIC.value).toBe(1);
  });
});

describe("évaluateurs garde-corps et mains courantes", () => {
  it("analyse calculée à la demande sans l'entrée `guards` du pipeline", () => {
    expect(statuses(evaluate(project({}), "MC_LOGEMENT"))).toEqual(["ok"]);
    expect(statuses(evaluate(project({}), "GC_GABARIT_T1_2024"))).toEqual(["ok"]);
  });

  it("MC_HAUTEUR (ERP) : garde-corps de 1 100 mm → main courante trop haute, localisée", () => {
    const p = project({ flight: { height: 1100 } }, { contexts: ["erp_neuf"] });
    const r = evaluate(p, "MC_HAUTEUR").filter((x) => x.status === "violation");
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]!.measured).toBeCloseTo(1100, 6);
    expect(r[0]!.location).toEqual({ kind: "part", partId: "guard-inner-1-handrail" });
  });

  it("MC_DEUX_COTES (ERP) : un seul côté équipé → violation ; deux → conforme", () => {
    const one = project(
      { flight: { outer: "wall" }, handrail: { wallSides: "none" } },
      { contexts: ["erp_neuf"] },
    );
    expect(statuses(evaluate(one, "MC_DEUX_COTES"))).toEqual(["violation"]);
    const two = project(
      { flight: { outer: "wall" }, handrail: { wallSides: "outer" } },
      { contexts: ["erp_neuf"] },
    );
    expect(statuses(evaluate(two, "MC_DEUX_COTES"))).toEqual(["ok"]);
  });

  it("MC_DEGAGEMENT_MUR : 30 mm en logement, 50 mm ailleurs", () => {
    const g = {
      flight: { outer: "wall" as const },
      handrail: { wallSides: "outer" as const, wallClearance: 40 },
    };
    const housing = project(g, { contexts: ["bois_dtu", "logement_interieur"] });
    expect(statuses(evaluate(housing, "MC_DEGAGEMENT_MUR"))).toEqual(["ok"]);
    const other = project(g, { contexts: ["bois_dtu", "erp_neuf"] });
    const r = evaluate(other, "MC_DEGAGEMENT_MUR");
    expect(statuses(r)).toEqual(["violation"]);
    expect(r[0]!.min).toBe(50);
  });

  it("LARGEUR_MC_ERP_NEUF : emmarchement diminué de l'empiètement des mains courantes murales", () => {
    const p = project(
      { flight: { inner: "wall", outer: "wall" }, handrail: { wallSides: "both" } },
      { width: 1300, contexts: ["erp_neuf"] },
    );
    const r = evaluate(p, "LARGEUR_MC_ERP_NEUF");
    // Mur au bord de l'emmarchement : Ø 42 + 50 mm de chaque côté → 1 300 − 2 × 92 = 1 116 mm.
    expect(statuses(r)).toEqual(["violation"]);
    expect(r[0]!.measured).toBeCloseTo(1116, 6);
    expect(r[0]!.location.kind).toBe("part");
  });

  it("MC_PROLONGEMENT_BHC : prolongement nul → violation aux deux extrémités", () => {
    const p = project({ handrail: { extensions: { bottom: 0, top: 0 } } });
    const r = evaluate(p, "MC_PROLONGEMENT_BHC").filter((x) => x.status === "violation");
    expect(r.length).toBe(4); // deux garde-corps (escalier droit sans mur), bas et haut
    expect(r.every((x) => x.location.kind === "part")).toBe(true);
  });

  it("GC_HAUTEUR_RAMPANT_1988 : régime 1988 par la date, hauteur sous 900 mm localisée", () => {
    const p = project({ flight: { height: 850 } }, { date: "2023-05-01" });
    const r = evaluate(p, "GC_HAUTEUR_RAMPANT_1988");
    expect(statuses(r)).toEqual(["violation", "violation"]);
    expect(evaluate(p, "GC_HAUTEUR_RAMPANT_2024")).toEqual([]);
  });

  it("CHARGE_GC_HORIZONTALE : information, jamais une violation", () => {
    const housing = evaluate(project({}), "CHARGE_GC_HORIZONTALE");
    expect(statuses(housing)).toEqual(["non-evaluee"]);
    expect(fr(housing[0]!.message)).toMatch(/0,6 kN\/m/);
    const erp = evaluate(project({}, { contexts: ["erp_neuf"] }), "CHARGE_GC_HORIZONTALE");
    expect(fr(erp[0]!.message)).toMatch(/1 kN\/m/);
  });

  it("sans section guards : règles non évaluées avec explication", () => {
    const base = makeSteppingProject({ width: 900, legs: ["auto"] });
    const layout = computeLayout(base);
    const stepping = computeStepping(base, layout);
    const r = evaluateCompliance({ project: base, layout, stepping }).results.filter((x) =>
      /^(GC_|MC_)/.test(x.ruleId),
    );
    expect(r.length).toBeGreaterThan(0);
    for (const x of r) {
      expect(x.status).toBe("non-evaluee");
      expect(fr(x.message)).toMatch(/non décrits/);
    }
  });
});

describe("GC_HAUTEUR_2024 — épaisseur E de l'élément de protection", () => {
  it("les poteaux (ponctuels) n'épaississent pas E : h(E) reste celui de la main courante", () => {
    const base = createProject("straight");
    // Poteaux de 300 mm : avec E = 300, h(E) = 975 et une trémie à 980 mm passerait à tort.
    const p = ProjectSchema.parse({
      ...base,
      guards: { posts: { size: 300 }, opening: { height: 980 } },
      compliance: { ...base.compliance, referenceDate: "2026-01-01" },
    });
    const rs = evaluate(p, "GC_HAUTEUR_2024");
    expect(rs.map((r) => [r.status, r.measured, r.min])).toEqual([["violation", 980, 1000]]);
    expect(fr(rs[0]!.message)).toMatch(/E = 42 mm/);
  });

  it("panneau plein épais : E = épaisseur du panneau", () => {
    const base = createProject("straight");
    const p = ProjectSchema.parse({
      ...base,
      guards: { infill: { kind: "panel", thickness: 320 }, opening: { height: 980 } },
      compliance: { ...base.compliance, referenceDate: "2026-01-01" },
    });
    expect(statuses(evaluate(p, "GC_HAUTEUR_2024"))).toEqual(["ok"]);
  });
});
