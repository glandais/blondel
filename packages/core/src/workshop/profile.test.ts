import { describe, expect, it } from "vitest";
import { ProjectSchema } from "../model/project.js";
import { serializeProject } from "../project/serialize.js";
import { makeSteppingProject } from "../stepping/test-helpers.js";
import {
  DEFAULT_WORKSHOP_PROFILE,
  OTHER_DENSITY_PROVENANCE,
  OTHER_MATERIALS,
  WOOD_MATERIALS,
  WORKSHOP_PROVENANCE,
  materialDensity,
  resolveWorkshopProfile,
  smallestAvailable,
} from "./profile.js";

describe("profil d'atelier", () => {
  it("chaque valeur par défaut a une provenance, marquée « à valider »", () => {
    for (const k of Object.keys(DEFAULT_WORKSHOP_PROFILE.wood)) {
      expect(WORKSHOP_PROVENANCE).toHaveProperty(k);
    }
    expect(Object.values(WORKSHOP_PROVENANCE).every((p) => p.status === "a-valider")).toBe(true);
    for (const m of WOOD_MATERIALS)
      expect(DEFAULT_WORKSHOP_PROFILE.wood.densities[m]).toBeGreaterThan(0);
  });

  it("profil partiel du projet fusionné champ par champ", () => {
    const p = resolveWorkshopProfile({
      name: "Atelier pilote",
      wood: { maxBoardLength: 5000, densities: { "wood-oak": 750 } },
    });
    expect(p.name).toBe("Atelier pilote");
    expect(p.wood.maxBoardLength).toBe(5000);
    expect(p.wood.housingDepth).toBe(DEFAULT_WORKSHOP_PROFILE.wood.housingDepth);
    expect(p.wood.densities["wood-oak"]).toBe(750);
    expect(p.wood.densities["wood-pine"]).toBe(
      DEFAULT_WORKSHOP_PROFILE.wood.densities["wood-pine"],
    );
    expect(resolveWorkshopProfile(undefined)).toBe(DEFAULT_WORKSHOP_PROFILE);
  });

  it("champ `workshop` facultatif et rétrocompatible dans le projet", () => {
    const p = makeSteppingProject({ width: 900, legs: ["auto"] });
    expect(p.workshop).toBeUndefined();
    expect(serializeProject(p)).not.toContain("workshop");
    const withProfile = ProjectSchema.parse({ ...p, workshop: { wood: { clearance: 2 } } });
    expect(withProfile.workshop?.wood?.clearance).toBe(2);
    expect(() => ProjectSchema.parse({ ...p, workshop: { wood: { clearance: -1 } } })).toThrow();
  });

  it("plus petite valeur disponible", () => {
    expect(smallestAvailable([27, 34, 54], 50)).toBe(54);
    expect(smallestAvailable([27, 34], 50)).toBeNull();
    expect(smallestAvailable([], 50)).toBe(50);
  });
});

describe("masses volumiques de tous les matériaux (QUESTIONS A6)", () => {
  const ALL = [
    ...WOOD_MATERIALS,
    "steel-raw",
    "steel-painted",
    "steel-galvanized",
    ...OTHER_MATERIALS,
  ] as const;

  it("chaque matériau du modèle a une masse volumique finie et positive, « à valider »", () => {
    for (const m of ALL) {
      expect(materialDensity(m, DEFAULT_WORKSHOP_PROFILE), m).toBeGreaterThan(0);
    }
    for (const m of OTHER_MATERIALS) expect(OTHER_DENSITY_PROVENANCE[m].status).toBe("a-valider");
  });

  it("surcharges du projet : bois, acier et autres matériaux", () => {
    const p = resolveWorkshopProfile({
      wood: { densities: { "wood-oak": 720 } },
      metal: { density: 7800 },
      densities: { glass: 2600 },
    });
    expect(materialDensity("wood-oak", p)).toBe(720);
    expect(materialDensity("wood-pine", p)).toBe(
      DEFAULT_WORKSHOP_PROFILE.wood.densities["wood-pine"],
    );
    expect(materialDensity("steel-painted", p)).toBe(7800);
    expect(materialDensity("glass", p)).toBe(2600);
    expect(materialDensity("stainless-brushed", p)).toBe(
      DEFAULT_WORKSHOP_PROFILE.densities["stainless-brushed"],
    );
  });
});
