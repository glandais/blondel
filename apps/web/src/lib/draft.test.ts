import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decideDraft, formatDecimal, parseDecimal, parseIntMm } from "./units.js";

describe("saisie appliquée à la validation", () => {
  const int = (t: string) => parseIntMm(t, { min: 1 });

  it("valeur valide et différente : appliquée", () => {
    expect(decideDraft("2700", 2500, int)).toEqual({ kind: "commit", value: 2700 });
  });

  it("valeur identique : rien à appliquer (pas d'entrée d'historique)", () => {
    expect(decideDraft(" 2 500 ", 2500, int)).toEqual({ kind: "unchanged" });
  });

  it("saisie invalide ou hors bornes : jamais appliquée", () => {
    expect(decideDraft("27,5", 2500, int).kind).toBe("invalid");
    expect(decideDraft("0", 2500, int).kind).toBe("invalid");
    expect(decideDraft("", 2500, int).kind).toBe("invalid");
  });

  it("une seule application par validation, quelle que soit la frappe intermédiaire", () => {
    // Les préfixes tapés (« 2 », « 27 », « 270 ») ne sont que des brouillons : seule la
    // décision prise à la validation compte.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 99_999 }),
        fc.integer({ min: 1, max: 99_999 }),
        (cur, typed) => {
          const d = decideDraft(String(typed), cur, int);
          if (typed === cur) expect(d.kind).toBe("unchanged");
          else expect(d).toEqual({ kind: "commit", value: typed });
        },
      ),
    );
  });
});

describe("parseDecimal", () => {
  it("virgule ou point, bornes", () => {
    expect(parseDecimal("0,33")).toEqual({ ok: true, value: 0.33 });
    expect(parseDecimal("1.5")).toEqual({ ok: true, value: 1.5 });
    expect(parseDecimal(",5")).toEqual({ ok: true, value: 0.5 });
    expect(parseDecimal("abc").ok).toBe(false);
    expect(parseDecimal("1,2,3").ok).toBe(false);
    expect(parseDecimal("-1", { min: 0 }).ok).toBe(false);
    expect(parseDecimal("5", { max: 4 }).ok).toBe(false);
  });

  it("aller-retour formatDecimal → parseDecimal", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), (v) => {
        const r = parseDecimal(formatDecimal(v));
        expect(r.ok).toBe(true);
        if (r.ok)
          expect(Math.abs(r.value - v)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(v)));
      }),
    );
  });
});
