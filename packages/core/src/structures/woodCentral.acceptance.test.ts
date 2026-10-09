/**
 * Limon central bois (QUESTIONS A29, vague 2) — exemples générés
 * `examples/j5c-limon-central-bois-*.blondel.json`, un par géométrie de poutre : escalier droit
 * en couches collées droites sur sabots en U, quart tournant balancé et hélicoïdal à jour
 * central en lamellé-collé de 88 mm, donc en couches horizontales empilées (filière par défaut
 * au-delà de 60 mm, QUESTIONS A33 (e)) sur platines à âme noyée (ancrage par défaut d'une
 * poutre cintrée, A34 (c)). Marches sans contremarche (l'arrière de
 * chaque marche se loge dans la dent suivante : entaille arrière, C §1.5 [54]), de 80 mm comme
 * les démos hélicoïdales. Ils sont couverts par l'instantané des cotes (`pipeline/build.test.ts`)
 * et par tous les exports (`packages/exports/src/examples.test.ts`).
 * Décisions A35 (2026-10-09) : couches droites en nombre impair sur le droit (plus de constat
 * de pinces), âme de pied prolongée (M1 retrouve ses organes), couches empilées calées sur les
 * assises et faites de plusieurs planches (`LC1-k.j`), classe `auto` D40 du chêne lamellé-collé,
 * prédimensionnement des couches empilées réduit par la formule de Hankinson (évalué).
 * Régénération : `UPDATE_EXAMPLES=1 pnpm vitest run packages/core/src/structures/woodCentral.acceptance.test.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fr, frList } from "../i18n.test-helpers.js";
import type { Model } from "../model/derived.js";
import type { Project } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { parseProjectText } from "../project/parse.js";
import { createHelicalProject } from "../project/presetHelical.js";
import { createProject, deepMerge } from "../project/presets.js";
import { serializeProject } from "../project/serialize.js";
import { fcbaTable, requiredCentralResidual } from "./fcba.js";
import { CENTRAL_RULES } from "./steelCentral.js";
import { WOOD_CENTRAL_RULES } from "./woodCentral.js";
import "./index.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");

export const J5C_WOOD_STRAIGHT = "j5c-limon-central-bois-droit.blondel.json";
export const J5C_WOOD_QUARTER = "j5c-limon-central-bois-quart-tournant.blondel.json";
export const J5C_WOOD_HELICAL = "j5c-limon-central-bois-helicoidal.blondel.json";

/** Marches sans contremarche, 80 mm (vide entre marches sous la sphère de 100 mm). */
const OPEN_TREADS = { risers: "none", thickness: 80 } as const;

/** Pose la structure `wood-central` (paramètres minimaux) et des marches sans contremarche. */
function withWoodCentral(p: Project, params: Record<string, unknown>): Project {
  return deepMerge(p, {
    stair: { treads: OPEN_TREADS, structure: { kind: "wood-central", params } },
  });
}

/**
 * Escalier droit (E = 900, H = 2 600, volée de 3 400 mm) dans le domaine de l'exemple FCBA
 * (hauteur ≤ 2 700, projection ≤ 2 700 / tan 38°) : le reste sous entaille `auto` est lu dans le
 * tableau à b / 2. Crémaillère centrale en lamellé-collé de 88 mm (couches collées droites),
 * marches chêne entaillées et boulonnées, sabots de pied et de tête.
 */
export function j5cWoodStraight(): Project {
  return withWoodCentral(
    createProject("straight", {
      name: "Jalon 5c — escalier droit sur limon central bois (lamellé-collé)",
      floorToFloor: 2600,
      patch: { stair: { layout: { legs: [{ length: 3400 }] } } },
    }),
    { section: { kind: "glulam" } },
  );
}

/**
 * Quart tournant balancé du préréglage (jour vif), limon central bois en lamellé-collé cintré
 * sur moule autour du jour (lamelles verticales, épaisseur `auto` : k_r = 1).
 */
export function j5cWoodQuarter(): Project {
  return withWoodCentral(
    createProject("quarter-left", {
      name: "Jalon 5c — quart tournant balancé sur limon central bois (lamellé-collé cintré)",
    }),
    { section: { kind: "glulam" } },
  );
}

