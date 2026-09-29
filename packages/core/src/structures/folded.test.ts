import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pointInPolygon, signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { Part } from "../model/derived.js";
import type { Polygon2, Vec2 } from "../model/primitives.js";
import type { ResolvedBend } from "../workshop/metal.js";
import {
  arrivalRiserSection,
  developArrivalRiser,
  developFoldedTread,
  flatLength,
  insetPlate,
  sectionPolygon,
  uSection,
  untangle,
  zSection,
  type FoldedTreadInput,
} from "./folded.js";
import { isSimplePolygon } from "./geom.js";
import { groupIdenticalFlats } from "./steelCommon.js";

const bendOf = (t: number, r: number, k: number): ResolvedBend => ({
  thickness: t,
  innerRadius: r,
  k,
  minFlange: 0,
  method: "kFactor",
});

/** Dessus rectangulaire W × D : nez sur y = 0, arrière sur y = D (repère plan). */
function rectInput(over: Partial<FoldedTreadInput> = {}): FoldedTreadInput {
  const W = 800;
  const D = 250;
  return {
    profile: "Z",
    plate: [V.vec(0, 0), V.vec(W, 0), V.vec(W, D), V.vec(0, D)],
    front: { p: V.vec(0, 0), dir: V.vec(1, 0) },
    rear: { p: V.vec(0, D), dir: V.vec(1, 0) },
    bend: bendOf(5, 6.5, 0.33),
    riserDrop: 180,
    returnLength: 40,
    noseHeight: 40,
    rearHeight: 40,
    mark: "M1",
    ...over,
  };
}

/** Étendue en y du contour sur la verticale x = xm (corde). */
function chordAt(poly: Polygon2, xm: number): number {
  const ys: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    if ((a.x - xm) * (b.x - xm) <= 0 && Math.abs(b.x - a.x) > 1e-12) {
      ys.push(a.y + ((b.y - a.y) * (xm - a.x)) / (b.x - a.x));
    }
  }
  return Math.max(...ys) - Math.min(...ys);
}

