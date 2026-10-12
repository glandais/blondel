/**
 * Limons à la française sur une cage saisie (ADR-0010, sous-lot 6a) : une fonction de cage par
 * bloc (`capabilities.cage` de `wood-housed` : angle quelconque, largeur variable, palier droit,
 * pan coupé), puis une propriété fast-check sur des cages tirées parmi ces seules fonctions.
 *
 * Conventions vérifiées (à valider, QUESTIONS F16) : limons droits assemblés à queues à tout
 * angle (C §1.9) ; angle rentrant → limon prolongé de e·tan(φ/2) jusqu'à l'arête extérieure du
 * coin ; angle saillant (pan coupé côté jour) → limons arrêtés au coin ; palier droit à bords
 * alignés → raccord bout à bout au milieu du palier ; bord de palier non aligné → limon propre ;
 * jour vif ou en arc sur une cage → limons de jour non générés, erreur claire (pas de poteau).
 */
import fc from "fast-check";
import { translatorFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import * as V from "../geom2d/vec.js";
import type { Model, Tread } from "../model/derived.js";
import type { Vec2 } from "../model/primitives.js";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type CageLayoutSpec,
  type CageLayoutSpecInput,
  type Project,
} from "../model/project.js";
import { CAGE_FEATURE_LABELS, cageFeatures } from "../model/cageFeatures.js";
import { buildBasicParts } from "../parts/basic.js";
import { buildModel } from "../pipeline/build.js";
import { resolveWorkshopProfile } from "../workshop/profile.js";
import { housingsInside } from "./development.js";
import { area, isSimplePolygon } from "./geom.js";
import { readPlanExtrusion } from "./housing.js";
import { stairGeometry, type LandingMerge } from "./legs.js";
import { landingPitchGap } from "./pitch.test-helpers.js";
import { QUANTITY_VOLUME_M3 } from "./quantities.js";
import { structureCageFeatures } from "./registry.js";
import {
  WoodHousedParamsSchema,
  buildWoodHoused,
  snapToMergedLandings,
  type HousedResult,
  type HousedStringer,
} from "./woodHoused.js";

const FR = translatorFor("fr");
const E_STRINGER = WoodHousedParamsSchema.parse({}).thickness;

const straight = (length: number, width = 900, widthEnd?: number) => ({
  axis: { kind: "straight" as const, length },
  width,
  ...(widthEnd !== undefined ? { widthEnd } : {}),
});
const chamfer = (d = 150) => ({ kind: "chamfer" as const, setbackIn: d, setbackOut: d });

function cageProject(layout: CageLayoutSpecInput, structure = "wood-housed"): Project {
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: { floorToFloor: 2700, upperSlabThickness: 200 },
    stair: {
      placement: { origin: { x: 0, y: 0 }, rotation: 0 },
      layout,
      structure: { kind: structure },
    },
  });
}

function housed(project: Project): { m: Model; r: HousedResult } {
  const m = buildModel(project, { memo: false });
  const r = buildWoodHoused(
    { project, layout: m.layout, stepping: m.stepping },
    WoodHousedParamsSchema.parse(project.stair.structure.params ?? {}),
  );
  return { m, r };
}

const keys = (m: Model): string[] => m.errors.map((e) => e.key);
const byMark = (r: HousedResult, mark: string): HousedStringer => {
  const s = r.stringers.find((x) => x.face.mark === mark);
  expect(s, mark).toBeDefined();
  return s!;
};

/**
 * Marches dont le contour a une arête posée sur la face du limon (partie de longueur > 1 mm) dans
 * sa portée porteuse : fenêtre du développé, arrêtée au coin à une extrémité d'angle, hors de la
 * zone d'angle saillant (profondeur d'encastrement · tan(φ/2)), où une marche de la face voisine
 * ne reçoit qu'un encastrement d'angle (F16 (2)) : marches que le limon doit porter.
 */
function carriedTreads(
  s: HousedStringer,
  treads: readonly Tread[],
  depth: number,
  tol = 1e-5,
): number[] {
  const { face, development } = s;
  const on = (p: { x: number; y: number }): boolean =>
    Math.abs(V.cross(face.dir, V.sub(p, face.a))) <= tol;
  const u = (p: { x: number; y: number }): number => V.dot(V.sub(p, face.a), face.dir);
  const winLo =
    (face.start === "corner" ? Math.max(development.uLo, 0) : development.uLo) +
    depth * (face.startConvexTan ?? 0);
  const winHi =
    (face.end === "corner" ? Math.min(development.uHi, face.faceLength) : development.uHi) -
    depth * (face.endConvexTan ?? 0);
  return treads
    .filter((t) =>
      t.outline.some((p, i) => {
        const q = t.outline[(i + 1) % t.outline.length]!;
        if (!(V.distance(p, q) > 1e-5 && on(p) && on(q))) return false;
        const lo = Math.max(Math.min(u(p), u(q)), winLo);
        const hi = Math.min(Math.max(u(p), u(q)), winHi);
        return hi - lo > 1;
      }),
    )
    .map((t) => t.number);
}

/** Numéros des marches portées (mortaise numérotée) par les limons d'un côté. */
function housedOn(r: HousedResult, side: "inner" | "outer"): Set<number> {
  return new Set(
    r.stringers
      .filter((s) => s.face.side === side)
      .flatMap((s) => s.development.housings.flatMap((h) => (h.tread ? [h.tread] : []))),
  );
}

/**
 * Invariants communs des limons générés sur une cage. `tol` : distance d'une arête de marche à la
 * face qui la porte (mm) ; jusqu'à la tolérance d'alignement des bords de palier (F16 (6)) quand
 * des bords presque alignés sont fusionnés (marche coupée à la face du limon, d'au plus écart / 2).
 */
