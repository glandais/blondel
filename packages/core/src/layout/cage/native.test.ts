/**
 * Cage saisie (« native ») à ±90°, calculée par `computeLayout` depuis le sous-lot 1c
 * (ADR-0010) : même `Layout` que le tracé à volées équivalent (`cageToFlights`), `sections`
 * comprises ; jour à poteau calculé par le moteur mais refusé par `computeLayout` (aval pas
 * encore fiable, lots 2c / 2d) ; `buildModel` complet sans exception, structure sautée avec
 * `structure.cageUnsupported` (garde-fou des structures, sous-lot 2f, détaillé dans
 * `structures/cageGuard.test.ts`) sauf si elle déclare les fonctions de la cage (limons à la
 * française, sous-lot 6a, limons acier et crémaillères, sous-lot 6b : jour vif ou en arc signalé
 * par le plugin, tournant refusé par les crémaillères ; limons centraux, sous-lot 6c : poutre
 * construite sans erreur) ; mémoïsation de l'étape
 * « tracé » (clés de `pipeline/build.ts`).
 */
import fc from "fast-check";
import type { Message } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import type { Model } from "../../model/derived.js";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type CageLayoutSpec,
  type CageLayoutSpecInput,
  type Project,
  type Wall,
} from "../../model/project.js";
import { buildModel } from "../../pipeline/build.js";
import { cageFeatures } from "../../model/cageFeatures.js";
import { listStructures, structureAcceptsCage } from "../../structures/index.js";
import { LayoutError } from "../errors.js";
import { computeLayout } from "../layout.js";
import { computeCageLayout } from "./cage.js";
import { cageToFlights } from "./fromFlights.js";

function cageProject(
  layout: CageLayoutSpecInput,
  extra: { structure?: string; walls?: Wall[]; rotation?: number } = {},
): Project {
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: { floorToFloor: 2700, upperSlabThickness: 200, walls: extra.walls ?? [] },
    stair: {
      placement: { origin: { x: 120, y: -40 }, rotation: extra.rotation ?? 0 },
      layout,
      ...(extra.structure !== undefined ? { structure: { kind: extra.structure } } : {}),
    },
  });
}

/** Même projet, tracé réécrit en volées (`cageToFlights`). */
function asFlights(project: Project): Project {
  const flights = cageToFlights(project.stair.layout as CageLayoutSpec);
  if (flights === null) throw new Error("cage non exprimable en volées");
  return { ...project, stair: { ...project.stair, layout: flights } };
}

const straight = (length: number, width = 900) => ({
  axis: { kind: "straight" as const, length },
  width,
});

const SHAPES: Record<string, CageLayoutSpecInput> = {
  "quart tournant gauche, balancé, jour vif": {
    kind: "cage",
    sections: [straight(1500), straight(600)],
    junctions: [{ angle: 90, mode: "winders" }],
  },
  "quart tournant droit, palier, jour en arc": {
    kind: "cage",
    sections: [straight(1500), straight(900)],
    junctions: [{ angle: -90, mode: "landing", well: { kind: "arc", radius: 100 } }],
  },
  "U (deux quarts à droite), poteau décalé": {
    kind: "cage",
    sections: [straight(1200), straight(200), straight(900)],
    junctions: [
      { angle: -90, mode: "winders", well: { kind: "newel", size: 90, offset: 10 } },
      { angle: -90, mode: "landing" },
    ],
  },
  "S (gauche puis droite), E > 1 200 : transition de Γ": {
    kind: "cage",
    sections: [straight(1000, 1300), straight(800, 1300), straight(700, 1300)],
    junctions: [
      { angle: 90, mode: "winders" },
      { angle: -90, mode: "winders" },
    ],
  },
  "droit, longueur auto": {
    kind: "cage",
    sections: [{ axis: { kind: "straight", length: "auto" }, width: 900 }],
    junctions: [],
  },
};

const errorKeys = (m: Model): unknown[] =>
  m.errors.map((e) => ("key" in e ? (e as { key: unknown }).key : e));

const hasNewel = (s: CageLayoutSpecInput): boolean =>
  s.junctions.some((j) => j.well?.kind === "newel");

/** Moteur de cage seul (sans le refus du jour à poteau de `computeLayout`). */
const cageEngine = (p: Project) =>
  computeCageLayout(p, p.stair.layout as CageLayoutSpec, { origin: "cage" });

