/**
 * Largeur variable et axe en arc d'une cage saisie (sous-lot 2b, ADR-0010, décisions F1 et
 * F11, propositions F12 « à valider ») : cas unitaires en forme fermée (trapèze ouvrant,
 * fermant et centré, ancrage gauche, droit et médian, jonction à 90° entre deux largeurs,
 * jonction à 60° avec un trapèze, retraits sur un bord du jour incliné, tronçon sans partie
 * droite avant un palier, demi-tour à bord du jour incliné, arc seul, arc entre deux tronçons
 * droits, arc et jonction, arc et palier, recouvrement entre tronçons consécutifs, refus clairs)
 * et garde-fou temporaire du pipeline (réduit au sous-lot 2c : découpage calculé). Les propriétés (dont l'accord avec le moteur à largeur unique) sont dans
 * `free.property.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { msg, MessageError, type Message, type MessageKey } from "@blondel/i18n";
import {
  cumulativeLengths,
  curveLength,
  curvePointAt,
  curveTangentAt,
} from "../../geom2d/curve.js";
import { pointInPolygon, signedArea } from "../../geom2d/polygon.js";
import { segLength, segTangentAt } from "../../geom2d/segment.js";
import * as V from "../../geom2d/vec.js";
import type { Layout } from "../../model/derived.js";
import type { ArcSeg, Vec2 } from "../../model/primitives.js";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type CageLayoutSpec,
  type CageLayoutSpecInput,
  type Project,
} from "../../model/project.js";
import { buildModel } from "../../pipeline/build.js";
import { computeLayout } from "../layout.js";
import { computeCageLayout } from "./cage.js";

type SectionInput = CageLayoutSpecInput["sections"][number];

type WalklineInput =
  | { mode: "dtu"; side: "left" | "right" }
  | {
      mode: "fromInner";
      distance: number;
      side: "left" | "right";
    };

function cageProject(
  layout: CageLayoutSpecInput,
  walkline: WalklineInput = { mode: "dtu", side: "left" },
): Project {
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: { floorToFloor: 2700, upperSlabThickness: 200 },
    stair: {
      placement: { origin: { x: 0, y: 0 }, rotation: 0 },
      layout,
      walkline,
    },
  });
}

function layoutOf(spec: CageLayoutSpecInput, walkline?: WalklineInput): Layout {
  const p = cageProject(spec, walkline);
  return computeCageLayout(p, p.stair.layout as CageLayoutSpec);
}

/** Message du refus, ou `undefined` si le tracé est calculé. */
function refusalOf(spec: CageLayoutSpecInput): Message | undefined {
  const p = cageProject(spec);
  try {
    computeCageLayout(p, p.stair.layout as CageLayoutSpec);
  } catch (e) {
    if (e instanceof MessageError) return e.msg;
    throw e;
  }
  return undefined;
}

function errorOf(spec: CageLayoutSpecInput): MessageKey | undefined {
  return refusalOf(spec)?.key;
}

const straight = (
  length: number,
  width: number,
  extra: Partial<Pick<SectionInput, "widthEnd" | "anchor">> = {},
): SectionInput => ({ axis: { kind: "straight", length }, width, ...extra });

const arcAxis = (
  radius: number,
  sweep: number,
  width: number,
  anchor?: "left" | "right" | "center",
): SectionInput => ({
  axis: { kind: "arc", radius, sweep },
  width,
  ...(anchor !== undefined ? { anchor } : {}),
});

const close = (a: Vec2, b: Vec2, digits = 9) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};

const deg = (a: number): number => (a * Math.PI) / 180;

const arcsOf = (layout: Layout): ArcSeg[] =>
  layout.walkline.segments.filter((s): s is ArcSeg => s.kind === "arc");

/**
 * Tracé sain : aucun constat, Γ dans l'emprise (hors extrémités), et tangente de Γ continue
 * à chaque raccord de segments, sauf aux limites d'une transition et d'un palier droit (où Γ
 * peut être anguleuse, voir `general.ts`).
 */
