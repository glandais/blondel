/**
 * Parité stricte du moteur de cage avec le moteur à volées (sous-lot 1b, ADR-0010) : pour tout
 * tracé à volées converti par `flightsToCage`, `computeCageLayout` rend le **même** `Layout`
 * (mêmes segments, même ordre, mêmes nombres : `toStrictEqual`, qui distingue même 0 et −0),
 * ou la même erreur (même clé, mêmes paramètres). Seuls les ajouts du moteur de cage sont
 * ignorés : `sections` et les champs `angle`, `well`, `wall` des tournants.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MessageError } from "@blondel/i18n";
import type { Layout } from "../../model/derived.js";
import {
  isCageLayout,
  isHelicalLayout,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type FlightsLayoutSpec,
  type InnerCorner,
  type Project,
  type ProjectInput,
} from "../../model/project.js";
import { createDemoProject, DEMO_PRESET_IDS } from "../../project/presetDemo.js";
import { createProject, OPPOSITE_TURNS_PRESET_IDS, PRESET_IDS } from "../../project/presets.js";
import { parseProjectText } from "../../project/parse.js";
import { computeLayout } from "../layout.js";
import { resolveLegLengths } from "../resolve.js";
import { computeCageLayout } from "./cage.js";
import { checkFlightsTopology, flightsToCage } from "./fromFlights.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../examples");
const EXAMPLE_FILES = readdirSync(EXAMPLES_DIR)
  .filter((f) => f.endsWith(".blondel.json"))
  .sort();

type Outcome = { readonly layout: unknown } | { readonly error: unknown };

/** Résultat comparable : tracé sans les ajouts du moteur de cage, ou erreur (clé et paramètres). */
function outcome(run: () => Layout): Outcome {
  try {
    const { sections: _sections, turns, ...rest } = run();
    const legacyTurns = turns.map(
      ({ angle: _angle, well: _well, wall: _wall, ...legacy }) => legacy,
    );
    return { layout: { ...rest, turns: legacyTurns } };
  } catch (e) {
    return { error: e instanceof MessageError ? { name: e.name, msg: e.msg } : String(e) };
  }
}

/** Tracé d'un projet à volées par le moteur de cage (ce que fera `computeLayout` au sous-lot 1c). */
function viaCage(project: Project): Layout {
  const spec = project.stair.layout as FlightsLayoutSpec;
  checkFlightsTopology(spec);
  return computeCageLayout(project, flightsToCage(spec, resolveLegLengths(project)), {
    origin: "flights",
  });
}

function expectParity(project: Project): void {
  const legacy = outcome(() => computeLayout(project));
  const cage = outcome(() => viaCage(project));
  expect(cage).toStrictEqual(legacy);
}

const isFlights = (p: Project): boolean =>
  !isHelicalLayout(p.stair.layout) && !isCageLayout(p.stair.layout);

describe("parité moteur de cage / moteur à volées", () => {
  const examples = EXAMPLE_FILES.map(
    (f) => [f, parseProjectText(readFileSync(join(EXAMPLES_DIR, f), "utf8"))] as const,
  ).filter(([, p]) => isFlights(p));

  it("des exemples à volées existent", () => {
    expect(examples.length).toBeGreaterThan(10);
  });

  it.each(examples)("exemple %s", (_file, project) => {
    expectParity(project);
    // Le tracé est bien calculé (pas une parité d'erreurs).
    expect("layout" in outcome(() => viaCage(project))).toBe(true);
  });

  it.each([...PRESET_IDS, ...OPPOSITE_TURNS_PRESET_IDS])("préréglage %s", (id) => {
    expectParity(createProject(id));
  });

  it.each(DEMO_PRESET_IDS.filter((id) => isFlights(createDemoProject(id))))("démo %s", (id) => {
    expectParity(createDemoProject(id));
  });

  it("erreurs : nombre de tournants, longueur auto hors escalier droit", () => {
    const base = createProject("quarter-left");
    const layout = base.stair.layout as FlightsLayoutSpec;
    expectParity({
      ...base,
      stair: { ...base.stair, layout: { ...layout, turns: [...layout.turns, layout.turns[0]!] } },
    });
    expectParity({
      ...base,
      stair: {
        ...base.stair,
        layout: { ...layout, legs: layout.legs.map(() => ({ length: "auto" as const })) },
      },
    });
  });

  it("plus de 16 volées : aucune borne du nombre de tronçons pour une cage issue de volées", () => {
    // 17 volées en zigzag (S successifs) : `CAGE_MAX_SECTIONS` ne vaut que pour une cage saisie.
    const base = createProject("quarter-left");
    const layout = base.stair.layout as FlightsLayoutSpec;
    const project: Project = {
      ...base,
      stair: {
        ...base.stair,
        layout: {
          ...layout,
          width: 900,
          legs: Array.from({ length: 17 }, () => ({ length: 2000 })),
          turns: Array.from({ length: 16 }, (_, i) => ({
            direction: i % 2 === 0 ? ("right" as const) : ("left" as const),
            mode: "landing" as const,
            inner: { kind: "sharp" as const },
          })),
        },
      },
    };
    expectParity(project);
    expect(viaCage(project).turns).toHaveLength(16);
  });

  it("propriété : tracés à volées quelconques (1 à 4 volées, S / Z, raccords, d_f, placement)", () => {
    fc.assert(
      fc.property(flightsProjectArb, (project) => {
        expectParity(project);
      }),
      { numRuns: 500 },
    );
  });
});

// ------------------------------------------------------------------ générateur

