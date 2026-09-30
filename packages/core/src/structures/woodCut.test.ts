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
  it("dans le domaine du tableau FCBA : reste sous entaille = valeur exigée (D40, 44 mm → 162)", () => {
    const { m, r } = cut(inDomain);
    expect(m.errors).toEqual([]);
    expect(r.fcbaUnusable).toBeUndefined();
    expect(r.carriages.map((c) => c.part.mark)).toEqual(["CI1", "CE1"]);
    for (const c of r.carriages) expect(c.residual).toBeCloseTo(162, 6);
    const res = m.compliance.results.filter((x) => x.ruleId === "CREMAILLERE_REGLE_MOYENS");
    expect(res).toHaveLength(1);
    expect(res[0]!.status).toBe("ok");
    expect(res[0]!.min).toBe(162);
  });

  it("reste saisi trop faible : violation CREMAILLERE_REGLE_MOYENS", () => {
    const { m } = cut(inDomain, { residual: 120 });
    const res = m.compliance.results.filter((x) => x.ruleId === "CREMAILLERE_REGLE_MOYENS");
    expect(res.every((x) => x.status === "violation")).toBe(true);
    expect(res[0]!.measured).toBeCloseTo(120, 6);
  });

  it("hors du domaine publié : non évaluée, reste de repli signalé", () => {
    const { m, r } = cut(outOfDomain);
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
