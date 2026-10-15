/**
 * Limons acier latéraux sur une cage saisie (ADR-0010, sous-lot 6b) : plats découpés
 * (`steel-flat`, marches bois ou en tôle pliée) et profilés (`steel-profile`). Une fonction de
 * cage par bloc (`capabilities.cage` : angle quelconque, largeur variable, palier droit (plats
 * seulement), pan coupé), parité stricte d'un tronçon droit avec la volée droite, puis une
 * propriété fast-check par plugin sur des cages tirées parmi ces seules fonctions.
 *
 * Conventions vérifiées (à valider, QUESTIONS F17) : faces du tracé (`legs.ts`, F16) ; plats :
 * coupes d'équerre sans recouvrement aux angles (`buttCornerCuts` : le limon qui arrive va
 * jusqu'à l'arête extérieure du coin, celui qui part bute contre lui ; exactement e et 0 à 90°) ;
 * profilés : onglet à φ/2 en plan, palier droit refusé ; plats, palier droit à bords alignés :
 * aboutage au milieu du palier selon `splice` (soudé bout à bout : EXC2 ; éclissé : sans cordon) ; jour vif ou en arc :
 * limons de jour voisins non générés, erreur dédiée (pas de poteau sur une cage).
 */
import fc from "fast-check";
import { translatorFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import * as V from "../geom2d/vec.js";
import type { Model, Tread } from "../model/derived.js";
import type { Mm, Vec2 } from "../model/primitives.js";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type CageLayoutSpecInput,
  type Project,
} from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { area, clipHalfPlane, pointSegmentDistance } from "./geom.js";
import { stairGeometry } from "./legs.js";
import { structureCageFeatures } from "./registry.js";
import {
  SteelFlatParamsSchema,
  STEEL_STRINGER_CAGE,
  buildSteelFlat,
  MIN_CAGE_STRINGER_LENGTH,
  buttCornerCuts,
  type SteelCornerEnd,
  type SteelFlatResult,
  type SteelStringerFace,
} from "./steelFlat.js";
import {
  STEEL_PROFILE_CAGE,
  SteelProfileParamsSchema,
  buildSteelProfile,
  miterCutExtra,
  miterOffset,
  profileMiterFiberLength,
  type SteelProfileResult,
} from "./steelProfile.js";
import { expectMarkNames, expectMarksUnified } from "./marks.testing.js";

const FR = translatorFor("fr");
const E = SteelFlatParamsSchema.parse({}).thickness;

const straight = (length: number, width = 900, widthEnd?: number) => ({
  axis: { kind: "straight" as const, length },
  width,
  ...(widthEnd !== undefined ? { widthEnd } : {}),
});
const chamfer = (d = 250) => ({ kind: "chamfer" as const, setbackIn: d, setbackOut: d });

function cageProject(
  layout: CageLayoutSpecInput | Record<string, unknown>,
  structure: string,
  params: Record<string, unknown> = {},
): Project {
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: { floorToFloor: 2700, upperSlabThickness: 200 },
    stair: {
      placement: { origin: { x: 0, y: 0 }, rotation: 0 },
      layout,
      structure: { kind: structure, params },
    },
  });
}

function flat(project: Project): { m: Model; r: SteelFlatResult } {
  const m = buildModel(project, { memo: false });
  const r = buildSteelFlat(
    { project, layout: m.layout, stepping: m.stepping },
    SteelFlatParamsSchema.parse(project.stair.structure.params ?? {}),
  );
  return { m, r };
}

function profiled(project: Project): { m: Model; r: SteelProfileResult } {
  const m = buildModel(project, { memo: false });
  const r = buildSteelProfile(
    { project, layout: m.layout, stepping: m.stepping },
    SteelProfileParamsSchema.parse(project.stair.structure.params ?? {}),
  );
  return { m, r };
}

const keys = (m: Model): string[] => m.errors.map((e) => e.key);
const marks = (m: Model): string[] =>
  m.parts.filter((p) => p.category === "stringer").map((p) => p.mark);

/** Face et fenêtre [uLo ; uHi] d'un limon construit (plat ou profilé). */
interface Built {
  readonly face: SteelStringerFace;
  readonly uLo: Mm;
  readonly uHi: Mm;
}

const flatBuilt = (r: SteelFlatResult): Built[] =>
  r.stringers.map((s) => ({ face: s.face, uLo: s.development.uLo, uHi: s.development.uHi }));
const profileBuilt = (r: SteelProfileResult): Built[] =>
  r.stringers.map((s) => ({ face: s.face, uLo: s.uLo, uHi: s.uHi }));

/** Emprise en plan d'un plat d'épaisseur `e` (fenêtre le long de sa face, vers `into`). */
function footprint(b: Built, e: Mm): Vec2[] {
  const at = (u: Mm, d: Mm): Vec2 =>
    V.addScaled(V.addScaled(b.face.a, b.face.dir, u), b.face.into, d);
  return [at(b.uLo, 0), at(b.uHi, 0), at(b.uHi, e), at(b.uLo, e)];
}

