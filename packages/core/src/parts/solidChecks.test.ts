import { describe, expect, it } from "vitest";
import type { Part, SolidDesc } from "../model/derived.js";
import type { Shape2, Vec3 } from "../model/primitives.js";
import { checkSolids, solidProblem } from "./solidChecks.js";

const frame = {
  origin: { x: 0, y: 0, z: 0 },
  xAxis: { x: 1, y: 0, z: 0 },
  yAxis: { x: 0, y: 1, z: 0 },
  zAxis: { x: 0, y: 0, z: 1 },
};
const square: Shape2 = {
  outer: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ],
  holes: [],
};
const round = (r: number, n = 16): Shape2 => ({
  outer: Array.from({ length: n }, (_, i) => ({
    x: r * Math.cos((2 * Math.PI * i) / n),
    y: r * Math.sin((2 * Math.PI * i) / n),
  })),
  holes: [],
});
const part = (solid: SolidDesc): Part => ({
  id: "p",
  mark: "P1",
  name: "Pièce",
  category: "handrail",
  material: "wood-oak",
  solid,
  quantities: {},
});
const helix = (radius: number, pitch: number, turns: number, perTurn = 48): Vec3[] =>
  Array.from({ length: Math.round(turns * perTurn) + 1 }, (_, i) => {
    const a = (2 * Math.PI * i) / perTurn;
    return { x: radius * Math.cos(a), y: radius * Math.sin(a), z: (pitch * i) / perTurn };
  });

describe("solidProblem", () => {
  it("extrusion de profondeur nulle", () => {
    expect(solidProblem({ kind: "extrusion", frame, profile: square, depth: 0 })).toMatch(
      /profondeur nulle/,
    );
    expect(solidProblem({ kind: "extrusion", frame, profile: square, depth: 40 })).toBeUndefined();
  });

  it("surface réglée : épaisseur nulle, section plate en extrémité (limon en pointe)", () => {
    const a = [
      { x: 0, y: 0, z: 0 },
      { x: 1000, y: 0, z: 600 },
    ];
    const n = [
      { x: 0, y: 1 },
      { x: 0, y: 1 },
    ];
    const ok = a.map((p) => ({ ...p, z: p.z + 250 }));
    expect(solidProblem({ kind: "ruled", a, b: ok, thickness: 40, normals: n })).toBeUndefined();
    expect(solidProblem({ kind: "ruled", a, b: ok, thickness: 0, normals: n })).toMatch(
      /épaisseur nulle/,
    );
    const pointe = [ok[0]!, a[1]!];
    expect(solidProblem({ kind: "ruled", a, b: pointe, thickness: 40, normals: n })).toMatch(
      /section plate en extrémité/,
    );
  });

  it("balayage : virage de 179° (onglet × 115) et virage serré sur un segment court", () => {
    const t = (179 * Math.PI) / 180;
    const path = [
      { x: 0, y: 0, z: 900 },
      { x: 500, y: 0, z: 900 },
      { x: 500 + 500 * Math.cos(t), y: 500 * Math.sin(t), z: 900 },
    ];
    expect(solidProblem({ kind: "sweep", path, section: round(21) })).toMatch(
      /auto-intersecté près du point \(500 ; 0 ; 900\).*segment d.extrémité/,
    );
    // Deux virages de 90° séparés de 20 mm, section Ø 60 : onglets croisés.
    const zig = (mid: number): Vec3[] => [
      { x: 0, y: 0, z: 0 },
      { x: 1000, y: 0, z: 0 },
      { x: 1000, y: mid, z: 0 },
      { x: 0, y: mid, z: 0 },
    ];
    expect(solidProblem({ kind: "sweep", path: zig(20), section: round(30) })).toMatch(
      /près du point \(1000 ; 10 ; 0\)/,
    );
    expect(solidProblem({ kind: "sweep", path: zig(200), section: round(30) })).toBeUndefined();
  });

  it("balayage : pli local réductible (coude franc suivi d'un segment court presque aligné) non signalé", () => {
    // Montée raide puis palier : coude de ≈ 70°, puis segment de 12 mm quasi aligné (cas des
    // mains courantes de trémie hélicoïdale) ; onglet du coude ≈ 15 mm > 12 mm.
    const path: Vec3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 60, y: 0, z: 200 },
      { x: 72, y: 0, z: 200 },
      { x: 72, y: 60, z: 200 },
      { x: 72, y: 600, z: 200 },
    ];
    expect(
      solidProblem({
        kind: "sweep",
        path: path.slice(0, 3).concat([{ x: 600, y: 1, z: 200 }]),
        section: round(21),
      }),
    ).toBeUndefined();
    expect(solidProblem({ kind: "sweep", path, section: round(21) })).toBeUndefined();
  });

  it("balayage : épingle de 179° au milieu du chemin, bras longs → signalée (fusion non résolutive)", () => {
    // [review] Les fusions successives de segments longs effaçaient l'épingle (faux négatif).
    const t = (179 * Math.PI) / 180;
    const C = { x: 2000, y: 0, z: 900 };
    const D = { x: C.x + 1000 * Math.cos(t), y: 1000 * Math.sin(t), z: 900 };
    const path: Vec3[] = [
      { x: 0, y: 0, z: 900 },
      { x: 1000, y: 0, z: 900 },
      C,
      D,
      { x: D.x, y: 1000, z: 900 },
    ];
    expect(solidProblem({ kind: "sweep", path, section: round(21) })).toMatch(
      /auto-intersecté près du point \(1500 ; 0 ; 900\) : coupes d'onglet croisées/,
    );
  });

  it("balayage : spires qui se touchent (pas < diamètre) ; hélice de main courante usuelle conforme", () => {
    expect(
      solidProblem({ kind: "sweep", path: helix(600, 3000, 1.5), section: round(21) }),
    ).toBeUndefined();
    expect(solidProblem({ kind: "sweep", path: helix(600, 30, 1.5), section: round(21) })).toMatch(
      /se touchent/,
    );
  });

  it("balayage : section décentrée (axe hors matière) → seul le demi-tour est vu", () => {
    const off: Shape2 = {
      outer: square.outer.map((p) => ({ x: p.x + 200, y: p.y })),
      holes: [],
    };
    expect(
      solidProblem({ kind: "sweep", path: helix(600, 30, 1.5), section: off }),
    ).toBeUndefined();
    expect(
      solidProblem({
        kind: "sweep",
        path: [
          { x: 0, y: 0, z: 0 },
          { x: 100, y: 0, z: 0 },
          { x: 0, y: 0, z: 0 },
        ],
        section: off,
      }),
    ).toMatch(/demi-tour/);
  });

  it("checkSolids : message lisible par pièce, effet sur l'aperçu", () => {
    const msgs = checkSolids([
      part({ kind: "extrusion", frame, profile: square, depth: 0 }),
      part({ kind: "sweep", path: helix(600, 30, 1.5), section: round(21) }),
      part({ kind: "extrusion", frame, profile: square, depth: 10 }),
    ]);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatch(/^Pièce P1 \(Pièce\) : extrusion de profondeur nulle \(pièce absente/);
    expect(msgs[1]).toMatch(/aperçu 3D replié/);
  });
});