/**
 * Hélicoïdal à jour central (R_e = 1 200, jour de 350 mm, comme l'exemple du limon central
 * métal), limon central bois en lamellé-collé cintré sur moule cylindrique (C §1.6 [7] ;
 * B §4.3 [16] ne traite que de la main courante hélicoïdale) à mi-emmarchement. Reste sous entaille imposé à 260 mm (poutre plus haute que le
 * repli de 180 mm) pour que le prédimensionnement indicatif en flexion passe sur la portée
 * développée de l'hélice (choix de présentation, à valider).
 */
export function j5cWoodHelical(): Project {
  return withWoodCentral(
    createHelicalProject({
      name: "Jalon 5c — hélicoïdal à jour central sur limon central bois (lamellé-collé cintré)",
      floorToFloor: 2750,
      outerRadius: 1200,
      patch: {
        stair: { layout: { core: { kind: "well", radius: 350 } }, treads: OPEN_TREADS },
      },
    }),
    { section: { kind: "glulam", residual: 260 } },
  );
}

const GENERATORS: readonly (readonly [string, () => Project])[] = [
  [J5C_WOOD_STRAIGHT, j5cWoodStraight],
  [J5C_WOOD_QUARTER, j5cWoodQuarter],
  [J5C_WOOD_HELICAL, j5cWoodHelical],
];

if (process.env["UPDATE_EXAMPLES"] === "1") {
  for (const [file, make] of GENERATORS) {
    writeFileSync(join(EXAMPLES_DIR, file), serializeProject(make()));
  }
}

const load = (file: string): Project =>
  parseProjectText(readFileSync(join(EXAMPLES_DIR, file), "utf8"));

const results = (m: Model, id: string) => m.compliance.results.filter((r) => r.ruleId === id);
const violations = (m: Model, id: string) => results(m, id).filter((r) => r.status === "violation");

