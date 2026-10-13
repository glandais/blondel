/**
 * Conversion volées ↔ cage côté projet (ADR-0010, sous-lot 2e) : aller-retour à l'identique
 * (propriété fast-check, S / Z et transitions de Γ compris), conversion exacte (même tracé),
 * correction « reconvertir en volées », branches cage de `newel.ts` et `structureChoice.ts`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import type { Message } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { computeLayout } from "../layout/layout.js";
import { LayoutError } from "../layout/errors.js";
import { cageFeatures } from "../model/cageFeatures.js";
import type { Layout } from "../model/derived.js";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type CageLayoutSpec,
  type CageLayoutSpecInput,
  type Project,
} from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { suggestFixes } from "./fixes.js";
import { flightsToCageLayout, toCageLayout, toFlightsLayout } from "./layoutConversion.js";
import { DEFAULT_NEWEL, withNewels } from "./newel.js";
import { parseProjectText } from "./parse.js";
import { createProject, deepMerge, OPPOSITE_TURNS_PRESET_IDS, PRESET_IDS } from "./presets.js";
import { applyStructureChoice } from "./structureChoice.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");

function flightsProject(layout: unknown, floorToFloor = 2700): Project {
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: { floorToFloor, upperSlabThickness: 200 },
    stair: { placement: { origin: { x: 120, y: -40 }, rotation: 15 }, layout },
  });
}

function cageProject(layout: CageLayoutSpecInput, structure = "none"): Project {
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: { floorToFloor: 2700, upperSlabThickness: 200 },
    stair: {
      placement: { origin: { x: 0, y: 0 }, rotation: 0 },
      layout,
      structure: { kind: structure },
    },
  });
}

const straight = (length: number, width = 900) => ({
  axis: { kind: "straight" as const, length },
  width,
});

/** Tracé calculé, ou la clé de l'erreur du tracé. */
/** Clé d'erreur de tracé d'une cage saisie pour le même cas qu'une erreur de volée. */
const CAGE_ERROR_KEY: Readonly<Record<string, string>> = {
  "layout.legTooShort": "layout.cage.sectionTooShort",
  "layout.legTooShortForTransition": "layout.cage.sectionTooShortForTransition",
};

/** Paire de tronçons (ou de jonctions) d'un constat de recouvrement, nommage volée ou cage. */
const pairOf = (e: Message): string => {
  const p = e.params ?? {};
  const touch = e.key.endsWith("Touch");
  const [x, y] = touch
    ? [p.junctionA ?? p.turnA, p.junctionB ?? p.turnB]
    : [p.sectionA ?? p.flightA, p.sectionB ?? p.flightB];
  return `${touch ? "touch" : "overlap"}:${String(x)}-${String(y)}`;
};

function layoutOr(p: Project): Layout | string {
  try {
    return computeLayout(p);
  } catch (e) {
    if (e instanceof LayoutError) return e.msg.key;
    throw e;
  }
}

/** Tracé à volées généré : 1 à 4 volées, tournants de sens quelconques (S / Z compris). */
const flightsArb = fc
  .record({
    width: fc.integer({ min: 600, max: 1500 }),
    turns: fc.array(
      fc.record({
        direction: fc.constantFrom("left" as const, "right" as const),
        mode: fc.constantFrom("winders" as const, "landing" as const),
        inner: fc.oneof(
          fc.constant({ kind: "sharp" as const }),
          fc.record({
            kind: fc.constant("arc" as const),
            radius: fc.integer({ min: 1, max: 300 }),
          }),
        ),
      }),
      { maxLength: 3 },
    ),
    extra: fc.array(fc.integer({ min: 0, max: 3000 }), { minLength: 4, maxLength: 4 }),
    floorToFloor: fc.integer({ min: 2200, max: 3400 }),
  })
  .map((r) => ({
    floorToFloor: r.floorToFloor,
    layout: {
      width: r.width,
      turns: r.turns,
      legs: r.extra.slice(0, r.turns.length + 1).map((e, i) => {
        const k = (i > 0 ? 1 : 0) + (i < r.turns.length ? 1 : 0);
        return { length: k * r.width + Math.max(e, k === 0 ? 1 : 0) };
      }),
    },
  }));

