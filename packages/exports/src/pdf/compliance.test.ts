import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { RuleResult } from "@blondel/core";
import { measureDecimals, measuredText } from "./compliance.js";

function result(over: Partial<RuleResult>): RuleResult {
  return {
    ruleId: "R",
    description: "règle",
    status: "ok",
    severity: "avertissement",
    declaredSeverity: "avertissement",
    location: { kind: "stair" },
    nature: "metier",
    confidence: "moyen",
    source: "test",
    secondarySource: false,
    message: "",
    ...over,
  };
}

/** Valeur numérique d'un nombre imprimé au format français. */
const parseFr = (s: string): number => Number(s.replace(/ /g, "").replace(",", "."));

function printed(text: string, label: string): number {
  const m = new RegExp(`${label} (-?[\\d\\u202f]+(?:,\\d+)?)`).exec(text);
  if (m === null) throw new Error(`${label} absent de « ${text} »`);
  return parseFr(m[1]!);
}

describe("measuredText (page de conformité du PDF)", () => {
  it("un seuil en ratio est imprimé tel que la règle le fixe (1,32, pas 1,3)", () => {
    const t = measuredText(result({ measured: 0.7499, max: 1.32, unit: "ratio" }));
    expect(t).toBe("mesuré 0,75 ratio — max 1,32 ratio");
  });

  it("violation en ratio : la mesure affichée dépasse le seuil affiché", () => {
    const t = measuredText(
      result({ status: "violation", measured: 1.345, max: 1.32, unit: "ratio" }),
    )!;
    expect(printed(t, "mesuré")).toBeGreaterThan(printed(t, "max"));
    expect(t).toContain("max 1,32 ratio");
  });

  it("violation en mm : 599,96 pour un min de 600 ne s'imprime pas « 600 »", () => {
    const t = measuredText(result({ status: "violation", measured: 599.96, min: 600, unit: "mm" }));
    expect(t).toBe("mesuré 599,96 mm — min 600 mm");
  });

  it("cote conforme en mm : 0,1 mm conservé", () => {
    expect(measuredText(result({ measured: 620.04, min: 600, unit: "mm" }))).toBe(
      "mesuré 620 mm — min 600 mm",
    );
    expect(measureDecimals(result({ measured: 620.04, min: 600, unit: "mm" }))).toBe(1);
  });

  it("propriété : une violation hors bornes s'affiche strictement du mauvais côté", () => {
    const units = fc.constantFrom("mm", "ratio", "mm/m", "kN/m", "deg", "unite", undefined);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 400_000 }).map((n) => n / 100), // seuil au centième
        fc.double({ min: 1e-5, max: 50, noNaN: true }),
        fc.boolean(),
        units,
        (threshold, delta, isMin, unit) => {
          const measured = isMin ? threshold - delta : threshold + delta;
          const r = result({
            status: "violation",
            measured,
            ...(isMin ? { min: threshold } : { max: threshold }),
            ...(unit !== undefined ? { unit } : {}),
          });
          const t = measuredText(r)!;
          const m = printed(t, "mesuré");
          const s = printed(t, isMin ? "min" : "max");
          expect(s).toBeCloseTo(threshold, 9);
          if (isMin) expect(m).toBeLessThan(s);
          else expect(m).toBeGreaterThan(s);
        },
      ),
    );
  });

  it("propriété : une mesure dans les bornes reste dans les bornes affichées", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 400_000 }).map((n) => n / 100),
        fc.integer({ min: 0, max: 400_000 }).map((n) => n / 100),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, b, f) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          const measured = lo + (hi - lo) * f;
          const t = measuredText(result({ measured, min: lo, max: hi, unit: "ratio" }))!;
          const m = printed(t, "mesuré");
          expect(m).toBeGreaterThanOrEqual(printed(t, "min"));
          expect(m).toBeLessThanOrEqual(printed(t, "max"));
        },
      ),
    );
  });
});
