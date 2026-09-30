import { openingFromSurvey, type OpeningSurvey } from "@blondel/core";
import { translatorFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { blindSpot } from "./PlanSurveyForm.js";

describe("limite du contrôle du relevé (QUESTIONS D6, ledger l. 264)", () => {
  it("annonce l'angle mort dans le sens défavorable, pas le plus petit seuil", () => {
    // Quadrilatère mal conditionné du ledger : sur CD, une erreur d'environ 85 mm restait
    // « cohérente » ; le plus petit des deux seuils (≈ 55 mm) la sous-estimait.
    const P = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 165, y: 546 },
      { x: -1500, y: 546 },
    ];
    const d = (i: number, j: number): number => Math.hypot(P[i]!.x - P[j]!.x, P[i]!.y - P[j]!.y);
    const m: OpeningSurvey = {
      ab: d(0, 1),
      bc: d(1, 2),
      cd: d(2, 3),
      da: d(3, 0),
      ac: d(0, 2),
      bd: d(1, 3),
    };
    const r = openingFromSurvey(m);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = blindSpot(r, translatorFor("fr"));
    expect(text).toContain("« côté cd »");
    const mm = Number(/jusqu'à (\d+) mm/.exec(text.replace(/\s/g, " "))?.[1]);
    expect(mm).toBeGreaterThan(80);
    const again = openingFromSurvey({ ...m, cd: m.cd + 0.97 * mm });
    const other = openingFromSurvey({ ...m, cd: m.cd - 0.97 * mm });
    expect((again.ok && again.consistent) || (other.ok && other.consistent)).toBe(true);
    const en = blindSpot(r, translatorFor("en"));
    expect(en).toContain("“side cd”");
    expect(en).toMatch(/^Check limit: an isolated error of up to \d+ mm/);
  });
});
