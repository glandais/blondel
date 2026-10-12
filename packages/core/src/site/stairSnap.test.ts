/**
 * Accroches de l'escalier (`site/stairSnap.ts`, ADR-0010, plan E, sous-lot 3c) : arrivée sur un
 * côté de trémie rectangulaire ou polygonale, flanc gauche ou droit contre un mur, longueurs
 * par girons entiers, choix dans un rayon et pas angulaire ; propriétés fast-check.
 * Préréglage `straight` : emprise x ∈ [0 ; 900], y ∈ [0 ; 3 780], montée vers +y.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pointInPolygon } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import { openingPolygon } from "../headroom/headroom.js";
import type { Model } from "../model/derived.js";
import type { Vec2 } from "../model/primitives.js";
import { ProjectSchema, type Project } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { createProject } from "../project/presets.js";
import { toCageLayout } from "../project/layoutConversion.js";
import { withPlacement } from "../layout/cageEdit.js";
import { fr } from "../i18n.test-helpers.js";
import { projectLateralThickness } from "./fit.js";
import {
  placementDistance,
  rotatePlacementAbout,
  snapAngle,
  snapPlacement,
  snapSectionLength,
  stairPivot,
  stairSnapTargets,
  toLocal,
  toWorld,
  type ArrivalSnapTarget,
  type StairPlacement,
  type WallFlankSnapTarget,
} from "./stairSnap.js";

const build = (p: Project): Model => buildModel(p, { memo: false });

function withSite(p: Project, site: Record<string, unknown>): Project {
  return ProjectSchema.parse({ ...p, site: { ...p.site, ...site } });
}

function placed(p: Project, placement: StairPlacement): Project {
  return { ...p, stair: { ...p.stair, placement: { ...placement } } };
}

/**
 * Cible appliquée comme le fera l'éditeur (`withPlacement` : cotes au mm, angles au degré) ;
 * la cible est déjà applicable : `withPlacement` ne la modifie pas.
 */
function applied(p: Project, placement: StairPlacement): Project {
  const { project } = withPlacement(p, placement);
  if (!project) throw new Error("placement refusé");
  expect(project.stair.placement.origin).toEqual(placement.origin);
  expect(project.stair.placement.rotation).toBe(placement.rotation);
  return project;
}

const wall = (id: string, a: [number, number], b: [number, number], thickness = 200) => ({
  id,
  a: { x: a[0], y: a[1] },
  b: { x: b[0], y: b[1] },
  thickness,
  loadBearing: true,
});

/** Clés des conflits de dalle à la ligne d'arrivée. */
const ARRIVAL_SLAB = new Set(["site.fit.slabArrival", "site.fit.slabStructureArrival"]);

/** Distance d'un point à la droite du côté `edge` de la trémie. */
function edgeDistance(poly: readonly Vec2[], edge: number, p: Vec2): number {
  const a = poly[edge]!;
  const b = poly[(edge + 1) % poly.length]!;
  const u = V.normalize(V.sub(b, a));
  return Math.abs(V.cross(u, V.sub(p, a)));
}

/**
 * Dernier nez (extrémités hors tout) posé sur le côté `edge` de la trémie, sans conflit de
 * dalle d'arrivée : extrémités dans la trémie ou sur son bord, la plus proche du côté à moins
 * de √2 mm (origine au mm, du côté de la trémie), l'autre en plus à moins de
 * largeur · sin 0,5° (rotation au degré sur un côté oblique).
 */
function expectArrivalOnOpening(p: Project, edge: number): void {
  const model = build(p);
  const poly = openingPolygon(p.site.opening)!;
  const last = model.stepping.nosings[model.stepping.nosings.length - 1]!;
  const lateral = projectLateralThickness(p);
  const gi = V.addScaled(last.q, last.dir, -lateral.inner);
  const go = V.addScaled(last.r, last.dir, lateral.outer);
  for (const e of [gi, go]) expect(pointInPolygon(e, poly, 1e-3)).not.toBe("outside");
  const [near, far] = [edgeDistance(poly, edge, gi), edgeDistance(poly, edge, go)].sort(
    (x, y) => x - y,
  );
  expect(near).toBeLessThanOrEqual(Math.SQRT2 + 1e-9);
  expect(far).toBeLessThanOrEqual(
    Math.SQRT2 + V.distance(gi, go) * Math.sin((0.5 * Math.PI) / 180) + 1e-9,
  );
  const arrival = (model.siteFit ?? []).filter((c) => ARRIVAL_SLAB.has(c.message.key));
  expect(arrival).toEqual([]);
}

