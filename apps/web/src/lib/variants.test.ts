import {
  ProjectSchema,
  buildModel,
  clearModelCache,
  createProject,
  parseProjectText,
  type Project,
} from "@blondel/core";
import { describe, expect, it } from "vitest";
import j3aText from "../../../../examples/j3a-acceptance-01-bois.blondel.json?raw";
import { presetProject } from "./layoutKind.js";
import { availableStructures } from "./optionalApi.js";
import { applyVariant, compareLines, runVariants, variantParams, variantsFor } from "./variants.js";

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

  it("débillardé soudé proposé dès qu'il y a un tournant ; hélicoïdal : fût, marches bois ou tôle", () => {
    const all = availableStructures();
    expect(variantsFor(createProject("straight"), all).map((v) => v.id)).not.toContain(
      "steel-curved",
    );
    const quarter = variantsFor(createProject("quarter-left"), all).map((v) => v.id);
    expect(quarter).toContain("steel-curved");
    const helical = presetProject("helical");
    const hv = variantsFor(helical, all);
    expect(hv.map((v) => v.id)).toEqual(["helical-core-wood", "helical-core-steel"]);
    // Paramètres imposés fusionnés en profondeur (l'épaisseur de tôle du projet est gardée).
    const own = withStructure(helical, "helical-core", {
      treads: { material: "wood", plateThickness: 10 },
    });
    expect(variantParams(own, hv[1]!)).toEqual({
      treads: { material: "steel", plateThickness: 10 },
    });
  });

  it("même épure, jour adapté : poteau pour les limons droits, arc roulable pour le débillardé, appliqué avec la variante", () => {
    clearModelCache();
    const project = createProject("quarter-left");
    expect(project.stair.layout.turns[0]!.inner.kind).toBe("sharp");
    const { rows } = runVariants(project, [
      { id: "wood-housed", kind: "wood-housed", label: "bois" },
      { id: "steel-curved", kind: "steel-curved", label: "débillardé" },
    ]);
    const [housed, curved] = rows as [(typeof rows)[number], (typeof rows)[number]];
    expect(housed.adaptations[0]!.to.kind).toBe("newel");
    expect(curved.adaptations[0]!.to.kind).toBe("arc");
    expect(curved.signals.join(" ")).toMatch(/débillardé/);
    // Référence : première variante (la structure du projet n'est pas comparée).
    expect(housed.reference).toBe(true);
    expect(curved.deviations.join(" ")).toMatch(/Tournant 1 : jour en arc/);
    const lines = compareLines(rows);
    expect(lines.find((l) => l.key === "jour")!.cells[1]!.text).toMatch(/^T1 : arc R /);
    expect(lines.find((l) => l.key === "deviations")!.cells[0]!.text).toBe("référence");
    expect(() => structuredClone(rows)).not.toThrow();

    const applied = applyVariant(project, curved);
    expect(applied.stair.structure.kind).toBe("steel-curved");
    expect(applied.stair.layout.turns[0]!.inner).toEqual(curved.adaptations[0]!.to);
    expect(ProjectSchema.safeParse(applied).success).toBe(true);
    expect(buildModel(applied).errors).toEqual([]);
  });

  it("hélicoïdal : variante « projet » repérée, aucune adaptation ni écart de jour", () => {
    clearModelCache();
    const project = presetProject("helical");
    const { rows } = runVariants(project, variantsFor(project, availableStructures()));
    expect(rows.map((r) => r.current)).toEqual([true, false]);
    expect(rows[0]!.reference).toBe(true);
    for (const r of rows) {
      expect(r.adaptations).toEqual([]);
      expect(r.errors).toEqual([]);
    }
    const steel = applyVariant(project, rows[1]!);
    expect(steel.stair.layout).toBe(project.stair.layout);
    expect(steel.stair.structure).toEqual({
      kind: "helical-core",
      params: { treads: { material: "steel" } },
    });
  });
});
