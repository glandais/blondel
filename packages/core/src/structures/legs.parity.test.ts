/**
 * Parité stricte des faces porteuses d'un tracé à volées (sous-lot 6a, ADR-0010) : depuis le
 * sous-lot 6a, `stairGeometry` lit le tracé (`Layout.sections`, `Layout.turns`) au lieu du
 * `LayoutSpec` (`legs`, `turns`, `width`). Ce test compare, **nombre pour nombre**, la nouvelle
 * lecture à une copie figée de l'ancienne (`legacyStairGeometry`, `legacyStringerFaces`, telles
 * qu'avant le sous-lot 6a) sur les exemples, les préréglages (placement tourné compris), les
 * démos et des tracés à volées tirés au hasard (raccords vif, arc et poteau, placement
 * quelconque) : volées, poteaux et faces des limons à la française identiques (repères, noms,
 * extrémités, origines, directions, longueurs, abscisses). La parité des pièces des structures
 * (limons, crémaillères, acier) sur les exemples et les préréglages est aussi vérifiée par
 * empreinte au journal du sous-lot 6a ; les instantanés (`pipeline/build.test.ts`,
 * `woodHoused.test.ts`) restent inchangés sans `-u`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { msg, type Message } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { cumulativeLengths } from "../geom2d/curve.js";
import { projectOnCurve } from "../geom2d/intersect.js";
import * as V from "../geom2d/vec.js";
import { computeLayout } from "../layout/layout.js";
import { newelOffset, newelSetback } from "../layout/newel.js";
import type { Layout } from "../model/derived.js";
import type { Mm, Vec2 } from "../model/primitives.js";
import {
  isCageLayout,
  isHelicalLayout,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type InnerCorner,
  type Project,
} from "../model/project.js";
import type { StructureContext } from "../model/plugins.js";
import { parseProjectText } from "../project/parse.js";
import { createDemoProject, DEMO_PRESET_IDS } from "../project/presetDemo.js";
import { createProject, PRESET_IDS } from "../project/presets.js";
import { stairGeometry } from "./legs.js";
import { stringerFaces, type StringerFace } from "./woodHoused.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");

// ------------------------------------------------------------------ copie figée (avant 6a)

interface LegacyLeg {
  readonly index: number;
  readonly u: Vec2;
  readonly n: Vec2;
  readonly outerStart: Vec2;
  readonly length: Mm;
  readonly outerSigma0: Mm;
  readonly innerOrigin: Vec2;
  readonly innerT0: Mm;
  readonly innerT1: Mm;
  readonly innerSigma0: Mm;
}

function legacySetback(inner: InnerCorner): Mm {
  switch (inner.kind) {
    case "sharp":
      return 0;
    case "arc":
      return inner.radius;
    case "newel":
      return newelSetback(inner);
  }
}

function legacyStairGeometry(project: Project, layout: Layout) {
  const spec = project.stair.layout;
  const E = spec.width;
  const turns = spec.turns;
  const segs = layout.outer.segments;
  const sign: 1 | -1 = layout.innerSide === "left" ? 1 : -1;
  const cum = cumulativeLengths(layout.outer);
  const legs: LegacyLeg[] = segs.map((seg, i) => {
    if (seg.kind !== "line") throw new Error("segment");
    const d = V.sub(seg.b, seg.a);
    const length = V.norm(d);
    const u = V.normalize(d);
    const n = sign === 1 ? V.perpRight(u) : V.perpLeft(u);
    const innerOrigin = V.addScaled(seg.a, n, -E);
    const t0 = i > 0 ? E + legacySetback(turns[i - 1]!.inner) : 0;
    const t1 = i < turns.length ? length - E - legacySetback(turns[i]!.inner) : length;
    const start = V.addScaled(innerOrigin, u, t0);
    const innerSigma0 =
      t1 - t0 > 1e-9 && layout.inner.segments.length > 0
        ? projectOnCurve(start, layout.inner).s
        : Number.NaN;
    return {
      index: i,
      u,
      n,
      outerStart: seg.a,
      length,
      outerSigma0: cum[i]!,
      innerOrigin,
      innerT0: t0,
      innerT1: t1,
      innerSigma0,
    };
  });
  const newels = turns.flatMap((t, j) => {
    if (t.inner.kind !== "newel") return [];
    const leg = legs[j]!;
    const zone = layout.turns[j];
    const k = zone ? zone.innerCorner : V.addScaled(leg.innerOrigin, leg.u, leg.length - E);
    const offset = newelOffset(t.inner);
    const center = V.sub(k, V.scale(V.add(leg.n, leg.u), offset));
    return [
      {
        turn: j,
        center,
        size: t.inner.size,
        offset,
        jourExtent: newelSetback(t.inner),
        n: leg.n,
        u: leg.u,
      },
    ];
  });
  return { legs, newels, width: E, sign };
}

type LegacyFace = Omit<StringerFace, "startReach" | "endReach" | "startJoint" | "endJoint">;

function legacyStringerFaces(
  project: Project,
  geo: ReturnType<typeof legacyStairGeometry>,
): { faces: LegacyFace[]; errors: Message[]; notes: Message[] } {
  const turns = project.stair.layout.turns;
  const faces: LegacyFace[] = [];
  const errors: Message[] = [];
  const notes: Message[] = [];
  turns.forEach((t, j) => {
    if (t.inner.kind === "arc") {
      errors.push(
        msg("structure.woodHoused.arcJourUnsupported", {
          turn: j + 1,
          flight: j + 1,
          nextFlight: j + 2,
        }),
      );
    } else if (t.inner.kind === "sharp") {
      errors.push(
        msg("structure.woodHoused.sharpJour", { turn: j + 1, flight: j + 1, nextFlight: j + 2 }),
      );
    }
  });
  const last = geo.legs.length - 1;
  for (const leg of geo.legs) {
    const i = leg.index;
    const before = i > 0 ? turns[i - 1]!.inner.kind : null;
    const after = i < last ? turns[i]!.inner.kind : null;
    const start = i === 0 ? "floor" : before === "newel" ? "newel" : null;
    const end = i === last ? "arrival" : after === "newel" ? "newel" : null;
    const len = leg.innerT1 - leg.innerT0;
    if (start && end) {
      if (len > 1) {
        faces.push({
          id: `stringer-inner-${i + 1}`,
          mark: `LI${i + 1}`,
          name: msg("structure.woodHoused.part.innerStringer", { flight: i + 1 }),
          side: "inner",
          leg: i,
          a: V.addScaled(leg.innerOrigin, leg.u, leg.innerT0),
          dir: leg.u,
          into: V.scale(leg.n, -1),
          sigmaA: leg.innerSigma0,
          faceLength: len,
          start: start as "floor" | "newel",
          end: end as "arrival" | "newel",
        });
      } else {
        notes.push(msg("structure.woodHoused.noInnerStraight", { flight: i + 1 }));
      }
    }
    faces.push({
      id: `stringer-outer-${i + 1}`,
      mark: `LE${i + 1}`,
      name: msg("structure.woodHoused.part.outerStringer", { flight: i + 1 }),
      side: "outer",
      leg: i,
      a: leg.outerStart,
      dir: leg.u,
      into: leg.n,
      sigmaA: leg.outerSigma0,
      faceLength: leg.length,
      start: i === 0 ? "floor" : "corner",
      end: i === last ? "arrival" : "corner",
    });
  }
  return { faces, errors, notes };
}

// ------------------------------------------------------------------ comparaison

/** Épaisseur des limons de la comparaison (prolongement aux angles muraux : exactement e). */
const E_STRINGER = 45;

