import { z } from "zod";
import { describe, expect, it } from "vitest";
import { translatorFor, type MessageKey } from "@blondel/i18n";
import type { StructureKind } from "../model/plugins.js";
import { findSection, sectionsOf } from "../catalog/sections.js";
import {
  getStructure,
  listStructures,
  newelRequiredStructures,
  registerStructure,
  structureAcceptsLayout,
  structureLateralThickness,
  structureLayouts,
  structureRequiresNewel,
  structureUnsupportedOptions,
  unregisterStructure,
} from "./index.js";

const dummy: StructureKind<{ a: number }> = {
  kind: "test-dummy",
  labelKey: "test.dummy" as MessageKey,
  family: "bois",
  paramsSchema: z.object({ a: z.number().default(1) }),
  defaults: () => ({ a: 1 }),
  build: () => ({ parts: [], checks: [], notes: [] }),
};

describe("registre des structures", () => {
  it("plugins bois intégrés enregistrés", () => {
    const kinds = listStructures().map((s) => s.kind);
    expect(kinds).toEqual(expect.arrayContaining(["wood-housed", "wood-cut", "steel-central"]));
    expect(getStructure("wood-housed")?.family).toBe("bois");
    expect(getStructure("steel-central")?.family).toBe("metal");
  });

  it("enregistre, refuse les doublons et `none`, retire", () => {
    registerStructure(dummy);
    expect(getStructure("test-dummy")).toBe(dummy);
    expect(() => registerStructure(dummy)).toThrow(/déjà/);
    registerStructure(dummy, { replace: true });
    expect(() => registerStructure({ ...dummy, kind: "none" })).toThrow(/réservé/);
    expect(unregisterStructure("test-dummy")).toBe(true);
    expect(getStructure("test-dummy")).toBeUndefined();
  });

  it("libellés des plugins bois : clés traduites en français et en anglais", () => {
    const fr = translatorFor("fr");
    const en = translatorFor("en");
    const housed = getStructure("wood-housed")!;
    expect(fr.t(housed.labelKey)).toBe("Limons bois à la française (marches encastrées)");
    expect(en.t(housed.labelKey)).toBe("Timber closed strings (housed treads)");
    expect(en.t(getStructure("wood-cut")!.labelKey)).toBe("Timber cut strings");
    expect(en.t(getStructure("steel-central")!.labelKey)).toMatch(/^Steel mono-stringer/);
  });
});