/** Aire de l'intersection de deux polygones convexes. */
function overlapArea(p: readonly Vec2[], q: readonly Vec2[]): number {
  let out: Vec2[] = [...p];
  const ccw = area(q) === 0 ? 1 : Math.sign(signed(q));
  for (let i = 0; i < q.length && out.length > 0; i++) {
    const a = q[i]!;
    const b = q[(i + 1) % q.length]!;
    const inward = ccw > 0 ? V.perpLeft(V.sub(b, a)) : V.perpRight(V.sub(b, a));
    out = clipHalfPlane(out, a, inward);
  }
  return out.length >= 3 ? area(out) : 0;
}

function signed(p: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += V.cross(p[i]!, p[(i + 1) % p.length]!);
  return s / 2;
}

/** Plus petite distance entre les contours de deux polygones. */
function gap(p: readonly Vec2[], q: readonly Vec2[]): number {
  let d = Infinity;
  for (const [x, y] of [
    [p, q],
    [q, p],
  ] as const) {
    for (const v of x) {
      for (let i = 0; i < y.length; i++) {
        d = Math.min(d, pointSegmentDistance(v, y[i]!, y[(i + 1) % y.length]!));
      }
    }
  }
  return d;
}

/**
 * Marches dont le contour a une arête posée (sur plus de 1 mm) sur la face d'un limon du côté
 * `side`, dans sa portée porteuse (fenêtre du limon, arrêtée au coin des faces à un angle).
 */
function carriedOn(built: readonly Built[], treads: readonly Tread[], side: string): Set<number> {
  const out = new Set<number>();
  for (const b of built.filter((x) => x.face.side === side)) {
    const { face } = b;
    const on = (p: Vec2): boolean => Math.abs(V.cross(face.dir, V.sub(p, face.a))) <= 1e-5;
    const u = (p: Vec2): Mm => V.dot(V.sub(p, face.a), face.dir);
    const lo = face.start === "corner" ? Math.max(b.uLo, 0) : b.uLo;
    const hi = face.end === "corner" ? Math.min(b.uHi, face.faceLength) : b.uHi;
    for (const t of treads) {
      const hit = t.outline.some((p, i) => {
        const q = t.outline[(i + 1) % t.outline.length]!;
        if (!(on(p) && on(q))) return false;
        return Math.min(Math.max(u(p), u(q)), hi) - Math.max(Math.min(u(p), u(q)), lo) > 1;
      });
      if (hit) out.add(t.number);
    }
  }
  return out;
}

/** Toutes les marches portées des deux côtés (arête posée sur un limon de jour et un mural). */
function expectCarriedBothSides(built: readonly Built[], treads: readonly Tread[]): void {
  const all = treads.map((t) => t.number);
  expect([...carriedOn(built, treads, "inner")].sort((a, b) => a - b)).toEqual(all);
  expect([...carriedOn(built, treads, "outer")].sort((a, b) => a - b)).toEqual(all);
}

/** Plats consécutifs d'un même côté : ni recouvrement ni jour en plan, contact au coin. */
function expectButtJoints(built: readonly Built[], e: Mm): void {
  for (const side of ["inner", "outer"] as const) {
    const list = built.filter((b) => b.face.side === side);
    for (let k = 0; k + 1 < list.length; k++) {
      const a = list[k]!;
      const b = list[k + 1]!;
      if (a.face.end !== "corner" || b.face.start !== "corner") continue;
      const fa = footprint(a, e);
      const fb = footprint(b, e);
      expect(overlapArea(fa, fb), `${a.face.mark} / ${b.face.mark}`).toBeLessThan(1e-6);
      expect(gap(fa, fb), `${a.face.mark} / ${b.face.mark}`).toBeLessThan(1e-6);
    }
  }
}

/** Longueurs positives : faces, fenêtres, débits, développés. */
function expectPositiveLengths(m: Model, built: readonly Built[]): void {
  for (const b of built) {
    expect(b.face.faceLength, b.face.mark).toBeGreaterThan(0);
    expect(b.uHi - b.uLo, b.face.mark).toBeGreaterThan(0);
  }
  for (const p of m.parts.filter((x) => x.category === "stringer")) {
    expect(p.stock!.length, p.mark).toBeGreaterThan(0);
    expect(area(p.flat!.outline.outer), p.mark).toBeGreaterThan(0);
  }
}

// ------------------------------------------------------------------ coupes d'équerre (plats)