const innerArb: fc.Arbitrary<InnerCorner> = fc.oneof(
  fc.constant({ kind: "sharp" as const }),
  fc.record({ kind: fc.constant("arc" as const), radius: fc.integer({ min: 1, max: 400 }) }),
  fc
    .integer({ min: 30, max: 90 })
    .chain((k) => fc.record({ k: fc.constant(k), offset: fc.integer({ min: 0, max: k + 3 }) }))
    .map(({ k, offset }) =>
      offset === 0
        ? { kind: "newel" as const, size: 2 * k }
        : { kind: "newel" as const, size: 2 * k, offset },
    ),
);

const setbackOf = (inner: InnerCorner): number =>
  inner.kind === "sharp"
    ? 0
    : inner.kind === "arc"
      ? inner.radius
      : inner.size / 2 + (inner.offset ?? 0);

/**
 * Projets à volées : 1 à 4 volées, sens de chaque tournant libre (U, S, Z, recouvrements),
 * balancé ou palier, jour vif / arc / poteau (décalé ou non, parfois trop), E de 600 à 1 500,
 * ligne de foulée DTU / distance saisie / bord imposé, placement quelconque. Les longueurs sont
 * le plus souvent faisables (minimum + marge, ou exactement le minimum), parfois quelconques
 * (erreurs comparées).
 */
const flightsProjectArb: fc.Arbitrary<Project> = fc
  .record({
    width: fc.integer({ min: 600, max: 1500 }),
    legCount: fc.integer({ min: 1, max: 4 }),
    turns: fc.array(
      fc.record({
        direction: fc.constantFrom("left" as const, "right" as const),
        mode: fc.constantFrom("winders" as const, "landing" as const),
        inner: innerArb,
      }),
      { minLength: 3, maxLength: 3 },
    ),
    lengths: fc.array(
      fc.oneof(
        { weight: 6, arbitrary: fc.integer({ min: 0, max: 3000 }).map((e) => ({ extra: e })) },
        { weight: 3, arbitrary: fc.constant({ extra: 0 }) },
        { weight: 2, arbitrary: fc.integer({ min: 1, max: 6000 }).map((l) => ({ raw: l })) },
      ),
      { minLength: 4, maxLength: 4 },
    ),
    walkline: fc.oneof(
      fc.record({
        mode: fc.constant("dtu" as const),
        side: fc.option(fc.constantFrom("left" as const, "right" as const), { nil: undefined }),
      }),
      fc.record({
        mode: fc.constant("fromInner" as const),
        ratio: fc.double({ min: 0.05, max: 1.05, noNaN: true }),
        side: fc.option(fc.constantFrom("left" as const, "right" as const), { nil: undefined }),
      }),
    ),
    origin: fc.record({
      x: fc.double({ min: -20000, max: 20000, noNaN: true }),
      y: fc.double({ min: -20000, max: 20000, noNaN: true }),
    }),
    rotation: fc.oneof(
      fc.integer({ min: -360, max: 360 }),
      fc.double({ min: -720, max: 720, noNaN: true }),
    ),
    autoStraight: fc.boolean(),
  })
  .map((r) => {
    const turns = r.turns.slice(0, r.legCount - 1);
    const legs = Array.from({ length: r.legCount }, (_, i) => {
      const spec = r.lengths[i]!;
      if ("raw" in spec) return { length: spec.raw };
      const before = i > 0 ? r.width + setbackOf(turns[i - 1]!.inner) : 0;
      const after = i < turns.length ? r.width + setbackOf(turns[i]!.inner) : 0;
      return { length: Math.max(1, before + after + spec.extra) };
    });
    const walkline =
      r.walkline.mode === "dtu"
        ? { mode: "dtu" as const, ...(r.walkline.side ? { side: r.walkline.side } : {}) }
        : {
            mode: "fromInner" as const,
            distance: Math.max(1, Math.round(r.width * r.walkline.ratio)),
            ...(r.walkline.side ? { side: r.walkline.side } : {}),
          };
    const input: ProjectInput = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      site: { floorToFloor: 2700, upperSlabThickness: 200 },
      stair: {
        placement: { origin: r.origin, rotation: r.rotation },
        layout: {
          width: r.width,
          legs: r.legCount === 1 && r.autoStraight ? [{ length: "auto" }] : legs,
          turns,
        },
        walkline,
      },
    };
    return ProjectSchema.parse(input);
  });

describe("générateur de la propriété de parité", () => {
  it("couvre tracés calculés (0 à 3 tournants, S / Z, jour nul, emprises dégénérées) et erreurs", () => {
    const seen = new Set<string>();
    for (const project of fc.sample(flightsProjectArb, { numRuns: 500, seed: 1 })) {
      const o = outcome(() => computeLayout(project));
      if ("error" in o) {
        seen.add(`error:${(o.error as { msg: { key: string } }).msg.key}`);
        continue;
      }
      const layout = o.layout as Layout;
      seen.add(`turns:${layout.turns.length}`);
      if (layout.walklineTransitions) seen.add("transitions");
      if (layout.zeroLengthInner) seen.add("zeroLengthInner");
      if (layout.walklineSide) seen.add(`side:${layout.walklineSide}`);
      for (const e of layout.errors ?? []) seen.add(`layoutError:${e.key}`);
    }
    expect([...seen].sort()).toEqual(
      [
        "turns:0",
        "turns:1",
        "turns:2",
        "turns:3",
        "transitions",
        "zeroLengthInner",
        "side:left",
        "side:right",
        "layoutError:layout.flightsTouch",
        "layoutError:layout.flightsOverlap",
        "error:layout.legTooShort",
        "error:layout.legTooShortForTransition",
        "error:layout.newelOffsetTooLarge",
        "error:layout.walklineCrossesNewel",
        "error:layout.walklineOutsideWidth",
      ].sort(),
    );
  });
});