/** Compare les deux lectures ; rend vrai si le tracé à volées a été calculé et comparé. */
function compareFlights(project: Project): boolean {
  const spec = project.stair.layout;
  if (isHelicalLayout(spec) || isCageLayout(spec)) return false;
  let layout: Layout;
  try {
    layout = computeLayout(project);
  } catch {
    return false;
  }
  const opposite = spec.turns.some((t, j) => j > 0 && t.direction !== spec.turns[j - 1]!.direction);
  if (opposite) {
    expect(() => stairGeometry(project, layout)).toThrow();
    return true;
  }
  const legacy = legacyStairGeometry(project, layout);
  const geo = stairGeometry(project, layout);
  expect(geo.legs.map(({ innerDir: _d, ...rest }) => rest)).toStrictEqual(legacy.legs);
  for (const leg of geo.legs) expect(leg.innerDir).toStrictEqual(leg.u);
  expect(geo.newels).toStrictEqual(legacy.newels);
  expect(geo.width).toBe(legacy.width);
  expect(geo.maxWidth).toBe(legacy.width);
  expect(geo.sign).toBe(legacy.sign);
  const ctx = { project, layout } as unknown as StructureContext;
  const now = stringerFaces(ctx, geo, E_STRINGER);
  const before = legacyStringerFaces(project, legacy);
  expect(now.errors).toStrictEqual(before.errors);
  expect(now.notes).toStrictEqual(before.notes);
  expect(
    now.faces.map(({ startReach, endReach, startJoint, endJoint, ...rest }) => {
      // Angle mural : prolongement exactement e, trait « angle mural » ; ailleurs aucun.
      expect(startReach).toBe(rest.start === "corner" ? E_STRINGER : 0);
      expect(endReach).toBe(rest.end === "corner" ? E_STRINGER : 0);
      if (rest.start === "corner")
        expect(startJoint?.key).toBe("structure.woodHoused.joint.wallCorner");
      else expect(startJoint).toBeUndefined();
      if (rest.end === "corner")
        expect(endJoint?.key).toBe("structure.woodHoused.joint.wallCorner");
      else expect(endJoint).toBeUndefined();
      return rest;
    }),
  ).toStrictEqual(before.faces);
  return true;
}