describe("buttCornerCuts : coupes d'équerre de deux plats à un angle (F17 (1))", () => {
  const corner = (deg: number, concave: boolean): SteelCornerEnd => ({
    joint: "wall",
    concave,
    tanHalf: deg === 90 ? 1 : Math.tan((deg * Math.PI) / 360),
  });

  it("90° rentrant : prolongement e, départ au coin (angle mural des volées)", () => {
    expect(buttCornerCuts(8, corner(90, true))).toEqual({ arrive: 8, depart: 0 });
  });

  it("90° saillant : arrêt au coin, départ à e ; raccord de palier : bout à bout", () => {
    expect(buttCornerCuts(8, corner(90, false))).toEqual({ arrive: 0, depart: 8 });
    expect(buttCornerCuts(8, { joint: "landing", concave: true, tanHalf: 0 })).toEqual({
      arrive: 0,
      depart: 0,
    });
  });

  it("60° rentrant : e·tan 30°, départ e·tan 30°·cos 60° ; 120° rentrant : e / sin 120°, 0", () => {
    const a = buttCornerCuts(10, corner(60, true));
    expect(a.arrive).toBeCloseTo(10 * Math.tan(Math.PI / 6), 12);
    expect(a.depart).toBeCloseTo(10 * Math.tan(Math.PI / 6) * 0.5, 12);
    const b = buttCornerCuts(10, corner(120, true));
    expect(b.arrive).toBeCloseTo(10 / Math.sin((2 * Math.PI) / 3), 12);
    expect(b.depart).toBe(0);
  });

  it("propriété : deux plats coupés d'équerre ne se recouvrent pas et se touchent, à tout angle", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 170, noNaN: true }),
        fc.double({ min: 2, max: 30, noNaN: true }),
        fc.boolean(),
        (deg, e, concave) => {
          const phi = (deg * Math.PI) / 180;
          const { arrive, depart } = buttCornerCuts(e, {
            joint: "wall",
            concave,
            tanHalf: Math.tan(phi / 2),
          });
          // Plat qui arrive : face y = 0 (x ≤ 0), épaisseur vers y > 0. Plat qui part : face
          // depuis le coin, tournée vers les marches (rentrant) ou vers l'épaisseur (saillant).
          const u2 = V.vec(Math.cos(phi), concave ? -Math.sin(phi) : Math.sin(phi));
          const n2 = V.perpLeft(u2);
          const L = 2000;
          const A = [V.vec(-L, 0), V.vec(arrive, 0), V.vec(arrive, e), V.vec(-L, e)];
          const at = (s: Mm, d: Mm): Vec2 => V.addScaled(V.scale(u2, s), n2, d);
          const D = [at(depart, 0), at(L, 0), at(L, e), at(depart, e)];
          expect(overlapArea(A, D)).toBeLessThan(1e-6 * e * e);
          expect(gap(A, D)).toBeLessThan(1e-6 * e);
          // Aucun plat ne dépasse le dos de l'autre (arête extérieure du coin).
          for (const p of A) {
            if (p.x > 1e-9) expect(V.dot(p, n2)).toBeLessThanOrEqual(e + 1e-9);
          }
        },
      ),
      { numRuns: 400, seed: 17 },
    );
  });
});

// ------------------------------------------------------------------ steel-flat sur une cage