describe("accroche : arrivée sur un bord de trémie", () => {
  it("trémie rectangulaire : cibles sur chaque côté assez long, arrivée posée sur le côté", () => {
    const base = createProject("straight");
    const p = withSite(base, {
      opening: { kind: "rect", x: 2000, y: 1000, sizeX: 2800, sizeY: 900 },
    });
    const targets = stairSnapTargets(p, build(p)).filter(
      (t): t is ArrivalSnapTarget => t.kind === "arrival",
    );
    // Largeur hors tout 900 : les quatre côtés (2 800 et 900 mm) la contiennent.
    expect(new Set(targets.map((t) => t.placement.edge))).toEqual(new Set([0, 1, 2, 3]));
    // Côtés de 900 mm : un seul calage (début = fin = centre, dédoublonnés).
    expect(targets.filter((t) => t.placement.edge === 1)).toHaveLength(1);
    expect(targets.filter((t) => t.placement.edge === 0).map((t) => t.placement.alignment)).toEqual(
      ["start", "end", "center"],
    );
    for (const t of targets) {
      expect(fr(t.placement.fit)).toMatch(/^arrivée sur le côté/);
      expectArrivalOnOpening(applied(p, t.placement), t.placement.edge);
    }
    // Côté y min (normale −y) : montée vers −y, rotation 180°.
    expect(targets.find((t) => t.placement.edge === 0)!.placement.rotation).toBe(180);
  });

  it("trémie polygonale (pentagone, côté oblique) : arrivée posée sur le côté oblique", () => {
    const base = createProject("straight");
    const points = [
      { x: 0, y: 0 },
      { x: 3000, y: 0 },
      { x: 3000, y: 1200 },
      { x: 1500, y: 2700 },
      { x: 0, y: 1200 },
    ];
    const p = withSite(base, { opening: { kind: "polygon", points } });
    const targets = stairSnapTargets(p, build(p)).filter(
      (t): t is ArrivalSnapTarget => t.kind === "arrival",
    );
    expect(new Set(targets.map((t) => t.placement.edge)).size).toBe(5);
    const oblique = targets.filter((t) => t.placement.edge === 2);
    expect(oblique.length).toBeGreaterThan(0);
    for (const t of oblique) {
      // Normale sortante à 45° ; montée initiale vers +y : rotation de −45°.
      expect(t.placement.rotation).toBeCloseTo(315, 9);
      expectArrivalOnOpening(applied(p, t.placement), t.placement.edge);
    }
  });

  it("côté oblique d'angle non entier (33,69°) : cible au degré et au mm, appliquée sur le côté", () => {
    const base = createProject("straight");
    const points = [
      { x: 0, y: 0 },
      { x: 3000, y: 0 },
      { x: 3000, y: 1200 },
      { x: 0, y: 3200 },
    ];
    const p = withSite(base, { opening: { kind: "polygon", points } });
    const oblique = stairSnapTargets(p, build(p)).filter(
      (t): t is ArrivalSnapTarget => t.kind === "arrival" && t.placement.edge === 2,
    );
    expect(oblique.length).toBeGreaterThan(0);
    for (const t of oblique) {
      // Normale sortante à 56,31° ; montée initiale vers +y : −33,69°, arrondis à 326°.
      expect(t.placement.rotation).toBe(326);
      expect(Number.isInteger(t.placement.origin.x)).toBe(true);
      expect(Number.isInteger(t.placement.origin.y)).toBe(true);
      expectArrivalOnOpening(applied(p, t.placement), 2);
    }
  });

  it("sans trémie : aucune cible d'arrivée", () => {
    const base = createProject("straight");
    const { opening: _o, ...site } = base.site;
    const p = ProjectSchema.parse({ ...base, site });
    expect(stairSnapTargets(p, build(p)).some((t) => t.kind === "arrival")).toBe(false);
  });
});

