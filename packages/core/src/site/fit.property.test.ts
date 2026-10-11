/**
 * Propriétés de l'adéquation au site (`site/fit.ts`, sous-lot 3b) :
 * - site vide (ni trémie, ni murs, ni contour, ni obstacle) : aucun conflit, hors échappée sous
 *   l'escalier lui-même (hélicoïdal de plus d'un tour) ;
 * - déplacement rigide conjoint du site et de l'escalier (rotation, translation) : mêmes
 *   conflits (nature, sévérité, message, élément en cause, règle) ; zones déplacées de même
 *   (comparées en translation seule : une zone peut être une boîte alignée sur les axes) ;
 *   échappée comparée en translation seule (voir le test) ;
 * - `buildModel` ne lève jamais, quel que soit le site.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { bbox, signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { SiteConflict } from "../model/derived.js";
import type { Vec2 } from "../model/primitives.js";
import { ProjectSchema, type Project } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { ALL_PRESET_IDS, createProject } from "../project/presets.js";

const presetArb = fc.constantFrom(...ALL_PRESET_IDS);
const coord = fc.integer({ min: -1500, max: 5000 });
const pointArb = fc.record({ x: coord, y: coord });

/** Éléments de site aléatoires autour de l'escalier (ids uniques par construction). */
const siteArb = fc.record({
  walls: fc.array(
    fc.record({
      a: pointArb,
      b: pointArb,
      thickness: fc.integer({ min: 50, max: 300 }),
    }),
    { maxLength: 3 },
  ),
  posts: fc.array(
    fc.record({
      center: pointArb,
      sizeX: fc.integer({ min: 50, max: 400 }),
      sizeY: fc.integer({ min: 50, max: 400 }),
      rotation: fc.integer({ min: 0, max: 89 }),
    }),
    { maxLength: 2 },
  ),
  discs: fc.array(fc.record({ center: pointArb, radius: fc.integer({ min: 20, max: 300 }) }), {
    maxLength: 2,
  }),
  doors: fc.array(
    fc.record({
      a: pointArb,
      d: fc.record({
        x: fc.integer({ min: 300, max: 1000 }),
        y: fc.integer({ min: -50, max: 50 }),
      }),
      hinge: fc.constantFrom("a", "b"),
      swing: fc.constantFrom("left", "right"),
    }),
    { maxLength: 2 },
  ),
  windows: fc.array(
    fc.record({
      a: pointArb,
      d: fc.record({
        x: fc.integer({ min: -50, max: 50 }),
        y: fc.integer({ min: 300, max: 1500 }),
      }),
      sill: fc.integer({ min: 0, max: 1500 }),
      height: fc.integer({ min: 100, max: 1500 }),
    }),
    { maxLength: 2 },
  ),
  zones: fc.array(
    fc.record({
      at: pointArb,
      w: fc.integer({ min: 100, max: 1500 }),
      h: fc.integer({ min: 100, max: 1500 }),
    }),
    { maxLength: 2 },
  ),
  room: fc.option(
    fc.record({
      at: fc.record({
        x: fc.integer({ min: -4000, max: 500 }),
        y: fc.integer({ min: -2000, max: 500 }),
      }),
      w: fc.integer({ min: 1000, max: 9000 }),
      h: fc.integer({ min: 1000, max: 9000 }),
    }),
    { nil: undefined },
  ),
  opening: fc.boolean(),
});
type SiteSample = typeof siteArb extends fc.Arbitrary<infer T> ? T : never;

const rect = (at: Vec2, w: number, h: number): Vec2[] => [
  { x: at.x, y: at.y },
  { x: at.x + w, y: at.y },
  { x: at.x + w, y: at.y + h },
  { x: at.x, y: at.y + h },
];

/** Projet du préréglage avec le site tiré (trémie du préréglage en polygone, ou aucune). */
function projectWith(preset: (typeof ALL_PRESET_IDS)[number], s: SiteSample): Project {
  const base = createProject(preset) as unknown as {
    site: Record<string, unknown> & { opening?: Project["site"]["opening"] };
  } & Record<string, unknown>;
  const { opening, ...site } = base.site;
  let polygon: Vec2[] | undefined;
  if (s.opening && opening)
    polygon =
      opening.kind === "rect"
        ? rect({ x: opening.x, y: opening.y }, opening.sizeX, opening.sizeY)
        : opening.points.map((p) => ({ x: p.x, y: p.y }));
  let n = 0;
  const id = (p: string): string => `${p}${++n}`;
  return ProjectSchema.parse({
    ...base,
    site: {
      ...site,
      ...(polygon ? { opening: { kind: "polygon", points: polygon } } : {}),
      walls: s.walls
        .filter((w) => V.distance(w.a, w.b) > 0)
        .map((w) => ({ id: id("M"), ...w, loadBearing: true })),
      ...(s.room ? { room: { points: rect(s.room.at, s.room.w, s.room.h) } } : {}),
      obstacles: [
        ...s.posts.map((p) => ({ kind: "post", id: id("P"), ...p })),
        ...s.discs.map((d) => ({ kind: "circularPost", id: id("C"), ...d })),
        ...s.doors.map((d) => ({
          kind: "door",
          id: id("D"),
          a: d.a,
          b: V.add(d.a, d.d),
          hinge: d.hinge,
          swing: d.swing,
        })),
        ...s.windows.map((w) => ({
          kind: "window",
          id: id("F"),
          a: w.a,
          b: V.add(w.a, w.d),
          sill: w.sill,
          head: w.sill + w.height,
        })),
        ...s.zones.map((z) => ({ kind: "zone", id: id("Z"), points: rect(z.at, z.w, z.h) })),
      ],
    },
  });
}

