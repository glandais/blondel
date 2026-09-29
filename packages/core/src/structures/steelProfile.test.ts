import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { findSection, sectionsOf } from "../catalog/sections.js";
import { signedArea } from "../geom2d/polygon.js";
import type { Model, RuleResult } from "../model/derived.js";
import type { Project } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { analyzeInclinedBeam, passesPrecheck } from "../precheck/beam.js";
import { PRECHECK_LABEL } from "../precheck/checks.js";
import { stairLoads } from "../precheck/loads.js";
import { DEFAULT_PRECHECK_SETTINGS, steelMaterialOf } from "../precheck/settings.js";
import { parseProjectText } from "../project/parse.js";
import { applyStructureChoice } from "../project/structureChoice.js";
import { makeSteppingProject } from "../stepping/test-helpers.js";
import { QUANTITY_MASS_KG } from "./quantities.js";
import { getStructure } from "./registry.js";
import {
  SteelProfileParamsSchema,
  buildSteelProfile,
  lightestSection,
  profileFlangeWidth,
  profileNewel,
  profileNewelFits,
  type SteelProfileResult,
} from "./steelProfile.js";
import { cuttingPlan } from "./steelProfileCutting.js";
import "./index.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const loadExample = (file: string): Project =>
  parseProjectText(readFileSync(join(EXAMPLES_DIR, file), "utf8"));

function profiled(p: Project, params: Record<string, unknown> = {}): Project {
  return { ...p, stair: { ...p.stair, structure: { kind: "steel-profile", params } } };
}

function run(project: Project): { m: Model; r: SteelProfileResult } {
  const m = buildModel(project, { memo: false });
  const params = SteelProfileParamsSchema.parse(project.stair.structure.params);
  const r = buildSteelProfile({ project, layout: m.layout, stepping: m.stepping }, params);
  return { m, r };
}

const results = (m: Model, id: string): RuleResult[] =>
  m.compliance.results.filter((x) => x.ruleId === id);

/** Escalier droit de n hauteurs de 175 mm, giron 280 mm (portée proportionnelle à n). */
function straight(n: number, params: Record<string, unknown> = {}): Project {
  return profiled(
    makeSteppingProject({
      width: 900,
      legs: ["auto"],
      floorToFloor: 175 * n,
      stepping: { riserCount: n, targetRise: 175, targetGoing: 280 },
    }),
    params,
  );
}

describe("steel-profile — registre et paramètres", () => {
  it("plugin métal enregistré, défauts valides, section hors catalogue refusée", () => {
    expect(getStructure("steel-profile")?.family).toBe("metal");
    expect(SteelProfileParamsSchema.parse({})).toMatchObject({
      family: "UPN",
      section: "auto",
      grade: "S235",
    });
    expect(SteelProfileParamsSchema.safeParse({ section: "UPN 999" }).success).toBe(false);
    const m = buildModel(straight(15, { section: "UPN 999" }), { memo: false });
    expect(m.errors.join(" ")).toMatch(/paramètres invalides/);
  });
});

