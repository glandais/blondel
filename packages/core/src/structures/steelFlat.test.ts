import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pointInPolygon, signedArea } from "../geom2d/polygon.js";
import type { Model, RuleResult } from "../model/derived.js";
import type { Project } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { parseProjectText } from "../project/parse.js";
import { makeSteppingProject } from "../stepping/test-helpers.js";
import { isSimplePolygon } from "./geom.js";
import { QUANTITY_MASS_KG, QUANTITY_VOLUME_M3 } from "./quantities.js";
import { getStructure, listStructures } from "./registry.js";
import {
  QUANTITY_BENDS,
  QUANTITY_BUTT_WELD_MM,
  QUANTITY_HOLES,
  QUANTITY_TREATED_SURFACE_M2,
  QUANTITY_WELD_MM,
} from "./steelCommon.js";
import { SteelFlatParamsSchema, buildSteelFlat, type SteelFlatResult } from "./steelFlat.js";
import { WorkshopProfileSchema } from "../workshop/profile.js";
import "./index.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const loadExample = (file: string): Project =>
  parseProjectText(readFileSync(join(EXAMPLES_DIR, file), "utf8"));

/** Projet en `steel-flat` (contremarches supprimées : marches en tôle pliée autoportantes). */
function steel(
  p: Project,
  params: Record<string, unknown> = {},
  over: { workshop?: unknown } = {},
): Project {
  return {
    ...p,
    ...(over.workshop !== undefined
      ? { workshop: WorkshopProfileSchema.parse(over.workshop) }
      : {}),
    stair: {
      ...p.stair,
      treads: { ...p.stair.treads, risers: "none" },
      structure: { kind: "steel-flat", params },
    },
  };
}

function run(project: Project): { m: Model; r: SteelFlatResult } {
  const m = buildModel(project, { memo: false });
  const params = SteelFlatParamsSchema.parse(project.stair.structure.params);
  const r = buildSteelFlat({ project, layout: m.layout, stepping: m.stepping }, params);
  return { m, r };
}

const blocking = (m: Model): RuleResult[] =>
  m.compliance.results.filter((x) => x.status === "violation" && x.severity === "bloquant");
const results = (m: Model, id: string): RuleResult[] =>
  m.compliance.results.filter((x) => x.ruleId === id);

describe("steel-flat — registre", () => {
  it("plugin métal enregistré au chargement, paramètres par défaut valides", () => {
    expect(getStructure("steel-flat")?.family).toBe("metal");
    expect(listStructures().map((s) => s.kind)).toContain("steel-flat");
    const d = SteelFlatParamsSchema.parse({});
    expect(d).toMatchObject({ grade: "S235", thickness: 8, treadKind: "wood" });
    expect(d.folded).toMatchObject({ profile: "Z", thickness: 5 });
  });
});