describe("tôle pliée — développé en fibre neutre (CHALLENGE G5)", () => {
  it("tôle en Z de référence : développé recalculé à la main (t = 5, r_int = 6,5, K = 0,33)", () => {
    const t = 5;
    const r = 6.5;
    const k = 0.33;
    // Ailes droites : cote extérieure − retraits (r + t) des plis.
    const plate = 250 - (r + t); // 238,5
    const riser = 180 - t - 2 * r; // 162 (dessus → dessus du retour = h + t)
    const ret = 40 - r; // 33,5 (retour mesuré depuis la face avant de la contremarche)
    const ba = (Math.PI / 2) * (r + k * t); // 12,802 par pli à 90°
    const expected = plate + riser + ret + 2 * ba;
    expect(expected).toBeCloseTo(459.604, 3);

    const s = zSection({
      depth: 250,
      riserDrop: 180,
      returnLength: 40,
      thickness: t,
      innerRadius: r,
    });
    expect(s.straights).toEqual([plate, riser, ret]);
    expect(flatLength(s, k)).toBeCloseTo(expected, 9);

    const res = developFoldedTread(rectInput());
    const out = res.flat.outline.outer;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of out) {
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    expect(maxY - minY).toBeCloseTo(expected, 9);
    // Largeur : le dessus fait 800 mm, les ailes aussi (dessus rectangulaire, pas de jeu).
    expect(res.s1 - res.s0).toBeCloseTo(800, 9);
    // Lignes de pli (repère local : y = 0 au bout du retour, y croît vers l'arrière).
    const bends = res.flat.lines.filter((l) => l.kind === "bend");
    expect(bends).toHaveLength(2);
    const yNose = bends[0]!.a.y;
    const yReturn = bends[1]!.a.y;
    expect(yReturn).toBeCloseTo(ret + ba / 2, 9);
    expect(yNose).toBeCloseTo(ret + ba + riser + ba / 2, 9);
    expect(bends[0]!).toMatchObject({ bendAngle: 90, bendUp: false, bendRadius: r });
    expect(bends[1]!).toMatchObject({ bendAngle: 90, bendUp: true, bendRadius: r });
    expect(bends[0]!.label).toMatch(/^P1 · 90° vers le bas · r_int 6,5/);
    expect(res.flat.reference?.kind).toBe("neutral-fiber");
    // Ailes intérieures : dessus D − t, contremarche droite + r, retour L_r.
    expect(res.flanges.map((f) => [f.label, f.atStart])).toEqual([
      ["dessus", 245],
      ["contremarche", riser + r],
      ["retour", 40],
    ]);
    expect(res.prismatic).toBe(true);
    expect(res.flatArea).toBeCloseTo(800 * expected, 6);
  });

  it("tôle en U de référence : ailes H − t − r, dessus D − 2(t + r), deux plis vers le bas", () => {
    const t = 4;
    const r = 5;
    const k = 0.4;
    const s = uSection({
      depth: 260,
      noseHeight: 50,
      rearHeight: 45,
      thickness: t,
      innerRadius: r,
    });
    expect(s.straights).toEqual([50 - 9, 260 - 18, 45 - 9]);
    const ba = (Math.PI / 2) * (r + k * t);
    expect(flatLength(s, k)).toBeCloseTo(41 + 242 + 36 + 2 * ba, 9);
    const res = developFoldedTread(
      rectInput({
        profile: "U",
        plate: [V.vec(0, 0), V.vec(700, 0), V.vec(700, 260), V.vec(0, 260)],
        rear: { p: V.vec(0, 260), dir: V.vec(1, 0) },
        bend: bendOf(t, r, k),
        noseHeight: 50,
        rearHeight: 45,
      }),
    );
    expect(chordAt(res.flat.outline.outer, 350)).toBeCloseTo(flatLength(s, k), 9);
    const bends = res.flat.lines.filter((l) => l.kind === "bend");
    expect(bends.map((b) => b.bendUp)).toEqual([false, false]);
  });

  it("section fermée : contour simple, aire = longueur développée × t (fibre neutre au milieu à K = 0,5)", () => {
    for (const s of [
      zSection({ depth: 250, riserDrop: 180, returnLength: 40, thickness: 5, innerRadius: 6.5 }),
      uSection({ depth: 250, noseHeight: 40, rearHeight: 40, thickness: 5, innerRadius: 6.5 }),
    ]) {
      const poly = sectionPolygon(s);
      expect(isSimplePolygon(poly)).toBe(true);
      // Arcs échantillonnés : aire à 0,2 % près de L(K = 0,5) × t.
      expect(Math.abs(signedArea(poly)) / (flatLength(s, 0.5) * 5)).toBeCloseTo(1, 2);
    }
  });

  it("aile sans partie droite (rayon trop grand pour la cote) : erreur explicite", () => {
    expect(() => developFoldedTread(rectInput({ returnLength: 5 }))).toThrow(
      /retour.*sans partie droite/,
    );
  });

  it("propriété : dessus quelconque (lignes de pli non parallèles) — contour fermé simple, plis dans le contour, somme des ailes = longueur développée", () => {
    const arb = fc.record({
      profile: fc.constantFrom<"Z" | "U">("Z", "U"),
      width: fc.integer({ min: 500, max: 1200 }),
      d0: fc.integer({ min: 120, max: 350 }),
      d1: fc.integer({ min: 120, max: 400 }),
      dxL: fc.integer({ min: -120, max: 120 }),
      dxR: fc.integer({ min: -120, max: 120 }),
      rot: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
      tr: fc.constantFrom<[number, number]>([3, 4], [4, 5], [5, 6.5], [6, 8]),
      k: fc.double({ min: 0.25, max: 0.5, noNaN: true }),
      rise: fc.integer({ min: 150, max: 210 }),
      ret: fc.integer({ min: 30, max: 80 }),
      hn: fc.integer({ min: 30, max: 80 }),
      hb: fc.integer({ min: 30, max: 80 }),
      parallel: fc.boolean(),
    });
    fc.assert(
      fc.property(arb, (g) => {
        const R = (p: Vec2): Vec2 => V.rotate(p, g.rot);
        const a0 = V.vec(0, 0);
        const a1 = V.vec(g.width, 0);
        const b1 = g.parallel ? V.vec(g.width + g.dxL, g.d0) : V.vec(g.width + g.dxR, g.d1);
        const b0 = V.vec(g.dxL, g.d0);
        const [t, r] = g.tr;
        const input: FoldedTreadInput = {
          profile: g.profile,
          plate: [a0, a1, b1, b0].map(R),
          front: { p: R(a0), dir: V.rotate(V.vec(1, 0), g.rot) },
          rear: { p: R(b0), dir: V.rotate(V.sub(b1, b0), g.rot) },
          bend: bendOf(t, r, g.k),
          riserDrop: g.rise + t,
          returnLength: g.ret,
          noseHeight: g.hn,
          rearHeight: g.hb,
          mark: "M",
        };
        const res = developFoldedTread(input);
        const out = res.flat.outline.outer;
        expect(out.length).toBeGreaterThanOrEqual(3);
        expect(isSimplePolygon(out)).toBe(true);
        expect(signedArea(out)).toBeGreaterThan(0);
        for (const l of res.flat.lines.filter((x) => x.kind === "bend")) {
          for (const p of [l.a, l.b, V.lerp(l.a, l.b, 0.5)]) {
            expect(pointInPolygon(p, out, 1e-6)).not.toBe("outside");
          }
        }
        // Corde perpendiculaire au pli du nez, au milieu de la ligne de pli = L de la section
        // (Z : bord arrière libre ; U : seulement si le pli arrière est parallèle, sinon
        // l'aile arrière se déplie perpendiculairement à son propre pli).
        if (g.profile === "Z" || g.parallel) {
          const nose = res.flat.lines.find((x) => x.kind === "bend")!;
          const xm = (nose.a.x + nose.b.x) / 2;
          expect(chordAt(out, xm)).toBeCloseTo(flatLength(res.section, g.k), 6);
        }
        // Nombre de plis : 2 (Z : nez + retour ; U : nez + arrière).
        expect(res.bendLines).toHaveLength(2);
      }),
      { numRuns: 300 },
    );
  });
});

