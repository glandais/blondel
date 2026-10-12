/**
 * Mutateurs purs du tracé (sous-lot 3a, plan D d'ADR-0010) : placement, tronçons, jonctions,
 * ajout / coupe / retrait, glisser. Tracé à volées modifié en volées tant qu'il s'y exprime,
 * converti en cage sinon ; refus typé hors schéma ; même projet si sans effet.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { curveLength, curvePointAt } from "../geom2d/curve.js";
import * as V from "../geom2d/vec.js";
import type { EditResult } from "../model/edit.js";
import type { Layout } from "../model/derived.js";
import type { Vec2 } from "../model/primitives.js";
import {
  CAGE_MAX_SECTIONS,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type CageLayoutSpec,
  type CageLayoutSpecInput,
  type FlightsLayoutSpec,
  type Project,
} from "../model/project.js";
import { createProject } from "../project/presets.js";
import {
  convertToCage,
  dragJunctionAngle,
  dragSectionEnd,
  dragWellRadius,
  dragWidth,
  insertLanding,
  insertSection,
  junctionAngleAt,
  junctionFrame,
  removeSection,
  sectionEndLength,
  setJunctionAngle,
  setJunctionMode,
  setSectionAxis,
  setSectionLength,
  setSectionWidth,
  setWallJoint,
  setWellJoint,
  splitSection,
  wellRadiusFrame,
  withPlacement,
} from "./cageEdit.js";
import { computeLayout } from "./layout.js";

function cageProject(layout: CageLayoutSpecInput, rotation = 0): Project {
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: { floorToFloor: 2700, upperSlabThickness: 200, walls: [] },
    stair: { placement: { origin: { x: 120, y: -40 }, rotation }, layout },
  });
}

const straight = (length: number, width = 900) => ({
  axis: { kind: "straight" as const, length },
  width,
});

function ok(r: EditResult): Project {
  if (r.error)
    throw new Error(`refus inattendu : ${r.error.key} ${JSON.stringify(r.error.params)}`);
  return r.project;
}

const flights = (p: Project) => p.stair.layout as FlightsLayoutSpec;
const cage = (p: Project) => p.stair.layout as CageLayoutSpec;

function expectSchemaStable(p: Project): void {
  expect(ProjectSchema.parse(JSON.parse(JSON.stringify(p)))).toStrictEqual(p);
}

/** Même ligne de foulée à `tol` mm près (longueur et points régulièrement répartis). */
function expectSameWalkline(a: Layout, b: Layout, tol = 1): void {
  const la = curveLength(a.walkline);
  const lb = curveLength(b.walkline);
  expect(Math.abs(la - lb)).toBeLessThanOrEqual(tol);
  for (let k = 0; k <= 40; k++) {
    const pa = curvePointAt(a.walkline, (la * k) / 40);
    const pb = curvePointAt(b.walkline, (lb * k) / 40);
    expect(V.distance(pa, pb)).toBeLessThanOrEqual(tol);
  }
}

function tryLayout(p: Project): Layout | null {
  try {
    return computeLayout(p);
  } catch {
    return null;
  }
}

const quarter = () => createProject("quarter-left"); // volées 1440 / 3433, E = 900

describe("placement et conversion", () => {
  it("withPlacement arrondit, conserve un champ absent, même projet sans effet", () => {
    const p = quarter();
    const q = ok(withPlacement(p, { origin: { x: 10.4, y: -3.6 } }));
    expect(q.stair.placement).toEqual({ origin: { x: 10, y: -4 }, rotation: 0 });
    expect(q.stair.layout).toBe(p.stair.layout);
    expect(q.site).toBe(p.site);
    expect(ok(withPlacement(q, { rotation: 29.6 })).stair.placement.rotation).toBe(30);
    expect(withPlacement(p, { origin: { x: 0.2, y: -0.3 }, rotation: 0.4 }).project).toBe(p);
    expectSchemaStable(q);
  });

  it("convertToCage réutilise toCageLayout ; refus d'un hélicoïdal", () => {
    const p = quarter();
    const c = ok(convertToCage(p));
    expect(cage(c).sections.map((s) => s.axis)).toEqual([
      { kind: "straight", length: 540 },
      { kind: "straight", length: 2533 },
    ]);
    expect(convertToCage(c).project).toBe(c);
    expect(convertToCage(createProject("helical")).error?.key).toBe("layout.edit.helical");
    expect(setSectionLength(createProject("helical"), 0, 100).error?.key).toBe(
      "layout.edit.helical",
    );
  });
});

