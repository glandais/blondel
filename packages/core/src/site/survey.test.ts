import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { Vec2 } from "../model/primitives.js";
import { isSelfIntersecting } from "./opening.js";
import {
  openingFromSurvey,
  SURVEY_MEASURES,
  SURVEY_TOLERANCE_DEFAULT,
  type OpeningSurvey,
} from "./survey.js";

/** Relevé exact d'un quadrilatère A, B, C, D. */
function measure(q: readonly Vec2[]): OpeningSurvey {
  const d = (i: number, j: number) => V.distance(q[i]!, q[j]!);
  return { ab: d(0, 1), bc: d(1, 2), cd: d(2, 3), da: d(3, 0), ac: d(0, 2), bd: d(1, 3) };
}

/** Les deux quadrilatères ont les mêmes six distances (à `tol` près) : ils sont isométriques. */
function expectCongruent(p: readonly Vec2[], q: readonly Vec2[], tol = 1e-6): void {
  const a = measure(p);
  const b = measure(q);
  for (const k of SURVEY_MEASURES) expect(Math.abs(a[k] - b[k]), k).toBeLessThan(tol);
}

describe("openingFromSurvey — relevé 4 côtés + 2 diagonales (CHALLENGE P7)", () => {
  it("rectangle 2 800 × 900 : sommets exacts, cohérent, angles droits", () => {
    const diag = Math.hypot(2800, 900);
    const r = openingFromSurvey({ ab: 2800, bc: 900, cd: 2800, da: 900, ac: diag, bd: diag });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const expected = [
      { x: 0, y: 0 },
      { x: 2800, y: 0 },
      { x: 2800, y: 900 },
      { x: 0, y: 900 },
    ];
    r.points.forEach((p, i) => {
      expect(p.x).toBeCloseTo(expected[i]!.x, 6);
      expect(p.y).toBeCloseTo(expected[i]!.y, 6);
    });
    expect(r.consistent).toBe(true);
    expect(r.maxResidual).toBeLessThan(1e-6);
    expect(r.convex).toBe(true);
    for (const a of r.angles) expect(a).toBeCloseTo(90, 6);
  });

  it("trémie hors d'équerre (maçonnerie réelle) : parallélogramme retrouvé", () => {
    const q = [
      { x: 0, y: 0 },
      { x: 2800, y: 0 },
      { x: 2830, y: 900 },
      { x: 30, y: 900 },
    ];
    const r = openingFromSurvey(measure(q));
    expect(r.ok && r.consistent).toBe(true);
    if (r.ok) {
      expectCongruent(r.points, q);
      expect(r.angles[0]).toBeCloseTo(90 - (Math.atan2(30, 900) * 180) / Math.PI, 6);
    }
  });

  it("placement : A sur l'origine donnée, AB selon l'angle ; sens horaire", () => {
    const diag = Math.hypot(2000, 1000);
    const m = { ab: 2000, bc: 1000, cd: 2000, da: 1000, ac: diag, bd: diag };
    const r = openingFromSurvey(m, { origin: { x: 500, y: -200 }, angle: 90 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.points[0]).toEqual({ x: 500, y: -200 });
    expect(r.points[1].x).toBeCloseTo(500, 6);
    expect(r.points[1].y).toBeCloseTo(1800, 6);
    expect(signedArea(r.points)).toBeGreaterThan(0);
    const cw = openingFromSurvey(m, { orientation: "cw" });
    expect(cw.ok && signedArea(cw.points) < 0).toBe(true);
    if (cw.ok) for (const a of cw.angles) expect(a).toBeCloseTo(90, 6);
  });

  it("une mesure fausse de 30 mm est détectée (incohérent), les écarts sont rendus", () => {
    const diag = Math.hypot(2800, 900);
    const r = openingFromSurvey({ ab: 2800, bc: 900, cd: 2800, da: 900, ac: diag, bd: diag + 30 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.consistent).toBe(false);
    expect(r.maxResidual).toBeGreaterThan(SURVEY_TOLERANCE_DEFAULT);
    expect(Object.keys(r.residuals).sort()).toEqual([...SURVEY_MEASURES].sort());
  });

  it("bruit de mesure de ±1 mm : cohérent à la tolérance par défaut", () => {
    const diag = Math.hypot(2800, 900);
    const r = openingFromSurvey({
      ab: 2801,
      bc: 899,
      cd: 2800,
      da: 901,
      ac: diag - 1,
      bd: diag + 1,
    });
    expect(r.ok && r.consistent).toBe(true);
  });

  it("mesures impossibles : raison lisible, pas d'exception", () => {
    const bad = openingFromSurvey({ ab: 1000, bc: 500, cd: 1000, da: 500, ac: 3000, bd: 1100 });
    expect(bad).toMatchObject({ ok: false });
    if (!bad.ok) expect(bad.reason).toMatch(/triangle ABC/);
    const missing = openingFromSurvey({ ab: 1000, bc: 0, cd: 1000, da: 500, ac: 1100, bd: 1100 });
    expect(missing).toMatchObject({ ok: false });
  });

  // Générateur contraint : quadrilatères simples de trémie (côtés 400 à 4 000 mm), convexes ou
  // non, sans angle quasi plat (le relevé ne distinguerait plus les deux solutions).
  const quadArb = fc
    .tuple(
      fc.double({ min: 400, max: 4000, noNaN: true }),
      fc.double({ min: 400, max: 4000, noNaN: true }),
      fc.double({ min: -1500, max: 1500, noNaN: true }),
      fc.double({ min: -1500, max: 1500, noNaN: true }),
      fc.double({ min: -300, max: 300, noNaN: true }),
      fc.double({ min: -300, max: 300, noNaN: true }),
    )
    .map(([w, h, dx1, dx2, dy1, dy2]) => [
      { x: 0, y: 0 },
      { x: w, y: dy1 },
      { x: w + dx1, y: h + dy2 },
      { x: dx2, y: h },
    ])
    .filter((q) => {
      if (isSelfIntersecting(q) || !(signedArea(q) > 1e5)) return false;
      const m = measure(q);
      if (SURVEY_MEASURES.some((k) => !(m[k] > 100))) return false;
      // Angles intérieurs entre 20° et 340° (pas de sommet quasi aligné).
      for (let i = 0; i < 4; i++) {
        const p = q[i]!;
        const a = V.sub(q[(i + 3) % 4]!, p);
        const b = V.sub(q[(i + 1) % 4]!, p);
        const s = Math.abs(V.cross(a, b)) / (V.norm(a) * V.norm(b));
        if (s < Math.sin((20 * Math.PI) / 180)) return false;
      }
      return true;
    });

  it("propriété : un relevé exact rend un quadrilatère isométrique, cohérent, à écarts nuls", () => {
    fc.assert(
      fc.property(quadArb, (q) => {
        const r = openingFromSurvey(measure(q));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expectCongruent(r.points, q, 1e-5);
        expect(r.maxResidual).toBeLessThan(1e-5);
        expect(r.consistent).toBe(true);
        expect(isSelfIntersecting(r.points)).toBe(false);
        expect(r.angles.reduce((s, a) => s + a, 0)).toBeCloseTo(360, 6);
      }),
    );
  });

  it("propriété : la diagonale fausse est signalée, le polygone reste simple", () => {
    fc.assert(
      fc.property(quadArb, fc.double({ min: 20, max: 60, noNaN: true }), (q, err) => {
        const m = measure(q);
        const r = openingFromSurvey({ ...m, bd: m.bd + err });
        if (!r.ok) return;
        expect(isSelfIntersecting(r.points)).toBe(false);
        expect(r.maxResidual).toBeGreaterThan(0);
      }),
    );
  });

  it("angle rentrant en B (trémie en flèche) : retrouvé (relecture : refusé auparavant)", () => {
    const q = [
      { x: 0, y: 0 },
      { x: 1000, y: 500 },
      { x: 2000, y: 0 },
      { x: 1000, y: 2000 },
    ];
    const r = openingFromSurvey(measure(q));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expectCongruent(r.points, q, 1e-6);
    expect(r.consistent).toBe(true);
    expect(r.convex).toBe(false);
    expect(r.angles[1]).toBeGreaterThan(180);
    expect(signedArea(r.points)).toBeGreaterThan(0);
  });

  it("propriété : l'angle rentrant peut être en A, B, C ou D (étiquetage décalé)", () => {
    fc.assert(
      fc.property(quadArb, fc.integer({ min: 0, max: 3 }), (q0, k) => {
        const q = [0, 1, 2, 3].map((i) => q0[(i + k) % 4]!);
        const r = openingFromSurvey(measure(q));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expectCongruent(r.points, q, 1e-5);
        expect(r.consistent).toBe(true);
        expect(signedArea(r.points)).toBeGreaterThan(0);
      }),
    );
  });

  it("seuil de détection : une erreur isolée sur un petit côté passe inaperçue en deçà du seuil rendu", () => {
    // Relecture : 10 mm d'erreur sur BC (900) ne donnaient que 0,8 mm d'écart ajusté, et le
    // relevé était déclaré « cohérent » sans avertir que le contrôle est aveugle sur ce côté.
    const diag = Math.hypot(2800, 900);
    const m = { ab: 2800, bc: 900, cd: 2800, da: 900, ac: diag, bd: diag };
    const exact = openingFromSurvey(m);
    expect(exact.ok).toBe(true);
    if (!exact.ok) return;
    expect(exact.detectable.bc).toBeGreaterThan(40);
    expect(exact.detectable.bc).toBeGreaterThan(exact.detectable.ab);
    for (const k of SURVEY_MEASURES) {
      const t = exact.detectable[k];
      expect(Number.isFinite(t)).toBe(true);
      const below = openingFromSurvey({ ...m, [k]: m[k] + 0.8 * t });
      const above = openingFromSurvey({ ...m, [k]: m[k] + 1.25 * t });
      expect(below.ok && below.consistent, `${k} sous le seuil`).toBe(true);
      expect(above.ok && !above.consistent, `${k} au-dessus du seuil`).toBe(true);
    }
  });

  it("seuil exact sur un quadrilatère mal conditionné (ledger l. 264, QUESTIONS D6)", () => {
    // Seuil linéarisé : 64 mm sur CD, alors qu'une erreur de 1,33 × 64 mm restait « cohérente ».
    const P = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 165, y: 546 },
      { x: -1500, y: 546 },
    ];
    const m = measure(P);
    const exact = openingFromSurvey(m);
    expect(exact.ok).toBe(true);
    if (!exact.ok) return;
    for (const k of SURVEY_MEASURES) {
      const t = exact.detectable[k];
      expect(Number.isFinite(t), k).toBe(true);
      for (const sign of [1, -1]) {
        const below = openingFromSurvey({ ...m, [k]: m[k] + sign * 0.98 * t });
        expect(below.ok && below.consistent, `${k} ${sign * 0.98} × seuil`).toBe(true);
      }
      const above = [1, -1].map((sign) => openingFromSurvey({ ...m, [k]: m[k] + sign * 1.02 * t }));
      expect(
        above.some((r) => r.ok && !r.consistent),
        `${k} 1,02 × seuil`,
      ).toBe(true);
    }
  });

  it("angle mort : plus grande erreur isolée encore « cohérente », quel que soit son sens", () => {
    // Ledger l. 264 : sur CD, une erreur de 1,33 × 64 mm ≈ 85 mm restait « cohérente » ; le
    // seuil `detectable` (plus petit des deux sens, 55 mm) ne doit pas servir d'angle mort.
    const P = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 165, y: 546 },
      { x: -1500, y: 546 },
    ];
    const m = measure(P);
    const r = openingFromSurvey(m);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.undetectable.cd).toBeGreaterThan(80);
    for (const k of SURVEY_MEASURES) {
      const u = r.undetectable[k];
      expect(u, k).toBeGreaterThanOrEqual(r.detectable[k]);
      const below = [1, -1].map((s) => openingFromSurvey({ ...m, [k]: m[k] + s * 0.98 * u }));
      expect(
        below.some((x) => x.ok && x.consistent),
        `${k} 0,98 × angle mort`,
      ).toBe(true);
      for (const s of [1, -1]) {
        const above = openingFromSurvey({ ...m, [k]: m[k] + s * 1.02 * u });
        expect(!above.ok || !above.consistent, `${k} ${s * 1.02} × angle mort`).toBe(true);
      }
    }
  });

  it("propriété : le seuil de détection rendu est celui observé (erreur isolée, ± 5 %)", () => {
    fc.assert(
      fc.property(quadArb, fc.constantFrom(...SURVEY_MEASURES), (q, k) => {
        const m = measure(q);
        const exact = openingFromSurvey(m);
        if (!exact.ok) return;
        const t = exact.detectable[k];
        // Seuil exact (dichotomie sur l'ajustement non linéaire) : plus de restriction aux petites
        // erreurs, seule la borne « erreur de l'ordre de la plus grande mesure » est exclue.
        fc.pre(Number.isFinite(t));
        for (const sign of [1, -1]) {
          const below = openingFromSurvey({ ...m, [k]: m[k] + sign * 0.95 * t });
          if (below.ok) expect(below.consistent).toBe(true);
        }
        const above = [1, -1].map((sign) =>
          openingFromSurvey({ ...m, [k]: m[k] + sign * 1.05 * t }),
        );
        // Détectée : relevé incohérent, ou refusé (mesure devenue nulle ou négative, quadrilatère
        // impossible), comme dans `exactThreshold`.
        expect(above.some((r) => !r.ok || !r.consistent)).toBe(true);
      }),
      { numRuns: 60 },
    );
  });
});