describe("tôle pliée — jeu latéral et pièces identiques", () => {
  it("retrait latéral : arêtes de nez conservées, autres arêtes décalées ; languette autour d'un poteau supprimée", () => {
    const poly = [V.vec(0, 0), V.vec(800, 0), V.vec(800, 250), V.vec(0, 250)];
    const inset = insetPlate(
      poly,
      [
        { p: V.vec(0, 0), dir: V.vec(1, 0) },
        { p: V.vec(0, 250), dir: V.vec(1, 0) },
      ],
      10,
    )!;
    expect(inset.map((p) => [p.x, p.y])).toEqual([
      [10, 0],
      [790, 0],
      [790, 250],
      [10, 250],
    ]);
    // Marche balancée qui contourne un poteau (cas n° 1, M4) : jeu 10 mm → contour simple.
    const m4 = [
      [800, 1198.3346285030875],
      [800, 1280],
      [310.8141445984073, 1280],
      [19.425884037400465, 530],
      [50, 530],
      [50, 430],
      [0, 430],
      [0, 360],
    ].map(([x, y]) => V.vec(x!, y!));
    const a = { p: V.vec(0, 360), dir: V.vec(0.6903725584707325, 0.7234540279178595) };
    const b = {
      p: V.vec(19.425884037400465, 530),
      dir: V.vec(0.36214568575725636, 0.9321215061822179),
    };
    const res = insetPlate(m4, [a, b], 10)!;
    expect(res).not.toBeNull();
    expect(isSimplePolygon(res)).toBe(true);
    expect(signedArea(res)).toBeGreaterThan(0);
    expect(untangle([V.vec(0, 0), V.vec(1, 1), V.vec(1, 0), V.vec(0, 1)])).not.toBeNull();
  });

  it("regroupement à 0,5 mm près, à un déplacement plan près ; plis de sens opposés distingués", () => {
    const flatOf = (over: Partial<FoldedTreadInput>, rot: number, shift: Vec2): Part => {
      const res = developFoldedTread(rectInput(over));
      const T = (p: Vec2): Vec2 => V.add(V.rotate(p, rot), shift);
      return {
        id: `p${Math.random()}`,
        mark: "M",
        category: "tread",
        name: "M",
        material: "steel-painted",
        solid: { kind: "sweep", path: [], section: { outer: [], holes: [] } },
        flat: {
          ...res.flat,
          outline: { outer: res.flat.outline.outer.map(T), holes: [] },
          lines: res.flat.lines.map((l) => ({ ...l, a: T(l.a), b: T(l.b) })),
        },
        quantities: {},
      };
    };
    const a = flatOf({}, 0, V.ZERO);
    const b = flatOf({}, 1.1, V.vec(500, -30));
    const c = flatOf({ riserDrop: 180.3 }, 0.3, V.vec(10, 10));
    const d = flatOf({ riserDrop: 181 }, 0, V.ZERO);
    const e = flatOf({ profile: "U" }, 0, V.ZERO);
    const groups = groupIdenticalFlats([a, b, c, d, e]);
    expect(groups).toEqual([[a.id, b.id, c.id], [d.id], [e.id]]);
  });
});