describe("tronçons", () => {
  it("longueur d'une volée : partie droite + k·E, reste en volées", () => {
    const p = quarter();
    const q = ok(setSectionLength(p, 0, 700.4));
    expect(flights(q).legs.map((l) => l.length)).toEqual([1600, 3433]);
    expect(q.stair.layout.kind).toBeUndefined();
    expect(flights(q).legs[1]).toBe(flights(p).legs[1]);
    expect(flights(q).turns).toBe(flights(p).turns);
    expect(setSectionLength(p, 0, 540).project).toBe(p);
    expect(setSectionLength(p, 0, -3).error?.key).toBe("layout.cage.invalidSectionLength");
    expect(setSectionLength(p, 2, 100).error?.key).toBe("layout.edit.sectionIndex");
    expect(setSectionLength(p, 0, "auto").error?.key).toBe("layout.cage.autoLengthSingleSection");
    expectSchemaStable(q);
  });

  it("escalier droit `auto` : longueur saisie puis rendue à `auto`", () => {
    const p = ok(setSectionLength(createProject("straight"), 0, "auto"));
    expect(flights(p).legs).toEqual([{ length: "auto" }]);
    const q = ok(setSectionLength(p, 0, 3000));
    expect(flights(q).legs).toEqual([{ length: 3000 }]);
    expect(ok(setSectionLength(q, 0, "auto"))).toStrictEqual(p);
  });

  it("cage : longueur, axe en arc, refus de la longueur d'un arc", () => {
    const p = cageProject({
      kind: "cage",
      sections: [straight(1000), straight(800, 900)],
      junctions: [{ angle: 45, mode: "landing" }],
    });
    const q = ok(setSectionLength(p, 1, 1200));
    expect(cage(q).sections[1]!.axis).toEqual({ kind: "straight", length: 1200 });
    expect(cage(q).sections[0]).toBe(cage(p).sections[0]);
    expect(cage(q).junctions).toBe(cage(p).junctions);
    const arc = ok(setSectionAxis(p, 1, { kind: "arc", radius: 1500.2, sweep: 60.4 }));
    expect(cage(arc).sections[1]!.axis).toEqual({ kind: "arc", radius: 1500, sweep: 60 });
    expect(setSectionLength(arc, 1, 100).error?.key).toBe("layout.edit.arcLength");
    expect(setSectionAxis(p, 1, { kind: "arc", radius: 1500, sweep: 0 }).error?.key).toBe(
      "layout.cage.sweepOutOfRange",
    );
    expectSchemaStable(arc);
  });

  it("largeur : commune en volées, trapèze et ancrage en cage", () => {
    const p = quarter();
    const q = ok(setSectionWidth(p, 1, { width: 950.3 }));
    expect(flights(q).width).toBe(950);
    expect(flights(q).legs).toBe(flights(p).legs);
    expect(setSectionWidth(p, 0, { width: 900 }).project).toBe(p);
    expect(setSectionWidth(p, 0, { width: 0.2 }).error?.key).toBe("layout.edit.invalidWidth");
    const t = ok(setSectionWidth(p, 1, { widthEnd: 1200, anchor: "left" }));
    expect(t.stair.layout.kind).toBe("cage");
    expect(cage(t).sections[1]).toEqual({
      axis: { kind: "straight", length: 2533 },
      width: 900,
      widthEnd: 1200,
      anchor: "left",
    });
    expect(cage(t).width).toBe(900);
    // Largeur d'arrivée égale au départ : retirée ; `null` retire l'ancrage.
    const back = ok(setSectionWidth(t, 1, { widthEnd: 900, anchor: null }));
    expect(cage(back).sections[1]).toEqual({
      axis: { kind: "straight", length: 2533 },
      width: 900,
    });
    const all = ok(setSectionWidth(t, "all", { width: 1000 }));
    expect(cage(all).sections.map((s) => [s.width, s.widthEnd, s.anchor])).toEqual([
      [1000, undefined, undefined],
      [1000, undefined, "left"],
    ]);
    expectSchemaStable(t);
  });

  it('largeur commune "all" : sans effet = même projet, aucune `widthEnd` écrite ; ancrage', () => {
    const mixed = cageProject({
      kind: "cage",
      sections: [straight(2000, 900), straight(1000, 1000)],
      junctions: [{ angle: 60, mode: "landing" }],
    });
    const q = ok(setSectionWidth(mixed, "all", { width: 900 }));
    expect(cage(q).sections[0]).toBe(cage(mixed).sections[0]);
    expect(cage(q).sections[1]).toEqual(straight(1000, 900));
    // La largeur de départ du tronçon 0 reste constante ensuite (pas de trapèze caché).
    expect(cage(ok(setSectionWidth(q, 0, { width: 1200 }))).sections[0]).toEqual(
      straight(2000, 1200),
    );
    const uniform = cageProject({
      kind: "cage",
      sections: [straight(1000, 1000), { ...straight(1000, 1000), widthEnd: 1200 }],
      junctions: [{ angle: 90, mode: "winders" }],
    });
    const flat = ok(setSectionWidth(uniform, "all", { width: 1000 }));
    expect(cage(flat).sections.every((s) => !("widthEnd" in s))).toBe(true);
    expect(setSectionWidth(flat, "all", { width: 1000 }).project).toBe(flat);
    // Ancrage commun ; sans largeur ni ancrage : même projet.
    const anchored = ok(setSectionWidth(flat, "all", { anchor: "right" }));
    expect(cage(anchored).sections.map((s) => s.anchor)).toEqual(["right", "right"]);
    expect(setSectionWidth(flat, "all", {}).project).toBe(flat);
    // Tracé à volées : un ancrage seul, sans effet à largeur constante, n'est pas écrit.
    const qp = quarter();
    expect(setSectionWidth(qp, 0, { anchor: "left" }).project).toBe(qp);
  });
});

