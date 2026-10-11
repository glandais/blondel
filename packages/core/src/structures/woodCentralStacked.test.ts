/**
 * Platines à âme noyée sur la poutre réelle en couches empilées (QUESTIONS A37 (8) (15) (16),
 * décisions du 2026-10-10) : propriétés sur générateurs contraints (préréglages quart tournant,
 * U et hélicoïdal ; largeur, épaisseur de marche, diamètre des broches) et exemples livrés.
 * - aucun perçage de broche ne coupe un joint de colle, y compris ceux de l'âme de tête AT1 (sans
 *   exception, relecture A37), et chaque broche est au milieu de sa couche (sinon remarque
 *   `layerPinOffCenter`) ;
 * - préréglages cintrés par défaut (quart tournant, U, demi-tour, hélicoïdal) : l'âme de pied
 *   arrêtée sur les joints de colle garde la pince de perçage au-dessus de ses broches (aucun
 *   constat `FAB_PLATINE_AME_NOYEE`, relecture A37 (8)) ;
 * - logement entièrement découpé : chaque palier du trait de AP1 et les bornes du trait de AT1
 *   sont sur une borne de couche (sinon constat `FAB_PLATINE_AME_NOYEE`), aucun fraisage partiel
 *   tracé sur les gabarits des couches.
 * - joint de colle imposé sur le dessus voulu du logement de l'âme de pied (épaisseur de
 *   platine + `anchors.plate.webDepth` + jeu, QUESTIONS A38 (12), décision du 2026-10-11) : l'âme
 *   garde sa profondeur partout où les assises ne la bornent pas (120 mm sur les préréglages
 *   cintrés par défaut, 73 mm avant A38).
 * Le plan réel de l'âme (`BeamKerf.line`) est vérifié contre le solide de l'âme dans
 * `woodCentralPlates.test.ts`.
 */
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fr } from "../i18n.test-helpers.js";
import type { Part } from "../model/derived.js";
import type { StructureContext } from "../model/plugins.js";
import type { Mm } from "../model/primitives.js";
import type { Project } from "../model/project.js";
import { parseProjectText } from "../project/parse.js";
import { createProject } from "../project/presets.js";
import { resolveWorkshopProfile } from "../workshop/profile.js";
import type { CheckCollector } from "./checks.js";
import { woodBeamOf, woodCentralContext, woodCentralParams } from "./woodCentral.test-helpers.js";
import {
  kerfObstacleTop,
  seatClearanceFrom,
  type WoodCentralBeamResult,
} from "./woodCentralBeam.js";
import { WOOD_CENTRAL_LAYER_RULES } from "./woodCentralLayers.js";
import { WoodCentralParamsSchema, type WoodCentralParams } from "./woodCentralParams.js";
import {
  WOOD_CENTRAL_PLATE_FOOT_WEB_ID,
  WOOD_CENTRAL_PLATE_HEAD_WEB_ID,
  WOOD_CENTRAL_PLATE_RULES,
} from "./woodCentralPlates.js";

const PROFILE = resolveWorkshopProfile();
const C = PROFILE.wood.clearance;
const HOLE_RULE = WOOD_CENTRAL_LAYER_RULES.holeJoints.id;
const PLATE_RULE = WOOD_CENTRAL_PLATE_RULES.plateFit.id;
const PRESETS = ["quarter-left", "two-quarters-u", "helical"] as const;
type PresetId = (typeof PRESETS)[number];

const contexts = new Map<string, StructureContext>();
function contextFor(id: PresetId, thickness: number): StructureContext {
  const key = `${id}/${thickness}`;
  let ctx = contexts.get(key);
  if (!ctx) {
    const p = createProject(id);
    const project: Project = {
      ...p,
      stair: { ...p.stair, treads: { ...p.stair.treads, thickness } },
    };
    ctx = woodCentralContext(project);
    contexts.set(key, ctx);
  }
  return ctx;
}

/** Bornes des couches (faces jointives et faces extrêmes), croissantes. */
function layerLevels(beam: WoodCentralBeamResult): Mm[] {
  const zs = beam.stacked!.layers.flatMap((l) => [l.z0, l.z1]);
  return [...new Set(zs)].sort((p, q) => p - q);
}

