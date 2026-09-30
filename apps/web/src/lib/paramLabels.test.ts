import { sectionsOf } from "@blondel/core";
import { describe, expect, it } from "vitest";
import { availableStructures } from "./optionalApi.js";
import {
  afterParamChange,
  catalogSectionOptions,
  fieldText,
  groupLabel,
  presentFields,
} from "./paramLabels.js";
import { deriveParamFields, withDefaults } from "./structureForm.js";
import { translatorFor } from "@blondel/i18n";

/** Défauts des plugins qui ne dépendent pas du contexte (`defaults()` sans tracé). */
function fieldsOf(kind: string, params: Record<string, unknown> = {}) {
  const plugin = availableStructures().find((p) => p.kind === kind)!;
  const defaults = plugin.defaults(undefined as never);
  const values = withDefaults(defaults, params);
  return presentFields(
    kind,
    deriveParamFields(defaults, plugin.paramsSchema),
    values,
    translatorFor("fr"),
  );
}

describe("formulaire des structures en français", () => {
  it("steel-flat, steel-profile, steel-curved, helical-core : tous les paramètres ont un libellé français", () => {
    for (const kind of ["steel-flat", "steel-profile", "steel-curved", "helical-core"]) {
      const fields = fieldsOf(kind);
      expect(fields.length).toBeGreaterThan(10);
      for (const f of fields) {
        expect(fieldText(kind, f.path), `${kind} ${f.path.join(".")}`).toBeDefined();
        if (f.kind === "enum") {
          for (const o of f.options) {
            if (f.path.join(".") === "section" && o !== "auto") continue;
            expect(f.optionLabels?.[o], `${kind} ${f.path.join(".")} = ${o}`).toBeDefined();
          }
        }
      }
      // Sous-objets regroupés.
      const groups = new Set(fields.map((f) => f.group).filter(Boolean));
      for (const g of groups) expect(groupLabel(g!, translatorFor("fr"))).not.toBe(g);
    }
  });

  it("unités : longueurs en mm, charges en kN/m²", () => {
    const f = fieldsOf("steel-profile");
    const unit = (p: string) => f.find((x) => x.path.join(".") === p)?.unit;
    expect(unit("upperOffset")).toBe("mm");
    expect(unit("precheck.extraPermanent")).toBe("kN/m²");
    expect(unit("precheck.gammaG")).toBe("");
  });

  it("section d'un profilé : liste du catalogue de la famille, remise en auto au changement de famille", () => {
    const f = fieldsOf("steel-profile", { family: "IPE" });
    const section = f.find((x) => x.path.join(".") === "section")!;
    expect(section.kind).toBe("enum");
    if (section.kind === "enum") {
      expect(section.options).toEqual(["auto", ...sectionsOf("IPE").map((s) => s.name)]);
      expect(section.optionLabels?.["auto"]).toBe("Automatique");
    }
    expect(catalogSectionOptions("n'importe quoi")[1]).toBe(sectionsOf("UPN")[0]!.name);
    const upn200 = { family: "IPE", section: "UPN 200" };
    expect(afterParamChange("steel-profile", ["family"], upn200).section).toBe("auto");
    const ipe = { family: "IPE", section: sectionsOf("IPE")[2]!.name };
    expect(afterParamChange("steel-profile", ["family"], ipe)).toBe(ipe);
    expect(afterParamChange("steel-flat", ["family"], upn200)).toBe(upn200);
  });

  it("section d'une autre famille (projet importé) : proposée dans la liste, jamais masquée", () => {
    // Le plugin accepte toute section du catalogue et l'utilise telle quelle : la liste doit
    // montrer la valeur effective, sinon elle afficherait « Automatique ».
    const f = fieldsOf("steel-profile", { family: "UPN", section: "IPE 200" });
    const section = f.find((x) => x.path.join(".") === "section")!;
    expect(section.kind).toBe("enum");
    if (section.kind === "enum") {
      expect(section.options).toContain("IPE 200");
      expect(section.options.slice(0, -1)).toEqual(catalogSectionOptions("UPN"));
      expect(section.optionLabels?.["IPE 200"]).toMatch(/IPE 200.*autre famille/);
    }
  });

  it("paramètres « nombre ou auto » des plugins bois : champ automatique", () => {
    const plugin = availableStructures().find((p) => p.kind === "wood-housed")!;
    const fields = deriveParamFields(
      { upperOffset: "auto", thickness: 45, newel: { tenonThickness: "auto" } },
      plugin.paramsSchema,
    );
    const kinds = Object.fromEntries(fields.map((f) => [f.path.join("."), f.kind]));
    expect(kinds).toEqual({
      upperOffset: "auto-number",
      thickness: "number",
      "newel.tenonThickness": "auto-number",
    });
    const presented = presentFields("wood-housed", fields, {}, translatorFor("fr"));
    expect(presented.find((f) => f.path[0] === "upperOffset")?.label).toMatch(/Dépassement haut/);
  });
});