function expectSound(m: Model, r: HousedResult, tol = 1e-5): void {
  const profile = resolveWorkshopProfile(undefined);
  for (const s of r.stringers) {
    const o = s.development.outline;
    expect(isSimplePolygon(o), s.face.mark).toBe(true);
    expect(area(o), s.face.mark).toBeGreaterThan(0);
    // Chaque entaille dans le contour du limon, une par marche portée.
    expect(housingsInside(s.development, 1e-3), s.face.mark).toBe(true);
    const withTread = s.development.housings.flatMap((h) => (h.tread ? [h.tread] : []));
    expect(
      withTread.sort((a, b) => a - b),
      s.face.mark,
    ).toEqual(carriedTreads(s, m.stepping.treads, r.resolved.housingDepth, tol));
    // Débit et quantités : longueur de débit = longueur développée + surlongueur du profil.
    expect(s.face.faceLength, s.face.mark).toBeGreaterThan(0);
    expect(s.part.stock!.length).toBeCloseTo(
      s.development.box.length + profile.wood.lengthAllowance,
      6,
    );
    expect(s.part.quantities[QUANTITY_VOLUME_M3], s.face.mark).toBeGreaterThan(0);
  }
  expect(landingPitchGap(m.stepping, r.stringers)).toBeLessThan(1e-6);
}

describe("wood-housed sur une cage : capacités déclarées", () => {
  it("angle quelconque, largeur variable, palier droit, pan coupé ; le reste refusé", () => {
    expect(structureCageFeatures("wood-housed")).toEqual([
      "anyAngle",
      "variableWidth",
      "straightLanding",
      "chamfer",
    ]);
  });

  it.each([
    [
      "axe en arc",
      {
        kind: "cage",
        sections: [{ axis: { kind: "arc", radius: 2150, sweep: 100 }, width: 900 }],
        junctions: [],
      },
      ["arcAxis"],
    ],
    [
      "congé côté mur",
      {
        kind: "cage",
        sections: [straight(1500), straight(1500)],
        junctions: [
          { angle: -120, mode: "winders", wall: { kind: "arc", radius: 300 }, well: chamfer() },
        ],
      },
      ["wallArc"],
    ],
    [
      "marches rayonnantes",
      {
        kind: "cage",
        sections: [straight(1640), straight(1640)],
        junctions: [{ angle: 75, mode: "radiating", well: { kind: "arc", radius: 400 } }],
      },
      ["radiating"],
    ],
    [
      "S / Z",
      {
        kind: "cage",
        sections: [straight(1200), straight(1500), straight(1200)],
        junctions: [
          { angle: 90, mode: "landing" },
          { angle: -90, mode: "landing" },
        ],
      },
      ["oppositeTurns"],
    ],
  ] as const)("%s : refus qui ne nomme que la fonction non prise en charge", (_n, layout, f) => {
    const p = cageProject(layout as unknown as CageLayoutSpecInput);
    const m = buildModel(p, { memo: false });
    expect(keys(m)).toEqual(["structure.cageUnsupported"]);
    const text = FR.t(m.errors[0]!);
    for (const other of cageFeatures(p.stair.layout as CageLayoutSpec)) {
      const label = FR.t({ key: CAGE_FEATURE_LABELS[other] });
      if (f.includes(other as never)) expect(text).toContain(label);
      else expect(text).not.toContain(label);
    }
    expect(m.parts.some((x) => x.category === "stringer")).toBe(false);
  });
});

