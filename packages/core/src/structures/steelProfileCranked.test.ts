/**
 * Câblage du limon coudé (`steelProfileCranked.ts`, sous-lot K2b) : décision par face et repli
 * sur la barre droite (K-Q12, K-Q13), en cas chiffrés et en propriété ; contour de l'âme, chemin
 * du balayage (solide valide, section orientée vers `into`), écarts d'onglet au bout d'aile
 * (CK13), cornière au coin du mur (K-Q4, K2e : groupes, cornière exigée, passes et garde-fou du
 * plan) et remarques traduites, sur des faces synthétiques.
 */
import { createTranslator, msg } from "@blondel/i18n";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { findSection, sectionPerimeter, sectionsOf } from "../catalog/sections.js";
import { signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { Vec2 } from "../model/primitives.js";
import { solidProblem } from "../parts/solidChecks.js";
import { PiecewiseLinear, clipHalfPlane } from "./geom.js";
import {
  DEFAULT_KNEE_SETTINGS,
  bearingSectionOf,
  faceHeightNeed,
  fitInWebPolyline,
  profileBearings,
  riveFns,
  supportHeightNeed,
  type BearingFace,
  type BearingIssue,
  type FaceBearing,
} from "./profileBearing.js";
import type { SteelStringerFace } from "./steelFlat.js";
import {
  chooseCornerRequired,
  cornerAngleRemovedNote,
  cornerSupportGroups,
  cornerSupportKey,
  crankedSectionPlan,
  componentIndexAt,
  crankedAxialEnds,
  crankedBearingFace,
  crankedComponentMark,
  crankedComponentSpecs,
  crankedFallbackNote,
  crankedJigItems,
  crankedJigNote,
  crankedMiterItems,
  crankedNote,
  crankedOutline,
  crankedSingleNote,
  crankedSweepPath,
  decideCrankedFace,
  forceLandingChains,
  kneeWeldLength,
  isChordEquivalent,
  landingRefusalMessage,
  landingRefusalReasonMessage,
  type CornerCandidate,
  type CornerGroup,
  type CrankedSupport,
  type CrankedDecisionInput,
  type CrankedFacePlan,
  type CrankedFallbackReason,
  type CrankedMiterStringer,
  type LandingRefusalReason,
} from "./steelProfileCranked.js";

const RUNS = Number(process.env["STEPPING_RUNS"] ?? 200);
const UPN180 = findSection("UPN 180")!;

/** Face synthétique de `steel-profile` (axe X ou Y, côté mur), longueur L, extrémités données. */
function faceOf(
  id: string,
  sigmaA: number,
  L: number,
  start: SteelStringerFace["start"],
  end: SteelStringerFace["end"],
  axis: "x" | "y",
): SteelStringerFace {
  const dir = axis === "x" ? { x: 1, y: 0 } : { x: 0, y: 1 };
  const a = axis === "x" ? { x: 0, y: 0 } : { x: 1500, y: 0 };
  return {
    id,
    mark: id.toUpperCase(),
    name: msg("structure.steelProfile.label"),
    side: "outer",
    leg: axis === "x" ? 0 : 1,
    a,
    dir,
    // Hors emprise utile : à droite du sens de montée (côté mur d'un quart tournant à gauche).
    into: { x: dir.y, y: -dir.x },
    sigmaA,
    faceLength: L,
    start,
    end,
  };
}

/** Quart tournant synthétique côté mur : deux faces de 1 500 mm, nez tous les 250 mm. */
function quarter() {
  const knots = Array.from({ length: 12 }, (_, k) => ({ x: 100 + 250 * k, y: 175 * (k + 1) }));
  const pitch = new PiecewiseLinear(knots);
  const fa = faceOf("le1", 0, 1500, "floor", "corner", "x");
  const fb = faceOf("le2", 1500, 1500, "corner", "arrival", "y");
  const pres = [
    { face: fa, uLo: 50, uHi: 1500, line: { u0: 100, z0: 175, slope: 0.7 } },
    { face: fb, uLo: 0, uHi: 2850 - 1500, line: { u0: 100, z0: 1400, slope: 0.7 } },
  ];
  const faces: BearingFace[] = pres.map(crankedBearingFace);
  const res = profileBearings({
    faces,
    pitch: { inner: pitch, outer: pitch },
    upperOffset: 50,
    section: bearingSectionOf(UPN180),
    settings: DEFAULT_KNEE_SETTINGS,
  });
  const get = (id: string): FaceBearing => res.faces.find((f) => f.faceId === id)!;
  return { pres, res, get, pitch };
}

/** Face droite (une seule pente) : sa ligne d'appui est la corde. */
function straight() {
  const knots = Array.from({ length: 10 }, (_, k) => ({ x: 100 + 280 * k, y: 175 * (k + 1) }));
  const pitch = new PiecewiseLinear(knots);
  const f = faceOf("le1", 0, 3000, "floor", "arrival", "x");
  const pre = {
    face: f,
    uLo: 50,
    uHi: 100 + 280 * 9,
    line: { u0: 100, z0: 175, slope: 175 / 280 },
  };
  const res = profileBearings({
    faces: [crankedBearingFace(pre)],
    pitch: { inner: pitch, outer: pitch },
    upperOffset: 50,
    section: bearingSectionOf(UPN180),
    settings: DEFAULT_KNEE_SETTINGS,
  });
  return { pre, fb: res.faces[0]! };
}

describe("decideCrankedFace — priorités (K-Q12, K-Q13)", () => {
  const q = quarter();
  const fb = q.get("le2");
  const base: CrankedDecisionInput = {
    fb,
    issues: [],
    line: q.pres[1]!.line,
    bentNeed: 160,
    bentLost: [],
    chordNeed: 200,
    chordLost: [],
    sectionHeight: 180,
  };
  const issue = (kind: BearingIssue["kind"]): BearingIssue => {
    switch (kind) {
      case "cutsCross":
      case "shortSegment":
        return { kind, faceId: "le2", u0: 0, shortest: -3 };
      case "noseAboveRive":
        return { kind, faceId: "le2", u: 10, excess: 62 };
      case "steepSegment":
        return { kind, faceId: "le2", u0: 0, planLength: 17, alpha: 1.5 };
      case "tooSteepSegment":
        return { kind, faceId: "le2", u0: 0, alpha: 1.4, maxAngle: (75 * Math.PI) / 180 };
      default:
        return { kind: "emptyWindow", faceId: "le2" };
    }
  };

  it("limon coudé quand rien ne s'y oppose ; ligne absente → fenêtre vide", () => {
    expect(fb.segments.length).toBeGreaterThan(1);
    expect(decideCrankedFace(base)).toEqual({ mode: "nosing" });
    expect(decideCrankedFace({ ...base, fb: undefined })).toEqual({
      mode: "chord",
      fallback: { kind: "emptyWindow" },
    });
  });

  it("face à une seule pente (CK7) : barre droite sans remarque, avant toute autre règle", () => {
    const s = straight();
    expect(isChordEquivalent(s.fb, s.pre.line)).toBe(true);
    expect(
      decideCrankedFace({
        ...base,
        fb: s.fb,
        line: s.pre.line,
        issues: [issue("noseAboveRive")],
        bentNeed: 1e9,
      }),
    ).toEqual({ mode: "chord" });
    // Même face, corde décalée : plus équivalente.
    expect(isChordEquivalent(s.fb, { ...s.pre.line, z0: s.pre.line.z0 + 1e-6 })).toBe(false);
  });

  it("constats bloquants dans l'ordre emptyWindow, cutsCross, shortSegment, noseAboveRive, steepSegment, tooSteepSegment", () => {
    const d = (kinds: BearingIssue["kind"][]) =>
      decideCrankedFace({ ...base, issues: kinds.map(issue) }).fallback?.kind;
    expect(d(["steepSegment", "noseAboveRive"])).toBe("noseAboveRive");
    expect(d(["steepSegment", "shortSegment", "cutsCross"])).toBe("cutsCross");
    expect(d(["steepSegment", "shortSegment"])).toBe("shortSegment");
    expect(d(["steepSegment"])).toBe("steepSegment");
    // Angle maximal de tronçon (K-Q35, sous-lot K2h) : dernier, comme un tronçon trop court.
    expect(d(["tooSteepSegment", "steepSegment"])).toBe("steepSegment");
    expect(d(["tooSteepSegment", "shortSegment"])).toBe("shortSegment");
    expect(d(["tooSteepSegment"])).toBe("tooSteepSegment");
    expect(decideCrankedFace({ ...base, issues: [issue("tooSteepSegment")] }).fallback).toEqual({
      kind: "tooSteepSegment",
      alpha: 1.4,
      maxAngle: (75 * Math.PI) / 180,
    });
    expect(d(["emptyWindow", "cutsCross"])).toBe("emptyWindow");
    // Constats non bloquants : sans effet.
    expect(
      decideCrankedFace({
        ...base,
        issues: [
          { kind: "levelCoversFace", faceId: "le2" },
          { kind: "cornerMerged", faceIds: ["le1", "le2"] },
        ],
      }),
    ).toEqual({ mode: "nosing" });
    expect(decideCrankedFace({ ...base, issues: [issue("noseAboveRive")] }).fallback).toEqual({
      kind: "noseAboveRive",
      excess: 62,
    });
  });

  it("marche sans appui : seulement celles que la barre droite porte", () => {
    expect(decideCrankedFace({ ...base, bentLost: [4, 3, 4], chordLost: [4] }).fallback).toEqual({
      kind: "lostSupport",
      treads: [3],
    });
    expect(decideCrankedFace({ ...base, bentLost: [4], chordLost: [4, 5] })).toEqual({
      mode: "nosing",
    });
  });

  it("plus d'âme que la barre droite et que la section essayée → repli ; logé dans la section → coudé (K-Q14)", () => {
    expect(
      decideCrankedFace({ ...base, bentNeed: 250, chordNeed: 200, sectionHeight: 220 }).fallback,
    ).toEqual({ kind: "heavier", bent: 250, chord: 200 });
    expect(
      decideCrankedFace({ ...base, bentNeed: 210, chordNeed: 200, sectionHeight: 220 }),
    ).toEqual({ mode: "nosing" });
    expect(
      decideCrankedFace({ ...base, bentNeed: Infinity, chordNeed: 200, sectionHeight: 300 })
        .fallback?.kind,
    ).toBe("heavier");
    // Égalité à la précision de la dichotomie : coudé.
    expect(
      decideCrankedFace({ ...base, bentNeed: 200 + 5e-7, chordNeed: 200, sectionHeight: 100 }),
    ).toEqual({ mode: "nosing" });
  });

  it("propriété : une face coudée n'a aucun constat bloquant, ne perd aucune marche portée et loge son besoin", () => {
    const kinds: BearingIssue["kind"][] = [
      "cutsCross",
      "shortSegment",
      "noseAboveRive",
      "steepSegment",
      "tooSteepSegment",
      "levelCoversFace",
    ];
    fc.assert(
      fc.property(
        fc.record({
          issues: fc.subarray(kinds),
          bentNeed: fc.oneof(fc.double({ min: 0, max: 500, noNaN: true }), fc.constant(Infinity)),
          chordNeed: fc.double({ min: 0, max: 500, noNaN: true }),
          h: fc.integer({ min: 80, max: 400 }),
          bentLost: fc.uniqueArray(fc.integer({ min: 1, max: 12 }), { maxLength: 4 }),
          chordLost: fc.uniqueArray(fc.integer({ min: 1, max: 12 }), { maxLength: 4 }),
        }),
        (r) => {
          const d = decideCrankedFace({
            ...base,
            issues: r.issues.map((k) =>
              k === "levelCoversFace" ? { kind: k, faceId: "le2" } : issue(k),
            ),
            bentNeed: r.bentNeed,
            chordNeed: r.chordNeed,
            sectionHeight: r.h,
            bentLost: r.bentLost,
            chordLost: r.chordLost,
          });
          // Besoin retenu par le plan pour cette décision.
          const need = d.mode === "nosing" ? r.bentNeed : r.chordNeed;
          expect(need).toBeLessThanOrEqual(Math.max(r.chordNeed + 1e-6, r.h + 1e-9));
          const blocking = r.issues.filter((k) => k !== "levelCoversFace");
          const lost = r.bentLost.filter((t) => !r.chordLost.includes(t));
          // Tolérances de la dichotomie (1e-6) et de la section (1e-9).
          const housed = r.bentNeed <= r.chordNeed + 1e-6 || r.bentNeed <= r.h + 1e-9;
          if (d.mode === "nosing") {
            expect(blocking).toEqual([]);
            expect(lost).toEqual([]);
          } else {
            expect(d.fallback).toBeDefined();
          }
          // Réciproque : rien ne s'y oppose → limon coudé.
          if (blocking.length === 0 && lost.length === 0 && housed) {
            expect(d).toEqual({ mode: "nosing" });
          }
          // Priorités : constat bloquant, puis marche perdue, puis besoin d'âme.
          if (blocking.length > 0) {
            expect(blocking).toContain(d.fallback?.kind);
          } else if (lost.length > 0) {
            expect(d.fallback).toEqual({
              kind: "lostSupport",
              treads: [...lost].sort((a, b) => a - b),
            });
          } else if (!housed) {
            expect(d.fallback?.kind).toBe("heavier");
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});

describe("géométrie du limon coudé (contour, balayage, onglets)", () => {
  const q = quarter();

  it("contour de l'âme : polygone simple, rives monotones égales à `riveFns`", () => {
    for (const p of q.pres) {
      const fb = q.get(p.face.id);
      const r = riveFns(fb);
      const out = crankedOutline(fb, p.uLo, p.uHi);
      expect(Math.abs(signedArea(out))).toBeGreaterThan(0);
      const half = out.findIndex((v, i) => i > 0 && v.x === out[i - 1]!.x);
      const lower = out.slice(0, half);
      const upper = out.slice(half).reverse();
      for (const pts of [lower, upper]) {
        for (let i = 1; i < pts.length; i++) expect(pts[i]!.x).toBeGreaterThan(pts[i - 1]!.x);
      }
      for (const v of lower) expect(v.y).toBeCloseTo(r.lower(v.x), 6);
      for (const v of upper) expect(v.y).toBeCloseTo(r.upper(v.x), 6);
      for (const v of lower) expect(r.upper(v.x) - v.y).toBeGreaterThan(UPN180.h - 1e-6);
    }
  });

  it("balayage : solide valide, section orientée vers `into` au premier tronçon, coupe de jarret à l'onglet", () => {
    for (const p of q.pres) {
      const fb = q.get(p.face.id);
      expect(fb.knees.length).toBeGreaterThan(0);
      const outline = crankedOutline(fb, p.uLo, p.uHi);
      const path = crankedSweepPath(fb, p.face, outline, p.uLo, p.uHi);
      expect(path).toHaveLength(fb.knees.length + 2);
      const section = {
        outer: [
          { x: 0, y: 0 },
          { x: UPN180.b, y: 0 },
          { x: UPN180.b, y: UPN180.h },
          { x: 0, y: UPN180.h },
        ],
        holes: [],
      };
      expect(solidProblem({ kind: "sweep", path, section })).toBeUndefined();
      // Repère `upright` : v = verticale projetée, u = v × t doit pointer vers `into`.
      const t = {
        x: path[1]!.x - path[0]!.x,
        y: path[1]!.y - path[0]!.y,
        z: path[1]!.z - path[0]!.z,
      };
      const n = Math.hypot(t.x, t.y, t.z);
      const tn = { x: t.x / n, y: t.y / n, z: t.z / n };
      const v = { x: -tn.z * tn.x, y: -tn.z * tn.y, z: 1 - tn.z * tn.z };
      const u = {
        x: v.y * tn.z - v.z * tn.y,
        y: v.z * tn.x - v.x * tn.z,
        z: v.x * tn.y - v.y * tn.x,
      };
      expect(u.x * p.face.into.x + u.y * p.face.into.y).toBeGreaterThan(0);
      // Sommets intérieurs du chemin : sommets bas des jarrets (bissectrices, CK4).
      const inner = path.slice(1, -1).map((pt) => ({
        u: (pt.x - p.face.a.x) * p.face.dir.x + (pt.y - p.face.a.y) * p.face.dir.y,
        z: pt.z,
      }));
      const sorted = [...inner].sort((a, b) => a.u - b.u);
      sorted.forEach((pt, i) => {
        expect(pt.u).toBeCloseTo(fb.knees[i]!.lower.x, 6);
        expect(pt.z).toBeCloseTo(fb.knees[i]!.lower.y, 6);
      });
    }
  });

  it("onglet au bout d'aile : nul entre deux limons coudés, ouvert face à une barre droite", () => {
    const strs: CrankedMiterStringer[] = q.pres.map((p) => ({
      ...p,
      bearing: q.get(p.face.id),
    }));
    const label = () => msg("structure.steelProfile.label");
    const closed = crankedMiterItems(strs, UPN180, 50, label);
    expect(closed).toHaveLength(1);
    expect(closed[0]!.value).toBeLessThan(1e-6);
    expect(closed[0]!.partId).toBe("le2");
    const mixed = crankedMiterItems(
      [strs[0]!, { ...strs[1]!, bearing: undefined }],
      UPN180,
      50,
      label,
    );
    expect(mixed[0]!.value).toBeGreaterThan(1);
    // `bentOnly` : le coin mixte reste mesuré au bout d'aile ; deux barres droites sont laissées
    // à la mesure de `chord` (ligne de l'âme) par le plugin.
    const straight = strs.map((x) => ({ ...x, bearing: undefined }));
    expect(crankedMiterItems(straight, UPN180, 50, label, true)).toEqual([]);
    expect(
      crankedMiterItems([strs[0]!, { ...strs[1]!, bearing: undefined }], UPN180, 50, label, true),
    ).toEqual(mixed);
  });
});

describe("raccords de palier : coudé forcé, sinon refus (K-Q27, K2f2)", () => {
  const q = quarter();
  const fbA = q.get("le1");
  const fbB = q.get("le2");
  const bearings = new Map<string, FaceBearing>([
    ["a", fbA],
    ["b", fbB],
    ["c", fbB],
    ["w", fbA],
    ["x", fbA],
  ]);
  const bearingOf = (id: string): FaceBearing | undefined => bearings.get(id);
  const bent = (id: string, need = 170): CrankedFacePlan => ({
    faceId: id,
    mode: "nosing",
    bearing: bearings.get(id)!,
    need,
    chordNeed: 180,
    bentNeed: need,
  });
  const folded = (
    id: string,
    fallback: CrankedFallbackReason,
    bentNeed = 190,
  ): CrankedFacePlan => ({
    faceId: id,
    mode: "chord",
    need: 186.7,
    chordNeed: 186.7,
    bentNeed,
    fallback,
  });
  const heavier = { kind: "heavier", bent: 190, chord: 186.7 } as const;
  const plans = (...ps: CrankedFacePlan[]) => new Map(ps.map((p) => [p.faceId, p]));
  const LIMIT = { h: 260, section: "UPN 260" };

  it("chaîne toute coudée : inchangée, rien de forcé, aucun refus", () => {
    const faces = plans(bent("a"), bent("b"));
    const r = forceLandingChains(faces, [["a", "b"]], bearingOf, LIMIT);
    expect(r.forced).toEqual([]);
    expect(r.refusals).toEqual([]);
    expect(r.faces.get("a")).toBe(faces.get("a"));
    expect(r.faces.get("b")).toBe(faces.get("b"));
  });

  it("repli `heavier` fini sous la limite : forcé coudé (besoin coudé, ligne coudée, repli noté, plus de repli)", () => {
    const r = forceLandingChains(
      plans(bent("a"), folded("b", heavier)),
      [["a", "b"]],
      bearingOf,
      LIMIT,
    );
    expect(r.forced).toEqual(["b"]);
    expect(r.refusals).toEqual([]);
    const b = r.faces.get("b")!;
    expect(b.mode).toBe("nosing");
    expect(b.need).toBe(190);
    expect(b.bearing).toBe(fbB);
    expect(b.landingForced).toEqual(heavier);
    expect(b.fallback).toBeUndefined();
    expect("fallback" in b).toBe(false);
    expect(b.chordNeed).toBe(186.7);
  });

  it("sans limite (noyau seul) : forcé même au-delà de toute section", () => {
    const big = { kind: "heavier", bent: 9000, chord: 186.7 } as const;
    const r = forceLandingChains(plans(bent("a"), folded("b", big, 9000)), [["a", "b"]], bearingOf);
    expect(r.forced).toEqual(["b"]);
    expect(r.faces.get("b")!.need).toBe(9000);
  });

  it("section imposée (relecture K2f2) : besoin coudé au-delà de la section imposée → refus `beyondSection`, jamais forcé", () => {
    const imposed = { h: 180, section: "UPN 180", imposed: true };
    const over = { kind: "heavier", bent: 186.9, chord: 186.7 } as const;
    const r = forceLandingChains(
      plans(bent("a"), folded("b", over, 186.9)),
      [["a", "b"]],
      bearingOf,
      imposed,
    );
    expect(r.forced).toEqual([]);
    expect(r.refusals).toEqual([
      {
        chain: ["a", "b"],
        faceId: "b",
        reason: { kind: "beyondSection", bent: 186.9, section: "UPN 180", h: 180 },
      },
    ]);
  });

  it("repli `heavier` au-delà de la plus haute section : refus `beyondCatalog` ; besoin infini : refus avec la raison du repli", () => {
    const over = { kind: "heavier", bent: 281.5, chord: 249.9 } as const;
    const r1 = forceLandingChains(
      plans(bent("a"), folded("b", over, 281.5)),
      [["a", "b"]],
      bearingOf,
      LIMIT,
    );
    expect(r1.forced).toEqual([]);
    expect(r1.refusals).toEqual([
      {
        chain: ["a", "b"],
        faceId: "b",
        reason: { kind: "beyondCatalog", bent: 281.5, section: "UPN 260", h: 260 },
      },
    ]);
    expect(r1.faces.get("b")!.mode).toBe("chord");
    const inf = { kind: "heavier", bent: Infinity, chord: 249.9 } as const;
    const r2 = forceLandingChains(
      plans(bent("a"), folded("b", inf, Infinity)),
      [["a", "b"]],
      bearingOf,
    );
    expect(r2.refusals).toEqual([{ chain: ["a", "b"], faceId: "b", reason: inf }]);
  });

  it("constats bloquants et marche perdue : refus avec la raison du repli ; ligne coudée absente : `emptyWindow`", () => {
    const blocking: CrankedFallbackReason[] = [
      { kind: "emptyWindow" },
      { kind: "cutsCross", shortest: -3.2 },
      { kind: "shortSegment", shortest: 29.5 },
      { kind: "noseAboveRive", excess: 62 },
      { kind: "steepSegment", alpha: 1.508 },
      { kind: "tooSteepSegment", alpha: 1.42, maxAngle: (75 * Math.PI) / 180 },
      { kind: "lostSupport", treads: [9] },
    ];
    for (const reason of blocking) {
      const r = forceLandingChains(
        plans(bent("a"), folded("b", reason)),
        [["a", "b"]],
        bearingOf,
        LIMIT,
      );
      expect(r.forced, reason.kind).toEqual([]);
      expect(r.refusals, reason.kind).toEqual([{ chain: ["a", "b"], faceId: "b", reason }]);
    }
    // `heavier` fini mais aucune ligne coudée pour la face : refus `emptyWindow`.
    const r = forceLandingChains(
      plans(bent("a"), folded("y", heavier)),
      [["a", "y"]],
      bearingOf,
      LIMIT,
    );
    expect(r.refusals).toEqual([
      { chain: ["a", "y"], faceId: "y", reason: { kind: "emptyWindow" } },
    ]);
    // Face absente du plan : refus `emptyWindow`.
    const r0 = forceLandingChains(plans(bent("a")), [["a", "z"]], bearingOf, LIMIT);
    expect(r0.refusals).toEqual([
      { chain: ["a", "z"], faceId: "z", reason: { kind: "emptyWindow" } },
    ]);
  });

  it("chaîne sans limon coudé, tous repliés (K-Q31, K2d) : `heavier` sous la limite forcés, autre repli refusé `straight`", () => {
    const nose = { kind: "noseAboveRive", excess: 23 } as const;
    // [noseAboveRive, heavier ≤ limite] : refus `straight` du premier, forçage du second.
    const r1 = forceLandingChains(
      plans(folded("a", nose), folded("b", heavier)),
      [["a", "b"]],
      bearingOf,
      LIMIT,
    );
    expect(r1.forced).toEqual(["b"]);
    expect(r1.refusals).toEqual([{ chain: ["a", "b"], faceId: "a", reason: nose, straight: true }]);
    expect(r1.faces.get("b")!.mode).toBe("nosing");
    // [heavier, heavier] sous la limite : deux forcés, aucun refus (la section monte).
    const r2 = forceLandingChains(
      plans(folded("a", heavier), folded("b", heavier)),
      [["a", "b"]],
      bearingOf,
      LIMIT,
    );
    expect(r2.forced).toEqual(["a", "b"]);
    expect(r2.refusals).toEqual([]);
    expect([...r2.faces.values()].every((fp) => fp.mode === "nosing" && !fp.fallback)).toBe(true);
    // Section imposée trop basse : `beyondSection`, marqué `straight`.
    const imposed = { h: 180, section: "UPN 180", imposed: true };
    const over = { kind: "heavier", bent: 186.9, chord: 186.7 } as const;
    const r3 = forceLandingChains(
      plans(folded("a", over, 186.9), folded("b", heavier)),
      [["a", "b"]],
      bearingOf,
      imposed,
    );
    expect(r3.refusals).toEqual([
      {
        chain: ["a", "b"],
        faceId: "a",
        reason: { kind: "beyondSection", bent: 186.9, section: "UPN 180", h: 180 },
        straight: true,
      },
      {
        chain: ["a", "b"],
        faceId: "b",
        reason: { kind: "beyondSection", bent: 190, section: "UPN 180", h: 180 },
        straight: true,
      },
    ]);
    // Chaîne avec un limon coudé : refus K-Q27, jamais marqué `straight`.
    const r4 = forceLandingChains(
      plans(bent("a"), folded("b", nose)),
      [["a", "b"]],
      bearingOf,
      LIMIT,
    );
    expect(r4.refusals).toEqual([{ chain: ["a", "b"], faceId: "b", reason: nose }]);
  });

  it("chaîne de faces à une seule pente (CK7, aucun repli) : inchangée, ni forçage ni refus", () => {
    const single = (id: string): CrankedFacePlan => ({
      faceId: id,
      mode: "chord",
      need: 186.7,
      chordNeed: 186.7,
      bentNeed: 186.7,
    });
    const faces = plans(single("a"), single("b"));
    const r = forceLandingChains(faces, [["a", "b"]], bearingOf, LIMIT);
    expect(r.forced).toEqual([]);
    expect(r.refusals).toEqual([]);
    expect(r.faces.get("a")).toBe(faces.get("a"));
    expect(r.faces.get("b")).toBe(faces.get("b"));
  });

  it("propriété (K-Q27, K-Q31) : après décision, une chaîne sans refus n'a aucun membre replié ; une chaîne qui contient un repli est toute coudée (CK7 compris) ou refusée", () => {
    const reasonArb: fc.Arbitrary<CrankedFallbackReason> = fc.oneof(
      fc.constant<CrankedFallbackReason>({ kind: "emptyWindow" }),
      fc.constant<CrankedFallbackReason>({ kind: "noseAboveRive", excess: 12 }),
      fc.constant<CrankedFallbackReason>({ kind: "steepSegment", alpha: 1.5 }),
      fc.constant<CrankedFallbackReason>({ kind: "lostSupport", treads: [3] }),
      fc
        .double({ min: 150, max: 320, noNaN: true })
        .map((bent): CrankedFallbackReason => ({ kind: "heavier", bent, chord: 186.7 })),
      fc.constant<CrankedFallbackReason>({ kind: "heavier", bent: Infinity, chord: 186.7 }),
    );
    const memberArb = fc.oneof(
      fc.constant<"bent" | "single">("bent"),
      fc.constant<"bent" | "single">("single"),
      reasonArb,
    );
    fc.assert(
      fc.property(
        fc.array(memberArb, { minLength: 2, maxLength: 4 }),
        fc.boolean(),
        (members, imposed) => {
          const ids = members.map((_, i) => ["a", "b", "c", "w"][i]!);
          const faces = plans(
            ...members.map((m, i): CrankedFacePlan => {
              const id = ids[i]!;
              if (m === "bent") return bent(id);
              if (m === "single")
                return {
                  faceId: id,
                  mode: "chord",
                  need: 186.7,
                  chordNeed: 186.7,
                  bentNeed: 186.7,
                };
              return folded(id, m, m.kind === "heavier" ? m.bent : 190);
            }),
          );
          const limit = imposed ? { h: 200, section: "UPN 200", imposed: true } : LIMIT;
          const r = forceLandingChains(faces, [ids], bearingOf, limit);
          const hadFallback = members.some((m) => typeof m !== "string");
          const hadBent = members.includes("bent");
          for (const x of r.refusals) expect(x.straight === true).toBe(!hadBent);
          if (r.refusals.length === 0) {
            for (const id of ids) expect(r.faces.get(id)!.fallback).toBeUndefined();
          }
          // Chaîne livrée : chaque repli a été forcé coudé, et seul un repli `heavier` peut l'être.
          if (hadFallback && r.refusals.length === 0) {
            members.forEach((m, i) => {
              if (typeof m === "string") return;
              expect(m.kind).toBe("heavier");
              expect(r.forced).toContain(ids[i]);
            });
          }
          if (!hadFallback) {
            expect(r.refusals).toEqual([]);
            expect(r.forced).toEqual([]);
          }
        },
      ),
      { numRuns: RUNS, seed: 31 },
    );
  });

  it("face à une seule pente (CK7, barre droite sans repli, ligne confondue) : compatible avec un voisin coudé, ni forcée ni refusée", () => {
    const single: CrankedFacePlan = {
      faceId: "b",
      mode: "chord",
      need: 186.7,
      chordNeed: 186.7,
      bentNeed: 186.7,
    };
    const faces = plans(bent("a"), single, folded("c", heavier));
    const r = forceLandingChains(faces, [["a", "b", "c"]], bearingOf, LIMIT);
    expect(r.refusals).toEqual([]);
    expect(r.forced).toEqual(["c"]);
    expect(r.faces.get("b")).toBe(single);
  });

  it("chaîne de trois membres, faces hors chaîne intactes, refus dans l'ordre des chaînes puis des membres", () => {
    const steep = { kind: "steepSegment", alpha: 1.5 } as const;
    const nose = { kind: "noseAboveRive", excess: 23 } as const;
    const faces = plans(
      folded("a", nose),
      bent("b"),
      folded("c", heavier),
      folded("x", heavier),
      folded("w", steep),
    );
    const r = forceLandingChains(
      faces,
      [
        ["a", "b", "c"],
        ["w", "b"],
      ],
      bearingOf,
      LIMIT,
    );
    expect(r.forced).toEqual(["c"]);
    expect(r.refusals.map((x) => [x.chain.join(">"), x.faceId, x.reason.kind])).toEqual([
      ["a>b>c", "a", "noseAboveRive"],
      ["w>b", "w", "steepSegment"],
    ]);
    // Hors chaîne : un repli `heavier` reste permis (K-Q21).
    expect(r.faces.get("x")).toBe(faces.get("x"));
    // Entrée non modifiée (fonction pure).
    expect(faces.get("c")!.mode).toBe("chord");
  });

  it("refus traduit (fr, en) pour chaque raison : raccord, limon, chiffres formatés, aucune clé brute ni français en anglais", () => {
    const marks: Record<string, string> = { a: "LI2", b: "LI3" };
    const markOf = (id: string): string => marks[id] ?? id;
    const reasons: LandingRefusalReason[] = [
      { kind: "emptyWindow" },
      { kind: "cutsCross", shortest: -3.2 },
      { kind: "shortSegment", shortest: 29.5 },
      { kind: "noseAboveRive", excess: 62 },
      { kind: "steepSegment", alpha: 1.508 },
      { kind: "lostSupport", treads: [7, 9] },
      { kind: "heavier", bent: Infinity, chord: 200.7 },
      { kind: "beyondCatalog", bent: 281.54, section: "UPN 260", h: 260 },
      { kind: "beyondSection", bent: 186.94, section: "UPN 180", h: 180 },
    ];
    for (const reason of reasons) {
      const m = landingRefusalMessage({ chain: ["a", "b"], faceId: "a", reason }, markOf);
      expect(m.key).toBe("structure.steelProfile.error.landingSpliceRefused");
      expect(landingRefusalReasonMessage(reason).key).not.toBe("");
      const fr = createTranslator("fr").t(m);
      const en = createTranslator("en").t(m);
      for (const text of [fr, en]) {
        expect(text, reason.kind).toContain("LI2 / LI3");
        expect(text, reason.kind).toContain("K-Q27");
        expect(text, reason.kind).not.toMatch(/structure\.|\{|\}|\[object|NaN|Infinity|undefined/);
      }
      expect(en, reason.kind).not.toMatch(/limon|palier|marche|raccord|âme|nez/i);
    }
    const beyond = landingRefusalMessage(
      { chain: ["a", "b"], faceId: "a", reason: reasons[7]! },
      markOf,
    );
    expect(createTranslator("fr").t(beyond)).toContain("281,5 mm");
    expect(createTranslator("fr").t(beyond)).toContain("UPN 260 (260 mm)");
    expect(createTranslator("en").t(beyond)).toContain("281.5 mm");
    const imposed = landingRefusalMessage(
      { chain: ["a", "b"], faceId: "a", reason: reasons[8]! },
      markOf,
    );
    expect(createTranslator("fr").t(imposed)).toContain("section imposée UPN 180 (180 mm)");
    expect(createTranslator("en").t(imposed)).toContain("imposed section UPN 180 (180 mm)");
    const steep = landingRefusalMessage(
      { chain: ["a", "b"], faceId: "a", reason: reasons[4]! },
      markOf,
    );
    expect(createTranslator("fr").t(steep)).toContain("86,4°");
    expect(createTranslator("en").t(steep)).toContain("86.4°");
  });

  it("refus d'une chaîne sans limon coudé (K-Q31) : clé propre, raccord, limon et cause chiffrés (fr, en)", () => {
    const marks: Record<string, string> = { a: "LI1", b: "LI2" };
    const markOf = (id: string): string => marks[id] ?? id;
    const m = landingRefusalMessage(
      {
        chain: ["a", "b"],
        faceId: "a",
        reason: { kind: "noseAboveRive", excess: 61.6 },
        straight: true,
      },
      markOf,
    );
    expect(m.key).toBe("structure.steelProfile.error.landingChainStraight");
    const fr = createTranslator("fr").t(m);
    const en = createTranslator("en").t(m);
    expect(fr).toContain("LI1 / LI2");
    expect(fr).toContain("aucun limon n'est coudé et le limon LI1");
    expect(fr).toContain("62 mm");
    expect(fr).toContain("K-Q31");
    expect(en).toContain("LI1 / LI2");
    expect(en).toContain("no string is cranked and string LI1");
    expect(en).toContain("62 mm");
    expect(en).toContain("K-Q31");
    for (const text of [fr, en]) {
      expect(text).not.toMatch(/structure\.|\{|\}|\[object|NaN|Infinity|undefined/);
    }
    expect(en).not.toMatch(/limon|palier|marche|raccord|âme|nez/i);
  });
});

describe("remarques du limon coudé", () => {
  const reasons: CrankedFallbackReason[] = [
    { kind: "emptyWindow" },
    { kind: "cutsCross", shortest: -3.2 },
    { kind: "shortSegment", shortest: 29.5 },
    { kind: "noseAboveRive", excess: 62 },
    { kind: "steepSegment", alpha: 1.51 },
    { kind: "tooSteepSegment", alpha: 1.42, maxAngle: (75 * Math.PI) / 180 },
    { kind: "lostSupport", treads: [7, 9] },
    { kind: "heavier", bent: 259.1, chord: 200.7 },
    { kind: "heavier", bent: Infinity, chord: 200.7 },
  ];
  it("chaque raison est traduite en français et en anglais, sans clé brute", () => {
    for (const locale of ["fr", "en"] as const) {
      const t = createTranslator(locale);
      for (const r of reasons) {
        const text = t.t(crankedFallbackNote("LI1", r));
        expect(text).toContain("LI1");
        expect(text).not.toMatch(/structure\.|\{/);
      }
    }
  });

  it("tronçon trop raide (K-Q35) : angle et maximum en degrés, à valider", () => {
    const note = crankedFallbackNote("LE2", {
      kind: "tooSteepSegment",
      alpha: (81.25 * Math.PI) / 180,
      maxAngle: (75 * Math.PI) / 180,
    });
    expect(note.params?.["reason"]).toMatchObject({
      key: "structure.steelProfile.crankedFallback.tooSteepSegment",
    });
    const fr = createTranslator("fr").t(note);
    const en = createTranslator("en").t(note);
    expect(fr).toContain("81,3°");
    expect(fr).toContain("de 75°");
    expect(fr).toContain("à valider");
    expect(en).toContain("81.3°");
    expect(en).toContain("the 75°");
    expect(en).toContain("to be validated");
  });

  it("besoin coudé infini : clé dédiée, ni « Infinity » ni unité sans nombre", () => {
    const unbounded = crankedFallbackNote("LI1", { kind: "heavier", bent: Infinity, chord: 200.7 });
    expect(unbounded.params?.["reason"]).toMatchObject({
      key: "structure.steelProfile.crankedFallback.heavierUnbounded",
    });
    for (const locale of ["fr", "en"] as const) {
      const text = createTranslator(locale).t(unbounded);
      expect(text).not.toMatch(/Infinity|∞/);
      expect(text).not.toMatch(/[a-zé] mm/);
      expect(text).toMatch(/200[,.]7 mm/);
    }
  });
});

describe("tronçons du limon coudé (K2c, CK8 à CK10, CK17)", () => {
  const q = quarter();
  /** Contour coupé au sol et longueur retirée par la coupe de sol, comme le plugin. */
  const cut = (p: (typeof q.pres)[number]) => {
    const fb = q.get(p.face.id);
    const outline = clipHalfPlane(crankedOutline(fb, p.uLo, p.uHi), V.vec(0, 0), V.vec(0, 1));
    const floorTrim = Math.max(0, crankedAxialEnds(fb, outline, p.uLo, p.uHi).start);
    return { fb, outline, floorTrim };
  };

  it("composantes : une par tronçon, convexes, réunion = contour (aires), coupe de sol sur la première seulement", () => {
    for (const p of q.pres) {
      const { fb, outline, floorTrim } = cut(p);
      const specs = crankedComponentSpecs(fb, outline, floorTrim);
      expect(specs.map((s) => s.index)).toEqual(fb.segments.map((_, i) => i + 1));
      const total = Math.abs(signedArea(outline));
      const sum = specs.reduce((a, s) => a + Math.abs(signedArea(s.polygon)), 0);
      expect(Math.abs(sum - total) / total).toBeLessThan(1e-9);
      for (const s of specs) {
        // Convexe et orienté (sens trigonométrique) : tous les virages à gauche.
        const n = s.polygon.length;
        for (let i = 0; i < n; i++) {
          const a = s.polygon[i]!;
          const b = s.polygon[(i + 1) % n]!;
          const c = s.polygon[(i + 2) % n]!;
          expect(V.cross(V.sub(b, a), V.sub(c, b))).toBeGreaterThan(-1e-6);
        }
        expect(s.length).toBeGreaterThan(0);
        expect(s.length).toBeCloseTo(
          s.segment.fibres.axialExtent - (s.index === 1 ? floorTrim : 0),
          9,
        );
        // Centre de la composante : rendu à elle par `componentIndexAt` (une seule composante).
        let cx = 0;
        let cy = 0;
        for (const v of s.polygon) {
          cx += v.x / n;
          cy += v.y / n;
        }
        expect(componentIndexAt(fb, V.vec(cx, cy))).toBe(s.index);
      }
      const sumL = specs.reduce((a, s) => a + s.length, 0);
      const axial = fb.segments.reduce((a, g) => a + g.fibres.axialExtent, 0);
      expect(sumL).toBeCloseTo(axial - floorTrim, 9);
      expect(floorTrim > 0).toBe(p.face.start === "floor");
    }
  });

  it("cordon de jarret : 2h / cos β + (P − 2h), égal au périmètre sans changement de pente", () => {
    const P = sectionPerimeter(UPN180);
    expect(kneeWeldLength({ beta: 0 }, UPN180.h, P)).toBeCloseTo(P, 9);
    const beta = (12 * Math.PI) / 180;
    expect(kneeWeldLength({ beta }, UPN180.h, P)).toBeCloseTo(
      (2 * UPN180.h) / Math.cos(beta) + P - 2 * UPN180.h,
      9,
    );
  });

  it("cotes de gabarit : abscisse et cote de rive haute de chaque jarret, pentes avant / après (radians, ADR-0003)", () => {
    const fb = q.get("le2");
    const items = crankedJigItems(fb, -12.5);
    expect(items).toHaveLength(fb.knees.length);
    items.forEach((it, j) => {
      expect(it.index).toBe(j + 1);
      expect(it.x).toBeCloseTo(fb.knees[j]!.upper.x + 12.5, 9);
      expect(it.z).toBeCloseTo(riveFns(fb).upper(fb.knees[j]!.upper.x), 6);
      expect(it.before).toBe(fb.segments[j]!.alpha);
      expect(it.after).toBe(fb.segments[j + 1]!.alpha);
    });
    // Remarque : pentes converties en degrés à l'affichage.
    const fr = createTranslator("fr").t(crankedJigNote("LE2", items)!);
    const a = (items[0]!.after * 180) / Math.PI;
    expect(fr).toContain(`→ ${a.toFixed(1).replace(".", ",")}°`);
    // Partie de niveau au coin (K-Q7) : le premier tronçon de le2 est de niveau.
    expect(items[0]!.before).toBeCloseTo(0, 9);
  });

  it("balayage prolongé aux coins en plan de `extend`, le long du tronçon de niveau, bout d'équerre", () => {
    for (const p of q.pres) {
      const { fb, outline } = cut(p);
      const base = crankedSweepPath(fb, p.face, outline, p.uLo, p.uHi);
      const e = 70;
      const ext = crankedSweepPath(fb, p.face, outline, p.uLo, p.uHi, { start: e, end: e });
      const uOf = (pt: { x: number; y: number }) =>
        (pt.x - p.face.a.x) * p.face.dir.x + (pt.y - p.face.a.y) * p.face.dir.y;
      const lo = (path: typeof base) => Math.min(...path.map(uOf));
      const hi = (path: typeof base) => Math.max(...path.map(uOf));
      expect(lo(base) - lo(ext)).toBeCloseTo(p.face.start === "corner" ? e : 0, 6);
      expect(hi(ext) - hi(base)).toBeCloseTo(p.face.end === "corner" ? e : 0, 6);
      expect(ext.map((pt) => pt.z)).toEqual(base.map((pt) => pt.z));
    }
  });

  it("remarques des tronçons, d'un seul tronçon et des cotes de gabarit, en français et en anglais", () => {
    const fb = q.get("le2");
    const notes = [
      crankedNote("LE2", fb),
      crankedSingleNote("LI2", fb),
      crankedJigNote("LE2", crankedJigItems(fb, 0))!,
    ];
    expect(crankedJigNote("LE2", [])).toBeNull();
    expect(crankedComponentMark("LE2", 3)).toBe("LE2-3");
    for (const locale of ["fr", "en"] as const) {
      const t = createTranslator(locale);
      for (const n of notes) expect(t.t(n)).not.toMatch(/structure\.|\{|NaN|Infinity/);
      expect(t.t(notes[0]!)).toContain("LE2-1");
      expect(t.t(notes[0]!)).toContain(`LE2-${fb.segments.length}`);
    }
  });
});

// ------------------------------------------------------------------------------ cornière au coin du mur

/** Réglages du logement des tests du coin : L 40, marge 10, UPN (t_f = 0), appui mini 50. */
const WEBFIT = { depth: 40, edge: 10, tf: 0, minLength: 50 };

/** Support synthétique côté mur sur une face du quart (clé de face = id). */
function sup(face: string, tread: number, u0: number, u1: number, zTop: number): CrankedSupport {
  return { u0, u1, zTop, tread, face: { key: face, owner: face, kind: "stringer", side: "outer" } };
}

/** Support synthétique côté jour sur une face de poteau `pt1`, zone [0 ; len]. */
function postSup(tread: number, len: number, zTop: number): CrankedSupport {
  return {
    u0: 0,
    u1: len,
    zTop,
    tread,
    face: { key: `pt1-${tread}`, owner: "pt1", kind: "post", side: "inner" },
  };
}

/** Dessus de la marche 6 du quart synthétique (σ 1 350 → 1 600). */
const Z6 = 175 * 7 - 40;

/**
 * Supports d'une marche par giron du quart synthétique (nez tous les 250 mm en σ, dessous de
 * marche 40 mm sous le nez suivant), coupés au coin σ = 1 500 : la marche 6 (σ 1 350 → 1 600)
 * a un candidat sur le1 [1 350 ; 1 500] et un sur le2 [0 ; 100], et un appui côté jour sur un
 * poteau (80 mm ≥ `minLength`, K-Q16) ; `jour` = false : sans cet appui.
 */
function quarterSupports(jour = true): CrankedSupport[] {
  const out: CrankedSupport[] = [];
  for (let k = 0; k <= 10; k++) {
    const s0 = 100 + 250 * k;
    const s1 = s0 + 250;
    const zTop = 175 * (k + 2) - 40;
    if (s1 <= 1500) out.push(sup("le1", k + 1, s0, s1, zTop));
    else if (s0 >= 1500) out.push(sup("le2", k + 1, s0 - 1500, s1 - 1500, zTop));
    else {
      out.push(sup("le1", k + 1, s0, 1500, zTop));
      out.push(sup("le2", k + 1, 0, s1 - 1500, zTop));
    }
  }
  if (jour) out.push(postSup(6, 80, Z6));
  return out;
}

/**
 * Quart synthétique augmenté d'un limon de jour droit `li1` (côté jour, une seule pente, mêmes
 * nez : barre droite sans remarque, CK7), pour juger l'appui côté jour d'un limon (K-Q16).
 */
function quarterWithJour() {
  const q = quarter();
  const li = {
    face: { ...faceOf("li1", 0, 1500, "floor", "arrival", "x"), side: "inner" as const },
    uLo: 50,
    uHi: 1500,
    line: { u0: 100, z0: 175, slope: 0.7 },
  };
  return { ...q, pres: [...q.pres, li] };
}

/** Support côté jour sur `li1` sous la marche 6, dessus `zTop`. */
const jourSup = (zTop: number): CrankedSupport => ({
  u0: 1350,
  u1: 1500,
  zTop,
  tread: 6,
  face: { key: "li1", owner: "li1", kind: "stringer", side: "inner" },
});

type QuarterPre = ReturnType<typeof quarter>["pres"][number];

/** Rive haute de la barre droite d'une face (corde, d_h = 50). */
const chordUpper = (p: QuarterPre): Vec2[] => {
  const at = (u: number): Vec2 => ({
    x: u,
    y: p.line.z0 + p.line.slope * (u - p.line.u0) + 50,
  });
  return [at(p.uLo - 2000), at(p.uHi + 2000)];
};

/** Plan du quart pour une section, des supports et des groupes du coin donnés. */
function planOf(
  q: Pick<ReturnType<typeof quarter>, "pres" | "pitch">,
  supports: readonly CrankedSupport[],
  groups: readonly CornerGroup[],
  section = UPN180,
  chordLost: (c: CrankedSupport) => boolean = (c) =>
    c.u1 - c.u0 >= WEBFIT.minLength - 1e-9 &&
    (() => {
      const p = q.pres.find((x) => x.face.id === c.face.owner)!;
      const f = fitInWebPolyline(chordUpper(p), null, c, WEBFIT);
      return f.u1 - f.u0 < WEBFIT.minLength - 1e-9;
    })(),
  chordNeed: (p: QuarterPre, c: CrankedSupport) => number = (p, c) =>
    supportHeightNeed(chordUpper(p), c, WEBFIT),
) {
  return crankedSectionPlan({
    pres: q.pres,
    bearingFaces: q.pres.map(crankedBearingFace),
    pitch: { inner: q.pitch, outer: q.pitch },
    upperOffset: 50,
    knee: DEFAULT_KNEE_SETTINGS,
    section,
    webFit: WEBFIT,
    supportsOf: (p) => supports.filter((c) => c.face.owner === p.face.id),
    chordNeedOfSupport: chordNeed,
    chordLostOfSupport: (_p, c) => chordLost(c),
    cornerGroups: groups,
  });
}

describe("cornière au coin du mur (K2e, K-Q4) — groupes et cornière exigée", () => {
  it("groupes : marches côté mur sur au moins deux limons, triées ; côté jour et poteaux ignorés", () => {
    const cands: CrankedSupport[] = [
      sup("le2", 7, 0, 100, 1000),
      sup("le1", 7, 1300, 1500, 1000),
      sup("le1", 3, 400, 600, 500),
      {
        ...sup("li1", 5, 0, 80, 800),
        face: { key: "li1", owner: "li1", kind: "stringer", side: "inner" },
      },
      {
        ...sup("li2", 5, 0, 80, 800),
        face: { key: "li2", owner: "li2", kind: "stringer", side: "inner" },
      },
      {
        ...sup("pt1", 2, 0, 80, 800),
        face: { key: "pt1-a", owner: "pt1", kind: "post", side: "outer" },
      },
      sup("le1", 2, 0, 80, 800),
      sup("le2", 9, 0, 120, 900),
      sup("le3", 9, 0, 140, 900),
      sup("le4", 9, 0, 60, 900),
    ];
    const g = cornerSupportGroups(cands);
    expect(g.map((x) => x.tread)).toEqual([7, 9]);
    // Aucun support côté jour sur ces marches (ceux de la marche 5 ne forment pas de groupe).
    expect(g.map((x) => x.jour)).toEqual([[], []]);
    expect(g[0]!.candidates.map((c) => c.key)).toEqual([
      cornerSupportKey(7, "le2"),
      cornerSupportKey(7, "le1"),
    ]);
    expect(g[0]!.candidates[1]).toMatchObject({ u0: 1300, u1: 1500, zTop: 1000, faceId: "le1" });
    // Trois faces au même coin : un seul groupe.
    expect(g[1]!.candidates.map((c) => c.faceId)).toEqual(["le2", "le3", "le4"]);
  });

  it("supports côté jour du groupe (K-Q16) et marches exclues (K-Q18, paliers)", () => {
    const cands: CrankedSupport[] = [
      sup("le1", 4, 1300, 1500, 700),
      sup("le2", 4, 0, 120, 700),
      postSup(4, 70, 700),
      {
        ...sup("li1", 4, 1200, 1400, 700),
        face: { key: "li1", owner: "li1", kind: "stringer", side: "inner" },
      },
      sup("le1", 8, 1300, 1500, 900),
      sup("le2", 8, 0, 120, 900),
    ];
    const g = cornerSupportGroups(cands);
    expect(g.map((x) => x.tread)).toEqual([4, 8]);
    expect(g[0]!.jour).toEqual([
      {
        u0: 0,
        u1: 70,
        zTop: 700,
        tread: 4,
        faceId: "pt1",
        key: cornerSupportKey(4, "pt1-4"),
        onPost: true,
      },
      {
        u0: 1200,
        u1: 1400,
        zTop: 700,
        tread: 4,
        faceId: "li1",
        key: cornerSupportKey(4, "li1"),
        onPost: false,
      },
    ]);
    // Côté jour jamais candidat du coin (K-Q17 : coin du mur seulement).
    expect(g[0]!.candidates.map((c) => c.faceId)).toEqual(["le1", "le2"]);
    expect(g[1]!.jour).toEqual([]);
    // Marche exclue (palier) : aucun groupe, donc toutes ses cornières exigées.
    expect(cornerSupportGroups(cands, undefined, (t) => t === 8).map((x) => x.tread)).toEqual([4]);
    expect(cornerSupportGroups(cands, undefined, () => true)).toEqual([]);
  });

  const cand = (faceId: string, len: number): CornerCandidate => ({
    u0: 0,
    u1: len,
    zTop: 0,
    tread: 1,
    faceId,
    key: cornerSupportKey(1, faceId),
  });
  const rank = (id: string): number => Number(id.slice(1));

  it("départages : plus petit besoin, puis plus longue zone brute, puis rang de face, puis clé", () => {
    const one = (cs: CornerCandidate[], score: Record<string, number>): string =>
      [
        ...chooseCornerRequired(
          [{ tread: 1, candidates: cs, jour: [] }],
          (c) => score[c.faceId]!,
          rank,
        ),
      ][0]!;
    expect(one([cand("f1", 100), cand("f2", 300)], { f1: 150, f2: 160 })).toBe("1|f1");
    // Égalité à 1e-6 près : plus longue zone brute.
    expect(one([cand("f1", 100), cand("f2", 300)], { f1: 0, f2: 5e-7 })).toBe("1|f2");
    // Même longueur : plus petit rang de face.
    expect(one([cand("f2", 100), cand("f1", 100)], { f1: 0, f2: 0 })).toBe("1|f1");
    // Tout perdu (Infinity) : départage par la zone brute.
    expect(one([cand("f1", 20), cand("f2", 300)], { f1: Infinity, f2: Infinity })).toBe("1|f2");
    // Une perdue, l'autre logeable : jamais la perdue.
    expect(one([cand("f1", 400), cand("f2", 60)], { f1: Infinity, f2: 250 })).toBe("1|f2");
  });

  it("propriété : une exigée par groupe, de besoin minimal, indépendante de l'ordre", () => {
    const scoreArb = fc.oneof(
      fc.constantFrom(0, 150, 166.4, Infinity),
      fc.double({ min: 0, max: 400, noNaN: true }),
    );
    const groupArb = fc.uniqueArray(
      fc.record({
        face: fc.integer({ min: 1, max: 5 }),
        len: fc.oneof(fc.constantFrom(20, 100), fc.double({ min: 0, max: 600, noNaN: true })),
        score: scoreArb,
      }),
      { minLength: 2, maxLength: 4, selector: (x) => x.face },
    );
    fc.assert(
      fc.property(fc.array(groupArb, { minLength: 1, maxLength: 4 }), fc.nat(), (raw, seed) => {
        const scores = new Map<string, number>();
        const groups: CornerGroup[] = raw.map((g, t) => ({
          tread: t + 1,
          candidates: g.map((c) => {
            const key = cornerSupportKey(t + 1, `f${c.face}`);
            scores.set(key, c.score);
            return { u0: 0, u1: c.len, zTop: 0, tread: t + 1, faceId: `f${c.face}`, key };
          }),
          jour: [],
        }));
        const score = (c: CornerCandidate): number => scores.get(c.key)!;
        const req = chooseCornerRequired(groups, score, rank);
        for (const g of groups) {
          const mine = g.candidates.filter((c) => req.has(c.key));
          expect(mine).toHaveLength(1);
          const min = Math.min(...g.candidates.map(score));
          const s = score(mine[0]!);
          expect(s === min || s <= min + 1e-6).toBe(true);
        }
        expect(req.size).toBe(groups.length);
        // Permutation des groupes et des candidats (rotation déterministe).
        const rot = <T>(xs: readonly T[], k: number): T[] =>
          xs.map((_, i) => xs[(i + k) % xs.length]!);
        const permuted = rot(groups, seed).map((g, i) => ({
          ...g,
          candidates: rot(g.candidates, seed + i).reverse(),
        }));
        expect([...chooseCornerRequired(permuted, score, rank)].sort()).toEqual([...req].sort());
      }),
      { numRuns: RUNS },
    );
  });
});

describe("cornière au coin du mur (K2e, K-Q4) — plan par section", () => {
  const q = quarter();
  const supports = quarterSupports();
  const groups = cornerSupportGroups(supports);
  const corner = groups[0]!;

  it("fixture : une seule marche au coin (marche 6, le1 et le2), faces coudées, appui sur poteau", () => {
    expect(groups.map((g) => g.tread)).toEqual([6]);
    expect(corner.candidates.map((c) => c.faceId)).toEqual(["le1", "le2"]);
    expect(corner.jour.map((j) => j.faceId)).toEqual(["pt1"]);
    expect(planOf(q, supports, groups).corner.jourless).toEqual(new Set());
  });

  it("sans groupe : besoins de K2b (toutes les cornières), ensembles du coin vides", () => {
    const plan = planOf(q, supports, []);
    expect(plan.corner).toEqual({
      groups: [],
      required: new Set(),
      optional: new Set(),
      reverted: 0,
      jourless: new Set(),
    });
    for (const p of q.pres) {
      const f = plan.faces.get(p.face.id)!;
      const list = supports.filter((c) => c.face.owner === p.face.id);
      expect(f.bentNeed).toBe(faceHeightNeed(q.get(p.face.id), list, WEBFIT).need);
      expect(f.chordNeed).toBe(
        Math.max(0, ...list.map((c) => supportHeightNeed(chordUpper(p), c, WEBFIT))),
      );
      if (f.mode === "nosing") expect(f.need).toBe(f.bentNeed);
    }
  });

  it("avec le groupe : l'exigée demande le moins d'âme, la facultative sort du besoin de sa face", () => {
    const plan = planOf(q, supports, groups);
    const { required, optional } = plan.corner;
    expect(required.size).toBe(1);
    expect(optional.size).toBe(1);
    expect(plan.corner.reverted).toBe(0);
    const needOf = (c: CornerCandidate): number =>
      supportHeightNeed(q.get(c.faceId).upperRive, c, WEBFIT);
    const [a, b] = corner.candidates;
    const req = required.has(a!.key) ? a! : b!;
    const opt = req === a ? b! : a!;
    expect(plan.faces.get(req.faceId)!.mode).toBe("nosing");
    expect(plan.faces.get(opt.faceId)!.mode).toBe("nosing");
    expect(needOf(req)).toBeLessThanOrEqual(needOf(opt));
    // Besoin de la face de la facultative : ses autres supports seulement.
    const others = supports.filter(
      (c) => c.face.owner === opt.faceId && cornerSupportKey(c.tread, c.face.key) !== opt.key,
    );
    expect(plan.faces.get(opt.faceId)!.bentNeed).toBe(
      faceHeightNeed(q.get(opt.faceId), others, WEBFIT).need,
    );
    // Face de l'exigée : tous ses supports.
    const all = supports.filter((c) => c.face.owner === req.faceId);
    expect(plan.faces.get(req.faceId)!.bentNeed).toBe(
      faceHeightNeed(q.get(req.faceId), all, WEBFIT).need,
    );
  });

  it("cornière perdue (au-dessus de la rive) ou trop courte : jamais exigée", () => {
    const fb2 = q.get("le2");
    const up = riveFns(fb2).upper(50);
    // le2 perdue (dessus 200 mm au-dessus de la rive haute) : le1 exigée.
    const lost = supports.map((c) =>
      c.tread === 6 && c.face.owner === "le2" ? { ...c, zTop: up + 200 } : c,
    );
    const p1 = planOf(q, lost, cornerSupportGroups(lost));
    expect([...p1.corner.required]).toEqual([cornerSupportKey(6, "le1")]);
    // le1 trop courte (20 mm) : le2 exigée, même si son besoin serait nul.
    const short = supports.map((c) =>
      c.tread === 6 && c.face.owner === "le1" ? { ...c, u0: 1480 } : c,
    );
    const p2 = planOf(q, short, cornerSupportGroups(short));
    expect([...p2.corner.required]).toEqual([cornerSupportKey(6, "le2")]);
    expect([...p2.corner.optional]).toEqual([cornerSupportKey(6, "le1")]);
  });

  it("garde-fou : exigée perdue dans le mode final de sa face → groupe « tout exigé » (K2b)", () => {
    // le1 trop courte (non logeable) ; le2 exigée mais très basse sous la rive : son besoin
    // coudé dépasse la section et la barre droite (repli `heavier`), et la barre droite ne la
    // porte pas (talon de test) : elle est perdue dans le mode final.
    const fb2 = q.get("le2");
    const z = riveFns(fb2).upper(50) - 300;
    const s = supports.map((c) =>
      c.tread === 6 && c.face.owner === "le1"
        ? { ...c, u0: 1480 }
        : c.tread === 6 && c.face.owner === "le2"
          ? { ...c, zTop: z }
          : c,
    );
    const key2 = cornerSupportKey(6, "le2");
    const plan = planOf(
      q,
      s,
      cornerSupportGroups(s),
      UPN180,
      (c) => cornerSupportKey(c.tread, c.face.key) === key2,
      () => 0,
    );
    expect(plan.faces.get("le2")!.fallback?.kind).toBe("heavier");
    expect(plan.corner.reverted).toBe(1);
    expect([...plan.corner.required].sort()).toEqual([cornerSupportKey(6, "le1"), key2].sort());
    expect(plan.corner.optional.size).toBe(0);
  });

  it("propriété (monotonie) : section faisable sans la règle → faisable avec ; exigée logée ; section insuffisante → plan de K2b", () => {
    const sections = sectionsOf("UPN").filter((x) => x.h >= 140 && x.h <= 260);
    fc.assert(
      fc.property(
        fc.constantFrom(...sections),
        fc.double({ min: 0, max: 140, noNaN: true }),
        fc.double({ min: 0, max: 140, noNaN: true }),
        fc.double({ min: -250, max: 40, noNaN: true }),
        fc.double({ min: -250, max: 40, noNaN: true }),
        (sec, cut1, cut2, dz1, dz2) => {
          const s = supports.map((c) => {
            if (c.tread !== 6 || c.face.kind !== "stringer") return c;
            const up = riveFns(q.get(c.face.owner)).upper((c.u0 + c.u1) / 2);
            return c.face.owner === "le1"
              ? { ...c, u0: c.u0 + cut1, zTop: up + dz1 - 50 }
              : { ...c, u1: Math.max(c.u0, c.u1 - cut2 * 0.6), zTop: up + dz2 - 50 };
          });
          const k2b = planOf(q, s, [], sec);
          const k2e = planOf(q, s, cornerSupportGroups(s), sec);
          const max = (pl: typeof k2b): number =>
            Math.max(0, ...[...pl.faces.values()].map((f) => f.need));
          if (max(k2b) <= sec.h + 1e-9) expect(max(k2e)).toBeLessThanOrEqual(sec.h + 1e-9);
          if (max(k2e) > sec.h + 1e-9) {
            // Section insuffisante : plan de K2b pour tous les groupes (aucune facultative).
            expect(k2e.corner.reverted).toBe(k2e.corner.groups.length);
            expect(k2e.corner.optional.size).toBe(0);
            expect(k2e.faces).toEqual(k2b.faces);
            return;
          }
          // Section faisable : l'exigée de chaque groupe non basculé est logée dans h, dans le
          // mode final de sa face (recalculé indépendamment du plan).
          if (k2e.corner.reverted > 0) return;
          for (const g of k2e.corner.groups) {
            const req = g.candidates.find((c) => k2e.corner.required.has(c.key))!;
            const c = s.find((x) => cornerSupportKey(x.tread, x.face.key) === req.key)!;
            const f = k2e.faces.get(req.faceId)!;
            const p = q.pres.find((x) => x.face.id === req.faceId)!;
            if (f.mode === "nosing") {
              const need = faceHeightNeed(f.bearing!, [c], WEBFIT);
              expect(need.lost).toEqual([]);
              expect(need.need).toBeLessThanOrEqual(sec.h + 1e-9);
            } else {
              expect(supportHeightNeed(chordUpper(p), c, WEBFIT)).toBeLessThanOrEqual(sec.h + 1e-9);
            }
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("section imposée trop basse : plan de K2b, aucune facultative (aucun appui mural retiré)", () => {
    // Marche 9 de le2 (hors du coin) très basse sous la rive : aucune UPN 140 ne la loge.
    const sec = sectionsOf("UPN").find((x) => x.h === 140)!;
    const low = supports.map((c) =>
      c.tread === 9 && c.face.owner === "le2"
        ? { ...c, zTop: riveFns(q.get("le2")).upper((c.u0 + c.u1) / 2) - 250 }
        : c,
    );
    const k2b = planOf(q, low, [], sec);
    const k2e = planOf(q, low, cornerSupportGroups(low), sec);
    expect(Math.max(...[...k2b.faces.values()].map((f) => f.need))).toBeGreaterThan(sec.h);
    expect(k2e.faces).toEqual(k2b.faces);
    expect(k2e.corner.reverted).toBe(1);
    expect(k2e.corner.optional.size).toBe(0);
  });

  it("marche sans appui côté jour (K-Q16) : aucun support, ou poteau trop court → toutes exigées, plan de K2b", () => {
    for (const jour of [[], [postSup(6, 30, Z6)]]) {
      const s = [...quarterSupports(false), ...jour];
      const gs = cornerSupportGroups(s);
      const plan = planOf(q, s, gs);
      expect(plan.corner.jourless).toEqual(new Set([6]));
      expect(plan.corner.required).toEqual(new Set(gs[0]!.candidates.map((c) => c.key)));
      expect(plan.corner.optional.size).toBe(0);
      expect(plan.corner.reverted).toBe(0);
      // Besoins d'âme de toutes les cornières : ceux du plan sans groupe (K2b).
      expect(plan.faces).toEqual(planOf(q, s, []).faces);
    }
    // Poteau de 80 mm (≥ `minLength`) : règle du coin de K2e, une facultative.
    const s = [...quarterSupports(false), postSup(6, 80, Z6)];
    const plan = planOf(q, s, cornerSupportGroups(s));
    expect(plan.corner.jourless.size).toBe(0);
    expect(plan.corner.optional.size).toBe(1);
  });

  it("bord de K-Q16 (K2f) : zone sur poteau = longueur minimale d'appui → appuyée ; à 1e-6 mm près en dessous → sans appui côté jour", () => {
    // Les cas réels du quart (M4, 49,6 mm) et du demi-tournant (M8, 49 mm) tombent à moins de
    // 1 mm de la longueur minimale (50 mm) : la règle de pose est un seuil `>=` sur la zone brute.
    const min = WEBFIT.minLength;
    const under = [...quarterSupports(false), postSup(6, min - 1e-6, Z6)];
    const pUnder = planOf(q, under, cornerSupportGroups(under));
    expect(pUnder.corner.jourless).toEqual(new Set([6]));
    expect(pUnder.corner.optional.size).toBe(0);
    const at = [...quarterSupports(false), postSup(6, min, Z6)];
    const pAt = planOf(q, at, cornerSupportGroups(at));
    expect(pAt.corner.jourless.size).toBe(0);
    expect(pAt.corner.optional.size).toBe(1);
  });

  it("limon de jour (K-Q16) : support logé → règle du coin ; support au-dessus de la rive → sans appui côté jour", () => {
    const qj = quarterWithJour();
    const ok = [...quarterSupports(false), jourSup(1050)];
    const pOk = planOf(qj, ok, cornerSupportGroups(ok));
    expect(pOk.faces.get("li1")!.mode).toBe("chord");
    expect(pOk.corner.jourless.size).toBe(0);
    expect(pOk.corner.optional.size).toBe(1);
    const lost = [...quarterSupports(false), jourSup(Z6 + 200)];
    const pLost = planOf(qj, lost, cornerSupportGroups(lost));
    expect(pLost.corner.jourless).toEqual(new Set([6]));
    expect(pLost.corner.optional.size).toBe(0);
    // Limon de jour absent du plan (limon refusé) : sans appui côté jour.
    const pNone = planOf(q, ok, cornerSupportGroups(ok));
    expect(pNone.corner.jourless).toEqual(new Set([6]));
  });

  it("propriété (K-Q16) : sans appui côté jour ⇔ aucun support de jour logeable ; alors toutes exigées", () => {
    const qj = quarterWithJour();
    const li = qj.pres.find((p) => p.face.id === "li1")!;
    const sections = sectionsOf("UPN").filter((x) => x.h >= 140 && x.h <= 260);
    const cosA = Math.cos(Math.atan(li.line.slope));
    const seen = { bears: 0, jourless: 0, byStringer: 0 };
    fc.assert(
      fc.property(
        fc.constantFrom(...sections),
        fc.option(fc.double({ min: 0, max: 150, noNaN: true }), { nil: undefined }),
        fc.option(fc.double({ min: 700, max: 1400, noNaN: true }), { nil: undefined }),
        (sec, postLen, jourZ) => {
          const s = [
            ...quarterSupports(false),
            ...(postLen === undefined ? [] : [postSup(6, postLen, Z6)]),
            ...(jourZ === undefined ? [] : [jourSup(jourZ)]),
          ];
          // Logement du support du limon de jour dans la section, recalculé sur ses rives.
          let jourLen = 0;
          if (jourZ !== undefined) {
            const up = chordUpper(li);
            const low = up.map((pt) => ({ x: pt.x, y: pt.y - sec.h / cosA }));
            const f = fitInWebPolyline(up, low, jourSup(jourZ), WEBFIT);
            jourLen = f.u1 - f.u0;
          }
          fc.pre(Math.abs(jourLen - WEBFIT.minLength) > 1e-3);
          fc.pre(postLen === undefined || Math.abs(postLen - WEBFIT.minLength) > 1e-9);
          const bears =
            (postLen !== undefined && postLen >= WEBFIT.minLength) || jourLen >= WEBFIT.minLength;
          const gs = cornerSupportGroups(s);
          const plan = planOf(qj, s, gs, sec);
          expect(plan.corner.jourless.has(6)).toBe(!bears);
          seen[bears ? "bears" : "jourless"]++;
          if (
            jourLen >= WEBFIT.minLength &&
            !(postLen !== undefined && postLen >= WEBFIT.minLength)
          ) {
            seen.byStringer++;
          }
          if (!bears) {
            for (const c of gs[0]!.candidates) {
              expect(plan.corner.required.has(c.key)).toBe(true);
              expect(plan.corner.optional.has(c.key)).toBe(false);
            }
          }
        },
      ),
      { numRuns: RUNS },
    );
    // Non-vacuité : les deux issues, et un appui porté par le seul limon de jour.
    expect(seen.bears).toBeGreaterThan(0);
    expect(seen.jourless).toBeGreaterThan(0);
    expect(seen.byStringer).toBeGreaterThan(0);
  });

  it("deux limons colinéaires (palier entre limons alignés) : pas de groupe du coin", () => {
    const x = { x: 1, y: 0 };
    const y = { x: 0, y: 1 };
    const s = [sup("le1", 4, 1300, 1500, 800), sup("le2", 4, 0, 120, 800)];
    expect(cornerSupportGroups(s, () => x)).toEqual([]);
    expect(cornerSupportGroups(s, (id) => (id === "le1" ? x : y)).map((g) => g.tread)).toEqual([4]);
    // Sans directions : groupe dès deux limons (contrat des tests unitaires).
    expect(cornerSupportGroups(s)).toHaveLength(1);
  });
});

describe("cornière au coin du mur (K2e, K-Q4) — remarque", () => {
  it("une puis deux faces retirées, en fr et en : aucune clé brute, ni accolade, ni NaN", () => {
    const one = cornerAngleRemovedNote("M5", ["LE2"], ["LE1"], 50);
    const two = cornerAngleRemovedNote("M9", ["LE2", "LE3"], ["LE4"], 50);
    expect(one.key).toBe("structure.steelProfile.note.cornerAngleRemoved");
    for (const locale of ["fr", "en"] as const) {
      const t = createTranslator(locale);
      for (const n of [one, two]) expect(t.t(n)).not.toMatch(/structure\.|\{|\}|NaN|Infinity/);
      expect(t.t(one)).toContain("M5");
      expect(t.t(one)).toContain("LE2");
      expect(t.t(one)).toContain("LE1");
      expect(t.t(two)).toContain("LE3");
      // Partie logée jamais citée (souvent nulle) : seule la longueur minimale d'appui l'est.
      for (const n of [one, two]) expect(t.t(n)).toContain("50 mm");
      for (const n of [one, two]) expect(t.t(n)).not.toMatch(/\D0 mm/);
    }
    expect(createTranslator("fr").t(two)).toContain("cornières");
    expect(createTranslator("en").t(two)).toContain("angles");
  });
});
