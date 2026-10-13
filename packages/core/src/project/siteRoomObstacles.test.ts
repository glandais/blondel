/**
 * Site, ajouts facultatifs (ADR-0010, sous-lot 0c) : contour de pièce (`room`) et obstacles
 * (`obstacles`). Rétrocompatibilité à l'octet, aller-retour, refus avec la bonne clé, pipeline
 * inchangé (les champs ne sont pas encore lus).
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import type { MessageKey } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import type { Obstacle } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { nextObstacleId } from "../site/edit.js";
import { ProjectParseError } from "./errors.js";
import { parseProject, parseProjectText } from "./parse.js";
import { serializeProject } from "./serialize.js";

const EXAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const EXAMPLE = "quarter-landing.blondel.json";
const exampleText = (file: string): string => readFileSync(join(EXAMPLES_DIR, file), "utf8");

/** JSON de l'exemple de base, site complété par `site`. */
function withSite(site: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.parse(exampleText(EXAMPLE)) as Record<string, unknown>;
  return { ...json, site: { ...(json["site"] as Record<string, unknown>), ...site } };
}

/** Chemins et clés des messages de validation d'un projet invalide. */
function issueKeys(json: unknown): { path: string; key: MessageKey | undefined }[] {
  try {
    parseProject(json);
  } catch (e) {
    expect(e).toBeInstanceOf(ProjectParseError);
    return (e as ProjectParseError).issues.map((i) => ({
      path: i.path,
      key: "key" in i.message ? (i.message.key as MessageKey) : undefined,
    }));
  }
  throw new Error("projet accepté à tort");
}

/** Exemples qui portent un contour de pièce et des obstacles (démo du site libre). */
const SITE_EXAMPLES: readonly string[] = ["demo-cage-room.blondel.json"];

const ROOM = {
  points: [
    { x: -500, y: -500 },
    { x: 4500, y: -500 },
    { x: 4500, y: 3500 },
    { x: 1000, y: 3500 },
    { x: 1000, y: 2000 },
    { x: -500, y: 2000 },
  ],
};

const OBSTACLES: Obstacle[] = [
  { kind: "post", id: "p1", center: { x: 3000, y: 2500 }, sizeX: 200, sizeY: 150, rotation: 30 },
  { kind: "circularPost", id: "c1", center: { x: 3800, y: 400 }, radius: 100 },
  {
    kind: "door",
    id: "d1",
    a: { x: 4500, y: 1000 },
    b: { x: 4500, y: 1830 },
    hinge: "a",
    swing: "left",
  },
  {
    kind: "window",
    id: "w1",
    a: { x: 2000, y: 3500 },
    b: { x: 3200, y: 3500 },
    sill: 900,
    head: 2150,
  },
  {
    kind: "zone",
    id: "z1",
    points: [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 300 },
    ],
  },
];

