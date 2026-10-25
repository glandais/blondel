/**
 * Câblage du limon coudé (`steelProfileCranked.ts`, sous-lot K2b) : décision par face et repli
 * sur la barre droite (K-Q12, K-Q13), en cas chiffrés et en propriété ; contour de l'âme, chemin
 * du balayage (solide valide, section orientée vers `into`), écarts d'onglet au bout d'aile
 * (CK13) et remarques traduites, sur des faces synthétiques.
 */
import { createTranslator, msg } from "@blondel/i18n";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { findSection, sectionPerimeter } from "../catalog/sections.js";
import { signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { Vec2 } from "../model/primitives.js";
import { solidProblem } from "../parts/solidChecks.js";
import { PiecewiseLinear, clipHalfPlane } from "./geom.js";
import {
  PROVISIONAL_KNEE_SETTINGS,
  bearingSectionOf,
  profileBearings,
  riveFns,
  type BearingFace,
  type BearingIssue,
  type FaceBearing,
} from "./profileBearing.js";
import type { SteelStringerFace } from "./steelFlat.js";
import {
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
  kneeCutBand,
  kneeFreeSupport,
  kneeWeldLength,
  isChordEquivalent,
  type CrankedDecisionInput,
  type CrankedFallbackReason,
  type CrankedMiterStringer,
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
    settings: PROVISIONAL_KNEE_SETTINGS,
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
    settings: PROVISIONAL_KNEE_SETTINGS,
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

  it("constats bloquants dans l'ordre emptyWindow, cutsCross, shortSegment, noseAboveRive, steepSegment", () => {
    const d = (kinds: BearingIssue["kind"][]) =>
      decideCrankedFace({ ...base, issues: kinds.map(issue) }).fallback?.kind;
    expect(d(["steepSegment", "noseAboveRive"])).toBe("noseAboveRive");
    expect(d(["steepSegment", "shortSegment", "cutsCross"])).toBe("cutsCross");
    expect(d(["steepSegment", "shortSegment"])).toBe("shortSegment");
    expect(d(["steepSegment"])).toBe("steepSegment");
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

  it("plus d'âme que la barre droite et que la section essayée → repli ; logé dans la section → coudé (lecture K2b de K-Q12, à valider)", () => {
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

describe("remarques du limon coudé", () => {
  const reasons: CrankedFallbackReason[] = [
    { kind: "emptyWindow" },
    { kind: "cutsCross", shortest: -3.2 },
    { kind: "shortSegment", shortest: 29.5 },
    { kind: "noseAboveRive", excess: 62 },
    { kind: "steepSegment", alpha: 1.51 },
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

  it("cotes de gabarit : abscisse et cote de rive haute de chaque jarret, pentes avant / après", () => {
    const fb = q.get("le2");
    const items = crankedJigItems(fb, -12.5);
    expect(items).toHaveLength(fb.knees.length);
    items.forEach((it, j) => {
      expect(it.index).toBe(j + 1);
      expect(it.x).toBeCloseTo(fb.knees[j]!.upper.x + 12.5, 9);
      expect(it.z).toBeCloseTo(riveFns(fb).upper(fb.knees[j]!.upper.x), 6);
      expect(it.before).toBeCloseTo((fb.segments[j]!.alpha * 180) / Math.PI, 9);
      expect(it.after).toBeCloseTo((fb.segments[j + 1]!.alpha * 180) / Math.PI, 9);
    });
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

describe("cornière à cheval sur un jarret (K-Q10, fonctions non branchées en K2c)", () => {
  const q = quarter();
  const fb = q.get("le2");
  const k = fb.knees[1]!;
  /** Le segment de coupe a → b traverse-t-il l'intérieur du rectangle (u, z) ? */
  const hits = (a: Vec2, b: Vec2, u0: number, u1: number, z0: number, z1: number): boolean => {
    const eps = 1e-6;
    const zl = Math.max(z0 + eps, Math.min(a.y, b.y));
    const zh = Math.min(z1 - eps, Math.max(a.y, b.y));
    if (zl > zh) return false;
    const uAt = (z: number) => a.x + ((b.x - a.x) * (z - a.y)) / (b.y - a.y);
    const ua = Math.min(uAt(zl), uAt(zh));
    const ub = Math.max(uAt(zl), uAt(zh));
    return ua < u1 - eps && ub > u0 + eps;
  };

  it("étendue de la coupe dans une tranche : sur la bissectrice, nulle au-dessus du sommet haut", () => {
    const z1 = k.upper.y - 10;
    const z0 = z1 - 40;
    const band = kneeCutBand(k, z0, z1)!;
    const uAt = (z: number) =>
      k.upper.x + ((k.lower.x - k.upper.x) * (z - k.upper.y)) / (k.lower.y - k.upper.y);
    expect(band.u0).toBeCloseTo(Math.min(uAt(z0), uAt(z1)), 9);
    expect(band.u1).toBeCloseTo(Math.max(uAt(z0), uAt(z1)), 9);
    expect(kneeCutBand(k, k.upper.y + 1, k.upper.y + 50)).toBeNull();
  });

  it("aucune coupe touchée : même objet ; morceaux de part et d'autre : le plus long, ou le meilleur score", () => {
    const zTop = k.upper.y - 20;
    const far = { u0: k.upper.x - 400, u1: k.upper.x - 300, zTop, tread: 1 };
    expect(kneeFreeSupport(fb, far, 40)).toBe(far);
    const band = kneeCutBand(k, zTop - 40, zTop)!;
    const c = { u0: band.u0 - 30, u1: band.u1 + 80, zTop, tread: 2 };
    expect(kneeFreeSupport(fb, c, 40)).toMatchObject({ u0: band.u1, u1: c.u1, tread: 2 });
    const shortest = kneeFreeSupport(fb, c, 40, (piece) => piece.u1 - piece.u0);
    expect(shortest).toMatchObject({ u0: c.u0, u1: band.u0 });
    // À égalité, le plus petit u0.
    const tie = { u0: band.u0 - 50, u1: band.u1 + 50, zTop, tread: 3 };
    expect(kneeFreeSupport(fb, tie, 40).u0).toBeCloseTo(tie.u0, 9);
    // Entièrement dans la coupe : support vide.
    const inside = { u0: band.u0 + 1e-3, u1: band.u1 - 1e-3, zTop, tread: 4 };
    const r = kneeFreeSupport(fb, inside, 40);
    expect(r.u1 - r.u0).toBe(0);
  });

  it("propriété : le support rendu ne traverse aucune coupe de jarret de la face", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...q.pres.map((p) => p.face.id)),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 20, max: 600, noNaN: true }),
        fc.double({ min: -200, max: 50, noNaN: true }),
        (id, t, len, dz) => {
          const f = q.get(id);
          const u0 = f.uLo + t * (f.uHi - f.uLo);
          const zTop = riveFns(f).upper(u0) + dz;
          const r = kneeFreeSupport(f, { u0, u1: u0 + len, zTop }, 40);
          expect(r.u0).toBeGreaterThanOrEqual(u0 - 1e-9);
          expect(r.u1).toBeLessThanOrEqual(u0 + len + 1e-9);
          if (r.u1 - r.u0 <= 1e-9) return;
          for (const kk of f.knees) {
            // Coupe prolongée sous le sommet bas (demi-droite) : aucune traversée.
            const far = V.addScaled(kk.upper, V.sub(kk.lower, kk.upper), 10);
            expect(hits(kk.upper, far, r.u0, r.u1, zTop - 40, zTop)).toBe(false);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});
