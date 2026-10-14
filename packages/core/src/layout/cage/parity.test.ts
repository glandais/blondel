/**
 * Non-régression du tracé à volées (sous-lots 1b, 1c et 2f, ADR-0010, plan B.5) : depuis le
 * sous-lot 1c, `computeLayout` calcule tout tracé à volées par `flightsToCage` puis
 * `computeCageLayout`. La parité stricte avec l'ancien moteur à volées (copie figée, supprimée
 * au sous-lot 2f) est désormais **figée** dans des instantanés,
 * enregistrés quand les deux moteurs rendaient le même `Layout` (vérifié au même passage, voir
 * le journal du sous-lot 2f) :
 * - exemples à volées, préréglages et démos : `Layout` complet (`__snapshots__/parity.test.ts.snap`,
 *   nombres en pleine précision, −0 distingué), ou l'erreur (nom, clé et paramètres) ;
 * - option `legLengths` de l'assistant et cas d'erreur : idem ;
 * - tracés à volées tirés (générateur pseudo-aléatoire **propre au test**, graine fixe, donc
 *   indépendant des versions de fast-check) : pour chaque tirage, un résumé lisible (tournants,
 *   longueurs de Γ et des bords, d_f, clé d'erreur) et l'empreinte SHA-256 d'une projection
 *   métier (bords, Γ, d_f, emprise, côté, clés d'erreur, nombres à 1e-9), pour garder la
 *   couverture de l'ancienne propriété (S / Z, raccords, d_f, placement). Empreintes et résumés
 *   ont été vérifiés contre l'ancien moteur avant sa suppression (même `Layout`, donc même
 *   projection). **Un `-u` de ce test exige une justification au journal** : relire le diff
 *   des résumés, une empreinte seule modifiée signale un écart géométrique.
 * Les ajouts du moteur de cage (`sections`, `angle`, `well`, `wall` des tournants) font partie
 * des instantanés. Un écart d'instantané est une régression du tracé à volées, sauf évolution
 * voulue et justifiée (`-u` documenté au journal). Hélicoïdal (F10, sous-lot P3) : `Layout`
 * complet des exemples, démos et préréglage hélicoïdaux, calculés par la cage d'origine
 * `helical`, figé de même ; instantanés enregistrés pendant que la parité stricte avec l'ancien
 * tracé hélicoïdal (copie figée `legacyHelical.ts`, retirée en P3 : `Layout.helical` au bit, le
 * reste à 1e-6 mm et 1e-9 rad) était encore vérifiée au même passage (journal du chantier).
 */
import { createHash } from "node:crypto";
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
import {
  createProject,
  HELICAL_PRESET_IDS,
  OPPOSITE_TURNS_PRESET_IDS,
  PRESET_IDS,
} from "../../project/presets.js";
import { parseProjectText } from "../../project/parse.js";

import { computeLayout, type LayoutOptions } from "../layout.js";
import { resolveLegLengths } from "../resolve.js";
import { curveLength } from "../../geom2d/curve.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../examples");
const EXAMPLE_FILES = readdirSync(EXAMPLES_DIR)
  .filter((f) => f.endsWith(".blondel.json"))
  .sort();

type Outcome = { readonly layout: Layout } | { readonly error: unknown };

/** Résultat comparable : tracé complet, ou erreur (nom, clé et paramètres). */
function outcome(run: () => Layout): Outcome {
  try {
    return { layout: run() };
  } catch (e) {
    return { error: e instanceof MessageError ? { name: e.name, msg: e.msg } : String(e) };
  }
}

/** Tracé courant comparé à son instantané (parité figée). */
function expectFrozen(project: Project, options?: LayoutOptions): void {
  expect(outcome(() => computeLayout(project, options))).toMatchSnapshot();
}

/** Sérialisation canonique : nombres en pleine précision, −0 distingué, `undefined` marqué. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    typeof v === "number"
      ? Object.is(v, -0)
        ? "-0"
        : Number.isFinite(v)
          ? v
          : String(v)
      : v === undefined
        ? "undefined"
        : v,
  );
}

/** Nombre arrondi à 1e-9 mm (projection métier, insensible au bruit d'arrondi de sérialisation). */
const r9 = (v: unknown): unknown =>
  typeof v === "number"
    ? Number.isFinite(v)
      ? Math.round(v * 1e9) / 1e9 + 0
      : String(v)
    : Array.isArray(v)
      ? v.map(r9)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, r9(x)]))
        : v;

/**
 * Résumé lisible et empreinte d'une projection **métier** du résultat d'un tirage : bords du
 * jour et du mur, ligne de foulée, d_f, emprise, côté intérieur, clés d'erreur ; nombres à
 * 1e-9. Un champ ajouté au `Layout` ne change donc pas l'empreinte, et un `-u` laisse un diff
 * relisible (nombre de tournants, longueurs de Γ et des bords, clé d'erreur).
 */
