/**
 * Intégration du jalon 3a côté interface : plugins de structure du cœur réellement listés,
 * formulaire générique dérivé de leurs paramètres, et exports (DXF des pièces, PDF chargé à
 * la demande) sur le cas d'acceptation n° 1 en limons à la française.
 */
import { buildModel, parseProjectText } from "@blondel/core";
import { describe, expect, it } from "vitest";
import exampleText from "../../../../examples/j3a-acceptance-01-bois.blondel.json?raw";
import { buildExport, exportAvailability } from "./exportFiles.js";
import { availableStructures } from "./optionalApi.js";
import {
  deriveParamFields,
  safeDefaults,
  structureContext,
  validateParams,
  withDefaults,
} from "./structureForm.js";

const project = parseProjectText(exampleText);
const model = buildModel(project);

describe("jalon 3a : interface branchée sur les plugins et les exports", () => {
  it("chaque plugin listé donne un formulaire valide avec ses défauts", () => {
    const ctx = structureContext(project, model);
    expect(ctx).toBeDefined();
    const plugins = availableStructures();
    expect(plugins.map((p) => p.kind)).toEqual(expect.arrayContaining(["wood-housed", "wood-cut"]));
    const housed = plugins.find((p) => p.kind === "wood-housed")!;
    const defaults = safeDefaults(housed, ctx);
    expect(defaults).toBeDefined();
    expect(validateParams(housed, defaults)).toBeNull();
    // Paramètres vides du projet (exemple) complétés par les défauts : formulaire non vide.
    const params = withDefaults(defaults, project.stair.structure.params);
    expect(deriveParamFields(params, housed.paramsSchema).length).toBeGreaterThan(0);
  });

  it("DXF des pièces : archive ZIP des développés (limons, poteau)", async () => {
    expect(exportAvailability("parts-dxf", model).ok).toBe(true);
    const files = await buildExport("parts-dxf", project, model);
    expect(files).toHaveLength(1);
    expect(files[0]!.filename.endsWith(".zip")).toBe(true);
    const bytes = files[0]!.content as Uint8Array;
    const names = new TextDecoder("latin1").decode(bytes);
    for (const mark of ["LI1", "LE1", "LI2", "LE2", "PT1"]) expect(names).toContain(`${mark}.dxf`);
  });

  it("dossier PDF par l'import à la demande réel", async () => {
    const [pdf] = await buildExport("pdf", project, model);
    const bytes = pdf!.content as Uint8Array;
    expect(bytes.length).toBeGreaterThan(10_000);
    expect(new TextDecoder("latin1").decode(bytes.subarray(0, 5))).toBe("%PDF-");
  });
});
