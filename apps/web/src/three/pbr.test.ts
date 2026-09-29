import {
  GuardInfillSchema,
  ProjectSchema,
  buildModel,
  createProject,
  type MaterialId,
} from "@blondel/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial } from "three";
import { GLASS_THICKNESS_MM, MATERIAL_LOOKS, glassThicknessOf } from "./materials.js";
import { createPartMaterial, isTranslucent, setGlassThickness, simpleMaterial } from "./pbr.js";
import { resetTextureCache, setTextureScheduler } from "./textures.js";

const ALL = Object.keys(MATERIAL_LOOKS) as MaterialId[];
const HW = { physical: true, textureSize: 16, mipmaps: true };
const SW = { physical: false, textureSize: 16, mipmaps: false };

beforeEach(() => setTextureScheduler(() => {}));
afterEach(() => {
  resetTextureCache();
  setTextureScheduler();
});

describe("matériaux PBR", () => {
  it("bois, acier brut, galvanisé, inox et béton texturés ; teinte portée par la texture", () => {
    for (const id of ALL) {
      const m = createPartMaterial(id, HW) as MeshPhysicalMaterial;
      const textured = MATERIAL_LOOKS[id].texture !== undefined;
      expect(m.map !== null, id).toBe(textured);
      expect(m.roughnessMap !== null, id).toBe(textured);
      if (id.startsWith("wood-")) expect(textured, id).toBe(true);
      if (textured) expect(m.color.getHexString()).toBe("ffffff");
      m.dispose();
    }
  });

  it("GPU matériel : verre en transmission, inox anisotrope ; rendu logiciel : matériaux diffus", () => {
    const glass = createPartMaterial("glass", HW) as MeshPhysicalMaterial;
    expect(glass).toBeInstanceOf(MeshPhysicalMaterial);
    expect(glass.transmission).toBe(1);
    expect(glass.transparent).toBe(false);
    // three.js multiplie l'épaisseur par l'échelle de l'objet (groupe racine à 1/1 000) : elle
    // s'exprime en mm. 0,01 (lu comme des mètres) donnait 10 µm, soit aucune réfraction.
    expect(glass.thickness).toBeGreaterThanOrEqual(4);
    expect(glass.thickness).toBeLessThanOrEqual(40);
    const inox = createPartMaterial("stainless-brushed", HW) as MeshPhysicalMaterial;
    expect(inox.anisotropy).toBeGreaterThan(0);
    for (const id of ALL) {
      const m = createPartMaterial(id, SW);
      expect(m, id).toBeInstanceOf(MeshLambertMaterial);
      // Rendu logiciel : veinage (couleur) conservé.
      expect(m.map !== null, id).toBe(MATERIAL_LOOKS[id].texture !== undefined);
    }
    expect(simpleMaterial({ color: "#fff", roughness: 0.4 }, { physical: true })).toBeInstanceOf(
      MeshStandardMaterial,
    );
    expect(simpleMaterial({ color: "#fff", roughness: 0.4 }, { physical: false })).toBeInstanceOf(
      MeshLambertMaterial,
    );
    const swGlass = createPartMaterial("glass", SW);
    expect(swGlass.transparent).toBe(true);
    expect(swGlass.opacity).toBeLessThan(1);
    expect(isTranslucent("glass")).toBe(true);
    expect(isTranslucent("wood-oak")).toBe(false);
  });

  it("pièce en violation : teinte émissive de la sévérité", () => {
    const m = createPartMaterial("wood-oak", HW, { severity: "bloquant" });
    expect(m.emissive.getHexString()).not.toBe("000000");
    expect(m.name).toBe("wood-oak|bloquant");
  });
});

describe("épaisseur du verre en 3D (QUESTIONS A25)", () => {
  it("défaut = épaisseur par défaut du remplissage verre du cœur (18 mm), plus 10 mm", () => {
    const infill = GuardInfillSchema.parse({ kind: "glass" });
    expect(infill.kind === "glass" ? infill.thickness : NaN).toBe(GLASS_THICKNESS_MM);
    const glass = createPartMaterial("glass", HW) as MeshPhysicalMaterial;
    expect(glass.thickness).toBe(GLASS_THICKNESS_MM);
    expect(glass.thickness).not.toBe(10);
  });

  it("suit l'épaisseur du remplissage du modèle, appliquée sur place", () => {
    const project = createProject("straight");
    const glassy = {
      ...project,
      guards: { ...project.guards, infill: { kind: "glass" as const, thickness: 12 } },
    };
    const model = buildModel(ProjectSchema.parse(glassy));
    expect(model.parts.some((p) => p.material === "glass")).toBe(true);
    expect(glassThicknessOf(model)).toBe(12);
    expect(glassThicknessOf(null)).toBe(GLASS_THICKNESS_MM);
    const m = createPartMaterial("glass", HW, { glassThickness: 12 }) as MeshPhysicalMaterial;
    expect(m.thickness).toBe(12);
    setGlassThickness(m, 24);
    expect(m.thickness).toBe(24);
    // Sans transmission (rendu logiciel, matériau non vitré) : sans effet.
    const oak = createPartMaterial("wood-oak", HW);
    setGlassThickness(oak, 24);
    expect((oak as MeshPhysicalMaterial).thickness).not.toBe(24);
  });
});
