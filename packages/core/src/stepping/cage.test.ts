/**
 * Découpage et balancement d'une cage saisie (sous-lot 2c, ADR-0010, plan C.1-C.2, décisions
 * F2, F3 et F12) : jonctions de 60° et 120° balancées en M0, M1, M3 et M6, herse M2 refusée hors
 * de ±90°, marches rayonnantes (M0 forcé, nez de séparation d'un tournant balancé contigu), jour
 * en pan coupé (refus du palier d'angle, des marches rayonnantes et de M0 ; repli vers un sommet
 * du jour au-delà de 90°), palier droit entre deux tronçons de largeurs
 * différentes, trapèze droit, axe en arc de 90°, longueur `auto` d'un tronçon unique, centre du
 * tournant (`turnCenter`) à angle quelconque, pipeline (découpage et pièces de base calculés,
 * garde-corps, échappée et règles sautés jusqu'au sous-lot 2d). Les propriétés sur des cages
 * générées sont dans `cage.property.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { MessageError, type MessageKey } from "@blondel/i18n";
import { curveLength, curvePointAt } from "../geom2d/curve.js";
import { distanceToCurve } from "../geom2d/intersect.js";
import { wrapPi } from "../geom2d/segment.js";
import * as V from "../geom2d/vec.js";
import { turnCenter } from "../balancing/zone.js";
import { M2_STRATEGY } from "../balancing/m2.js";
import { M6_STRATEGY } from "../balancing/m6.js";
import { computeLayout } from "../layout/layout.js";
import { resolveTargetGoing } from "../layout/resolve.js";
import type { Layout, LayoutSectionLine, NosingLine, Stepping } from "../model/derived.js";
import type { Vec2 } from "../model/primitives.js";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type BalancingMethod,
  type CageLayoutSpecInput,
  type Project,
} from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { SteppingError } from "./errors.js";
import { lineAxis } from "./sections.js";
import { isAutoStraightRun } from "./positions.js";
import { computeStepping } from "./stepping.js";

type SectionInput = CageLayoutSpecInput["sections"][number];
type JunctionInput = CageLayoutSpecInput["junctions"][number];

const straight = (
  length: number,
  width = 900,
  extra: Partial<SectionInput> = {},
): SectionInput => ({
  axis: { kind: "straight", length },
  width,
  ...extra,
});

function cageProject(layout: CageLayoutSpecInput, method: BalancingMethod = "M3"): Project {
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: { floorToFloor: 2700, upperSlabThickness: 200 },
    stair: {
      placement: { origin: { x: 0, y: 0 }, rotation: 0 },
      layout,
      balancing: { method },
    },
  });
}

/** Deux tronçons droits de 1 500 mm, E = 900, reliés par une jonction. */
const two = (junction: JunctionInput, widths: [number, number] = [900, 900]) => ({
  kind: "cage" as const,
  sections: [straight(1500, widths[0]), straight(1500, widths[1])],
  junctions: [junction],
});

function run(layout: CageLayoutSpecInput, method: BalancingMethod = "M3") {
  const project = cageProject(layout, method);
  const lay = computeLayout(project);
  return { project, layout: lay, stepping: computeStepping(project, lay) };
}

const noteKeys = (st: Stepping): MessageKey[] => st.notes.map((n) => n.key);

/** Distance d'un point à la droite portant une ligne transversale. */
function distanceToLine(p: Vec2, line: LayoutSectionLine): number {
  const d = V.normalize(V.sub(line.right, line.left));
  return Math.abs(V.cross(d, V.sub(p, line.left)));
}

/** Les extrémités Q et R de chaque nez sont sur les bords réels C_i et C_e. */
function expectOnEdges(layout: Layout, st: Stepping): void {
  for (const nl of st.nosings) {
    expect(distanceToCurve(nl.q, layout.inner)).toBeLessThan(1e-6);
    expect(distanceToCurve(nl.r, layout.outer)).toBeLessThan(1e-6);
    expect(distanceToCurve(nl.p, layout.walkline)).toBeLessThan(1e-6);
  }
}

