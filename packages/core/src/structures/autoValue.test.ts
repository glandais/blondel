import { describe, expect, it } from "vitest";
import { AUTO_VALUE_TOLERANCE, commonAutoValue } from "./autoValue.js";

describe("commonAutoValue", () => {
  it("valeur commune des limons, à la tolérance près", () => {
    expect(commonAutoValue([55, 55])).toBe(55);
    expect(commonAutoValue([55, 55 + AUTO_VALUE_TOLERANCE / 2])).toBe(55);
    expect(commonAutoValue([42])).toBe(42);
  });

  it("aucune valeur exposée si les limons diffèrent (l'imposer changerait un limon)", () => {
    expect(commonAutoValue([55, 60])).toBeUndefined();
  });

  it("valeurs non finies ignorées ; aucune valeur finie → absente", () => {
    expect(commonAutoValue([Number.NaN, 70])).toBe(70);
    expect(commonAutoValue([])).toBeUndefined();
    expect(commonAutoValue([Number.POSITIVE_INFINITY])).toBeUndefined();
  });
});
