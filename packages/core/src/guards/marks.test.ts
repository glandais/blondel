/**
 * Repérage des pièces de garde-corps (chantier guard-marks, G2b ; CG1, CG2, G-Q5, G-Q6) :
 * propriétés du regroupement à T autour d'une ancre, puis cas des exemples.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { msg, type MessageKey } from "@blondel/i18n";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import type { MaterialId, Part } from "../model/derived.js";
import type { Mm, Vec3 } from "../model/primitives.js";
import type { Project } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { parseProjectText } from "../project/parse.js";
import { DEFAULT_WORKSHOP_PROFILE } from "../workshop/profile.js";
import {
  barShape,
  guardShapeDistance,
  panelShape,
  prismShape,
  sameGuardShape,
} from "./guardShape.js";
import {
  groupGuardMarks,
  guardMarkKey,
  MarkRegistry,
  type GuardMarkEntry,
  type GuardMarkGroup,
} from "./marks.js";
import { panelMember, sweptMember, verticalMember, type PartFactoryContext } from "./parts.js";
import type { GuardSection } from "./spec.js";

// ------------------------------------------------------------------ générateurs

/** Pièce tirée : famille, longueur de base (petit jeu, pour des pièces voisines), écart. */
interface Spec {
  readonly family: "prism" | "bar" | "panel";
  readonly base: number;
  /** Écart de longueur (mm), autour de T : chaînes non transitives. */
  readonly delta: Mm;
  readonly slope: number;
  readonly height: Mm;
  /** Placement : rotation autour de z, translation, lecture inversée. */
  readonly angle: number;
  readonly dx: Mm;
  readonly dy: Mm;
  readonly dz: Mm;
  readonly reverse: boolean;
  /** Nature (clé i18n du nom) et matériau : variantes de clé. */
  readonly nature: 0 | 1;
  readonly material: 0 | 1;
}

const BASES = [600, 900, 1200];
const SECTION: GuardSection = { kind: "round", diameter: 42 };
const NATURES: Record<Spec["family"], readonly [MessageKey, MessageKey]> = {
  prism: ["part.guardPost.name", "part.baluster.name"],
  bar: ["part.guardHandrail.name", "part.openingHandrail.name"],
  panel: ["part.glassPanel.name", "part.solidPanel.name"],
};
const MATERIALS: readonly [MaterialId, MaterialId] = ["steel-painted", "wood-oak"];
const PREFIX: Record<Spec["family"], string> = { prism: "PG", bar: "MC", panel: "PN" };

const specArb: fc.Arbitrary<Spec> = fc.record({
  family: fc.constantFrom("prism" as const, "bar" as const, "panel" as const),
  base: fc.constantFrom(...BASES),
  delta: fc.constantFrom(0, 0.2, 0.4, 0.45, 0.6, 0.9, 1.3),
  slope: fc.constantFrom(0, 0.6),
  height: fc.constantFrom(700, 701),
  angle: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
  dx: fc.double({ min: -3000, max: 3000, noNaN: true }),
  dy: fc.double({ min: -3000, max: 3000, noNaN: true }),
  dz: fc.double({ min: -1000, max: 1000, noNaN: true }),
  reverse: fc.boolean(),
  nature: fc.constantFrom(0 as const, 1 as const),
  material: fc.constantFrom(0 as const, 1 as const),
});

/** Bord droit de longueur en plan `len`, pente `slope`, à 3 stations, placé. */
function edge(s: Spec, len: Mm, z0: Mm): Vec3[] {
  const c = Math.cos(s.angle);
  const sn = Math.sin(s.angle);
  const pts = [0, 0.4, 1].map((f) => {
    const x = f * len;
    return { x: c * x + s.dx, y: sn * x + s.dy, z: z0 + s.slope * x + s.dz };
  });
  return s.reverse ? pts.reverse() : pts;
}

function entryOf(s: Spec, id: string): GuardMarkEntry {
  const len = s.base + s.delta;
  const shape =
    s.family === "prism"
      ? prismShape(SECTION, len)
      : s.family === "bar"
        ? barShape(edge(s, len, 0), SECTION)
        : panelShape(edge(s, len, 0), edge(s, len, s.height), 10);
  const prefix = PREFIX[s.family];
  return {
    id,
    prefix,
    key: guardMarkKey(prefix, NATURES[s.family][s.nature], MATERIALS[s.material], shape),
    shape,
    size: s.family === "panel" ? len * s.height : len * Math.hypot(1, s.slope),
  };
}