describe("steel-flat sur une cage saisie (sous-lot 6b)", () => {
  it("capacités : mêmes fonctions que les limons à la française (profilés : sans palier droit)", () => {
    expect(structureCageFeatures("steel-flat")).toEqual(STEEL_STRINGER_CAGE);
    expect(structureCageFeatures("steel-profile")).toEqual(STEEL_PROFILE_CAGE);
    expect(STEEL_STRINGER_CAGE).toEqual([
      "anyAngle",
      "variableWidth",
      "straightLanding",
      "chamfer",
    ]);
    expect(STEEL_PROFILE_CAGE).toEqual(["anyAngle", "variableWidth", "chamfer"]);
  });

  it("anyAngle : jonction à 60°, limons muraux coupés d'équerre (e·tan 30°), sans recouvrement", () => {
    const p = cageProject(
      {
        kind: "cage",
        sections: [straight(1650), straight(1650)],
        junctions: [{ angle: 60, mode: "winders", well: chamfer() }],
      },
      "steel-flat",
    );
    const { m, r } = flat(p);
    expect(keys(m)).toEqual([]);
    expect(marks(m)).toEqual(["LI1", "LE1", "LIC1", "LI2", "LE2"]);
    const le1 = r.stringers.find((s) => s.face.mark === "LE1")!;
    const le2 = r.stringers.find((s) => s.face.mark === "LE2")!;
    const t = Math.tan(Math.PI / 6);
    expect(le1.face.endCorner).toMatchObject({ joint: "wall", concave: true });
    expect(le1.development.uHi - le1.face.faceLength).toBeCloseTo(E * t, 9);
    expect(le2.development.uLo).toBeCloseTo(E * t * Math.cos(Math.PI / 3), 9);
    expectButtJoints(flatBuilt(r), E);
    expectCarriedBothSides(flatBuilt(r), m.stepping.treads);
    expectPositiveLengths(m, flatBuilt(r));
    // Trait de joint d'angle au bout réel du limon qui part, libellé de l'angle mural.
    const joint = le2.part.flat!.lines.filter((l) => l.kind === "joint");
    expect(joint.map((l) => l.label?.key)).toContain("structure.steel.joint.wallCorner");
    // Soudure d'angle portée par le limon qui part (deux cordons), pas de soudure bout à bout.
    expect(le2.part.quantities["weld_mm"]).toBeGreaterThan(0);
    expect(r.executionClass).toBe("EXC1");
  });

  it("chamfer : limon propre au pan coupé (LIC1), angles saillants, arrêt au coin et départ à e·sin(φ)", () => {
    const p = cageProject(
      {
        kind: "cage",
        sections: [straight(1500), straight(1500)],
        junctions: [{ angle: 90, mode: "winders", well: chamfer(300) }],
      },
      "steel-flat",
    );
    const { m, r } = flat(p);
    expect(keys(m)).toEqual([]);
    const li1 = r.stringers.find((s) => s.face.mark === "LI1")!;
    const lic = r.stringers.find((s) => s.face.mark === "LIC1")!;
    expect(lic.part.name.key).toBe("structure.steel.part.chamferString");
    expect(li1.face.endCorner).toMatchObject({ joint: "jour", concave: false });
    // Pan à 45° de chaque face : le limon qui arrive s'arrête au coin, celui qui part à e·sin 45°.
    expect(li1.development.uHi).toBeCloseTo(li1.face.faceLength, 9);
    expect(lic.development.uLo).toBeCloseTo(E * Math.SQRT1_2, 9);
    const labels = lic.part.flat!.lines.filter((l) => l.kind === "joint").map((l) => l.label?.key);
    expect(labels).toContain("structure.steel.joint.jourCorner");
    expectButtJoints(flatBuilt(r), E);
    expectCarriedBothSides(flatBuilt(r), m.stepping.treads);
  });

  it("straightLanding : aboutage au milieu du palier, soudé (EXC2) ou éclissé (EXC1)", () => {
    const layout: CageLayoutSpecInput = {
      kind: "cage",
      sections: [straight(1890), straight(1620)],
      junctions: [{ angle: 0, mode: "landing", depth: 1000 }],
    };
    const welded = flat(cageProject(layout, "steel-flat"));
    expect(keys(welded.m)).toEqual([]);
    expect(marks(welded.m)).toEqual(["LI1", "LE1", "LI2", "LE2"]);
    const li1 = welded.r.stringers.find((s) => s.face.mark === "LI1")!;
    const li2 = welded.r.stringers.find((s) => s.face.mark === "LI2")!;
    // Raccord bout à bout : les deux limons se touchent au milieu du palier, sans prolongement.
    const end1 = V.addScaled(li1.face.a, li1.face.dir, li1.development.uHi);
    const start2 = V.addScaled(li2.face.a, li2.face.dir, li2.development.uLo);
    expect(V.distance(end1, start2)).toBeLessThan(1e-6);
    expect(li2.face.startCorner).toEqual({ joint: "landing", concave: true, tanHalf: 0 });
    expect(welded.r.executionClass).toBe("EXC2");
    expect(li2.part.quantities["butt_weld_mm"]).toBeGreaterThan(0);
    const label = (s: typeof li2) =>
      s.part.flat!.lines.filter((l) => l.kind === "joint").map((l) => l.label?.key);
    expect(label(li2)).toContain("structure.steel.joint.landingSpliceWelded");
    const bolted = flat(cageProject(layout, "steel-flat", { splice: "bolted" }));
    expect(bolted.r.executionClass).toBe("EXC1");
    const bli2 = bolted.r.stringers.find((s) => s.face.mark === "LI2")!;
    expect(bli2.part.quantities["butt_weld_mm"] ?? 0).toBe(0);
    expect(label(bli2)).toContain("structure.steel.joint.landingSpliceBolted");
    expectCarriedBothSides(flatBuilt(welded.r), welded.m.stepping.treads);
    // Platines : pied sous les limons de départ, tête sur les limons d'arrivée seulement.
    const plates = welded.m.parts.filter((x) => x.id.startsWith("plate-")).map((x) => x.id);
    expect(plates.sort()).toEqual([
      "plate-foot-stringer-inner-1",
      "plate-foot-stringer-outer-1",
      "plate-head-stringer-inner-2",
      "plate-head-stringer-outer-2",
    ]);
  });

  it("straightLanding non aligné : limon propre au bord du palier (LIP1 / LEP1)", () => {
    const p = cageProject(
      {
        kind: "cage",
        sections: [straight(1890, 900), straight(1620, 1100)],
        junctions: [{ angle: 0, mode: "landing", depth: 1000 }],
      },
      "steel-flat",
    );
    const { m, r } = flat(p);
    expect(keys(m)).toEqual([]);
    expect(marks(m).filter((x) => /P/.test(x)).length).toBeGreaterThan(0);
    expectButtJoints(flatBuilt(r), E);
    expectCarriedBothSides(flatBuilt(r), m.stepping.treads);
    expectPositiveLengths(m, flatBuilt(r));
  });

  it("variableWidth : limons de jour sur les bords inclinés d'un trapèze", () => {
    const p = cageProject(
      {
        kind: "cage",
        sections: [straight(1450, 900, 1200), straight(1400, 1200)],
        junctions: [{ angle: 90, mode: "winders", well: chamfer(300) }],
      },
      "steel-flat",
    );
    const { m, r } = flat(p);
    expect(keys(m)).toEqual([]);
    const li1 = r.stringers.find((s) => s.face.mark === "LI1")!;
    const le1 = r.stringers.find((s) => s.face.mark === "LE1")!;
    // Bord incliné : face de jour non parallèle à la face murale.
    expect(Math.abs(V.cross(li1.face.dir, le1.face.dir))).toBeGreaterThan(0.1);
    expectButtJoints(flatBuilt(r), E);
    expectCarriedBothSides(flatBuilt(r), m.stepping.treads);
  });

  it("marches en tôle pliée Z et U : développées sur la cage, vissées sur leurs supports", () => {
    for (const profile of ["Z", "U"] as const) {
      const p = cageProject(
        {
          kind: "cage",
          sections: [straight(1200), straight(500), straight(1300)],
          junctions: [
            { angle: 45, mode: "winders", well: chamfer() },
            { angle: 0, mode: "landing", depth: 900 },
          ],
        },
        "steel-flat",
        { treadKind: "folded-steel", folded: { profile } },
      );
      const { m, r } = flat(p);
      expect(keys(m), profile).toEqual([]);
      expect(r.treads.length, profile).toBe(m.stepping.treads.length);
      for (const d of r.treads)
        expect(d.part.flat!.lines.some((l) => l.kind === "bend")).toBe(true);
      // Vis de fixation de marche reportées dans les supports (A31).
      expect(r.supports.length).toBeGreaterThan(0);
      expectButtJoints(flatBuilt(r), E);
    }
  });

  it("jour vif ou en arc : erreur dédiée, limons de jour voisins non générés, muraux générés", () => {
    for (const [well, key] of [
      [{ kind: "sharp" as const }, "structure.steel.error.sharpWellCage"],
      [{ kind: "arc" as const, radius: 200 }, "structure.steel.error.arcWellCage"],
    ] as const) {
      for (const kind of ["steel-flat", "steel-profile"]) {
        const m = buildModel(
          cageProject(
            {
              kind: "cage",
              sections: [straight(1650), straight(1650)],
              junctions: [{ angle: 60, mode: "winders", well }],
            },
            kind,
          ),
          { memo: false },
        );
        expect(
          keys(m).filter((k) => k !== "structure.steelProfile.error.noSectionPasses"),
          kind,
        ).toEqual([key]);
        expect(marks(m), kind).toEqual(["LE1", "LE2"]);
        const text = FR.t(m.errors.find((e) => e.key === key)!);
        expect(text).toContain("pan coupé");
        expect(text).not.toMatch(/\{|\}|undefined/);
      }
    }
  });

  it("pan coupé plus court que les coupes d'équerre : limon non généré, erreur explicite", () => {
    // Retraits de 10 mm, e = 30 : le limon du pan (14,1 mm de face) part à e·sin 45° ≈ 21,2 mm.
    for (const [setback, thickness] of [
      [10, 30],
      [5, 20],
    ] as const) {
      const p = cageProject(
        {
          kind: "cage",
          sections: [straight(1650), straight(1650)],
          junctions: [{ angle: 90, mode: "winders", well: chamfer(setback) }],
        },
        "steel-flat",
        { thickness },
      );
      const { m, r } = flat(p);
      expect(keys(m)).toEqual(["structure.steel.error.cageFaceTooShort"]);
      expect(marks(m)).toEqual(["LI1", "LE1", "LI2", "LE2"]);
      const text = FR.t(m.errors[0]!);
      expect(text).toContain("LIC1");
      expect(text).not.toMatch(/\{|\}|undefined/);
      expectPositiveLengths(m, flatBuilt(r));
    }
  });
});

