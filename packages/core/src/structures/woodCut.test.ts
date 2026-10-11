import fc from "fast-check";
import { textMessage, translatorFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { fr, frList } from "../i18n.test-helpers.js";
import { signedArea } from "../geom2d/polygon.js";
import type { Model } from "../model/derived.js";
import type { Project } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { makeSteppingProject } from "../stepping/test-helpers.js";
import { isSimplePolygon } from "./geom.js";
import { WoodCutParamsSchema, buildWoodCut, type CutResult } from "./woodCut.js";

function cut(p: Project, params: Record<string, unknown> = {}): { m: Model; r: CutResult } {
  const project = { ...p, stair: { ...p.stair, structure: { kind: "wood-cut", params } } };
  const m = buildModel(project, { memo: false });
  const r = buildWoodCut(
    { project, layout: m.layout, stepping: m.stepping },
    WoodCutParamsSchema.parse(params),
  );
  return { m, r };
}

/** Escalier droit dans le domaine de l'exemple FCBA (H ≤ 2 700, projection ≤ 3 456 mm). */
const inDomain = makeSteppingProject({ width: 900, legs: [3200], floorToFloor: 2600 });
/** Escalier droit hors domaine (projection 3 780 mm). */
const outOfDomain = makeSteppingProject({ width: 900, legs: [3780], floorToFloor: 2700 });

describe("wood-cut (crémaillères)", () => {
  it("feuillu `auto` (D30) : tableau FCBA non exploitable, repli de 180 mm et raison (A37 (2))", () => {
    // Classe `auto` du chêne, du hêtre et du frêne : D30 (QUESTIONS A36 (1)) ; le tableau n'a que
    // les colonnes « résineux ≥ C30 » et « feuillus ≥ D40 », aucune ne couvre un bois D30 :
    // tableau déclaré non exploitable, reste de repli (QUESTIONS A37 (2), décision du
    // 2026-10-10 ; la colonne C30 lue jusque-là donnait 163 mm à 44 mm d'épaisseur).
    for (const material of ["wood-oak", "wood-beech", "wood-ash"] as const) {
      const { m, r } = cut(inDomain, { material });
      expect(m.errors).toEqual([]);
      expect(r.fcbaUnusable?.key).toBe("structure.woodCut.fcba.hardwoodD30");
      expect(r.carriages.map((c) => c.part.mark)).toEqual(["CI1", "CE1"]);
      expect(r.residual).toBe(180);
      for (const c of r.carriages) expect(c.residual).toBeCloseTo(180, 6);
      const res = m.compliance.results.filter((x) => x.ruleId === "CREMAILLERE_REGLE_MOYENS");
      expect(res.map((x) => x.status)).toEqual(["non-evaluee"]);
      // Remarque de synthèse : repli expliqué par la classe D30 (fr et en).
      const note = r.output.notes.find((n) => n.key === "structure.woodCut.summary.fallback")!;
      expect(fr(note)).toMatch(/aucune ne couvre un bois D30/);
      expect(translatorFor("en").t(note)).toMatch(/neither covers D30 timber/);
    }
  });

  it("classes C30 et D40 saisies : colonnes lues telles quelles (44 mm → 163 et 162)", () => {
    for (const [strengthClass, expected] of [
      ["C30", 163],
      ["D40", 162],
    ] as const) {
      const { m, r } = cut(inDomain, { strengthClass });
      expect(r.fcbaUnusable).toBeUndefined();
      for (const c of r.carriages) expect(c.residual).toBeCloseTo(expected, 6);
      const res = m.compliance.results.filter((x) => x.ruleId === "CREMAILLERE_REGLE_MOYENS");
      expect(res[0]!.status).toBe("ok");
      expect(res[0]!.min).toBe(expected);
    }
  });

  it("pin `auto` : colonne C30 (44 mm → 163)", () => {
    const { r } = cut(inDomain, { material: "wood-pine" });
    expect(r.fcbaUnusable).toBeUndefined();
    for (const c of r.carriages) expect(c.residual).toBeCloseTo(163, 6);
  });

  it("reste saisi trop faible : violation CREMAILLERE_REGLE_MOYENS", () => {
    const { m } = cut(inDomain, { residual: 120, strengthClass: "C30" });
    const res = m.compliance.results.filter((x) => x.ruleId === "CREMAILLERE_REGLE_MOYENS");
    expect(res.every((x) => x.status === "violation")).toBe(true);
    expect(res[0]!.measured).toBeCloseTo(120, 6);
  });

  it("feuillu `auto` (D30), reste saisi : contrôlé contre le repli de 180 mm (A38 (15))", () => {
    // Décision du 2026-10-11 (QUESTIONS A38 (15)) : sans colonne FCBA pour un bois D30, le reste
    // saisi d'une crémaillère en chêne, hêtre ou frêne (classe `auto`) est contrôlé contre le
    // reste de repli `residualFallback` (violation en dessous, comme avant A37 à 120 mm).
    const status = (residual: number | "auto", material = "wood-oak") => {
      const { m, r } = cut(inDomain, { material, residual });
      expect(r.fcbaUnusable?.key).toBe("structure.woodCut.fcba.hardwoodD30");
      return m.compliance.results.filter((x) => x.ruleId === "CREMAILLERE_REGLE_MOYENS");
    };
    const low = status(120);
    expect(low.map((x) => x.status)).toEqual(["violation", "violation"]);
    expect(low[0]!.measured).toBeCloseTo(120, 6);
    expect(low[0]!.min).toBe(180);
    expect(fr(low[0]!.message)).toMatch(
      /contrôlé contre le reste de repli 180 mm \(essence feuillue en classe automatique D30, hors tableau FCBA ; valeur à valider/,
    );
    expect(translatorFor("en").t(low[0]!.message)).toMatch(
      /checked against the fallback residual 180 mm \(hardwood in automatic class D30/,
    );
    const high = status(200, "wood-ash");
    expect(high.map((x) => x.status)).toEqual(["ok"]);
    expect(high[0]!.min).toBe(180);
    // Reste `auto` (= repli) : toujours non évalué, avec la raison D30.
    expect(status("auto").map((x) => x.status)).toEqual(["non-evaluee"]);
  });

  it("reste saisi d'un feuillu : classe saisie, pin, lamellé-collé ou hors domaine inchangés (A38 (15))", () => {
    const rule = (p: Project, params: Record<string, unknown>) =>
      cut(p, params).m.compliance.results.filter((x) => x.ruleId === "CREMAILLERE_REGLE_MOYENS");
    // Classe D40 saisie : colonne lue (162), pas le repli.
    const d40 = rule(inDomain, { material: "wood-oak", strengthClass: "D40", residual: 170 });
    expect(d40.map((x) => x.status)).toEqual(["ok"]);
    expect(d40[0]!.min).toBe(162);
    // Pin `auto` : colonne C30 (163).
    expect(rule(inDomain, { material: "wood-pine", residual: 170 })[0]!.min).toBe(163);
    // Lamellé-collé (classe inconnue) et feuillu hors domaine : non évalués.
    for (const [p, material] of [
      [inDomain, "wood-glulam"],
      [outOfDomain, "wood-oak"],
    ] as const) {
      expect(rule(p, { material, residual: 120 }).map((x) => x.status)).toEqual(["non-evaluee"]);
    }
  });

  it("feuillu `auto` plus mince que le tableau : reste saisi non évalué, comme le pin (relecture A38 (15))", () => {
    // Le repli ne remplace que la colonne D30 absente, pas le domaine d'épaisseur du tableau
    // (plus petites épaisseurs 33 mm en C30, 35 mm en D40).
    const rule = (params: Record<string, unknown>) => {
      const { m, r } = cut(inDomain, params);
      return {
        r,
        res: m.compliance.results.filter((x) => x.ruleId === "CREMAILLERE_REGLE_MOYENS"),
      };
    };
    for (const thickness of [30, 34]) {
      const oak = rule({ material: "wood-oak", thickness, residual: 200 });
      expect(oak.res.map((x) => x.status)).toEqual(["non-evaluee"]);
      const reason = fr(oak.r.fcbaUnusable);
      expect(reason).toMatch(/aucune ne couvre un bois D30/);
      expect(reason).toContain(
        `épaisseur ${thickness} mm inférieure à la plus petite épaisseur du tableau (D40)`,
      );
    }
    expect(
      rule({ material: "wood-pine", thickness: 30, residual: 200 }).res.map((x) => x.status),
    ).toEqual(["non-evaluee"]);
    // Au moins 35 mm : repli appliqué.
    expect(
      rule({ material: "wood-oak", thickness: 35, residual: 200 }).res.map((x) => x.status),
    ).toEqual(["ok"]);
  });

  it("propriété : feuillu `auto` dans le domaine, reste saisi en violation ⟺ reste < repli (A38 (15))", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("wood-oak", "wood-beech", "wood-ash"),
        fc.integer({ min: 120, max: 260 }),
        fc.integer({ min: 120, max: 260 }),
        (material, residual, residualFallback) => {
          fc.pre(Math.abs(residual - residualFallback) >= 1);
          const { m } = cut(inDomain, { material, residual, residualFallback });
          const res = m.compliance.results.filter((x) => x.ruleId === "CREMAILLERE_REGLE_MOYENS");
          expect(res.length).toBeGreaterThan(0);
          for (const x of res) {
            expect(x.status === "violation").toBe(residual < residualFallback);
            expect(x.status).not.toBe("non-evaluee");
          }
        },
      ),
      { numRuns: 15 },
    );
  });

  it("feuillu `auto` hors du domaine publié : les deux raisons sont citées (relecture A37 (2))", () => {
    const { m, r } = cut(outOfDomain, { material: "wood-oak" });
    const reason = fr(r.fcbaUnusable);
    expect(reason).toMatch(/aucune ne couvre un bois D30/);
    expect(reason).toMatch(/projection horizontale 3\d{3} mm > 3\d{3} mm/);
    expect(translatorFor("en").t(r.fcbaUnusable!)).toMatch(/horizontal projection/);
    const res = m.compliance.results.filter((x) => x.ruleId === "CREMAILLERE_REGLE_MOYENS");
    expect(res.map((x) => x.status)).toEqual(["non-evaluee"]);
    expect(r.residual).toBe(180);
  });

  it("hors du domaine publié : non évaluée, reste de repli signalé", () => {
    // Classe saisie : la raison du repli est le domaine de l'exemple, pas la classe.
    const { m, r } = cut(outOfDomain, { strengthClass: "C30" });
    expect(fr(r.fcbaUnusable)).toMatch(/projection horizontale/);
    const res = m.compliance.results.filter((x) => x.ruleId === "CREMAILLERE_REGLE_MOYENS");
    expect(res.map((x) => x.status)).toEqual(["non-evaluee"]);
    expect(r.residual).toBe(180);
    expect(frList(m.notes).join(" ")).toMatch(/repli à valider/);
    // Anglais : note de synthèse sans reste de français.
    const note = m.notes!.find((x) => x.key === "structure.woodCut.summary.fallback")!;
    const en = translatorFor("en").t(note);
    expect(en).toMatch(
      /^Cut strings: residual timber below notch 180 mm \(fallback value to be validated — FCBA table not applicable: horizontal projection 3\d{3} mm > 3\d{3} mm \(FCBA example: 2700 mm at 38°\)\)\.$/,
    );
  });

  it("classe de résistance inconnue (lamellé-collé) : non évaluée", () => {
    const { r } = cut(inDomain, { material: "wood-glulam" });
    expect(fr(r.fcbaUnusable)).toMatch(/classe de résistance/);
  });

  it("escalier tournant : erreur explicite, aucune crémaillère", () => {
    const p = makeSteppingProject({
      width: 900,
      legs: [1500, 3200],
      inner: { kind: "newel", size: 100 },
    });
    const { m } = cut(p);
    expect(frList(m.errors).join(" ")).toMatch(/tournant non supporté/);
    expect(m.parts.some((x) => x.category === "carriage")).toBe(false);
  });

  it("entailles : une par marche, fonds d'entaille alignés sur la rive basse décalée", () => {
    const { m, r } = cut(inDomain);
    const n = m.stepping.riserCount;
    for (const c of r.carriages) {
      expect(c.notches).toHaveLength(n - 1);
      const flat = c.part.flat!;
      expect(flat.reference?.kind).toBe("face");
      expect(signedArea(flat.outline.outer)).toBeGreaterThan(0);
      expect(flat.lines.some((l) => l.kind === "text" && fr(l.label) === c.part.mark)).toBe(true);
      expect(flat.lines).toContainEqual(
        expect.objectContaining({ label: textMessage(c.part.mark) }),
      );
    }
  });

  it("propriété : contour fermé, simple, d'aire > 0 ; reste mesuré = reste retenu", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2200, max: 3500 }),
        fc.integer({ min: 700, max: 1200 }),
        fc.integer({ min: 0, max: 30 }),
        fc.constantFrom("full" as const, "none" as const),
        (H, E, nosing, risers) => {
          const p = makeSteppingProject({
            width: E,
            legs: ["auto"],
            floorToFloor: H,
            treads: { nosing, risers },
          });
          const { m, r } = cut(p);
          expect(m.errors).toEqual([]);
          expect(r.carriages).toHaveLength(2);
          for (const c of r.carriages) {
            expect(c.outline.length).toBeGreaterThanOrEqual(3);
            expect(isSimplePolygon(c.outline)).toBe(true);
            expect(Math.abs(signedArea(c.outline))).toBeGreaterThan(0);
            expect(c.residual).toBeCloseTo(r.residual, 6);
            expect(c.notches).toHaveLength(m.stepping.riserCount - 1);
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});