describe("accroche : flanc contre un mur", () => {
  /** Mur vertical d'axe x = `x` (épaisseur 200) le long de l'escalier. */
  const project = (x: number): Project =>
    withSite(createProject("straight"), { walls: [wall("M", [x, -1000], [x, 5000])] });

  const flanks = (p: Project): WallFlankSnapTarget[] =>
    stairSnapTargets(p, build(p)).filter((t): t is WallFlankSnapTarget => t.kind === "wallFlank");

  it("mur à droite : le bord droit s'adosse sans rotation, au nu du mur", () => {
    const p = project(1300); // face côté escalier en x = 1 200
    const right = flanks(p).find((t) => t.side === "right")!;
    expect(right.wallId).toBe("M");
    expect(right.placement.rotation).toBeCloseTo(0, 9);
    expect(right.placement.origin.x).toBeCloseTo(300, 6);
    expect(right.placement.origin.y).toBeCloseTo(0, 6);
    const q = placed(p, right.placement);
    const model = build(q);
    expect((model.siteFit ?? []).filter((c) => c.kind === "wall")).toEqual([]);
    const xs = model.layout.footprint.map((v) => v.x);
    expect(Math.max(...xs)).toBeCloseTo(1200, 6);
  });

  it("mur à gauche : le bord gauche s'adosse sans rotation ; le bord droit, en demi-tour", () => {
    const p = project(-400); // face côté escalier en x = −300
    const list = flanks(p);
    const left = list.find((t) => t.side === "left")!;
    expect(left.placement.rotation).toBeCloseTo(0, 9);
    expect(left.placement.origin.x).toBeCloseTo(-300, 6);
    const model = build(placed(p, left.placement));
    expect(Math.min(...model.layout.footprint.map((v) => v.x))).toBeCloseTo(-300, 6);
    expect((model.siteFit ?? []).filter((c) => c.kind === "wall")).toEqual([]);
    const right = list.find((t) => t.side === "right")!;
    expect(Math.abs(right.placement.rotation)).toBeCloseTo(180, 9);
    const turned = build(placed(p, right.placement));
    expect(Math.min(...turned.layout.footprint.map((v) => v.x))).toBeCloseTo(-300, 6);
    expect((turned.siteFit ?? []).filter((c) => c.kind === "wall")).toEqual([]);
  });

  it("épaisseur latérale de la structure : le limon, pas la marche, touche le mur", () => {
    const p = ProjectSchema.parse({
      ...project(1300),
      stair: { ...project(1300).stair, structure: { kind: "wood-housed", params: {} } },
    });
    const lateral = projectLateralThickness(p);
    expect(lateral.outer).toBeGreaterThan(0);
    const right = flanks(p).find((t) => t.side === "right")!;
    expect(right.placement.origin.x).toBeCloseTo(300 - lateral.outer, 6);
    expect(
      (build(placed(p, right.placement)).siteFit ?? []).filter((c) => c.kind === "wall"),
    ).toEqual([]);
  });

  it("tracé à plusieurs tronçons : aucune cible qui pousse un tronçon voisin dans le mur", () => {
    // Quart tournant : emprise [900,0] [900,1440] [−2533,1440] [−2533,540] [0,540] [0,0] ;
    // mur sous l'escalier, face en y = −200.
    for (const base of [
      createProject("quarter-left"),
      toCageLayout(createProject("quarter-left"))!,
    ]) {
      const p = withSite(base, { walls: [wall("M", [-2000, -300], [5000, -300])] });
      const list = flanks(p);
      expect(list.length).toBeGreaterThan(0);
      for (const t of list) {
        const model = build(applied(p, t.placement));
        expect(
          (model.siteFit ?? []).filter((c) => c.kind === "wall"),
          `${t.section} ${t.side}`,
        ).toEqual([]);
      }
    }
  });

  it("propriété : toute cible de flanc appliquée est sans conflit avec son mur", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("straight" as const, "quarter-left" as const, "two-quarters-u" as const),
        fc.integer({ min: -4000, max: 4000 }),
        fc.integer({ min: -4000, max: 4000 }),
        fc.integer({ min: 0, max: 359 }),
        fc.integer({ min: 100, max: 300 }),
        (preset, x, y, angle, thickness) => {
          const dir = V.fromAngle((angle * Math.PI) / 180);
          const c = { x, y };
          const a = V.addScaled(c, dir, -6000);
          const b = V.addScaled(c, dir, 6000);
          const p = withSite(createProject(preset), {
            walls: [wall("M", [a.x, a.y], [b.x, b.y], thickness)],
          });
          for (const t of flanks(p)) {
            const model = build(applied(p, t.placement));
            expect((model.siteFit ?? []).filter((k) => k.kind === "wall")).toEqual([]);
          }
        },
      ),
      { numRuns: 25 },
    );
  });

  it("mur trop loin le long de la montée : pas de cible", () => {
    const p = withSite(createProject("straight"), {
      walls: [wall("M", [1300, 8000], [1300, 9000])],
    });
    expect(flanks(p)).toEqual([]);
  });
});