describe("parité : une cage sans fonction donne les pièces de la volée équivalente", () => {
  /** Pièces d'un modèle, sans le nom des limons (nommés par tronçon sur une cage, par volée sinon). */
  const partsOf = (m: Model) =>
    m.parts.map((p) => {
      if (p.category !== "stringer") return p;
      const { name: _name, ...rest } = p;
      return rest;
    });

  it.each([
    ["steel-flat", {}],
    ["steel-flat", { treadKind: "folded-steel", folded: { profile: "Z" } }],
    ["steel-flat", { treadKind: "folded-steel", folded: { profile: "U" } }],
    ["steel-profile", { family: "UPN" }],
    ["steel-profile", { family: "IPE" }],
  ] as const)("%s %j : tronçon droit = volée droite", (kind, params) => {
    for (const [length, width] of [
      [3200, 900],
      [2900, 1000],
    ] as const) {
      const cage = buildModel(
        cageProject(
          { kind: "cage", sections: [straight(length, width)], junctions: [] },
          kind,
          params,
        ),
        { memo: false },
      );
      const flights = buildModel(
        cageProject({ width, legs: [{ length }], turns: [] }, kind, params),
        { memo: false },
      );
      expect(keys(cage)).toEqual(keys(flights));
      expect(keys(cage)).not.toContain("structure.cageUnsupported");
      expect(cage.parts.filter((p) => p.category === "stringer").length).toBe(2);
      expect(partsOf(cage)).toStrictEqual(partsOf(flights));
    }
  });

  it("angle à 90° de largeur uniforme : prolongement e et départ au coin, comme les volées", () => {
    const p = cageProject(
      {
        kind: "cage",
        sections: [straight(1500), straight(1500)],
        junctions: [{ angle: 90, mode: "winders", well: chamfer() }],
      },
      "steel-flat",
    );
    const { r } = flat(p);
    const le1 = r.stringers.find((s) => s.face.mark === "LE1")!;
    const le2 = r.stringers.find((s) => s.face.mark === "LE2")!;
    expect(le1.face.endReach).toBe(E);
    expect(le1.development.uHi - le1.face.faceLength).toBeCloseTo(E, 12);
    expect(Math.abs(le2.face.startReach!)).toBe(0);
    expect(Math.abs(le2.development.uLo)).toBe(0);
  });
});