describe("anyAngle : jonction balancée d'angle quelconque, jour en pan coupé", () => {
  it.each([60, 120, -60, -120, 90])(
    "%s° : limons droits assemblés à queues aux angles",
    (angle) => {
      const p = cageProject({
        kind: "cage",
        sections: [straight(1650), straight(1650)],
        junctions: [{ angle, mode: "winders", well: chamfer() }],
      });
      const { m, r } = housed(p);
      expect(keys(m)).toEqual([]);
      expect(r.stringers.map((s) => s.face.mark)).toEqual(["LI1", "LE1", "LIC1", "LI2", "LE2"]);
      // Angle mural rentrant : prolongement e·tan(|θ|/2) jusqu'à l'arête extérieure du coin W.
      const reach = E_STRINGER * Math.tan((Math.abs(angle) * Math.PI) / 360);
      const le1 = byMark(r, "LE1");
      const le2 = byMark(r, "LE2");
      expect(le1.face.end).toBe("corner");
      expect(le1.face.endReach).toBeCloseTo(reach, 9);
      expect(le2.face.startReach).toBeCloseTo(reach, 9);
      expect(le1.development.uHi).toBeCloseTo(le1.face.faceLength + reach, 9);
      expect(le2.development.uLo).toBeCloseTo(-reach, 9);
      const w = m.layout.turns[0]!.outerCorner;
      expect(
        V.distance(V.addScaled(le1.face.a, le1.face.dir, le1.face.faceLength), w),
      ).toBeLessThan(1e-6);
      expect(V.distance(le2.face.a, w)).toBeLessThan(1e-6);
      // Les rives des deux limons se raccordent de niveau au coin (même hauteur des deux côtés).
      const top1 = le1.development.upperRive[le1.development.upperRive.length - 1]!.y;
      const top2 = le2.development.upperRive[0]!.y;
      expect(top1).toBeCloseTo(top2, 6);
      // Côté jour : angles saillants du pan coupé, limons arrêtés au coin (aucun prolongement).
      const li1 = byMark(r, "LI1");
      const pan = byMark(r, "LIC1");
      const li2 = byMark(r, "LI2");
      expect([li1.face.end, pan.face.start, pan.face.end, li2.face.start]).toEqual([
        "corner",
        "corner",
        "corner",
        "corner",
      ]);
      for (const reachOf of [li1.face.endReach, pan.face.startReach, pan.face.endReach]) {
        expect(reachOf).toBe(0);
      }
      expect(FR.t(pan.face.name)).toBe("Limon de jour, pan coupé de la jonction 1");
      // Assemblages à queues : libellé du coin du jour (pan coupé) et du coin mural.
      const jointKey = (s: HousedStringer): string | undefined =>
        s.part.flat!.lines.find((l) => l.kind === "joint")?.label?.key;
      expect(jointKey(li1)).toBe("structure.woodHoused.joint.jourCorner");
      expect(jointKey(le1)).toBe("structure.woodHoused.joint.wallCorner");
      // Pan coupé sur C_i : ses extrémités sont au retrait du coin K des deux faces du jour.
      const k = m.layout.turns[0]!.innerCorner;
      expect(V.distance(pan.face.a, k)).toBeCloseTo(150, 6);
      expect(V.distance(V.addScaled(pan.face.a, pan.face.dir, pan.face.faceLength), k)).toBeCloseTo(
        150,
        6,
      );
      // Toutes les marches sont portées côté jour (limons et pan) et côté mur.
      const all = m.stepping.treads.map((t) => t.number);
      expect([...housedOn(r, "inner")].sort((a, b) => a - b)).toEqual(all);
      expect([...housedOn(r, "outer")].sort((a, b) => a - b)).toEqual(all);
      // Collet : les marches balancées dont le collet touche le pan y sont encastrées.
      const panTreads = new Set(
        pan.development.housings.flatMap((h) => (h.tread ? [h.tread] : [])),
      );
      expect(panTreads.size).toBeGreaterThan(0);
      for (const t of panTreads) expect(m.stepping.treads[t - 1]!.kind).toBe("winder");
      expectSound(m, r);
    },
  );

  it.each([90, 60])(
    "%s° à jour vif : erreur claire (pas de poteau sur une cage), limons muraux seuls",
    (angle) => {
      const p = cageProject({
        kind: "cage",
        sections: [straight(1650), straight(1650)],
        junctions: [{ angle, mode: "winders" }],
      });
      const { m, r } = housed(p);
      expect(keys(m)).toEqual(["structure.woodHoused.sharpJourCage"]);
      expect(FR.t(m.errors[0]!)).toContain("pan coupé");
      expect(r.stringers.map((s) => s.face.mark)).toEqual(["LE1", "LE2"]);
      expectSound(m, r);
    },
  );

  it.each([
    [90, 1200, 300, 150],
    [90, 1500, 300, 150],
    [60, 1500, 400, 200],
  ])(
    "%s°, tronçon médian à 2 × retrait (partie droite nulle) : pans coupés, aucune corde",
    (angle, outer, middle, d) => {
      const p = cageProject({
        kind: "cage",
        sections: [straight(outer), straight(middle), straight(outer)],
        junctions: [
          { angle, mode: "winders", well: chamfer(d) },
          { angle, mode: "winders", well: chamfer(d) },
        ],
      });
      const { m, r } = housed(p);
      expect(keys(m)).toEqual([]);
      expect(r.stringers.map((s) => s.face.mark)).toEqual([
        "LI1",
        "LE1",
        "LIC1",
        "LE2",
        "LIC2",
        "LI3",
        "LE3",
      ]);
      expect((m.notes ?? []).map((n) => n.key)).toContain(
        "structure.woodHoused.noInnerStraightSection",
      );
      // Chaque face de jour est portée par C_i (pas de corde dans le vide du jour).
      for (const s of r.stringers.filter((x) => x.face.side === "inner")) {
        const mid = V.addScaled(s.face.a, s.face.dir, s.face.faceLength / 2);
        expect(
          m.layout.inner.segments.some(
            (g) =>
              g.kind === "line" &&
              Math.abs(V.cross(V.normalize(V.sub(g.b, g.a)), V.sub(mid, g.a))) < 1e-6,
          ),
          s.face.mark,
        ).toBe(true);
      }
      const all = m.stepping.treads.map((t) => t.number);
      expect([...housedOn(r, "inner")].sort((a, b) => a - b)).toEqual(all);
      expect([...housedOn(r, "outer")].sort((a, b) => a - b)).toEqual(all);
      expectSound(m, r);
    },
  );

  it("jour en arc : erreur claire, limons muraux seuls", () => {
    const p = cageProject({
      kind: "cage",
      sections: [straight(1650), straight(1650)],
      junctions: [{ angle: 60, mode: "winders", well: { kind: "arc", radius: 200 } }],
    });
    const { m, r } = housed(p);
    expect(keys(m)).toEqual(["structure.woodHoused.arcJourCage"]);
    expect(r.stringers.map((s) => s.face.mark)).toEqual(["LE1", "LE2"]);
  });
});

