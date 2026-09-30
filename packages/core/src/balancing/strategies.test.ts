import { describe, expect, it } from "vitest";
import { computeLayout } from "../layout/layout.js";
import { makeProject } from "../layout/test-helpers.js";
import type { NosingLine } from "../model/derived.js";
import type { BalancingInput, BalancingZone } from "../model/plugins.js";
import { curvePointAt } from "../geom2d/curve.js";
import * as V from "../geom2d/vec.js";
import { M0_STRATEGY } from "./m0.js";
import { M1_STRATEGY, vProfileCollets } from "./m1.js";
import { M3_STRATEGY, zoneProfile } from "./m3.js";
import { evalProfile } from "./profile.js";
import { fr } from "../i18n.test-helpers.js";

/**
 * Cas synthétique de B §3.5 : nez tous les 250 mm sur Γ, hauteurs de 180 mm ; zone [1 ; 7]
 * (6 hauteurs) dont les collets fixes sont à σ = 0 et σ = 900 sur le jour. Les nez 0 et 8
 * donnent la pente des parties droites (180 / 250 = 0,72).
 */
function syntheticInput(
  params: Record<string, unknown> = {},
  ends: BalancingZone["ends"] = ["tangent", "tangent"],
): BalancingInput {
  const layout = computeLayout(makeProject({ width: 800, legs: [3000] }));
  const nosings: NosingLine[] = Array.from({ length: 9 }, (_, k) => ({
    index: k,
    s: 250 * k,
    p: V.vec(400, 250 * k),
    dir: V.vec(1, 0),
    q: V.vec(0, 0),
    r: V.vec(800, 0),
    sigmaInner: k <= 1 ? (k - 1) * 250 : k >= 7 ? 900 + (k - 7) * 250 : 150 * (k - 1),
    sigmaOuter: 250 * k,
    z: 180 * (k + 1),
    balanced: false,
  }));
  return {
    layout,
    nosings,
    zone: { turn: 0, from: 1, to: 7, collarSide: "left", ends },
    z: nosings.map((n) => n.z),
    rise: 180,
    going: 250,
    params,
  };
}

function colletsOf(input: BalancingInput, sigma: readonly number[]): number[] {
  const all = [input.nosings[1]!.sigmaInner, ...sigma, input.nosings[7]!.sigmaInner];
  return all.slice(1).map((s, i) => s - all[i]!);
}

describe("M3 (développement du limon)", () => {
  it("cas synthétique B §3.5, cubique : 184,6 / 138,7 / 126,7 / 126,7 / 138,7 / 184,6", () => {
    const input = syntheticInput({ variant: "cubic" });
    const sol = M3_STRATEGY.solve(input);
    expect(sol.kind).toBe("sigma");
    if (sol.kind !== "sigma") return;
    const c = colletsOf(input, sol.sigma);
    [184.6, 138.7, 126.7, 126.7, 138.7, 184.6].forEach((v, i) => expect(c[i]).toBeCloseTo(v, 1));
    expect(M3_STRATEGY.estimateMinCollet!(input)).toBeCloseTo(125, 6);
  });

  it("cas synthétique B §3.5, quintique : 202,6 / 133,7 / 113,8 / …", () => {
    const input = syntheticInput({ variant: "quintic" });
    const sol = M3_STRATEGY.solve(input);
    if (sol.kind !== "sigma") throw new Error(sol.kind);
    const c = colletsOf(input, sol.sigma);
    [202.6, 133.7, 113.8, 113.8, 133.7, 202.6].forEach((v, i) => expect(c[i]).toBeCloseTo(v, 1));
    expect(M3_STRATEGY.estimateMinCollet!(input)).toBeCloseTo(111.1, 1);
  });

  it("extrémité libre : collets monotones depuis l'extrémité libre", () => {
    const input = syntheticInput({ variant: "cubic" }, ["free", "tangent"]);
    const sol = M3_STRATEGY.solve(input);
    if (sol.kind !== "sigma") throw new Error(sol.kind);
    const c = colletsOf(input, sol.sigma);
    for (let i = 0; i + 1 < c.length; i++) expect(c[i + 1]!).toBeGreaterThan(c[i]!);
    expect(c.reduce((a, b) => a + b, 0)).toBeCloseTo(900, 9);
  });

  it("extrémité tangente : raccord à la pente développée Δz/Δσ de la marche voisine (K4)", () => {
    // Marche voisine dans la partie tournante : 180 mm de hauteur pour 100 mm de jour (et non
    // 250 mm de giron) ; F doit partir avec la pente 1,8 du limon développé, pas h/g = 0,72.
    const input = syntheticInput({ variant: "cubic" });
    const bent = {
      ...input,
      nosings: input.nosings.map((n) => (n.index === 0 ? { ...n, sigmaInner: -100 } : n)),
    };
    const built = zoneProfile(bent);
    if ("reason" in built) throw new Error(fr(built.reason));
    expect(evalProfile(built.profile, 0, 1)).toBeCloseTo(1.8, 12);
    expect(evalProfile(built.profile, 1, 1)).toBeCloseTo(0.72, 12);
    // Partie droite : Δσ = Δs, on retrouve m = h/g.
    const straight = zoneProfile(input);
    if ("reason" in straight) throw new Error(fr(straight.reason));
    expect(evalProfile(straight.profile, 0, 1)).toBeCloseTo(0.72, 12);
  });

  it("échec si F n'est pas strictement croissante (jour beaucoup trop long)", () => {
    const input = syntheticInput({ variant: "cubic", endSlope: 0.72 });
    const long = {
      ...input,
      nosings: input.nosings.map((n) => (n.index === 7 ? { ...n, sigmaInner: 10000 } : n)),
    };
    expect(M3_STRATEGY.solve(long).kind).toBe("fail");
  });
});