/** La ligne de nez passe-t-elle par `c` (droite P + t·dir) ? */
const throughPoint = (nl: NosingLine, c: Vec2): number => Math.abs(V.cross(nl.dir, V.sub(c, nl.p)));

describe("jonction d'angle quelconque balancée (décision F3 : M0, M1, M3, M6 à tout angle)", () => {
  it.each([
    [60, "M1"],
    [60, "M3"],
    [60, "M6"],
    [120, "M1"],
    [120, "M3"],
    [120, "M6"],
    [-60, "M3"],
    [-120, "M6"],
  ] as const)("%s° en %s : une zone, collets positifs, aucun croisement", (angle, method) => {
    const { layout, stepping: st } = run(two({ angle, mode: "winders" }), method);
    expect(layout.turns[0]!.angle).toBeCloseTo((angle * Math.PI) / 180, 12);
    expect(st.balancedZones).toHaveLength(1);
    expect(st.balancedZones[0]!.method.startsWith(method)).toBe(true);
    for (const t of st.treads) expect(t.colletChord).toBeGreaterThan(1);
    expect(noteKeys(st)).not.toContain("stepping.k5Crossing");
    expect(noteKeys(st)).not.toContain("stepping.zeroCollet");
    expectOnEdges(layout, st);
    // Girons sur Γ en longueur d'arc (F2) : tous égaux au giron nominal.
    for (const t of st.treads) expect(t.going).toBeCloseTo(st.going, 9);
  });

  it.each([60, 120, -60, -120])(
    "M6 à %s° : rotation totale des nez de la zone = angle de la jonction",
    (angle) => {
      const { stepping: st } = run(two({ angle, mode: "winders" }), "M6");
      const { from, to } = st.balancedZones[0]!;
      let total = 0;
      for (let k = from; k < to; k++) {
        total += wrapPi(V.angleOf(st.nosings[k + 1]!.dir) - V.angleOf(st.nosings[k]!.dir));
      }
      expect(total).toBeCloseTo((angle * Math.PI) / 180, 9);
    },
  );

  it.each([60, 120])(
    "M0 à %s° (jour en arc) : nez de la zone rayonnants depuis le centre",
    (angle) => {
      const spec = two({ angle, mode: "winders", well: { kind: "arc", radius: 200 } });
      const { layout, stepping: st } = run(spec, "M0");
      const zone = st.balancedZones[0]!;
      expect(zone.method).toBe("M0");
      const c = turnCenter(layout, 0);
      for (let k = zone.from + 1; k < zone.to; k++) {
        expect(throughPoint(st.nosings[k]!, c)).toBeLessThan(1e-6);
      }
      for (const t of st.treads) expect(t.colletChord).toBeGreaterThan(1);
    },
  );

  it("M0 à 60° (jour vif) : nez rayonnants depuis le coin K", () => {
    const { layout, stepping: st } = run(two({ angle: 60, mode: "winders" }), "M0");
    const c = turnCenter(layout, 0);
    expect(V.distance(c, layout.turns[0]!.innerCorner)).toBeLessThan(1e-9);
    const zone = st.balancedZones[0]!;
    for (let k = zone.from + 1; k < zone.to; k++) {
      expect(throughPoint(st.nosings[k]!, c)).toBeLessThan(1e-6);
    }
  });
});

