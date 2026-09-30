import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatLength, formatMeasure, parseIntMm } from "./units.js";

describe("parseIntMm", () => {
  it("accepte les entiers, avec espaces de milliers", () => {
    expect(parseIntMm("2700")).toEqual({ ok: true, value: 2700 });
    expect(parseIntMm(" 2 700 ")).toEqual({ ok: true, value: 2700 });
    expect(parseIntMm("-15")).toEqual({ ok: true, value: -15 });
  });

  it("refuse décimales, texte, vide et bornes", () => {
    expect(parseIntMm("12,5").ok).toBe(false);
    expect(parseIntMm("12.5").ok).toBe(false);
    expect(parseIntMm("abc").ok).toBe(false);
    expect(parseIntMm("").ok).toBe(false);
    expect(parseIntMm("5", { min: 10 }).ok).toBe(false);
    expect(parseIntMm("50", { max: 10 }).ok).toBe(false);
  });

  it("aller-retour pour tout entier sûr dans les bornes", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), (n) => {
        const r = parseIntMm(String(n), { min: -1_000_000, max: 1_000_000 });
        return r.ok && r.value === n;
      }),
    );
  });
});

describe("formatLength", () => {
  it("affiche en mm au dixième et en cm au centième", () => {
    const nbsp = /[\s  ]/g;
    expect(formatLength(180.6667, "mm", "fr").replace(nbsp, " ")).toBe("180,7 mm");
    expect(formatLength(180.6667, "cm", "fr").replace(nbsp, " ")).toBe("18,07 cm");
    expect(formatLength(Number.NaN, "mm", "fr")).toBe("–");
    expect(formatLength(undefined, "cm", "fr")).toBe("–");
  });

  it("formatMeasure n'applique l'unité d'affichage qu'aux mm", () => {
    expect(formatMeasure(0.5, "", "cm", "fr")).toBe("0,5");
    expect(formatMeasure(40, "°", "cm", "fr")).toBe("40 °");
    expect(formatMeasure(100, "mm", "cm", "fr").replace(/\s/g, " ")).toBe("10 cm");
  });
});