/** Pièces tirées et une permutation. */
const setArb = fc.array(specArb, { minLength: 1, maxLength: 24 }).chain((specs) =>
  fc.tuple(
    fc.constant(specs.map((s, i) => entryOf(s, `p-${String(i).padStart(2, "0")}`))),
    fc.shuffledSubarray(
      specs.map((_, i) => i),
      { minLength: specs.length, maxLength: specs.length },
    ),
  ),
);

const tolArb = fc.constantFrom(0, 0.3, 0.5, 1);

/** Partition (identifiants, triés) et ancres d'un regroupement. */
function partition(
  entries: readonly GuardMarkEntry[],
  groups: readonly GuardMarkGroup[],
): { members: string[]; anchor: string }[] {
  return groups
    .map((g) => ({
      members: g.members.map((i) => entries[i]!.id).sort(),
      anchor: entries[g.anchor]!.id,
    }))
    .sort((a, b) => (a.members[0]! < b.members[0]! ? -1 : 1));
}

const RUNS = 80;

// ------------------------------------------------------------------ propriétés

describe("repérage à T : propriétés (CG1, CG2)", () => {
  it("partition et ancres indépendantes de l'ordre des pièces", () => {
    fc.assert(
      fc.property(setArb, tolArb, ([entries, perm], tol) => {
        const shuffled = perm.map((i) => entries[i]!);
        expect(partition(shuffled, groupGuardMarks(shuffled, tol))).toEqual(
          partition(entries, groupGuardMarks(entries, tol)),
        );
      }),
      { numRuns: RUNS },
    );
  });

  it("tout membre à ≤ T de son ancre, ancres de même clé à > T, clés jamais mêlées", () => {
    fc.assert(
      fc.property(setArb, tolArb, ([entries], tol) => {
        const groups = groupGuardMarks(entries, tol);
        expect(groups.flatMap((g) => g.members).sort((a, b) => a - b)).toEqual(
          entries.map((_, i) => i),
        );
        for (const g of groups) {
          const a = entries[g.anchor]!;
          expect(g.members).toContain(g.anchor);
          for (const m of g.members) {
            const e = entries[m]!;
            expect(e.key).toBe(a.key);
            expect(guardShapeDistance(a.shape, e.shape)).toBeLessThanOrEqual(tol + GEOM_EPS);
            // L'ancre est la plus petite pièce du groupe.
            expect(a.size).toBeLessThanOrEqual(e.size + GEOM_EPS);
          }
        }
        for (let i = 0; i < groups.length; i++) {
          for (let j = i + 1; j < groups.length; j++) {
            const a = entries[groups[i]!.anchor]!;
            const b = entries[groups[j]!.anchor]!;
            if (a.key === b.key) expect(sameGuardShape(a.shape, b.shape, tol)).toBe(false);
          }
        }
        // Groupes dans l'ordre de première apparition, membres croissants.
        groups.forEach((g, k) => {
          expect([...g.members].sort((x, y) => x - y)).toEqual(g.members);
          if (k > 0) expect(g.members[0]!).toBeGreaterThan(groups[k - 1]!.members[0]!);
        });
      }),
      { numRuns: RUNS },
    );
  });

  it("non-transitivité : 0 / 0,4 / 0,8 mm à T = 0,5 ⇒ deux groupes autour de la plus courte", () => {
    const s: Spec = {
      family: "bar",
      base: 900,
      delta: 0,
      slope: 0,
      height: 700,
      angle: 0,
      dx: 0,
      dy: 0,
      dz: 0,
      reverse: false,
      nature: 0,
      material: 0,
    };
    const entries = [0.8, 0.4, 0].map((d, i) => entryOf({ ...s, delta: d }, `p${i}`));
    const groups = groupGuardMarks(entries, 0.5);
    expect(partition(entries, groups)).toEqual([
      { members: ["p0"], anchor: "p0" },
      { members: ["p1", "p2"], anchor: "p2" },
    ]);
  });
});

