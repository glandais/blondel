import { describe, expect, it } from "vitest";
import { signedArea } from "../geom2d/polygon.js";
import { openingMinusLanding } from "./landingVoid.js";

describe("openingMinusLanding", () => {
  // Trémie 0..1000 × 0..1000 ; palier 600..1000 × 0..400, dont le côté x = 1000 (sommets
  // (1000, 0)-(1000, 400)) est posé sur le contour de la trémie, qui porte ces sommets.
  const opening = [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 400 },
    { x: 1000, y: 1000 },
    { x: 0, y: 1000 },
  ];
  const landing = [
    { x: 600, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 400 },
    { x: 600, y: 400 },
  ];

  it("retire le palier du vide : portion commune remplacée par ses bords libres", () => {
    const v = openingMinusLanding(opening, landing);
    expect(v).toEqual([
      { x: 1000, y: 400 },
      { x: 1000, y: 1000 },
      { x: 0, y: 1000 },
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 600, y: 0 },
      { x: 600, y: 400 },
    ]);
    // Aire : trémie moins palier, sens trigonométrique conservé.
    expect(signedArea(v)).toBeCloseTo(1000 * 1000 - 400 * 400, 6);
  });

  it("sommets confondus au dixième de mm près (trémie resaisie)", () => {
    const shifted = opening.map((p) => (p.x === 1000 && p.y <= 400 ? { ...p, x: 1000.05 } : p));
    const v = openingMinusLanding(shifted, landing);
    expect(v).toHaveLength(7);
    expect(v).toContainEqual({ x: 600, y: 400 });
  });

  it("palier séparé du contour (ou absent) : trémie inchangée", () => {
    const inside = landing.map((p) => ({ x: p.x - 100, y: p.y + 100 }));
    expect(openingMinusLanding(opening, inside)).toEqual(opening);
    expect(openingMinusLanding(opening, undefined)).toEqual(opening);
    // Un seul sommet commun ne fait pas un côté commun.
    const corner = [
      { x: 1000, y: 1000 },
      { x: 1200, y: 1000 },
      { x: 1200, y: 1200 },
    ];
    expect(openingMinusLanding(opening, corner)).toEqual(opening);
  });
});
