/**
 * Tracé libre (CAGE, ADR-0010, sous-lot 0b) côté projet : schéma `kind: "cage"`, champs dérivés,
 * sérialisation stable, messages de validation et `buildModel` sans exception (moteur de cage
 * à ±90° depuis le sous-lot 1c ; les autres fonctions rendent une erreur « pas encore »).
 */
import fc from "fast-check";
import type { MessageKey } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import {
  CAGE_MAX_SECTIONS,
  isCageLayout,
  isHelicalLayout,
  PROJECT_SCHEMA_VERSION,
} from "../model/project.js";
import type { CageLayoutSpecInput } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { ProjectParseError } from "./errors.js";
import { parseProject, parseProjectText } from "./parse.js";
import { serializeProject } from "./serialize.js";

function cageProject(
  layout: unknown,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: { floorToFloor: 2700, upperSlabThickness: 200 },
    stair: { placement: { origin: { x: 0, y: 0 } }, layout },
    ...extra,
  };
}

/** Clés (ou textes) de toutes les erreurs d'un modèle, pour les comparer en entier. */
function modelErrorKeys(errors: readonly unknown[]): unknown[] {
  return errors.map((e) =>
    typeof e === "object" && e !== null && "key" in e ? (e as { key: unknown }).key : e,
  );
}

const QUARTER: CageLayoutSpecInput = {
  kind: "cage",
  sections: [
    { axis: { kind: "straight", length: 2400 }, width: 900 },
    { axis: { kind: "straight", length: 1200 }, width: 800, widthEnd: 1000, anchor: "left" },
  ],
  junctions: [{ angle: 90, mode: "winders", well: { kind: "arc", radius: 150 } }],
};

/** Clés des messages de validation d'un projet invalide. */
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