describe("M1 (profil de collets en V)", () => {
  it("exemple du relecteur : N = 6, L = 900, g = 250 → 200/150/100/100/150/200", () => {
    const input = syntheticInput({ cornerSigma: 450 });
    const sol = M1_STRATEGY.solve(input);
    if (sol.kind !== "sigma") throw new Error(sol.kind);
    const c = colletsOf(input, sol.sigma);
    [200, 150, 100, 100, 150, 200].forEach((v, i) => expect(c[i]).toBeCloseTo(v, 9));
    expect(M1_STRATEGY.estimateMinCollet!(input)).toBeCloseTo(100, 9);
  });

  it("cas symétrique impair : T = (p + 1)², δ = (N·g − L)/T", () => {
    const c = vProfileCollets(5, 900, 250, 0.5);
    if (!Array.isArray(c)) throw new Error(fr(c.reason));
    const delta = (5 * 250 - 900) / 9;
    [1, 2, 3, 2, 1].forEach((w, i) => expect(c[i]).toBeCloseTo(250 - delta * w, 9));
  });

  it("cas asymétrique : somme = L, V dont l'apex suit le point d'angle", () => {
    const c = vProfileCollets(6, 900, 250, 0.25);
    if (!Array.isArray(c)) throw new Error(fr(c.reason));
    expect(c.reduce((a, b) => a + b, 0)).toBeCloseTo(900, 9);
    const iMin = c.indexOf(Math.min(...c));
    expect(iMin).toBeLessThanOrEqual(2);
    for (let i = 0; i < iMin; i++) expect(c[i + 1]!).toBeLessThanOrEqual(c[i]! + 1e-9);
    for (let i = iMin; i + 1 < c.length; i++)
      expect(c[i + 1]!).toBeGreaterThanOrEqual(c[i]! - 1e-9);
  });

  it("extrémité libre : palier de collets égaux jusqu'à l'apex ; deux libres = équipartition", () => {
    const c = vProfileCollets(6, 900, 250, 0.5, ["free", "tangent"]);
    if (!Array.isArray(c)) throw new Error(fr(c.reason));
    expect(c.reduce((a, b) => a + b, 0)).toBeCloseTo(900, 9);
    expect(c[0]).toBeCloseTo(c[1]!, 9);
    expect(c[1]).toBeCloseTo(c[2]!, 9);
    for (let i = 2; i + 1 < c.length; i++) expect(c[i + 1]!).toBeGreaterThan(c[i]!);
    expect(vProfileCollets(6, 900, 250, 0.5, ["free", "free"])).toEqual(Array(6).fill(150));
  });

  it("jour plus long que nécessaire : équipartition ; jour trop court : échec", () => {
    const eq = vProfileCollets(4, 1200, 250, 0.5);
    expect(eq).toEqual([300, 300, 300, 300]);
    expect(Array.isArray(vProfileCollets(6, 100, 250, 0.5))).toBe(false);
  });
});

describe("M0 (rayonnant)", () => {
  it("les lignes de nez passent par le centre de l'arc de Γ", () => {
    const layout = computeLayout(
      makeProject({ width: 800, legs: [2000, 2000], inner: { kind: "arc", radius: 200 } }),
    );
    const turn = layout.turns[0]!;
    const s = [turn.sStart - 100, (turn.sStart + turn.sEnd) / 2, turn.sEnd + 100];
    const nosings = [turn.sStart - 300, ...s, turn.sEnd + 300].map((sk, k): NosingLine => ({
      index: k,
      s: sk,
      p: curvePointAt(layout.walkline, sk),
      dir: V.vec(1, 0),
      q: V.vec(0, 0),
      r: V.vec(0, 0),
      sigmaInner: 0,
      sigmaOuter: 0,
      z: 0,
      balanced: false,
    }));
    const sol = M0_STRATEGY.solve({
      layout,
      nosings,
      zone: { turn: 0, from: 0, to: 4, collarSide: "left", ends: ["tangent", "tangent"] },
      z: nosings.map(() => 0),
      rise: 180,
      going: 250,
      params: {},
    });
    if (sol.kind !== "phi") throw new Error(sol.kind);
    const center = V.vec(-200, 1000);
    sol.phi.forEach((phi, i) => {
      const p = nosings[i + 1]!.p;
      const d = V.fromAngle(phi);
      // Le centre est sur la droite (P, d), du côté intérieur.
      expect(Math.abs(V.cross(d, V.sub(center, p)))).toBeLessThan(1e-9);
      expect(V.dot(d, V.sub(center, p))).toBeLessThan(0);
    });
  });
});
