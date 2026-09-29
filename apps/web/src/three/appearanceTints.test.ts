/**
 * Teintes enregistrées du projet (`Project.appearance`) appliquées au rendu : peinture de
 * l'acier, ton du bois, teinte du verre. Le matériau lui-même (et la masse) ne change pas.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MeshLambertMaterial, MeshPhysicalMaterial } from "three";
import {
  GLASS_TINTS,
  MATERIAL_LOOKS,
  WOOD_TONE_TINTS,
  appearanceKey,
  materialLook,
  materialLookFor,
  paintZoneFor,
} from "./materials.js";
import { createPartMaterial, tintPartMaterial } from "./pbr.js";
import { resetTextureCache, setTextureScheduler } from "./textures.js";

const HW = { physical: true, textureSize: 16, mipmaps: true };
const SW = { physical: false, textureSize: 16, mipmaps: false };

beforeEach(() => setTextureScheduler(() => {}));
afterEach(() => {
  resetTextureCache();
  setTextureScheduler();
});

describe("teintes du projet", () => {
  it("sans teinte : apparence par défaut, clé vide", () => {
    for (const id of Object.keys(MATERIAL_LOOKS) as (keyof typeof MATERIAL_LOOKS)[]) {
      expect(materialLookFor(id)).toBe(materialLook(id));
      expect(materialLookFor(id, {})).toEqual(materialLook(id));
    }
    expect(appearanceKey(undefined)).toBe("");
    expect(appearanceKey({ paintColor: "#1F2328" })).toBe(appearanceKey({ paintColor: "#1f2328" }));
    expect(appearanceKey({ woodTone: "dark" })).not.toBe(appearanceKey({ woodTone: "light" }));
  });

  it("peinture : seul l'acier peint change de couleur", () => {
    const a = { paintColor: "#1F2328" };
    expect(materialLookFor("steel-painted", a).color).toBe("#1f2328");
    expect(materialLookFor("steel-galvanized", a)).toBe(materialLook("steel-galvanized"));
    expect(materialLookFor("stainless-brushed", a)).toBe(materialLook("stainless-brushed"));
    const m = createPartMaterial("steel-painted", HW, { appearance: a }) as MeshPhysicalMaterial;
    expect(m.color.getHexString()).toBe(
      // Couleur three.js en espace linéaire, relue en sRVB par getHexString.
      "1f2328",
    );
    m.dispose();
  });

  it("peinture par zone : marches et garde-corps, sinon couleur de l'ossature", () => {
    const a = { paintColor: "#565C63", treadPaintColor: "#A3A8AB", guardPaintColor: "#2e3338" };
    expect(materialLookFor("steel-painted", a).color).toBe("#565c63");
    expect(materialLookFor("steel-painted", a, "structure").color).toBe("#565c63");
    expect(materialLookFor("steel-painted", a, "treads").color).toBe("#a3a8ab");
    expect(materialLookFor("steel-painted", a, "guards").color).toBe("#2e3338");
    // Zone sans couleur propre : couleur de l'ossature ; sans aucune : gris par défaut.
    expect(materialLookFor("steel-painted", { paintColor: "#111111" }, "treads").color).toBe(
      "#111111",
    );
    expect(materialLookFor("steel-painted", { guardPaintColor: "#222222" }, "treads")).toEqual(
      materialLook("steel-painted"),
    );
    expect(materialLookFor("steel-raw", a, "guards")).toBe(materialLook("steel-raw"));
    expect(paintZoneFor("steel-painted", "guards")).toBe("guards");
    expect(paintZoneFor("wood-oak", "treads")).toBe("structure");
    expect(appearanceKey({ treadPaintColor: "#a3a8ab" })).not.toBe(
      appearanceKey({ guardPaintColor: "#a3a8ab" }),
    );
    const m = createPartMaterial("steel-painted", HW, { appearance: a, zone: "treads" });
    expect(m.color.getHexString()).toBe("a3a8ab");
    tintPartMaterial(m, "steel-painted", HW, { guardPaintColor: "#2e3338" }, "guards");
    expect(m.color.getHexString()).toBe("2e3338");
    m.dispose();
  });

  it("ton du bois : multiplicateur de la texture (clair > 1, foncé < 1), naturel inchangé", () => {
    expect(materialLookFor("wood-oak", { woodTone: "natural" })).toBe(materialLook("wood-oak"));
    expect(WOOD_TONE_TINTS.light!.every((c) => c > 1)).toBe(true);
    expect(WOOD_TONE_TINTS.dark!.every((c) => c < 1)).toBe(true);
    const dark = createPartMaterial("wood-ash", HW, {
      appearance: { woodTone: "dark" },
    }) as MeshPhysicalMaterial;
    expect(dark.map).not.toBeNull();
    expect(dark.color.r).toBeLessThan(1);
    const soft = createPartMaterial("wood-ash", SW, {
      appearance: { woodTone: "light" },
    }) as MeshLambertMaterial;
    expect(soft.color.r).toBeGreaterThan(1);
    dark.dispose();
    soft.dispose();
  });

  it("verre : fumé plus opaque et plus sombre que le clair, extra-clair plus transparent", () => {
    const smoked = materialLookFor("glass", { glassTint: "smoked" });
    const extra = materialLookFor("glass", { glassTint: "extra-clear" });
    expect(smoked.opacity!).toBeGreaterThan(MATERIAL_LOOKS.glass.opacity!);
    expect(extra.opacity!).toBeLessThan(MATERIAL_LOOKS.glass.opacity!);
    expect(smoked.transmission).toBe(1);
    expect(GLASS_TINTS.clear.color).toBe(MATERIAL_LOOKS.glass.color);
    const soft = createPartMaterial("glass", SW, {
      appearance: { glassTint: "smoked" },
    }) as MeshLambertMaterial;
    expect(soft.opacity).toBe(smoked.opacity);
    soft.dispose();
  });

  it("teinte appliquée sur place : même résultat qu'un matériau créé avec elle, et retour", () => {
    const tints = [
      { paintColor: "#6b2f25", woodTone: "dark", glassTint: "smoked" },
      { woodTone: "light", glassTint: "extra-clear" },
      undefined,
    ] as const;
    for (const quality of [HW, SW]) {
      for (const id of Object.keys(MATERIAL_LOOKS) as (keyof typeof MATERIAL_LOOKS)[]) {
        const m = createPartMaterial(id, quality);
        const program = m.type;
        for (const appearance of tints) {
          tintPartMaterial(m, id, quality, appearance);
          const ref = createPartMaterial(id, quality, { appearance });
          expect(m.color.getHex(), `${id} ${JSON.stringify(appearance)}`).toBe(ref.color.getHex());
          expect(m.opacity).toBe(ref.opacity);
          expect(m.type).toBe(program);
          ref.dispose();
        }
        m.dispose();
      }
    }
  });
});