describe("accroche : longueurs par girons entiers", () => {
  it("volée droite : k · g, longueur de volée identique (aucun tournant)", () => {
    const p = createProject("straight");
    const model = build(p);
    const g = model.stepping.going;
    const lengths = stairSnapTargets(p, model).filter((t) => t.kind === "sectionLength");
    expect(lengths).toHaveLength(model.stepping.treads.length);
    lengths.forEach((t, i) => {
      if (t.kind !== "sectionLength") throw new Error();
      expect(t.goings).toBe(i + 1);
      expect(t.length).toBeCloseTo((i + 1) * g, 9);
      expect(t.legLength).toBeCloseTo((i + 1) * g, 9);
    });
  });

  it("quart tournant : volée au mur = k · g + E par tournant voisin (F11)", () => {
    const p = createProject("quarter-left");
    const model = build(p);
    const g = model.stepping.going;
    const E = p.stair.layout.width;
    const targets = stairSnapTargets(p, model);
    for (const section of [0, 1]) {
      const t = targets.find(
        (x) => x.kind === "sectionLength" && x.section === section && x.goings === 3,
      );
      if (t?.kind !== "sectionLength") throw new Error("cible absente");
      expect(t.length).toBeCloseTo(3 * g, 9);
      expect(t.legLength).toBeCloseTo(3 * g + E, 9);
    }
    // Accroche dans un rayon : la plus proche, rien hors du rayon.
    expect(snapSectionLength(targets, 0, 3 * g + 7, 10)?.goings).toBe(3);
    expect(snapSectionLength(targets, 0, 3 * g + 30, 10)).toBeNull();
  });

  it("tracé libre (cage) : longueur de tronçon k · g, sans longueur de volée", () => {
    const p = toCageLayout(createProject("quarter-left"))!;
    const t = stairSnapTargets(p, build(p)).find((x) => x.kind === "sectionLength");
    if (t?.kind !== "sectionLength") throw new Error("cible absente");
    expect(t.legLength).toBeUndefined();
  });
});

describe("accroche : choix dans un rayon", () => {
  it("prend la cible la plus proche dans le rayon, rien au-delà", () => {
    const p = withSite(createProject("straight"), {
      opening: { kind: "rect", x: 2000, y: 1000, sizeX: 2800, sizeY: 900 },
    });
    const model = build(p);
    const target = stairSnapTargets(p, model).find(
      (t): t is ArrivalSnapTarget => t.kind === "arrival" && t.placement.edge === 3,
    )!;
    const near = { ...target.placement, origin: V.add(target.placement.origin, V.vec(30, -40)) };
    const snap = snapPlacement(p, model, near, 60);
    expect(snap?.placement).toEqual(target.placement);
    expect(snap?.distance).toBeCloseTo(50, 6);
    expect(snapPlacement(p, model, near, 49)).toBeNull();
  });
});

describe("accroche : flanc pour un candidat", () => {
  it("candidat décalé le long du mur, à 20 mm de la face : flanc, position le long du mur conservée", () => {
    const p = withSite(createProject("straight"), {
      walls: [wall("M", [1300, -3000], [1300, 8000])],
    });
    const model = build(p);
    // Face en x = 1 200 ; emprise de 900 : bord droit à 20 mm de la face pour x = 280.
    const candidate = { origin: { x: 280, y: 750 }, rotation: 0 };
    const snap = snapPlacement(p, model, candidate, 30);
    expect(snap?.target.kind).toBe("wallFlank");
    expect(snap?.placement).toEqual({ origin: { x: 300, y: 750 }, rotation: 0 });
    expect(snap?.distance).toBeCloseTo(20, 6);
    expect(snapPlacement(p, model, candidate, 19)).toBeNull();
  });
});

