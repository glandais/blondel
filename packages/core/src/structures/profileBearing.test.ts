/**
 * Noyau du limon coudé (`profileBearing.ts`, sous-lot K2a) : invariants I2 à I7 et I9 en
 * propriétés sur des lignes des nez et des faces synthétiques, et cas chiffrés à la main.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Vec2 } from "../model/primitives.js";
import { PiecewiseLinear } from "./geom.js";
import {
  KneeSettingsSchema,
  PROVISIONAL_KNEE_SETTINGS,
  chordRives,
  cornerOf,
  faceHeightNeed,
  fitInWebPolyline,
  lowerRiveOf,
  miterFlangeGap,
  polylineAt,
  profileBearings,
  riveFns,
  supportHeightNeed,
  type BearingFace,
  type BearingInput,
  type BearingIssue,
  type BearingResult,
  type BearingSection,
  type FaceBearing,
  type KneeSettings,
  type WebFitParams,
  type WebSupport,
} from "./profileBearing.js";
import type { SteelCornerEnd } from "./steelFlat.js";

const RUNS = Number(process.env["STEPPING_RUNS"] ?? 200);
const ZERO: KneeSettings = { minSegmentLength: 0, minKneeAngle: 0 };
const UPN200: BearingSection = { h: 200, b: 75, shift: 0, tf: 0 };
const deg = (a: number): number => (a * Math.PI) / 180;

// ------------------------------------------------------------------------------ générateurs

interface Synth {
  readonly input: BearingInput;
  readonly supports: readonly (WebSupport & { face: string })[];
  readonly fit: WebFitParams;
}

const cornerArb: fc.Arbitrary<SteelCornerEnd | undefined> = fc.oneof(
  fc.constant(undefined),
  fc
    .double({ min: 0.2, max: 3, noNaN: true })
    .map((t): SteelCornerEnd => ({ joint: "wall", concave: true, tanHalf: t })),
  fc
    .double({ min: 0.2, max: 3, noNaN: true })
    .map((t): SteelCornerEnd => ({ joint: "jour", concave: false, tanHalf: t })),
  fc.constant<SteelCornerEnd>({ joint: "landing", concave: true, tanHalf: 0 }),
);

const sectionArb: fc.Arbitrary<BearingSection> = fc
  .record({
    h: fc.integer({ min: 80, max: 300 }),
    b: fc.integer({ min: 45, max: 300 }),
    shape: fc.constantFrom("U", "I"),
    tw: fc.integer({ min: 4, max: 12 }),
    tf: fc.integer({ min: 5, max: 15 }),
  })
  .map(({ h, b, shape, tw, tf }) =>
    shape === "U" ? { h, b, shift: 0, tf: 0 } : { h, b, shift: (b - tw) / 2, tf },
  );

const settingsArb: fc.Arbitrary<KneeSettings> = fc.record({
  minSegmentLength: fc.integer({ min: 0, max: 200 }),
  minKneeAngle: fc.double({ min: 0, max: 3, noNaN: true }),
});

/** Ligne des nez (4 à 18 nez, palier facultatif), faces chaînées par 0 à 2 coins, supports. */
function synthArb(settings: fc.Arbitrary<KneeSettings> = settingsArb): fc.Arbitrary<Synth> {
  return fc
    .record({
      steps: fc.array(
        fc.record({ g: fc.integer({ min: 40, max: 500 }), r: fc.integer({ min: 150, max: 200 }) }),
        { minLength: 3, maxLength: 17 },
      ),
      landing: fc.option(fc.integer({ min: 0, max: 16 }), { nil: undefined }),
      cuts: fc.uniqueArray(fc.integer({ min: 1, max: 9 }), { maxLength: 2 }),
      jitter: fc.double({ min: 0, max: 0.09, noNaN: true }),
      corners: fc.array(cornerArb, { minLength: 2, maxLength: 2 }),
      start: fc.constantFrom("floor" as const, "newel" as const),
      end: fc.constantFrom("arrival" as const, "newel" as const),
      startExt: fc.integer({ min: 0, max: 100 }),
      endExt: fc.integer({ min: 0, max: 100 }),
      section: sectionArb,
      dh: fc.integer({ min: 0, max: 80 }),
      settings,
      supports: fc.array(
        fc.record({
          at: fc.double({ min: 0, max: 1, noNaN: true }),
          len: fc.integer({ min: 50, max: 400 }),
          dz: fc.integer({ min: -100, max: 50 }),
        }),
        { maxLength: 6 },
      ),
      fit: fc.record({
        depth: fc.integer({ min: 20, max: 60 }),
        edge: fc.integer({ min: 0, max: 20 }),
        minLength: fc.integer({ min: 20, max: 80 }),
      }),
    })
    .map((r) => {
      const knots: { x: number; y: number }[] = [];
      let s = 1000;
      let zz = 170;
      knots.push({ x: s, y: zz });
      r.steps.forEach((st, i) => {
        const flat = r.landing === i;
        s += flat ? Math.max(st.g, 700) : st.g;
        if (!flat) zz += st.r;
        knots.push({ x: s, y: zz });
      });
      const pitch = new PiecewiseLinear(knots);
      const s0 = knots[0]!.x;
      const sN = knots[knots.length - 1]!.x;
      const cuts = [...r.cuts]
        .sort((a, b) => a - b)
        .map((c) => s0 + (c / 10 + r.jitter) * (sN - s0));
      const bounds = [s0 - 300, ...cuts, sN + 300];
      const faces: BearingFace[] = [];
      for (let i = 0; i + 1 < bounds.length; i++) {
        const sigmaA = bounds[i]!;
        const faceLength = bounds[i + 1]! - sigmaA;
        const first = i === 0;
        const last = i + 2 === bounds.length;
        const start = first ? r.start : ("corner" as const);
        const end = last ? r.end : ("corner" as const);
        const sc = first ? undefined : r.corners[i - 1];
        const ec = last ? undefined : r.corners[i];
        faces.push({
          id: `F${i + 1}`,
          side: "outer",
          sigmaA,
          faceLength,
          uLo: start === "floor" ? s0 - sigmaA - r.startExt : 0,
          uHi: end === "arrival" ? sN - sigmaA + r.endExt : faceLength,
          start,
          end,
          ...(sc ? { startCorner: sc } : {}),
          ...(ec ? { endCorner: ec } : {}),
        });
      }
      const supports = r.supports.map((sp, k) => {
        const f = faces[k % faces.length]!;
        const u0 = f.uLo + sp.at * (f.uHi - f.uLo);
        return {
          face: f.id,
          u0,
          u1: Math.min(f.uHi, u0 + sp.len),
          zTop: pitch.at(f.sigmaA + u0) + sp.dz,
        };
      });
      return {
        input: {
          faces,
          pitch: { inner: pitch, outer: pitch },
          upperOffset: r.dh,
          section: r.section,
          settings: r.settings,
        },
        supports,
        fit: { ...r.fit, tf: r.section.tf },
      };
    });
}

// ------------------------------------------------------------------------------ aides

const minSeg = (s: KneeSettings): number => Math.max(s.minSegmentLength, 1);
/** Constat de tronçon trop court (plus courte fibre < m, ou coupes croisées si < 0). */
const isShort = (i: BearingIssue): i is Extract<BearingIssue, { kind: "shortSegment" }> =>
  i.kind === "shortSegment" || i.kind === "cutsCross";
const shortIn = (res: BearingResult, faceId: string): boolean =>
  res.issues.some((i) => isShort(i) && i.faceId === faceId);

/**
 * Écart à l'onglet à la profondeur d (même convention que `miterFlangeGap`) : rives haute et
 * basse des deux barres en u = L_A + σc·d·t et u = −σc·d·t.
 */
function miterGapAt(
  a: FaceBearing,
  b: FaceBearing,
  L: number,
  corner: SteelCornerEnd,
  d: number,
): number {
  const sg = corner.joint === "landing" ? 0 : corner.concave ? 1 : -1;
  const ra = riveFns(a);
  const rb = riveFns(b);
  const uA = L + sg * d * corner.tanHalf;
  const uB = -sg * d * corner.tanHalf;
  return Math.max(Math.abs(ra.upper(uA) - rb.upper(uB)), Math.abs(ra.lower(uA) - rb.lower(uB)));
}

/**
 * Profondeurs d'échantillonnage de l'onglet : d = 0, shift, b, 17 profondeurs régulières et les
 * profondeurs où l'une des deux fibres d'onglet passe à l'abscisse d'un sommet de rive.
 */
function miterDepths(
  a: FaceBearing,
  b: FaceBearing,
  L: number,
  corner: SteelCornerEnd,
  sec: BearingSection,
): number[] {
  const out = [0, sec.shift, sec.b];
  for (let q = 1; q < 17; q++) out.push((sec.b * q) / 17);
  const sg = corner.joint === "landing" ? 0 : corner.concave ? 1 : -1;
  const k = sg * corner.tanHalf;
  if (Math.abs(k) > 1e-12) {
    for (const p of [...a.upperRive, ...a.lowerRive]) out.push((p.x - L) / k);
    for (const p of [...b.upperRive, ...b.lowerRive]) out.push(-p.x / k);
  }
  return out.filter((d) => d >= 0 && d <= sec.b);
}

