/**
 * Évaluateurs ajoutés à la vague J (QUESTIONS D2) : largeurs de passage (mains courantes
 * saillantes), unités de passage, mains courantes intermédiaires, longueur de trémie, câbles,
 * règles portées par les structures et motifs de non-évaluation.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { translatorFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { fr } from "../../i18n.test-helpers.js";
import { computeLayout } from "../../layout/layout.js";
import type { RuleResult } from "../../model/derived.js";
import { ProjectSchema, type Project, type ProjectInput } from "../../model/project.js";
import { buildModel } from "../../pipeline/build.js";
import { parseProjectText } from "../../project/index.js";
import { computeStepping } from "../../stepping/stepping.js";
import { makeSteppingProject } from "../../stepping/test-helpers.js";
import "../../structures/index.js";
import { listStructures } from "../../structures/registry.js";
import { AN_STAIR_LOADS } from "../../precheck/loads.js";
import { evaluateCompliance } from "../engine.js";
import { upCount, upWidth } from "../params.js";
import { STRUCTURE_EVALUATED_RULES } from "./structure.js";

const EXAMPLES = fileURLToPath(new URL("../../../../../examples/", import.meta.url));
const load = (f: string): Project =>
  parseProjectText(readFileSync(`${EXAMPLES}${f}.blondel.json`, "utf8"));

function project(
  guards: ProjectInput["guards"] | undefined,
  opts: { width?: number; contexts?: string[]; floorToFloor?: number } = {},
): Project {
  const base = makeSteppingProject({
    width: opts.width ?? 900,
    legs: ["auto"],
    ...(opts.floorToFloor ? { floorToFloor: opts.floorToFloor } : {}),
  });
  return ProjectSchema.parse({
    ...base,
    ...(guards ? { guards } : {}),
    compliance: {
      ...base.compliance,
      ...(opts.contexts ? { contexts: opts.contexts } : {}),
      referenceDate: "2026-01-01",
    },
  });
}

function evaluate(p: Project, id: string): RuleResult[] {
  const layout = computeLayout(p);
  const stepping = computeStepping(p, layout);
  return evaluateCompliance({ project: p, layout, stepping }).results.filter(
    (r) => r.ruleId === id,
  );
}

/** Murs imposés des deux côtés, main courante murale des deux côtés, dégagement donné. */
const walled = (wallClearance: number): ProjectInput["guards"] => ({
  flight: { inner: "wall", outer: "wall" },
  handrail: { wallSides: "both", wallClearance },
});

const ERP = ["bois_dtu", "erp_neuf", "erp_securite"];

describe("largeur de passage : mains courantes saillantes de plus de 100 mm", () => {
  it("LARGEUR_MIN_LOGEMENT : mesurée à l'aplomb des mains courantes qui saillent de plus de 100 mm", () => {
    // Ø 42 à 80 mm du mur : saillie 122 mm de chaque côté → 900 − 244 = 656 mm < 800 mm.
    const r = evaluate(project(walled(80)), "LARGEUR_MIN_LOGEMENT");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ status: "violation", min: 800 });
    expect(r[0]!.measured).toBeCloseTo(900 - 2 * (80 + 42), 6);
    expect(r[0]!.location.kind).toBe("part");
    // Saillie de 92 mm (dégagement 50) : non déduite, largeur = E.
    const ok = evaluate(project(walled(50)), "LARGEUR_MIN_LOGEMENT");
    expect(ok[0]).toMatchObject({ status: "ok", measured: 900 });
    expect(fr(ok[0]!.message)).toMatch(/aucune main courante saillante de plus de 100 mm/);
  });

  it("LARGEUR_MIN_LOGEMENT sans garde-corps décrits : emmarchement, sous réserve", () => {
    const r = evaluate(project(undefined), "LARGEUR_MIN_LOGEMENT");
    expect(r[0]).toMatchObject({ status: "ok", measured: 900 });
    expect(fr(r[0]!.message)).toMatch(/Sous réserve/);
  });

  it("LARGEUR_UP_ERP : évaluée sur la largeur de passage (non évaluée avant)", () => {
    const narrow = evaluate(project(walled(80), { width: 1000, contexts: ERP }), "LARGEUR_UP_ERP");
    expect(narrow[0]).toMatchObject({ status: "violation", min: 900 });
    expect(narrow[0]!.measured).toBeCloseTo(1000 - 2 * 122, 6);
    const wide = evaluate(project(walled(50), { width: 1400, contexts: ERP }), "LARGEUR_UP_ERP");
    expect(wide[0]).toMatchObject({ status: "ok", measured: 1400 });
    expect(fr(wide[0]!.message)).toMatch(/2 unité\(s\) de passage/);
    expect(translatorFor("en").t(wide[0]!.message)).toMatch(/Width of 2 exit units \(UP\)/);
    // Sans garde-corps : majorant E, comme avant.
    const bare = evaluate(project(undefined, { width: 1400, contexts: ERP }), "LARGEUR_UP_ERP");
    expect(bare[0]!.status).toBe("non-evaluee");
  });
});