// ------------------------------------------------------------------ steel-profile sur une cage

describe("steel-profile sur une cage saisie (sous-lot 6b)", () => {
  it("onglet à φ/2 : dépassement de l'âme et longueur de débit selon l'angle", () => {
    const concave: SteelCornerEnd = {
      joint: "wall",
      concave: true,
      tanHalf: Math.tan(Math.PI / 6),
    };
    const convex: SteelCornerEnd = { ...concave, joint: "jour", concave: false };
    expect(miterOffset(undefined, 30)).toBe(30);
    expect(miterCutExtra(undefined, 80, 30)).toBe(50);
    expect(miterOffset({ ...concave, tanHalf: 1 }, 30)).toBe(30);
    expect(miterCutExtra({ ...concave, tanHalf: 1 }, 80, 30)).toBe(50);
    expect(miterOffset(concave, 30)).toBeCloseTo(30 * Math.tan(Math.PI / 6), 12);
    expect(miterOffset(convex, 30)).toBeCloseTo(-30 * Math.tan(Math.PI / 6), 12);
    expect(miterCutExtra(concave, 80, 30)).toBeCloseTo(50 * Math.tan(Math.PI / 6), 12);
    expect(miterCutExtra(convex, 80, 30)).toBeCloseTo(30 * Math.tan(Math.PI / 6), 12);
    const landing: SteelCornerEnd = { joint: "landing", concave: true, tanHalf: 0 };
    expect(miterOffset(landing, 30)).toBe(0);
    expect(miterCutExtra(landing, 80, 30)).toBe(0);
  });

  it("anyAngle + chamfer : limons, onglets, débit et contrôles", () => {
    for (const family of ["UPN", "IPE"] as const) {
      const p = cageProject(
        {
          kind: "cage",
          sections: [straight(1650), straight(1650)],
          junctions: [{ angle: 45, mode: "winders", well: chamfer() }],
        },
        "steel-profile",
        { family },
      );
      const { m, r } = profiled(p);
      expect(
        keys(m).filter((k) => k !== "structure.steelProfile.error.noSectionPasses"),
        family,
      ).toEqual([]);
      expect(marks(m), family).toEqual(["LI1", "LE1", "LIC1", "LI2", "LE2"]);
      const s = r.section!;
      const shift = s.shape === "I" ? (s.b - s.tw) / 2 : 0;
      const le1 = r.stringers.find((x) => x.face.mark === "LE1")!;
      // Nom : face de cage et section.
      expect(FR.t(le1.part.name)).toBe(`Limon mural acier, tronçon 1, ${s.name}`);
      // Onglet rentrant à 45° de déviation (φ = 45°) : débit = barre + (b − shift)·tan 22,5° / cos α.
      const t = Math.tan(Math.PI / 8);
      const alpha = Math.atan(le1.line.slope);
      const extra = ((s.b - shift) * t) / Math.cos(alpha);
      const barLength = le1.cutLength - extra;
      expect(barLength).toBeGreaterThan(0);
      const joints = le1.part.flat!.lines.filter((l) => l.kind === "joint");
      expect(joints.map((l) => l.label?.key)).toContain("structure.steelProfile.joint.wallCorner");
      expect(
        FR.t(
          joints.find((l) => l.label?.key === "structure.steelProfile.joint.wallCorner")!.label!,
        ),
      ).toContain("onglet 22,5° en plan");
      // Aucun aboutage : pas de soudure bout à bout, EXC1.
      expect(r.executionClass, family).toBe("EXC1");
      // Débit : chaque limon dans le calepinage de sa section.
      const cut = r.cutting[s.name]!;
      const pieces = [...cut.bars.flatMap((b) => b.pieces), ...cut.oversize].map((x) => x.mark);
      for (const x of r.stringers) expect(pieces, x.face.mark).toContain(x.face.mark);
      // Raccords (onglets et aboutages) contrôlés côté par côté.
      const miter = m.compliance.results.filter((x) => x.ruleId === "FAB_ONGLET_RACCORD");
      expect(miter.length).toBeGreaterThan(0);
      expect(
        miter.map((x) => x.status),
        family,
      ).not.toContain("violation");
      expectCarriedBothSides(profileBuilt(r), m.stepping.treads);
      expectPositiveLengths(m, profileBuilt(r));
    }
  });

  it("variableWidth : trapèze, largeur tributaire = plus grande largeur", () => {
    const p = cageProject(
      {
        kind: "cage",
        sections: [straight(1450, 900, 1200), straight(1400, 1200)],
        junctions: [{ angle: 90, mode: "winders", well: chamfer(300) }],
      },
      "steel-profile",
      { section: "UPN 200" },
    );
    const { m, r } = profiled(p);
    expect(keys(m)).toEqual([]);
    expect(r.stringers.length).toBe(5);
    expectCarriedBothSides(profileBuilt(r), m.stepping.treads);
  });

  it("palier droit refusé par le garde-fou (ligne d'appui inclinée sur un palier de niveau)", () => {
    for (const widths of [
      [900, 900],
      [900, 1100],
    ] as const) {
      const m = buildModel(
        cageProject(
          {
            kind: "cage",
            sections: [straight(1890, widths[0]), straight(1620, widths[1])],
            junctions: [{ angle: 0, mode: "landing", depth: 1000 }],
          },
          "steel-profile",
        ),
        { memo: false },
      );
      expect(keys(m)).toEqual(["structure.cageUnsupported"]);
      expect(FR.t(m.errors[0]!)).toContain("palier droit");
      expect(marks(m)).toEqual([]);
    }
  });

  it("onglets plus longs que le pan coupé : limon non généré, erreur explicite", () => {
    const fiber = (concaveStart: boolean, concaveEnd: boolean, t: number) =>
      profileMiterFiberLength(
        {
          face: {
            start: "corner",
            end: "corner",
            startCorner: { joint: "jour", concave: concaveStart, tanHalf: t },
            endCorner: { joint: "jour", concave: concaveEnd, tanHalf: t },
          } as never,
          uLo: 0,
          uHi: 100,
        },
        80,
      );
    expect(fiber(false, false, 0.5)).toBeCloseTo(20, 12);
    expect(fiber(true, true, 0.5)).toBe(100);
    expect(fiber(true, false, 0.5)).toBe(100);
    const p = cageProject(
      {
        kind: "cage",
        sections: [straight(1650), straight(1650)],
        junctions: [{ angle: 90, mode: "winders", well: chamfer(20) }],
      },
      "steel-profile",
      { family: "IPE" },
    );
    const { m, r } = profiled(p);
    expect(keys(m).filter((k) => k !== "structure.steelProfile.error.noSectionPasses")).toEqual([
      "structure.steel.error.cageFaceTooShort",
    ]);
    expect(marks(m)).toEqual(["LI1", "LE1", "LI2", "LE2"]);
    expect(
      FR.t(m.errors.find((e) => e.key === "structure.steel.error.cageFaceTooShort")!),
    ).toContain("LIC1");
    expectPositiveLengths(m, profileBuilt(r));
  });

  it("jour en arc : contrôle de cintrage des profilés, comme la volée équivalente", () => {
    const layout = {
      kind: "cage" as const,
      sections: [straight(1500), straight(900)],
      junctions: [
        { angle: -90, mode: "landing" as const, well: { kind: "arc" as const, radius: 100 } },
      ],
    };
    const m = buildModel(cageProject(layout, "steel-profile"), { memo: false });
    expect(keys(m).filter((k) => k !== "structure.steelProfile.error.noSectionPasses")).toEqual([
      "structure.steel.error.arcWellCage",
    ]);
    const bend = m.compliance.results.filter((x) => x.ruleId === "FAB_CINTRAGE_PROFILE");
    expect(bend.map((x) => x.status)).toEqual(["violation"]);
  });
});