describe("steel-profile — escalier droit", () => {
  const { m, r } = run(straight(15));

  it("section automatique : la plus légère UPN qui loge les supports et passe le prédimensionnement", () => {
    expect(m.errors).toEqual([]);
    const s = r.section!;
    expect(s.family).toBe("UPN");
    expect(s.h).toBeGreaterThanOrEqual(r.requiredHeight - 1e-6);
    const lighter = sectionsOf("UPN").filter((x) => x.massPerMeter < s.massPerMeter);
    // Toute section plus légère échoue à la hauteur d'âme ou au prédimensionnement.
    for (const x of lighter) {
      const fails =
        x.h < r.requiredHeight - 1e-6 ||
        r.stringers.some(
          (st) =>
            !passesPrecheck(
              analyzeInclinedBeam({
                spanH: st.uHi - st.uLo,
                slope: st.line.slope,
                section: { area: x.area, i: x.iy, w: x.wy },
                material: steelMaterialOf("S235", DEFAULT_PRECHECK_SETTINGS, 7850),
                tributaryWidth: 450,
                permanentArea: 0,
                loads: stairLoads(DEFAULT_PRECHECK_SETTINGS, ["logement_interieur"]),
                settings: DEFAULT_PRECHECK_SETTINGS,
              }),
            ),
        );
      expect(fails, x.name).toBe(true);
    }
  });

  it("deux limons, âme verticale : développé = barre de hauteur h, coupes d'extrémité", () => {
    expect(r.stringers.map((s) => s.part.id).sort()).toEqual([
      "stringer-inner-1",
      "stringer-outer-1",
    ]);
    const s = r.section!;
    for (const st of r.stringers) {
      const f = st.part.flat!;
      expect(signedArea(f.outline.outer)).toBeGreaterThan(0);
      const ys = f.outline.outer.map((p) => p.y);
      expect(Math.min(...ys)).toBeCloseTo(0, 6);
      expect(Math.max(...ys)).toBeCloseTo(s.h, 6);
      const xs = f.outline.outer.map((p) => p.x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(st.cutLength, 6);
      // Départ au sol : coupe de niveau + coupe d'aplomb (5 sommets), arrivée d'aplomb.
      expect(f.outline.outer.length).toBe(5);
      const joints = f.lines.filter((l) => l.kind === "joint").map((l) => l.label);
      expect(joints.some((l) => /coupe de niveau/.test(l!))).toBe(true);
      expect(joints.some((l) => /Arrivée : coupe d'aplomb/.test(l!))).toBe(true);
      expect(st.part.section).toBe(`${s.name} (S235)`);
      expect(st.part.stock).toMatchObject({ width: s.h, thickness: s.b });
      // Masse = A × L × 7 850 ≈ masse linéique du catalogue × L.
      const mass = st.part.quantities[QUANTITY_MASS_KG]!;
      expect(Math.abs(mass - (s.massPerMeter * st.cutLength) / 1000) / mass).toBeLessThan(0.01);
    }
  });

  it("supports dans l'âme, marches portées des deux côtés, classe EXC1", () => {
    expect(r.supports.length).toBe(2 * m.stepping.treads.length);
    for (const x of results(m, "FAB_SUPPORT_DANS_LIMON")) expect(x.status).toBe("ok");
    for (const x of results(m, "FAB_MARCHE_PORTEE")) expect(x.status).toBe("ok");
    expect(r.executionClass).toBe("EXC1");
    expect(results(m, "EXC_CLASSE_EXECUTION")[0]!.message).toMatch(/EXC1/);
  });

  it("prédimensionnement dans le contrôle de conception, libellé « indicatif »", () => {
    for (const id of ["PRECHECK_FLECHE", "PRECHECK_CONTRAINTE", "PRECHECK_FREQUENCE"]) {
      const list = results(m, id);
      expect(list.length, id).toBe(2);
      for (const x of list) {
        expect(x.description).toContain(PRECHECK_LABEL);
        expect(x.message).toContain(PRECHECK_LABEL);
        expect(x.status).toBe("ok");
      }
    }
    expect(results(m, "PRECHECK_FLECHE")[0]!.severity).toBe("bloquant");
    expect(results(m, "PRECHECK_FLECHE_CONSEIL")[0]!.severity).toBe("conseil");
  });

  it("débit sur barres de 6 / 12 m : chaque limon placé une fois", () => {
    const plan = r.cutting[r.section!.name]!;
    const ids = plan.bars.flatMap((b) => b.pieces.map((p) => p.id)).sort();
    expect(ids).toEqual(["stringer-inner-1", "stringer-outer-1"]);
    for (const b of plan.bars) expect([6000, 12000]).toContain(b.barLength);
  });

  it("section imposée trop faible : violations bloquantes du prédimensionnement", () => {
    const { m: weak } = run(straight(15, { section: "IPE 80" }));
    const bad = weak.compliance.results.filter(
      (x) => x.ruleId.startsWith("PRECHECK_") && x.status === "violation",
    );
    expect(bad.some((x) => x.severity === "bloquant")).toBe(true);
  });

  it("S355 ⇒ EXC2 ; profilé en I : appui des cornières au-delà des ailes contrôlé", () => {
    const { r: s355 } = run(straight(15, { grade: "S355" }));
    expect(s355.executionClass).toBe("EXC2");
    const { m: ipe, r: ri } = run(straight(15, { family: "IPE" }));
    expect(ri.section!.family).toBe("IPE");
    const bearing = results(ipe, "FAB_SUPPORT_DEBORD");
    expect(bearing.length).toBeGreaterThan(0);
    // Cornière de 40 mm, débord des ailes (b − t_w)/2 : appui < 20 mm ⇒ avertissement.
    expect(bearing.some((x) => x.status === "violation")).toBe(true);
  });
});

describe("steel-profile — choix automatique monotone avec la portée", () => {
  it("propriété (plugin) : n1 < n2 hauteurs ⇒ section de masse ≤", () => {
    fc.assert(
      fc.property(fc.integer({ min: 8, max: 20 }), fc.integer({ min: 1, max: 6 }), (n, dn) => {
        const a = run(straight(n, { family: "IPE" })).r.section!;
        const b = run(straight(n + dn, { family: "IPE" })).r.section!;
        return a.massPerMeter <= b.massPerMeter;
      }),
      { numRuns: 15 },
    );
  });

  it("propriété (prédimensionnement seul) : portée croissante ⇒ section ≥, et elle grossit", () => {
    const pick = (span: number) =>
      lightestSection(sectionsOf("IPE"), (s) =>
        passesPrecheck(
          analyzeInclinedBeam({
            spanH: span,
            slope: 0.65,
            section: { area: s.area, i: s.iy, w: s.wy },
            material: steelMaterialOf("S235", DEFAULT_PRECHECK_SETTINGS, 7850),
            tributaryWidth: 450,
            permanentArea: 0.5,
            loads: stairLoads(DEFAULT_PRECHECK_SETTINGS, ["logement_interieur"]),
            settings: DEFAULT_PRECHECK_SETTINGS,
          }),
        ),
      );
    fc.assert(
      fc.property(
        fc.integer({ min: 1000, max: 9000 }),
        fc.integer({ min: 1, max: 3000 }),
        (span, extra) => {
          const a = pick(span);
          const b = pick(span + extra);
          if (!a) return b === null;
          return b === null || a.massPerMeter <= b.massPerMeter;
        },
      ),
    );
    expect(pick(8000)!.massPerMeter).toBeGreaterThan(pick(2000)!.massPerMeter);
  });
});

describe("steel-profile — tournants", () => {
  it("quart tournant à poteau (cas n° 1) : limons, poteau tube, pas d'exception", () => {
    const { m, r } = run(profiled(loadExample("acceptance-01-quart-tournant.blondel.json")));
    expect(r.stringers.length).toBe(4);
    expect(r.posts.map((p) => p.id)).toEqual(["post-1"]);
    expect(m.parts.some((p) => p.id === "post-1")).toBe(true);
    // Onglet de l'angle mural absent (jour à poteau : pas d'angle entre limons de jour).
    expect(results(m, "FAB_POTEAU_RECEPTION").length).toBeGreaterThan(0);
  });

  const arc = (radius: number): Project =>
    profiled(
      makeSteppingProject({
        width: 900,
        legs: [2200, 3000],
        inner: { kind: "arc", radius },
      }),
    );

  it("jour en arc à petit rayon : limon de jour UPN exclu (C-M-06, 650 mm aile intérieure)", () => {
    const { m, r } = run(arc(300));
    const bend = results(m, "FAB_CINTRAGE_PROFILE");
    expect(bend.length).toBe(1);
    expect(bend[0]!.status).toBe("violation");
    expect(bend[0]!.severity).toBe("bloquant");
    expect(bend[0]!.min).toBe(650);
    expect(r.stringers.every((s) => s.face.side === "outer")).toBe(true);
    expect(m.errors.join(" ")).toMatch(/jour en arc/);
  });

  it("jour en arc de grand rayon : cintrage possible, limon cintré non généré (jalon 5)", () => {
    const { m } = run(arc(700));
    const bend = results(m, "FAB_CINTRAGE_PROFILE");
    expect(bend[0]!.status).toBe("ok");
    expect(bend[0]!.message).toMatch(/hélicoïdal/);
  });

  it("angle mural en onglet, profilé en I : l'âme du développé dépasse l'angle de (b − t_w)/2", () => {
    const project = profiled(loadExample("quarter-left.blondel.json"), { family: "IPE" });
    const { r } = run(project);
    const s = r.section!;
    const shift = (s.b - s.tw) / 2;
    const corners = r.stringers.filter((x) => x.face.start === "corner" || x.face.end === "corner");
    expect(corners.length).toBe(2);
    for (const st of corners) {
      const c = Math.cos(Math.atan(st.line.slope));
      const ends = (st.face.start === "corner" ? 1 : 0) + (st.face.end === "corner" ? 1 : 0);
      const pts = st.part.flat!.outline.outer;
      // Rive haute (y = h) : longueur d'axe entre coupes d'aplomb.
      const topXs = pts.filter((q) => Math.abs(q.y - s.h) < 1e-6).map((q) => q.x);
      const topLen = Math.max(...topXs) - Math.min(...topXs);
      expect(topLen * c).toBeCloseTo(st.uHi - st.uLo + ends * shift, 6);
      // Débit : + b en plan par onglet depuis la face côté marches.
      const xs = pts.map((q) => q.x);
      const extent = Math.max(...xs) - Math.min(...xs);
      expect(st.cutLength).toBeCloseTo(extent + (ends * (s.b - shift)) / c, 6);
    }
  });

  it("cordon d'onglet : rives d'aplomb h / cos α, transversales × √2", () => {
    const { r } = run(profiled(loadExample("quarter-left.blondel.json")));
    const s = r.section!;
    const st = r.stringers.find((x) => x.face.start === "corner")!;
    const c = Math.cos(Math.atan(st.line.slope));
    // UPN : périmètre = 2h + 4b − 2t_w.
    const expected = (2 * s.h) / c + (4 * s.b - 2 * s.tw) * Math.SQRT2;
    expect(st.part.quantities["weld_mm"]).toBeCloseTo(expected, 6);
  });

  it("jour à angle vif : erreur explicite, limons muraux générés", () => {
    const { m, r } = run(profiled(loadExample("quarter-left.blondel.json")));
    expect(m.errors.join(" ")).toMatch(/angle vif/);
    expect(r.stringers.length).toBe(2);
    const miter = results(m, "FAB_ONGLET_RACCORD");
    expect(miter.length).toBe(1);
    // Tolérance d'onglet : paramètre du plugin (à valider), pas une constante.
    expect(miter[0]!.max).toBe(1);
    const gap = miter[0]!.measured!;
    const { m: loose } = run(
      profiled(loadExample("quarter-left.blondel.json"), { miterTolerance: Math.ceil(gap) + 1 }),
    );
    expect(results(loose, "FAB_ONGLET_RACCORD")[0]!.status).toBe("ok");
  });
});

describe("steel-profile — poteau élargi des profilés (décision A13)", () => {
  it("auto : aile + 2 × jeu, décalé vers le jour ; côté imposé ; défauts du plugin", () => {
    const d = SteelProfileParamsSchema.parse({});
    expect(d.newel.size).toBe("auto");
    expect(d.newel.clearance).toBe(20);
    // UPN 160 : b = 65 → 105 mm, δ = ⌈52,5 − 20⌉ = 33 (débord côté marches 19,5 mm).
    expect(profileNewel(65, d.newel)).toEqual({ kind: "newel", size: 105, offset: 33 });
    expect(profileNewel(90, d.newel)).toEqual({ kind: "newel", size: 130, offset: 45 });
    expect(profileNewel(65, { size: 160, clearance: 20 })).toEqual({
      kind: "newel",
      size: 160,
      offset: 60,
    });
    // Côté imposé plus petit que 2 × jeu : poteau centré.
    expect(profileNewel(65, { size: 30, clearance: 20 })).toEqual({
      kind: "newel",
      size: 30,
      offset: 0,
    });
  });

  it("propriété : le poteau auto reçoit l'aile avec le jeu côté jour et n'entame les marches que du jeu", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 30, max: 320 }),
        fc.integer({ min: 1, max: 60 }),
        (b, clearance) => {
          const n = profileNewel(b, { size: "auto", clearance });
          const setback = n.size / 2 + n.offset;
          const protrusion = n.size / 2 - n.offset;
          return (
            Number.isInteger(n.size) &&
            Number.isInteger(n.offset) &&
            n.offset < n.size / 2 &&
            setback >= b + clearance - 1e-9 &&
            protrusion > 0 &&
            protrusion <= clearance + 0.5 + 1e-9 &&
            profileNewelFits(n, b, { size: "auto", clearance }) &&
            // Un poteau posé pour une aile plus large convient encore (pas d'aller-retour).
            profileNewelFits(n, b - 5, { size: "auto", clearance })
          );
        },
      ),
    );
  });

  it("cas n° 1 (j3c) : poteau élargi, limons de jour reçus (FAB_POTEAU_RECEPTION), UPN qui passe", () => {
    const project = loadExample("j3c-acceptance-01-upn.blondel.json");
    expect(project.stair.layout.turns[0]!.inner).toEqual({ kind: "newel", size: 125, offset: 43 });
    const { m, r } = run(project);
    expect(m.errors).toEqual([]);
    // Prédimensionnement indicatif et hauteur d'âme : UPN 240 (la hauteur nécessaire pour loger
    // les cornières sous la corde du limon mural LE2 est la contrainte déterminante).
    expect(r.section!.name).toBe("UPN 240");
    expect(r.stringers.every((x) => passesPrecheck(x.precheck))).toBe(true);
    const reception = results(m, "FAB_POTEAU_RECEPTION");
    expect(reception.length).toBeGreaterThan(0);
    expect(reception.every((x) => x.status === "ok")).toBe(true);
    // Limons de jour reçus en barre droite contre le poteau, coupe d'aplomb.
    const inner = r.stringers.filter((x) => x.face.side === "inner");
    expect(inner.map((x) => [x.face.start, x.face.end])).toEqual([
      ["floor", "newel"],
      ["newel", "arrival"],
    ]);
    for (const x of inner) {
      expect(x.part.flat!.lines.some((l) => /contre le poteau/.test(l.label ?? ""))).toBe(true);
    }
    // Tube 125 × 125 centré en K − 43·(n + u).
    expect(r.posts[0]!.section).toBe("tube carré 125 × 125 × 4");
    expect(m.notes?.some((n) => /poteau des profilés attendu/.test(n)) ?? false).toBe(false);
    expect(profileFlangeWidth(m.parts)).toBe(85);
  });

  it("cas n° 1 : poteau résolu = aile de la section qu'il produit + 2 × jeu (point fixe exact)", () => {
    // Revue : la résolution s'arrêtait sur 130 mm (aile de l'UPN 260 obtenu avec le poteau de
    // 100 mm) alors que ce poteau donne un UPN 240 (aile 85 → 125 mm), qui passe aussi avec
    // 125 mm : le côté n'était pas « aile de la section retenue + 2 × 20 ».
    const base = loadExample("acceptance-01-quart-tournant.blondel.json");
    const { project } = applyStructureChoice(base, "steel-profile", { family: "UPN" });
    const inner = project.stair.layout.turns[0]!.inner;
    const m = buildModel(project);
    const b = profileFlangeWidth(m.parts)!;
    expect(b).toBe(85);
    expect(inner).toEqual(profileNewel(b, { size: "auto", clearance: 20 }));
    expect(inner).toEqual({ kind: "newel", size: 125, offset: 43 });
    expect(m.errors).toEqual([]);
  });

  it("poteau de 100 mm centré : FAB_POTEAU_RECEPTION en violation, poteau attendu signalé", () => {
    const base = loadExample("j3c-acceptance-01-upn.blondel.json");
    const project: Project = {
      ...base,
      stair: {
        ...base.stair,
        layout: {
          ...base.stair.layout,
          turns: base.stair.layout.turns.map((t) => ({
            ...t,
            inner: { kind: "newel" as const, size: 100 },
          })),
        },
      },
    };
    const { m } = run(project);
    const reception = results(m, "FAB_POTEAU_RECEPTION");
    expect(reception.some((x) => x.status === "violation")).toBe(true);
    expect(reception.every((x) => x.max === 50)).toBe(true);
    expect(m.notes?.some((n) => /poteau des profilés attendu : \d+ mm décalé/.test(n))).toBe(true);
  });
});