function expectSound(layout: Layout): void {
  expect(layout.errors).toBeUndefined();
  const L = curveLength(layout.walkline);
  for (let f = 1 / 32; f < 1; f += 1 / 32) {
    expect(pointInPolygon(curvePointAt(layout.walkline, f * L), layout.footprint)).toBe("inside");
  }
  const exempt = [
    ...(layout.walklineTransitions ?? []).flatMap((t) => [t.sStart, t.sEnd]),
    ...layout.turns.filter((t) => t.angle === 0).flatMap((t) => [t.sStart, t.sEnd]),
  ];
  const cum = cumulativeLengths(layout.walkline);
  const segs = layout.walkline.segments;
  for (let k = 0; k + 1 < segs.length; k++) {
    if (exempt.some((e) => Math.abs(e - cum[k + 1]!) < 1e-6)) continue;
    if (segLength(segs[k]!) <= 1e-9 || segLength(segs[k + 1]!) <= 1e-9) continue;
    close(segTangentAt(segs[k]!, 1), segTangentAt(segs[k + 1]!, 0), 9);
  }
}

describe("largeur variable : tronçon droit seul (trapèze)", () => {
  it("trapèze ouvrant ancré à gauche : bord gauche droit, d_f DTU à chaque extrémité", () => {
    const layout = layoutOf({
      kind: "cage",
      sections: [straight(3000, 800, { widthEnd: 1200, anchor: "left" })],
      junctions: [],
    });
    const [s] = layout.sections!;
    expect(s).toMatchObject({ kind: "straight", widthStart: 800, widthEnd: 1200 });
    close(s!.start.left, V.vec(0, 0));
    close(s!.start.right, V.vec(800, 0));
    close(s!.end.left, V.vec(0, 3000));
    close(s!.end.right, V.vec(1200, 3000));
    // Γ : 400 mm du bord gauche au départ (DTU, E = 800), 600 mm à l'arrivée (E = 1 200).
    close(curvePointAt(layout.walkline, 0), V.vec(400, 0));
    close(curvePointAt(layout.walkline, curveLength(layout.walkline)), V.vec(600, 3000));
    expect(layout.walklineSide).toBe("left");
    expect(layout.walklineOffset).toBe(400);
    // Γ oblique mais sans angle (aucune jonction tournante) : pas de transition.
    expect(layout.walklineTransitions).toBeUndefined();
    expect(Math.abs(signedArea(layout.footprint))).toBeCloseTo(((800 + 1200) / 2) * 3000, 3);
    expectSound(layout);
  });

  it("trapèze fermant ancré à droite : bord droit droit", () => {
    const layout = layoutOf({
      kind: "cage",
      sections: [straight(2000, 1200, { widthEnd: 800, anchor: "right" })],
      junctions: [],
    });
    const [s] = layout.sections!;
    close(s!.start.left, V.vec(0, 0));
    close(s!.start.right, V.vec(1200, 0));
    close(s!.end.left, V.vec(400, 2000));
    close(s!.end.right, V.vec(1200, 2000));
    // Bord de mesure à gauche (incliné) : 600 mm au départ, 400 mm à l'arrivée.
    close(curvePointAt(layout.walkline, 0), V.vec(600, 0));
    close(curvePointAt(layout.walkline, curveLength(layout.walkline)), V.vec(800, 2000));
    expect(layout.walklineTransitions).toBeUndefined();
    expectSound(layout);
  });

  it("ancrage médian (défaut) : les deux bords s'ouvrent symétriquement, Γ sur l'axe", () => {
    const layout = layoutOf({
      kind: "cage",
      sections: [straight(2400, 1000, { widthEnd: 1400 })],
      junctions: [],
    });
    const [s] = layout.sections!;
    close(s!.start.left, V.vec(0, 0));
    close(s!.start.right, V.vec(1000, 0));
    close(s!.end.left, V.vec(-200, 2400));
    close(s!.end.right, V.vec(1200, 2400));
    // DTU : milieu (500 mm), puis 600 mm du bord gauche au-delà de 1 200 mm (E = 1 400).
    close(curvePointAt(layout.walkline, 0), V.vec(500, 0));
    close(curvePointAt(layout.walkline, curveLength(layout.walkline)), V.vec(400, 2400));
    expectSound(layout);
  });

  it("trapèze centré seul (900 → 1 200) : Γ sur l'axe de symétrie, aucune transition", () => {
    const layout = layoutOf({
      kind: "cage",
      sections: [straight(3000, 900, { widthEnd: 1200 })],
      junctions: [],
    });
    close(curvePointAt(layout.walkline, 0), V.vec(450, 0));
    close(curvePointAt(layout.walkline, curveLength(layout.walkline)), V.vec(450, 3000));
    expect(layout.walkline.segments).toHaveLength(1);
    expect(layout.walklineTransitions).toBeUndefined();
    expectSound(layout);
  });

  it("largeur variable sans partie droite : refus clair", () => {
    expect(
      errorOf({
        kind: "cage",
        sections: [straight(0, 900, { widthEnd: 1100 }), straight(1000, 900)],
        junctions: [{ angle: 90, mode: "winders" }],
      }),
    ).toBe("layout.cage.variableWidthZeroLength");
  });
});