describe("jonctions", () => {
  it("angle ±90° : sens du tournant en volées ; autre angle : cage ; 0° : palier droit", () => {
    const p = quarter();
    const r = ok(setJunctionAngle(p, 0, -90));
    expect(flights(r).turns[0]!.direction).toBe("right");
    expect(flights(r).legs).toBe(flights(p).legs);
    expect(setJunctionAngle(p, 0, 90.2).project).toBe(p);
    const c = ok(setJunctionAngle(p, 0, 60));
    expect(cage(c).junctions[0]).toEqual({
      angle: 60,
      mode: "winders",
      well: { kind: "sharp" },
      wall: { kind: "sharp" },
    });
    const arcWell = ok(setWellJoint(c, 0, { kind: "arc", radius: 120.4 }));
    const flat = ok(setJunctionAngle(arcWell, 0, 0));
    expect(cage(flat).junctions[0]).toEqual({
      angle: 0,
      mode: "landing",
      well: { kind: "sharp" },
      wall: { kind: "sharp" },
    });
    expect(setJunctionAngle(p, 0, 180).error?.key).toBe("layout.cage.angleOutOfRange");
    expect(setJunctionAngle(p, 1, 45).error?.key).toBe("layout.edit.junctionIndex");
    expectSchemaStable(c);
    expectSchemaStable(flat);
  });

  it("raccords et mode : en volées s'ils s'y expriment, refus sur un palier droit", () => {
    const p = quarter();
    const a = ok(setWellJoint(p, 0, { kind: "arc", radius: 99.6 }));
    expect(flights(a).turns[0]!.inner).toEqual({ kind: "arc", radius: 100 });
    const n = ok(setWellJoint(p, 0, { kind: "newel", size: 90, offset: 10 }));
    expect(flights(n).turns[0]!.inner).toEqual({ kind: "newel", size: 90, offset: 10 });
    const ch = ok(setWellJoint(p, 0, { kind: "chamfer", setbackIn: 100, setbackOut: 150 }));
    expect(ch.stair.layout.kind).toBe("cage");
    const w = ok(setWallJoint(p, 0, { kind: "arc", radius: 300 }));
    expect(cage(w).junctions[0]!.wall).toEqual({ kind: "arc", radius: 300 });
    expect(setWallJoint(p, 0, { kind: "sharp" }).project).toBe(p);
    expect(flights(ok(setJunctionMode(p, 0, "landing"))).turns[0]!.mode).toBe("landing");
    expect(ok(setJunctionMode(p, 0, "radiating")).stair.layout.kind).toBe("cage");
    const flat = ok(setJunctionAngle(p, 0, 0));
    expect(setWellJoint(flat, 0, { kind: "arc", radius: 100 }).error?.key).toBe(
      "layout.cage.straightJunctionSharp",
    );
    expect(setJunctionMode(flat, 0, "winders").error?.key).toBe(
      "layout.cage.straightJunctionLanding",
    );
  });
});