describe("straightLanding : limons le long d'un palier droit", () => {
  it("bords alignés : raccord bout à bout au milieu du palier, rives de niveau au raccord", () => {
    const p = cageProject({
      kind: "cage",
      sections: [straight(1890), straight(1620)],
      junctions: [{ angle: 0, mode: "landing", depth: 1000 }],
    });
    const { m, r } = housed(p);
    expect(keys(m)).toEqual([]);
    expect(r.stringers.map((s) => s.face.mark)).toEqual(["LI1", "LE1", "LI2", "LE2"]);
    const landing = m.stepping.treads.find((t) => t.kind === "landing")!;
    for (const side of ["I", "E"] as const) {
      const a = byMark(r, `L${side}1`);
      const b = byMark(r, `L${side}2`);
      expect(a.face.end).toBe("corner");
      expect(b.face.start).toBe("corner");
      expect(a.face.endReach).toBe(0);
      expect(b.face.startReach).toBe(0);
      // Faces alignées, contiguës, raccord au milieu du palier (1 890 + 1 000 / 2).
      expect(V.cross(a.face.dir, b.face.dir)).toBeCloseTo(0, 12);
      const joint = V.addScaled(a.face.a, a.face.dir, a.face.faceLength);
      expect(V.distance(joint, b.face.a)).toBeLessThan(1e-9);
      expect(a.face.faceLength).toBeCloseTo(2390, 6);
      expect(a.face.faceLength + b.face.faceLength).toBeCloseTo(1890 + 1000 + 1620, 6);
      // Le palier est encastré dans les deux limons du raccord.
      for (const s of [a, b]) {
        expect(s.development.housings.some((h) => h.tread === landing.number)).toBe(true);
      }
      // Raccord dans la partie de niveau : mêmes rives de part et d'autre.
      const ua = a.development.upperRive;
      const ub = b.development.upperRive;
      expect(ua[ua.length - 1]!.y).toBeCloseTo(ub[0]!.y, 6);
      expect(ua[ua.length - 1]!.y).toBeCloseTo(ua[ua.length - 2]!.y, 6);
      const label = a.part.flat!.lines.find((l) => l.kind === "joint")?.label;
      expect(label?.key).toBe("structure.woodHoused.joint.landingSplice");
    }
    expectSound(m, r);
  });

  it("bords presque alignés, tolérance nulle : le palier n'est porté que par les faces où il pose", () => {
    // Écart 1,5 mm de chaque côté (largeurs 754 → 753 puis 750, axes centrés) ; tolérance
    // d'alignement réglée à 0 dans le profil : comportement d'avant le sous-lot 6a2.
    const p = ProjectSchema.parse({
      ...cageProject({
        kind: "cage",
        sections: [straight(600, 754, 753), straight(600, 750)],
        junctions: [{ angle: 0, mode: "landing", depth: 700 }],
      }),
      site: { floorToFloor: 2400, upperSlabThickness: 200 },
      workshop: { wood: { landingAlignmentTolerance: 0 } },
    });
    const { m, r } = housed(p);
    const landing = m.stepping.treads.find((t) => t.kind === "landing")!;
    expect(landing).toBeDefined();
    expect(r.stringers.map((s) => s.face.mark)).toEqual([
      "LI1",
      "LE1",
      "LIP1",
      "LEP1",
      "LI2",
      "LE2",
    ]);
    // LI1 s'arrête au coin du bord du palier : le palier n'y pose pas (pas de mortaise portée).
    expect(byMark(r, "LI1").development.housings.some((h) => h.tread === landing.number)).toBe(
      false,
    );
    expectSound(m, r);
    // Même cage, tolérance par défaut (2 mm) : bords fusionnés, raccord au milieu du palier.
    const pMerged = ProjectSchema.parse({ ...p, workshop: undefined });
    const merged = housed(pMerged);
    expect(merged.r.stringers.map((s) => s.face.mark)).toEqual(["LI1", "LE1", "LI2", "LE2"]);
    for (const s of merged.r.stringers) {
      expect(
        s.development.housings.some((h) => h.tread === landing.number),
        s.face.mark,
      ).toBe(true);
    }
    expectSound(merged.m, merged.r, 2);
    // Bord d'avant incliné, écart des deux côtés : palier recoupé sur les deux faces (ressaut au
    // raccord de chaque côté, 6 + 2 × 2 sommets).
    expect(expectSnappedLanding(pMerged, merged.m, merged.r)).toHaveLength(10);
  });

  it("largeurs différentes de part et d'autre : limon propre au bord du palier, angles", () => {
    const p = cageProject({
      kind: "cage",
      sections: [straight(1890, 900), straight(1620, 1100)],
      junctions: [{ angle: 0, mode: "landing", depth: 1000 }],
    });
    const { m, r } = housed(p);
    expect(keys(m)).toEqual([]);
    expect(r.stringers.map((s) => s.face.mark)).toEqual([
      "LI1",
      "LE1",
      "LIP1",
      "LEP1",
      "LI2",
      "LE2",
    ]);
    const lip = byMark(r, "LIP1");
    expect(FR.t(lip.face.name)).toBe("Limon de jour, palier droit de la jonction 1");
    // Bord incliné du palier : un angle saillant et un angle rentrant (prolongé) par côté.
    const reaches = [lip.face.startReach!, lip.face.endReach!].sort((a, b) => a - b);
    expect(reaches[0]).toBe(0);
    expect(reaches[1]).toBeGreaterThan(0);
    const all = m.stepping.treads.map((t) => t.number);
    expect([...housedOn(r, "inner")].sort((a, b) => a - b)).toEqual(all);
    expect([...housedOn(r, "outer")].sort((a, b) => a - b)).toEqual(all);
    expectSound(m, r);
  });
});

/** Géométrie des faces telle que `wood-housed` la lit (tolérance du profil, épaisseur des limons). */
function housedGeometry(project: Project, m: Model, tolerance?: number) {
  return stairGeometry(project, m.layout, {
    landingAlignmentTolerance:
      tolerance ?? resolveWorkshopProfile(project.workshop).wood.landingAlignmentTolerance,
    stringerThickness: E_STRINGER,
  });
}

/**
 * Palier recoupé à la face des limons (`snapToMergedLandings`, F16 (6)) : contour simple ; sommets
 * du contour de base inchangés ou déplacés d'au plus écart / 2 sur la face d'avant ou d'après ;
 * deux sommets insérés par bord fusionné, consécutifs, projections du milieu du palier sur les
 * deux faces (ressaut d'au plus l'écart) ; pièce remplacée dans la sortie du plugin. Rend le
 * contour recoupé.
 */