describe("unités de passage (rules.yaml LARGEUR_UP_ERP.parametres)", () => {
  it("largeur de n UP et nombre d'UP d'une largeur", () => {
    expect([1, 2, 3, 4, 5].map(upWidth)).toEqual([900, 1400, 1800, 2400, 3000]);
    expect(
      [899, 900, 1399, 1400, 1799, 1800, 2399, 2400, 2999, 3000].map((w) => upCount(w)),
    ).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
  });
});

describe("MC_INTERMEDIAIRE_ERP (CO 55 §1)", () => {
  it("au-delà de 4 UP : mains courantes intermédiaires exigées, non modélisées", () => {
    const guards: ProjectInput["guards"] = { flight: { inner: "void", outer: "void" } };
    const big = evaluate(project(guards, { width: 3100, contexts: ERP }), "MC_INTERMEDIAIRE_ERP");
    expect(big[0]).toMatchObject({ status: "violation", measured: 5, max: 4 });
    const ok = evaluate(project(guards, { width: 1400, contexts: ERP }), "MC_INTERMEDIAIRE_ERP");
    expect(ok[0]).toMatchObject({ status: "ok", measured: 2 });
    // Garde-corps non décrits : emmarchement de 5 UP, à vérifier.
    const bare = evaluate(
      project(undefined, { width: 3100, contexts: ERP }),
      "MC_INTERMEDIAIRE_ERP",
    );
    expect(bare[0]!.status).toBe("non-evaluee");
  });
});

describe("TREMIE_LONGUEUR (dérivation géométrique, volée droite)", () => {
  it("escalier droit : longueur de trémie sur Γ comparée à (e + ep) · g / h", () => {
    const p = load("straight");
    const m = buildModel(p);
    const r = m.compliance.results.filter((x) => x.ruleId === "TREMIE_LONGUEUR");
    expect(r).toHaveLength(1);
    const { rise: h, going: g } = m.stepping;
    const required = ((1900 + p.site.upperSlabThickness) * g) / h;
    expect(r[0]).toMatchObject({ status: "ok", severity: "conseil" });
    expect(r[0]!.min).toBeCloseTo(required, 9);
    expect(r[0]!.measured!).toBeGreaterThanOrEqual(required - 1e-6);
    // Trémie raccourcie de 300 mm côté départ : conseil en violation.
    const opening = p.site.opening!;
    if (opening.kind !== "rect") throw new Error("trémie rectangulaire attendue");
    const shorter: Project = {
      ...p,
      site: { ...p.site, opening: { ...opening, y: opening.y + 300, sizeY: opening.sizeY - 300 } },
    };
    const v = buildModel(shorter).compliance.results.find((x) => x.ruleId === "TREMIE_LONGUEUR")!;
    expect(v.status).toBe("violation");
    expect(v.measured!).toBeCloseTo(r[0]!.measured! - 300, 6);
  });

  it("tournant dans la longueur utile ou hélicoïdal : non évaluée avec motif ; sans trémie : sans objet", () => {
    const turn = buildModel(load("quarter-left")).compliance.results.find(
      (x) => x.ruleId === "TREMIE_LONGUEUR",
    )!;
    expect(turn.status).toBe("non-evaluee");
    expect(fr(turn.message)).toMatch(/Tournant/);
    const helical = buildModel(load("j5a-helicoidal")).compliance.results.find(
      (x) => x.ruleId === "TREMIE_LONGUEUR",
    )!;
    expect(fr(helical.message)).toMatch(/Hélicoïdal/);
    const p = load("straight");
    const { opening: _o, ...site } = p.site;
    const none = buildModel({ ...p, site }).compliance.results.find(
      (x) => x.ruleId === "TREMIE_LONGUEUR",
    )!;
    expect(none).toMatchObject({ status: "ok" });
    expect(fr(none.message)).toMatch(/pas de trémie/);
  });
});

