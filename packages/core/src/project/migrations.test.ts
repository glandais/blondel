/**
 * Migration du format 1 → 2 (QUESTIONS A38 (14) et (3), décisions du 2026-10-11) : limon central
 * bois seulement.
 *
 * - (14) l'ancrage saisi `lagScrews.minAnchorage` (ancrage total sous la marche avant A38) est
 *   reporté sur `lagScrews.minTotalAnchorage`, `minAnchorage` repasse en `auto` ; le modèle est
 *   celui du même projet écrit directement en version 2 avec `minTotalAnchorage` ;
 * - (3) une zone tendue `section.tensionZone` saisie garde son sens (toute la longueur, aucune
 *   couche en plus) ;
 * - (3) (4) (9) les anciens défauts enregistrés par l'interface (tensionZone 0,5, minBoardLength
 *   150) cèdent la place aux défauts de la version 2, sauf validation ◆ ;
 * - validations ◆ de l'ancrage saisi reportées ; JSON tordu toléré ; autres projets : seul
 *   `schemaVersion` change.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildModel } from "../pipeline/build.js";
import { PROJECT_SCHEMA_VERSION, type Project } from "../model/project.js";
import { woodBeamOf, woodCentralContext } from "../structures/woodCentral.test-helpers.js";
import { WOOD_CENTRAL_BEAM_RULES } from "../structures/woodCentralBeam.js";
import { WoodCentralParamsSchema } from "../structures/woodCentralParams.js";
import { woodCentralBoltSpacing } from "../structures/woodSpacing.js";
import { DEFAULT_WORKSHOP_PROFILE } from "../workshop/profile.js";
import { MIGRATION_V1_WOOD_CENTRAL, migrateProjectJson, type JsonObject } from "./migrations.js";
import { parseProject, parseProjectText } from "./parse.js";
import { serializeProject } from "./serialize.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const STRAIGHT = "j5c-limon-central-bois-droit.blondel.json";
const STRAIGHT_STEEL = "j3b-acceptance-01-acier-plat.blondel.json";
const BOLTS_RULE = WOOD_CENTRAL_BEAM_RULES.bolts.id;
const MIN_ANCHORAGE = "stair.structure.params.lagScrews.minAnchorage";
const MIN_TOTAL_ANCHORAGE = "stair.structure.params.lagScrews.minTotalAnchorage";
const TENSION_ZONE = "stair.structure.params.section.tensionZone";
const MIN_BOARD_LENGTH = "stair.structure.params.section.minBoardLength";

/** JSON d'un exemple, ramené en version 1 (le format 2 n'a changé que des champs ajoutés). */
function v1Of(file: string): JsonObject {
  const json = JSON.parse(readFileSync(join(EXAMPLES_DIR, file), "utf8")) as JsonObject;
  return { ...json, schemaVersion: 1 };
}

/** Exemple droit du limon central bois en version 1, avec ces paramètres de structure. */
function straightV1(params: JsonObject, extra: JsonObject = {}): JsonObject {
  const json = v1Of(STRAIGHT);
  const stair = json["stair"] as JsonObject;
  return {
    ...json,
    ...extra,
    stair: { ...stair, structure: { kind: "wood-central", params } },
  };
}

function structureParams(json: JsonObject): JsonObject {
  return ((json["stair"] as JsonObject)["structure"] as JsonObject)["params"] as JsonObject;
}

function woodParams(project: Project) {
  const s = project.stair.structure;
  if (s.kind !== "wood-central") throw new Error(s.kind);
  return WoodCentralParamsSchema.parse(s.params);
}