describe("capacités déclarées par les plugins (dette D4)", () => {
  it("poteau exigé : mêmes structures que l'ancienne liste NEWEL_REQUIRED_STRUCTURES", () => {
    expect(newelRequiredStructures()).toEqual(["wood-housed", "steel-flat", "steel-profile"]);
    expect(structureRequiresNewel("steel-curved")).toBe(false);
    expect(structureRequiresNewel("steel-central")).toBe(false);
    expect(structureRequiresNewel("none")).toBe(false);
    expect(structureRequiresNewel("inconnue")).toBe(false);
  });

  it("tracés acceptés : helical-core pour l'hélicoïdal seulement, les autres pour les volées", () => {
    expect(structureLayouts("none")).toEqual(["flights", "helical"]);
    expect(structureAcceptsLayout("helical-core", "helical")).toBe(true);
    expect(structureAcceptsLayout("helical-core", "flights")).toBe(false);
    for (const k of ["wood-housed", "wood-cut", "steel-flat", "steel-profile", "steel-curved"]) {
      expect(structureAcceptsLayout(k, "flights")).toBe(true);
      expect(structureAcceptsLayout(k, "helical")).toBe(false);
    }
    // Limon central (QUESTIONS A29) : volées (droit, tournants) et hélicoïdal.
    expect(structureLayouts("steel-central")).toEqual(["flights", "helical"]);
    expect(structureLayouts("inconnue")).toEqual([]);
    // Plugin sans déclaration : volées seulement.
    registerStructure(dummy);
    try {
      expect(structureLayouts("test-dummy")).toEqual(["flights"]);
      expect(structureLateralThickness("test-dummy", {})).toEqual({ inner: 0, outer: 0 });
    } finally {
      unregisterStructure("test-dummy");
    }
  });

  it("épaisseurs hors emprise : limons latéraux, profilés (aile b) et limon extérieur hélicoïdal", () => {
    expect(structureLateralThickness("none", {})).toEqual({ inner: 0, outer: 0 });
    expect(structureLateralThickness("wood-housed", {})).toEqual({ inner: 45, outer: 45 });
    expect(structureLateralThickness("steel-flat", { thickness: 10 })).toEqual({
      inner: 10,
      outer: 10,
    });
    expect(structureLateralThickness("steel-curved", {})).toEqual({ inner: 8, outer: 8 });
    expect(structureLateralThickness("wood-cut", {})).toEqual({ inner: 0, outer: 0 });
    // Profilé nommé : largeur d'aile ; `auto` : aile de la plus légère (borne basse).
    const upn160 = findSection("UPN 160")!;
    expect(structureLateralThickness("steel-profile", { section: "UPN 160" })).toEqual({
      inner: upn160.b,
      outer: upn160.b,
    });
    const lightest = sectionsOf("UPN")[0]!.b;
    expect(structureLateralThickness("steel-profile", {})).toEqual({
      inner: lightest,
      outer: lightest,
    });
    expect(lightest).toBe(45);
    // Hélicoïdal : limon extérieur facultatif (au-delà de R_e), limon intérieur dans le jour.
    expect(structureLateralThickness("helical-core", {})).toEqual({ inner: 0, outer: 0 });
    expect(
      structureLateralThickness("helical-core", {
        outerStringer: { enabled: true, thickness: 10 },
      }),
    ).toEqual({ inner: 0, outer: 10 });
    // Limon central : poutre sous les marches, rien hors de l'emmarchement utile.
    expect(structureLateralThickness("steel-central", {})).toEqual({ inner: 0, outer: 0 });
    // Paramètres invalides, plugin inconnu : null.
    expect(structureLateralThickness("wood-housed", { thickness: -3 })).toBeNull();
    expect(structureLateralThickness("inconnue", {})).toBeNull();
  });

  it("options non prises en charge : tube du limon central sur un tracé courbe seulement", () => {
    const straight = { kind: "flights", turns: 0 } as const;
    const quarter = { kind: "flights", turns: 1 } as const;
    const helical = { kind: "helical", turns: 0 } as const;
    expect(structureUnsupportedOptions("steel-central", straight)).toEqual([]);
    for (const traits of [quarter, helical]) {
      const opts = structureUnsupportedOptions("steel-central", traits);
      expect(opts.map((o) => ({ path: o.path, value: o.value }))).toEqual([
        { path: ["section", "kind"], value: "tube" },
      ]);
      expect(translatorFor("fr").t(opts[0]!.reason)).toMatch(/^Tube réservé à l'escalier droit/);
    }
    // Sans déclaration, `none` ou plugin inconnu : aucune.
    for (const kind of ["none", "inconnue", "steel-flat", "steel-curved", "helical-core"]) {
      expect(structureUnsupportedOptions(kind, quarter)).toEqual([]);
    }
  });
});

describe("limon central bois (`wood-central`, QUESTIONS A29, vague 2)", () => {
  it("enregistré dans la famille bois, libellés traduits", () => {
    const s = getStructure("wood-central");
    expect(s?.family).toBe("bois");
    expect(s?.labelKey).toBe("structure.woodCentral.label");
    expect(translatorFor("fr").t(s!.labelKey)).toMatch(/^Limon central bois/);
    expect(translatorFor("en").t(s!.labelKey)).not.toBe(s!.labelKey);
  });

  it("tracés : volées (droit, tournants) et hélicoïdal ; pas de poteau ; rien hors emprise", () => {
    expect(structureLayouts("wood-central")).toEqual(["flights", "helical"]);
    expect(structureAcceptsLayout("wood-central", "helical")).toBe(true);
    expect(structureRequiresNewel("wood-central")).toBe(false);
    expect(newelRequiredStructures()).not.toContain("wood-central");
    expect(structureLateralThickness("wood-central", {})).toEqual({ inner: 0, outer: 0 });
  });

  it("options non prises en charge : bois massif sur un tracé courbe seulement", () => {
    expect(structureUnsupportedOptions("wood-central", { kind: "flights", turns: 0 })).toEqual([]);
    for (const traits of [
      { kind: "flights", turns: 1 },
      { kind: "flights", turns: 2 },
      { kind: "helical", turns: 0 },
    ] as const) {
      const opts = structureUnsupportedOptions("wood-central", traits);
      expect(opts.map((o) => ({ path: o.path, value: o.value }))).toEqual([
        { path: ["section", "kind"], value: "solid" },
      ]);
      expect(translatorFor("fr").t(opts[0]!.reason)).toMatch(/^Bois massif réservé/);
    }
  });
});
