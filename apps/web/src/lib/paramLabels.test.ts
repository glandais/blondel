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
import {
  deriveParamFields,
  structureContext,
  unsupportedOptionsOf,
  withDefaults,
} from "./structureForm.js";
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
  it("steel-flat, steel-profile, steel-curved, steel-central, wood-central, helical-core : tous les paramètres ont un libellé français", () => {
    for (const kind of [
      "steel-flat",
      "steel-profile",
      "steel-curved",
      "steel-central",
      "wood-central",
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
      "wood-central",
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

describe("limon central bois (A29, vague 2)", () => {
  /** Champs présentés sur le tracé d'un préréglage, options grisées lues sur le cœur. */
  function woodFields(id: "straight" | "quarter-left" | "helical", locale: "fr" | "en" = "fr") {
    const plugin = availableStructures().find((p) => p.kind === "wood-central")!;
    const defaults = plugin.paramsSchema.parse({});
    return presentFields(
      "wood-central",
      deriveParamFields(defaults, plugin.paramsSchema),
      defaults,
      translatorFor(locale),
      unsupportedOptionsOf("wood-central", createProject(id)),
    );
  }
  const at = (fields: ReturnType<typeof woodFields>, p: string) =>
    fields.find((x) => x.path.join(".") === p);

  it("libellés, choix, groupes et ◆ des valeurs sans source", () => {
    const f = woodFields("straight");
    expect(at(f, "section.kind")?.optionLabels).toEqual({
      glulam: "Lamellé-collé",
      solid: "Bois massif",
    });
    expect(at(f, "section.kind")?.disabledOptions).toBeUndefined();
    expect(at(f, "strengthClass")?.optionLabels).toEqual({
      auto: "Automatique (selon l'essence)",
      unknown: "Inconnue",
      C30: "C30",
      D40: "D40",
    });
    expect(at(f, "anchors.finish")?.optionLabels).toEqual({
      raw: "Acier brut",
      painted: "Peint",
      galvanized: "Galvanisé",
    });
    for (const p of [
      "section.width",
      "trace.lateralOffset",
      "section.thinPlyMax",
      "bolts.holeDiameter",
      "anchors.thickness",
    ]) {
      expect(at(f, p), p).toMatchObject({ unit: "mm", toValidateHint: true });
    }
    // Valeurs calculées (« auto ») : pas de ◆, une aide qui dit comment.
    for (const p of ["section.residual", "section.lamellaThickness", "notch.rearDepth"]) {
      expect(at(f, p)?.kind, p).toBe("auto-number");
      expect(at(f, p)?.toValidateHint, p).toBeUndefined();
      expect(at(f, p)?.hint, p).toBeTruthy();
    }
    expect(at(f, "laminationJustification")?.hint).toMatch(
      /^Lamellé-collé cintré en plis minces, hors NF EN 14080 \(SPEC Q10\)/,
    );
    const fr = translatorFor("fr");
    const en = translatorFor("en");
    expect(groupLabel("notch", fr)).toBe("Entaille arrière des marches");
    expect(groupLabel("anchors", en)).toBe("Foot and head anchors");
    expect(groupLabel("bolts", en)).toBe("Tread bolts");
    const fEn = woodFields("straight", "en");
    expect(at(fEn, "section.kind")?.optionLabels).toEqual({
      glulam: "Glulam",
      solid: "Solid timber",
    });
    expect(at(fEn, "section.lamellaThickness")?.label).toBe("Lamination thickness");
    expect(at(fEn, "notch.rearDepth")?.label).toBe("Rear housing depth");
  });

  it("bois massif grisé sur un tournant et en hélicoïdal, raison du cœur", () => {
    for (const id of ["quarter-left", "helical"] as const) {
      const kind = at(woodFields(id), "section.kind")!;
      expect(kind.disabledOptions?.["solid"], id).toMatch(
        /^Bois massif réservé à l'escalier droit/,
      );
      expect(kind.optionLabels?.["solid"]).toMatch(/^Bois massif — indisponible : /);
      expect(kind.optionLabels?.["glulam"]).toBe("Lamellé-collé");
    }
    const en = at(woodFields("quarter-left", "en"), "section.kind")!;
    expect(en.optionLabels?.["solid"]).toMatch(/^Solid timber — unavailable: /);
  });
});

describe("suites du limon central (A32 a, A33, A34 du 2026-10-09)", () => {
  function woodFields(id: "straight" | "quarter-left", locale: "fr" | "en" = "fr") {
    const plugin = availableStructures().find((p) => p.kind === "wood-central")!;
    const defaults = plugin.paramsSchema.parse({});
    return presentFields(
      "wood-central",
      deriveParamFields(defaults, plugin.paramsSchema),
      defaults,
      translatorFor(locale),
      unsupportedOptionsOf("wood-central", createProject(id)),
    );
  }
  const at = (fields: ReturnType<typeof woodFields>, p: string) =>
    fields.find((x) => x.path.join(".") === p);

  it("filière, couches, tire-fonds, ancrage et platine : libellés, choix et ◆", () => {
    const f = woodFields("quarter-left");
    expect(at(f, "section.curvedMethod")?.optionLabels).toEqual({
      auto: "Automatique",
      mould: "Lamelles cintrées sur moule",
      stacked: "Couches horizontales empilées puis délardées",
    });
    expect(at(f, "section.curvedMethod")?.toValidateHint).toBeUndefined();
    expect(at(f, "anchors.kind")?.optionLabels).toEqual({
      auto: "Automatique (platine à âme noyée sur une poutre cintrée, sabot sinon)",
      shoe: "Sabot en U",
      embeddedPlate: "Platine à âme noyée",
    });
    for (const p of [
      "section.mouldMaxWidth",
      "section.layerThickness",
      "section.dressingAllowance",
      "bolts.edgeDistance",
      "bolts.minSpacing",
      "lagScrews.pilotDiameter",
      "lagScrews.minAnchorage",
      "lagScrews.tipCover",
      "lagScrews.maxLength",
      "anchors.plate.thickness",
      "anchors.plate.width",
      "anchors.plate.webThickness",
      "anchors.plate.webDepth",
      "anchors.plate.webLength",
      "anchors.plate.pinDiameter",
      "anchors.plate.pinHoleDiameter",
    ]) {
      expect(at(f, p), p).toMatchObject({ unit: "mm", toValidateHint: true });
    }
    expect(at(f, "anchors.plate.pins")?.toValidateHint).toBe(true);
    // Valeurs « auto » ◆ : couches, surcote, pinces et entraxe EC5, largeur de platine.
    for (const p of [
      "section.layerThickness",
      "section.dressingAllowance",
      "bolts.edgeDistance",
      "bolts.minSpacing",
      "anchors.plate.width",
    ]) {
      expect(at(f, p)?.kind, p).toBe("auto-number");
    }
    expect(at(f, "lagScrews.maxLength")?.group).toBe("lagScrews");
    expect(at(f, "anchors.plate.pins")?.group).toBe("anchors");
    const fr = translatorFor("fr");
    const en = translatorFor("en");
    expect(groupLabel("lagScrews", fr)).toBe("Tire-fonds des marches basses");
    expect(groupLabel("anchors", fr)).toBe("Ancrages de pied et de tête");
    expect(at(f, "anchors.foot")?.label).toBe("Ancrage de pied");
    const fEn = woodFields("quarter-left", "en");
    expect(at(fEn, "section.curvedMethod")?.optionLabels?.["stacked"]).toBe(
      "Stacked horizontal layers, then dressed",
    );
    expect(at(fEn, "anchors.kind")?.optionLabels?.["embeddedPlate"]).toBe(
      "Concealed-web base plate",
    );
    expect(groupLabel("lagScrews", en)).toBe("Coach screws of the low treads");
    // Aucune option grisée : le cœur n'en refuse aucune pour ces choix.
    expect(at(f, "section.curvedMethod")?.disabledOptions).toBeUndefined();
    expect(at(f, "anchors.kind")?.disabledOptions).toBeUndefined();
  });

  it("prédimensionnement : classes GL et « automatique », γ_M du lamellé-collé ◆", () => {
    const f = fieldsOf("wood-central");
    const cls = f.find((x) => x.path.join(".") === "precheck.woodClass")!;
    expect(cls.optionLabels).toEqual({
      C24: "C24",
      C30: "C30",
      D40: "D40",
      GL24h: "GL24h",
      GL28h: "GL28h",
      GL32h: "GL32h",
      auto: "Automatique (GL24h en lamellé-collé, C24 sinon)",
    });
    const gm = f.find((x) => x.path.join(".") === "precheck.gammaMGlulam")!;
    expect(gm.label).toBe("γ_M (lamellé-collé)");
    expect(gm.toValidateHint).toBe(true);
  });

  it("caisson du limon central métal : borne basse de l'entraxe des entretoises ◆", () => {
    const text = fieldText("steel-central", ["section", "diaphragmMinSpacing"]);
    expect(text).toMatchObject({ unit: "mm", hint: "ui.param.toValidate" });
    expect(translatorFor("fr").t(text!.label)).toBe("Entraxe minimal des entretoises");
    expect(translatorFor("en").t(text!.label)).toBe("Minimum diaphragm spacing");
  });
});