/** Erreurs d'un jour vif ou en arc sur une cage, par structure à limons qui la construit. */
const JOUR_ERRORS: Readonly<Record<string, { sharp: string; arc: string }>> = {
  "wood-housed": {
    sharp: "structure.woodHoused.sharpJourCage",
    arc: "structure.woodHoused.arcJourCage",
  },
  "steel-flat": {
    sharp: "structure.steel.error.sharpWellCage",
    arc: "structure.steel.error.arcWellCage",
  },
  "steel-profile": {
    sharp: "structure.steel.error.sharpWellCage",
    arc: "structure.steel.error.arcWellCage",
  },
};

/** Structures enregistrées (noms réels du registre, pas de `pipeline.unknownStructure`). */
const STRUCTURES = listStructures().map((s) => s.kind);

describe("cage saisie à ±90° : même tracé que la volée équivalente", () => {
  it.each(Object.entries(SHAPES))("%s", (_name, shape) => {
    for (const rotation of [0, 37.5]) {
      const cage = cageProject(shape, { rotation });
      const layout = cageEngine(cage);
      expect(layout).toStrictEqual(computeLayout(asFlights(cage)));
      expect(layout.sections).toHaveLength(shape.sections.length);
      expect(layout.errors).toBeUndefined();
      if (hasNewel(shape)) {
        // Jour à poteau : refus explicite tant que l'aval lit `stair.layout.turns`.
        expect(() => computeLayout(cage)).toThrow(LayoutError);
        try {
          computeLayout(cage);
        } catch (e) {
          expect((e as LayoutError).msg.key).toBe("layout.cage.newelNotYetSupported");
        }
      } else {
        // `computeLayout` marque le tracé saisi (`Layout.cage`, cotes par tronçon des exports).
        expect(computeLayout(cage)).toStrictEqual({ ...layout, cage: true });
      }
    }
  });

  it("propriété : cages ±90° quelconques (1 à 4 tronçons) = volées équivalentes, ou même erreur", () => {
    const arb = fc
      .record({
        width: fc.integer({ min: 600, max: 1500 }),
        lengths: fc.array(fc.integer({ min: 0, max: 3000 }), { minLength: 1, maxLength: 4 }),
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
      .map((r): CageLayoutSpecInput => ({
        kind: "cage",
        sections: r.lengths.map((l) => straight(l, r.width)),
        junctions: r.junctions.slice(0, r.lengths.length - 1),
      }));
    fc.assert(
      fc.property(arb, fc.integer({ min: -180, max: 180 }), (shape, rotation) => {
        const cage = cageProject(shape, { rotation });
        const flights = cageToFlights(cage.stair.layout as CageLayoutSpec);
        // Tronçon unique de longueur 0 : pas de volée équivalente (longueur non positive).
        if (flights === null) return;
        const run = (p: Project) => {
          try {
            return { layout: computeLayout(p) };
          } catch {
            return { error: true };
          }
        };
        const a = run(cage);
        const b = run(asFlights(cage));
        // Les erreurs diffèrent par le vocabulaire (« tronçon » / « volée »), pas par le cas.
        if ("error" in a || "error" in b) {
          expect("error" in a).toBe("error" in b);
          return;
        }
        // Emprises dégénérées : messages propres à chaque vocabulaire. Depuis le sous-lot 2a,
        // une cage saisie passe par les pièces convexes (`overlap.ts`) : mêmes constats que la
        // boîte englobante du moteur à volées, plus ceux d'un jour en arc qui déborde dans un
        // jour trop petit (raccord compté dans l'emprise).
        const { errors: ea, cage: marker, ...la } = a.layout;
        const { errors: eb, ...lb } = b.layout;
        expect(marker).toBe(true);
        expect(b.layout.cage).toBeUndefined();
        expect(la).toStrictEqual(lb);
        const pairOf = (e: Message): string => {
          const p = e.params ?? {};
          const [x, y] = e.key.endsWith("Touch")
            ? [p.junctionA ?? p.turnA, p.junctionB ?? p.turnB]
            : [p.sectionA ?? p.flightA, p.sectionB ?? p.flightB];
          return `${e.key.endsWith("Touch") ? "touch" : "overlap"}:${String(x)}-${String(y)}`;
        };
        const cagePairs = new Set((ea ?? []).map(pairOf));
        for (const e of eb ?? []) expect(cagePairs).toContain(pairOf(e));
        if (!shape.junctions.some((j) => j.well?.kind === "arc")) {
          expect(ea?.length).toBe(eb?.length);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("buildModel sur une cage saisie à ±90°", () => {
  it.each(Object.entries(SHAPES))("%s : sans structure, modèle produit, sans erreur", (_n, s) => {
    const cage = cageProject(s, { structure: "none" });
    const model = buildModel(cage, { memo: false });
    if (hasNewel(s)) {
      // Jour à poteau : erreur de tracé claire, pas de modèle faux sans erreur.
      expect(errorKeys(model)).toEqual(["layout.cage.newelNotYetSupported"]);
      return;
    }
    expect(errorKeys(model)).toEqual([]);
    expect(model.layout.sections).toHaveLength(s.sections.length);
    expect(model.stepping.treads.length).toBeGreaterThan(0);
    // Mêmes marches que la volée équivalente.
    const flights = buildModel(asFlights(cage), { memo: false });
    expect(model.stepping).toStrictEqual(flights.stepping);
  });

  it.each(STRUCTURES)(
    "structure %s : plugin sauté, erreur claire `structure.cageUnsupported`, marches produites",
    (structure) => {
      for (const [, s] of Object.entries(SHAPES)) {
        const cage = cageProject(s, { structure });
        const model = buildModel(cage, { memo: false });
        if (hasNewel(s)) {
          expect(errorKeys(model)).toEqual(["layout.cage.newelNotYetSupported"]);
          continue;
        }
        if (structureAcceptsCage(structure, cageFeatures(cage.stair.layout as CageLayoutSpec))) {
          if (structure === "wood-cut") {
            // Crémaillères (sous-lot 6b) : escalier droit seulement, comme en volées.
            if (s.junctions.length > 0) {
              expect(errorKeys(model)).toEqual(["structure.woodCut.turningUnsupported"]);
            } else {
              expect(errorKeys(model)).toEqual([]);
              expect(model.parts.filter((p) => p.category === "carriage")).toHaveLength(2);
            }
            continue;
          }
          if (structure === "wood-central" || structure === "steel-central") {
            // Limons centraux (sous-lot 6c) : la trace contourne le jour vif ou en arc, poutre
            // construite, aucune erreur.
            expect(errorKeys(model)).toEqual([]);
            const category = structure === "wood-central" ? "carriage" : "stringer";
            expect(model.parts.some((p) => p.category === category)).toBe(true);
            continue;
          }
          // Cage construite (limons à la française, sous-lot 6a ; limons acier, sous-lot 6b) :
          // seul un jour vif ou en arc, qu'aucun limon droit ne suit, est signalé par le plugin
          // (profilés : aussi le constat de prédimensionnement, sans rapport avec la cage).
          const jour = s.junctions.map((j) => j.well?.kind ?? "sharp");
          const keys = JOUR_ERRORS[structure]!;
          expect(
            errorKeys(model).filter((k) => k !== "structure.steelProfile.error.noSectionPasses"),
          ).toEqual(
            jour.flatMap((k) => (k === "sharp" ? [keys.sharp] : k === "arc" ? [keys.arc] : [])),
          );
          expect(model.parts.some((p) => p.category === "stringer")).toBe(true);
          continue;
        }
        // Garde-fou des structures (2f) : plugin qui ne construit pas cette cage.
        expect(errorKeys(model)).toEqual(["structure.cageUnsupported"]);
        expect(model.stepping.treads.length).toBeGreaterThan(0);
        expect(model.layout.sections).toHaveLength(s.sections.length);
        // Pièces de base seules : mêmes pièces que sans structure.
        const bare = buildModel(cageProject(s, { structure: "none" }), { memo: false });
        expect(model.parts.map((p) => p.id)).toEqual(bare.parts.map((p) => p.id));
      }
    },
  );
});

describe("propriété : buildModel sur une cage saisie à ±90°", () => {
  it("ne lève jamais, aucune erreur interne, quelle que soit la structure, le jour ou les garde-corps", () => {
    const well = fc.oneof(
      fc.constant({ kind: "sharp" as const }),
      fc.record({ kind: fc.constant("arc" as const), radius: fc.integer({ min: 1, max: 300 }) }),
      fc.integer({ min: 40, max: 200 }).chain((size) =>
        fc.record({
          kind: fc.constant("newel" as const),
          size: fc.constant(size),
          offset: fc.integer({ min: 0, max: Math.ceil(size / 2) - 1 }),
        }),
      ),
    );
    const arb = fc.record({
      width: fc.integer({ min: 600, max: 1500 }),
      lengths: fc.array(fc.integer({ min: 0, max: 3000 }), { minLength: 1, maxLength: 4 }),
      junctions: fc.array(
        fc.record({
          angle: fc.constantFrom(90, -90),
          mode: fc.constantFrom("winders" as const, "landing" as const),
          well,
        }),
        { minLength: 3, maxLength: 3 },
      ),
      structure: fc.constantFrom("none", ...STRUCTURES),
      guards: fc.boolean(),
    });
    fc.assert(
      fc.property(arb, (r) => {
        const shape: CageLayoutSpecInput = {
          kind: "cage",
          sections: r.lengths.map((l) => straight(l, r.width)),
          junctions: r.junctions.slice(0, r.lengths.length - 1),
        };
        const base = cageProject(shape, { structure: r.structure });
        const project = r.guards
          ? ProjectSchema.parse({ ...base, guards: { flight: { enabled: true } } })
          : base;
        const model = buildModel(project, { memo: false });
        const keys = errorKeys(model);
        expect(keys).not.toContain("pipeline.internalError");
        expect((model.notes ?? []).map((n) => n.key)).not.toContain("pipeline.unknownStructure");
        if (shape.junctions.some((j) => j.well?.kind === "newel")) {
          expect(keys).toContain("layout.cage.newelNotYetSupported");
        }
      }),
      { numRuns: 80 },
    );
  });
});

describe("mémoïsation de l'étape « tracé » pour une cage saisie", () => {
  const QUARTER = SHAPES["quart tournant gauche, balancé, jour vif"]!;
  const STRAIGHT = SHAPES["droit, longueur auto"]!;

  it("placement modifié : nouveau tracé", () => {
    const p = cageProject(QUARTER, { structure: "none" });
    const a = buildModel(p);
    // Projet recopié à l'identique (mêmes sous-objets) : tracé repris du cache.
    expect(buildModel({ ...p }).layout).toBe(a.layout);
    const moved: Project = {
      ...p,
      stair: { ...p.stair, placement: { ...p.stair.placement, origin: { x: 500, y: 0 } } },
    };
    const b = buildModel(moved);
    expect(b.layout).not.toBe(a.layout);
    expect(b.layout.walkline).not.toStrictEqual(a.layout.walkline);
    expect(b.layout.sections![0]!.start.left).toStrictEqual({ x: 500, y: 0 });
  });

  it("tracé modifié (nouvel objet de cage) : nouveau tracé", () => {
    const p = cageProject(QUARTER);
    const a = buildModel(p);
    const spec = p.stair.layout as CageLayoutSpec;
    const longer: Project = {
      ...p,
      stair: {
        ...p.stair,
        layout: {
          ...spec,
          sections: [
            { ...spec.sections[0]!, axis: { kind: "straight" as const, length: 1700 } },
            spec.sections[1]!,
          ],
        },
      },
    };
    const b = buildModel(longer);
    expect(b.layout).not.toBe(a.layout);
  });

  it("murs déplacés : escalier droit (cage d'un tronçon), le bord de Γ suit le mur", () => {
    // Mur le long du bord gauche (x = 120, repère monde) : Γ mesurée depuis le bord droit (vide).
    const wall = (x: number): Wall => ({
      id: "w",
      loadBearing: false,
      a: { x, y: -1000 },
      b: { x, y: 6000 },
      thickness: 200,
    });
    const p = cageProject(STRAIGHT, { walls: [wall(120)] });
    const a = buildModel(p);
    expect(a.layout.walklineSide).toBe("right");
    // Même tracé, mur déplacé contre le bord droit : nouvelle clé, nouveau tracé.
    const q: Project = { ...p, site: { ...p.site, walls: [wall(1020)] } };
    const b = buildModel(q);
    expect(b.layout).not.toBe(a.layout);
    expect(b.layout.walklineSide).toBe("left");
  });

  it("garde-corps imposés : escalier droit (cage d'un tronçon), le bord de Γ suit", () => {
    const p = cageProject(STRAIGHT);
    const a = buildModel(p);
    const q = ProjectSchema.parse({
      ...p,
      guards: { flight: { enabled: true, inner: "wall", outer: "void" } },
    });
    const b = buildModel({ ...q, stair: p.stair });
    expect(b.layout).not.toBe(a.layout);
    expect(b.layout.walklineSide).toBe("right");
  });
});