function drawSummary(o: Outcome): string {
  if ("error" in o) {
    const e = o.error as { name?: string; msg?: { key?: string } } | string;
    const key = typeof e === "string" ? e : `${e.name ?? "?"}:${e.msg?.key ?? "?"}`;
    return `erreur ${key}`;
  }
  const l = o.layout;
  const projection = {
    inner: l.inner,
    outer: l.outer,
    walkline: l.walkline,
    walklineOffset: l.walklineOffset,
    footprint: l.footprint,
    innerSide: l.innerSide,
    errors: (l.errors ?? []).map((m) => m.key),
  };
  const hash = createHash("sha256")
    .update(canonical(r9(projection)))
    .digest("hex")
    .slice(0, 12);
  const mm = (c: Layout["walkline"]): string => curveLength(c).toFixed(3);
  const errs = projection.errors.length > 0 ? ` erreurs=${projection.errors.join("+")}` : "";
  return (
    `${l.turns.length}T ${l.innerSide} Γ=${mm(l.walkline)} jour=${mm(l.inner)} ` +
    `mur=${mm(l.outer)} d_f=${l.walklineOffset.toFixed(3)}${errs} #${hash}`
  );
}

const isFlights = (p: Project): boolean =>
  !isHelicalLayout(p.stair.layout) && !isCageLayout(p.stair.layout);

