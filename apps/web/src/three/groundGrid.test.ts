import { describe, expect, it } from "vitest";
import {
  GROUND_GRID_RENDER_ORDER,
  SHADOW_PLANE_RENDER_ORDER,
  cameraClipRange,
  createGroundGridMaterial,
  gridFadeDistance,
} from "./groundGrid.js";

describe("sol de la vue 3D", () => {
  it("plan proche adapté à la scène, jamais sous 5 cm (précision de profondeur)", () => {
    expect(cameraClipRange(5)).toEqual({ near: 0.05, far: 200 });
    expect(cameraClipRange(1)).toEqual({ near: 0.05, far: 100 });
    expect(cameraClipRange(40).near).toBeCloseTo(0.2);
    expect(cameraClipRange(1000)).toEqual({ near: 0.5, far: 40000 });
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = cameraClipRange(bad);
      expect(r.near).toBeGreaterThanOrEqual(0.05);
      expect(r.far).toBeGreaterThan(r.near * 1000);
    }
  });

  it("estompe de la grille proportionnelle à la scène, au moins 15 m", () => {
    expect(gridFadeDistance(2)).toBe(15);
    expect(gridFadeDistance(10)).toBe(40);
    expect(gridFadeDistance(Number.NaN)).toBe(20);
  });

  it("grille sans écriture de profondeur, repoussée derrière les faces au sol, dessinée après le plan d'ombre et avant les autres transparents", () => {
    const m = createGroundGridMaterial({
      cellColor: "#9aa0a6",
      sectionColor: "#6b7178",
      fadeDistance: 20,
    });
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.depthTest).toBe(true);
    expect(m.polygonOffset).toBe(true);
    expect(m.polygonOffsetFactor).toBeGreaterThan(0);
    expect(m.uniforms["fadeDistance"]?.value).toBe(20);
    expect(m.uniforms["extent"]?.value).toBeGreaterThan(2 * 20);
    // Anti-moiré : lignes effacées selon leur pas à l'écran (dérivées).
    expect(m.fragmentShader).toContain("fwidth");
    expect(SHADOW_PLANE_RENDER_ORDER).toBeLessThan(GROUND_GRID_RENDER_ORDER);
    expect(GROUND_GRID_RENDER_ORDER).toBeLessThan(0);
    m.dispose();
  });
});