describe("schéma cage", () => {
  it("lecture : champs dérivés width (largeur minimale), legs et turns vides, défauts des raccords", () => {
    const p = parseProject(cageProject(QUARTER));
    const layout = p.stair.layout;
    expect(isCageLayout(layout)).toBe(true);
    expect(isHelicalLayout(layout)).toBe(false);
    if (!isCageLayout(layout)) throw new Error("cage attendue");
    expect(layout.width).toBe(800);
    expect(layout.legs).toEqual([]);
    expect(layout.turns).toEqual([]);
    expect(layout.junctions[0]!.wall).toEqual({ kind: "sharp" });
    expect(layout.junctions[0]!.well).toEqual({ kind: "arc", radius: 150 });
  });

  it("sérialisation : sans champs dérivés, stable à la relecture", () => {
    const text = serializeProject(parseProject(cageProject(QUARTER)));
    const json = JSON.parse(text) as { stair: { layout: Record<string, unknown> } };
    expect(Object.keys(json.stair.layout).sort()).toEqual(["junctions", "kind", "sections"]);
    const again = parseProjectText(text);
    expect(serializeProject(again)).toBe(text);
    // Les champs dérivés éventuellement présents en entrée sont ignorés et recalculés.
    const withDerived = parseProject(cageProject({ ...QUARTER, width: 12, legs: [], turns: [] }));
    expect(withDerived.stair.layout.width).toBe(800);
    expect(serializeProject(withDerived)).toBe(text);
  });

  it("une cage sans jonction (un tronçon, longueur auto) est valide", () => {
    const p = parseProject(
      cageProject({
        kind: "cage",
        sections: [{ axis: { kind: "straight", length: "auto" }, width: 900 }],
        junctions: [],
      }),
    );
    expect(p.stair.layout.width).toBe(900);
  });

  it("une cage de 16 tronçons (borne F8 incluse) est valide", () => {
    const p = parseProject(
      cageProject({
        kind: "cage",
        sections: Array.from({ length: CAGE_MAX_SECTIONS }, () => ({
          axis: { kind: "straight", length: 1000 },
          width: 900,
        })),
        junctions: Array.from({ length: CAGE_MAX_SECTIONS - 1 }, (_, i) => ({
          angle: i % 2 === 0 ? 90 : -90,
          mode: "landing",
        })),
      }),
    );
    if (!isCageLayout(p.stair.layout)) throw new Error("cage attendue");
    expect(p.stair.layout.sections).toHaveLength(CAGE_MAX_SECTIONS);
  });

  it("un tronçon droit de longueur 0 est admis (demi-tour par deux jonctions de 90°, F4)", () => {
    const p = parseProject(
      cageProject({
        kind: "cage",
        sections: [
          { axis: { kind: "straight", length: 2400 }, width: 900 },
          { axis: { kind: "straight", length: 0 }, width: 900 },
          { axis: { kind: "straight", length: 2400 }, width: 900 },
        ],
        junctions: [
          { angle: 90, mode: "winders" },
          { angle: 90, mode: "winders" },
        ],
      }),
    );
    expect(isCageLayout(p.stair.layout)).toBe(true);
  });

  it.each<[string, unknown, string, MessageKey]>([
    [
      "aucun tronçon",
      { kind: "cage", sections: [], junctions: [] },
      "stair.layout.sections",
      "layout.cage.sectionCount",
    ],
    [
      "plus de 16 tronçons",
      {
        kind: "cage",
        sections: Array.from({ length: CAGE_MAX_SECTIONS + 1 }, () => ({
          axis: { kind: "straight", length: 1000 },
          width: 900,
        })),
        junctions: Array.from({ length: CAGE_MAX_SECTIONS }, () => ({
          angle: 90,
          mode: "landing",
        })),
      },
      "stair.layout.sections",
      "layout.cage.sectionCount",
    ],
    [
      "nombre de jonctions incohérent",
      { ...QUARTER, junctions: [] },
      "stair.layout.junctions",
      "layout.cage.junctionCountMismatch",
    ],
    [
      "longueur auto sur plusieurs tronçons",
      {
        ...QUARTER,
        sections: [{ axis: { kind: "straight", length: "auto" }, width: 900 }, QUARTER.sections[1]],
      },
      "stair.layout.sections[0].axis.length",
      "layout.cage.autoLengthSingleSection",
    ],
    [
      "angle de 180°",
      { ...QUARTER, junctions: [{ angle: 180, mode: "landing" }] },
      "stair.layout.junctions[0].angle",
      "layout.cage.angleOutOfRange",
    ],
    [
      "angle de −200°",
      { ...QUARTER, junctions: [{ angle: -200, mode: "winders" }] },
      "stair.layout.junctions[0].angle",
      "layout.cage.angleOutOfRange",
    ],
    [
      "angle 0 balancé",
      { ...QUARTER, junctions: [{ angle: 0, mode: "winders" }] },
      "stair.layout.junctions[0].mode",
      "layout.cage.straightJunctionLanding",
    ],
    [
      "profondeur sur une jonction tournante",
      { ...QUARTER, junctions: [{ angle: 90, mode: "landing", depth: 900 }] },
      "stair.layout.junctions[0].depth",
      "layout.cage.depthStraightLandingOnly",
    ],
    [
      "largeur variable sur un axe en arc",
      {
        ...QUARTER,
        sections: [
          QUARTER.sections[0],
          { axis: { kind: "arc", radius: 1500, sweep: 45 }, width: 900, widthEnd: 1000 },
        ],
      },
      "stair.layout.sections[1].widthEnd",
      "layout.cage.arcVariableWidth",
    ],
    [
      "balayage nul",
      {
        ...QUARTER,
        sections: [
          QUARTER.sections[0],
          { axis: { kind: "arc", radius: 1500, sweep: 0 }, width: 900 },
        ],
      },
      "stair.layout.sections[1].axis.sweep",
      "layout.cage.sweepOutOfRange",
    ],
    [
      "balayage d'un tour",
      {
        ...QUARTER,
        sections: [
          QUARTER.sections[0],
          { axis: { kind: "arc", radius: 1500, sweep: -360 }, width: 900 },
        ],
      },
      "stair.layout.sections[1].axis.sweep",
      "layout.cage.sweepOutOfRange",
    ],
    [
      "palier droit avec un raccord côté jour non vif",
      {
        ...QUARTER,
        junctions: [{ angle: 0, mode: "landing", well: { kind: "newel", size: 100 } }],
      },
      "stair.layout.junctions[0].well",
      "layout.cage.straightJunctionSharp",
    ],
    [
      "palier droit avec un pan coupé côté jour",
      {
        ...QUARTER,
        junctions: [
          { angle: 0, mode: "landing", well: { kind: "chamfer", setbackIn: 50, setbackOut: 50 } },
        ],
      },
      "stair.layout.junctions[0].well",
      "layout.cage.straightJunctionSharp",
    ],
    [
      "palier droit avec un raccord côté mur en arc",
      {
        ...QUARTER,
        junctions: [{ angle: 0, mode: "landing", wall: { kind: "arc", radius: 200 } }],
      },
      "stair.layout.junctions[0].wall",
      "layout.cage.straightJunctionSharp",
    ],
  ])("refus : %s", (_name, layout, path, key) => {
    expect(issueKeys(cageProject(layout))).toContainEqual({ path, key });
  });

  it("refus des valeurs de base (largeur non positive, profondeur nulle, retrait de pan coupé nul)", () => {
    const bad = (layout: unknown): string[] => issueKeys(cageProject(layout)).map((i) => i.path);
    expect(
      bad({ ...QUARTER, sections: [{ ...QUARTER.sections[0], width: 0 }, QUARTER.sections[1]] }),
    ).toContain("stair.layout.sections[0].width");
    expect(bad({ ...QUARTER, junctions: [{ angle: 0, mode: "landing", depth: 0 }] })).toContain(
      "stair.layout.junctions[0].depth",
    );
    expect(
      bad({
        ...QUARTER,
        junctions: [
          { angle: 60, mode: "winders", well: { kind: "chamfer", setbackIn: 0, setbackOut: 100 } },
        ],
      }),
    ).toContain("stair.layout.junctions[0].well.setbackIn");
  });

  it("buildModel sur une cage à largeur variable : tracé calculé, aval sauté avec une seule erreur claire", () => {
    const p = parseProject(cageProject(QUARTER));
    const model = buildModel(p);
    expect(modelErrorKeys(model.errors)).toEqual(["pipeline.cageDownstreamNotYetSupported"]);
    expect(model.layout.sections?.[1]).toMatchObject({ widthStart: 800, widthEnd: 1000 });
  });

  it("buildModel sur une cage à largeur variable, limon à la française et garde-corps : aval sauté, structure refusée", () => {
    const project = cageProject(QUARTER, { guards: { flight: { enabled: true } } });
    (project.stair as Record<string, unknown>).structure = { kind: "wood-housed" };
    const p = parseProject(project);
    expect(p.stair.structure.kind).toBe("wood-housed");
    expect(p.guards?.flight.enabled).toBe(true);
    const model = buildModel(p);
    // Sous-lot 2c : découpage et pièces de base calculés ; le plugin reste sauté (cage saisie).
    expect(modelErrorKeys(model.errors)).toEqual([
      "pipeline.cageDownstreamNotYetSupported",
      "structure.cageUnsupported",
    ]);
    expect(model.stepping.treads.length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ propriétés

const arbWell = fc.oneof(
  fc.constant({ kind: "sharp" as const }),
  fc.record({ kind: fc.constant("arc" as const), radius: fc.integer({ min: 1, max: 600 }) }),
  fc.record(
    {
      kind: fc.constant("newel" as const),
      size: fc.integer({ min: 1, max: 200 }),
      offset: fc.integer({ min: 0, max: 50 }),
    },
    { requiredKeys: ["kind", "size"] },
  ),
  fc.record({
    kind: fc.constant("chamfer" as const),
    setbackIn: fc.integer({ min: 1, max: 400 }),
    setbackOut: fc.integer({ min: 1, max: 400 }),
  }),
);
const arbWall = fc.oneof(
  fc.constant({ kind: "sharp" as const }),
  fc.record({ kind: fc.constant("arc" as const), radius: fc.integer({ min: 1, max: 1500 }) }),
);
const arbSection = fc.oneof(
  fc.record(
    {
      axis: fc.record({
        kind: fc.constant("straight" as const),
        // 0 compris : demi-tour par deux jonctions de 90° (F4).
        length: fc.integer({ min: 0, max: 6000 }),
      }),
      width: fc.integer({ min: 500, max: 2000 }),
      widthEnd: fc.integer({ min: 500, max: 2000 }),
      anchor: fc.constantFrom("left" as const, "right" as const, "center" as const),
    },
    { requiredKeys: ["axis", "width"] },
  ),
  fc.record(
    {
      axis: fc.record({
        kind: fc.constant("arc" as const),
        radius: fc.integer({ min: 1, max: 5000 }),
        sweep: fc
          .double({ min: -359.5, max: 359.5, noNaN: true })
          .filter((s) => Math.abs(s) > 1e-6),
      }),
      width: fc.integer({ min: 500, max: 2000 }),
      anchor: fc.constantFrom("left" as const, "right" as const, "center" as const),
    },
    { requiredKeys: ["axis", "width"] },
  ),
);
const arbTurning = fc.record(
  {
    angle: fc.oneof(
      fc.constantFrom(90, -90, 45, -135),
      fc.double({ min: -179.9, max: 179.9, noNaN: true }).filter((a) => a !== 0),
    ),
    mode: fc.constantFrom("winders" as const, "landing" as const, "radiating" as const),
    well: arbWell,
    wall: arbWall,
  },
  { requiredKeys: ["angle", "mode"] },
);
// `depth` facultatif (fc.record sans la clé dans `requiredKeys`) : palier droit sans profondeur
// saisie (défaut F9) tiré aussi bien qu'avec.
const arbStraightLanding = fc.record(
  {
    angle: fc.constant(0),
    mode: fc.constant("landing" as const),
    depth: fc.integer({ min: 1, max: 3000 }),
    well: fc.constant({ kind: "sharp" as const }),
    wall: fc.constant({ kind: "sharp" as const }),
  },
  { requiredKeys: ["angle", "mode"] },
);
const arbMultiCage = fc
  .array(arbSection, { minLength: 1, maxLength: CAGE_MAX_SECTIONS })
  .chain((sections) =>
    fc
      .array(fc.oneof(arbTurning, arbStraightLanding), {
        minLength: sections.length - 1,
        maxLength: sections.length - 1,
      })
      .map((junctions) => ({ kind: "cage" as const, sections, junctions })),
  );
/** Cage d'un seul tronçon droit de longueur `auto` (seul cas où `auto` est admis). */
const arbAutoCage = fc
  .record(
    {
      width: fc.integer({ min: 500, max: 2000 }),
      widthEnd: fc.integer({ min: 500, max: 2000 }),
      anchor: fc.constantFrom("left" as const, "right" as const, "center" as const),
    },
    { requiredKeys: ["width"] },
  )
  .map((s) => ({
    kind: "cage" as const,
    sections: [{ axis: { kind: "straight" as const, length: "auto" as const }, ...s }],
    junctions: [],
  }));
/** Cage de 16 tronçons exactement (borne F8), tirée à part : rare dans `arbMultiCage`. */
const arbMaxCage = fc
  .array(arbSection, { minLength: CAGE_MAX_SECTIONS, maxLength: CAGE_MAX_SECTIONS })
  .chain((sections) =>
    fc
      .array(fc.oneof(arbTurning, arbStraightLanding), {
        minLength: sections.length - 1,
        maxLength: sections.length - 1,
      })
      .map((junctions) => ({ kind: "cage" as const, sections, junctions })),
  );
const arbCage = fc.oneof(
  { arbitrary: arbMultiCage, weight: 6 },
  { arbitrary: arbAutoCage, weight: 1 },
  { arbitrary: arbMaxCage, weight: 1 },
);

describe("propriétés de la cage", () => {
  it("cage valide : parse → serialize → parse idempotent, sans champs dérivés", () => {
    fc.assert(
      fc.property(arbCage, (layout) => {
        const p = parseProject(cageProject(layout));
        const text = serializeProject(p);
        const q = parseProjectText(text);
        expect(q).toEqual(p);
        expect(serializeProject(q)).toBe(text);
        const persisted = (JSON.parse(text) as { stair: { layout: Record<string, unknown> } }).stair
          .layout;
        expect(persisted).not.toHaveProperty("width");
        expect(persisted).not.toHaveProperty("legs");
        expect(persisted).not.toHaveProperty("turns");
        const widths = layout.sections.flatMap((s) => [
          s.width,
          "widthEnd" in s && s.widthEnd !== undefined ? s.widthEnd : s.width,
        ]);
        expect(q.stair.layout.width).toBe(Math.min(...widths));
      }),
      { numRuns: 100 },
    );
  });

  it("buildModel ne lève jamais sur une cage valide (tracé calculé ou erreur de cage)", () => {
    // Cages calculables depuis 1c (±90°, largeur constante, jour vif ou en arc), tirées à part :
    // `arbCage` n'en produit presque jamais de plus d'un tronçon.
    const arbComputable = fc
      .record({
        width: fc.integer({ min: 600, max: 1500 }),
        lengths: fc.array(fc.integer({ min: 600, max: 3000 }), { minLength: 2, maxLength: 4 }),
        junctions: fc.array(
          fc.record({
            angle: fc.constantFrom(90, -90),
            mode: fc.constantFrom("winders" as const, "landing" as const),
            well: fc.oneof(
              fc.constant({ kind: "sharp" as const }),
              fc.record({
                kind: fc.constant("arc" as const),
                radius: fc.integer({ min: 1, max: 300 }),
              }),
            ),
          }),
          { minLength: 3, maxLength: 3 },
        ),
      })
      .map((r) => ({
        kind: "cage" as const,
        sections: r.lengths.map((length) => ({
          axis: { kind: "straight" as const, length },
          width: r.width,
        })),
        junctions: r.junctions.slice(0, r.lengths.length - 1),
      }));
    let computedMulti = 0;
    fc.assert(
      fc.property(fc.oneof(arbCage, arbComputable), (layout) => {
        const model = buildModel(parseProject(cageProject(layout)), { memo: false });
        const keys = modelErrorKeys(model.errors);
        // Aucune erreur interne : un échec du tracé est une erreur `layout.*` explicite.
        expect(keys.filter((k) => k === "pipeline.internalError")).toEqual([]);
        if (model.layout.sections === undefined) {
          expect(keys.some((k) => typeof k === "string" && k.startsWith("layout."))).toBe(true);
        } else {
          // Tracé calculé : un tronçon de sortie par tronçon saisi.
          expect(model.layout.sections).toHaveLength(layout.sections.length);
          if (layout.sections.length > 1) computedMulti++;
        }
      }),
      { numRuns: 80 },
    );
    // Les deux issues sont bien tirées : des cages de plusieurs tronçons sont calculées.
    expect(computedMulti).toBeGreaterThan(0);
  });
});
