import { describe, expect, it } from "vitest";
import type { Part, SolidDesc } from "@blondel/core";
import { checkManifold, signedVolume } from "./analysis.js";
import { meshPart, meshParts, meshSolid } from "./solid.js";
import { identityFrame, rect } from "./testing.js";

const part = (id: string, solid: SolidDesc): Part => ({
  id,
  mark: id.toUpperCase(),
  category: "tread",
  name: id,
  material: "wood-oak",
  solid,
  quantities: {},
});

/** Marche 900 × 280 × 40 posée à la hauteur k × 180, avec 2 mortaises. */
const tread = (k: number): SolidDesc => ({
  kind: "extrusion",
  frame: { ...identityFrame, origin: { x: 0, y: 250 * k, z: 180 * k } },
  profile: {
    outer: rect(450, 140, 900, 280),
    holes: [rect(40, 140, 20, 150), rect(860, 140, 20, 150)],
  },
  depth: 40,
});

describe("meshSolid", () => {
  it("aiguille selon le type de solide", () => {
    expect(signedVolume(meshSolid(tread(0)))).toBeCloseTo((900 * 280 - 2 * 20 * 150) * 40, 0);
    const sweep: SolidDesc = {
      kind: "sweep",
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 1000, z: 500 },
      ],
      section: { outer: rect(0, 0, 50, 50), holes: [] },
    };
    expect(checkManifold(meshSolid(sweep)).ok).toBe(true);
    const ruled: SolidDesc = {
      kind: "ruled",
      a: [
        { x: 0, y: 0, z: 0 },
        { x: 1000, y: 0, z: 0 },
      ],
      b: [
        { x: 0, y: 0, z: 200 },
        { x: 1000, y: 0, z: 200 },
      ],
      thickness: 30,
      normals: [
        { x: 0, y: -1 },
        { x: 0, y: -1 },
      ],
    };
    expect(signedVolume(meshSolid(ruled))).toBeCloseTo(1000 * 200 * 30, 0);
  });
});

describe("meshPart / meshParts", () => {
  it("porte l'identité de la pièce et met le maillage en cache par identité du solide", () => {
    const p = part("tread-1", tread(1));
    const a = meshPart(p);
    expect(a).toMatchObject({
      partId: "tread-1",
      mark: "TREAD-1",
      category: "tread",
      material: "wood-oak",
    });
    expect(meshPart(p).mesh).toBe(a.mesh);
    expect(meshPart(p, { creaseAngleDeg: 10 }).mesh).not.toBe(a.mesh);
  });

  it("une pièce invalide donne un maillage vide et un message, sans interrompre les autres", () => {
    const bad = part("bad", {
      kind: "sweep",
      path: [{ x: 0, y: 0, z: 0 }],
      section: { outer: rect(0, 0, 1, 1), holes: [] },
    });
    const res = meshParts([part("ok", tread(0)), bad]);
    expect(res[0]!.error).toBeUndefined();
    expect(res[1]!.error).toMatch(/chemin/);
    expect(res[1]!.mesh.indices.length).toBe(0);
  });

  // Budget de 20 ms (ADR-0006) ; ×3 hors `PERF_STRICT=1`, comme `core/src/pipeline/perf.test.ts`
  // (suite parallèle sur une machine chargée).
  it("performance : 200 extrusions en moins de 20 ms", () => {
    const solids = Array.from({ length: 200 }, (_, k) => tread(k));
    for (let w = 0; w < 5; w++) solids.forEach((s) => meshSolid(s)); // chauffe du JIT
    let best = Infinity;
    for (let run = 0; run < 5; run++) {
      const t0 = performance.now();
      for (const s of solids) meshSolid(s);
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThan(20 * (process.env["PERF_STRICT"] === "1" ? 1 : 3));
  });
});

describe("meshSolid — robustesse (revue)", () => {
  it("type de solide inconnu : GeometryError, et meshPart ne met pas `undefined` en cache", () => {
    const weird = { kind: "loft" } as unknown as SolidDesc;
    expect(() => meshSolid(weird)).toThrow(/inconnu/);
    const p = part("weird", weird);
    const r1 = meshPart(p);
    expect(r1.error).toMatch(/inconnu/);
    expect(r1.mesh.indices.length).toBe(0);
    expect(meshPart(p).error).toMatch(/inconnu/);
  });
});