describe("non-régression du tracé à volées (parité figée avec l'ancien moteur)", () => {
  const examples = EXAMPLE_FILES.map(
    (f) => [f, parseProjectText(readFileSync(join(EXAMPLES_DIR, f), "utf8"))] as const,
  ).filter(([, p]) => isFlights(p));

  it("des exemples à volées existent", () => {
    expect(examples.length).toBeGreaterThan(10);
  });

  it.each(examples)("exemple %s", (_file, project) => {
    expectFrozen(project);
    // Le tracé est bien calculé (pas une parité d'erreurs).
    expect("layout" in outcome(() => computeLayout(project))).toBe(true);
    // Le chemin unique porte les tronçons, un par volée.
    expect(computeLayout(project).sections).toHaveLength(
      (project.stair.layout as FlightsLayoutSpec).legs.length,
    );
  });

  it.each([...PRESET_IDS, ...OPPOSITE_TURNS_PRESET_IDS])("préréglage %s", (id) => {
    expectFrozen(createProject(id));
  });

  it.each(DEMO_PRESET_IDS.filter((id) => isFlights(createDemoProject(id))))("démo %s", (id) => {
    expectFrozen(createDemoProject(id));
  });

  const helicalCases: readonly (readonly [string, Project])[] = [
    ...EXAMPLE_FILES.map(
      (f) =>
        [`exemple ${f}`, parseProjectText(readFileSync(join(EXAMPLES_DIR, f), "utf8"))] as const,
    ),
    ...DEMO_PRESET_IDS.map((id) => [`démo ${id}`, createDemoProject(id)] as const),
    ...HELICAL_PRESET_IDS.map((id) => [`préréglage ${id}`, createProject(id)] as const),
  ].filter(([, p]) => isHelicalLayout(p.stair.layout));

  it("des hélicoïdaux existent (exemples, démos, préréglage)", () => {
    expect(helicalCases.length).toBe(10);
  });

  it.each(helicalCases)(
    "hélicoïdal, %s : cage d'origine helical, tracé figé (F10, P3)",
    (_name, p) => {
      expectFrozen(p);
      const layout = computeLayout(p);
      // Ajouts de la cage d'origine `helical` ; pas de marque de cage saisie.
      expect(layout.helical).toBeDefined();
      expect(layout.helicalOrigin).toBeDefined();
      expect(layout.sections?.length).toBe(1);
      expect(layout.sections?.[0]?.kind).toBe("arc");
      expect(layout.cage).toBeUndefined();
    },
  );

  it.each([...PRESET_IDS, ...OPPOSITE_TURNS_PRESET_IDS])(
    "option legLengths (assistant), préréglage %s : longueurs imposées, nombre incohérent, longueur non positive",
    (id) => {
      const project = createProject(id);
      if (!isFlights(project)) return;
      const lengths = resolveLegLengths(project).map((l) => l + 137);
      expectFrozen(project, { legLengths: lengths });
      expectFrozen(project, { legLengths: [...lengths, 1000] });
      expectFrozen(project, { legLengths: lengths.map((l, i) => (i === 0 ? -1 : l)) });
    },
  );

  it("erreurs : nombre de tournants, longueur auto hors escalier droit", () => {
    const base = createProject("quarter-left");
    const layout = base.stair.layout as FlightsLayoutSpec;
    expectFrozen({
      ...base,
      stair: { ...base.stair, layout: { ...layout, turns: [...layout.turns, layout.turns[0]!] } },
    });
    expectFrozen({
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
    expectFrozen(project);
    expect(computeLayout(project).turns).toHaveLength(16);
    expect(computeLayout(project).sections).toHaveLength(17);
  });

  it(`tracés tirés (${FROZEN_DRAWS} tirages, graine fixe) : empreintes figées`, () => {
    const projects = drawFlightsProjects(FROZEN_DRAWS, FROZEN_SEED);
    expect(projects.map((p) => drawSummary(outcome(() => computeLayout(p))))).toMatchSnapshot();
  });

  it("propriété : tracés à volées quelconques, tracé ou erreur du tracé, jamais d'autre exception", () => {
    fc.assert(
      fc.property(flightsProjectArb, (project) => {
        const o = outcome(() => computeLayout(project));
        if ("error" in o) expect((o.error as { name?: string }).name).toBe("LayoutError");
        else
          expect(o.layout.sections).toHaveLength(
            (project.stair.layout as FlightsLayoutSpec).legs.length,
          );
      }),
      { numRuns: 300 },
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

/** Tirage brut d'un projet à volées (fast-check ou générateur à graine fixe). */
interface FlightsDraw {
  readonly width: number;
  readonly legCount: number;
  readonly turns: readonly {
    readonly direction: "left" | "right";
    readonly mode: "winders" | "landing";
    readonly inner: InnerCorner;
  }[];
  readonly lengths: readonly ({ readonly extra: number } | { readonly raw: number })[];
  readonly walkline:
    | { readonly mode: "dtu"; readonly side: "left" | "right" | undefined }
    | {
        readonly mode: "fromInner";
        readonly ratio: number;
        readonly side: "left" | "right" | undefined;
      };
  readonly origin: { readonly x: number; readonly y: number };
  readonly rotation: number;
  readonly autoStraight: boolean;
}

function toFlightsProject(r: FlightsDraw): Project {
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
}

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
  .map(toFlightsProject);

describe("générateur des tracés à volées tirés", () => {
  it("couvre tracés calculés (0 à 3 tournants, S / Z, jour nul, emprises dégénérées) et erreurs", () => {
    const seen = new Set<string>();
    for (const project of drawFlightsProjects(FROZEN_DRAWS, FROZEN_SEED)) {
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

// ------------------------------------------------------------------ tirages à graine fixe

/** Nombre de tracés tirés figés et graine (changer l'un ou l'autre change l'instantané). */
const FROZEN_DRAWS = 800;
const FROZEN_SEED = 20261011;

/** Générateur pseudo-aléatoire mulberry32 (32 bits), propre au test : tirages reproductibles. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `count` projets à volées tirés avec la graine `seed`, mêmes domaines et mêmes poids que
 * `flightsProjectArb`, sans dépendre de fast-check (dont l'échantillonnage peut changer d'une
 * version à l'autre).
 */
function drawFlightsProjects(count: number, seed: number): Project[] {
  const rnd = mulberry32(seed);
  const int = (min: number, max: number): number => min + Math.floor(rnd() * (max - min + 1));
  const real = (min: number, max: number): number => min + rnd() * (max - min);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const side = (): "left" | "right" | undefined =>
    rnd() < 0.5 ? undefined : pick(["left", "right"] as const);
  const inner = (): InnerCorner => {
    const r = rnd();
    if (r < 1 / 3) return { kind: "sharp" };
    if (r < 2 / 3) return { kind: "arc", radius: int(1, 400) };
    const k = int(30, 90);
    const offset = int(0, k + 3);
    return offset === 0 ? { kind: "newel", size: 2 * k } : { kind: "newel", size: 2 * k, offset };
  };
  const length = (): { extra: number } | { raw: number } => {
    const r = rnd() * 11;
    if (r < 6) return { extra: int(0, 3000) };
    if (r < 9) return { extra: 0 };
    return { raw: int(1, 6000) };
  };
  const out: Project[] = [];
  for (let n = 0; n < count; n++) {
    const draw: FlightsDraw = {
      width: int(600, 1500),
      legCount: int(1, 4),
      turns: Array.from({ length: 3 }, () => ({
        direction: pick(["left", "right"] as const),
        mode: pick(["winders", "landing"] as const),
        inner: inner(),
      })),
      lengths: Array.from({ length: 4 }, length),
      walkline:
        rnd() < 0.5
          ? { mode: "dtu", side: side() }
          : { mode: "fromInner", ratio: real(0.05, 1.05), side: side() },
      origin: { x: real(-20000, 20000), y: real(-20000, 20000) },
      rotation: rnd() < 0.5 ? int(-360, 360) : real(-720, 720),
      autoStraight: rnd() < 0.5,
    };
    out.push(toFlightsProject(draw));
  }
  return out;
}
