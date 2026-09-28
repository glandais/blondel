import { createProject } from "@blondel/core";
import { checkManifold, signedVolume } from "@blondel/geometry";
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
});