describe("steel-flat — quart tournant à poteau (cas n° 1) en acier", () => {
  const base = loadExample("acceptance-01-quart-tournant.blondel.json");
  const variants: [string, Record<string, unknown>][] = [
    ["marches bois (mixte), cornières soudées", {}],
    ["tôle pliée Z", { treadKind: "folded-steel" }],
    [
      "tôle pliée U, cornières vissées à lumières, poteau plein vissé",
      {
        treadKind: "folded-steel",
        folded: { profile: "U" },
        supports: { fixing: "bolted", slotLength: 20 },
        newel: { section: "flat", joint: "bolted" },
      },
    ],
  ];

  for (const [label, params] of variants) {
    describe(label, () => {
      const { m, r } = run(steel(base, params));

      it("limons LI1, LI2, LE1, LE2 + PT1, sans erreur ni violation bloquante, EXC1", () => {
        expect(m.errors).toEqual([]);
        expect(blocking(m)).toEqual([]);
        const marks = m.parts.filter((p) => p.category === "stringer").map((p) => p.mark);
        expect(marks.sort()).toEqual(["LE1", "LE2", "LI1", "LI2"]);
        expect(m.parts.filter((p) => p.category === "post").map((p) => p.mark)).toEqual(["PT1"]);
        expect(new Set(m.parts.map((p) => p.id)).size).toBe(m.parts.length);
        expect(r.executionClass).toBe("EXC1");
        const exc = results(m, "EXC_CLASSE_EXECUTION");
        expect(exc).toHaveLength(1);
        expect(exc[0]!.message).toMatch(/EXC1/);
        expect(m.notes!.join(" ")).toMatch(/Classe d'exécution EN 1090-2 : EXC1/);
      });

      it("chaque marche a un support côté mur ; supports sur la joue des limons", () => {
        for (const t of m.stepping.treads) {
          const on = r.supports.filter((s) => s.placement.tread === t.number);
          expect(
            on.some((s) => s.placement.face.side === "outer"),
            `marche ${t.number} côté mur`,
          ).toBe(true);
        }
        for (const x of results(m, "FAB_SUPPORT_DANS_LIMON")) expect(x.status).toBe("ok");
      });

      it("développés des limons : contour simple, perçages dans le contour, grandeurs acier", () => {
        for (const s of r.stringers) {
          const flat = s.part.flat!;
          expect(isSimplePolygon(flat.outline.outer)).toBe(true);
          expect(signedArea(flat.outline.outer)).toBeGreaterThan(0);
          for (const h of flat.outline.holes) {
            expect(signedArea(h)).toBeLessThan(0);
            for (const p of h) expect(pointInPolygon(p, flat.outline.outer)).toBe("inside");
          }
          const q = s.part.quantities;
          expect(q[QUANTITY_MASS_KG]).toBeCloseTo(q[QUANTITY_VOLUME_M3]! * 7850, 9);
          expect(q[QUANTITY_TREATED_SURFACE_M2]).toBeGreaterThan(0);
          expect(q[QUANTITY_BUTT_WELD_MM]).toBe(0);
          expect(s.part.material).toBe("steel-painted");
        }
        const bolted = (params["supports"] as { fixing?: string } | undefined)?.fixing === "bolted";
        const holes = r.stringers.reduce((a, s) => a + s.part.quantities[QUANTITY_HOLES]!, 0);
        if (bolted) expect(holes).toBeGreaterThan(0);
        else {
          expect(holes).toBe(0);
          for (const s of r.supports)
            expect(s.part.quantities[QUANTITY_WELD_MM]).toBeGreaterThan(0);
        }
      });

      it("marches : tôle pliée (développé en fibre neutre, 2 plis, pièces uniques) ou bois conservé", () => {
        if (params["treadKind"] !== "folded-steel") {
          expect(r.treads).toEqual([]);
          const t1 = m.parts.find((p) => p.id === "tread-1")!;
          expect(t1.material).toMatch(/^wood-/);
          return;
        }
        expect(r.treads).toHaveLength(m.stepping.treads.length);
        for (const d of r.treads) {
          const flat = d.part.flat!;
          expect(flat.reference?.kind).toBe("neutral-fiber");
          expect(isSimplePolygon(flat.outline.outer)).toBe(true);
          expect(d.part.quantities[QUANTITY_BENDS]).toBe(2);
          for (const l of flat.lines.filter((x) => x.kind === "bend")) {
            expect(l.bendAngle).toBe(90);
            expect(l.bendRadius).toBe(6.5);
            for (const p of [l.a, l.b])
              expect(pointInPolygon(p, flat.outline.outer)).not.toBe("outside");
          }
          expect(m.parts.find((p) => p.id === d.part.id)!.material).toBe("steel-painted");
        }
        // Balancées : toutes différentes ; volée droite : pièces identiques regroupées.
        expect(r.treadGroups.length).toBeLessThan(r.treads.length);
        expect(r.treadGroups.length).toBeGreaterThan(1);
        const flange = results(m, "FAB_PLI_BORD_MIN");
        expect(flange.every((x) => x.status === "ok")).toBe(true);
        expect(results(m, "FAB_PLI_RAYON_MIN")[0]!.status).toBe("ok");
        expect(results(m, "FAB_PRESSE_PLIEUSE").every((x) => x.status === "ok")).toBe(true);
        expect(m.notes!.join(" ")).toMatch(/pièce\(s\) unique\(s\)/);
      });
    });
  }
});

describe("steel-flat — configurations et classes d'exécution", () => {
  it("jour à angle vif : erreur explicite, limons muraux seuls", () => {
    const { m } = run(steel(loadExample("quarter-left.blondel.json")));
    const quarter = loadExample("quarter-left.blondel.json");
    expect(quarter.stair.layout.turns[0]!.inner.kind).toBe("sharp");
    expect(m.errors.join(" ")).toMatch(/angle vif.*poteau/);
    const marks = m.parts.filter((p) => p.category === "stringer").map((p) => p.mark);
    expect(marks.sort()).toEqual(["LE1", "LE2"]);
  });

  it("S355 : EXC2 ; rayon de pli du profil par défaut (1,3 t) < 1,5 t → violation bloquante C-M-02", () => {
    const p = steel(makeSteppingProject({ width: 900, legs: ["auto"] }), {
      grade: "S355",
      treadKind: "folded-steel",
    });
    const { m, r } = run(p);
    expect(r.executionClass).toBe("EXC2");
    const radius = results(m, "FAB_PLI_RAYON_MIN");
    expect(radius[0]!.status).toBe("violation");
    expect(radius[0]!.severity).toBe("bloquant");
  });

  it("limon plus long que les formats de tôle : aboutage soudé bout à bout → EXC2 ; éclissé → EXC1", () => {
    const p0 = makeSteppingProject({ width: 900, legs: ["auto"] });
    const workshop = { metal: { sheetFormats: [{ length: 2000, width: 1000 }] } };
    const welded = run(steel(p0, {}, { workshop }));
    expect(welded.r.executionClass).toBe("EXC2");
    const butt = welded.r.stringers.reduce(
      (a, s) => a + s.part.quantities[QUANTITY_BUTT_WELD_MM]!,
      0,
    );
    expect(butt).toBeGreaterThan(0);
    expect(welded.r.stringers.every((s) => s.splices >= 1)).toBe(true);
    expect(results(welded.m, "FAB_FORMAT_TOLE").some((x) => x.status === "violation")).toBe(true);
    const bolted = run(steel(p0, { splice: "bolted" }, { workshop }));
    expect(bolted.r.executionClass).toBe("EXC1");
  });

  it("presse plieuse trop courte, loi de pli absente : contrôles et erreurs explicites", () => {
    const p0 = makeSteppingProject({ width: 900, legs: ["auto"] });
    const short = run(
      steel(
        p0,
        { treadKind: "folded-steel" },
        { workshop: { metal: { pressBrake: { maxLength: 500 } } } },
      ),
    );
    const press = results(short.m, "FAB_PRESSE_PLIEUSE");
    expect(press.some((x) => x.status === "violation")).toBe(true);
    const missing = run(steel(p0, { treadKind: "folded-steel", folded: { thickness: 7 } }));
    expect(missing.m.errors.join(" ")).toMatch(/aucune loi de pli/);
    expect(results(missing.m, "FAB_LOI_DE_PLI")[0]!.status).toBe("violation");
    expect(missing.r.treads).toEqual([]);
  });

  it("DIN 6935 dans le profil : facteur K équivalent reporté dans le développé", () => {
    const p0 = makeSteppingProject({ width: 900, legs: ["auto"] });
    const { r } = run(
      steel(
        p0,
        { treadKind: "folded-steel" },
        {
          workshop: {
            metal: {
              bendLaws: [{ thickness: 5, innerRadius: 6.5, minFlange: 23, method: "din6935" }],
            },
          },
        },
      ),
    );
    const k = (0.65 + 0.5 * Math.log10(6.5 / 5)) / 2;
    expect(r.treads[0]!.part.flat!.reference!.description).toContain(
      `facteur K ${k.toFixed(3).replace(".", ",")}`,
    );
  });
});

describe("steel-flat — platines : cotes de débit des limons et du poteau (relecture J3b)", () => {
  const base = loadExample("acceptance-01-quart-tournant.blondel.json");
  const V3 = (o: { x: number; y: number }, d: { x: number; y: number }): number =>
    o.x * d.x + o.y * d.y;

  it("platines de pied : limons de départ et poteau posés dessus (raccourcis de e_p), sinon au sol", () => {
    for (const foot of [true, false]) {
      const { m, r } = run(steel(base, { plates: { foot, thickness: 12 } }));
      expect(m.errors).toEqual([]);
      const ep = foot ? 12 : 0;
      for (const s of r.stringers.filter((x) => x.face.start === "floor")) {
        const zMin = Math.min(...s.development.outline.map((q) => q.y));
        expect(zMin, s.face.mark).toBeCloseTo(ep, 9);
        const plate = r.plates.find((p) => p.id === `plate-foot-${s.face.id}`);
        expect(plate !== undefined, s.face.mark).toBe(foot);
      }
      const post = r.posts[0]!;
      if (post.solid.kind !== "extrusion") throw new Error("extrusion attendue");
      expect(post.solid.frame.origin.z).toBeCloseTo(ep, 9);
      // Longueur de débit du poteau = hauteur hors platine.
      expect(post.stock!.length).toBeCloseTo(post.solid.depth, 9);
    }
  });

  it("assemblage vissé au poteau : platine d'about entre le bout du limon et la face du poteau", () => {
    const pt = 10;
    const { m, r } = run(
      steel(base, { newel: { joint: "bolted" }, plates: { thickness: pt, head: false } }),
    );
    expect(m.errors).toEqual([]);
    const received = r.stringers.filter((s) => s.face.start === "newel" || s.face.end === "newel");
    expect(received.length).toBe(2);
    for (const s of received) {
      const f = s.face;
      const atEnd = f.end === "newel";
      // Face du poteau en u = faceLength (fin) ou 0 (début) : limon raccourci de l'épaisseur.
      if (atEnd) expect(s.development.uHi).toBeCloseTo(f.faceLength - pt, 9);
      else expect(s.development.uLo).toBeCloseTo(pt, 9);
      const plate = r.plates.find((p) => p.id === `plate-end-${f.id}`)!;
      if (plate.solid.kind !== "extrusion") throw new Error("extrusion attendue");
      const { frame, depth } = plate.solid;
      const u0 = V3({ x: frame.origin.x - f.a.x, y: frame.origin.y - f.a.y }, f.dir);
      const u1 = u0 + depth * V3(frame.zAxis, f.dir);
      const [lo, hi] = [Math.min(u0, u1), Math.max(u0, u1)];
      const [plo, phi] = atEnd ? [f.faceLength - pt, f.faceLength] : [0, pt];
      expect(lo, f.mark).toBeCloseTo(plo, 6);
      expect(hi, f.mark).toBeCloseTo(phi, 6);
    }
  });

  it("angle mural soudé : le limon qui arrive traverse le coin (u_hi = L + e), celui qui part s'arrête contre lui (u_lo = 0), sans recouvrement", () => {
    const e = 8;
    const { r } = run(steel(base, { thickness: e }));
    const le1 = r.stringers.find((s) => s.face.id === "stringer-outer-1")!;
    const le2 = r.stringers.find((s) => s.face.id === "stringer-outer-2")!;
    expect(le1.face.end).toBe("corner");
    expect(le2.face.start).toBe("corner");
    expect(le1.development.uHi).toBeCloseTo(le1.face.faceLength + e, 9);
    expect(le2.development.uLo).toBeCloseTo(0, 9);
    // Soudure d'angle portée par le limon qui part de l'angle.
    expect(le2.part.quantities[QUANTITY_WELD_MM]).toBeGreaterThan(0);
  });

  it("platine de tête : le limon s'arrête à e_p du nez d'arrivée, la platine le prolonge", () => {
    const { m, r } = run(steel(base, { plates: { thickness: 10 }, endExtension: 0 }));
    for (const s of r.stringers.filter((x) => x.face.end === "arrival")) {
      const plate = r.plates.find((p) => p.id === `plate-head-${s.face.id}`)!;
      if (plate.solid.kind !== "extrusion") throw new Error("extrusion attendue");
      const f = s.face;
      const { frame, depth } = plate.solid;
      const u0 = V3({ x: frame.origin.x - f.a.x, y: frame.origin.y - f.a.y }, f.dir);
      const u1 = u0 + depth * V3(frame.zAxis, f.dir);
      // Nez d'arrivée (nu de la trémie) en u = σ_N − σ_A.
      const last = m.stepping.nosings[m.stepping.nosings.length - 1]!;
      const uN = (f.side === "inner" ? last.sigmaInner : last.sigmaOuter) - f.sigmaA;
      expect(s.development.uHi).toBeCloseTo(uN - 10, 6);
      expect(Math.min(u0, u1)).toBeCloseTo(uN - 10, 6);
      expect(Math.max(u0, u1)).toBeCloseTo(uN, 6);
    }
  });
});

describe("steel-flat — propriétés (tournants à poteau)", () => {
  it("contours simples, perçages et plis dans les contours, aucune erreur", () => {
    const arb = fc.record({
      width: fc.integer({ min: 750, max: 1100 }),
      l1: fc.integer({ min: 1800, max: 3200 }),
      l2: fc.integer({ min: 1400, max: 3000 }),
      l3: fc.integer({ min: 1400, max: 2600 }),
      legs: fc.constantFrom(1, 2, 2, 3),
      newel: fc.integer({ min: 45, max: 75 }).map((k) => 2 * k),
      direction: fc.constantFrom<"left" | "right">("left", "right"),
      mode: fc.constantFrom<"winders" | "landing">("winders", "winders", "landing"),
      folded: fc.constantFrom("Z", "U", null),
      bolted: fc.boolean(),
    });
    fc.assert(
      fc.property(arb, (g) => {
        const legs =
          g.legs === 1
            ? (["auto"] as const)
            : g.legs === 2
              ? [g.l1, g.l2]
              : [g.l1, g.width * 2 + g.newel + Math.round(g.l3 / 4), g.l2];
        const p0 = makeSteppingProject({
          width: g.width,
          legs: [...legs],
          direction: g.direction,
          mode: g.mode,
          inner: { kind: "newel", size: g.newel },
        });
        const params = {
          ...(g.folded ? { treadKind: "folded-steel", folded: { profile: g.folded } } : {}),
          supports: { fixing: g.bolted ? "bolted" : "welded" },
        };
        const { m } = run(steel(p0, params));
        if (m.stepping.nosings.length < 2) return;
        expect(m.errors).toEqual([]);
        for (const part of m.parts) {
          const flat = part.flat;
          if (!flat) continue;
          expect(isSimplePolygon(flat.outline.outer), part.id).toBe(true);
          for (const h of flat.outline.holes) {
            for (const p of h)
              expect(pointInPolygon(p, flat.outline.outer), part.id).toBe("inside");
          }
          for (const l of flat.lines.filter((x) => x.kind === "bend")) {
            expect(pointInPolygon(l.a, flat.outline.outer, 1e-6)).not.toBe("outside");
            expect(pointInPolygon(l.b, flat.outline.outer, 1e-6)).not.toBe("outside");
          }
        }
      }),
      { numRuns: 60 },
    );
  }, 60000);
});