describe("contremarche d'arrivée des marches en Z (décision A11)", () => {
  const input = {
    start: V.vec(0, 0),
    end: V.vec(780, 0),
    up: V.vec(0, 1),
    zTop: 2700,
    riserDrop: 185,
    returnLength: 40,
    bend: bendOf(5, 6.5, 0.33),
    holes: 3,
    holeDiameter: 11,
    holeEdgeDistance: 50,
    mark: "CM15",
  };

  it("section en L : longueur développée = ailes droites + un pli, contour simple", () => {
    const section = arrivalRiserSection({
      riserDrop: 185,
      returnLength: 40,
      thickness: 5,
      innerRadius: 6.5,
    });
    expect(section.straights).toEqual([185 - 6.5, 40 - 6.5]);
    const poly = sectionPolygon(section);
    expect(isSimplePolygon(poly)).toBe(true);
    // Face avant sur la ligne de nez (X = 0), arête haute à Y = 0, retour sous Y = −riserDrop.
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    expect(Math.max(...xs)).toBeCloseTo(5, 9);
    expect(Math.min(...xs)).toBeCloseTo(-40, 9);
    expect(Math.max(...ys)).toBeCloseTo(0, 9);
    expect(Math.min(...ys)).toBeCloseTo(-185 - 5, 9);
    const res = developArrivalRiser(input);
    const ysFlat = res.flat.outline.outer.map((p) => p.y);
    expect(Math.max(...ysFlat) - Math.min(...ysFlat)).toBeCloseTo(flatLength(section, 0.33), 9);
    expect(res.length).toBeCloseTo(780, 9);
    expect(res.holeCenters.map((c) => c.x)).toEqual([50, 390, 730]);
    expect(res.flat.outline.holes).toHaveLength(3);
    expect(res.flat.lines.filter((l) => l.kind === "bend")).toHaveLength(1);
    // Repère direct : X vers le chevêtre, Z le long de la ligne de nez.
    expect(res.frame.xAxis).toEqual({ x: 0, y: 1, z: 0 });
    // X × Y (vertical) = Z.
    expect(res.frame.zAxis.x).toBe(1);
    expect(Math.abs(res.frame.zAxis.y)).toBe(0);
  });

  it("aile sans partie droite : erreur lisible", () => {
    expect(() => developArrivalRiser({ ...input, returnLength: 5 })).toThrow(
      /CM15 : aile « retour » sans partie droite/,
    );
  });
});
