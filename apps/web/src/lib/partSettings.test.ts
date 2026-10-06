/**
 * Réglages repris par l'inspecteur Pièce selon la famille de pièces (spécification de contenu
 * § 3, colonne « Inspecteur pièce »), filtrage des chemins par préfixe, encart « Forme du … » et
 * section de Conception de la pièce (mode Fabrication).
 */
import type { Part } from "@blondel/core";
import { translatorFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import {
  matchesSettings,
  partDesignSection,
  partSettingsFor,
  partShapeFor,
} from "./partSettings.js";

type P = Pick<Part, "category" | "family" | "material">;
const p = (
  category: Part["category"],
  family: Part["family"],
  material: Part["material"] = "steel-raw",
): P => ({
  category,
  family,
  material,
});

describe("partSettingsFor", () => {
  it("limons et crémaillères : section, épaisseur, dépassements, prolongements", () => {
    for (const c of ["stringer", "carriage"] as const) {
      const s = partSettingsFor(p(c, "structure"))!;
      expect(s.section).toBe("structure");
      for (const k of [
        "section",
        "thickness",
        "upperOffset",
        "lowerOffset",
        "startExtension",
        "endExtension",
      ]) {
        expect(s.structureParams).toContain(k);
      }
    }
    expect(partSettingsFor(p("stringer", "structure"))!.scopeLabel).toBe(
      "ui.partInspector.scope.stringers",
    );
  });

  it("poteau de structure, supports, platines, marches en tôle pliée", () => {
    expect(partSettingsFor(p("post", "structure"))!.structureParams).toContain("newel");
    expect(partSettingsFor(p("support", "structure"))!.structureParams).toEqual(["supports"]);
    expect(partSettingsFor(p("fixing", "structure"))!.structureParams).toEqual(["plates"]);
    expect(partSettingsFor(p("tread", "treads", "steel-painted"))!.structureParams).toContain(
      "folded",
    );
    expect(partSettingsFor(p("riser", "treads", "steel-raw"))!.scopeLabel).toBe(
      "ui.partInspector.scope.folded",
    );
  });

  it("garde-corps : aucun champ repris, lien vers la section Garde-corps", () => {
    for (const c of ["post", "handrail", "baluster", "infill"] as const) {
      expect(partSettingsFor(p(c, "guards"))).toEqual({
        scopeLabel: "ui.partInspector.scope.guards",
        structureParams: [],
        section: "guards",
      });
    }
  });

  it("marches et paliers bois, pièces sans réglages : null", () => {
    expect(partSettingsFor(p("tread", "treads", "wood-oak"))).toBeNull();
    expect(partSettingsFor(p("riser", "treads", "wood-oak"))).toBeNull();
    expect(partSettingsFor(p("landing", "treads", "wood-oak"))).toBeNull();
    expect(partSettingsFor(p("baluster", "structure"))).toBeNull();
    expect(partSettingsFor({ category: "tread", family: "treads" })).toBeNull();
  });

  it("libellés de portée traduits en français et en anglais", () => {
    const cats = ["stringer", "carriage", "post", "support", "fixing", "handrail"] as const;
    for (const locale of ["fr", "en"] as const) {
      const t = translatorFor(locale);
      for (const c of cats) {
        const key = partSettingsFor(p(c, "structure"))!.scopeLabel;
        expect(t.t(key)).not.toBe(key);
      }
    }
    expect(translatorFor("fr").t("ui.partInspector.scope.stringers")).toBe("communs aux limons");
  });
});

describe("matchesSettings", () => {
  it("chemin égal au préfixe ou sous-chemin, jamais un préfixe de mot", () => {
    expect(matchesSettings(["lowerOffset"], ["lowerOffset"])).toBe(true);
    expect(matchesSettings(["newel", "size"], ["newel"])).toBe(true);
    expect(matchesSettings(["newelX"], ["newel"])).toBe(false);
    expect(matchesSettings(["sectionAuto"], ["section"])).toBe(false);
    expect(matchesSettings(["supports", "kind"], [])).toBe(false);
  });
});

describe("forme de la pièce (encart « Forme du … » du mode Fabrication)", () => {
  const FR = translatorFor("fr");

  it("titre et aide adaptés à la pièce", () => {
    const limon = partShapeFor(p("stringer", "structure"));
    expect(FR.t(limon.title)).toBe("Forme du limon");
    expect(FR.t(limon.help)).toBe("Épaisseur, rives, jour : réglages de conception.");
    expect(FR.t(partShapeFor(p("carriage", "structure")).title)).toBe("Forme de la crémaillère");
    expect(FR.t(partShapeFor(p("support", "structure")).title)).toBe("Forme des supports");
    expect(FR.t(partShapeFor(p("tread", "treads", "wood-oak")).title)).toBe("Forme de la marche");
    expect(FR.t(partShapeFor(p("post", "guards")).title)).toBe("Forme du garde-corps");
  });

  it("chaque catégorie a un titre et une aide traduits (français, anglais)", () => {
    const cats: readonly Part["category"][] = [
      "tread",
      "riser",
      "stringer",
      "carriage",
      "support",
      "post",
      "handrail",
      "baluster",
      "infill",
      "landing",
      "fixing",
    ];
    for (const locale of ["fr", "en"] as const) {
      const t = translatorFor(locale);
      for (const category of cats) {
        for (const family of ["structure", "treads", "guards", undefined] as const) {
          const s = partShapeFor({ category, family });
          expect(t.t(s.title)).not.toBe(s.title);
          expect(t.t(s.help)).not.toBe(s.help);
        }
      }
    }
  });

  it("section de Conception : marches, garde-corps, structure (même sans réglages repris)", () => {
    expect(partDesignSection(p("tread", "treads", "wood-oak"))).toBe("treads");
    expect(partSettingsFor(p("tread", "treads", "wood-oak"))).toBeNull();
    expect(partDesignSection(p("riser", "treads", "steel-raw"))).toBe("treads");
    expect(partDesignSection(p("landing", "treads", "wood-oak"))).toBe("treads");
    for (const c of ["post", "handrail", "baluster", "infill"] as const) {
      expect(partDesignSection(p(c, "guards"))).toBe("guards");
    }
    for (const c of ["stringer", "carriage", "support", "fixing", "post", "handrail"] as const) {
      expect(partDesignSection(p(c, "structure"))).toBe("structure");
    }
  });
});