describe("GC_CABLES_DETENTE (rules.yaml, évaluée par le moteur)", () => {
  it("sans câbles : sans objet ; garde-corps non décrits : non évaluée", () => {
    expect(evaluate(project({}), "GC_CABLES_DETENTE")[0]).toMatchObject({ status: "ok" });
    expect(evaluate(project(undefined), "GC_CABLES_DETENTE")[0]!.status).toBe("non-evaluee");
    const cables = evaluate(project({ infill: { kind: "cables" } }), "GC_CABLES_DETENTE");
    expect(cables.length).toBeGreaterThan(0);
    expect(cables.every((r) => r.status === "violation" && r.severity === "avertissement")).toBe(
      true,
    );
    expect(cables[0]!.source).toMatch(/NF P01-012:2024/);
  });
});

describe("règles évaluées par une structure (limons et crémaillères bois)", () => {
  const result = (p: Project, id: string) =>
    buildModel(p).compliance.results.filter((r) => r.ruleId === id);

  it("aucune structure : non évaluée avec motif ; structure acier : sans objet", () => {
    for (const id of Object.keys(STRUCTURE_EVALUATED_RULES)) {
      const none = result(load("straight"), id);
      expect(
        none.map((r) => r.status),
        id,
      ).toEqual(["non-evaluee"]);
      expect(fr(none[0]!.message)).toMatch(/Aucune structure choisie/);
      const steel = result(load("demo-straight-loft"), id);
      expect(
        steel.map((r) => r.status),
        id,
      ).toEqual(["ok"]);
      expect(fr(steel[0]!.message)).toMatch(/Sans objet/);
    }
  });

  it("limons bois encastrés : résultats du plugin, pas le résultat d'attente", () => {
    const m = buildModel(load("j3a-acceptance-01-bois"));
    for (const id of ["LIMON_EPAISSEUR_MIN_DTU", "LIMON_ENTAILLE_MIN"]) {
      const rs = m.compliance.results.filter((r) => r.ruleId === id);
      expect(rs.length, id).toBeGreaterThan(0);
      for (const r of rs) expect(fr(r.message)).not.toMatch(/Contrôle porté par la structure/);
    }
    const entaille = m.compliance.results.find((r) => r.ruleId === "LIMON_ENTAILLE_MIN")!;
    expect(entaille.source).toMatch(/NF EN 16481/);
    expect(entaille.min).toBe(14);
  });

  it("toute structure bois du registre porte les contrôles de limon", () => {
    const wood = listStructures()
      .filter((s) => s.family === "bois")
      .map((s) => s.kind);
    expect(wood.length).toBeGreaterThan(0);
    for (const k of wood) expect(STRUCTURE_EVALUATED_RULES["LIMON_EPAISSEUR_MIN_DTU"]).toContain(k);
  });
});

describe("motifs de non-évaluation", () => {
  it("NEZ_CONTRASTE, BANDE_EVEIL (ERP neuf) : donnée de finition absente", () => {
    const p = project(undefined, { contexts: ERP });
    expect(fr(evaluate(p, "NEZ_CONTRASTE")[0]!.message)).toMatch(/finition/);
    expect(fr(evaluate(p, "BANDE_EVEIL")[0]!.message)).toMatch(/palier haut/);
  });

  it("HAUTEUR_ETAGE_TOLERANCE : tolérance admissible calculée (± 7 mm, puis ± 5 · H^(1/3))", () => {
    expect(fr(evaluate(project(undefined), "HAUTEUR_ETAGE_TOLERANCE")[0]!.message)).toMatch(
      /± 7 mm/,
    );
    const tall = evaluate(project(undefined, { floorToFloor: 3375 }), "HAUTEUR_ETAGE_TOLERANCE");
    expect(tall[0]!.status).toBe("non-evaluee");
    // 5 · 3,375^(1/3) = 7,5 mm.
    expect(fr(tall[0]!.message)).toMatch(/± 7,5 mm/);
  });
});

describe("charges d'exploitation lues dans rules.yaml (prédimensionnement)", () => {
  it("tableau 6.2(NF) complet, identique aux valeurs de A §3.6", () => {
    expect(AN_STAIR_LOADS).toEqual({
      A: [2.5, 2],
      B: [2.5, 4],
      C1: [2.5, 3],
      C2: [4, 4],
      C3: [4, 4],
      C4: [5, 7],
      C5: [5, 4.5],
      D1: [5, 5],
      D2: [5, 7],
    });
  });
});