// ------------------------------------------------------------------ propriétés

/** Cages tirées parmi les fonctions déclarées : tronçons droits, angles de même sens, pans
 * coupés (jour) aux tournants, paliers droits (`landings`), largeurs éventuellement variables ;
 * retraits du pan coupé entre `setback.min` et `setback.max`. */
const cageArbOf = (landings: boolean, setback = { min: 200, max: 350 }) =>
  fc
    .record({
      sections: fc.array(
        fc.record({
          length: fc.integer({ min: 900, max: 2200 }),
          width: fc.integer({ min: 800, max: 1100 }),
          widthEnd: fc.option(fc.integer({ min: 800, max: 1100 }), { nil: undefined }),
        }),
        { minLength: 1, maxLength: 3 },
      ),
      junctions: fc.array(
        fc.record({
          landing: landings ? fc.boolean() : fc.constant(false),
          angle: fc.integer({ min: 30, max: 120 }),
          setback: fc.integer(setback),
          depth: fc.integer({ min: 800, max: 1200 }),
        }),
        { minLength: 2, maxLength: 2 },
      ),
      sign: fc.constantFrom(1, -1),
    })
    .map((r): CageLayoutSpecInput => ({
      kind: "cage",
      sections: r.sections.map((s) => straight(s.length, s.width, s.widthEnd)),
      junctions: r.junctions.slice(0, r.sections.length - 1).map((j) =>
        j.landing
          ? { angle: 0, mode: "landing" as const, depth: j.depth }
          : {
              angle: r.sign * j.angle,
              mode: "winders" as const,
              well: chamfer(j.setback),
            },
      ),
    }));
const cageArb = cageArbOf(true);