describe("centre du tournant (`turnCenter`) à angle quelconque", () => {
  it.each([45, 60, 120, 150, -30, -135])(
    "%s°, jour vif : centre = coin K, rayon de Γ = d_f",
    (angle) => {
      const { layout } = run(two({ angle, mode: "winders" }));
      const t = layout.turns[0]!;
      const c = turnCenter(layout, 0);
      expect(V.distance(c, t.innerCorner)).toBeLessThan(1e-9);
      const df = t.walklineOffset ?? layout.walklineOffset;
      for (const f of [0.1, 0.5, 0.9]) {
        const p = curvePointAt(layout.walkline, t.sStart + f * (t.sEnd - t.sStart));
        expect(V.distance(p, c)).toBeCloseTo(df, 6);
      }
    },
  );

  it.each([60, 120, -120])(
    "%s°, jour en arc de 200 mm : Γ concentrique, rayon r + d_f",
    (angle) => {
      const { layout } = run(two({ angle, mode: "winders", well: { kind: "arc", radius: 200 } }));
      const t = layout.turns[0]!;
      const c = turnCenter(layout, 0);
      const df = t.walklineOffset ?? layout.walklineOffset;
      for (const f of [0.1, 0.5, 0.9]) {
        const p = curvePointAt(layout.walkline, t.sStart + f * (t.sEnd - t.sStart));
        expect(V.distance(p, c)).toBeCloseTo(200 + df, 6);
      }
    },
  );

  it("palier droit : pas de centre, erreur claire", () => {
    const { layout } = run(two({ angle: 0, mode: "landing" }));
    expect(() => turnCenter(layout, 0)).toThrow(MessageError);
  });
});

