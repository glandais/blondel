/**
 * Réglages repris par l'inspecteur Pièce selon la famille de pièces (spécification de contenu
 * § 3, colonne « Inspecteur pièce »), paramètres de garde-corps par catégorie de pièce et type de
 * remplissage, filtrage des chemins par préfixe, encart « Forme du … » et
 * section de Conception de la pièce (mode Fabrication).
 */
import {
  WOOD_CENTRAL_BEAM_ID,
  WOOD_CENTRAL_SHOE_FOOT_ID,
  WOOD_CENTRAL_SHOE_HEAD_ID,
  type Part,
} from "@blondel/core";
import { translatorFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { defaultGuards, switchInfill, type InfillKind } from "./guardsForm.js";
import { paramKey, tierEntry } from "./paramTiers.js";
import {
  guardParamsFor,
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

/** Clés des chemins de garde-corps repris. */
const keys = (paths: readonly (readonly string[])[] | undefined): string[] =>
  (paths ?? []).map((path) => path.join("."));

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

  it("limon central (A29) : tracé, section et poutre repris pour ses pièces de poutre", () => {
    const s = partSettingsFor(p("stringer", "structure"))!;
    for (const path of [
      ["trace", "lateralOffset"],
      ["section", "kind"],
      ["section", "webThickness"],
      ["beam", "topOffset"],
      ["beam", "jointOffset"],
    ]) {
      expect(matchesSettings(path, s.structureParams), path.join(".")).toBe(true);
    }
    // Supports (consoles, supports pliés) : tous les réglages `supports.*`.
    const sup = partSettingsFor(p("support", "structure"))!;
    expect(matchesSettings(["supports", "consoleThickness"], sup.structureParams)).toBe(true);
  });

  it("limon central bois (A29, vague 2) : poutre et sabots, sans changer wood-cut ni les platines", () => {
    const beam = partSettingsFor({
      ...p("carriage", "structure", "wood-oak"),
      id: WOOD_CENTRAL_BEAM_ID,
    })!;
    expect(beam.section).toBe("structure");
    expect(beam.scopeLabel).toBe("ui.partInspector.scope.woodCentralBeam");
    for (const path of [
      ["section", "kind"],
      ["section", "lamellaThickness"],
      ["notch", "rearDepth"],
      ["bolts", "perTread"],
      ["trace", "lateralOffset"],
      ["material"],
      ["strengthClass"],
    ]) {
      expect(matchesSettings(path, beam.structureParams), path.join(".")).toBe(true);
    }
    expect(matchesSettings(["anchors", "thickness"], beam.structureParams)).toBe(false);
    for (const id of [WOOD_CENTRAL_SHOE_FOOT_ID, WOOD_CENTRAL_SHOE_HEAD_ID]) {
      const shoe = partSettingsFor({ ...p("fixing", "structure"), id })!;
      expect(shoe.structureParams).toEqual(["anchors"]);
      expect(shoe.scopeLabel).toBe("ui.partInspector.scope.woodCentralShoes");
    }
    // Crémaillères de wood-cut et platines des structures acier : inchangées.
    const cut = partSettingsFor({
      ...p("carriage", "structure", "wood-oak"),
      id: "carriage-left",
    })!;
    expect(cut.scopeLabel).toBe("ui.partInspector.scope.carriages");
    expect(cut.structureParams).not.toContain("bolts");
    expect(
      partSettingsFor({ ...p("fixing", "structure"), id: "plate-foot" })!.structureParams,
    ).toEqual(["plates"]);
    const fr = translatorFor("fr");
    expect(fr.t("ui.partInspector.scope.woodCentralShoes")).toBe("communs aux sabots");
    expect(translatorFor("en").t("ui.partInspector.scope.woodCentralShoes")).toBe(
      "shared by the shoes",
    );
  });

  it("A31 : fixation de la marche en tôle sur son support reprise pour la marche", () => {
    const s = partSettingsFor(p("tread", "treads", "steel-painted"))!;
    expect(matchesSettings(["supports", "treadFixing"], s.structureParams)).toBe(true);
    expect(matchesSettings(["supports", "treadHoleDiameter"], s.structureParams)).toBe(true);
    expect(matchesSettings(["supports", "bolts"], s.structureParams)).toBe(false);
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

  it("garde-corps sans spécification : aucun champ repris, lien vers la section Garde-corps", () => {
    for (const c of ["post", "handrail", "baluster", "infill"] as const) {
      const s = partSettingsFor(p(c, "guards"))!;
      expect(s.section).toBe("guards");
      expect(s.structureParams).toEqual([]);
      expect(s.guardParams).toEqual([]);
    }
  });

  it("poteau de garde-corps : côté, entraxe maximal, poteau d'angle, implantation", () => {
    const s = partSettingsFor(p("post", "guards"), defaultGuards())!;
    expect(s.scopeLabel).toBe("ui.partInspector.scope.guardPosts");
    expect(keys(s.guardParams)).toEqual([
      "guards.posts.size",
      "guards.posts.maxSpacing",
      "guards.posts.cornerAngle",
      "guards.flight.edgeOffset",
      "guards.opening.setback",
    ]);
  });

  it("main courante : section, hauteur, prolongements, dégagement au mur", () => {
    const s = partSettingsFor(p("handrail", "guards"), defaultGuards())!;
    expect(s.scopeLabel).toBe("ui.partInspector.scope.handrails");
    expect(keys(s.guardParams)).toEqual([
      "guards.handrail.section",
      "guards.handrail.height",
      "guards.handrail.extensions.bottom",
      "guards.handrail.extensions.top",
      "guards.handrail.wallClearance",
    ]);
  });

  it("balustre et remplissage : champs du type de remplissage du projet", () => {
    const guards = defaultGuards();
    expect(guards.infill.kind).toBe("balusters");
    const balusters = partSettingsFor(p("baluster", "guards"), guards)!;
    expect(balusters.scopeLabel).toBe("ui.partInspector.scope.infill");
    expect(keys(balusters.guardParams)).toEqual([
      "guards.infill.spacing",
      "guards.infill.section",
      "guards.infill.bottomGap",
    ]);
    const withKind = (kind: InfillKind) => ({
      ...guards,
      infill: switchInfill(guards.infill, kind),
    });
    expect(keys(guardParamsFor("infill", withKind("rails")))).toEqual([
      "guards.infill.count",
      "guards.infill.section",
      "guards.infill.bottomGap",
    ]);
    expect(keys(guardParamsFor("infill", withKind("cables")))).toContain("guards.infill.diameter");
    expect(keys(guardParamsFor("infill", withKind("glass")))).toEqual([
      "guards.infill.thickness",
      "guards.infill.panelGap",
      "guards.infill.bottomGap",
    ]);
    expect(keys(guardParamsFor("infill", withKind("perforated")))).toContain(
      "guards.infill.holeDiameter",
    );
  });

  it("garde-corps : niveaux Conception et Atelier seulement, jamais Essentiel", () => {
    const guards = defaultGuards();
    const cats = ["post", "handrail", "baluster", "infill", "stringer"] as const;
    for (const c of cats) {
      for (const path of guardParamsFor(c, guards)) {
        expect(["design", "workshop"]).toContain(tierEntry(paramKey(path))?.tier);
        expect(path[0]).toBe("guards");
      }
    }
    // Ni matériau (Essentiel) ni type de remplissage dans les réglages d'une pièce.
    const all = cats.flatMap((c) => keys(guardParamsFor(c, guards)));
    expect(all).not.toContain("guards.material");
    expect(all).not.toContain("guards.infill.kind");
    // Catégorie sans réglages de garde-corps : aucun.
    expect(guardParamsFor("stringer", guards)).toEqual([]);
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
    for (const locale of ["fr", "en"] as const) {
      const t = translatorFor(locale);
      for (const c of ["post", "handrail", "baluster", "infill"] as const) {
        const key = partSettingsFor(p(c, "guards"), defaultGuards())!.scopeLabel;
        expect(t.t(key)).not.toBe(key);
      }
    }
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