describe("ajout, coupe, retrait", () => {
  const u = () => convertToCage(createProject("two-quarters-u")).project!;

  it("insertSection puis removeSection : cage de départ à l'identique, à toute position", () => {
    const p = u();
    for (let i = 0; i <= cage(p).sections.length; i++) {
      const q = ok(insertSection(p, i, { length: 400 }));
      expectSchemaStable(q);
      expect(ok(removeSection(q, i))).toStrictEqual(p);
    }
  });

  it("insertSection puis removeSection sur un tracé à volées : cage équivalente (pas les volées)", () => {
    for (const p of [createProject("two-quarters-u"), quarter()]) {
      const n = flights(p).legs.length;
      for (let i = 0; i <= n; i++) {
        const q = ok(insertSection(p, i, { length: 400 }));
        expect(q.stair.layout.kind).toBe("cage");
        expectSchemaStable(q);
        // Une cage n'est jamais réécrite en volées : retour à la cage équivalente.
        const back = ok(removeSection(q, i));
        expect(back).toStrictEqual(ok(convertToCage(p)));
        expect(back.stair.layout.kind).toBe("cage");
      }
    }
  });

  it("insertSection : tournant, borne CAGE_MAX_SECTIONS", () => {
    const p = quarter();
    const q = ok(insertSection(p, 2, { length: 500, angle: 90 }));
    expect(q.stair.layout.kind).toBeUndefined();
    expect(flights(q).legs.map((l) => l.length)).toEqual([1440, 3433 + 900, 1400]);
    let c = u();
    while (cage(c).sections.length < CAGE_MAX_SECTIONS)
      c = ok(insertSection(c, 0, { length: 100 }));
    expect(insertSection(c, 0, { length: 100 }).error?.key).toBe("layout.cage.sectionCount");
  });

  it("removeSection : fusion des jonctions, refus hors domaine et du dernier tronçon", () => {
    const p = u();
    expect(removeSection(p, 1).error?.key).toBe("layout.cage.angleOutOfRange");
    const s = cageProject({
      kind: "cage",
      sections: [straight(1000), straight(300), straight(900)],
      junctions: [
        { angle: 90, mode: "winders" },
        { angle: -30, mode: "landing" },
      ],
    });
    const m = ok(removeSection(s, 1));
    expect(cage(m).junctions).toEqual([
      { angle: 60, mode: "winders", well: { kind: "sharp" }, wall: { kind: "sharp" } },
    ]);
    const zero = ok(removeSection(ok(setJunctionAngle(s, 1, -90)), 1));
    expect(cage(zero).junctions[0]).toEqual({
      angle: 0,
      mode: "landing",
      well: { kind: "sharp" },
      wall: { kind: "sharp" },
    });
    const one = ok(removeSection(ok(removeSection(s, 0)), 0));
    expect(removeSection(one, 0).error?.key).toBe("layout.cage.sectionCount");
  });

  it("splitSection garde la longueur totale et la ligne de foulée", () => {
    for (const p of [
      quarter(),
      u(),
      cageProject({ kind: "cage", sections: [straight(3000, 1000)], junctions: [] }, 30),
    ]) {
      const before = computeLayout(p);
      const n = before.sections!.length;
      for (let i = 0; i < n; i++) {
        const spec = p.stair.layout.kind === "cage" ? cage(p) : cage(convertToCage(p).project!);
        const L = spec.sections[i]!.axis;
        if (L.kind !== "straight" || L.length === "auto" || L.length < spec.sections[i]!.width)
          continue;
        const q = ok(splitSection(p, i));
        const c = cage(q);
        const total =
          (c.sections[i]!.axis as { length: number }).length +
          spec.sections[i]!.width +
          (c.sections[i + 1]!.axis as { length: number }).length;
        expect(total).toBe(L.length);
        expect(c.junctions[i]).toEqual({
          angle: 0,
          mode: "landing",
          well: { kind: "sharp" },
          wall: { kind: "sharp" },
        });
        expectSameWalkline(before, computeLayout(q));
        expectSchemaStable(q);
      }
    }
    const short = cageProject({ kind: "cage", sections: [straight(500)], junctions: [] });
    expect(splitSection(short, 0).error?.key).toBe("layout.edit.splitOutside");
    expect(splitSection(short, 0, 0, 300)).toMatchObject({ project: expect.anything() });
    expect(splitSection(createProject("straight"), 0).error).toBeUndefined();
  });

  it("insertLanding allonge la montée de la profondeur ; refus d'un arc ou d'un `auto`", () => {
    const p = cageProject({ kind: "cage", sections: [straight(2000)], junctions: [] });
    const q = ok(insertLanding(p, 0, 800.4, 1200));
    expect(cage(q).sections.map((s) => s.axis)).toEqual([
      { kind: "straight", length: 800 },
      { kind: "straight", length: 1200 },
    ]);
    expect(cage(q).junctions[0]).toEqual({
      angle: 0,
      mode: "landing",
      well: { kind: "sharp" },
      wall: { kind: "sharp" },
      depth: 1200,
    });
    expect(
      curveLength(computeLayout(q).walkline) - curveLength(computeLayout(p).walkline),
    ).toBeCloseTo(1200, 6);
    const arc = cageProject({
      kind: "cage",
      sections: [{ axis: { kind: "arc", radius: 1500, sweep: 90 }, width: 900 }],
      junctions: [],
    });
    expect(insertLanding(arc, 0).error?.key).toBe("layout.edit.splitArc");
    const auto = cageProject({
      kind: "cage",
      sections: [{ axis: { kind: "straight", length: "auto" }, width: 900 }],
      junctions: [],
    });
    expect(insertLanding(auto, 0).error?.key).toBe("layout.edit.autoLength");
    // Largeur variable : largeurs interpolées de part et d'autre.
    const t = cageProject({
      kind: "cage",
      sections: [{ ...straight(2000, 800), widthEnd: 1200 }],
      junctions: [],
    });
    const tc = cage(ok(splitSection(t, 0, 500, 200)));
    expect(tc.sections.map((s) => [s.width, s.widthEnd])).toEqual([
      [800, 900],
      [940, 1200],
    ]);
  });
});