describe("site : contour de pièce et obstacles (schéma)", () => {
  it("tous les exemples se relisent et s'enregistrent à l'octet ; sans room ni obstacles hors démo du site libre", () => {
    const files = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".blondel.json"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = exampleText(file);
      const p = parseProjectText(text);
      // Seule la démo du site libre (sous-lot 7a) porte un contour et des obstacles : elle se
      // relit aussi à l'octet ; tous les autres exemples sont écrits sans les champs.
      if (SITE_EXAMPLES.includes(file)) {
        expect(p.site.room).toBeDefined();
        expect(p.site.obstacles?.length).toBeGreaterThan(0);
        expect(serializeProject(p)).toBe(text);
        continue;
      }
      expect(p.site.room).toBeUndefined();
      expect(p.site.obstacles).toBeUndefined();
      expect("room" in p.site).toBe(false);
      expect("obstacles" in p.site).toBe(false);
      expect(serializeProject(p)).toBe(text);
    }
  });

  it("avec les champs : lus tels quels, rotation 0 par défaut, aller-retour stable", () => {
    const { rotation: _r, ...postWithoutRotation } = OBSTACLES[0] as Obstacle & { kind: "post" };
    const p = parseProject(
      withSite({ room: ROOM, obstacles: [postWithoutRotation, ...OBSTACLES.slice(1)] }),
    );
    expect(p.site.room).toEqual(ROOM);
    expect(p.site.obstacles).toHaveLength(OBSTACLES.length);
    expect(p.site.obstacles?.[0]).toEqual({ ...OBSTACLES[0], rotation: 0 });
    expect(p.site.obstacles?.slice(1)).toEqual(OBSTACLES.slice(1));
    const text = serializeProject(p);
    expect(serializeProject(parseProjectText(text))).toBe(text);
    expect(parseProjectText(text)).toEqual(p);
  });

  it("liste d'obstacles vide conservée (pas confondue avec l'absence)", () => {
    const p = parseProject(withSite({ obstacles: [] }));
    expect(p.site.obstacles).toEqual([]);
    expect(serializeProject(p)).toContain('"obstacles": []');
  });

  it("pipeline inchangé hors adéquation au site : contour et obstacles ne sont lus que par `siteFit`", () => {
    // Sous-lot 3b : seule l'étape d'adéquation au site (`site/fit.ts`) lit contour et obstacles.
    const { siteFit: _base, ...base } = buildModel(parseProjectText(exampleText(EXAMPLE)));
    const { siteFit: _all, ...withAll } = buildModel(
      parseProject(withSite({ room: ROOM, obstacles: OBSTACLES })),
    );
    expect(withAll).toEqual(base);
  });

  it.each<[string, Record<string, unknown>, { path: string; key: MessageKey }]>([
    [
      "contour de 2 sommets",
      { room: { points: ROOM.points.slice(0, 2) } },
      { path: "site.room.points", key: "site.room.tooFewPoints" },
    ],
    [
      "contour d'aire nulle",
      {
        room: {
          points: [
            { x: 0, y: 0 },
            { x: 1000, y: 0 },
            { x: 2000, y: 0 },
          ],
        },
      },
      { path: "site.room.points", key: "site.room.zeroArea" },
    ],
    [
      "contour en nœud papillon",
      {
        room: {
          points: [
            { x: 0, y: 0 },
            { x: 2000, y: 2000 },
            { x: 2000, y: 0 },
            { x: 0, y: 1000 },
          ],
        },
      },
      { path: "site.room.points", key: "site.room.selfIntersecting" },
    ],
    [
      "contour refermé en répétant le premier sommet",
      { room: { points: [...ROOM.points, ROOM.points[0]] } },
      { path: "site.room.points", key: "site.room.duplicateVertex" },
    ],
    [
      "contour à sommet doublé",
      { room: { points: [ROOM.points[0], ...ROOM.points] } },
      { path: "site.room.points", key: "site.room.duplicateVertex" },
    ],
    [
      "zone de 2 sommets",
      { obstacles: [{ kind: "zone", id: "z", points: ROOM.points.slice(0, 2) }] },
      { path: "site.obstacles[0].points", key: "site.obstacle.zone.tooFewPoints" },
    ],
    [
      "zone d'aire nulle",
      {
        obstacles: [
          {
            kind: "zone",
            id: "z",
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 10 },
              { x: 20, y: 20 },
            ],
          },
        ],
      },
      { path: "site.obstacles[0].points", key: "site.obstacle.zone.zeroArea" },
    ],
    [
      "zone en nœud papillon",
      {
        obstacles: [
          {
            kind: "zone",
            id: "z",
            points: [
              { x: 0, y: 0 },
              { x: 2000, y: 2000 },
              { x: 2000, y: 0 },
              { x: 0, y: 1000 },
            ],
          },
        ],
      },
      { path: "site.obstacles[0].points", key: "site.obstacle.zone.selfIntersecting" },
    ],
    [
      "zone refermée en répétant le premier sommet",
      {
        obstacles: [
          {
            kind: "zone",
            id: "z",
            points: [
              { x: 0, y: 0 },
              { x: 400, y: 0 },
              { x: 400, y: 300 },
              { x: 0, y: 0 },
            ],
          },
        ],
      },
      { path: "site.obstacles[0].points", key: "site.obstacle.zone.duplicateVertex" },
    ],
    [
      "identifiants en double",
      { obstacles: [OBSTACLES[1], { ...OBSTACLES[0], id: "c1" }] },
      { path: "site.obstacles[1].id", key: "site.obstacle.duplicateId" },
    ],
    [
      "porte de largeur nulle",
      { obstacles: [{ ...OBSTACLES[2], b: { x: 4500, y: 1000 } }] },
      { path: "site.obstacles[0].b", key: "site.obstacle.door.sameEnds" },
    ],
    [
      "porte de largeur quasi nulle (0,001 mm)",
      { obstacles: [{ ...OBSTACLES[2], b: { x: 4500.001, y: 1000 } }] },
      { path: "site.obstacles[0].b", key: "site.obstacle.door.sameEnds" },
    ],
    [
      "fenêtre de largeur nulle",
      { obstacles: [{ ...OBSTACLES[3], b: { x: 2000, y: 3500 } }] },
      { path: "site.obstacles[0].b", key: "site.obstacle.window.sameEnds" },
    ],
    [
      "linteau au niveau de l'allège",
      { obstacles: [{ ...OBSTACLES[3], head: 900 }] },
      { path: "site.obstacles[0].head", key: "site.obstacle.window.headNotAboveSill" },
    ],
  ])("refus : %s", (_name, site, expected) => {
    expect(issueKeys(withSite(site))).toEqual([expected]);
  });

  it("linteau et allège déjà refusés : pas de second message de comparaison", () => {
    const issues = issueKeys(withSite({ obstacles: [{ ...OBSTACLES[3], sill: 0, head: 0 }] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("site.obstacles[0].head");
    expect(issues[0]?.key).not.toBe("site.obstacle.window.headNotAboveSill");
    expect(
      issueKeys(withSite({ obstacles: [{ ...OBSTACLES[3], sill: -10, head: -20 }] })).map(
        (i) => i.path,
      ),
    ).toEqual(["site.obstacles[0].sill", "site.obstacles[0].head"]);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ["sizeX nul", { obstacles: [{ ...OBSTACLES[0], sizeX: 0 }] }, "site.obstacles[0].sizeX"],
    [
      "sizeY décimal",
      { obstacles: [{ ...OBSTACLES[0], sizeY: 150.5 }] },
      "site.obstacles[0].sizeY",
    ],
    ["rayon négatif", { obstacles: [{ ...OBSTACLES[1], radius: -1 }] }, "site.obstacles[0].radius"],
    ["allège négative", { obstacles: [{ ...OBSTACLES[3], sill: -10 }] }, "site.obstacles[0].sill"],
    ["gonds inconnus", { obstacles: [{ ...OBSTACLES[2], hinge: "c" }] }, "site.obstacles[0].hinge"],
    ["sens inconnu", { obstacles: [{ ...OBSTACLES[2], swing: "up" }] }, "site.obstacles[0].swing"],
    ["type inconnu", { obstacles: [{ kind: "stove", id: "s" }] }, "site.obstacles[0].kind"],
  ])("refus des champs typés : %s", (_name, site, path) => {
    expect(issueKeys(withSite(site)).map((i) => i.path)).toContain(path);
  });

  it("nextObstacleId : premier identifiant libre, site sans obstacles compris", () => {
    expect(nextObstacleId({})).toBe("obstacle-1");
    expect(nextObstacleId({ obstacles: OBSTACLES })).toBe("obstacle-6");
    expect(
      nextObstacleId({
        obstacles: [
          { ...(OBSTACLES[1] as Obstacle), id: "obstacle-2" },
          { ...(OBSTACLES[0] as Obstacle), id: "obstacle-3" },
        ],
      }),
    ).toBe("obstacle-4");
  });
});

// ------------------------------------------------------------------ propriété

const coord = fc.integer({ min: -20000, max: 20000 });
const vec = fc.record({ x: coord, y: coord });

/** Polygone convexe régulier (simple, aire non nulle) : centre, rayon ≥ 300 mm, 3 à 12 sommets. */
const convexPolygon = fc
  .record({
    center: vec,
    radius: fc.integer({ min: 300, max: 5000 }),
    n: fc.integer({ min: 3, max: 12 }),
    phase: fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
  })
  .map(({ center, radius, n, phase }) =>
    Array.from({ length: n }, (_, k) => {
      // `+ 0` : `Math.round` peut rendre -0, que JSON écrit 0 (aller-retour non identique).
      const t = phase + (2 * Math.PI * k) / n;
      return {
        x: Math.round(center.x + radius * Math.cos(t)) + 0,
        y: Math.round(center.y + radius * Math.sin(t)) + 0,
      };
    }),
  );

/**
 * Polygone étoilé autour d'un centre (simple, souvent concave), coordonnées réelles non
 * arrondies : angles croissants, écarts < π, rayons de 300 à 5000 mm.
 */
const starPolygon = fc
  .record({
    center: vec,
    n: fc.integer({ min: 3, max: 10 }),
    weights: fc.array(fc.double({ min: 1, max: 1.9, noNaN: true }), {
      minLength: 10,
      maxLength: 10,
    }),
    radii: fc.array(fc.double({ min: 300, max: 5000, noNaN: true }), {
      minLength: 10,
      maxLength: 10,
    }),
  })
  .map(({ center, n, weights, radii }) => {
    const w = weights.slice(0, n);
    const total = w.reduce((a, b) => a + b, 0);
    let t = 0;
    return w.map((wi, k) => {
      const p = { x: center.x + radii[k]! * Math.cos(t), y: center.y + radii[k]! * Math.sin(t) };
      t += (2 * Math.PI * wi) / total;
      return p;
    });
  });

const simplePolygon = fc.oneof(convexPolygon, starPolygon);

const twoPoints = fc.tuple(vec, vec).filter(([a, b]) => a.x !== b.x || a.y !== b.y);

const obstacleBody = fc.oneof(
  fc.record(
    {
      kind: fc.constant("post" as const),
      center: vec,
      sizeX: fc.integer({ min: 1, max: 2000 }),
      sizeY: fc.integer({ min: 1, max: 2000 }),
      rotation: fc.integer({ min: -180, max: 180 }),
    },
    { requiredKeys: ["kind", "center", "sizeX", "sizeY"] },
  ),
  fc.record({
    kind: fc.constant("circularPost" as const),
    center: vec,
    radius: fc.integer({ min: 1, max: 1000 }),
  }),
  fc
    .record({
      ends: twoPoints,
      hinge: fc.constantFrom("a" as const, "b" as const),
      swing: fc.constantFrom("left" as const, "right" as const),
    })
    .map(({ ends: [a, b], hinge, swing }) => ({ kind: "door" as const, a, b, hinge, swing })),
  fc
    .record({
      ends: twoPoints,
      sill: fc.integer({ min: 0, max: 2000 }),
      height: fc.integer({ min: 1, max: 2000 }),
    })
    .map(({ ends: [a, b], sill, height }) => ({
      kind: "window" as const,
      a,
      b,
      sill,
      head: sill + height,
    })),
  simplePolygon.map((points) => ({ kind: "zone" as const, points })),
);

const siteExtras = fc.record(
  {
    room: simplePolygon.map((points) => ({ points })),
    obstacles: fc
      .array(obstacleBody, { maxLength: 6 })
      .map((list) => list.map((o, i) => ({ ...o, id: `obstacle-${i + 1}` }))),
  },
  { requiredKeys: [] },
);

describe("site : contour de pièce et obstacles (propriété)", () => {
  it("site valide généré → lecture → écriture → lecture : idempotent, contenu conservé", () => {
    fc.assert(
      fc.property(siteExtras, (extras) => {
        const p = parseProject(withSite(extras));
        if (extras.room !== undefined) expect(p.site.room).toEqual(extras.room);
        else expect("room" in p.site).toBe(false);
        if (extras.obstacles !== undefined) {
          expect(p.site.obstacles).toEqual(
            extras.obstacles.map((o) => (o.kind === "post" ? { rotation: 0, ...o } : o)),
          );
        } else expect("obstacles" in p.site).toBe(false);
        const text = serializeProject(p);
        const again = parseProjectText(text);
        expect(again).toEqual(p);
        expect(serializeProject(again)).toBe(text);
      }),
      { numRuns: 200 },
    );
  });
});