describe("largeur variable : jonctions", () => {
  it("jonction à 90° entre deux largeurs (900 puis 1 200) : K, W, d_f sur la plus petite", () => {
    const layout = layoutOf({
      kind: "cage",
      sections: [straight(1000, 900), straight(800, 1200)],
      junctions: [{ angle: 90, mode: "winders" }],
    });
    const zone = layout.turns[0]!;
    close(zone.innerCorner, V.vec(0, 1000));
    // W : bord droit du premier tronçon (x = 900) et bord côté mur du second (y = 2 200).
    close(zone.outerCorner, V.vec(900, 2200));
    expect(zone.angle).toBe(Math.PI / 2);
    expect(zone.walklineOffset).toBe(450);
    const [, s1] = layout.sections!;
    close(s1!.start.left, V.vec(0, 1000));
    close(s1!.start.right, V.vec(0, 2200));
    close(s1!.end.left, V.vec(-800, 1000));
    expect(s1).toMatchObject({ widthStart: 1200, widthEnd: 1200 });
    // Γ : arc de centre K, rayon 450 ; parties droites prolongées sans angle.
    const [arc] = arcsOf(layout);
    close(arc!.center, V.vec(0, 1000));
    expect(arc!.radius).toBe(450);
    expect(arc!.sweep).toBe(Math.PI / 2);
    expect(curveLength(layout.walkline)).toBeCloseTo(1000 + 450 * (Math.PI / 2) + 800, 9);
    close(curvePointAt(layout.walkline, 0), V.vec(450, 0));
    close(curvePointAt(layout.walkline, curveLength(layout.walkline)), V.vec(-800, 1450));
    expect(layout.walklineTransitions).toBeUndefined();
    expect(layout.walklineOffset).toBe(450);
    // Bord côté mur : 1 000 + 1 200 (jusqu'à W) puis 900 + 800.
    expect(curveLength(layout.outer)).toBeCloseTo(2200 + 1700, 9);
    expectSound(layout);
  });

  it("jonction à 60° avec un trapèze ancré côté jour : bord du jour droit, W sur les bords réels", () => {
    const layout = layoutOf({
      kind: "cage",
      sections: [straight(1000, 900), straight(1500, 900, { widthEnd: 1300, anchor: "left" })],
      junctions: [{ angle: 60, mode: "winders" }],
    });
    const zone = layout.turns[0]!;
    const k = V.vec(0, 1000);
    close(zone.innerCorner, k);
    const u2 = V.rotate(V.vec(0, 1), deg(60));
    const r2 = V.rotate(V.vec(1, 0), deg(60));
    const [, s1] = layout.sections!;
    close(s1!.start.left, k);
    close(s1!.start.right, V.addScaled(k, r2, 900));
    close(s1!.end.left, V.addScaled(k, u2, 1500));
    close(s1!.end.right, V.addScaled(V.addScaled(k, u2, 1500), r2, 1300));
    // W sur la droite x = 900 et sur le bord côté mur (incliné) du trapèze.
    const w = zone.outerCorner;
    expect(w.x).toBeCloseTo(900, 9);
    const edge = V.sub(s1!.end.right, s1!.start.right);
    expect(V.cross(edge, V.sub(w, s1!.start.right))).toBeCloseTo(0, 3);
    // Bord du jour non incliné : Γ arc de centre K, rayon 450, balayage 60° exactement.
    const [arc] = arcsOf(layout);
    close(arc!.center, k);
    expect(arc!.radius).toBe(450);
    expect(arc!.sweep).toBeCloseTo(deg(60), 15);
    expect(layout.walklineTransitions).toBeUndefined();
    expectSound(layout);
  });

  it("jonction à 60° avec un trapèze ancré au milieu : bord du jour incliné, raccords sur les bords réels", () => {
    const layout = layoutOf({
      kind: "cage",
      sections: [straight(1000, 900), straight(1500, 900, { widthEnd: 1300 })],
      junctions: [{ angle: 60, mode: "winders" }],
    });
    // Le bord du jour du trapèze s'écarte de 200 mm vers le jour sur 1 500 mm : Γ tourne de
    // 60° + atan(200 / 1 500) pour lui rester tangente, à 450 mm de K.
    const tilt = Math.atan2(200, 1500);
    const [arc] = arcsOf(layout);
    close(arc!.center, V.vec(0, 1000));
    expect(arc!.radius).toBe(450);
    expect(arc!.sweep).toBeCloseTo(deg(60) + tilt, 12);
    // TurnZone.angle reste l'angle du repère (θ).
    expect(layout.turns[0]!.angle).toBeCloseTo(deg(60), 15);
    // Γ parallèle au bord du jour dans le trapèze (à 450 mm), sans angle ni transition.
    expect(layout.walklineTransitions).toBeUndefined();
    const L = curveLength(layout.walkline);
    const t0 = curveTangentAt(layout.walkline, layout.turns[0]!.sEnd);
    const tEnd = curveTangentAt(layout.walkline, L);
    close(t0, tEnd, 12);
    const s1 = layout.sections![1]!;
    const jour = V.normalize(V.sub(s1.end.left, s1.start.left));
    close(tEnd, jour, 12);
    expectSound(layout);
  });

  it("jonction entre deux trapèzes : d_f sur la plus petite des largeurs à la jonction (F1)", () => {
    // Fin du premier : 1 000 ; début du second : 1 400 → d_f = 500 (DTU, milieu de 1 000).
    const layout = layoutOf({
      kind: "cage",
      sections: [
        straight(2000, 1400, { widthEnd: 1000, anchor: "left" }),
        straight(1000, 1400, { anchor: "left" }),
      ],
      junctions: [{ angle: 90, mode: "landing" }],
    });
    expect(layout.turns[0]!.walklineOffset).toBe(500);
    expect(layout.walklineOffset).toBe(500);
    const [arc] = arcsOf(layout);
    expect(arc!.radius).toBe(500);
    // Premier tronçon : Γ prolonge la tangente de l'arc jusqu'au départ (500 mm du jour).
    close(curvePointAt(layout.walkline, 0), V.vec(500, 0));
    expectSound(layout);
  });

  it("S à largeur variable : Γ relie les points de tangence (transition signalée)", () => {
    const layout = layoutOf({
      kind: "cage",
      sections: [straight(1000, 900), straight(1200, 900, { widthEnd: 1300 }), straight(800, 1300)],
      junctions: [
        { angle: 90, mode: "winders" },
        { angle: -90, mode: "winders" },
      ],
    });
    expect(layout.turns.map((t) => t.walklineOffset)).toEqual([450, 600]);
    const [tr] = layout.walklineTransitions!;
    expect(tr!.leg).toBe(1);
    expect(tr!.sStart).toBe(layout.turns[0]!.sEnd);
    expect(tr!.sEnd).toBeCloseTo(layout.turns[1]!.sStart, 9);
    expectSound(layout);
  });

  it("palier droit entre deux largeurs : l'ancrage du tronçon sortant prolonge celui de même nom", () => {
    const layout = layoutOf({
      kind: "cage",
      sections: [straight(1000, 900, { anchor: "left" }), straight(1000, 1200, { anchor: "left" })],
      junctions: [{ angle: 0, mode: "landing", depth: 500 }],
    });
    const [s0, s1] = layout.sections!;
    close(s0!.end.left, V.vec(0, 1000));
    close(s1!.start.left, V.vec(0, 1500));
    close(s1!.start.right, V.vec(1200, 1500));
    expect(layout.turns[0]).toMatchObject({ mode: "landing", angle: 0, walklineOffset: 450 });
    expect(layout.turns[0]!.sEnd - layout.turns[0]!.sStart).toBeCloseTo(500, 9);
    expectSound(layout);
  });

  it("tronçon court à bord du jour incliné : retraits des jours en arc mesurés sur le bord réel", () => {
    // Tronçon 2 : 100 mm sur son bord d'ancrage (droit), bord du jour (gauche) incliné de
    // √(100² + 60²) ≈ 116,6 mm. Jours en arc r = 45 : retraits ≈ 105 mm sur le bord réel, qui
    // les contient (le contrôle sur la longueur d'ancrage les projette sur u).
    const spec = (radius: number): CageLayoutSpecInput => ({
      kind: "cage",
      sections: [
        straight(1000, 900),
        straight(100, 900, { widthEnd: 960, anchor: "right" }),
        straight(1000, 900),
      ],
      junctions: [
        { angle: 90, mode: "winders", well: { kind: "arc", radius } },
        { angle: 90, mode: "winders", well: { kind: "arc", radius } },
      ],
    });
    expect(layoutOf(spec(45)).errors).toBeUndefined();
    // r = 55 : retraits ≈ 128 mm > 116,6 mm, refus sur la partie droite.
    const refusal = refusalOf(spec(55));
    expect(refusal).toMatchObject({
      key: "layout.cage.sectionTooShort",
      params: { section: 2, length: "100" },
    });
    expect(Number(refusal!.params!.required)).toBeGreaterThan(100);
  });

  it("tronçon sans partie droite avant un palier droit : changement de d_f reporté sur le palier", () => {
    // d_f au départ (DTU, E = 1 000) : 500 ; au palier (plus petite largeur, 800) : 400. Le
    // tronçon 1 n'a aucune longueur : Γ part directement à 400 mm du bord gauche.
    const layout = layoutOf({
      kind: "cage",
      sections: [straight(0, 1000), straight(1000, 800)],
      junctions: [{ angle: 0, mode: "landing" }],
    });
    expect(layout.errors).toBeUndefined();
    expect(layout.walklineTransitions).toBeUndefined();
    close(curvePointAt(layout.walkline, 0), V.vec(400, 0));
    // Tronçon 2 centré sur l'axe du premier (x = 500) : Γ à 400 mm de son bord gauche (x = 100).
    close(curvePointAt(layout.walkline, curveLength(layout.walkline)), V.vec(500, 2000));
    expect(layout.sections![0]!.sEnd).toBe(0);
  });

  it("demi-tour à jour nul avec un bord du jour incliné : jour triangulaire, aucun contact constaté", () => {
    // θ1 + θ2 = 180°, mais le bord du jour du tronçon 1 s'écarte de 300 mm : les balayages
    // effectifs φ ne totalisent pas 180°, les tronçons 1 et 3 ne se touchent qu'en K.
    const layout = layoutOf({
      kind: "cage",
      sections: [
        straight(2000, 900, { widthEnd: 1200, anchor: "right" }),
        straight(0, 1200),
        straight(2000, 1200),
      ],
      junctions: [
        { angle: 90, mode: "winders" },
        { angle: 90, mode: "winders" },
      ],
    });
    expect(layout.errors).toBeUndefined();
    // À largeur constante, le même demi-tour est un contact bord à bord.
    expect(
      layoutOf({
        kind: "cage",
        sections: [straight(2000, 1200), straight(0, 1200), straight(2000, 1200)],
        junctions: [
          { angle: 90, mode: "winders" },
          { angle: 90, mode: "winders" },
        ],
      }).errors?.map((e) => e.key),
    ).toEqual(["layout.cage.sectionsTouch"]);
  });

  it("refus : Γ hors de l'emprise (bord côté mur qui la traverse, tangente prolongée hors de la largeur)", () => {
    // Tronçon 2 qui se resserre de 300 mm sur 10 mm, ancré côté jour : son bord côté mur
    // coupe l'arc de Γ (d_f = 450) dans la zone de jonction.
    expect(
      refusalOf({
        kind: "cage",
        sections: [
          straight(2300, 600, { widthEnd: 900, anchor: "right" }),
          straight(10, 900, { widthEnd: 600, anchor: "left" }),
        ],
        junctions: [{ angle: 60, mode: "winders" }],
      }),
    ).toEqual(msg("layout.cage.walklineOutsideFootprint", { junction: 1, offset: "450" }));
    // Premier tronçon qui s'ouvre de 600 à 1 200 mm côté jour : la tangente de l'arc de Γ,
    // prolongée jusqu'au départ, passe au-delà du bord côté mur (652,8 mm du jour pour 600).
    expect(
      refusalOf({
        kind: "cage",
        sections: [
          straight(1400, 600, { widthEnd: 1200, anchor: "right" }),
          straight(1600, 1200, { anchor: "left" }),
        ],
        junctions: [{ angle: 90, mode: "winders" }],
      }),
    ).toEqual(msg("layout.walklineOutsideWidth", { offset: "652.8", width: "600" }));
  });

  it("refus : bords du jour qui ne tournent plus dans le sens de la jonction ; bords côté mur sans coin", () => {
    // 10° à gauche, trapèze ancré côté mur qui se resserre fort : le bord du jour part à droite.
    expect(
      errorOf({
        kind: "cage",
        sections: [straight(1000, 900), straight(300, 900, { widthEnd: 300, anchor: "right" })],
        junctions: [{ angle: 10, mode: "winders" }],
      }),
    ).toBe("layout.cage.wellEdgesAngle");
    // 10° à gauche, trapèze ancré côté jour qui s'élargit fort : les bords côté mur se coupent
    // dans le tronçon sortant.
    expect(
      errorOf({
        kind: "cage",
        sections: [straight(1000, 900), straight(300, 900, { widthEnd: 2000, anchor: "left" })],
        junctions: [{ angle: 10, mode: "winders" }],
      }),
    ).toBe("layout.cage.wallEdgesDegenerate");
    // Poteau sur un angle effectif autre que ±90° (bord du jour incliné).
    expect(
      errorOf({
        kind: "cage",
        sections: [straight(1000, 900), straight(1500, 900, { widthEnd: 1300 })],
        junctions: [{ angle: 90, mode: "winders", well: { kind: "newel", size: 90 } }],
      }),
    ).toBe("layout.cage.newelAngle");
  });
});