describe("propriétés : cages tirées parmi les fonctions déclarées", () => {
  it.each([
    ["steel-flat", {}],
    ["steel-flat", { treadKind: "folded-steel" }],
    ["steel-profile", {}],
  ] as const)(
    "%s %j : ne lève jamais, aucun refus, pièces, marches portées des deux côtés, longueurs > 0",
    (kind, params) => {
      let built = 0;
      let runs = 0;
      fc.assert(
        fc.property(cageArbOf(kind !== "steel-profile"), (layout) => {
          runs++;
          const p = cageProject(layout, kind, params);
          let m!: Model;
          expect(() => (m = buildModel(p, { memo: false }))).not.toThrow();
          const k = keys(m);
          expect(k).not.toContain("structure.cageUnsupported");
          expect(k).not.toContain("pipeline.internalError");
          // Tracé ou découpage impossible (tronçon trop court, tronçons qui se recouvrent après
          // deux grands tournants de même sens, etc.) : hors du domaine de la propriété.
          if (m.stepping.treads.length === 0 || k.some((x) => x.startsWith("layout."))) return;
          built++;
          expect(
            k.filter(
              (x) =>
                x.startsWith("structure.") && x !== "structure.steelProfile.error.noSectionPasses",
            ),
          ).toEqual([]);
          const b =
            kind === "steel-flat"
              ? flatBuilt(
                  buildSteelFlat(
                    { project: p, layout: m.layout, stepping: m.stepping },
                    SteelFlatParamsSchema.parse(params),
                  ),
                )
              : profileBuilt(
                  buildSteelProfile(
                    { project: p, layout: m.layout, stepping: m.stepping },
                    SteelProfileParamsSchema.parse(params),
                  ),
                );
          expect(b.length).toBeGreaterThan(0);
          expectPositiveLengths(m, b);
          expectMarksUnified(m);
          expectMarkNames(m);
          expectCarriedBothSides(b, m.stepping.treads);
          if (kind === "steel-flat") expectButtJoints(b, E);
        }),
        { numRuns: 120, seed: 66 },
      );
      expect(built / runs).toBeGreaterThan(0.5);
    },
  );
});

describe("propriété : pans coupés courts devant l'épaisseur des plats et le débord des profilés", () => {
  it.each([
    ["steel-flat", { thickness: 30 }],
    ["steel-profile", { family: "IPE" }],
  ] as const)(
    "%s %j : ne lève jamais ; limon du pan généré de longueur > 0, ou erreur explicite",
    (kind, params) => {
      fc.assert(
        fc.property(cageArbOf(false, { min: 1, max: 60 }), (layout) => {
          const p = cageProject(layout, kind, params);
          let m!: Model;
          expect(() => (m = buildModel(p, { memo: false }))).not.toThrow();
          if (m.stepping.treads.length === 0) return;
          if (m.errors.some((e) => e.key.startsWith("layout."))) return;
          const b =
            kind === "steel-flat"
              ? flatBuilt(
                  buildSteelFlat(
                    { project: p, layout: m.layout, stepping: m.stepping },
                    SteelFlatParamsSchema.parse(params),
                  ),
                )
              : profileBuilt(
                  buildSteelProfile(
                    { project: p, layout: m.layout, stepping: m.stepping },
                    SteelProfileParamsSchema.parse(params),
                  ),
                );
          expectPositiveLengths(m, b);
          expectMarksUnified(m);
          expectMarkNames(m);
          for (const x of b)
            expect(x.uHi - x.uLo, x.face.mark).toBeGreaterThan(MIN_CAGE_STRINGER_LENGTH);
          // Chaque pan coupé de plus de 1 mm : limon construit, ou erreur qui le nomme (profilés :
          // aussi la remarque d'un limon sans nez dans sa portée).
          const geo = stairGeometry(p, m.layout);
          const said = [...m.errors, ...(m.notes ?? [])]
            .filter(
              (e) =>
                e.key === "structure.steel.error.cageFaceTooShort" ||
                e.key === "structure.steelProfile.note.noNosing",
            )
            .map((e) => FR.t(e));
          for (const f of geo.faces) {
            if (f.junctionKind !== "chamfer" || !(f.length > MIN_CAGE_STRINGER_LENGTH)) continue;
            const mark = `LIC${f.junction! + 1}`;
            const built = b.some((x) => x.face.mark === mark);
            expect(built || said.some((t) => t.includes(mark)), mark).toBe(true);
          }
        }),
        { numRuns: 80, seed: 61 },
      );
    },
  );
});

describe("propriété : repères des cages acier à tolérance d'identité tirée (F10 Q3, C3)", () => {
  it("T ∈ [0, 2] : une ligne de débit par repère, CR / PS à au plus T (longueurs réelles), débit sur la plus courte", () => {
    let built = 0;
    fc.assert(
      fc.property(cageArbOf(true), fc.double({ min: 0, max: 2, noNaN: true }), (layout, t) => {
        const base = cageProject(layout, "steel-flat");
        const p: Project = { ...base, workshop: { ...base.workshop, identicalPartTolerance: t } };
        const m = buildModel(p, { memo: false });
        if (m.stepping.treads.length === 0 || m.errors.length > 0) return;
        built++;
        expectMarksUnified(m);
        expectMarkNames(m);
        const bars = new Map<string, number[]>();
        for (const x of m.parts) {
          if (!/^(CR|PS)\d+$/.test(x.mark) || x.solid.kind !== "extrusion") continue;
          bars.set(x.mark, [...(bars.get(x.mark) ?? []), x.solid.depth]);
        }
        for (const real of bars.values())
          expect(Math.max(...real) - Math.min(...real)).toBeLessThanOrEqual(t + GEOM_EPS);
        for (const x of m.parts) {
          const real = bars.get(x.mark);
          if (real) expect(x.stock!.length).toBeCloseTo(Math.min(...real), 9);
        }
      }),
      { numRuns: 30, seed: 71 },
    );
    expect(built).toBeGreaterThan(10);
  }, 120_000);
});