function expectSnappedLanding(project: Project, m: Model, r: HousedResult): readonly Vec2[] {
  const landing = m.stepping.treads.find((t) => t.kind === "landing")!;
  const merges = housedGeometry(project, m).landingMerges;
  expect(merges.length).toBeGreaterThan(0);
  const id = `tread-${landing.number}`;
  const basePart = buildBasicParts(project, m.layout, m.stepping).parts.find((x) => x.id === id)!;
  const base = readPlanExtrusion(basePart.solid)!.outline;
  const snapped = snapToMergedLandings(base, merges);
  expect(isSimplePolygon(snapped)).toBe(true);
  expect(snapped).toHaveLength(base.length + 2 * merges.length);
  const onto = (l: LandingMerge["before"], q: Vec2): Vec2 =>
    V.addScaled(l.a, l.dir, V.dot(V.sub(q, l.a), l.dir));
  const onLine = (l: LandingMerge["before"], q: Vec2): boolean =>
    Math.abs(V.cross(l.dir, V.sub(q, l.a))) < 1e-9;
  const inserted = new Set<number>();
  for (const g of merges) {
    const mid = V.lerp(g.a, g.b, 0.5);
    const mb = onto(g.before, mid);
    const ma = onto(g.after, mid);
    expect(V.distance(mb, ma)).toBeLessThanOrEqual(g.gap + 1e-9);
    const ib = snapped.findIndex((q) => V.distance(q, mb) < 1e-9);
    const ia = snapped.findIndex((q) => V.distance(q, ma) < 1e-9);
    expect(ib).toBeGreaterThanOrEqual(0);
    expect(ia).toBeGreaterThanOrEqual(0);
    const n = snapped.length;
    expect((ib + 1) % n === ia || (ia + 1) % n === ib).toBe(true);
    // Ordre : chaque projection du milieu prolonge l'arête de la face sur laquelle elle est
    // (bord coupé à la face d'avant puis d'après, ressaut perpendiculaire entre les deux).
    const [first, second] = (ib + 1) % n === ia ? [ib, ia] : [ia, ib];
    const lineOf = (i: number) => (i === ib ? g.before : g.after);
    expect(onLine(lineOf(first), snapped[(first + n - 1) % n]!)).toBe(true);
    expect(onLine(lineOf(second), snapped[(second + 1) % n]!)).toBe(true);
    inserted.add(ib).add(ia);
  }
  const kept = snapped.filter((_, i) => !inserted.has(i));
  expect(kept).toHaveLength(base.length);
  const maxGap = Math.max(...merges.map((g) => g.gap));
  kept.forEach((q, i) => {
    const d = V.distance(q, base[i]!);
    expect(d).toBeLessThanOrEqual(maxGap / 2 + 1e-9);
    if (d > 0) expect(merges.some((g) => onLine(g.before, q) || onLine(g.after, q))).toBe(true);
  });
  // Pièce remplacée : contour prolongé dans les limons, à partir du contour recoupé.
  const out = r.output.parts.find((x) => x.id === id);
  expect(out).toBeDefined();
  const ext = readPlanExtrusion(out!.solid)!.outline;
  expect(isSimplePolygon(ext)).toBe(true);
  expect(area(ext)).toBeGreaterThan(area(snapped));
  return snapped;
}

/**
 * Palier droit entre deux tronçons de largeurs voisines, axes ancrés du même côté : bords alignés
 * du côté de l'ancrage, écart `gap` de l'autre (jour pour un ancrage à droite, jour à gauche).
 */
function offsetLanding(gap: number, anchor: "left" | "right", workshop?: unknown): Project {
  return ProjectSchema.parse({
    ...cageProject({
      kind: "cage",
      sections: [
        { ...straight(1890, 900), anchor },
        { ...straight(1620, 900 + gap), anchor },
      ],
      junctions: [{ angle: 0, mode: "landing", depth: 1000 }],
    }),
    ...(workshop !== undefined ? { workshop } : {}),
  });
}

/** Limons fusionnés d'un côté (`I` ou `E`) : raccord au milieu du palier, palier encastré. */
function expectMerged(m: Model, r: HousedResult, side: "I" | "E", gap: number): void {
  const landing = m.stepping.treads.find((t) => t.kind === "landing")!;
  const a = byMark(r, `L${side}1`);
  const b = byMark(r, `L${side}2`);
  expect(a.face.end).toBe("corner");
  expect(b.face.start).toBe("corner");
  expect(a.face.endReach).toBe(0);
  expect(b.face.startReach).toBe(0);
  expect(a.part.flat!.lines.find((l) => l.kind === "joint")?.label?.key).toBe(
    "structure.woodHoused.joint.landingSplice",
  );
  // Chaque limon reste le long de la face de son tronçon, prolongée jusqu'au milieu du palier :
  // les deux faces sont à `gap` l'une de l'autre (bords parallèles).
  expect(Math.abs(V.cross(a.face.dir, b.face.dir))).toBeLessThan(1e-12);
  expect(Math.abs(V.cross(a.face.dir, V.sub(b.face.a, a.face.a)))).toBeCloseTo(gap, 9);
  expect(a.face.faceLength).toBeCloseTo(1890 + 500, 6);
  for (const s of [a, b]) {
    expect(
      s.development.housings.some((h) => h.tread === landing.number),
      s.face.mark,
    ).toBe(true);
  }
  // Palier recoupé à la face des limons et encastré jusqu'au raccord : sa mortaise va jusqu'au
  // bout du limon d'avant et part du début du limon d'après.
  const pocket = (s: HousedStringer): number[] =>
    s.development.housings
      .filter((h) => h.tread === landing.number)
      .flatMap((h) => h.polygons.flatMap((poly) => poly.map((pt) => pt.x)));
  expect(Math.max(...pocket(a))).toBeCloseTo(a.face.faceLength, 6);
  expect(Math.min(...pocket(b))).toBeCloseTo(0, 6);
}