describe("axe en arc", () => {
  it("arc de 90° seul (rayon 2 000 sur l'axe, E = 1 000) : bords concentriques, Γ du côté intérieur", () => {
    const layout = layoutOf({ kind: "cage", sections: [arcAxis(2000, 90, 1000)], junctions: [] });
    const [s] = layout.sections!;
    expect(s).toMatchObject({ kind: "arc", widthStart: 1000, widthEnd: 1000 });
    close(s!.arc!.center, V.vec(-1500, 0));
    expect(s!.arc!.radius).toBe(2000);
    expect(s!.arc!.sweep).toBeCloseTo(Math.PI / 2, 15);
    close(s!.start.left, V.vec(0, 0));
    close(s!.start.right, V.vec(1000, 0));
    close(s!.end.left, V.vec(-1500, 1500));
    close(s!.end.right, V.vec(-1500, 2500));
    expect(layout.innerSide).toBe("left");
    // Sans jonction tournante : bord de mesure du départ (choisi, ici gauche).
    expect(layout.walklineSide).toBe("left");
    // Γ : d_f = 500 du bord intérieur (rayon 1 500) → rayon 2 000.
    expect(curveLength(layout.walkline)).toBeCloseTo(2000 * (Math.PI / 2), 9);
    expect(curveLength(layout.inner)).toBeCloseTo(1500 * (Math.PI / 2), 9);
    expect(curveLength(layout.outer)).toBeCloseTo(2500 * (Math.PI / 2), 9);
    expect(Math.abs(signedArea(layout.footprint))).toBeCloseTo(
      (Math.PI / 4) * (2500 ** 2 - 1500 ** 2),
      -3,
    );
    expectSound(layout);
  });

  it("arc à droite ancré sur le bord intérieur : rayon du bord droit = R", () => {
    const layout = layoutOf({
      kind: "cage",
      sections: [arcAxis(600, -120, 900, "right")],
      junctions: [],
    });
    const [s] = layout.sections!;
    close(s!.arc!.center, V.vec(900 + 600, 0));
    expect(layout.innerSide).toBe("right");
    expect(curveLength(layout.inner)).toBeCloseTo(600 * deg(120), 9);
    expect(curveLength(layout.outer)).toBeCloseTo(1500 * deg(120), 9);
    // Γ : 450 mm du bord gauche choisi, au milieu (E = 900).
    expect(curveLength(layout.walkline)).toBeCloseTo(1050 * deg(120), 9);
    expectSound(layout);
  });

  it("arc entre deux tronçons droits (paliers droits) : Γ continue et tangente, cumul des angles", () => {
    const layout = layoutOf({
      kind: "cage",
      sections: [straight(1000, 1000), arcAxis(2000, 90, 1000), straight(800, 1000)],
      junctions: [
        { angle: 0, mode: "landing", depth: 300 },
        { angle: 0, mode: "landing", depth: 300 },
      ],
    });
    const L = curveLength(layout.walkline);
    expect(L).toBeCloseTo(1000 + 300 + 2000 * (Math.PI / 2) + 300 + 800, 9);
    for (const s of [layout.turns[0]!.sStart, layout.turns[0]!.sEnd, layout.turns[1]!.sEnd]) {
      const before = curveTangentAt(layout.walkline, s - 1e-6);
      const after = curveTangentAt(layout.walkline, s + 1e-6);
      close(before, after, 6);
    }
    close(curveTangentAt(layout.walkline, L), V.vec(-1, 0), 12);
    const last = layout.sections![2]!;
    close(last.start.left, V.vec(-1500 - 300, 1300 + 2000 - 500));
    expectSound(layout);
  });

  it("arc et jonction tournante : la jonction impose d_f, raccord tangent", () => {
    const layout = layoutOf({
      kind: "cage",
      sections: [straight(1000, 900), arcAxis(1500, 90, 900), straight(600, 900)],
      junctions: [
        { angle: 90, mode: "winders" },
        { angle: -90, mode: "winders" },
      ],
    });
    // K de la première jonction : (0, 1 000) ; l'arc part vers −x, centre à sa gauche (−y), à
    // R = 1 500 de l'axe (450 mm au-dessus de K).
    const arcSection = layout.sections![1]!;
    close(arcSection.start.left, V.vec(0, 1000));
    close(arcSection.arc!.center, V.vec(0, 1000 + 450 - 1500));
    // Γ dans l'arc : à 450 mm du bord gauche (jour de la première jonction).
    const arcs = arcsOf(layout);
    expect(arcs).toHaveLength(3);
    expect(arcs[1]!.radius).toBeCloseTo(1500 - 450 + 450, 9);
    // Raccords tangents (aucune transition) ; second tournant : jour à droite.
    expect(layout.walklineTransitions).toBeUndefined();
    for (const zone of layout.turns) {
      for (const s of [zone.sStart, zone.sEnd]) {
        close(
          curveTangentAt(layout.walkline, s - 1e-6),
          curveTangentAt(layout.walkline, s + 1e-6),
          6,
        );
      }
    }
    expectSound(layout);
  });

  it("refus : rayon trop petit, raccord non vif voisin d'un arc, transition dans un arc", () => {
    expect(errorOf({ kind: "cage", sections: [arcAxis(400, 90, 1000)], junctions: [] })).toBe(
      "layout.cage.arcRadiusTooSmall",
    );
    expect(errorOf({ kind: "cage", sections: [arcAxis(500, -90, 1000)], junctions: [] })).toBe(
      "layout.cage.arcRadiusTooSmall",
    );
    // Ancré sur le bord intérieur, le même rayon passe.
    expect(
      errorOf({ kind: "cage", sections: [arcAxis(400, 90, 1000, "left")], junctions: [] }),
    ).toBeUndefined();
    expect(
      errorOf({
        kind: "cage",
        sections: [straight(1000, 900), arcAxis(1500, 90, 900)],
        junctions: [{ angle: 90, mode: "winders", well: { kind: "arc", radius: 100 } }],
      }),
    ).toBe("layout.cage.arcSectionSharpJoints");
    // E = 1 400 : d_f = 600 du jour, à gauche puis à droite → 600 et 800 mm du bord gauche.
    expect(
      errorOf({
        kind: "cage",
        sections: [straight(1000, 1400), arcAxis(3000, 30, 1400), straight(1000, 1400)],
        junctions: [
          { angle: 90, mode: "winders" },
          { angle: -90, mode: "winders" },
        ],
      }),
    ).toBe("layout.cage.arcWalklineTransition");
  });

  it("arc qui se referme sur le tronçon de départ : recouvrement entre tronçons consécutifs", () => {
    const layout = layoutOf({
      kind: "cage",
      sections: [straight(2000, 900), arcAxis(1200, 300, 900)],
      junctions: [{ angle: 0, mode: "landing" }],
    });
    expect(layout.errors).toEqual([
      msg("layout.cage.sectionsOverlap", { sectionA: 1, sectionB: 2, x: "75", y: "168" }),
    ]);
  });

  it("palier droit après un arc : Γ garde le bord de mesure choisi de part et d'autre", () => {
    // Arc à gauche, `side: right` : Γ à 300 mm du bord droit dans l'arc, sur le palier et
    // dans le tronçon droit (aucun décalage latéral en travers du palier).
    const layout = layoutOf(
      {
        kind: "cage",
        sections: [arcAxis(1500, 90, 900), straight(1000, 900)],
        junctions: [{ angle: 0, mode: "landing" }],
      },
      { mode: "fromInner", distance: 300, side: "right" },
    );
    expect(layout.walklineSide).toBe("right");
    close(curvePointAt(layout.walkline, 0), V.vec(600, 0));
    // Centre de l'arc (−1 050, 0) ; bord droit de rayon 1 950 ; Γ de rayon 1 650.
    expect(arcsOf(layout)[0]!.radius).toBeCloseTo(1650, 9);
    const end = curvePointAt(layout.walkline, curveLength(layout.walkline));
    expect(end.y).toBeCloseTo(1650, 9);
    const L = curveLength(layout.walkline);
    expect(L).toBeCloseTo(1650 * (Math.PI / 2) + 900 + 1000, 9);
    expectSound(layout);
  });
});

describe("pipeline (garde-fou temporaire des sous-lots 2a / 2b, réduit au 2c)", () => {
  it.each<[string, CageLayoutSpecInput]>([
    [
      "largeur variable",
      {
        kind: "cage",
        sections: [straight(1500, 900), straight(1000, 900, { widthEnd: 1100 })],
        junctions: [{ angle: 90, mode: "winders" }],
      },
    ],
    ["axe en arc", { kind: "cage", sections: [arcAxis(2000, 90, 1000)], junctions: [] }],
  ])("%s : tracé et découpage rendus, garde-corps / échappée / règles sautés", (_name, spec) => {
    const project = cageProject(spec);
    expect(computeLayout(project).sections).toBeDefined();
    const model = buildModel(project, { memo: false });
    expect(model.errors.map((e) => e.key)).toEqual(["pipeline.cageDownstreamNotYetSupported"]);
    expect(model.layout.sections).toHaveLength(spec.sections.length);
    expect(model.stepping.treads.length).toBeGreaterThan(0);
  });
});
