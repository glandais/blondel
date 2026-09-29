import { createProject } from "@blondel/core";
import { checkManifold, meshSweep, signedVolume } from "@blondel/geometry";
import { describe, expect, it } from "vitest";
import { SLAB_DISPLAY_MARGIN, toBufferGeometry, upperSlabMesh } from "./geometry.js";

describe("aperçu 3D", () => {
  it("dalle haute percée de la trémie : volume exact et solide fermé", () => {
    const p = createProject("straight");
    const o = p.site.opening;
    if (o?.kind !== "rect") throw new Error("trémie rectangulaire attendue");
    const footprint = [
      { x: 0, y: 0 },
      { x: p.stair.layout.width, y: 0 },
    ];
    const mesh = upperSlabMesh(p, footprint);
    expect(mesh).toBeDefined();
    if (!mesh) return;
    const xs = [0, p.stair.layout.width, o.x, o.x + o.sizeX];
    const ys = [0, o.y, o.y + o.sizeY];
    const w = Math.max(...xs) - Math.min(...xs) + 2 * SLAB_DISPLAY_MARGIN;
    const h = Math.max(...ys) - Math.min(...ys) + 2 * SLAB_DISPLAY_MARGIN;
    const expected = (w * h - o.sizeX * o.sizeY) * p.site.upperSlabThickness;
    expect(signedVolume(mesh)).toBeCloseTo(expected, -3);
    expect(checkManifold(mesh).ok).toBe(true);
    const g = toBufferGeometry(mesh);
    expect(g.getAttribute("position").count).toBe(mesh.positions.length / 3);
    expect(g.boundingBox?.max.z).toBeCloseTo(p.site.floorToFloor, 3);
    g.dispose();
  });

  it("pas de dalle sans trémie", () => {
    const p = createProject("straight");
    const { opening: _o, ...site } = p.site;
    expect(upperSlabMesh({ ...p, site }, [])).toBeUndefined();
  });

  it("main courante ronde lissée : UV par triangle (sommets dupliqués aux coutures), sans texture écrasée", () => {
    const ring = Array.from({ length: 16 }, (_, i) => ({
      x: 21 * Math.cos((i * Math.PI) / 8),
      y: 21 * Math.sin((i * Math.PI) / 8),
    }));
    const path = Array.from({ length: 17 }, (_, i) => ({
      x: 1000 * Math.cos((i * Math.PI) / 16),
      y: 1000 * Math.sin((i * Math.PI) / 16),
      z: 900 + 60 * i,
    }));
    const mesh = meshSweep(path, { outer: ring, holes: [] });
    const g = toBufferGeometry(mesh);
    const pos = g.getAttribute("position");
    const uv = g.getAttribute("uv");
    const index = g.getIndex()!;
    expect(uv.count).toBe(pos.count);
    expect(pos.count).toBeGreaterThan(mesh.positions.length / 3);
    expect(index.count).toBe(mesh.indices.length);
    let worst = 0;
    for (let t = 0; t < index.count; t += 3) {
      for (let c = 0; c < 3; c++) {
        const i = index.getX(t + c);
        const j = index.getX(t + ((c + 1) % 3));
        const dp = Math.hypot(
          pos.getX(i) - pos.getX(j),
          pos.getY(i) - pos.getY(j),
          pos.getZ(i) - pos.getZ(j),
        );
        const du = Math.hypot(uv.getX(i) - uv.getX(j), uv.getY(i) - uv.getY(j)) * 1000;
        if (dp > 1e-3) worst = Math.max(worst, du / dp);
      }
    }
    expect(worst).toBeLessThan(1.001);
    g.dispose();
  });
});