describe("herse (M2) : refusée hors de ±90° (décision F3)", () => {
  it.each([60, 120, -45])(
    "%s° : erreur claire du découpage, sans exception de buildModel",
    (angle) => {
      const project = cageProject(two({ angle, mode: "winders" }), "M2");
      let caught: unknown;
      try {
        computeStepping(project, computeLayout(project));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(SteppingError);
      expect((caught as SteppingError).msg.key).toBe("balancing.m2.angleNotSupported");
      expect((caught as SteppingError).msg.params).toMatchObject({ turn: 1 });
      const model = buildModel(project, { memo: false });
      expect(model.errors.map((e) => e.key)).toEqual(["balancing.m2.angleNotSupported"]);
      expect(model.stepping.treads).toHaveLength(0);
    },
  );

  it("90° : herse calculée comme pour un tracé à volées", () => {
    const { stepping: st } = run(two({ angle: 90, mode: "winders" }), "M2");
    expect(st.balancedZones.map((z) => z.method)).toEqual(["M2"]);
  });

  it("à 60°, la stratégie elle-même refuse (jonction et angle dans la raison)", () => {
    const project = cageProject(two({ angle: 60, mode: "winders" }), "M3");
    const layout = computeLayout(project);
    const st = computeStepping(project, layout);
    const zone = st.balancedZones[0]!;
    const sol = M2_STRATEGY.solve({
      layout,
      nosings: st.nosings,
      zone: {
        turn: 0,
        from: zone.from,
        to: zone.to,
        collarSide: "left",
        ends: ["tangent", "tangent"],
      },
      z: st.nosings.map((n) => n.z),
      rise: st.rise,
      going: st.going,
      params: {},
    });
    expect(sol.kind).toBe("fail");
    if (sol.kind === "fail") {
      expect(sol.reason.key).toBe("balancing.m2.fail.angleNotSupported");
      expect(sol.reason.params).toMatchObject({ turn: 1 });
    }
  });

  it("palier d'angle ou marches rayonnantes à 60° avec M2 : aucun refus (pas de herse)", () => {
    expect(() => run(two({ angle: 60, mode: "landing" }), "M2")).not.toThrow();
    const { stepping: st } = run(
      two({ angle: 60, mode: "radiating", well: { kind: "arc", radius: 200 } }),
      "M2",
    );
    expect(st.balancedZones.map((z) => z.method)).toEqual(["M0"]);
  });
});

describe("M6 lit l'angle de la jonction (`TurnZone.angle`)", () => {
  /** Angles φ rendus par M6 pour la zone de `st`, sur le tracé `layout`. */
  function m6Phi(layout: Layout, st: Stepping): number[] {
    const zone = st.balancedZones[0]!;
    const sol = M6_STRATEGY.solve({
      layout,
      nosings: st.nosings,
      zone: {
        turn: 0,
        from: zone.from,
        to: zone.to,
        collarSide: "left",
        ends: ["tangent", "tangent"],
      },
      z: st.nosings.map((n) => n.z),
      rise: st.rise,
      going: st.going,
      params: {},
    });
    expect(sol.kind).toBe("phi");
    return sol.kind === "phi" ? [...sol.phi] : [];
  }

  it("le sens et l'ampleur de la rotation suivent l'angle porté par la jonction", () => {
    const { layout, stepping: st } = run(two({ angle: 120, mode: "winders" }), "M6");
    const zone = st.balancedZones[0]!;
    const phiA = V.angleOf(st.nosings[zone.from]!.dir);
    // Angle réel (120°, à gauche) : φ croissants, de φ_a vers φ_a + 120°.
    const phi = m6Phi(layout, st);
    expect(phi.length).toBe(zone.to - zone.from - 1);
    expect(phi[0]!).toBeGreaterThan(phiA);
    for (let i = 0; i + 1 < phi.length; i++) expect(phi[i + 1]!).toBeGreaterThan(phi[i]!);
    expect(phi[phi.length - 1]! - phiA).toBeLessThan((2 * Math.PI) / 3);
    // Entrée synthétique : même géométrie et mêmes nez fixes (120° modulo 2π), angle de la
    // jonction décalé d'un tour (120° − 360° = −240°). M6 suit `TurnZone.angle` : φ décroissants
    // (sens horaire), au-delà de −120° ; l'ancien calcul (±90° selon le sens, recalé sur les nez
    // fixes) tournait de +120°.
    const shifted: Layout = {
      ...layout,
      turns: layout.turns.map((t) => ({ ...t, angle: (2 * Math.PI) / 3 - 2 * Math.PI })),
    };
    const back = m6Phi(shifted, st);
    expect(back[0]!).toBeLessThan(phiA);
    for (let i = 0; i + 1 < back.length; i++) expect(back[i + 1]!).toBeLessThan(back[i]!);
    expect(back[back.length - 1]! - phiA).toBeLessThan(-(2 * Math.PI) / 3);
  });
});

describe("marches rayonnantes (mode `radiating`) : M0 forcé", () => {
  it.each(["M1", "M3", "M6"] as const)("méthode %s choisie : zone M0 sur l'arc de Γ", (method) => {
    const spec = two({ angle: 90, mode: "radiating", well: { kind: "arc", radius: 200 } });
    const { layout, stepping: st } = run(spec, method);
    expect(st.balancedZones.map((z) => z.method)).toEqual(["M0"]);
    const t = layout.turns[0]!;
    const zone = st.balancedZones[0]!;
    const c = turnCenter(layout, 0);
    for (let k = zone.from + 1; k < zone.to; k++) {
      const nl = st.nosings[k]!;
      expect(nl.s).toBeGreaterThan(t.sStart);
      expect(nl.s).toBeLessThan(t.sEnd);
      expect(throughPoint(nl, c)).toBeLessThan(1e-6);
    }
    // Nez hors de l'arc : perpendiculaires aux tronçons droits.
    expect(st.nosings[zone.from]!.s).toBeLessThanOrEqual(t.sStart + 1e-9);
    expect(st.nosings[zone.to]!.s).toBeGreaterThanOrEqual(t.sEnd - 1e-9);
  });

  it("jonction rayonnante et jonction balancée voisines : deux zones, jamais réunies", () => {
    const spec: CageLayoutSpecInput = {
      kind: "cage",
      sections: [straight(1200), straight(300), straight(1200)],
      junctions: [
        { angle: 90, mode: "radiating", well: { kind: "arc", radius: 150 } },
        { angle: 90, mode: "winders", well: { kind: "arc", radius: 150 } },
      ],
    };
    const { stepping: st } = run(spec, "M3");
    expect(st.balancedZones.map((z) => [z.turn, z.method.slice(0, 2)])).toEqual([
      [0, "M0"],
      [1, "M3"],
    ]);
  });

  /** Rayonnant puis balancé (ou l'inverse), partie droite intermédiaire de `mid` mm. */
  const neighbours = (mid: number, reverse: boolean): CageLayoutSpecInput => {
    const junctions: JunctionInput[] = [
      { angle: 90, mode: "radiating", well: { kind: "arc", radius: 150 } },
      { angle: 90, mode: "winders", well: { kind: "arc", radius: 150 } },
    ];
    return {
      kind: "cage",
      sections: [straight(1200), straight(mid), straight(1200)],
      junctions: reverse ? junctions.reverse() : junctions,
    };
  };

  it.each([
    [300, false, "M3"],
    [300, true, "M3"],
    [350, false, "M3"],
    [300, false, "M1"],
    [300, true, "M1"],
    [300, false, "M0"],
  ] as const)(
    "tournants contigus sur Γ sans nez entre eux (H = 2 750, tronçon de %s mm, inversé : %s, %s) : nez de séparation, zones disjointes",
    (mid, reverse, method) => {
      const project = ProjectSchema.parse({
        ...cageProject(neighbours(mid, reverse), method),
        site: { floorToFloor: 2750, upperSlabThickness: 200 },
      });
      const layout = computeLayout(project);
      const st = computeStepping(project, layout);
      const [t0, t1] = layout.turns;
      if (mid === 300) expect(t1!.sStart - t0!.sEnd).toBeLessThan(1e-6);
      // Aucun nez dans la partie droite intermédiaire : sans nez de séparation, les zones se
      // chevauchaient (constat de relecture du 2c).
      expect(st.nosings.filter((n) => n.s > t0!.sEnd + 1e-6 && n.s < t1!.sStart - 1e-6)).toEqual(
        [],
      );
      const zones = [...st.balancedZones].sort((x, y) => x.from - y.from);
      expect(zones).toHaveLength(2);
      expect(zones[0]!.to).toBeLessThanOrEqual(zones[1]!.from);
      const radiatingTurn = reverse ? 1 : 0;
      for (const z of zones) {
        if (z.turn === radiatingTurn) expect(z.method).toBe("M0");
        else expect(z.method.startsWith(method)).toBe(true);
      }
      expect(noteKeys(st)).not.toContain("stepping.k5Crossing");
    },
  );
});

describe("jour en pan coupé (Γ de centre K, décision F6)", () => {
  const chamfer = (setback: number) =>
    ({ kind: "chamfer", setbackIn: setback, setbackOut: setback }) as const;

  it.each([60, 90, 120, -90])(
    "%s° : palier d'angle, marches rayonnantes et M0 refusés (lignes croisées en K)",
    (angle) => {
      const refusal = (spec: CageLayoutSpecInput, method: BalancingMethod) => {
        const project = cageProject(spec, method);
        const layout = computeLayout(project);
        try {
          computeStepping(project, layout);
        } catch (e) {
          expect(e).toBeInstanceOf(SteppingError);
          return (e as SteppingError).msg;
        }
        return undefined;
      };
      const well = chamfer(200);
      expect(refusal(two({ angle, mode: "landing", well }), "M3")).toMatchObject({
        key: "stepping.chamferLandingNotSupported",
        params: { turn: 1 },
      });
      expect(refusal(two({ angle, mode: "radiating", well }), "M3")?.key).toBe(
        "stepping.chamferRadiatingNotSupported",
      );
      expect(refusal(two({ angle, mode: "winders", well }), "M0")?.key).toBe(
        "stepping.chamferRadiatingNotSupported",
      );
    },
  );

  it.each([
    [60, "M3"],
    [90, "M3"],
    [120, "M3"],
    [-120, "M3"],
    [90, "M1"],
    [90, "M6"],
  ] as const)("%s° balancé en %s : une zone, aucun croisement", (angle, method) => {
    const { layout, stepping: st } = run(
      two({ angle, mode: "winders", well: chamfer(200) }),
      method,
    );
    expect(st.balancedZones).toHaveLength(1);
    expect(noteKeys(st)).not.toContain("stepping.k5Crossing");
    expect(noteKeys(st)).not.toContain("stepping.nosingAimedAtWellCorner");
    expectOnEdges(layout, st);
  });

  /** Distance minimale de la ligne de nez aux sommets du bord du jour. */
  const nearestVertex = (layout: Layout, nl: NosingLine): number =>
    Math.min(
      ...layout.inner.segments.flatMap((sg) =>
        sg.kind === "line" ? [throughPoint(nl, sg.a), throughPoint(nl, sg.b)] : [],
      ),
    );

  it("135°, retraits de 150 mm, deux nez balancés de part et d'autre : le nez resté dirigé vers un sommet du jour est signalé", () => {
    const project = ProjectSchema.parse({
      ...cageProject(two({ angle: 135, mode: "winders", well: chamfer(150) })),
      stair: {
        ...cageProject(two({ angle: 135, mode: "winders", well: chamfer(150) })).stair,
        balancing: { method: "M3", windersPerSide: 2 },
      },
    });
    const layout = computeLayout(project);
    const st = computeStepping(project, layout);
    const aimed = st.notes.filter((n) => n.key === "stepping.nosingAimedAtWellCorner");
    expect(aimed.map((n) => n.params?.["nosing"])).toEqual([5]);
    const zone = st.balancedZones[0]!;
    // Nez 5 : borne fixe de la zone, ligne finale = ligne redirigée vers un sommet du jour.
    expect(zone.from).toBe(5);
    expect(nearestVertex(layout, st.nosings[5]!)).toBeLessThan(1e-6);
    expectOnEdges(layout, st);
  });

  it("135° en choix automatique : nez redirigés recalculés par la zone, aucune remarque", () => {
    const { layout, stepping: st } = run(two({ angle: 135, mode: "winders", well: chamfer(150) }));
    expect(noteKeys(st)).not.toContain("stepping.nosingAimedAtWellCorner");
    expect(noteKeys(st)).not.toContain("stepping.k5Crossing");
    expectOnEdges(layout, st);
  });

  it("100° : perpendiculaires qui rencontrent toutes le jour, aucun repli", () => {
    const { stepping: st } = run(two({ angle: 100, mode: "winders", well: chamfer(150) }));
    expect(noteKeys(st)).not.toContain("stepping.nosingAimedAtWellCorner");
  });
});

describe("palier droit (jonction d'angle 0)", () => {
  it.each([
    ["mêmes largeurs", [900, 900]],
    ["largeurs 900 puis 1 200", [900, 1200]],
    ["largeurs 1 200 puis 900", [1200, 900]],
  ] as const)(
    "%s : aucun nez dans le palier, nez des bords sur les lignes transversales",
    (_n, w) => {
      const { layout, stepping: st } = run(two({ angle: 0, mode: "landing" }, [w[0], w[1]]));
      const t = layout.turns[0]!;
      expect(t.angle).toBe(0);
      expect(t.mode).toBe("landing");
      const inside = st.nosings.filter((n) => n.s > t.sStart + 1e-6 && n.s < t.sEnd - 1e-6);
      expect(inside).toEqual([]);
      const landing = st.treads.filter((tr) => tr.kind === "landing");
      expect(landing).toHaveLength(1);
      const k = landing[0]!.number - 1;
      const a = st.nosings[k]!;
      const b = st.nosings[k + 1]!;
      expect(a.s).toBeCloseTo(t.sStart, 9);
      expect(b.s).toBeCloseTo(t.sEnd, 9);
      const [s0, s1] = layout.sections!;
      for (const p of [a.p, a.q, a.r]) expect(distanceToLine(p, s0!.end)).toBeLessThan(1e-6);
      for (const p of [b.p, b.q, b.r]) expect(distanceToLine(p, s1!.start)).toBeLessThan(1e-6);
      expect(st.balancedZones).toEqual([]);
      expectOnEdges(layout, st);
      // Aucune marche balancée : toutes droites hors du palier.
      for (const tr of st.treads) if (tr.kind !== "landing") expect(tr.kind).toBe("straight");
    },
  );

  it("palier droit entre deux jonctions balancées : bords du palier fixes", () => {
    const spec: CageLayoutSpecInput = {
      kind: "cage",
      sections: [straight(1200), straight(600), straight(600), straight(1200)],
      junctions: [
        { angle: 60, mode: "winders" },
        { angle: 0, mode: "landing" },
        { angle: 60, mode: "winders" },
      ],
    };
    const { layout, stepping: st } = run(spec, "M3");
    const landing = layout.turns[1]!;
    for (const z of st.balancedZones) {
      const sa = st.nosings[z.from]!.s;
      const sb = st.nosings[z.to]!.s;
      expect(sb <= landing.sStart + 1e-9 || sa >= landing.sEnd - 1e-9).toBe(true);
    }
    expect(st.balancedZones).toHaveLength(2);
  });
});

describe("trapèze droit (largeur variable)", () => {
  it.each(["left", "right", "center"] as const)(
    "ancrage %s, 800 → 1 200 mm : nez parallèles aux lignes de départ et d'arrivée, sur les bords",
    (anchor) => {
      const spec: CageLayoutSpecInput = {
        kind: "cage",
        sections: [straight(3000, 800, { widthEnd: 1200, anchor })],
        junctions: [],
      };
      const { layout, stepping: st } = run(spec);
      const sec = layout.sections![0]!;
      const u = lineAxis(sec.start);
      for (const nl of st.nosings) expect(Math.abs(V.dot(nl.dir, u))).toBeLessThan(1e-9);
      const first = st.nosings[0]!;
      const last = st.nosings[st.nosings.length - 1]!;
      for (const p of [first.q, first.r]) expect(distanceToLine(p, sec.start)).toBeLessThan(1e-6);
      for (const p of [last.q, last.r]) expect(distanceToLine(p, sec.end)).toBeLessThan(1e-6);
      // Largeur de chaque marche croissante (nez R − Q de plus en plus longs).
      const widths = st.nosings.map((n) => V.distance(n.q, n.r));
      for (let k = 1; k < widths.length; k++) expect(widths[k]!).toBeGreaterThan(widths[k - 1]!);
      expect(widths[0]).toBeCloseTo(800, 6);
      expect(widths[widths.length - 1]).toBeCloseTo(1200, 6);
      expectOnEdges(layout, st);
      for (const t of st.treads) expect(t.going).toBeCloseTo(st.going, 9);
    },
  );
});

describe("axe en arc", () => {
  it("arc de 90° (rayon 1 500, E = 900) : nez rayonnants vers le centre, girons égaux sur Γ", () => {
    const spec: CageLayoutSpecInput = {
      kind: "cage",
      sections: [{ axis: { kind: "arc", radius: 1500, sweep: 90 }, width: 900 }],
      junctions: [],
    };
    const { layout, stepping: st } = run(spec);
    const c = layout.sections![0]!.arc!.center;
    for (const nl of st.nosings) expect(throughPoint(nl, c)).toBeLessThan(1e-6);
    for (const t of st.treads) expect(t.going).toBeCloseTo(st.going, 9);
    expect(st.going * (st.riserCount - 1)).toBeCloseTo(curveLength(layout.walkline), 9);
    // Collets (corde) tous égaux, sur l'arc intérieur.
    const chords = st.treads.map((t) => t.colletChord);
    for (const ch of chords) expect(ch).toBeCloseTo(chords[0]!, 6);
    expect(st.balancedZones).toEqual([]);
    expectOnEdges(layout, st);
  });

  it("arc entre deux paliers droits : nez rayonnants sur l'arc, perpendiculaires sur les droites", () => {
    const spec: CageLayoutSpecInput = {
      kind: "cage",
      sections: [
        straight(1500),
        { axis: { kind: "arc", radius: 2000, sweep: -60 }, width: 900 },
        straight(1500),
      ],
      junctions: [
        { angle: 0, mode: "landing", depth: 900 },
        { angle: 0, mode: "landing", depth: 900 },
      ],
    };
    const { layout, stepping: st } = run(spec);
    const [s0, arc, s2] = layout.sections!;
    const c = arc!.arc!.center;
    for (const nl of st.nosings) {
      if (nl.s > arc!.sStart + 1e-6 && nl.s < arc!.sEnd - 1e-6) {
        expect(throughPoint(nl, c)).toBeLessThan(1e-6);
      }
      for (const sec of [s0!, s2!]) {
        if (nl.s >= sec.sStart - 1e-9 && nl.s <= sec.sEnd + 1e-9) {
          expect(Math.abs(V.dot(nl.dir, lineAxis(sec.start)))).toBeLessThan(1e-9);
        }
      }
    }
    for (const t of layout.turns) {
      expect(st.nosings.filter((n) => n.s > t.sStart + 1e-6 && n.s < t.sEnd - 1e-6)).toEqual([]);
    }
    expectOnEdges(layout, st);
  });
});

describe("longueur `auto` d'un tronçon unique", () => {
  it("giron = giron cible, comme une volée droite `auto`", () => {
    const spec: CageLayoutSpecInput = {
      kind: "cage",
      sections: [{ axis: { kind: "straight", length: "auto" }, width: 900 }],
      junctions: [],
    };
    const { project, stepping: st } = run(spec);
    expect(st.going).toBe(resolveTargetGoing(project, st.riserCount));
  });

  it("`isAutoStraightRun` lit la saisie de la cage (le tracé ne garde pas `auto`)", () => {
    const one = (length: number | "auto") =>
      cageProject({
        kind: "cage",
        sections: [{ axis: { kind: "straight", length }, width: 900 }],
        junctions: [],
      });
    expect(isAutoStraightRun(one("auto"))).toBe(true);
    expect(isAutoStraightRun(one(2700))).toBe(false);
    expect(isAutoStraightRun(cageProject(two({ angle: 90, mode: "winders" })))).toBe(false);
    const base = cageProject(two({ angle: 90, mode: "winders" }));
    const flights = (length: number | "auto"): Project =>
      ProjectSchema.parse({
        ...base,
        stair: { ...base.stair, layout: { width: 900, legs: [{ length }], turns: [] } },
      });
    expect(isAutoStraightRun(flights("auto"))).toBe(true);
    expect(isAutoStraightRun(flights(2700))).toBe(false);
  });
});

describe("pipeline : toute la chaîne sur toute cage (garde-fou aval levé au 2d)", () => {
  it.each<[string, CageLayoutSpecInput]>([
    ["60°", two({ angle: 60, mode: "winders" })],
    ["120° en arc", two({ angle: 120, mode: "winders", well: { kind: "arc", radius: 150 } })],
    ["palier droit", two({ angle: 0, mode: "landing" }, [900, 1200])],
    [
      "trapèze",
      { kind: "cage", sections: [straight(3000, 800, { widthEnd: 1200 })], junctions: [] },
    ],
    [
      "arc",
      {
        kind: "cage",
        sections: [{ axis: { kind: "arc", radius: 1500, sweep: 120 }, width: 900 }],
        junctions: [],
      },
    ],
    ["rayonnant", two({ angle: 90, mode: "radiating", well: { kind: "arc", radius: 200 } })],
  ])("%s : marches, pièces et garde-corps produits, règles évaluées", (_n, spec) => {
    const project = ProjectSchema.parse({
      ...cageProject(spec),
      guards: { flight: { enabled: true } },
    });
    const model = buildModel(project, { memo: false });
    expect(model.errors.map((e) => e.key)).toEqual([]);
    expect(model.stepping.treads.length).toBe(model.stepping.riserCount - 1);
    expect(model.stepping.treads.length).toBeGreaterThan(0);
    expect(model.parts.length).toBeGreaterThan(0);
    // Sous-lot 2d : garde-corps produits ; règles évaluées sur le découpage calculé (plus de
    // remarque « modèle partiel »).
    expect(model.parts.some((p) => p.family === "guards")).toBe(true);
    expect(
      model.compliance.notes?.some((n) => n.key === "compliance.engine.partialModel"),
    ).not.toBe(true);
    for (const id of ["G_MIN_DTU", "BLONDEL_DTU", "VOLEE_MAX_DTU"]) {
      const rs = model.compliance.results.filter((r) => r.ruleId === id);
      expect(rs.length).toBeGreaterThan(0);
      expect(rs.every((r) => r.status !== "non-evaluee")).toBe(true);
    }
  });
});