describe("débit sur barres (calepinage 1D)", () => {
  it("propriété : chaque pièce placée une fois, barres non dépassées", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 100, max: 13000 }), { minLength: 0, maxLength: 30 }),
        fc.integer({ min: 0, max: 5 }),
        (lengths, kerf) => {
          const pieces = lengths.map((length, i) => ({ id: `p${i}`, mark: `P${i}`, length }));
          const plan = cuttingPlan(pieces, [6000, 12000], kerf);
          const placed = plan.bars.flatMap((b) => b.pieces.map((p) => p.id));
          const all = [...placed, ...plan.oversize.map((p) => p.id)].sort();
          if (
            all.join() !==
            pieces
              .map((p) => p.id)
              .sort()
              .join()
          )
            return false;
          for (const b of plan.bars) {
            const net = b.pieces.reduce((s, p) => s + p.length, 0);
            const withKerf = net + kerf * (b.pieces.length - 1);
            if (withKerf > b.barLength + 1e-9) return false;
            if (b.offcut < -1e-9) return false;
          }
          return plan.oversize.every((p) => p.length > 12000);
        },
      ),
    );
  });

  it("exemple : 4 × 2,9 m sur barres de 6 m → 2 barres", () => {
    const plan = cuttingPlan(
      [0, 1, 2, 3].map((i) => ({ id: `p${i}`, mark: "P", length: 2900 })),
      [6000, 12000],
      3,
    );
    expect(plan.bars.length).toBe(2);
    expect(plan.bars.every((b) => b.barLength === 6000 && b.pieces.length === 2)).toBe(true);
    expect(findSection("UPN 160")).toBeDefined();
  });
});