/** Distance (signée) de q à la droite (a, b). */
function distToLine(q: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return ((q.x - a.x) * dy - (q.y - a.y) * dx) / Math.hypot(dx, dy);
}

const polyLength = (pts: readonly Vec2[]): number => {
  let l = 0;
  for (let i = 0; i + 1 < pts.length; i++)
    l += Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y);
  return l;
};

/** Paires de faces consécutives à un coin (face avant, face après). */
function cornerPairs(input: BearingInput): [BearingFace, BearingFace][] {
  const out: [BearingFace, BearingFace][] = [];
  for (const a of input.faces) {
    if (a.end !== "corner") continue;
    const b = input.faces.find(
      (x) =>
        x.side === a.side &&
        x.start === "corner" &&
        Math.abs(x.sigmaA - (a.sigmaA + a.faceLength)) < 1e-6,
    );
    if (b) out.push([a, b]);
  }
  return out;
}

const byId = (res: BearingResult, id: string): FaceBearing =>
  res.faces.find((f) => f.faceId === id)!;

/** Faces reliées à `id` par des raccords de palier (chaîne de K2f), `id` compris. */
function landingChainOf(input: BearingInput, id: string): Set<string> {
  const out = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const [a, b] of cornerPairs(input)) {
      if (cornerOf(a, "end")?.joint !== "landing" || cornerOf(b, "start")?.joint !== "landing") {
        continue;
      }
      if (out.has(a.id) !== out.has(b.id)) {
        out.add(a.id);
        out.add(b.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Segments (u0, z0)-(u1, z1) qui se coupent strictement. */
function segmentsCross(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const o = (a: Vec2, b: Vec2, c: Vec2): number =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = o(q1, q2, p1);
  const d2 = o(q1, q2, p2);
  const d3 = o(p1, p2, q1);
  const d4 = o(p1, p2, q2);
  return d1 * d2 < -1e-9 && d3 * d4 < -1e-9;
}

/**
 * Encombrement axial recalculé indépendamment : intersections des fibres (profondeur t) avec
 * les droites de coupe (aplomb, bissectrice), plus l'onglet en plan selon la profondeur d.
 */
function axialExtentOf(fb: FaceBearing, k: number, sec: BearingSection, face: BearingFace): number {
  const s = fb.segments[k]!;
  const e = { x: Math.cos(s.alpha), y: Math.sin(s.alpha) };
  const n = { x: Math.sin(s.alpha), y: -Math.cos(s.alpha) };
  const A = fb.upperRive[k]!;
  const B = fb.upperRive[k + 1]!;
  const cutAt = (which: "start" | "end", t: number): number => {
    const P0 = { x: A.x + t * n.x, y: A.y + t * n.y };
    const vtx = which === "start" ? A : B;
    const j = which === "start" ? k - 1 : k + 1;
    let dir: Vec2;
    if (j < 0 || j >= fb.segments.length) dir = { x: 0, y: 1 };
    else {
      const knee = fb.knees[which === "start" ? k - 1 : k]!;
      dir = { x: knee.lower.x - knee.upper.x, y: knee.lower.y - knee.upper.y };
    }
    // P0 + s·e = vtx + w·dir
    const det = e.x * -dir.y - e.y * -dir.x;
    return ((vtx.x - P0.x) * -dir.y - (vtx.y - P0.y) * -dir.x) / det;
  };
  const planShift = (which: "start" | "end", d: number): number => {
    const isEnd = which === "start" ? k === 0 : k + 1 === fb.segments.length;
    const c = isEnd ? cornerOf(face, which) : undefined;
    if (!c) return 0;
    const sg = c.joint === "landing" ? 0 : c.concave ? 1 : -1;
    return (sg * d * c.tanHalf) / Math.cos(s.alpha);
  };
  let lo = Infinity;
  let hi = -Infinity;
  for (const t of [0, sec.h]) {
    for (const d of [0, sec.b]) {
      lo = Math.min(lo, cutAt("start", t) - planShift("start", d));
      hi = Math.max(hi, cutAt("end", t) + planShift("end", d));
    }
  }
  return hi - lo;
}

// ------------------------------------------------------------------------------ propriétés

describe("profileBearing — propriétés (lignes synthétiques)", () => {
  it("ne lève jamais et I9 : indépendant de l'ordre des faces, répétable", () => {
    fc.assert(
      fc.property(synthArb(), fc.integer({ min: 0, max: 1000 }), ({ input }, seed) => {
        const res = profileBearings(input);
        const shuffled = [...input.faces].sort(
          (a, b) =>
            ((a.id.charCodeAt(1) * 7919 + seed) % 13) - ((b.id.charCodeAt(1) * 7919 + seed) % 13),
        );
        expect(profileBearings({ ...input, faces: shuffled })).toEqual(res);
        expect(profileBearings(input)).toEqual(res);
      }),
      { numRuns: RUNS },
    );
  });

  it("I2 : continuité aux jarrets (sommet bas sur les deux décalées) et aux onglets (bout d'aile)", () => {
    fc.assert(
      fc.property(synthArb(), ({ input }) => {
        const res = profileBearings(input);
        const h = input.section.h;
        for (const fb of res.faces) {
          fb.knees.forEach((k, i) => {
            expect(fb.upperRive[i + 1]!.x).toBeCloseTo(k.upper.x, 9);
            expect(fb.upperRive[i + 1]!.y).toBeCloseTo(k.upper.y, 9);
            const a = fb.upperRive[i]!;
            const b = fb.upperRive[i + 1]!;
            const c = fb.upperRive[i + 2]!;
            expect(Math.abs(distToLine(k.lower, a, b) - h)).toBeLessThan(1e-6);
            expect(Math.abs(distToLine(k.lower, b, c) - h)).toBeLessThan(1e-6);
            // Le sommet bas publié est celui de la rive basse (hors tronçon court, où
            // `lowerRiveOf` effondre un tronçon bas).
            if (!shortIn(res, fb.faceId)) {
              expect(Math.abs(fb.lowerRive[i + 1]!.x - k.lower.x)).toBeLessThan(1e-6);
              expect(Math.abs(fb.lowerRive[i + 1]!.y - k.lower.y)).toBeLessThan(1e-6);
            }
          });
        }
        for (const [a, b] of cornerPairs(input)) {
          if (shortIn(res, a.id) || shortIn(res, b.id)) continue;
          if (!byId(res, a.id) || !byId(res, b.id)) continue;
          const fa = byId(res, a.id);
          const fbB = byId(res, b.id);
          const corner = cornerOf(a, "end")!;
          const gap = miterFlangeGap(
            riveFns(fa),
            riveFns(fbB),
            a.faceLength,
            corner,
            input.section,
          );
          expect(gap.max).toBeLessThan(1e-6);
          // Profondeurs intermédiaires et sommets dans la portée de l'onglet.
          for (const d of miterDepths(fa, fbB, a.faceLength, corner, input.section)) {
            expect(miterGapAt(fa, fbB, a.faceLength, corner, d)).toBeLessThan(1e-6);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("I3 : fidélité à la ligne des nez hors des parties de niveau (réglages nuls), écart publié exact", () => {
    fc.assert(
      fc.property(synthArb(fc.constant(ZERO)), ({ input }) => {
        const res = profileBearings(input);
        const pitch = input.pitch.outer;
        const zones = res.corners.map((c) => {
          const fa = c.faceBefore ? input.faces.find((f) => f.id === c.faceBefore) : undefined;
          const fbF = c.faceAfter ? input.faces.find((f) => f.id === c.faceAfter) : undefined;
          // Raccord glissant (K2f) : la zone commence au départ du raccord sur le plat.
          const before = Math.max(c.lengthBefore, c.rampBefore ?? 0);
          const s0 = fa ? fa.sigmaA + fa.faceLength - before : fbF!.sigmaA;
          const s1 = fbF ? fbF.sigmaA + c.lengthAfter : fa!.sigmaA + fa!.faceLength;
          // Groupe fusionné : la zone couvre aussi les faces intérieures.
          return { s0: Math.min(s0, s1), s1: Math.max(s0, s1), z: c.z };
        });
        for (const fb of res.faces) {
          const f = input.faces.find((x) => x.id === fb.faceId)!;
          const covered = res.issues.some((i) => i.kind === "levelCoversFace" && i.faceId === f.id);
          let devMax = 0;
          pitch.xs.forEach((x, k) => {
            const u = x - f.sigmaA;
            if (u < f.uLo - 1e-6 || u > f.uHi + 1e-6) return;
            const B = polylineAt(fb.line, u);
            const P = pitch.ys[k]!;
            devMax = Math.max(devMax, Math.abs(B - P));
            const zone = zones.find((zn) => x > zn.s0 - 1e-6 && x < zn.s1 + 1e-6);
            const merged = res.issues.some(
              (i) => i.kind === "cornerMerged" && i.faceIds.includes(f.id),
            );
            if (zone || covered || merged) {
              if (zone) {
                expect(B).toBeGreaterThanOrEqual(Math.min(P, zone.z) - 1e-6);
                expect(B).toBeLessThanOrEqual(Math.max(P, zone.z) + 1e-6);
              }
              return;
            }
            // Retrait pour tronçon court dans la face ou dans une face de sa chaîne de raccords
            // de palier (K2f : une seule ligne nettoyée pour toute la chaîne).
            const chain = landingChainOf(input, f.id);
            const segRemoved = res.faces.some(
              (x) => chain.has(x.faceId) && x.removed.some((r) => r.reason === "segment"),
            );
            if (segRemoved) return;
            expect(Math.abs(B - P)).toBeLessThan(1e-6);
          });
          expect(fb.nosingDeviation.max).toBeCloseTo(devMax, 9);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("I3 (réglages quelconques) : B = P à chaque nez resté sommet", () => {
    fc.assert(
      fc.property(synthArb(), ({ input }) => {
        const res = profileBearings(input);
        const pitch = input.pitch.outer;
        for (const fb of res.faces) {
          const f = input.faces.find((x) => x.id === fb.faceId)!;
          for (let i = 1; i + 1 < fb.line.length; i++) {
            const q = fb.line[i]!;
            const k = pitch.xs.findIndex((x) => Math.abs(x - f.sigmaA - q.x) < 1e-9);
            if (k >= 0 && !fb.knees[i - 1]!.protected) expect(q.y).toBe(pitch.ys[k]);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("I6 (nettoyage) : chaque retrait est justifié au moment où il a lieu", () => {
    fc.assert(
      fc.property(synthArb(), ({ input }) => {
        const res = profileBearings(input);
        const m = minSeg(input.settings);
        const minA = deg(input.settings.minKneeAngle);
        for (const fb of res.faces) {
          for (const r of fb.removed) {
            if (r.reason === "collinear") expect(Math.abs(r.deltaAlpha)).toBeLessThan(1e-9);
            else if (r.reason === "angle") expect(Math.abs(r.deltaAlpha)).toBeLessThan(minA);
            else {
              // Tronçon voisin trop court au moment du retrait.
              expect(r.shortest).toBeDefined();
              expect(r.shortest!).toBeLessThan(m);
            }
          }
          // Sommets retenus hors parties de niveau : au moins l'angle minimal.
          for (const k of fb.knees) {
            if (!k.protected) expect(Math.abs(k.deltaAlpha)).toBeGreaterThanOrEqual(minA - 1e-12);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("constats exacts : nez au-dessus de la rive haute, raccords raides, déplacement d'extrémité", () => {
    fc.assert(
      fc.property(synthArb(), ({ input }) => {
        const res = profileBearings(input);
        const pitch = input.pitch.outer;
        const m = minSeg(input.settings);
        for (const fb of res.faces) {
          const f = input.faces.find((x) => x.id === fb.faceId)!;
          let above = 0;
          pitch.xs.forEach((x, k) => {
            const u = x - f.sigmaA;
            if (u < f.uLo - 1e-6 || u > f.uHi + 1e-6) return;
            above = Math.max(above, pitch.ys[k]! - (polylineAt(fb.line, u) + input.upperOffset));
          });
          const issue = res.issues.find((i) => i.kind === "noseAboveRive" && i.faceId === f.id);
          if (above > 1e-6) {
            expect(issue && issue.kind === "noseAboveRive" && issue.excess).toBeCloseTo(above, 9);
          } else expect(issue).toBeUndefined();
          for (const i of res.issues) {
            if (i.kind !== "steepSegment" || i.faceId !== f.id) continue;
            const s = fb.segments.find((x) => x.u0 === i.u0)!;
            expect(s.level).toBe(false);
            expect(s.u1 - s.u0).toBeLessThan(m);
            expect(s.fibres.shortest).toBeGreaterThanOrEqual(m - 1e-9);
          }
          expect(fb.endShift.start).toBeCloseTo(
            polylineAt(fb.line, f.uLo) - pitch.at(f.sigmaA + f.uLo),
            9,
          );
          expect(fb.endShift.end).toBeCloseTo(
            polylineAt(fb.line, f.uHi) - pitch.at(f.sigmaA + f.uHi),
            9,
          );
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("I4 : pavage des tronçons, fibres haute et basse = longueurs de rive, encombrement axial", () => {
    fc.assert(
      fc.property(synthArb(), ({ input }) => {
        const res = profileBearings(input);
        const sec = input.section;
        for (const fb of res.faces) {
          const f = input.faces.find((x) => x.id === fb.faceId)!;
          const segs = fb.segments;
          expect(segs[0]!.u0).toBe(f.uLo);
          expect(segs[segs.length - 1]!.u1).toBe(f.uHi);
          for (let k = 0; k + 1 < segs.length; k++) expect(segs[k]!.u1).toBe(segs[k + 1]!.u0);
          for (const s of segs) {
            expect(s.fibres.axialExtent).toBeGreaterThanOrEqual(s.fibres.longest - 1e-9);
            expect(s.fibres.longest).toBeGreaterThanOrEqual(s.fibres.shortest - 1e-9);
          }
          if (shortIn(res, f.id)) continue;
          // Prolongement de l'âme à l'onglet (développé : L + miterOffset).
          const off = (which: "start" | "end"): number => {
            const c = cornerOf(f, which);
            if (!c) return 0;
            const sg = c.joint === "landing" ? 0 : c.concave ? 1 : -1;
            const seg = which === "start" ? segs[0]! : segs[segs.length - 1]!;
            return (sg * sec.shift * c.tanHalf) / Math.cos(seg.alpha);
          };
          const extra = off("start") + off("end");
          const sumUp = segs.reduce((a, s) => a + s.fibres.upper, 0);
          const sumLow = segs.reduce((a, s) => a + s.fibres.lower, 0);
          expect(Math.abs(sumUp - polyLength(fb.upperRive) - extra)).toBeLessThan(1e-6);
          expect(Math.abs(sumLow - polyLength(fb.lowerRive) - extra)).toBeLessThan(1e-6);
          segs.forEach((s, k) => {
            expect(Math.abs(s.fibres.axialExtent - axialExtentOf(fb, k, sec, f))).toBeLessThan(
              1e-6,
            );
          });
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("I5 : longueur logée croissante en h, besoin minimal par dichotomie", () => {
    fc.assert(
      fc.property(
        synthArb(),
        fc.double({ min: 0, max: 600, noNaN: true }),
        fc.double({ min: 0, max: 600, noNaN: true }),
        ({ input, supports, fit }, ha, hb) => {
          const res = profileBearings(input);
          const [h1, h2] = ha < hb ? [ha, hb] : [hb, ha];
          for (const sp of supports) {
            const fb = byId(res, sp.face);
            if (!fb) continue;
            const f = (h: number): number => {
              const r = fitInWebPolyline(fb.upperRive, lowerRiveOf(fb.upperRive, h), sp, fit);
              return r.u1 - r.u0;
            };
            expect(f(h1)).toBeLessThanOrEqual(f(h2) + 1e-9);
            const need = supportHeightNeed(fb.upperRive, sp, fit);
            if (need === 0) {
              // Besoin nul : h = 0 suffit, ou la hauteur n'y peut rien (rive haute seule).
              const top = fitInWebPolyline(fb.upperRive, null, sp, fit);
              expect(f(0) >= fit.minLength - 1e-6 || top.u1 - top.u0 < fit.minLength).toBe(true);
            }
            if (need > 1e-3) {
              expect(f(need)).toBeGreaterThanOrEqual(fit.minLength - 1e-6);
              expect(f(need - 1e-3)).toBeLessThan(fit.minLength);
            }
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("I6 : tronçons réalisables, rive basse croissante, coupes de jarret sans croisement, angles minimaux", () => {
    fc.assert(
      fc.property(synthArb(), ({ input }) => {
        const res = profileBearings(input);
        const m = minSeg(input.settings);
        const minA = deg(input.settings.minKneeAngle);
        for (const fb of res.faces) {
          fb.segments.forEach((s, k) => {
            if (s.fibres.shortest >= m - 1e-9) return;
            // Tronçon trop court : déclaré, et aucune de ses extrémités n'est retirable.
            expect(
              res.issues.some((i) => isShort(i) && i.faceId === fb.faceId && i.u0 === s.u0),
            ).toBe(true);
            // Coupes croisées si et seulement si la plus courte fibre est négative.
            expect(
              res.issues.some(
                (i) => i.kind === "cutsCross" && i.faceId === fb.faceId && i.u0 === s.u0,
              ),
            ).toBe(s.fibres.shortest < -1e-9);
            for (const j of [k - 1, k]) {
              const knee = fb.knees[j];
              if (knee) expect(knee.protected).toBe(true);
            }
          });
          if (!shortIn(res, fb.faceId)) {
            for (let i = 0; i + 1 < fb.lowerRive.length; i++) {
              expect(fb.lowerRive[i + 1]!.x).toBeGreaterThan(fb.lowerRive[i]!.x);
            }
            for (let i = 0; i + 1 < fb.knees.length; i++) {
              const a = fb.knees[i]!;
              const b = fb.knees[i + 1]!;
              expect(segmentsCross(a.upper, a.lower, b.upper, b.lower)).toBe(false);
            }
          }
          for (const k of fb.knees) {
            if (!k.protected) expect(Math.abs(k.deltaAlpha)).toBeGreaterThanOrEqual(minA - 1e-12);
          }
          // La ligne d'appui reste croissante (corde d'une ligne croissante).
          for (let i = 0; i + 1 < fb.line.length; i++) {
            expect(fb.line[i + 1]!.x).toBeGreaterThan(fb.line[i]!.x);
            expect(fb.line[i + 1]!.y).toBeGreaterThanOrEqual(fb.line[i]!.y - 1e-9);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("I7 : logement exact, contraintes vérifiées aux bornes et aux sommets, partie maximale", () => {
    fc.assert(
      fc.property(synthArb(), ({ input, supports, fit }) => {
        const res = profileBearings(input);
        for (const sp of supports) {
          const fb = byId(res, sp.face);
          if (!fb) continue;
          const up = fb.upperRive;
          const low = fb.lowerRive;
          const zBot = sp.zTop - fit.depth - fit.edge;
          const g = (u: number): number =>
            Math.min(polylineAt(up, u) - fit.tf - sp.zTop, zBot - polylineAt(low, u) - fit.tf);
          const r = fitInWebPolyline(up, low, sp, fit);
          if (r.u1 - r.u0 <= 0) continue;
          const xs = [
            r.u0,
            r.u1,
            ...[...up, ...low].map((q) => q.x).filter((x) => x > r.u0 && x < r.u1),
          ];
          for (const x of xs) expect(g(x)).toBeGreaterThanOrEqual(-1e-6);
          if (r.u0 - 1e-3 >= sp.u0) expect(g(r.u0 - 1e-3)).toBeLessThan(0);
          if (r.u1 + 1e-3 <= sp.u1) expect(g(r.u1 + 1e-3)).toBeLessThan(0);
        }
      }),
      { numRuns: RUNS },
    );
  });
});

// ------------------------------------------------------------------------------ cas chiffrés

/** Une face sur une ligne des nez donnée (départ au sol, arrivée), fenêtre [0 ; L]. */
function single(knots: { x: number; y: number }[], settings: KneeSettings = ZERO, sec = UPN200) {
  const pitch = new PiecewiseLinear(knots);
  const L = knots[knots.length - 1]!.x - knots[0]!.x;
  const face: BearingFace = {
    id: "F1",
    side: "outer",
    sigmaA: knots[0]!.x,
    faceLength: L,
    uLo: 0,
    uHi: L,
    start: "floor",
    end: "arrival",
  };
  return profileBearings({
    faces: [face],
    pitch: { inner: pitch, outer: pitch },
    upperOffset: 50,
    section: sec,
    settings,
  });
}

/** Deux faces sur une ligne de pente constante, coin au milieu. */
function twoFaces(corner: SteelCornerEnd, slope: number, settings: KneeSettings, sec = UPN200) {
  const knots = Array.from({ length: 11 }, (_, k) => ({ x: 250 * k, y: 250 * k * slope }));
  const pitch = new PiecewiseLinear(knots);
  const A: BearingFace = {
    id: "A",
    side: "outer",
    sigmaA: 0,
    faceLength: 1250,
    uLo: 0,
    uHi: 1250,
    start: "floor",
    end: "corner",
    endCorner: corner,
  };
  const B: BearingFace = {
    id: "B",
    side: "outer",
    sigmaA: 1250,
    faceLength: 1250,
    uLo: 0,
    uHi: 1250,
    start: "corner",
    end: "arrival",
    startCorner: corner,
  };
  const input: BearingInput = {
    faces: [A, B],
    pitch: { inner: pitch, outer: pitch },
    upperOffset: 50,
    section: sec,
    settings,
  };
  return { input, res: profileBearings(input), pitch };
}

describe("profileBearing — cas chiffrés", () => {
  it("réglages : défauts provisoires, bornes", () => {
    expect(PROVISIONAL_KNEE_SETTINGS).toEqual({ minSegmentLength: 50, minKneeAngle: 0.5 });
    expect(KneeSettingsSchema.safeParse({ minKneeAngle: 46 }).success).toBe(false);
    expect(KneeSettingsSchema.safeParse({ minSegmentLength: 12.5 }).success).toBe(false);
  });

  it("(a) une seule pente : un tronçon égal à la corde", () => {
    const res = single(Array.from({ length: 8 }, (_, k) => ({ x: 280 * k, y: 175 * k })));
    const fb = res.faces[0]!;
    expect(fb.segments).toHaveLength(1);
    expect(fb.knees).toHaveLength(0);
    expect(fb.segments[0]!.alpha).toBeCloseTo(Math.atan(175 / 280), 12);
    expect(fb.nosingDeviation.max).toBeLessThan(1e-9);
    expect(res.issues).toEqual([]);
  });

  it("(b) parties de niveau : λA = m + h·tan(α_A/2), λB = m (rentrant) ; + b·t (saillant)", () => {
    const m = 50;
    const settings = { minSegmentLength: m, minKneeAngle: 0 };
    for (const [corner, sail] of [
      [{ joint: "wall", concave: true, tanHalf: 1 }, 0],
      [{ joint: "jour", concave: false, tanHalf: 1 }, 75],
    ] as const) {
      const { res, pitch } = twoFaces(corner, Math.tan(deg(30)), settings);
      const c = res.corners[0]!;
      expect(c.merged).toBe(false);
      expect(c.z).toBeCloseTo(pitch.at(1250), 9);
      expect(c.lengthAfter).toBeCloseTo(m + sail, 6);
      // Pente du raccord avant la partie de niveau de A.
      const A = byId(res, "A");
      const rac = A.segments[A.segments.length - 2]!;
      expect(rac.alpha).toBeGreaterThan(0);
      const lambdaA = m + sail + 200 * Math.tan(rac.alpha / 2);
      const levelA = A.segments[A.segments.length - 1]!.fibres.shortest;
      // Valeurs recalculées indépendamment (balayage de λ au pas de 1e-4, relecture K2a).
      expect(c.lengthBefore).toBeCloseTo(sail === 0 ? 162.9127 : 250, 3);
      if (sail === 0) {
        // Rentrant : le point fixe tombe entre deux nez, égalité.
        expect(c.lengthBefore).toBeCloseTo(lambdaA, 6);
        expect(levelA).toBeCloseTo(m, 6);
      } else {
        // Saillant : le raccord depuis le nez du coin serait trop raide, le jarret recule au nez
        // précédent (plus petit λ admissible), la partie de niveau dépasse alors le minimum.
        expect(c.lengthBefore).toBeGreaterThanOrEqual(lambdaA - 1e-6);
        expect(levelA).toBeGreaterThanOrEqual(m - 1e-6);
      }
      expect(byId(res, "B").segments[0]!.fibres.shortest).toBeCloseTo(m, 6);
    }
    // Formule de la conception (raccord à 30°) : 200·tan 15° + 50 ≈ 103,59 ; saillant 178,59.
    expect(200 * Math.tan(deg(15)) + 50).toBeCloseTo(103.59, 2);
  });

  it("(c) face centrale courte : coins fusionnés, de niveau à P(σ du milieu)", () => {
    const knots = Array.from({ length: 13 }, (_, k) => ({ x: 250 * k, y: 175 * k }));
    const pitch = new PiecewiseLinear(knots);
    const wall: SteelCornerEnd = { joint: "wall", concave: true, tanHalf: 1 };
    const faces: BearingFace[] = [
      {
        id: "A",
        side: "outer",
        sigmaA: 0,
        faceLength: 1400,
        uLo: 0,
        uHi: 1400,
        start: "floor",
        end: "corner",
        endCorner: wall,
      },
      {
        id: "B",
        side: "outer",
        sigmaA: 1400,
        faceLength: 60,
        uLo: 0,
        uHi: 60,
        start: "corner",
        end: "corner",
        startCorner: wall,
        endCorner: wall,
      },
      {
        id: "C",
        side: "outer",
        sigmaA: 1460,
        faceLength: 1540,
        uLo: 0,
        uHi: 1540,
        start: "corner",
        end: "arrival",
        startCorner: wall,
      },
    ];
    const res = profileBearings({
      faces,
      pitch: { inner: pitch, outer: pitch },
      upperOffset: 50,
      section: UPN200,
      settings: PROVISIONAL_KNEE_SETTINGS,
    });
    expect(res.issues).toContainEqual({ kind: "cornerMerged", faceIds: ["A", "B", "C"] });
    expect(res.corners).toHaveLength(1);
    const zMid = pitch.at(1430);
    expect(res.corners[0]!.z).toBeCloseTo(zMid, 9);
    const B = byId(res, "B");
    expect(B.segments).toHaveLength(1);
    expect(B.line.every((q) => Math.abs(q.y - zMid) < 1e-9)).toBe(true);
    const gap = (a: string, b: string, L: number) =>
      miterFlangeGap(riveFns(byId(res, a)), riveFns(byId(res, b)), L, wall, UPN200).max;
    expect(gap("A", "B", 1400)).toBeLessThan(1e-9);
    expect(gap("B", "C", 60)).toBeLessThan(1e-9);
  });

  it("(c') face entre deux onglets saillants plus courte que 2·b·tan(φ/2) : coupes croisées", () => {
    const knots = Array.from({ length: 13 }, (_, k) => ({ x: 250 * k, y: 175 * k }));
    const pitch = new PiecewiseLinear(knots);
    const jour: SteelCornerEnd = { joint: "jour", concave: false, tanHalf: Math.tan(deg(30)) };
    // HEA 260 : b = 260, t_w = 7,5 ; 2·b·tan 30° ≈ 300 mm > 150 mm de face.
    const hea: BearingSection = { h: 250, b: 260, shift: (260 - 7.5) / 2, tf: 12.5 };
    const faces: BearingFace[] = [
      {
        id: "A",
        side: "inner",
        sigmaA: 0,
        faceLength: 1400,
        uLo: 0,
        uHi: 1400,
        start: "floor",
        end: "corner",
        endCorner: jour,
      },
      {
        id: "B",
        side: "inner",
        sigmaA: 1400,
        faceLength: 150,
        uLo: 0,
        uHi: 150,
        start: "corner",
        end: "corner",
        startCorner: jour,
        endCorner: jour,
      },
      {
        id: "C",
        side: "inner",
        sigmaA: 1550,
        faceLength: 1450,
        uLo: 0,
        uHi: 1450,
        start: "corner",
        end: "arrival",
        startCorner: jour,
      },
    ];
    const res = profileBearings({
      faces,
      pitch: { inner: pitch, outer: pitch },
      upperOffset: 50,
      section: hea,
      settings: PROVISIONAL_KNEE_SETTINGS,
    });
    const B = byId(res, "B");
    expect(B.segments[0]!.fibres.shortest).toBeLessThan(0);
    expect(res.issues).toContainEqual({
      kind: "cutsCross",
      faceId: "B",
      u0: 0,
      shortest: B.segments[0]!.fibres.shortest,
    });
    expect(res.issues.some((i) => i.kind === "shortSegment" && i.faceId === "B")).toBe(false);
  });

  it("(d) fibres d'un creux à 30° calculées à la main ; deux aplombs : Δu/cos α + h·tan α", () => {
    const t30 = Math.tan(deg(30));
    const res = single([
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 2000, y: 1000 * t30 },
    ]);
    const [s0, s1] = byId(res, "F1").segments;
    const t15 = Math.tan(deg(15));
    expect(s0!.fibres.upper).toBeCloseTo(1000, 9);
    expect(s0!.fibres.lower).toBeCloseTo(1000 + 200 * t15, 9);
    expect(s0!.fibres.axialExtent).toBeCloseTo(1000 + 200 * t15, 9);
    const ell = 1000 / Math.cos(deg(30));
    expect(s1!.fibres.upper).toBeCloseTo(ell, 9);
    expect(s1!.fibres.lower).toBeCloseTo(ell + 200 * (t15 - t30), 9);
    expect(s1!.fibres.shortest).toBeCloseTo(ell + 200 * (t15 - t30), 9);
    expect(s1!.fibres.longest).toBeCloseTo(ell, 9);
    expect(s1!.fibres.axialExtent).toBeCloseTo(ell + 200 * t15, 9);
    const knee = byId(res, "F1").knees[0]!;
    expect(knee.beta).toBeCloseTo(deg(15), 12);
    expect(knee.lower.x).toBeCloseTo(1000 + 200 * t15, 9);
    expect(knee.lower.y).toBeCloseTo(50 - 200, 9);
    // Une seule pente, deux aplombs.
    const one = single([
      { x: 0, y: 0 },
      { x: 1200, y: 750 },
    ]).faces[0]!.segments[0]!;
    const a = Math.atan(750 / 1200);
    expect(one.fibres.axialExtent).toBeCloseTo(1200 / Math.cos(a) + 200 * Math.tan(a), 9);
  });

  it("(e) nettoyage : à |Δα| égal, le sommet de plus petit u est retiré le premier", () => {
    const a0 = deg(30);
    const a1 = deg(30.2);
    const a2 = deg(30.4);
    const knots = [{ x: 0, y: 0 }];
    for (const a of [a0, a1, a2]) {
      const p = knots[knots.length - 1]!;
      knots.push({ x: p.x + 500, y: p.y + 500 * Math.tan(a) });
    }
    const res = single(knots, { minSegmentLength: 0, minKneeAngle: 0.3 });
    const fb = res.faces[0]!;
    expect(fb.removed[0]!.u).toBeCloseTo(500, 9);
    expect(fb.removed[0]!.reason).toBe("angle");
  });

  it("(e') nettoyage près d'une extrémité : le tronçon suivant est prolongé jusqu'à l'extrémité", () => {
    // Premier nez à 30 mm du départ (tronçon d'extrémité < m = 50) : il est retiré et la ligne
    // d'appui prolonge le tronçon suivant jusqu'à u = 0 au lieu de tirer la corde depuis P(0).
    const knots = [
      { x: 0, y: 0 },
      { x: 30, y: 6 },
      { x: 310, y: 181 },
      { x: 590, y: 356 },
      { x: 870, y: 531 },
    ];
    const res = single(knots, { minSegmentLength: 50, minKneeAngle: 0 });
    const fb = res.faces[0]!;
    expect(fb.removed.map((r) => r.reason)).toContain("segment");
    expect(fb.removed.find((r) => r.reason === "segment")!.u).toBe(30);
    const slope = 175 / 280;
    const z0 = 6 - 30 * slope;
    expect(fb.line[0]!.x).toBe(0);
    expect(fb.line[0]!.y).toBeCloseTo(z0, 9);
    expect(fb.segments).toHaveLength(1);
    expect(fb.endShift.start).toBeCloseTo(z0, 9);
    expect(fb.endShift.end).toBeCloseTo(0, 9);
    // Ici le départ est un nœud de la ligne des nez, l'écart aux nœuds le voit aussi ; sur une
    // face réelle (fenêtre qui ne commence pas à un nœud), seul `endShift` le publie.
    expect(fb.nosingDeviation.max).toBeCloseTo(Math.abs(z0), 9);
  });

  it("(f) corde en pente commune : écart au bout d'aile = 2·m·(b − shift)·tan(φ/2)", () => {
    const slope = 0.5;
    const b = 75;
    const shift = 10;
    const t = 1;
    const A = chordRives({ u0: 0, z0: 0, slope }, 50, 200);
    // B aligné sur A au droit de l'âme : T_B(−shift·t) = T_A(L + shift·t).
    const B = chordRives({ u0: 0, z0: slope * (1000 + 2 * shift * t), slope }, 50, 200);
    const g = miterFlangeGap(
      A,
      B,
      1000,
      { joint: "wall", concave: true, tanHalf: t },
      { b, shift },
    );
    expect(g.web).toBeCloseTo(0, 9);
    expect(g.flangeTip).toBeCloseTo(2 * slope * (b - shift) * t, 9);
    expect(g.faceSide).toBeCloseTo(2 * slope * shift * t, 9);
  });

  it("logement : une seule pente, égal à la forme fermée de fitInWeb et de heightNeedOf", () => {
    const slope = 0.6;
    const alpha = Math.atan(slope);
    const dh = 50;
    const line = { u0: 0, z0: 0, slope };
    const top = (u: number): number => slope * u + dh;
    const upper = [
      { x: -100, y: top(-100) },
      { x: 3000, y: top(3000) },
    ];
    const p: WebFitParams = { depth: 40, edge: 10, tf: 8, minLength: 50 };
    for (const [u0, zTop] of [
      [500, 330],
      [800, 520],
      [1200, 700],
    ] as const) {
      const c = { u0, u1: u0 + 250, zTop };
      for (const h of [120, 180, 240]) {
        const Hv = h / Math.cos(alpha);
        const uA = (zTop + p.tf - dh) / slope;
        const uB = (zTop - p.depth - p.edge - p.tf + Hv - dh) / slope;
        const lo = Math.max(c.u0, uA);
        const hi = Math.min(c.u1, uB);
        const r = fitInWebPolyline(upper, lowerRiveOf(upper, h), c, p);
        if (hi > lo) {
          expect(r.u0).toBeCloseTo(lo, 6);
          expect(r.u1).toBeCloseTo(hi, 6);
        } else expect(r.u1 - r.u0).toBe(0);
      }
      const a = Math.max(c.u0, (zTop + p.tf - dh) / slope);
      const closed =
        c.u1 - a < p.minLength
          ? 0
          : (top(a + p.minLength) + p.tf - (zTop - p.depth - p.edge)) * Math.cos(alpha);
      expect(Math.abs(supportHeightNeed(upper, c, p) - closed)).toBeLessThan(1e-6);
      void line;
    }
    const chord = chordRives(line, dh, 200);
    expect(chord.upper(100)).toBeCloseTo(top(100), 12);
    expect(chord.upper(100) - chord.lower(100)).toBeCloseTo(200 / Math.cos(alpha), 9);
  });

  it("logement : deux parties admissibles, la plus longue est rendue", () => {
    // Rive haute en V : dessus admissible sur [0 ; 20] puis sur [130 ; 200].
    const upper = [
      { x: 0, y: 100 },
      { x: 40, y: 0 },
      { x: 60, y: 0 },
      { x: 200, y: 100 },
    ];
    const p: WebFitParams = { depth: 40, edge: 10, tf: 0, minLength: 50 };
    const r = fitInWebPolyline(upper, null, { u0: 0, u1: 200, zTop: 50 }, p);
    expect(r.u0).toBeCloseTo(130, 9);
    expect(r.u1).toBeCloseTo(200, 9);
    // Trop court même à hauteur infinie : besoin 0 (support perdu, relevé par `faceHeightNeed`).
    expect(supportHeightNeed(upper, { u0: 0, u1: 40, zTop: 50 }, p)).toBe(0);
  });

  it("besoin de face : maximum des supports, marche déterminante et supports perdus", () => {
    const res = single(Array.from({ length: 8 }, (_, k) => ({ x: 280 * k, y: 175 * k })));
    const fb = res.faces[0]!;
    const p: WebFitParams = { depth: 40, edge: 10, tf: 0, minLength: 50 };
    const z = (u: number): number => (175 / 280) * u;
    const r = faceHeightNeed(
      fb,
      [
        // Dessus 30 mm sous la rive haute au départ : besoin (50·m + 30 + 50)·cos α.
        { u0: 300, u1: 550, zTop: z(300) + 20, tread: 2 },
        // Dessus 50 mm sous la rive haute au départ : besoin (50·m + 50 + 50)·cos α.
        { u0: 600, u1: 850, zTop: z(600), tread: 3 },
        // Dessus au-dessus de la rive haute sur toute la longueur : perdu.
        { u0: 900, u1: 1000, zTop: z(1000) + 500, tread: 4 },
      ],
      p,
    );
    expect(r.worstTread).toBe(3);
    expect(r.lost).toEqual([4]);
    const a = Math.atan(175 / 280);
    expect(r.need).toBeCloseTo((50 * Math.tan(a) + 100) * Math.cos(a), 5);
  });

  it("ne lève jamais : fenêtre vide, un seul nez, face plus courte que la partie de niveau", () => {
    const one = new PiecewiseLinear([{ x: 0, y: 170 }]);
    const wall: SteelCornerEnd = { joint: "wall", concave: true, tanHalf: 1 };
    const res = profileBearings({
      faces: [
        {
          id: "E",
          side: "outer",
          sigmaA: 0,
          faceLength: 0,
          uLo: 0,
          uHi: 0,
          start: "newel",
          end: "newel",
        },
        {
          id: "Z",
          side: "outer",
          sigmaA: 0,
          faceLength: Number.NaN,
          uLo: 0,
          uHi: 100,
          start: "newel",
          end: "newel",
        },
        {
          id: "S",
          side: "outer",
          sigmaA: 0,
          faceLength: 30,
          uLo: 0,
          uHi: 30,
          start: "floor",
          end: "corner",
          endCorner: wall,
        },
        {
          id: "T",
          side: "inner",
          sigmaA: 0,
          faceLength: 30,
          uLo: 0,
          uHi: 30,
          start: "corner",
          end: "arrival",
        },
      ],
      pitch: { inner: one, outer: one },
      upperOffset: 50,
      section: UPN200,
      settings: PROVISIONAL_KNEE_SETTINGS,
    });
    expect(res.issues).toContainEqual({ kind: "emptyWindow", faceId: "E" });
    expect(res.issues).toContainEqual({ kind: "emptyWindow", faceId: "Z" });
    expect(res.issues).toContainEqual({ kind: "levelCoversFace", faceId: "S" });
    expect(res.issues).toContainEqual({ kind: "unpairedCorner", faceId: "S", which: "end" });
    expect(res.issues).toContainEqual({ kind: "unpairedCorner", faceId: "T", which: "start" });
    expect(res.faces.map((f) => f.faceId)).toEqual(["S", "T"]);
    // Face sans coin plus courte que la longueur minimale (poteau à poteau) : ligne des nez.
    const pitch = new PiecewiseLinear([
      { x: 0, y: 170 },
      { x: 250, y: 345 },
    ]);
    const short = profileBearings({
      faces: [
        {
          id: "N",
          side: "inner",
          sigmaA: 100,
          faceLength: 20,
          uLo: 0,
          uHi: 20,
          start: "newel",
          end: "newel",
        },
      ],
      pitch: { inner: pitch, outer: pitch },
      upperOffset: 50,
      section: UPN200,
      settings: PROVISIONAL_KNEE_SETTINGS,
    });
    expect(short.issues).toEqual([
      { kind: "shortSegment", faceId: "N", u0: 0, shortest: expect.any(Number) },
    ]);
    expect(short.faces[0]!.line).toEqual([
      { x: 0, y: pitch.at(100) },
      { x: 20, y: pitch.at(120) },
    ]);
  });
});

// ------------------------------------------------------------------------------ paliers (K2f)

/** Pente la plus forte de la ligne des nez sur la fenêtre d'une face (référence α_ref). */
function pitchMaxOf(pitch: PiecewiseLinear, f: BearingFace): number {
  let out = -Infinity;
  for (let k = 0; k + 1 < pitch.xs.length; k++) {
    const a = pitch.xs[k]! - f.sigmaA;
    const b = pitch.xs[k + 1]! - f.sigmaA;
    if (b <= f.uLo || a >= f.uHi || !(b > a)) continue;
    out = Math.max(out, Math.atan2(pitch.ys[k + 1]! - pitch.ys[k]!, b - a));
  }
  return out;
}

describe("profileBearing — paliers du limon coudé (sous-lot K2f)", () => {
  it("propriété : raccord de palier entre deux faces (chaîne) : rives et pente continues, aucune partie de niveau ni jarret au raccord", () => {
    let seen = 0;
    fc.assert(
      fc.property(synthArb(), ({ input }) => {
        const res = profileBearings(input);
        for (const [a, b] of cornerPairs(input)) {
          if (
            cornerOf(a, "end")?.joint !== "landing" ||
            cornerOf(b, "start")?.joint !== "landing"
          ) {
            continue;
          }
          const fa = byId(res, a.id);
          const fb = byId(res, b.id);
          if (!fa || !fb) continue;
          // Aucune partie de niveau rendue pour un raccord de palier.
          expect(res.corners.some((c) => c.faceBefore === a.id && c.faceAfter === b.id)).toBe(
            false,
          );
          seen++;
          // Ligne continue (même altitude au raccord) et même pente de part et d'autre.
          const za = fa.line[fa.line.length - 1]!.y;
          const zb = fb.line[0]!.y;
          expect(Math.abs(za - zb)).toBeLessThan(1e-9);
          const la = fa.segments[fa.segments.length - 1]!;
          const lb = fb.segments[0]!;
          expect(Math.abs(la.alpha - lb.alpha)).toBeLessThan(1e-9);
          // Coupes d'aplomb aux extrémités du raccord : rives haute et basse jointives (rive basse
          // hors tronçon trop court, où `lowerRiveOf` effondre un tronçon bas).
          const ra = riveFns(fa);
          const rb = riveFns(fb);
          expect(Math.abs(ra.upper(a.faceLength) - rb.upper(0))).toBeLessThan(1e-9);
          if (shortIn(res, a.id) || shortIn(res, b.id)) continue;
          expect(Math.abs(ra.lower(a.faceLength) - rb.lower(0))).toBeLessThan(1e-6);
        }
      }),
      { numRuns: RUNS },
    );
    expect(seen).toBeGreaterThan(0);
  });

  it("propriété : raccord glissant (rampBefore) : départ sur le plat de la ligne des nez, pente ≤ α_ref, aucun nez au-dessus de la ligne d'appui", () => {
    let seen = 0;
    fc.assert(
      fc.property(synthArb(), ({ input }) => {
        const res = profileBearings(input);
        const pitch = input.pitch.outer;
        for (const c of res.corners) {
          if (c.rampBefore === undefined || !c.faceBefore) continue;
          const f = input.faces.find((x) => x.id === c.faceBefore)!;
          const fb = byId(res, f.id);
          const s = f.faceLength - c.rampBefore;
          if (s < f.uLo) continue; // départ dans une face précédente de la chaîne
          seen++;
          // Le départ est sur la ligne des nez (plat du palier) et y reste un sommet.
          expect(Math.abs(polylineAt(fb.line, s) - pitch.at(f.sigmaA + s))).toBeLessThan(1e-6);
          const k = fb.line.findIndex((q) => Math.abs(q.x - s) < 1e-9);
          expect(k).toBeGreaterThanOrEqual(0);
          // Raccord à la pente de référence (au plus) jusqu'à la partie de niveau du coin.
          const ref = pitchMaxOf(pitch, f);
          const seg = fb.segments.find((x) => Math.abs(x.u0 - s) < 1e-9)!;
          expect(seg.alpha).toBeLessThanOrEqual(ref + 1e-9);
          expect(seg.alpha).toBeGreaterThan(0);
          // Ligne d'appui au-dessus de la ligne des nez entre le départ et le coin.
          pitch.xs.forEach((x, j) => {
            const u = x - f.sigmaA;
            if (u < s - 1e-9 || u > f.uHi + 1e-9) return;
            expect(polylineAt(fb.line, u)).toBeGreaterThanOrEqual(pitch.ys[j]! - 1e-6);
          });
        }
      }),
      { numRuns: RUNS },
    );
    expect(seen).toBeGreaterThan(0);
  });

  it("propriété : plat de palier suivi de niveau par la ligne d'appui, sinon constat `landingNotLevel` (hors raccord glissant) ; partie de niveau relevée au niveau d'un palier qui suit le coin (relecture K2f)", () => {
    let flats = 0;
    let raised = 0;
    fc.assert(
      fc.property(synthArb(), ({ input }) => {
        const res = profileBearings(input);
        for (const fb of res.faces) {
          const f = input.faces.find((x) => x.id === fb.faceId)!;
          const pitch = input.pitch[f.side];
          // Départ du raccord glissant (σ), lu sur le coin de fin de la chaîne de palier de la
          // face : il peut tomber dans un membre précédent de la chaîne.
          let rampSigma: number | undefined;
          for (const c of res.corners) {
            if (c.rampBefore === undefined || !c.faceBefore) continue;
            if (!landingChainOf(input, c.faceBefore).has(f.id)) continue;
            const fe = input.faces.find((x) => x.id === c.faceBefore)!;
            rampSigma = fe.sigmaA + fe.faceLength - c.rampBefore;
          }
          for (let k = 0; k + 1 < pitch.xs.length; k++) {
            const zf = pitch.ys[k]!;
            if (Math.abs(pitch.ys[k + 1]! - zf) > 1e-9 || !(pitch.xs[k + 1]! > pitch.xs[k]!)) {
              continue;
            }
            const a = Math.max(pitch.xs[k]! - f.sigmaA, f.uLo);
            let b = Math.min(pitch.xs[k + 1]! - f.sigmaA, f.uHi);
            if (rampSigma !== undefined) b = Math.min(b, rampSigma - f.sigmaA);
            if (!(b - a > 1e-6)) continue;
            flats++;
            const us = [a, b, ...fb.line.map((q) => q.x).filter((u) => u > a && u < b)];
            const dev = Math.max(...us.map((u) => Math.abs(polylineAt(fb.line, u) - zf)));
            if (dev <= 1e-6) continue;
            expect(
              res.issues.some(
                (i) =>
                  i.kind === "landingNotLevel" &&
                  i.faceId === f.id &&
                  i.u0 < b + 1e-6 &&
                  i.u1 > a - 1e-6 &&
                  i.excess >= dev - 1e-6,
              ),
              `${f.id} plat [${a} ; ${b}] écart ${dev}`,
            ).toBe(true);
          }
        }
        // Partie de niveau au-dessus de la ligne des nez au coin : seulement au niveau d'un plat
        // de palier qui commence après le coin (relèvement), jamais au-dessus de lui.
        for (const c of res.corners) {
          if (c.merged || !c.faceAfter || !c.faceBefore) continue;
          const f = input.faces.find((x) => x.id === c.faceAfter)!;
          const pitch = input.pitch[f.side];
          if (!(c.z > pitch.at(f.sigmaA) + 1e-9)) continue;
          raised++;
          const k = pitch.xs.findIndex(
            (x, j) =>
              x > f.sigmaA &&
              j + 1 < pitch.xs.length &&
              Math.abs(pitch.ys[j]! - c.z) < 1e-9 &&
              Math.abs(pitch.ys[j + 1]! - c.z) < 1e-9,
          );
          expect(k, `${c.faceBefore} → ${c.faceAfter}`).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: RUNS },
    );
    expect(flats).toBeGreaterThan(0);
    expect(raised).toBeGreaterThan(0);
  });

  /**
   * Contre-exemple de I6 (relecture K2f, première version du relèvement) : un nœud de la ligne
   * des nez (620 en σ = 1 433) entre la fin de la partie de niveau de début de F2 et le plat
   * (770 dès σ = 1 473) ; relever la partie de niveau à 770 rendait la ligne décroissante. Pas
   * de relèvement : partie de niveau à P(σ_c), ligne croissante.
   */
  it("relèvement refusé quand un nœud de la ligne des nez sépare la partie de niveau du plat", () => {
    const pitch = new PiecewiseLinear([
      { x: 1000, y: 170 },
      { x: 1190, y: 320 },
      { x: 1301, y: 470 },
      { x: 1433, y: 620 },
      { x: 1473, y: 770 },
      { x: 2173, y: 770 },
    ]);
    const corner = { joint: "wall", concave: true, tanHalf: 0.2 } as const;
    const res = profileBearings({
      faces: [
        {
          id: "F1",
          side: "outer",
          sigmaA: 700,
          faceLength: 534.6,
          uLo: 300,
          uHi: 534.6,
          start: "floor",
          end: "corner",
          endCorner: corner,
        },
        {
          id: "F2",
          side: "outer",
          sigmaA: 1234.6,
          faceLength: 1238.4,
          uLo: 0,
          uHi: 938.4,
          start: "corner",
          end: "arrival",
          startCorner: corner,
        },
      ],
      pitch: { inner: pitch, outer: pitch },
      upperOffset: 0,
      section: { h: 80, b: 45, shift: 0, tf: 0 },
      settings: { minSegmentLength: 120, minKneeAngle: 0 },
    });
    expect(res.corners).toHaveLength(1);
    expect(res.corners[0]!.z).toBeCloseTo(pitch.at(1234.6), 9);
    for (const fb of res.faces) {
      for (let i = 0; i + 1 < fb.line.length; i++) {
        expect(fb.line[i + 1]!.y).toBeGreaterThanOrEqual(fb.line[i]!.y - 1e-9);
      }
    }
  });

  /**
   * Palier non aligné (cage#0 de la sonde K2f, graine 2026) : limon de bord du palier de 1 493 mm,
   * plat des nez à 1 080 jusqu'à u = 1 303, coin au nez de sortie (1 260 en u = 1 493), pente de
   * référence 180 / 190.
   */
  it("raccord glissant chiffré : plat de niveau jusqu'à s = L − λ − d, raccord à α_ref, partie de niveau du coin", () => {
    const pitch = new PiecewiseLinear([
      { x: 0, y: 900 },
      { x: 190, y: 1080 },
      { x: 1493, y: 1080 },
      { x: 1683, y: 1260 },
      { x: 1873, y: 1440 },
    ]);
    const faces: BearingFace[] = [
      {
        id: "LP",
        side: "outer",
        sigmaA: 190,
        faceLength: 1493,
        uLo: 0,
        uHi: 1493,
        start: "newel",
        end: "corner",
        endCorner: { joint: "wall", concave: true, tanHalf: 1 },
      },
      {
        id: "L2",
        side: "outer",
        sigmaA: 1683,
        faceLength: 190,
        uLo: 0,
        uHi: 190,
        start: "corner",
        end: "arrival",
        startCorner: { joint: "wall", concave: true, tanHalf: 1 },
      },
    ];
    const settings = PROVISIONAL_KNEE_SETTINGS;
    const res = profileBearings({
      faces,
      pitch: { inner: pitch, outer: pitch },
      upperOffset: 40,
      section: UPN200,
      settings,
    });
    const fb = byId(res, "LP");
    const ref = Math.atan2(180, 190);
    const d = 180 / Math.tan(ref);
    const lambda = settings.minSegmentLength + UPN200.h * Math.tan(ref / 2);
    const s = 1493 - lambda - d;
    expect(fb.line).toHaveLength(4);
    expect(fb.line[0]).toEqual({ x: 0, y: 1080 });
    expect(fb.line[1]!.x).toBeCloseTo(s, 9);
    expect(fb.line[1]!.y).toBe(1080);
    expect(fb.line[2]!.x).toBeCloseTo(1493 - lambda, 9);
    expect(fb.line[2]!.y).toBeCloseTo(1260, 9);
    expect(fb.line[3]).toEqual({ x: 1493, y: 1260 });
    expect(fb.segments[1]!.alpha).toBeCloseTo(ref, 12);
    const c = res.corners.find((x) => x.faceBefore === "LP")!;
    expect(c.rampBefore).toBeCloseTo(lambda + d, 9);
    expect(c.lengthBefore).toBeCloseTo(lambda, 9);
    // Avant K2f : raccord depuis le début du plat (rampe sur tout le palier).
    expect(s).toBeGreaterThan(1100);
    expect(res.issues).toEqual([]);
  });

  /**
   * Palier aligné court (cage#25 de la sonde K2f) : deux limons colinéaires au raccord de palier
   * (milieu du palier de 309 mm, à 104,4 mm du jarret de fin du plat), UPN 220 : la fin du plat
   * est reportée à m après le raccord, le palier reste de niveau ; plus de partie de niveau à
   * P(σ_c) au-dessus du palier (bosse de 72,6 mm avant K2f).
   */
  it("chaîne de palier chiffrée : fin du plat reportée à m après le raccord, palier de niveau, rives continues", () => {
    const pitch = new PiecewiseLinear([
      { x: 1032, y: 900 },
      { x: 1290, y: 1080 },
      { x: 1340.1, y: 1080 },
      { x: 1599, y: 1260 },
      { x: 1857.9, y: 1440 },
    ]);
    const landing: SteelCornerEnd = { joint: "landing", concave: true, tanHalf: 0 };
    const faces: BearingFace[] = [
      {
        id: "A",
        side: "outer",
        sigmaA: 0,
        faceLength: 1444.5,
        uLo: 1032,
        uHi: 1444.5,
        start: "floor",
        end: "corner",
        endCorner: landing,
      },
      {
        id: "B",
        side: "outer",
        sigmaA: 1444.5,
        faceLength: 413.4,
        uLo: 0,
        uHi: 413.4,
        start: "corner",
        end: "arrival",
        startCorner: landing,
      },
    ];
    const sec: BearingSection = { h: 220, b: 80, shift: 0, tf: 0 };
    const res = profileBearings({
      faces,
      pitch: { inner: pitch, outer: pitch },
      upperOffset: 40,
      section: sec,
      settings: PROVISIONAL_KNEE_SETTINGS,
    });
    const a = byId(res, "A");
    const b = byId(res, "B");
    expect(res.corners).toEqual([]);
    expect(res.issues).toEqual([]);
    // Palier de niveau à 1 080 de son nez (1 290) jusqu'au raccord, et 50 mm au-delà.
    expect(a.line.map((q) => [q.x, q.y])).toEqual([
      [1032, 900],
      [1290, 1080],
      [1444.5, 1080],
    ]);
    expect(b.line[0]).toEqual({ x: 0, y: 1080 });
    expect(b.line[1]!.x).toBeCloseTo(PROVISIONAL_KNEE_SETTINGS.minSegmentLength, 9);
    expect(b.line[1]!.y).toBe(1080);
    expect(b.line[2]!.x).toBeCloseTo(1599 - 1444.5, 9);
    expect(b.line[2]!.y).toBe(1260);
    expect(b.knees[0]!.protected).toBe(true);
    const ra = riveFns(a);
    const rb = riveFns(b);
    expect(Math.abs(ra.lower(1444.5) - rb.lower(0))).toBeLessThan(1e-9);
    // Chaîne rendue pour la décision K-Q27 (sous-lot K2f2), du bas vers le haut.
    expect(res.landingChains).toEqual([["A", "B"]]);
  });

  it("chaînes rendues (K2f2) : aucune pour un coin mural, une par raccord de palier, indépendantes de l'ordre des faces", () => {
    const pitch = new PiecewiseLinear([
      { x: 0, y: 900 },
      { x: 190, y: 1080 },
      { x: 1493, y: 1080 },
      { x: 1683, y: 1260 },
    ]);
    const mk = (joint: "wall" | "landing"): BearingFace[] => {
      const c: SteelCornerEnd =
        joint === "wall"
          ? { joint: "wall", concave: true, tanHalf: 1 }
          : { joint: "landing", concave: true, tanHalf: 0 };
      return [
        {
          id: "Z2",
          side: "outer",
          sigmaA: 900,
          faceLength: 783,
          uLo: 0,
          uHi: 783,
          start: "corner",
          end: "arrival",
          startCorner: c,
        },
        {
          id: "Z1",
          side: "outer",
          sigmaA: 0,
          faceLength: 900,
          uLo: 0,
          uHi: 900,
          start: "newel",
          end: "corner",
          endCorner: c,
        },
      ];
    };
    const run = (faces: BearingFace[]) =>
      profileBearings({
        faces,
        pitch: { inner: pitch, outer: pitch },
        upperOffset: 40,
        section: UPN200,
        settings: PROVISIONAL_KNEE_SETTINGS,
      });
    expect(run(mk("wall")).landingChains).toEqual([]);
    // Ordre d'entrée inversé (Z2 avant Z1) : chaîne du bas vers le haut.
    expect(run(mk("landing")).landingChains).toEqual([["Z1", "Z2"]]);
    expect(run([...mk("landing")].reverse()).landingChains).toEqual([["Z1", "Z2"]]);
  });

  it("propriété (K2f2) : chaînes rendues = suites de raccords de palier (même côté, σ continu), au moins deux membres, chaque face au plus une fois, indépendantes de l'ordre (I9)", () => {
    let seen = 0;
    fc.assert(
      fc.property(synthArb(), fc.integer({ min: 0, max: 5 }), ({ input }, rot) => {
        const res = profileBearings(input);
        const pairs = new Set(
          cornerPairs(input)
            .filter(
              ([a, b]) =>
                cornerOf(a, "end")?.joint === "landing" &&
                cornerOf(b, "start")?.joint === "landing" &&
                a.uHi >= a.faceLength - 1e-6 &&
                b.uLo <= 1e-6 &&
                a.uHi - a.uLo > 1e-9 &&
                b.uHi - b.uLo > 1e-9,
            )
            .map(([a, b]) => `${a.id}>${b.id}`),
        );
        const listed = new Set<string>();
        const members = new Set<string>();
        for (const c of res.landingChains) {
          expect(c.length).toBeGreaterThanOrEqual(2);
          for (const id of c) {
            expect(members.has(id), id).toBe(false);
            members.add(id);
          }
          for (let k = 0; k + 1 < c.length; k++) listed.add(`${c[k]}>${c[k + 1]}`);
        }
        expect([...listed].sort()).toEqual([...pairs].sort());
        seen += listed.size;
        const n = input.faces.length;
        const rotated = input.faces.map((_, i) => input.faces[(i + rot) % n]!);
        expect(profileBearings({ ...input, faces: rotated }).landingChains).toEqual(
          res.landingChains,
        );
      }),
      { numRuns: RUNS },
    );
    expect(seen).toBeGreaterThan(0);
  });

  /**
   * Fin du plat exactement au raccord de palier (relecture K2f2, contre-exemple réduit par
   * fast-check d'une cage alignée de 900 / 900 mm à palier de 300 mm) : aucun sous-tronçon ne
   * désignait ce sommet, le jarret tombait sur la coupe d'aplomb et les rives basses des deux
   * membres s'écartaient de h·(1/cos α − 1) (89,9 mm en UPN 160 sur la cage). Fin du plat
   * reportée à m après le raccord, comme un sous-tronçon trop court.
   */
  it("fin de plat exactement au raccord : reportée à m après lui, rives basses continues", () => {
    const pitch = new PiecewiseLinear([
      { x: 0, y: 0 },
      { x: 250, y: 180 },
      { x: 500, y: 360 },
      { x: 750, y: 540 },
      { x: 1000, y: 720 },
      { x: 1250, y: 720 },
      { x: 1500, y: 900 },
      { x: 1750, y: 1080 },
      { x: 2000, y: 1260 },
    ]);
    const landing: SteelCornerEnd = { joint: "landing", concave: true, tanHalf: 0 };
    const faces: BearingFace[] = [
      {
        id: "A",
        side: "outer",
        sigmaA: 0,
        faceLength: 1250,
        uLo: 0,
        uHi: 1250,
        start: "floor",
        end: "corner",
        endCorner: landing,
      },
      {
        id: "B",
        side: "outer",
        sigmaA: 1250,
        faceLength: 750,
        uLo: 0,
        uHi: 750,
        start: "corner",
        end: "arrival",
        startCorner: landing,
      },
    ];
    const sec: BearingSection = { h: 160, b: 65, shift: 0, tf: 0 };
    const res = profileBearings({
      faces,
      pitch: { inner: pitch, outer: pitch },
      upperOffset: 40,
      section: sec,
      settings: PROVISIONAL_KNEE_SETTINGS,
    });
    const a = byId(res, "A");
    const b = byId(res, "B");
    const m = PROVISIONAL_KNEE_SETTINGS.minSegmentLength;
    // A finit de niveau sur le plat ; B reste de niveau jusqu'à m, puis monte vers le nez suivant.
    expect(a.line[a.line.length - 1]).toEqual({ x: 1250, y: 720 });
    expect(a.segments[a.segments.length - 1]!.alpha).toBe(0);
    expect(b.line[0]).toEqual({ x: 0, y: 720 });
    expect(b.line[1]!.x).toBeCloseTo(m, 9);
    expect(b.line[1]!.y).toBe(720);
    expect(b.knees[0]!.protected).toBe(true);
    expect(b.segments[0]!.alpha).toBe(0);
    const ra = riveFns(a);
    const rb = riveFns(b);
    expect(Math.abs(ra.upper(1250) - rb.upper(0))).toBeLessThan(1e-9);
    expect(Math.abs(ra.lower(1250) - rb.lower(0))).toBeLessThan(1e-9);
    expect(res.landingChains).toEqual([["A", "B"]]);
  });
});