describe("tolérance d'alignement des bords de palier droit (F16 (6), sous-lot 6a2)", () => {
  it.each([
    [0, true],
    [1, true],
    [2, true],
    [3, false],
    [4, false],
  ])("écart latéral %d mm : fusion jusqu'à 2 mm inclus (tolérance par défaut)", (gap, merged) => {
    for (const anchor of ["right", "left"] as const) {
      // Ancrage à droite : bords alignés côté mur, écart côté jour (jour à gauche) ; à gauche,
      // l'inverse.
      const side = anchor === "right" ? "I" : "E";
      const p = offsetLanding(gap, anchor);
      const { m, r } = housed(p);
      expect(keys(m)).toEqual([]);
      expect(m.layout.innerSide).toBe("left");
      if (merged) {
        expect(r.stringers.map((s) => s.face.mark)).toEqual(["LI1", "LE1", "LI2", "LE2"]);
        expectMerged(m, r, side, gap);
        expectMerged(m, r, side === "I" ? "E" : "I", 0);
        // Bord du palier côté écart coupé en deux au raccord (ressaut, 6 + 2 sommets).
        if (gap > 0) expect(expectSnappedLanding(p, m, r)).toHaveLength(8);
      } else {
        // Au-delà : limon propre au bord du palier, assemblé à queues (F16 (4)).
        expect(r.stringers.map((s) => s.face.mark)).toEqual([
          "LI1",
          "LE1",
          `L${side}P1`,
          "LI2",
          "LE2",
        ]);
        expect(byMark(r, `L${side}1`).face.end).toBe("corner");
        expect(
          byMark(r, `L${side}1`).part.flat!.lines.find((l) => l.kind === "joint")?.label?.key,
        ).not.toBe("structure.woodHoused.joint.landingSplice");
      }
      const all = m.stepping.treads.map((t) => t.number);
      expect([...housedOn(r, "inner")].sort((a, b) => a - b)).toEqual(all);
      expect([...housedOn(r, "outer")].sort((a, b) => a - b)).toEqual(all);
      expectSound(m, r, merged ? 2 : 1e-5);
    }
  });

  it("écart angulaire ramené sur le palier : 1,999996 mm fusionné, 2,01 mm non", () => {
    // Tronçon 1 en trapèze 900 → 902 sur 1 000 mm (bord du jour incliné de 2 / 1 000), tronçon 2
    // de 902 : écart = palier · 2 / √(1 000² + 2²), 1,999996 mm pour 1 000, 2,009996 pour 1 005.
    const angular = (depth: number): Project =>
      cageProject({
        kind: "cage",
        sections: [
          { ...straight(1000, 900, 902), anchor: "right" },
          { ...straight(1620, 902), anchor: "right" },
        ],
        junctions: [{ angle: 0, mode: "landing", depth }],
      });
    const at = housed(angular(1000));
    expectSnappedLanding(angular(1000), at.m, at.r);
    expect(at.r.stringers.map((s) => s.face.mark)).toEqual(["LI1", "LE1", "LI2", "LE2"]);
    expect(byMark(at.r, "LI1").face.end).toBe("corner");
    expect(byMark(at.r, "LI1").part.flat!.lines.find((l) => l.kind === "joint")?.label?.key).toBe(
      "structure.woodHoused.joint.landingSplice",
    );
    expectSound(at.m, at.r, 2);
    const over = housed(angular(1005));
    // Bord du palier dans le prolongement du bord incliné : une face LI1 jusqu'au coin, puis
    // angle (queues) avec LI2, pas de raccord de palier.
    expect(over.r.stringers.map((s) => s.face.mark)).toEqual(["LI1", "LE1", "LI2", "LE2"]);
    expect(byMark(over.r, "LI1").part.flat!.lines.find((l) => l.kind === "joint")?.label?.key).toBe(
      "structure.woodHoused.joint.jourCorner",
    );
    expectSound(over.m, over.r);
  });

  it("tolérance réglée dans le profil d'atelier : 0 refuse 1 mm, 5 fusionne 4 mm", () => {
    const strict = housed(offsetLanding(1, "right", { wood: { landingAlignmentTolerance: 0 } }));
    expect(strict.r.stringers.map((s) => s.face.mark)).toEqual([
      "LI1",
      "LE1",
      "LIP1",
      "LI2",
      "LE2",
    ]);
    expectSound(strict.m, strict.r);
    const pWide = offsetLanding(4, "right", { wood: { landingAlignmentTolerance: 5 } });
    const wide = housed(pWide);
    expect(wide.r.stringers.map((s) => s.face.mark)).toEqual(["LI1", "LE1", "LI2", "LE2"]);
    expectMerged(wide.m, wide.r, "I", 4);
    expectSnappedLanding(pWide, wide.m, wide.r);
    expectSound(wide.m, wide.r, 5);
  });

  it.each([1, 2, 3])(
    "palier très court (%d mm) après un trapèze marqué : vrai angle rentrant, jamais de raccord",
    (depth) => {
      // Écart mesuré sur le palier < 2 mm, mais faces à ≈ 19,65° : |sin α| · e ≫ tolérance.
      const p = cageProject({
        kind: "cage",
        sections: [
          { ...straight(1400, 900, 1400), anchor: "right" },
          { ...straight(1620, 1400), anchor: "right" },
        ],
        junctions: [{ angle: 0, mode: "landing", depth }],
      });
      const { m, r } = housed(p);
      const geo = housedGeometry(p, m);
      expect(geo.landingMerges).toEqual([]);
      // Sans la borne d'angle, l'écart seul serait sous la tolérance.
      const loose = stairGeometry(p, m.layout, { landingAlignmentTolerance: 2 });
      expect(loose.landingMerges.map((g) => g.gap)[0]).toBeLessThan(2);
      // Mêmes faces qu'avec une tolérance nulle : angle rentrant côté jour, LI1 prolongé de
      // e·tan(φ/2), assemblé à queues.
      const exact = housedGeometry(p, m, 0);
      expect(geo.faces.map((f) => [f.side, f.start.kind, f.end.kind])).toEqual(
        exact.faces.map((f) => [f.side, f.start.kind, f.end.kind]),
      );
      const li1 = byMark(r, "LI1");
      expect(li1.face.end).toBe("corner");
      expect(li1.face.endReach).toBeGreaterThan(5);
      expect(li1.part.flat!.lines.find((l) => l.kind === "joint")?.label?.key).toBe(
        "structure.woodHoused.joint.jourCorner",
      );
    },
  );
});