describe("stairGeometry : parité stricte des tracés à volées (sous-lot 6a)", () => {
  const files = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".blondel.json"));

  it.each(files)("%s", (file) => {
    compareFlights(parseProjectText(readFileSync(join(EXAMPLES_DIR, file), "utf8")));
  });

  it.each(PRESET_IDS)("préréglage %s, placement d'origine et tourné", (id) => {
    const p = createProject(id);
    compareFlights(p);
    compareFlights({
      ...p,
      stair: { ...p.stair, placement: { origin: { x: 123, y: -45 }, rotation: 37 } },
    });
  });

  it.each(DEMO_PRESET_IDS)("démo %s", (id) => {
    compareFlights(createDemoProject(id));
  });

  it("propriété : volées tirées (raccords vif, arc, poteau ; placement quelconque)", () => {
    const inner = fc.oneof(
      fc.constant({ kind: "sharp" as const }),
      fc.record({ kind: fc.constant("arc" as const), radius: fc.integer({ min: 50, max: 400 }) }),
      fc.record({
        kind: fc.constant("newel" as const),
        size: fc.integer({ min: 60, max: 140 }),
        offset: fc.option(fc.integer({ min: 0, max: 30 }), { nil: undefined }),
      }),
    );
    const arb = fc.record({
      width: fc.integer({ min: 700, max: 1300 }),
      legs: fc.array(fc.integer({ min: 1600, max: 3600 }), { minLength: 1, maxLength: 4 }),
      turns: fc.array(
        fc.record({
          direction: fc.constantFrom("left" as const, "right" as const),
          mode: fc.constantFrom("winders" as const, "landing" as const),
          inner,
        }),
        { minLength: 3, maxLength: 3 },
      ),
      sameDirection: fc.boolean(),
      rotation: fc.integer({ min: -180, max: 180 }),
      x: fc.integer({ min: -3000, max: 3000 }),
      y: fc.integer({ min: -3000, max: 3000 }),
    });
    let compared = 0;
    let runs = 0;
    fc.assert(
      fc.property(arb, (r) => {
        runs++;
        const turns = r.turns.slice(0, r.legs.length - 1).map((t) => ({
          ...t,
          direction: r.sameDirection ? r.turns[0]!.direction : t.direction,
        }));
        const parsed = ProjectSchema.safeParse({
          schemaVersion: PROJECT_SCHEMA_VERSION,
          site: { floorToFloor: 2700, upperSlabThickness: 200 },
          stair: {
            placement: { origin: { x: r.x, y: r.y }, rotation: r.rotation },
            layout: { width: r.width, legs: r.legs.map((length) => ({ length })), turns },
          },
        });
        if (!parsed.success) return;
        if (compareFlights(parsed.data)) compared++;
      }),
      { numRuns: 300, seed: 6 },
    );
    expect(compared / runs).toBeGreaterThan(0.5);
  });
});
