import type { MaterialId } from "@blondel/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial } from "three";
import { MATERIAL_LOOKS } from "./materials.js";
import { createPartMaterial, isTranslucent, simpleMaterial } from "./pbr.js";
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