describe("refus du moteur anticipés", () => {
  it("tracé à volées à poteau : modifiable en volées, refus s'il devenait une cage", () => {
    const p = ok(setWellJoint(quarter(), 0, { kind: "newel", size: 100 }));
    expect(p.stair.layout.kind).toBeUndefined();
    expect(flights(ok(setJunctionAngle(p, 0, -90))).turns[0]!.direction).toBe("right");
    for (const r of [
      setJunctionAngle(p, 0, 80),
      setSectionWidth(p, 1, { widthEnd: 1000 }),
      insertLanding(p, 1),
      splitSection(p, 1),
      setSectionAxis(p, 1, { kind: "arc", radius: 2000, sweep: 90 }),
    ]) {
      expect(r.error?.key).toBe("layout.cage.newelNotYetSupported");
    }
    // Cage saisie : un jour à poteau est refusé de même.
    expect(
      setWellJoint(ok(convertToCage(quarter())), 0, { kind: "newel", size: 100 }).error?.key,
    ).toBe("layout.cage.newelNotYetSupported");
  });

  it("volée plus courte que ses carrés d'angle : refus `layout.legTooShort`", () => {
    const p = ProjectSchema.parse({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      site: { floorToFloor: 2700, upperSlabThickness: 200, walls: [] },
      stair: {
        placement: { origin: { x: 0, y: 0 }, rotation: 0 },
        layout: {
          width: 1015,
          legs: [{ length: 2195 }, { length: 1316 }, { length: 1305 }],
          turns: [
            { direction: "left", mode: "winders" },
            { direction: "left", mode: "winders" },
          ],
        },
      },
    });
    for (const r of [setSectionLength(p, 0, 1500), setJunctionAngle(p, 0, -90)]) {
      expect(r.error?.key).toBe("layout.legTooShort");
      expect(r.error?.params).toMatchObject({ flight: 2, length: 1316, required: 2030 });
    }
    // La largeur commune reste modifiable (formulaire des volées).
    expect(flights(ok(setSectionWidth(p, "all", { width: 600 }))).width).toBe(600);
  });

  it("partie droite nulle sans étendue (dernier tronçon après un palier droit) : refus", () => {
    const p = cageProject({
      kind: "cage",
      sections: [straight(2000), straight(2000)],
      junctions: [{ angle: 0, mode: "landing" }],
    });
    expect(insertSection(p, 2, { length: 0 }).error?.key).toBe("layout.cage.invalidSectionLength");
    expect(setSectionLength(p, 1, 0).error?.key).toBe("layout.cage.invalidSectionLength");
    // Après un tournant (carré d'angle) ou avec une jonction de sortie : admise.
    expect(ok(setSectionLength(p, 0, 0))).toBeDefined();
    const t = cageProject({
      kind: "cage",
      sections: [straight(2000), straight(2000)],
      junctions: [{ angle: 90, mode: "winders" }],
    });
    expect(ok(setSectionLength(t, 1, 0))).toBeDefined();
    // Glisser la fin du dernier tronçon derrière son départ : 1 mm, pas 0.
    const layout = computeLayout(p);
    const s = layout.sections![1]!;
    const back = V.addScaled(s.start.left, lineUp(s.start), -500);
    expect(
      (cage(ok(dragSectionEnd(p, layout, 1, back))).sections[1]!.axis as { length: number }).length,
    ).toBe(1);
  });

  it("splitSection hors de la partie droite d'un tronçon qui se rétrécit : splitOutside", () => {
    const p = cageProject({
      kind: "cage",
      sections: [{ ...straight(10, 1000), widthEnd: 600 }, straight(1000, 600)],
      junctions: [{ angle: 90, mode: "winders" }],
    });
    expect(splitSection(p, 0, 100).error?.key).toBe("layout.edit.splitOutside");
    expect(splitSection(p, 0, -5).error?.key).toBe("layout.edit.splitOutside");
    expect(insertLanding(p, 0, 11).error?.key).toBe("layout.edit.splitOutside");
  });
});