/** Joints de colle : faces jointives de deux couches consécutives. */
function glueJoints(beam: WoodCentralBeamResult): Mm[] {
  const layers = beam.stacked!.layers;
  const out: Mm[] = [];
  for (let i = 1; i < layers.length; i++) {
    if (Math.abs(layers[i - 1]!.z1 - layers[i]!.z0) < 1e-6) out.push(layers[i]!.z0);
  }
  return out;
}

const onLevel = (levels: readonly Mm[], z: Mm): boolean =>
  levels.some((j) => Math.abs(j - z) < 1e-6);

/**
 * Niveaux du trait de scie d'une âme lus sur sa pièce (développé de l'âme et repère du solide) :
 * dessous du trait (âme de pied : dessus de la platine ; âme de tête : bas de l'âme − c) et
 * dessus de chaque palier (+ c).
 */
function kerfLevelsOf(web: Part, foot: boolean, tp: Mm): Mm[] {
  if (web.solid.kind !== "extrusion") throw new Error("âme : extrusion attendue");
  const y0 = web.solid.frame.origin.z;
  const ys = [...new Set(web.flat!.outline.outer.map((p) => p.y))];
  const top = Math.max(...ys);
  if (foot) return [tp, ...ys.filter((y) => y > 1e-9).map((y) => y0 + y + C)];
  return [y0 - C, y0 + top + C];
}

/** Constat d'avertissement d'un repère pour la règle donnée (texte français). */
function flagged(checks: CheckCollector, ruleId: string, text: string): boolean {
  return checks.results.some(
    (x) => x.ruleId === ruleId && x.status === "violation" && fr(x.message).includes(text),
  );
}

/** Lignes de fraisage partiel tracées sur les gabarits (A36 (5), A37 (8) (16)). */
function milledLines(beam: WoodCentralBeamResult): string[] {
  return beam.parts.flatMap((p) =>
    (p.flat?.lines ?? [])
      .filter((l) => l.label?.key === "structure.woodCentral.flatLine.layerKerfMilled")
      .map((l) => `${p.mark} ${fr(l.label!)}`),
  );
}

/**
 * Vérifications communes : perçages hors des joints de colle et au milieu de leur couche (ou
 * constat), logements sur des bornes de couche (ou constat), aucun fraisage partiel si aucun
 * constat de logement.
 */
function expectHousings(
  beam: WoodCentralBeamResult,
  checks: CheckCollector,
  params: WoodCentralParams,
): { readonly holeIssues: number; readonly kerfIssues: number } {
  const joints = glueJoints(beam);
  const levels = layerLevels(beam);
  const layers = beam.stacked!.layers;
  let holeIssues = 0;
  for (const h of beam.stacked!.holes) {
    const r = h.diameter / 2 + C;
    const near = joints.some((z) => Math.abs(z - h.z) < r - 1e-6);
    const centered = layers.some((l) => Math.abs((l.z0 + l.z1) / 2 - h.z) < 1e-6);
    const isPin = h.mark === "AP1" || h.mark === "AT1";
    if (isPin) expect(h.mark === "AT1" ? h.centered : (h.centered ?? true)).toBe(true);
    // Relecture A37 : un perçage de broche n'est jamais au droit d'un joint de colle, même avec
    // constat (la propriété ne tolère que le décentrage, remarque `layerPinOffCenter`).
    if (isPin) expect(near, `${h.mark} au droit d'un joint à z = ${h.z}`).toBe(false);
    if (near || (isPin && !centered)) {
      holeIssues++;
      const offCenter = beam.notes.some(
        (n) =>
          n.key === "structure.woodCentral.note.layerPinOffCenter" && n.params?.["mark"] === h.mark,
      );
      expect(
        flagged(checks, HOLE_RULE, `${h.mark} (centre à z`) || (!near && offCenter),
        `${h.mark} à z = ${h.z}`,
      ).toBe(true);
    }
  }
  const tp = params.anchors.plate.thickness;
  let kerfIssues = 0;
  for (const [id, mark, foot] of [
    [WOOD_CENTRAL_PLATE_FOOT_WEB_ID, "AP1", true],
    [WOOD_CENTRAL_PLATE_HEAD_WEB_ID, "AT1", false],
  ] as const) {
    const web = beam.parts.find((p) => p.id === id);
    if (!web) continue;
    const ok = kerfLevelsOf(web, foot, tp).every((z) => onLevel(levels, z));
    if (!ok) {
      kerfIssues++;
      expect(flagged(checks, PLATE_RULE, `${mark} : aucun joint de colle`), mark).toBe(true);
    }
  }
  if (kerfIssues === 0) expect(milledLines(beam)).toEqual([]);
  return { holeIssues, kerfIssues };
}

