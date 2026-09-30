import { textMessage, translatorFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { fr } from "../i18n.test-helpers.js";
import { boundsText, checkItems, checkValue, STAIR, type Item } from "./check.js";
import type { EvaluatorContext } from "./types.js";

const EN = translatorFor("en");

/** Contexte minimal : seuls `rule.unite`, `rule.min` et `rule.max` sont lus. */
const ctx = (unite: string | null, min: number | null, max: number | null): EvaluatorContext =>
  ({ rule: { unite, min, max } }) as unknown as EvaluatorContext;

const items = (...values: number[]): Item[] =>
  values.map((value, i) => ({ value, location: STAIR, label: textMessage(`marche ${i + 1}`) }));

describe("constats communs (compliance.check.*) : français identique à l'ancien texte", () => {
  it("bornes", () => {
    expect(fr(boundsText({ min: 170, max: 210.456 }, "mm"))).toBe("entre 170 et 210,46 mm");
    expect(fr(boundsText({ min: 1900, max: null }, "mm"))).toBe("≥ 1900 mm");
    expect(fr(boundsText({ min: 0.5, max: null, strictMin: true }, "ratio"))).toBe("> 0,5");
    expect(fr(boundsText({ min: null, max: 45 }, null))).toBe("≤ 45");
    expect(fr(boundsText({ min: null, max: 45, strictMax: true }, "°"))).toBe("< 45 °");
    expect(fr(boundsText({ min: null, max: null }, "mm"))).toBe("sans borne");
    expect(EN.t(boundsText({ min: 170, max: 1210.456 }, "mm"))).toBe("between 170 and 1210.46 mm");
    expect(EN.t(boundsText({ min: null, max: null }, "mm"))).toBe("no limit");
  });

  it("valeur unique", () => {
    const f = checkValue(ctx("mm", 170, 210), 215.678, textMessage("Hauteur de marche"));
    expect(f.status).toBe("violation");
    expect(fr(f.message)).toBe("Hauteur de marche : 215,68 mm (attendu entre 170 et 210 mm).");
    expect(EN.t(f.message)).toBe("Hauteur de marche: 215.68 mm (expected between 170 and 210 mm).");
    const nan = checkValue(ctx("mm", 170, 210), NaN, textMessage("Giron"));
    expect(nan.status).toBe("non-evaluee");
    expect(fr(nan.message)).toBe("Giron : valeur non calculable (NaN).");
  });

  it("série : violation, conforme (pluriel anglais), vide", () => {
    const [bad] = checkItems(ctx("mm", 170, 210), items(180, 220), textMessage("Hauteur"));
    expect(fr(bad!.message)).toBe("Hauteur, marche 2 : 220 mm (attendu entre 170 et 210 mm).");
    const one = checkItems(ctx("mm", 170, 210), items(180), textMessage("Hauteur"))[0]!;
    expect(fr(one.message)).toBe(
      "Hauteur conforme sur 1 élément(s) ; valeur la plus défavorable 180 mm (marche 1), attendu entre 170 et 210 mm.",
    );
    expect(EN.t(one.message)).toMatch(/^Hauteur within limits on 1 item; /);
    const many = checkItems(ctx("mm", 170, 210), items(180, 205), textMessage("Hauteur"))[0]!;
    expect(fr(many.message)).toMatch(/ conforme sur 2 élément\(s\) ; .* 205 mm \(marche 2\)/);
    expect(EN.t(many.message)).toMatch(/ within limits on 2 items; /);
    const empty = checkItems(ctx("mm", 170, 210), [], textMessage("hauteur"))[0]!;
    expect(fr(empty.message)).toBe("Sans objet : aucun élément concerné (hauteur).");
    expect(EN.t(empty.message)).toBe("Not applicable: no item concerned (hauteur).");
  });

  it("nombre d'éléments ≥ 1000 : sans séparateur de milliers (ancien texte)", () => {
    const values = Array.from({ length: 1200 }, () => 180);
    const f = checkItems(ctx("mm", 170, 210), items(...values), textMessage("Hauteur"))[0]!;
    expect(fr(f.message)).toContain("conforme sur 1200 élément(s)");
    expect(EN.t(f.message)).toContain("on 1200 items;");
  });
});