describe("propriétés des accroches", () => {
  it("une cible d'arrivée appliquée pose l'arrivée sur la trémie visée, sans conflit d'arrivée", () => {
    fc.assert(
      fc.property(
        fc.record({
          x: fc.integer({ min: -3000, max: 3000 }),
          y: fc.integer({ min: -3000, max: 3000 }),
          sizeX: fc.integer({ min: 1000, max: 3600 }),
          sizeY: fc.integer({ min: 1000, max: 3600 }),
          width: fc.integer({ min: 700, max: 1000 }),
          pick: fc.nat(),
        }),
        (s) => {
          const p = withSite(createProject("straight", { width: s.width }), {
            opening: { kind: "rect", x: s.x, y: s.y, sizeX: s.sizeX, sizeY: s.sizeY },
          });
          const targets = stairSnapTargets(p, build(p)).filter(
            (t): t is ArrivalSnapTarget => t.kind === "arrival",
          );
          expect(targets.length).toBeGreaterThan(0);
          const t = targets[s.pick % targets.length]!;
          expectArrivalOnOpening(applied(p, t.placement), t.placement.edge);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("snapAngle est idempotent et reste à moins d'un demi-pas", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        fc.constantFrom(1, 5, 15, 22.5, 45, 90, Math.PI / 12),
        (a, step) => {
          const s = snapAngle(a, step);
          expect(snapAngle(s, step)).toBe(s);
          expect(Math.abs(s - a)).toBeLessThanOrEqual(step / 2 + 1e-9);
        },
      ),
    );
    expect(snapAngle(17, 0)).toBe(17);
    expect(Object.is(snapAngle(-1, 15), 0)).toBe(true);
  });

  it("snapPlacement : la cible la plus proche (arrivées et flancs du candidat) dès qu'elle est dans le rayon", () => {
    const p = withSite(createProject("straight"), {
      opening: { kind: "rect", x: 2000, y: 1000, sizeX: 2800, sizeY: 900 },
      walls: [wall("M", [1300, -1000], [1300, 5000]), wall("N", [-2000, 6000], [6000, 6000])],
    });
    const model = build(p);
    const arrivals = stairSnapTargets(p, model).filter(
      (t): t is ArrivalSnapTarget => t.kind === "arrival",
    );
    fc.assert(
      fc.property(
        fc.integer({ min: -3000, max: 6000 }),
        fc.integer({ min: -3000, max: 6000 }),
        fc.integer({ min: -180, max: 180 }),
        fc.integer({ min: 0, max: 3000 }),
        (x, y, rotation, radius) => {
          const candidate = { origin: { x, y }, rotation };
          // Flancs recalculés pour le candidat : cibles du projet placé au candidat.
          const atCandidate = placed(p, candidate);
          const flanksOfCandidate = stairSnapTargets(atCandidate, build(atCandidate)).filter(
            (t): t is WallFlankSnapTarget => t.kind === "wallFlank",
          );
          let best = Number.POSITIVE_INFINITY;
          for (const t of [...arrivals, ...flanksOfCandidate])
            best = Math.min(best, placementDistance(p, model, candidate, t.placement));
          const snap = snapPlacement(p, model, candidate, radius);
          if (best <= radius) {
            expect(snap).not.toBeNull();
            expect(snap!.distance).toBeCloseTo(best, 6);
            expect(snap!.distance).toBeLessThanOrEqual(radius);
            expect(placementDistance(p, model, candidate, snap!.placement)).toBeCloseTo(
              snap!.distance,
              9,
            );
          } else expect(snap).toBeNull();
        },
      ),
      { numRuns: 60 },
    );
  });

  it("toWorld de l'origine locale : origine du placement", () => {
    expect(toWorld(V.ZERO, { origin: { x: 12, y: -3 }, rotation: 37 })).toEqual({ x: 12, y: -3 });
  });
});

describe("rotation autour d'un pivot (poignée de rotation de l'éditeur)", () => {
  it("propriété : le pivot reste immobile, la rotation est celle demandée", () => {
    const arbVec = fc.record({
      x: fc.double({ min: -1e4, max: 1e4, noNaN: true }),
      y: fc.double({ min: -1e4, max: 1e4, noNaN: true }),
    });
    fc.assert(
      fc.property(
        arbVec,
        fc.double({ min: -720, max: 720, noNaN: true }),
        arbVec,
        fc.double({ min: -720, max: 720, noNaN: true }),
        (origin, rotation, pivot, next) => {
          const from: StairPlacement = { origin, rotation };
          const to = rotatePlacementAbout(from, pivot, next);
          expect(to.rotation).toBe(next);
          const local = toLocal(pivot, from);
          expect(V.distance(toWorld(local, to), pivot)).toBeLessThan(1e-6);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("pivot de l'escalier : centre de l'emprise, indépendant du placement en repère local", () => {
    const p = createProject("quarter-left");
    const m = build(p);
    const c = stairPivot(p, m.layout);
    const xs = m.layout.footprint.map((q) => q.x);
    const ys = m.layout.footprint.map((q) => q.y);
    // Rotation nulle : boîte locale = boîte du site, décalée de l'origine.
    expect(p.stair.placement.rotation).toBe(0);
    expect(c.x).toBeCloseTo((Math.min(...xs) + Math.max(...xs)) / 2, 9);
    expect(c.y).toBeCloseTo((Math.min(...ys) + Math.max(...ys)) / 2, 9);
    const other: StairPlacement = { origin: { x: 500, y: -200 }, rotation: 30 };
    const moved = stairPivot(p, m.layout, other);
    expect(V.distance(toLocal(moved, other), toLocal(c, p.stair.placement))).toBeLessThan(1e-9);
  });
});