// ------------------------------------------------------------------ registre

const ctxOf = (tol: Mm, reserved?: readonly string[]): PartFactoryContext => ({
  marks: new MarkRegistry(tol, reserved),
  profile: DEFAULT_WORKSHOP_PROFILE,
});

const common = (id: string, prefix: string, name: MessageKey, material: MaterialId) => ({
  id,
  prefix,
  category: prefix === "MC" ? ("handrail" as const) : ("infill" as const),
  name: msg(name),
  material,
});

const line = (len: Mm, z = 0, dy = 0): Vec3[] => [
  { x: 0, y: dy, z },
  { x: len, y: dy, z: z + 0.5 * len },
];

describe("MarkRegistry (G2b)", () => {
  it("repères dans l'ordre de première apparition, débit et grandeurs de la première pièce", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(0, 0.3, 2, 5), { minLength: 1, maxLength: 12 }),
        tolArb,
        (deltas, tol) => {
          const ctx = ctxOf(tol);
          const raw = deltas.map((d, i) =>
            sweptMember(
              ctx,
              common(`r-${i}`, "LS", "part.rail.name", "steel-painted"),
              line(1000 + d, 0, 100 * i),
              SECTION,
            ),
          );
          expect(raw.every((p) => p.mark === "")).toBe(true);
          const parts = ctx.marks.apply(raw);
          expect(parts.every((p) => /^LS\d+$/.test(p.mark))).toBe(true);
          // Le n-ième repère apparaît avant le (n+1)-ième.
          const firsts: number[] = [];
          parts.forEach((p, i) => {
            const n = Number(p.mark.slice(2));
            if (firsts[n - 1] === undefined) firsts[n - 1] = i;
          });
          expect(firsts.every((x) => x !== undefined)).toBe(true);
          expect([...firsts].sort((a, b) => a - b)).toEqual(firsts);
          // QUESTIONS D1 : grandeurs et débit de la première pièce du repère.
          for (const p of parts) {
            const first = parts.find((q) => q.mark === p.mark)!;
            expect(p.stock).toEqual(first.stock);
            expect(p.quantities).toEqual(first.quantities);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("QUESTIONS D1 : débit et grandeurs de la première pièce de l'entrée, même quand l'ancre est une autre pièce", () => {
    // Deltas [0,3 ; 0] à T = 0,5 : un seul repère, ancre = la plus courte (la seconde), première
    // pièce = la plus longue. (À adapter en G2c, qui change le représentant.)
    const ctx = ctxOf(0.5);
    const raw = [0.3, 0].map((d, i) =>
      sweptMember(
        ctx,
        common(`r-${i}`, "LS", "part.rail.name", "steel-painted"),
        line(1000 + d, 0, 100 * i),
        SECTION,
      ),
    );
    expect(raw[0]!.quantities).not.toEqual(raw[1]!.quantities);
    const parts = ctx.marks.apply(raw);
    expect(parts.map((p) => p.mark)).toEqual(["LS1", "LS1"]);
    for (const p of parts) {
      expect(p.stock).toEqual(raw[0]!.stock);
      expect(p.quantities).toEqual(raw[0]!.quantities);
    }
  });

  it("nature ou matériau différents ⇒ repères distincts, même forme ; même nature ⇒ réunies", () => {
    const ctx = ctxOf(0.5);
    const mk = (id: string, name: MessageKey, material: MaterialId) =>
      sweptMember(ctx, common(id, "MC", name, material), line(2000), SECTION);
    const parts = ctx.marks.apply([
      mk("a", "part.guardHandrail.name", "steel-painted"),
      mk("b", "part.openingHandrail.name", "steel-painted"),
      mk("c", "part.wallHandrail.name", "steel-painted"),
      mk("d", "part.guardHandrail.name", "wood-oak"),
      mk("e", "part.guardHandrail.name", "steel-painted"),
    ]);
    expect(parts.map((p) => p.mark)).toEqual(["MC1", "MC2", "MC3", "MC4", "MC1"]);
  });

  it("repère réservé (main courante portée par la structure, G-Q6) : jamais attribué", () => {
    const ctx = ctxOf(0.5, ["MC1"]);
    const parts = ctx.marks.apply([
      sweptMember(
        ctx,
        common("a", "MC", "part.guardHandrail.name", "steel-painted"),
        line(2000),
        SECTION,
      ),
      sweptMember(
        ctx,
        common("b", "MC", "part.openingHandrail.name", "steel-painted"),
        line(2000),
        SECTION,
      ),
      sweptMember(ctx, common("c", "LS", "part.rail.name", "steel-painted"), line(900), SECTION),
    ]);
    expect(parts.map((p) => p.mark)).toEqual(["MC2", "MC3", "LS1"]);
  });

  it("T = 0 sépare des pièces à 0,3 mm, T = 0,5 les réunit ; poteaux, panneaux", () => {
    for (const [tol, expected] of [
      [0, ["PG1", "PG2", "PN1", "PN2"]],
      [0.5, ["PG1", "PG1", "PN1", "PN1"]],
    ] as const) {
      const ctx = ctxOf(tol);
      const post = (id: string, top: Mm) =>
        verticalMember(
          ctx,
          {
            id,
            prefix: "PG",
            category: "post",
            name: msg("part.guardPost.name"),
            material: "steel-painted",
          },
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { kind: "rect", width: 40, height: 40 },
          0,
          top,
        );
      const panel = (id: string, len: Mm) => {
        const bottom = line(len);
        return panelMember(
          ctx,
          common(id, "PN", "part.glassPanel.name", "glass"),
          bottom,
          bottom.map((p) => ({ ...p, z: p.z + 800 })),
          bottom.map(() => ({ x: 0, y: 1 })),
          10,
        );
      };
      const parts = ctx.marks.apply([
        post("a", 900),
        post("b", 900.3),
        panel("c", 800),
        panel("d", 800.3),
      ]);
      expect(parts.map((p) => p.mark)).toEqual(expected);
    }
  });
});

// ------------------------------------------------------------------ exemples

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const SUFFIX = ".blondel.json";
const rawExample = (name: string): Record<string, any> =>
  JSON.parse(readFileSync(join(EXAMPLES_DIR, `${name}${SUFFIX}`), "utf8"));
const markOf = (parts: readonly Part[]) => {
  const byId = new Map(parts.map((p) => [p.id, p.mark]));
  return (id: string): string | undefined => byId.get(id);
};
const guardParts = (p: Project): Part[] =>
  buildModel(p, { memo: false }).parts.filter((x) => x.family === "guards");

describe("repérage à T : exemples", () => {
  it.each([
    "demo-erp-grand",
    "demo-straight-central-glulam",
    "demo-straight-cut-oak",
    "demo-straight-loft",
  ])("%s : mains courantes jumelles réunies en MC1, trémie en MC2 (G-Q5)", (name) => {
    const mark = markOf(guardParts(parseProjectText(JSON.stringify(rawExample(name)))));
    expect(mark("guard-inner-1-handrail")).toBe("MC1");
    expect(mark("guard-outer-1-handrail")).toBe("MC1");
    expect(mark("guard-opening-1-handrail")).toBe("MC2");
  });

  it("demo-straight-loft en lisses : lisses des deux rampants réunies en LS1 (plus de séparation par le nombre de sommets)", () => {
    const j = rawExample("demo-straight-loft");
    j["guards"].infill = { kind: "rails" };
    const parts = guardParts(parseProjectText(JSON.stringify(j)));
    const rails = parts.filter((p) => /^guard-(inner|outer)-1-rail-/.test(p.id));
    expect(rails.length).toBeGreaterThan(0);
    expect(new Set(rails.map((p) => p.mark))).toEqual(new Set(["LS1"]));
  });

  it("demo-central-glulam, hauteur d'étage − 72 mm : panneaux du rampant extérieur en un repère (CG2)", () => {
    const j = rawExample("demo-central-glulam");
    j["site"].floorToFloor -= 72;
    const parts = guardParts(parseProjectText(JSON.stringify(j)));
    const panels = parts.filter((p) => /^guard-outer-1-panel-[1-5]$/.test(p.id));
    expect(panels).toHaveLength(5);
    expect(new Set(panels.map((p) => p.mark)).size).toBe(1);
  });
});