describe("variableWidth : limons sur bords inclinés (trapèze)", () => {
  it("tronçon unique 900 → 1 200 : faces le long des bords inclinés, entailles au droit des nez", () => {
    const p = cageProject({ kind: "cage", sections: [straight(4200, 900, 1200)], junctions: [] });
    const { m, r } = housed(p);
    expect(keys(m)).toEqual([]);
    expect(r.stringers.map((s) => s.face.mark)).toEqual(["LI1", "LE1"]);
    const section = m.layout.sections![0]!;
    for (const s of r.stringers) {
      const key = (s.face.side === "inner") === (m.layout.innerSide === "left") ? "left" : "right";
      const edge = V.normalize(V.sub(section.end[key], section.start[key]));
      // Face le long du bord incliné (non parallèle à l'axe du tronçon).
      expect(Math.abs(V.cross(edge, s.face.dir))).toBeLessThan(1e-9);
      expect(Math.abs(V.cross(edge, V.vec(0, 1)))).toBeGreaterThan(1e-3);
      // Chaque nez coupe la face sur le bord ; l'entaille de la marche portée par ce nez
      // contient son abscisse (marche k + 1 sous le nez k).
      for (const nosing of m.stepping.nosings.slice(0, -1)) {
        const q = s.face.side === "inner" ? nosing.q : nosing.r;
        const w = V.sub(q, s.face.a);
        expect(Math.abs(V.cross(s.face.dir, w))).toBeLessThan(1e-6);
        const u = V.dot(w, s.face.dir);
        const sigma = s.face.side === "inner" ? nosing.sigmaInner : nosing.sigmaOuter;
        expect(u).toBeCloseTo(sigma - s.face.sigmaA, 6);
        const h = s.development.housings.find((x) => x.tread === nosing.index + 1)!;
        const us = h.polygons[0]!.map((pt) => pt.x);
        expect(Math.min(...us)).toBeLessThanOrEqual(u + 1e-6);
        expect(Math.max(...us)).toBeGreaterThanOrEqual(u - 1e-6);
      }
    }
    expectSound(m, r);
  });

  it("trapèze et jonction à 90° en pan coupé : limons construits, toutes les marches portées", () => {
    const p = cageProject({
      kind: "cage",
      sections: [straight(1450, 900, 1200), straight(1400, 1200)],
      junctions: [{ angle: 90, mode: "winders", well: chamfer(200) }],
    });
    const { m, r } = housed(p);
    expect(keys(m)).toEqual([]);
    expect(r.stringers.map((s) => s.face.mark)).toEqual(["LI1", "LE1", "LIC1", "LI2", "LE2"]);
    // Angle mural entre un bord incliné et le bord du tronçon suivant : φ ≠ 90°.
    const le1 = byMark(r, "LE1");
    expect(le1.face.endReach).not.toBeCloseTo(E_STRINGER, 3);
    const all = m.stepping.treads.map((t) => t.number);
    expect([...housedOn(r, "inner")].sort((a, b) => a - b)).toEqual(all);
    expect([...housedOn(r, "outer")].sort((a, b) => a - b)).toEqual(all);
    expectSound(m, r);
  });
});

describe("propriété : cages tirées parmi les fonctions déclarées", () => {
  it("jamais d'exception ni de refus ; pièces, entailles sur un limon, longueurs positives", () => {
    const section = fc.record({
      length: fc.integer({ min: 600, max: 2400 }),
      width: fc.integer({ min: 750, max: 1100 }),
      widthEnd: fc.option(fc.integer({ min: 750, max: 1100 }), { nil: undefined }),
    });
    const junction = fc.oneof(
      fc.record({
        kind: fc.constant("turn" as const),
        angle: fc.integer({ min: 20, max: 150 }),
        setback: fc.integer({ min: 60, max: 250 }),
        sharp: fc.boolean(),
      }),
      fc.record({
        kind: fc.constant("landing" as const),
        depth: fc.integer({ min: 700, max: 1300 }),
      }),
    );
    const arb = fc.record({
      sections: fc.array(section, { minLength: 1, maxLength: 3 }),
      junctions: fc.array(junction, { minLength: 2, maxLength: 2 }),
      sign: fc.constantFrom(1, -1),
      floorToFloor: fc.integer({ min: 2400, max: 3000 }),
    });
    let built = 0;
    let runs = 0;
    const seen = new Set<string>();
    fc.assert(
      fc.property(arb, (r) => {
        const sections = r.sections.map((s) => straight(s.length, s.width, s.widthEnd));
        const junctions = r.junctions.slice(0, sections.length - 1).map((j) =>
          j.kind === "landing"
            ? { angle: 0, mode: "landing" as const, depth: j.depth }
            : {
                angle: r.sign * j.angle,
                mode: "winders" as const,
                ...(j.sharp ? {} : { well: chamfer(j.setback) }),
              },
        );
        const parsed = ProjectSchema.safeParse({
          schemaVersion: PROJECT_SCHEMA_VERSION,
          site: { floorToFloor: r.floorToFloor, upperSlabThickness: 200 },
          stair: {
            placement: { origin: { x: 0, y: 0 }, rotation: 0 },
            layout: { kind: "cage", sections, junctions },
            structure: { kind: "wood-housed" },
          },
        });
        if (!parsed.success) return;
        runs++;
        const project = parsed.data;
        let model: Model | undefined;
        expect(() => (model = buildModel(project, { memo: false }))).not.toThrow();
        const k = keys(model!);
        expect(k).not.toContain("structure.cageUnsupported");
        expect(k).not.toContain("pipeline.internalError");
        if (model!.stepping.treads.length === 0 || k.some((x) => !x.startsWith("structure.")))
          return;
        built++;
        for (const f of cageFeatures(project.stair.layout as CageLayoutSpec)) seen.add(f);
        expect(model!.parts.some((p) => p.category === "stringer")).toBe(true);
        const r2 = buildWoodHoused(
          { project, layout: model!.layout, stepping: model!.stepping },
          WoodHousedParamsSchema.parse({}),
        );
        // Côté mur : toujours construit, toutes les marches y sont encastrées.
        const all = model!.stepping.treads.map((t) => t.number);
        expect([...housedOn(r2, "outer")].sort((a, b) => a - b)).toEqual(all);
        for (const s of r2.stringers) {
          expect(s.face.faceLength).toBeGreaterThan(0);
          expect(s.part.stock!.length).toBeGreaterThan(0);
          expect(housingsInside(s.development, 1e-3)).toBe(true);
          for (const h of s.development.housings) expect(h.polygons.length).toBeGreaterThan(0);
        }
        // Invariants des cas écrits à la main : contour simple, marches numérotées = marches
        // posées sur la face, rives de niveau le long des paliers.
        expectSound(model!, r2);
        // Côté jour sans angle vif : toutes les marches portées par un limon de jour.
        if (!k.includes("structure.woodHoused.sharpJourCage")) {
          expect([...housedOn(r2, "inner")].sort((a, b) => a - b)).toEqual(all);
        }
      }),
      { numRuns: 150, seed: 61 },
    );
    expect(built / runs).toBeGreaterThan(0.3);
    expect([...seen].sort()).toEqual(["anyAngle", "chamfer", "straightLanding", "variableWidth"]);
  }, 120_000);
});