describe("migration du format 1 → 2 (QUESTIONS A38 (14) (3))", () => {
  it("format courant : 2", () => {
    expect(PROJECT_SCHEMA_VERSION).toBe(2);
    expect(MIGRATION_V1_WOOD_CENTRAL.from).toBe(1);
  });

  it("(14) ancrage saisi 50 → ancrage total 50, minAnchorage retiré, mode « total »", () => {
    const v1 = straightV1({ section: { kind: "glulam" }, lagScrews: { minAnchorage: 50 } });
    const before = structuredClone(v1);
    const out = migrateProjectJson(v1);
    expect(v1).toEqual(before);
    expect(out["schemaVersion"]).toBe(2);
    expect(structureParams(out)).toEqual({
      section: { kind: "glulam" },
      lagScrews: { minTotalAnchorage: 50 },
    });
    const params = woodParams(parseProject(v1));
    expect(params.lagScrews.minAnchorage).toBe("auto");
    expect(params.lagScrews.minTotalAnchorage).toBe(50);
    const sp = woodCentralBoltSpacing(
      params.bolts,
      DEFAULT_WORKSHOP_PROFILE.fasteners,
      params.lagScrews,
    );
    expect(sp.lag.anchorageMode).toBe("total");
    expect(sp.lag.minTotalAnchorage).toBe(50);
    // `auto` : 6·d sur la partie filetée, simple constat en mode « total » (sens d'avant A38).
    expect(sp.lag.minAnchorageAuto).toBe(true);
    expect(sp.lag.minAnchorage).toBe(60);
  });

  it("(14) un ancrage total déjà présent l'emporte ; `auto` et absence : inchangés", () => {
    const both = migrateProjectJson(
      straightV1({ lagScrews: { minAnchorage: 50, minTotalAnchorage: 70 } }),
    );
    expect(structureParams(both)).toEqual({ lagScrews: { minTotalAnchorage: 70 } });
    const auto = migrateProjectJson(straightV1({ lagScrews: { minAnchorage: "auto" } }));
    expect(structureParams(auto)).toEqual({ lagScrews: { minAnchorage: "auto" } });
    expect(structureParams(migrateProjectJson(straightV1({})))).toEqual({});
  });

  it("(3) zone tendue saisie → aucune couche en plus, toute la longueur", () => {
    const v1 = straightV1({ section: { kind: "glulam", tensionZone: 0.4 } });
    expect(structureParams(migrateProjectJson(v1))).toEqual({
      section: { kind: "glulam", tensionZone: 0.4, tensionZoneLayers: 0, tensionZoneLength: 1 },
    });
    const params = woodParams(parseProject(v1));
    expect(params.section.tensionZone).toBe(0.4);
    expect(params.section.tensionZoneLayers).toBe(0);
    expect(params.section.tensionZoneLength).toBe(1);
    // Champs déjà présents gardés ; sans tensionZone saisie, rien n'est ajouté (défauts A38).
    const kept = straightV1({ section: { tensionZone: 0.3, tensionZoneLayers: 2 } });
    expect(structureParams(migrateProjectJson(kept))).toEqual({
      section: { tensionZone: 0.3, tensionZoneLayers: 2, tensionZoneLength: 1 },
    });
    const none = straightV1({ section: { jointOffset: 100 } });
    expect(structureParams(migrateProjectJson(none))).toEqual({ section: { jointOffset: 100 } });
  });

  it("(3) (4) (9) anciens défauts enregistrés par l'interface : remplacés par ceux de la version 2", () => {
    // L'interface enregistre tous les défauts au choix de la structure (`withDefaults`) :
    // tensionZone 0,5 et minBoardLength 150 sont les défauts du format 1, non des saisies.
    const v1 = straightV1({
      section: { kind: "glulam", tensionZone: 0.5, minBoardLength: 150, jointOffset: 100 },
    });
    expect(structureParams(migrateProjectJson(v1))).toEqual({
      section: { kind: "glulam", jointOffset: 100 },
    });
    const params = woodParams(parseProject(v1));
    expect(params.section.tensionZone).toBe(0.125);
    expect(params.section.tensionZoneLayers).toBe(1);
    expect(params.section.tensionZoneLength).toBe(0.75);
    expect(params.section.minBoardLength).toBe("auto");
    // Validées ◆ : vues et confirmées, elles restent des saisies (ancien sens de la zone tendue).
    const validated = straightV1(
      { section: { tensionZone: 0.5, minBoardLength: 150 } },
      {
        validatedValues: [
          { path: TENSION_ZONE, value: 0.5, structureKind: "wood-central" },
          { path: MIN_BOARD_LENGTH, value: 150, structureKind: "wood-central" },
        ],
      },
    );
    expect(structureParams(migrateProjectJson(validated))).toEqual({
      section: {
        tensionZone: 0.5,
        minBoardLength: 150,
        tensionZoneLayers: 0,
        tensionZoneLength: 1,
      },
    });
    // Autre valeur : saisie gardée.
    expect(
      structureParams(migrateProjectJson(straightV1({ section: { minBoardLength: 120 } }))),
    ).toEqual({ section: { minBoardLength: 120 } });
  });

  it("projet sans limon central bois : seul schemaVersion change", () => {
    const v1 = v1Of(STRAIGHT_STEEL);
    v1["validatedValues"] = [
      { path: MIN_ANCHORAGE, value: 50, structureKind: "wood-central" },
      { path: "workshop.wood.clearance", value: 1 },
    ];
    const out = migrateProjectJson(v1);
    expect(out).toEqual({ ...v1, schemaVersion: 2 });
    // Même paramètres de limon central bois sous un autre plugin : intacts.
    const other = straightV1({ lagScrews: { minAnchorage: 50 } });
    ((other["stair"] as JsonObject)["structure"] as JsonObject)["kind"] = "steel-central";
    expect(migrateProjectJson(other)).toEqual({ ...other, schemaVersion: 2 });
  });

  it("validations ◆ de l'ancrage saisi reportées sur l'ancrage total", () => {
    const other = { path: MIN_ANCHORAGE, value: 50, structureKind: "steel-central" };
    const unrelated = { path: "workshop.wood.clearance", value: 1 };
    const v1 = straightV1(
      { lagScrews: { minAnchorage: 50 } },
      {
        validatedValues: [
          unrelated,
          { path: MIN_ANCHORAGE, value: 50, structureKind: "wood-central" },
          other,
        ],
      },
    );
    const out = migrateProjectJson(v1);
    expect(out["validatedValues"]).toEqual([
      unrelated,
      { path: MIN_TOTAL_ANCHORAGE, value: 50, structureKind: "wood-central" },
      other,
    ]);
    const p = parseProject(v1);
    expect(p.validatedValues).toEqual(out["validatedValues"]);
    // Validation déjà posée sur l'ancrage total : l'ancienne est retirée (une entrée par chemin).
    const dup = straightV1(
      { lagScrews: { minAnchorage: 50 } },
      {
        validatedValues: [
          { path: MIN_ANCHORAGE, value: 50, structureKind: "wood-central" },
          { path: MIN_TOTAL_ANCHORAGE, value: 40, structureKind: "wood-central" },
        ],
      },
    );
    expect(migrateProjectJson(dup)["validatedValues"]).toEqual([
      { path: MIN_TOTAL_ANCHORAGE, value: 40, structureKind: "wood-central" },
    ]);
    // Ancrage `auto` : sa validation (6·d) garde son sens et reste en place.
    const auto = straightV1(
      {},
      { validatedValues: [{ path: MIN_ANCHORAGE, value: 60, structureKind: "wood-central" }] },
    );
    expect(migrateProjectJson(auto)["validatedValues"]).toEqual([
      { path: MIN_ANCHORAGE, value: 60, structureKind: "wood-central" },
    ]);
  });

  it("JSON tordu : aucune erreur de migration, validation laissée à zod", () => {
    const cases: unknown[] = [
      { schemaVersion: 1 },
      { schemaVersion: 1, stair: 3 },
      { schemaVersion: 1, stair: { structure: null } },
      { schemaVersion: 1, stair: { structure: { kind: "wood-central" } } },
      { schemaVersion: 1, stair: { structure: { kind: "wood-central", params: [] } } },
      { schemaVersion: 1, stair: { structure: { kind: "wood-central", params: "x" } } },
      {
        schemaVersion: 1,
        stair: { structure: { kind: "wood-central", params: { lagScrews: 5, section: [] } } },
      },
      {
        schemaVersion: 1,
        stair: {
          structure: { kind: "wood-central", params: { lagScrews: { minAnchorage: "x" } } },
        },
        validatedValues: "pas une liste",
      },
      {
        schemaVersion: 1,
        stair: { structure: { kind: "wood-central", params: { lagScrews: { minAnchorage: 5 } } } },
        validatedValues: [null, 3, { path: MIN_ANCHORAGE }],
      },
    ];
    for (const c of cases) {
      const out = migrateProjectJson(c);
      expect(out["schemaVersion"]).toBe(2);
    }
    const last = migrateProjectJson(cases[cases.length - 1]);
    expect(last["validatedValues"]).toEqual([null, 3, { path: MIN_ANCHORAGE }]);
  });

  it("propriété : migrer, sérialiser puis relire est stable (projet v1 de limon central bois)", () => {
    fc.assert(
      fc.property(
        fc.option(fc.integer({ min: 1, max: 200 }), { nil: undefined }),
        fc.option(fc.integer({ min: 0, max: 200 }), { nil: undefined }),
        fc.option(fc.double({ min: 0.05, max: 1, noNaN: true }), { nil: undefined }),
        fc.option(fc.integer({ min: 0, max: 3 }), { nil: undefined }),
        fc.boolean(),
        (minAnchorage, minTotal, tensionZone, layers, validated) => {
          const lagScrews: JsonObject = {};
          if (minAnchorage !== undefined) lagScrews["minAnchorage"] = minAnchorage;
          if (minTotal !== undefined) lagScrews["minTotalAnchorage"] = minTotal;
          const section: JsonObject = { kind: "glulam" };
          if (tensionZone !== undefined) section["tensionZone"] = tensionZone;
          if (layers !== undefined) section["tensionZoneLayers"] = layers;
          const v1 = straightV1(
            { section, lagScrews },
            validated && minAnchorage !== undefined
              ? {
                  validatedValues: [
                    { path: MIN_ANCHORAGE, value: minAnchorage, structureKind: "wood-central" },
                  ],
                }
              : {},
          );
          const p = parseProject(v1);
          const text = serializeProject(p);
          const again = parseProjectText(text);
          expect(again).toEqual(p);
          expect(serializeProject(again)).toBe(text);
          // Sens gardé : ancrage total = ancien ancrage saisi (sauf ancrage total déjà présent).
          const params = woodParams(p);
          expect(params.lagScrews.minAnchorage).toBe("auto");
          expect(params.lagScrews.minTotalAnchorage).toBe(minTotal ?? minAnchorage ?? 0);
          if (tensionZone !== undefined && tensionZone !== 0.5) {
            expect(params.section.tensionZoneLayers).toBe(layers ?? 0);
            expect(params.section.tensionZoneLength).toBe(1);
          }
          const vv = p.validatedValues ?? [];
          expect(vv.some((v) => v.path === MIN_ANCHORAGE)).toBe(false);
        },
      ),
      { numRuns: 60 },
    );
  });

  it("modèle : le v1 migré est le même projet que le v2 écrit avec minTotalAnchorage (exemple droit)", () => {
    const migrated = parseProject(
      straightV1({ section: { kind: "glulam" }, lagScrews: { minAnchorage: 50 } }),
    );
    const direct = parseProjectText(
      JSON.stringify({
        ...straightV1({ section: { kind: "glulam" }, lagScrews: { minTotalAnchorage: 50 } }),
        schemaVersion: 2,
      }),
    );
    expect(migrated).toEqual(direct);
    const lagsOf = (project: Project) => {
      const { beam } = woodBeamOf(woodCentralContext(project), woodParams(project));
      return beam.seats.map((s) =>
        s.bolts.filter((b) => b.kind === "lagScrew").map((b) => b.length),
      );
    };
    const lags = lagsOf(migrated);
    expect(lags).toEqual(lagsOf(direct));
    const boltsFindings = (project: Project) =>
      buildModel(project)
        .compliance.results.filter((r) => r.ruleId === BOLTS_RULE)
        .map((r) => [r.status, r.location, r.message.key]);
    expect(boltsFindings(migrated)).toEqual(boltsFindings(direct));
    // Sens d'avant A38 (exemple droit, A37 (1)) : ancrage total de 50 mm sous une marche de
    // 80 mm, M1 garde ses deux tire-fonds de 130 mm (partie filetée de 50 mm < 6·d signalée),
    // retirés en `auto`.
    expect(lags[0]).toEqual([130, 130]);
    const auto = parseProject(straightV1({ section: { kind: "glulam" } }));
    expect(lagsOf(auto)[0]).toEqual([]);
  });
});