/** Déplacement rigide du site et de l'escalier : rotation `deg` autour de l'origine, puis `t`. */
function moved(p: Project, deg: number, t: Vec2): Project {
  const a = (deg * Math.PI) / 180;
  const f = (q: Vec2): Vec2 => V.add(V.rotate(q, a), t);
  const site = p.site;
  const opening =
    site.opening?.kind === "polygon"
      ? { kind: "polygon" as const, points: site.opening.points.map(f) }
      : site.opening;
  return {
    ...p,
    site: {
      ...site,
      ...(opening ? { opening } : {}),
      walls: site.walls.map((w) => ({ ...w, a: f(w.a), b: f(w.b) })),
      ...(site.room ? { room: { points: site.room.points.map(f) } } : {}),
      obstacles: (site.obstacles ?? []).map((o) => {
        switch (o.kind) {
          case "post":
            return { ...o, center: f(o.center), rotation: o.rotation + deg };
          case "circularPost":
            return { ...o, center: f(o.center) };
          case "door":
          case "window":
            return { ...o, a: f(o.a), b: f(o.b) };
          case "zone":
            return { ...o, points: o.points.map(f) };
        }
      }),
    },
    stair: {
      ...p.stair,
      placement: {
        origin: f(p.stair.placement.origin),
        rotation: p.stair.placement.rotation + deg,
      },
    },
  };
}

/** Égalité profonde, nombres comparés à 1e-6 près (relatif). */
function close(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number")
    return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => close(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return (
      close(ka, kb) &&
      ka.every((k) => close((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
    );
  }
  return a === b;
}

const summary = (c: SiteConflict) => ({
  kind: c.kind,
  severity: c.severity,
  message: c.message,
  targetId: c.targetId,
  ruleId: c.ruleId,
});

describe("adéquation au site : propriétés", () => {
  it("site vide : aucun conflit", () => {
    fc.assert(
      fc.property(
        presetArb,
        fc.integer({ min: 2200, max: 3400 }),
        fc.integer({ min: 700, max: 1100 }),
        (preset, floorToFloor, width) => {
          // Hélicoïdal : l'emmarchement se déduit des rayons (pas d'option `width`).
          const p = createProject(
            preset,
            preset === "helical" ? { floorToFloor } : { floorToFloor, width },
          );
          const { opening: _opening, ...site } = p.site;
          const empty: Project = { ...p, site: { ...site, walls: [] } };
          const m = buildModel(empty, { memo: false });
          // Seule exception : l'échappée sous l'escalier lui-même (hélicoïdal de plus d'un tour,
          // sous-faces de ses propres marches), qui ne doit rien au site.
          const selfCovered = (m.soffits ?? m.stepping.soffits ?? []).length > 0;
          for (const c of m.siteFit ?? []) {
            expect(c.kind).toBe("headroom");
            expect(selfCovered).toBe(true);
          }
        },
      ),
      { numRuns: 40 },
    );
  });

  it("déplacement rigide conjoint du site et de l'escalier : mêmes conflits", () => {
    let withConflicts = 0;
    fc.assert(
      fc.property(
        presetArb,
        siteArb,
        fc.integer({ min: 0, max: 359 }),
        fc.record({
          x: fc.integer({ min: -5000, max: 5000 }),
          y: fc.integer({ min: -5000, max: 5000 }),
        }),
        fc.boolean(),
        (preset, s, deg, t, translateOnly) => {
          const p = projectWith(preset, s);
          const q = moved(p, translateOnly ? 0 : deg, t);
          // Rotation : l'échappée (reprise du contrôle, pas recalculée ici) n'est comparée qu'en
          // translation entière (exacte) ; une ligne de foulée qui longe un bord de trémie peut
          // basculer d'un côté à l'autre en virgule flottante (constat consigné au journal 3b).
          const keep = (c: SiteConflict): boolean => translateOnly || c.kind !== "headroom";
          const a = (buildModel(p, { memo: false }).siteFit ?? []).filter(keep);
          const b = (buildModel(q, { memo: false }).siteFit ?? []).filter(keep);
          if (a.length > 0) withConflicts++;
          expect(close(b.map(summary), a.map(summary))).toBe(true);
          if (translateOnly) {
            // Boîte englobante et aire (l'enveloppe peut garder ou non un sommet aligné).
            a.forEach((c, i) => {
              const z = b[i]!.zone;
              const ba = bbox(c.zone.map((v) => V.add(v, t)));
              const bb = bbox(z);
              expect(close([bb.min, bb.max], [ba.min, ba.max])).toBe(true);
              expect(Math.abs(signedArea(z) - signedArea(c.zone))).toBeLessThan(1e-3);
            });
          }
        },
      ),
      { numRuns: 60 },
    );
    expect(withConflicts).toBeGreaterThan(10);
  });

  it("buildModel ne lève jamais, quel que soit le site", () => {
    fc.assert(
      fc.property(presetArb, siteArb, (preset, s) => {
        const p = projectWith(preset, s);
        const m = buildModel(p, { memo: false });
        for (const c of m.siteFit ?? []) {
          expect(["erreur", "avertissement", "conseil"]).toContain(c.severity);
          expect(c.zone.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y))).toBe(true);
        }
        expect(m.errors.filter((e) => e.key === "pipeline.internalError")).toEqual([]);
      }),
      { numRuns: 60 },
    );
  });
});