describe("platines à âme noyée en couches empilées sur la poutre réelle : propriétés (A37 (8) (15))", () => {
  it("aucun perçage de broche ne coupe un joint de colle, y compris AT1 ; logements entièrement découpés", () => {
    let clean = 0;
    let runs = 0;
    fc.assert(
      fc.property(
        fc.record({
          id: fc.constantFrom(...PRESETS),
          tread: fc.integer({ min: 30, max: 80 }),
          b: fc.integer({ min: 70, max: 240 }),
          pin: fc.integer({ min: 10, max: 16 }),
        }),
        (c) => {
          const ctx = contextFor(c.id, c.tread);
          const params = woodCentralParams({
            section: { width: c.b, curvedMethod: "stacked" },
            anchors: {
              kind: "embeddedPlate",
              plate: { pinDiameter: c.pin, pinHoleDiameter: c.pin + 1 },
            },
          });
          const { beam, checks } = woodBeamOf(ctx, params);
          expect(beam.errors).toEqual([]);
          if (!beam.stacked) return;
          runs++;
          const { holeIssues, kerfIssues } = expectHousings(beam, checks, params);
          if (holeIssues === 0 && kerfIssues === 0) clean++;
        },
      ),
      { numRuns: 24 },
    );
    // Les cas sans constat sont la règle (la propriété n'est pas vide).
    expect(clean).toBeGreaterThan(runs / 2);
  });
});

describe("préréglages cintrés par défaut : âme de pied arrêtée sur les joints, broches à la pince (relecture A37 (8))", () => {
  for (const id of ["quarter-left", "two-quarters-u", "half-turn", "helical"] as const) {
    it(id, () => {
      const project = createProject(id);
      const params = WoodCentralParamsSchema.parse({});
      const { beam, checks } = woodBeamOf(woodCentralContext(project), params);
      expect(beam.errors).toEqual([]);
      expect(beam.stacked).not.toBeNull();
      expect(beam.anchorKind).toBe("embeddedPlate");
      // Aucun constat de platine (âme noyée) ni de perçage au droit d'un joint.
      const plate = checks.results.filter((x) => x.ruleId === PLATE_RULE);
      expect(plate.length).toBeGreaterThan(0);
      expect(plate.filter((x) => x.status !== "ok").map((x) => fr(x.message))).toEqual([]);
      expect(checks.results.filter((x) => x.ruleId === HOLE_RULE && x.status !== "ok")).toEqual([]);
      // Broches de pied à la pince de perçage du dessus de l'âme arrêtée (A37 (8)).
      const web = beam.parts.find((p) => p.id === WOOD_CENTRAL_PLATE_FOOT_WEB_ID);
      expect(web).toBeDefined();
      const hE = params.anchors.holeEdgeDistance;
      const top = Math.max(...web!.flat!.outline.outer.map((p) => p.y));
      for (const hole of web!.flat!.outline.holes) {
        const y = hole.reduce((a, p) => a + p.y, 0) / hole.length;
        expect(top - y).toBeGreaterThanOrEqual(hE - 0.5);
      }
      expect(expectHousings(beam, checks, params)).toEqual({ holeIssues: 0, kerfIssues: 0 });
      // Écart voulu (QUESTIONS A38 (12), décision du 2026-10-11) : un joint de colle est calé
      // sur le dessus voulu du logement (tp + webDepth + c) ; l'âme garde ses 120 mm (73 mm
      // avant A38, arrêt au joint en dessous, A37 (8)).
      const tp = params.anchors.plate.thickness;
      expect(top).toBeCloseTo(params.anchors.plate.webDepth, 6);
      expect(onLevel(layerLevels(beam), tp + params.anchors.plate.webDepth + C)).toBe(true);
    });
  }
});

/** Dessus fini des assises à σ (comme la poutre : assise i jusqu'à son fond σ1). */
function seatTop(beam: WoodCentralBeamResult): (s: Mm) => Mm {
  return (s) => {
    for (const x of beam.seats) if (s < x.sigma1 - 1e-9) return x.z;
    return beam.seats[beam.seats.length - 1]!.z;
  };
}

