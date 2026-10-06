/**
 * Terme du développé (QUESTIONS A26 (a)) : « development » pour un limon bois, « flat pattern »
 * pour la tôle et l'acier en anglais ; « Développé » partout en français (texte identique).
 */
import { WOOD_MATERIALS, type MaterialId, type Part } from "@blondel/core";
import { messagesFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { flatDrawingTitle, flatTermKeys, isTimberDevelopment, pdfFlatTitle } from "./flatTerms.js";
import { translatorOf } from "./i18n.js";
import { sheetStringerPart, treadPart, woodStringerPart } from "./testing/fixtures.js";

const fr = translatorOf();
const en = translatorOf({ locale: "en" });

describe("terme du développé selon la pièce", () => {
  it("limon et crémaillère bois : development ; tôle, acier et autres pièces : flat pattern", () => {
    expect(isTimberDevelopment(woodStringerPart())).toBe(true);
    expect(isTimberDevelopment({ category: "carriage", material: "wood-oak" })).toBe(true);
    expect(isTimberDevelopment(sheetStringerPart())).toBe(false);
    expect(isTimberDevelopment({ category: "carriage", material: "steel-raw" })).toBe(false);
    // Marche ou poteau en bois : pas un limon.
    expect(isTimberDevelopment(treadPart(1))).toBe(false);
    expect(isTimberDevelopment({ category: "post", material: "wood-oak" })).toBe(false);
  });

  it("titres anglais : Development pour le limon bois, Flat pattern pour la tôle", () => {
    const wood = woodStringerPart();
    const sheet = sheetStringerPart();
    expect(flatDrawingTitle(en, wood)).toBe(`Development ${wood.mark}`);
    expect(flatDrawingTitle(en, sheet)).toBe(`Flat pattern ${sheet.mark}`);
    expect(pdfFlatTitle(en, wood)).toMatch(/^Development LI1 — /);
    expect(pdfFlatTitle(en, sheet)).toMatch(/^Flat pattern LI1 — /);
  });

  it("français identique pour toutes les pièces (« Développé »)", () => {
    for (const part of [woodStringerPart(), sheetStringerPart()] as Part[]) {
      expect(flatDrawingTitle(fr, part)).toBe(fr.t("drawing.flat.title", { mark: part.mark }));
      expect(pdfFlatTitle(fr, part)).toBe(
        fr.t("pdf.flat.title", { mark: part.mark, name: fr.t(part.name) }),
      );
    }
    // Chaque clé « development » a exactement le texte français de la clé générique.
    const messages = messagesFor("fr");
    const generic = flatTermKeys(undefined);
    const wood = flatTermKeys(woodStringerPart());
    for (const k of Object.keys(generic) as (keyof typeof generic)[]) {
      expect(wood[k]).not.toBe(generic[k]);
      expect(messages[wood[k]], k).toBe(messages[generic[k]]);
    }
  });

  it("matériaux du cœur : seuls les bois donnent development sur un limon", () => {
    const others: MaterialId[] = [
      "steel-raw",
      "steel-painted",
      "steel-galvanized",
      "stainless-brushed",
      "glass",
      "concrete",
    ];
    for (const material of WOOD_MATERIALS)
      expect(isTimberDevelopment({ category: "stringer", material }), material).toBe(true);
    for (const material of others)
      expect(isTimberDevelopment({ category: "stringer", material }), material).toBe(false);
  });
});