describe("toCageLayout / toFlightsLayout", () => {
  it("propriété : aller-retour volées → cage → volées strictement égal, même tracé", () => {
    let computed = 0;
    let transitions = 0;
    let opposite = 0;
    fc.assert(
      fc.property(flightsArb, ({ layout, floorToFloor }) => {
        const flights = flightsProject(layout, floorToFloor);
        const cage = toCageLayout(flights);
        expect(cage).not.toBeNull();
        // La cage est une entrée valide, relue à l'identique par le schéma.
        expect(ProjectSchema.parse(cage)).toStrictEqual(cage);
        expect(toFlightsLayout(cage!)).toStrictEqual(flights);
        // Conversion exacte : même tracé (hors marque `cage`), ou même cas d'erreur.
        const a = layoutOr(flights);
        const b = layoutOr(cage!);
        if (typeof a === "string" || typeof b === "string") {
          // Même cas d'erreur : même clé de `LayoutError`, au vocabulaire de la cage près
          // (tronçon saisi au lieu de volée, `section.ts`).
          expect(b).toBe(typeof a === "string" ? (CAGE_ERROR_KEY[a] ?? a) : a);
          return;
        }
        const { cage: marker, errors: eb, ...lb } = b;
        const { errors: ea, ...la } = a;
        expect(marker).toBe(true);
        expect(lb).toStrictEqual(la);
        // Mêmes constats de recouvrement (comparaison par paires, comme `cage/native.test.ts`),
        // hors jour en arc : le moteur de cage découpe un jour en arc en pièces convexes, peut
        // nommer d'autres paires de tronçons (spirale de trois tournants à droite : `overlap:1-3`
        // côté cage, `overlap:1-4` côté volées) et signaler un simple contact (boîte de 0 × 1 mm,
        // spirale de trois tournants à gauche, jour en arc de 2 mm, volées 633 / 2725 / 1201 /
        // 2125, E 600) que les volées ne signalent pas. Écart connu, journal free-2d (2e).
        if (!layout.turns.some((t) => t.inner.kind === "arc")) {
          expect(eb === undefined).toBe(ea === undefined);
          const flightPairs = new Set((ea ?? []).map(pairOf));
          for (const e of eb ?? []) expect(flightPairs).toContain(pairOf(e));
          expect(eb?.length).toBe(ea?.length);
        }
        computed++;
        if ((a.walklineTransitions?.length ?? 0) > 0) transitions++;
        const features = cageFeatures(cage!.stair.layout as CageLayoutSpec);
        if (features.includes("oppositeTurns")) opposite++;
        else expect(features).toEqual([]);
      }),
      { numRuns: 300 },
    );
    expect(computed).toBeGreaterThan(100);
    expect(transitions).toBeGreaterThan(0);
    expect(opposite).toBeGreaterThan(0);
  });

  it("S à E > 1 200 (transition de Γ) et préréglages : aller-retour exact, même découpage", () => {
    const projects = [...PRESET_IDS, ...OPPOSITE_TURNS_PRESET_IDS].map((id) => createProject(id));
    projects.push(
      flightsProject({
        width: 1300,
        legs: [{ length: 2300 }, { length: 3400 }, { length: 2000 }],
        turns: [
          { direction: "left", mode: "winders" },
          { direction: "right", mode: "winders" },
        ],
      }),
    );
    for (const flights of projects) {
      const cage = toCageLayout(flights)!;
      expect(toFlightsLayout(cage)).toStrictEqual(flights);
      const mf = buildModel(flights, { memo: false });
      const mc = buildModel(cage, { memo: false });
      expect(mc.layout.walklineTransitions).toStrictEqual(mf.layout.walklineTransitions);
      expect(mc.stepping).toStrictEqual(mf.stepping);
    }
  });

  it("examples/ à volées : aller-retour à l'identique", () => {
    const files = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".blondel.json"));
    let checked = 0;
    for (const f of files) {
      const p = parseProjectText(readFileSync(join(EXAMPLES_DIR, f), "utf8"));
      if (p.stair.layout.kind === "helical" || p.stair.layout.kind === "cage") continue;
      const cage = toCageLayout(p);
      // Jour à poteau : refusé pour une cage saisie (pas de conversion).
      if (p.stair.layout.turns.some((t) => t.inner.kind === "newel")) {
        expect(cage).toBeNull();
        continue;
      }
      expect(toFlightsLayout(cage!), f).toStrictEqual(p);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("refus : jour à poteau, volée plus courte que ses carrés d'angle, hélicoïdal, cage non convertible", () => {
    const quarter = (inner: unknown, first = 2000) =>
      flightsProject({
        width: 900,
        legs: [{ length: first }, { length: 2000 }],
        turns: [{ direction: "left", mode: "winders", inner }],
      });
    expect(toCageLayout(quarter({ kind: "newel", size: 100 }))).toBeNull();
    expect(toCageLayout(quarter({ kind: "sharp" }, 600))).toBeNull();
    expect(toCageLayout(createProject("helical"))).toBeNull();
    expect(toFlightsLayout(createProject("straight"))).toBeNull();
    const sixty = cageProject({
      kind: "cage",
      sections: [straight(1500), straight(1500)],
      junctions: [{ angle: 60, mode: "winders" }],
    });
    expect(toCageLayout(sixty)).toBeNull();
    expect(toFlightsLayout(sixty)).toBeNull();
  });

  it("escalier droit `auto` : tronçon unique `auto`, aller-retour exact", () => {
    const p = createProject("straight", {
      patch: { stair: { layout: { legs: [{ length: "auto" }] } } },
    });
    const cage = toCageLayout(p)!;
    expect((cage.stair.layout as CageLayoutSpec).sections).toEqual([
      { axis: { kind: "straight", length: "auto" }, width: p.stair.layout.width },
    ]);
    expect(toFlightsLayout(cage)).toStrictEqual(p);
    expect(flightsToCageLayout({ width: 900, legs: [{ length: "auto" }], turns: [] })?.width).toBe(
      900,
    );
  });
});

describe("correction « reconvertir en volées » (cage-to-flights)", () => {
  it("cage sans fonction de cage : proposée, le patch rend le tracé à volées équivalent", () => {
    // Structure qui ne lit aucune cage saisie (limon débillardé acier ; le limon central la lit
    // depuis le sous-lot 6c) : refus du garde-fou.
    for (const id of PRESET_IDS) {
      const flights = createProject(id, {
        patch: { stair: { structure: { kind: "steel-curved", params: {} } } },
      });
      const cage = toCageLayout(flights)!;
      const model = buildModel(cage, { memo: false });
      const fix = suggestFixes(cage, model).find((f) => f.id === "cage-to-flights");
      expect(fix, id).toBeDefined();
      expect(fix!.label.key).toBe("project.fix.cageToFlights.label");
      const applied = ProjectSchema.parse(deepMerge(cage, fix!.patch));
      // `kind: "flights"` explicite (une fusion ne retire pas le `kind`), champs de cage écartés.
      expect(applied.stair.layout).toStrictEqual({ kind: "flights", ...flights.stair.layout });
      expect(applied.stair.placement).toStrictEqual(cage.stair.placement);
      expect(buildModel(applied, { memo: false }).layout.walkline).toStrictEqual(
        buildModel(flights, { memo: false }).layout.walkline,
      );
    }
  });

  it("non proposée sans erreur à lever : cage à 90° sans structure (structure « aucune »)", () => {
    const cage = cageProject({
      kind: "cage",
      sections: [straight(1500), straight(600)],
      junctions: [{ angle: 90, mode: "winders" }],
    });
    expect(cageFeatures(cage.stair.layout as CageLayoutSpec)).toEqual([]);
    const model = buildModel(cage, { memo: false });
    expect(model.errors).toEqual([]);
    expect(suggestFixes(cage, model).map((f) => f.id)).not.toContain("cage-to-flights");
    expect(suggestFixes(cage).map((f) => f.id)).not.toContain("cage-to-flights");
  });

  it("non proposée : angle quelconque, S / Z (oppositeTurns), tracé à volées", () => {
    const s = toCageLayout(createProject("two-quarters-s"))!;
    expect(cageFeatures(s.stair.layout as CageLayoutSpec)).toEqual(["oppositeTurns"]);
    for (const p of [
      s,
      cageProject({
        kind: "cage",
        sections: [straight(1500), straight(1500)],
        junctions: [{ angle: 60, mode: "winders" }],
      }),
      createProject("quarter-left"),
    ]) {
      expect(suggestFixes(p, buildModel(p, { memo: false })).map((f) => f.id)).not.toContain(
        "cage-to-flights",
      );
    }
  });

  it("cage avec structure à poteau : aucune correction de jour, sans exception", () => {
    const cage = cageProject(
      {
        kind: "cage",
        sections: [straight(1500), straight(600)],
        junctions: [{ angle: 90, mode: "winders" }],
      },
      "steel-curved",
    );
    const model = buildModel(cage, { memo: false });
    expect(model.errors.map((e) => e.key)).toContain("structure.cageUnsupported");
    const ids = suggestFixes(cage, model).map((f) => f.id);
    expect(ids).toEqual(["cage-to-flights"]);
  });

  it.each([
    ["wood-housed", "structure.woodHoused.sharpJourCage"],
    ["steel-flat", "structure.steel.error.sharpWellCage"],
    ["steel-profile", "structure.steel.error.sharpWellCage"],
  ] as const)(
    "%s sur une cage sans fonction (sous-lots 6a, 6b) : construits, reconversion proposée pour un jour vif",
    (kind, sharpKey) => {
      for (const id of PRESET_IDS) {
        const flights = createProject(id, {
          patch: { stair: { structure: { kind, params: {} } } },
        });
        const cage = toCageLayout(flights)!;
        const model = buildModel(cage, { memo: false });
        const keys = model.errors.map((e) => e.key);
        expect(keys, id).not.toContain("structure.cageUnsupported");
        expect(
          model.parts.some((p) => p.category === "stringer"),
          id,
        ).toBe(true);
        const sharp = flights.stair.layout.turns.filter((t) => t.inner.kind === "sharp").length;
        expect(
          keys.filter((k) => k === sharpKey),
          id,
        ).toHaveLength(sharp);
        const fixes = suggestFixes(cage, model);
        const fix = fixes.find((f) => f.id === "cage-to-flights");
        if (sharp === 0) {
          expect(fix, id).toBeUndefined();
          continue;
        }
        // Jour vif : en volées, le jour reçoit un poteau (correction `jour-newel` ensuite).
        expect(fix?.reason.key, id).toBe("project.fix.cageToFlights.reasonNewel");
        expect(
          fixes.map((f) => f.id),
          id,
        ).not.toContain("jour-newel");
        const applied = ProjectSchema.parse(deepMerge(cage, fix!.patch));
        expect(applied.stair.layout).toStrictEqual({ kind: "flights", ...flights.stair.layout });
        const after = buildModel(applied, { memo: false });
        expect(
          suggestFixes(applied, after).map((f) => f.id),
          id,
        ).toContain("jour-newel");
      }
    },
  );

  it.each([
    ["wood-housed", "structure.woodHoused.arcJourCage"],
    ["steel-flat", "structure.steel.error.arcWellCage"],
    ["steel-profile", "structure.steel.error.arcWellCage"],
  ] as const)(
    "%s, jour en arc sur une cage sans fonction : pas de reconversion pour un poteau",
    (kind, arcKey) => {
      const cage = cageProject(
        {
          kind: "cage",
          sections: [straight(900), straight(900)],
          junctions: [{ angle: 90, mode: "winders", well: { kind: "arc", radius: 200 } }],
        },
        kind,
      );
      const model = buildModel(cage, { memo: false });
      expect(
        model.errors
          .map((e) => e.key)
          .filter((k) => k !== "structure.steelProfile.error.noSectionPasses"),
      ).toEqual([arcKey]);
      // En volées, un jour en arc ne reçoit pas de poteau (`jour-newel` ne vise que les jours
      // vifs) : `arcWellCage` reste hors de `CAGE_JOUR_ERRORS`.
      expect(suggestFixes(cage, model).map((f) => f.id)).not.toContain("cage-to-flights");
      expect(applyStructureChoice(cage, kind).notes.map((n) => n.key)).toEqual([
        "project.structureChoice.cageJour",
      ]);
    },
  );
});

describe("branches cage de newel.ts et structureChoice.ts", () => {
  const cage = cageProject({
    kind: "cage",
    sections: [straight(1500), straight(600)],
    junctions: [{ angle: 90, mode: "winders" }],
  });
  const sixty = cageProject({
    kind: "cage",
    sections: [straight(1500), straight(1500)],
    junctions: [{ angle: 60, mode: "winders" }],
  });

  it("withNewels rend la cage telle quelle", () => {
    expect(withNewels(cage, DEFAULT_NEWEL, () => true)).toBe(cage);
  });

  it("structure posée sans adapter le jour, remarque (reconversion si possible)", () => {
    const a = applyStructureChoice(cage, "steel-curved");
    expect(a.project.stair.structure.kind).toBe("steel-curved");
    expect(a.project.stair.layout).toBe(cage.stair.layout);
    expect(a.notes.map((n) => n.key)).toEqual(["project.structureChoice.cageConvertible"]);
    // Limons centraux (sous-lot 6c) : cage construite, sans poteau : aucune remarque.
    for (const kind of ["wood-central", "steel-central"]) {
      for (const p of [cage, sixty]) {
        const c = applyStructureChoice(p, kind);
        expect(c.project.stair.layout).toBe(p.stair.layout);
        expect(c.notes).toEqual([]);
      }
    }
    // Limons acier (sous-lot 6b) : cage construite, jour vif signalé comme pour les limons à la
    // française.
    for (const kind of ["steel-flat", "steel-profile"]) {
      const st = applyStructureChoice(cage, kind);
      expect(st.project.stair.layout).toBe(cage.stair.layout);
      expect(st.notes.map((n) => n.key)).toEqual(["project.structureChoice.cageJourConvertible"]);
    }
    // Limons à la française (sous-lot 6a) : cage construite, jour vif signalé (pan coupé, ou
    // reconversion en volées pour un poteau) ; à 60°, pas de reconversion possible.
    const w = applyStructureChoice(cage, "wood-housed");
    expect(w.project.stair.layout).toBe(cage.stair.layout);
    expect(w.notes.map((n) => n.key)).toEqual(["project.structureChoice.cageJourConvertible"]);
    expect(w.notes[0]!.params).toMatchObject({ count: 1, junctions: "1" });
    expect(applyStructureChoice(sixty, "wood-housed").notes.map((n) => n.key)).toEqual([
      "project.structureChoice.cageJour",
    ]);
    const chamfered = cageProject({
      kind: "cage",
      sections: [straight(1500), straight(1500)],
      junctions: [
        { angle: 60, mode: "winders", well: { kind: "chamfer", setbackIn: 150, setbackOut: 150 } },
      ],
    });
    expect(applyStructureChoice(chamfered, "wood-housed").notes).toEqual([]);
    const b = applyStructureChoice(sixty, "steel-curved");
    expect(b.project.stair.layout).toBe(sixty.stair.layout);
    expect(b.notes.map((n) => n.key)).toEqual(["project.structureChoice.cage"]);
    expect(applyStructureChoice(sixty, "none").notes).toEqual([]);
  });
});