/** Direction de montée d'une ligne transversale. */
const lineUp = (l: { left: Vec2; right: Vec2 }) => V.perpLeft(V.normalize(V.sub(l.right, l.left)));

describe("glisser", () => {
  const shapes: Record<string, () => Project> = {
    "volées, quart tournant": quarter,
    "volées, U": () => createProject("two-quarters-u"),
    "cage tournée, 60° et trapèze ancré à gauche": () =>
      cageProject(
        {
          kind: "cage",
          sections: [
            { ...straight(1200, 900), widthEnd: 1000, anchor: "left" },
            straight(1000, 1000),
          ],
          junctions: [{ angle: 60, mode: "landing" }],
        },
        37,
      ),
    "cage, arc": () =>
      cageProject(
        {
          kind: "cage",
          sections: [
            straight(800),
            { axis: { kind: "arc", radius: 1600, sweep: -120 }, width: 900 },
          ],
          junctions: [{ angle: 0, mode: "landing" }],
        },
        -20,
      ),
  };

  for (const [name, make] of Object.entries(shapes)) {
    it(`${name} : glisser au point actuel sans effet ; longueur monotone, bord et angle suivis`, () => {
      const p = make();
      const layout = computeLayout(p);
      const sections = layout.sections!;
      const specOf = (pp: Project) =>
        pp.stair.layout.kind === "cage" ? cage(pp) : cage(convertToCage(pp).project!);
      const spec = specOf(p);
      sections.forEach((s, i) => {
        const anchor = spec.sections[i]!.anchor ?? "center";
        const pick = (l: typeof s.end) =>
          anchor === "left" ? l.left : anchor === "right" ? l.right : V.lerp(l.left, l.right, 0.5);
        expect(dragSectionEnd(p, layout, i, pick(s.end)).project).toBe(p);
        if (spec.sections[i]!.axis.kind === "straight") {
          const u = V.perpLeft(V.normalize(V.sub(s.start.right, s.start.left)));
          const lens = [-100, 50, 300, 700].map((d) => {
            const r = ok(dragSectionEnd(p, layout, i, V.addScaled(pick(s.end), u, d)));
            return (specOf(r).sections[i]!.axis as { length: number }).length;
          });
          for (let k = 1; k < lens.length; k++)
            expect(lens[k]!).toBeGreaterThanOrEqual(lens[k - 1]!);
        }
        for (const end of ["start", "end"] as const) {
          let draggable = 0;
          for (const edge of ["left", "right"] as const) {
            const line = s[end];
            expect(dragWidth(p, layout, i, end, edge, line[edge]).project).toBe(p);
            const v = V.normalize(V.sub(line.right, line.left));
            const out = edge === "right" ? v : V.scale(v, -1);
            for (const d of [-200, -50, 80, 300]) {
              const point = V.addScaled(line[edge], out, d);
              const r = dragWidth(p, layout, i, end, edge, point);
              if (r.error) {
                // Bord qui ne bouge pas avec la largeur (départ, jour, ancrage) : refus typé.
                expect(r.error.key).toBe("layout.edit.fixedEdge");
                continue;
              }
              draggable++;
              // Suivi : sur le tracé recalculé (s'il se calcule à cette largeur), le bord tiré est
              // au droit du point (au mm près), et réappliquer le même point rend le même projet.
              const relaid = tryLayout(r.project);
              if (!relaid) continue;
              const after = relaid.sections![i]![end];
              const dir = V.normalize(V.sub(after.right, after.left));
              expect(Math.abs(V.dot(V.sub(after[edge], point), dir))).toBeLessThanOrEqual(1.01);
              expect(dragWidth(r.project, relaid, i, end, edge, point).project).toBe(r.project);
            }
          }
          expect(draggable).toBeGreaterThan(0);
        }
      });
      spec.junctions.forEach((jn, j) => {
        const f = junctionFrame(layout, j)!;
        expect(dragJunctionAngle(p, layout, j, V.addScaled(f.pivot, f.outgoing, 500)).project).toBe(
          p,
        );
        const angles = [-170, -100, -45, 0, 30, 90, 150, 178].map((deg) => {
          const dir = V.rotate(f.incoming, (deg * Math.PI) / 180);
          const point = V.addScaled(f.pivot, dir, 400);
          const r = ok(dragJunctionAngle(p, layout, j, point));
          // Suivi, y compris en changeant de sens : sur le tracé recalculé (s'il se calcule), le
          // point est sur la demi-droite pivot + r·sortante ; même point : même projet.
          const after = tryLayout(r);
          if (after) {
            const g = junctionFrame(after, j)!;
            expect(V.distance(g.pivot, f.pivot)).toBeLessThan(1e-6);
            const off = Math.abs(V.signedAngle(g.outgoing, V.sub(point, g.pivot)));
            expect(off).toBeLessThan(1e-6);
            expect(dragJunctionAngle(r, after, j, point).project).toBe(r);
          }
          return specOf(r).junctions[j]!.angle;
        });
        expect(angles).toEqual([-170, -100, -45, 0, 30, 90, 150, 178]);
        expect(jn.angle).toBe(spec.junctions[j]!.angle);
      });
    });
  }

  it("bornes : angle borné à ±179°, longueur ≥ 0, largeur ≥ 1 ; tracé non calculé refusé", () => {
    const p = quarter();
    const layout = computeLayout(p);
    const f = junctionFrame(layout, 0)!;
    const back = V.addScaled(f.pivot, V.rotate(f.incoming, Math.PI - 0.001), 400);
    expect(cage(ok(dragJunctionAngle(p, layout, 0, back))).junctions[0]!.angle).toBe(179);
    const s = layout.sections![0]!;
    const far = V.addScaled(
      s.start.left,
      V.perpLeft(V.normalize(V.sub(s.start.right, s.start.left))),
      -5000,
    );
    expect(flights(ok(dragSectionEnd(p, layout, 0, far))).legs[0]!.length).toBe(900);
    expect(flights(ok(dragWidth(p, layout, 0, "start", "right", s.start.left))).width).toBe(1);
    const noSections: Layout = { ...layout, sections: undefined };
    expect(dragSectionEnd(p, noSections, 0, far).error?.key).toBe("layout.edit.notComputed");
    expect(dragJunctionAngle(p, noSections, 0, far).error?.key).toBe("layout.edit.notComputed");
  });
});