describe("joint de colle imposé sur le dessus voulu de l'âme de pied (QUESTIONS A38 (12))", () => {
  it("propriété : niveau imposé retenu → chaque palier non borné par une assise garde la profondeur webDepth", () => {
    let retained = 0;
    let full = 0;
    fc.assert(
      fc.property(
        fc.record({
          id: fc.constantFrom("quarter-left", "two-quarters-u", "half-turn", "helical"),
          tread: fc.integer({ min: 30, max: 80 }),
          b: fc.integer({ min: 70, max: 240 }),
          webDepth: fc.integer({ min: 60, max: 200 }),
        }),
        (c) => {
          const p = createProject(c.id);
          const project: Project = {
            ...p,
            stair: { ...p.stair, treads: { ...p.stair.treads, thickness: c.tread } },
          };
          const params = woodCentralParams({
            section: { width: c.b },
            anchors: { kind: "embeddedPlate", plate: { webDepth: c.webDepth } },
          });
          const { beam } = woodBeamOf(woodCentralContext(project), params);
          expect(beam.errors).toEqual([]);
          const kerf = beam.beamKerfs?.find((k) => k.mark === "AP1");
          if (!beam.stacked || !kerf || !beam.seatReserve) return;
          const tp = params.anchors.plate.thickness;
          const wanted = tp + c.webDepth + C;
          if (!onLevel(layerLevels(beam), wanted)) return;
          retained++;
          // Dessus brut de l'âme (contrat `footWebSteps`) : place réservée sous chaque assise.
          const top = seatTop(beam);
          const clear = seatClearanceFrom(
            beam.seats,
            beam.seatReserve.map((r) => r.reserved),
            top,
          );
          const free = (x: Mm): Mm => top(x) - Math.max(PROFILE.wood.minCheek, clear(x));
          const raw = (x: Mm): Mm => Math.min(free(x - C), free(x), free(x + C)) - C;
          for (let s = kerf.sigma0 + 3 * C; s <= kerf.sigma1 - 3 * C; s += 1) {
            // Palier non borné par une assise sur tout le voisinage du trait.
            const unbounded = [-2 * C, -C, 0, C, 2 * C].every(
              (d) => raw(s + d) >= tp + c.webDepth - 1e-6,
            );
            if (!unbounded) continue;
            full++;
            expect(kerfObstacleTop(kerf, s, 0), `${c.id} σ = ${s}`).toBeCloseTo(wanted, 6);
          }
        },
      ),
      { numRuns: 24 },
    );
    expect(retained).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(0);
  });
});

describe("exemples en couches empilées : plus de perçage au droit d'un joint ni de fraisage partiel (A37 (8) (15) (16))", () => {
  const examples = ["j5c-limon-central-bois-quart-tournant", "j5c-limon-central-bois-helicoidal"];
  for (const name of examples) {
    it(name, () => {
      const url = new URL(`../../../../examples/${name}.blondel.json`, import.meta.url);
      const project = parseProjectText(readFileSync(url, "utf8"));
      const params = WoodCentralParamsSchema.parse(project.stair.structure.params);
      const { beam, checks } = woodBeamOf(woodCentralContext(project), params);
      expect(beam.errors).toEqual([]);
      expect(beam.stacked).not.toBeNull();
      expect(beam.anchorKind).toBe("embeddedPlate");
      expect(expectHousings(beam, checks, params)).toEqual({ holeIssues: 0, kerfIssues: 0 });
      const holeChecks = checks.results.filter((x) => x.ruleId === HOLE_RULE);
      expect(holeChecks.length).toBeGreaterThan(0);
      expect(holeChecks.filter((x) => x.status !== "ok")).toEqual([]);
      expect(checks.results.filter((x) => x.ruleId === PLATE_RULE).map((x) => x.status)).toEqual([
        "ok",
        "ok",
      ]);
      // Broches de tête au milieu d'une couche (A37 (15)).
      const head = beam.stacked!.holes.filter((h) => h.mark === "AT1");
      expect(head.length).toBeGreaterThan(0);
      for (const h of head) {
        expect(
          beam.stacked!.layers.some((l) => Math.abs((l.z0 + l.z1) / 2 - h.z) < 1e-6),
          `AT1 à z = ${h.z}`,
        ).toBe(true);
      }
      expect(milledLines(beam)).toEqual([]);
      const keys = beam.notes.map((n) => n.key);
      expect(keys).toContain("structure.woodCentral.note.plateKerfJointsFoot");
      expect(keys).toContain("structure.woodCentral.note.plateKerfJointsHead");
    });
  }
});
