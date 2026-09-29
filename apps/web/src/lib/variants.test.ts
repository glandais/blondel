import {
  ProjectSchema,
  clearModelCache,
  createProject,
  parseProjectText,
  type Project,
} from "@blondel/core";
import { describe, expect, it } from "vitest";
import j3aText from "../../../../examples/j3a-acceptance-01-bois.blondel.json?raw";
import { availableStructures } from "./optionalApi.js";
import { compareLines, runVariants, variantParams, variantsFor } from "./variants.js";

const withStructure = (p: Project, kind: string, params: Record<string, unknown> = {}): Project =>
  ProjectSchema.parse({ ...p, stair: { ...p.stair, structure: { kind, params } } });

describe("comparateur de variantes", () => {
  it("variantes proposées : bois à l'anglaise seulement pour un escalier droit", () => {
    const all = availableStructures();
    const straight = variantsFor(createProject("straight"), all).map((v) => v.id);
    expect(straight).toEqual([
      "wood-housed",
      "wood-cut",
      "steel-flat",
      "steel-profile-UPN",
      "steel-profile-IPE",
    ]);
    const quarter = variantsFor(createProject("quarter-left"), all).map((v) => v.id);
    expect(quarter).not.toContain("wood-cut");
    // Structure du projet non couverte (HEA) : ajoutée.
    const hea = withStructure(createProject("quarter-left"), "steel-profile", { family: "HEA" });
    expect(variantsFor(hea, all).map((v) => v.id)).toContain("current-steel-profile");
    // Structures absentes du cœur : non proposées.
    expect(variantsFor(createProject("straight"), [{ kind: "wood-housed" }])).toHaveLength(1);
  });

  it("paramètres : ceux du projet pour la même structure, section gardée si même famille", () => {
    const p = withStructure(createProject("straight"), "steel-profile", {
      family: "UPN",
      section: "UPN 200",
      upperOffset: 60,
    });
    const [upn, ipe] = variantsFor(p, availableStructures()).filter(
      (v) => v.kind === "steel-profile",
    );
    expect(variantParams(p, upn!)).toMatchObject({
      family: "UPN",
      section: "UPN 200",
      upperOffset: 60,
    });
    expect(variantParams(p, ipe!)).toMatchObject({
      family: "IPE",
      section: "auto",
      upperOffset: 60,
    });
    expect(variantParams(p, { id: "x", kind: "wood-housed", label: "x" })).toEqual({});
  });

  it("tableau côte à côte sur le cas d'acceptation n° 1 : grandeurs du cœur, coût « profil d'atelier requis »", () => {
    clearModelCache();
    const project = parseProjectText(j3aText);
    const variants = variantsFor(project, availableStructures());
    const { rows } = runVariants(project, variants);
    expect(rows.map((r) => r.id)).toEqual(variants.map((v) => v.id));
    const housed = rows.find((r) => r.id === "wood-housed")!;
    expect(housed.current).toBe(project.stair.structure.kind === "wood-housed");
    const flat = rows.find((r) => r.id === "steel-flat")!;
    expect(flat.executionClass).toMatch(/^EXC[12]$/);
    expect(flat.massKg).toBeGreaterThan(0);
    expect(flat.weldMm).toBeGreaterThan(0);
    expect(housed.executionClass).toBeNull();
    for (const r of rows) {
      expect(r.cost).toBeNull();
      expect("model" in r).toBe(false);
    }
    const lines = compareLines(rows);
    const cost = lines.find((l) => l.key === "cost")!;
    expect(cost.cells.every((c) => c.text === "profil d'atelier requis")).toBe(true);
    expect(cost.cells[0]!.title).toMatch(/taux horaire/);
    const exc = lines.find((l) => l.key === "exc")!;
    expect(exc.cells[rows.indexOf(housed)]!.text).toBe("sans objet");
    for (const l of lines) expect(l.cells).toHaveLength(rows.length);
    // Résultat transmissible par postMessage.
    expect(() => structuredClone(rows)).not.toThrow();
  });

  it("euros affichés quand le barème de l'atelier est complet", () => {
    clearModelCache();
    const base = createProject("straight");
    const project = ProjectSchema.parse({
      ...base,
      workshop: {
        costs: {
          hourlyRate: 60,
          minutesPerCut: 2,
          minutesPerWeldMeter: 10,
          minutesPerBend: 1,
          minutesPerHole: 1,
          minutesPerUniquePart: 5,
          steelPricePerKg: 1.5,
          woodPricePerM3: 1500,
          finishPricePerM2: 20,
        },
      },
    });
    const { rows } = runVariants(project, [
      { id: "steel-flat", kind: "steel-flat", label: "plat" },
    ]);
    expect(rows[0]!.cost?.total).toBeGreaterThan(0);
    const cost = compareLines(rows).find((l) => l.key === "cost")!;
    expect(cost.cells[0]!.text).toMatch(/€/);
  });
});
