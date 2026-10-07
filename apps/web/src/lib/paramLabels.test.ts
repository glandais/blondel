import { buildModel, createProject, sectionsOf } from "@blondel/core";
import { describe, expect, it } from "vitest";
import { availableStructures } from "./optionalApi.js";
import {
  afterParamChange,
  catalogSectionOptions,
  fieldText,
  groupLabel,
  presentFields,
} from "./paramLabels.js";
import { deriveParamFields, structureContext, withDefaults } from "./structureForm.js";
import { textMessage, translatorFor } from "@blondel/i18n";

/** Contexte d'un escalier droit, pour les plugins dont les défauts dépendent du tracé. */
const straight = createProject("straight");
const STRAIGHT_CTX = structureContext(straight, buildModel(straight))!;

/**
 * Défauts des plugins qui ne dépendent pas du contexte (`defaults()` sans tracé) ; ceux qui le
 * lisent (limon central : section selon le tracé) sur un escalier droit.
 */
function fieldsOf(kind: string, params: Record<string, unknown> = {}) {
  const plugin = availableStructures().find((p) => p.kind === kind)!;
  const defaults = plugin.defaults(kind === "steel-central" ? STRAIGHT_CTX : (undefined as never));
  const values = withDefaults(defaults, params);
  return presentFields(
    kind,
    deriveParamFields(defaults, plugin.paramsSchema),
    values,
    translatorFor("fr"),
  );
}

describe("formulaire des structures en français", () => {
  it("steel-flat, steel-profile, steel-curved, steel-central, helical-core : tous les paramètres ont un libellé français", () => {
    for (const kind of [
      "steel-flat",
      "steel-profile",
      "steel-curved",
      "steel-central",
      "helical-core",
    ]) {
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

describe("libellés unifiés (spécification de contenu § 4)", () => {
  it("dépassements d_h / d_b : référence « ligne des nez » en aide, jamais dans le libellé", () => {
    const f = fieldsOf("steel-flat");
    const up = f.find((x) => x.path.join(".") === "upperOffset")!;
    const low = f.find((x) => x.path.join(".") === "lowerOffset")!;
    expect(up.hint).toBe("Au-dessus de la ligne des nez");
    expect(low.hint).toBe("Sous la ligne des nez");
    expect(up.toValidateHint).toBeUndefined();
    expect(fieldText("steel-flat", ["upperOffset"])?.label).toBe("ui.param.upperOffset.label");
  });

  it("matériau des marches : un seul libellé pour tous les plugins", () => {
    expect(fieldText("steel-flat", ["treadKind"])?.label).toBe("ui.label.treadMaterial");
    expect(fieldText("helical-core", ["treads", "material"])?.label).toBe("ui.label.treadMaterial");
    const t = translatorFor("fr");
    expect(t.t("ui.label.treadMaterial")).toBe("Matériau des marches");
    expect(translatorFor("en").t("ui.label.treadMaterial")).toBe("Tread material");
  });

  it("aucun libellé ne porte d'unité entre parenthèses (unité à droite du champ)", () => {
    for (const kind of [
      "steel-flat",
      "steel-profile",
      "steel-curved",
      "steel-central",
      "helical-core",
    ]) {
      for (const f of fieldsOf(kind)) {
        expect(f.label, `${kind} ${f.path.join(".")}`).not.toMatch(/\((mm|°|kN\/m²)\)/);
      }
    }
  });
});

describe("limon central (A29) et fixation des marches en tôle (A31)", () => {
  it("limon central : groupes, choix et ◆ des valeurs sans source", () => {
    const f = fieldsOf("steel-central");
    const at = (p: string) => f.find((x) => x.path.join(".") === p);
    expect(at("section.kind")?.optionLabels).toEqual({
      tube: "Tube rectangulaire",
      box: "Caisson en tôles soudées",
    });
    expect(at("supports.kind")?.optionLabels).toEqual({
      console: "Console soudée",
      "folded-u": "Support plié en U",
      "folded-z": "Support plié en Z",
      "folded-triangle": "Support plié en triangle",
    });
    expect(at("section.height")).toMatchObject({ unit: "mm", toValidateHint: true });
    expect(at("trace.lateralOffset")).toMatchObject({ unit: "mm", toValidateHint: true });
    // Valeurs calculées (« auto ») : pas de ◆, une aide qui dit comment.
    expect(at("beam.topOffset")?.kind).toBe("auto-number");
    expect(at("beam.topOffset")?.toValidateHint).toBeUndefined();
    expect(at("supports.length")?.kind).toBe("auto-number");
    // Libellés unifiés repris (sens identique).
    expect(fieldText("steel-central", ["beam", "jointOffset"])?.label).toBe(
      "ui.param.steelCurved.curved.jointOffset.label",
    );
    expect(fieldText("steel-central", ["plates", "thickness"])?.label).toBe(
      "ui.param.plates.thickness.label",
    );
    const fr = translatorFor("fr");
    for (const g of ["trace", "section", "beam", "supports", "plates", "precheck"]) {
      expect(groupLabel(g, fr)).not.toBe(g);
    }
    expect(groupLabel("section", translatorFor("en"))).toBe("Beam section");
  });

  it("A31 : fixation vissée | soudée et perçage, ◆, pour les plugins à supports", () => {
    for (const kind of ["steel-flat", "steel-curved", "steel-central"]) {
      expect(fieldText(kind, ["supports", "treadFixing"])).toMatchObject({
        label: "ui.param.supports.treadFixing.label",
        hint: "ui.param.toValidate",
      });
      expect(fieldText(kind, ["supports", "treadHoleDiameter"])).toMatchObject({
        unit: "mm",
        hint: "ui.param.toValidate",
      });
    }
    const f = fieldsOf("steel-central").find((x) => x.path.join(".") === "supports.treadFixing");
    expect(f?.optionLabels).toEqual({ screwed: "Vissées", welded: "Soudées" });
  });

  it("choix non pris en charge sur le tracé : grisé, raison dans le libellé (anglais compris)", () => {
    const fields = [
      {
        kind: "enum" as const,
        path: ["section", "kind"],
        label: "Section › kind",
        options: ["tube", "box"],
      },
    ];
    const unsupported = [
      { path: ["section", "kind"], value: "tube", reason: textMessage("droit seulement") },
      // Autre chemin ou valeur absente : ignorés.
      { path: ["supports", "kind"], value: "console", reason: textMessage("x") },
      { path: ["section", "kind"], value: "inconnu", reason: textMessage("x") },
    ];
    const [fr] = presentFields("steel-central", fields, {}, translatorFor("fr"), unsupported);
    expect(fr!.disabledOptions).toEqual({ tube: "droit seulement" });
    expect(fr!.optionLabels).toEqual({
      tube: "Tube rectangulaire — indisponible : droit seulement",
      box: "Caisson en tôles soudées",
    });
    const [en] = presentFields("steel-central", fields, {}, translatorFor("en"), unsupported);
    expect(en!.optionLabels!["tube"]).toBe(
      "Rectangular hollow section — unavailable: droit seulement",
    );
    // Sans déclaration : rien de grisé.
    const [plain] = presentFields("steel-central", fields, {}, translatorFor("fr"));
    expect(plain!.disabledOptions).toBeUndefined();
  });
});