describe("propriété : paliers droits à bords presque alignés (F16 (6))", () => {
  it("fusion ou limon propre selon la tolérance ; toutes les marches portées des deux côtés", () => {
    const arb = fc.record({
      width: fc.integer({ min: 750, max: 1100 }),
      deltas: fc.array(fc.integer({ min: -5, max: 5 }), { minLength: 2, maxLength: 3 }),
      taper: fc.option(fc.integer({ min: -3, max: 3 }), { nil: undefined }),
      anchor: fc.constantFrom("left", "right", "center", undefined),
      lengths: fc.array(fc.integer({ min: 700, max: 1500 }), { minLength: 3, maxLength: 3 }),
      depth: fc.integer({ min: 700, max: 1300 }),
      tolerance: fc.constantFrom(undefined, 0, 1, 2, 5),
      floorToFloor: fc.integer({ min: 2400, max: 3000 }),
    });
    let merged = 0;
    let runs = 0;
    fc.assert(
      fc.property(arb, (r) => {
        let w = r.width;
        const sections = r.deltas.map((d, i) => {
          w += i === 0 ? 0 : d;
          const end = i === 0 && r.taper !== undefined ? w + r.taper : undefined;
          const s = {
            ...straight(r.lengths[i]!, w, end),
            ...(r.anchor ? { anchor: r.anchor } : {}),
          };
          if (end !== undefined) w = end;
          return s;
        });
        const parsed = ProjectSchema.safeParse({
          schemaVersion: PROJECT_SCHEMA_VERSION,
          site: { floorToFloor: r.floorToFloor, upperSlabThickness: 200 },
          ...(r.tolerance !== undefined
            ? { workshop: { wood: { landingAlignmentTolerance: r.tolerance } } }
            : {}),
          stair: {
            placement: { origin: { x: 0, y: 0 }, rotation: 0 },
            layout: {
              kind: "cage",
              sections,
              junctions: sections
                .slice(1)
                .map(() => ({ angle: 0, mode: "landing" as const, depth: r.depth })),
            },
            structure: { kind: "wood-housed" },
          },
        });
        if (!parsed.success) return;
        let model: Model | undefined;
        expect(() => (model = buildModel(parsed.data, { memo: false }))).not.toThrow();
        const k = keys(model!);
        if (model!.stepping.treads.length === 0 || k.some((x) => !x.startsWith("structure.")))
          return;
        runs++;
        const { r: res } = housed(parsed.data);
        const tol = resolveWorkshopProfile(parsed.data.workshop).wood.landingAlignmentTolerance;
        const geo = housedGeometry(parsed.data, model!);
        for (const g of geo.landingMerges) {
          expect(g.gap).toBeGreaterThan(1e-9);
          expect(g.gap).toBeLessThanOrEqual(tol + 1e-9);
        }
        // Dans les deux sens : tout bord de palier candidat (écart et angle mesurés sans borne)
        // est fusionné si et seulement si son écart et |sin α| · e sont sous la tolérance.
        const all = housedGeometry(parsed.data, model!, 1e6).landingMerges;
        for (const g of all) {
          const skew = Math.abs(V.cross(g.before.dir, g.after.dir)) * E_STRINGER;
          const within = g.gap <= tol + 1e-9 && skew <= tol + 1e-9;
          const found = geo.landingMerges.some(
            (x) => x.junction === g.junction && x.side === g.side,
          );
          expect(found, `${g.side} ${g.junction} écart ${g.gap}`).toBe(within);
        }
        if (geo.landingMerges.length > 0) merged++;
        const numbers = model!.stepping.treads.map((t) => t.number);
        expect([...housedOn(res, "inner")].sort((a, b) => a - b)).toEqual(numbers);
        expect([...housedOn(res, "outer")].sort((a, b) => a - b)).toEqual(numbers);
        expectSound(model!, res, Math.max(tol, 1e-5));
      }),
      { numRuns: 120, seed: 62 },
    );
    expect(runs).toBeGreaterThan(40);
    expect(merged).toBeGreaterThan(0);
  }, 120_000);
});