describe("projections des poignées (accroches de l'éditeur)", () => {
  it("sectionEndLength : longueur non arrondie, dont dragSectionEnd est l'arrondi borné", () => {
    const p = quarter();
    const layout = computeLayout(p);
    const s = layout.sections![1]!;
    const u = V.perpLeft(V.normalize(V.sub(s.start.right, s.start.left)));
    const mid = V.lerp(s.end.left, s.end.right, 0.5);
    fc.assert(
      fc.property(fc.double({ min: -500, max: 800, noNaN: true }), (d) => {
        const point = V.addScaled(mid, u, d);
        const raw = sectionEndLength(p, layout, 1, point);
        if (raw.error) return false;
        const r = ok(dragSectionEnd(p, layout, 1, point));
        // Tracé resté en volées ; partie droite (F11) lue sur la cage équivalente.
        const cageLen = (cage(ok(convertToCage(r))).sections[1]!.axis as { length: number }).length;
        return r.stair.layout.kind !== "cage" && cageLen === Math.max(0, Math.round(raw.length));
      }),
      { numRuns: 60 },
    );
    const arc = cageProject({
      kind: "cage",
      sections: [{ axis: { kind: "arc", radius: 1600, sweep: 90 }, width: 900 }],
      junctions: [],
    });
    expect(sectionEndLength(arc, computeLayout(arc), 0, { x: 0, y: 0 }).error?.key).toBe(
      "layout.edit.arcLength",
    );
  });

  it("junctionAngleAt : angle non arrondi de dragJunctionAngle ; pivot : null ; sans tronçons : undefined", () => {
    const p = cageProject({
      kind: "cage",
      sections: [straight(1200), straight(1000)],
      junctions: [{ angle: 60, mode: "winders" }],
    });
    const layout = computeLayout(p);
    const f = junctionFrame(layout, 0)!;
    const point = V.addScaled(f.pivot, V.rotate(f.incoming, (47.4 * Math.PI) / 180), 500);
    expect(junctionAngleAt(layout, 0, point)).toBeCloseTo(47.4, 9);
    expect(cage(ok(dragJunctionAngle(p, layout, 0, point))).junctions[0]!.angle).toBe(47);
    expect(junctionAngleAt(layout, 0, f.pivot)).toBeNull();
    expect(junctionAngleAt(layout, 3, point)).toBeUndefined();
    expect(junctionAngleAt(layout, 0, point, 4)).toBeUndefined();
  });

  it("dragWellRadius : rayon suivi au mm, idempotent ; refus sans raccord en arc", () => {
    const p = cageProject({
      kind: "cage",
      sections: [straight(1200), straight(1000)],
      junctions: [{ angle: 90, mode: "winders", well: { kind: "arc", radius: 150 } }],
    });
    const layout = computeLayout(p);
    const f = wellRadiusFrame(layout, 0)!;
    const handle = V.addScaled(f.base, f.incoming, -150);
    expect(dragWellRadius(p, layout, 0, handle).project).toBe(p);
    for (const d of [-80, 40, 300]) {
      const point = V.addScaled(handle, f.incoming, -d);
      const r = ok(dragWellRadius(p, layout, 0, point));
      expect(cage(r).junctions[0]!.well).toEqual({ kind: "arc", radius: 150 + d });
      const after = computeLayout(r);
      const f2 = wellRadiusFrame(after, 0)!;
      expect(V.distance(f2.base, f.base)).toBeLessThan(1e-6);
      expect(dragWellRadius(r, after, 0, point).project).toBe(r);
    }
    expect(
      cage(ok(dragWellRadius(p, layout, 0, V.addScaled(f.base, f.incoming, 50)))).junctions[0]!
        .well,
    ).toEqual({ kind: "arc", radius: 1 });
    const sharp = cageProject({
      kind: "cage",
      sections: [straight(1200), straight(1000)],
      junctions: [{ angle: 90, mode: "winders" }],
    });
    expect(dragWellRadius(sharp, computeLayout(sharp), 0, handle).error?.key).toBe(
      "layout.edit.wellNotArc",
    );
    expect(dragWellRadius(p, layout, 2, handle).error?.key).toBe("layout.edit.junctionIndex");
  });
});