describe("exemples j5c : limon central bois", () => {
  it.each(GENERATORS)("%s : à jour avec son générateur, sérialisation stable", (file, make) => {
    const text = readFileSync(join(EXAMPLES_DIR, file), "utf8");
    expect(text).toBe(serializeProject(make()));
    expect(serializeProject(parseProjectText(text))).toBe(text);
  });

  it.each(GENERATORS)(
    "%s : modèle complet, poutre LC1, ancrages, k_r conforme, porte-à-faux signalé",
    (file) => {
      const m = buildModel(load(file), { memo: false });
      expect(frList(m.errors)).toEqual([]);
      const beam = m.parts.find((p) => p.id === "wood-central-beam");
      expect(beam?.mark).toBe("LC1");
      expect(beam?.category).toBe("carriage");
      const straight = file === J5C_WOOD_STRAIGHT;
      // Seules violations bloquantes admises : le prédimensionnement indicatif des couches
      // empilées réduit par la formule de Hankinson (flèche et contrainte, écart voulu de
      // A35 (j), valeurs à valider, QUESTIONS A36 (8)) ; aucune sur le droit.
      const blocking = m.compliance.results
        .filter((r) => r.status === "violation" && r.severity === "bloquant")
        .map((r) => r.ruleId);
      expect(blocking.filter((id) => !id.startsWith("PRECHECK_"))).toEqual([]);
      if (straight) expect(m.compliance.summary.bloquant).toBe(0);
      // Ancrage par défaut (A34 (c)) : sabots en U sur le droit, platines à âme noyée sur les
      // poutres cintrées (sabot et FAB_SABOT_EMPRISE absents).
      const shoeFoot = m.parts.find((p) => p.id === "wood-central-shoe-foot");
      const shoeHead = m.parts.find((p) => p.id === "wood-central-shoe-head");
      if (straight) {
        expect(shoeFoot?.mark).toBe("SP1");
        expect(shoeHead?.mark).toBe("ST1");
      } else {
        expect(shoeFoot).toBeUndefined();
        expect(shoeHead).toBeUndefined();
        expect(results(m, "FAB_SABOT_EMPRISE")).toEqual([]);
      }
      expect(results(m, "LAMELLE_CINTRE_KR").map((r) => r.status)).toEqual(["ok"]);
      // Entaille arrière de chaque marche (sans contremarche) : au moins 14 mm.
      expect(violations(m, "LIMON_ENTAILLE_MIN")).toEqual([]);
      expect(results(m, "LIMON_ENTAILLE_MIN").length).toBeGreaterThan(0);
      const cantilever = violations(m, CENTRAL_RULES.cantilever.id);
      expect(cantilever).toHaveLength(1);
      expect(fr(cantilever[0]!.message)).toMatch(/^Justification requise/);
      // Prédimensionnement évalué partout (A35 (j)) : couches empilées réduites par la formule
      // de Hankinson ; classe `auto` du chêne lamellé-collé : D40 (A35 (k), à valider).
      expect(m.precheck?.beams).toHaveLength(1);
      expect(fr(m.precheck!.beams[0]!.label)).toMatch(/\bD40\b/);
      const pre = results(m, "PRECHECK_CONTRAINTE");
      expect(pre).toHaveLength(1);
      expect(pre[0]!.status).not.toBe("non-evaluee");
      if (straight) expect(pre[0]!.status).toBe("ok");
      for (const p of m.parts) {
        // Poutre en couches empilées : matière portée par ses couches composantes.
        if (p.id === "wood-central-beam" && p.stock === undefined) continue;
        const mass = p.quantities["mass_kg"];
        expect(mass !== undefined && Number.isFinite(mass) && mass > 0, p.id).toBe(true);
      }
      // Visserie : marches boulonnées au travers de la poutre, tire-fonds sur les marches
      // basses (A34 (a)) ; sabots boulonnés et chevillés sur le droit.
      const joints = new Set((m.fasteners ?? []).map((f) => f.joint));
      for (const j of [
        "treadBeamBolted",
        "treadBeamLagScrewed",
        ...(straight ? ["shoeBolted", "plateFloor", "plateTrimmer"] : []),
      ]) {
        expect(joints.has(j as never), j).toBe(true);
      }
      expect(joints.has("shoeBolted")).toBe(straight);
      expect(joints.has("treadScrewed")).toBe(false);
    },
  );

  it("droit : marches 1 et 2 fixées par tire-fonds, M1 bloquée par le boulon de sabot (A34 (a), A35 (l))", () => {
    const m = buildModel(load(J5C_WOOD_STRAIGHT), { memo: false });
    // Écart voulu (A35 (l), QUESTIONS A36 (10)) : aux règles des tire-fonds (entraxe 7·d = 70 mm,
    // 10·d = 100 mm au bout avant), l'assise de M1 n'a plus la place que d'un tire-fond hors du
    // perçage du second boulon de sabot SP1 ; seule M1 garde un constat.
    const found = violations(m, "FAB_LIMON_CENTRAL_BOIS_BOULONS");
    expect(
      found.map((r) => [r.location.kind === "part" ? r.location.treadNumber : null, r.message.key]),
    ).toEqual([[1, "structure.woodCentral.check.fixings.blocked"]]);
    expect(found[0]!.measured).toBe(1);
    const lc1 = m.parts.find((p) => p.id === "wood-central-beam")!;
    const lagTreads = new Set(
      (lc1.fixings ?? []).filter((f) => f.joint === "treadBeamLagScrewed").map((f) => f.with?.[0]),
    );
    expect(lagTreads).toEqual(new Set(["tread-1", "tread-2"]));
  });

  it("droit : 3 couches droites, boulon au milieu de la couche centrale, pinces tenues (A35 (f))", () => {
    const m = buildModel(load(J5C_WOOD_STRAIGHT), { memo: false });
    expect(violations(m, "FAB_LIMON_CENTRAL_BOIS_PINCES")).toEqual([]);
    const lc1 = m.parts.find((p) => p.id === "wood-central-beam")!;
    expect(fr(lc1.section!)).toMatch(/\b3 lamelles\b/);
  });

  it.each([J5C_WOOD_QUARTER, J5C_WOOD_HELICAL])(
    "%s : âme de pied prolongée, M1 avec ses 2 organes, platine conforme (A35 (a))",
    (file) => {
      const m = buildModel(load(file), { memo: false });
      const onM1 = violations(m, "FAB_LIMON_CENTRAL_BOIS_BOULONS").filter(
        (r) => r.location.kind === "part" && r.location.treadNumber === 1,
      );
      expect(onM1).toEqual([]);
      const lc1 = m.parts.find((p) => p.id === "wood-central-beam")!;
      const m1 = (lc1.fixings ?? [])
        .filter((f) => f.with?.[0] === "tread-1")
        .reduce((a, f) => a + f.points, 0);
      expect(m1).toBe(2);
      const plate = results(m, "FAB_PLATINE_AME_NOYEE");
      expect(plate.length).toBeGreaterThan(0);
      expect(plate.every((r) => r.status === "ok")).toBe(true);
      // Valeur `auto` de l'âme de pied exposée.
      expect(m.autoValues?.["stair.structure.params.anchors.plate.footWebLength"]).toBeGreaterThan(
        0,
      );
    },
  );

  it.each([J5C_WOOD_QUARTER, J5C_WOOD_HELICAL])(
    "%s : prédimensionnement réduit par la formule de Hankinson, remarque sourcée (A35 (j))",
    (file) => {
      const m = buildModel(load(file), { memo: false });
      const note = frList(m.precheck?.notes ?? []).find((n) =>
        /^Couches empilées : fil horizontal/.test(n),
      );
      expect(note).toMatch(/k_f = 0,\d+/);
      expect(note).toMatch(/\[81\]/);
      for (const id of ["PRECHECK_CONTRAINTE", "PRECHECK_FLECHE", "PRECHECK_FREQUENCE"]) {
        expect(
          results(m, id).map((r) => r.status),
          id,
        ).not.toContain("non-evaluee");
      }
    },
  );

  it("hélicoïdal : couches composées de plusieurs planches LC1-k.j, sans débit indisponible (A35 (h))", () => {
    const m = buildModel(load(J5C_WOOD_HELICAL), { memo: false });
    const boards = m.parts.filter((p) => /^LC1-\d+\.\d+$/.test(p.mark ?? ""));
    expect(boards.length).toBeGreaterThan(0);
    for (const b of boards) {
      expect(b.componentOf).toBe("wood-central-beam");
      expect(b.id).toMatch(/^wood-central-layer-\d+-\d+$/);
    }
    expect(violations(m, "FAB_DEBIT_DISPONIBLE")).toEqual([]);
  });

  it("droit : couches collées droites, tableau FCBA lu à b / 2, sans plis minces, EXC1", () => {
    const m = buildModel(load(J5C_WOOD_STRAIGHT), { memo: false });
    const cr = results(m, "CREMAILLERE_REGLE_MOYENS");
    expect(cr.length).toBeGreaterThan(0);
    expect(cr.every((r) => r.status === "ok")).toBe(true);
    expect(m.autoValues?.["stair.structure.params.section.residual"]).toBe(
      requiredCentralResidual(fcbaTable(), "D40", 88),
    );
    expect(results(m, WOOD_CENTRAL_RULES.thinPlies.id)).toEqual([]);
    expect(m.executionClass).toBe("EXC1");
  });

  it.each([J5C_WOOD_QUARTER, J5C_WOOD_HELICAL])(
    "%s : couches empilées par défaut (b = 88 > 60), sans cintrage, tableau FCBA hors domaine",
    (file) => {
      const m = buildModel(load(file), { memo: false });
      expect(results(m, "CREMAILLERE_REGLE_MOYENS").map((r) => r.status)).toEqual(["non-evaluee"]);
      // Couches empilées (A33 (e)) : ni plis minces, ni cintrage.
      expect(results(m, WOOD_CENTRAL_RULES.thinPlies.id)).toEqual([]);
      expect(fr(results(m, "LAMELLE_CINTRE_KR")[0]!.message)).toMatch(/^Couches horizontales/);
      const lc1 = m.parts.find((p) => p.id === "wood-central-beam")!;
      expect(lc1.stock).toBeUndefined();
      expect(fr(lc1.section!)).toMatch(/^lamellé-collé en couches empilées/);
      for (const p of m.parts.filter((q) => q.componentOf !== undefined)) {
        expect(p.componentOf).toBe("wood-central-beam");
      }
    },
  );
});
