import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { isMessage } from "@blondel/i18n";
import { fr, frList } from "../i18n.test-helpers.js";
import type { Model } from "../model/derived.js";
import { ProjectSchema, type Project } from "../model/project.js";
import { parseProjectText } from "../project/parse.js";
import { createProject } from "../project/presets.js";
import { serializeProject } from "../project/serialize.js";
import { isRuleApplicable } from "../rules/contexts.js";
import { ruleCoverage } from "../rules/engine.js";
import { PARTIAL_MODEL_RULES } from "../rules/evaluators/index.js";
import { RULES, getRule } from "../rules/table.js";
import { makeSteppingProject, stairArb } from "../stepping/test-helpers.js";
import { buildModel, clearModelCache, EMPTY_LAYOUT, modelCacheStats } from "./build.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const EXAMPLE_FILES = readdirSync(EXAMPLES_DIR)
  .filter((f) => f.endsWith(".blondel.json"))
  .sort();
const ACCEPTANCE_01 = "acceptance-01-quart-tournant.blondel.json";

function loadExample(file: string): Project {
  return parseProjectText(readFileSync(join(EXAMPLES_DIR, file), "utf8"));
}

const r1 = (x: number | undefined): number | null =>
  x === undefined || Number.isNaN(x) ? null : Math.round(x * 10) / 10;
const r2 = (x: number): number => Math.round(x * 100) / 100;

/** Cotes principales d'un modèle (non-régression, arrondies pour la stabilité). */
function mainDimensions(m: Model) {
  const s = m.stepping;
  const winders = s.treads.filter((t) => t.kind === "winder");
  return {
    n: s.riserCount,
    h: r2(s.rise),
    firstRise: r2(s.rises[0]!),
    g: r2(s.going),
    blondel: r2(s.blondel),
    run: r1(s.run),
    treads: s.treads.map((t) => t.kind[0]).join(""),
    zones: s.balancedZones.map((z) => `${z.from}-${z.to} ${z.method}`),
    colletsChord: winders.map((t) => r1(t.colletChord)),
    colletMin: winders.length > 0 ? r1(Math.min(...winders.map((t) => t.colletChord))) : null,
    headroom: r1(m.headroom?.min),
    headroomWidth: m.headroomWidth
      ? { min: r1(m.headroomWidth.min), nosing: m.headroomWidth.nosing }
      : null,
    parts: m.parts.length,
    violations: m.compliance.summary,
  };
}

const blocking = (m: Model) =>
  m.compliance.results.filter((r) => r.status === "violation" && r.severity === "bloquant");

beforeEach(() => clearModelCache());

describe("buildModel — exemples du dépôt", () => {
  it.each(EXAMPLE_FILES)("%s : modèle complet, sans erreur", (file) => {
    const project = loadExample(file);
    const m = buildModel(project);
    expect(m.errors).toEqual([]);
    expect(m.layout).not.toBe(EMPTY_LAYOUT);
    expect(m.stepping.treads).toHaveLength(m.stepping.riserCount - 1);
    const treadParts = m.parts.filter((p) => p.category === "tread" || p.category === "landing");
    expect(treadParts.map((p) => p.id)).toEqual(m.stepping.treads.map((t) => `tread-${t.number}`));
    // Marches en tôle pliée (steel-flat, contremarches pliées ou claire-voie) : les
    // contremarches bois de base sont supprimées par le pipeline (`removedBaseParts`), sauf
    // la contremarche d'arrivée en profil Z (aucune pièce Z ne la porte).
    const foldedTreads = m.parts.some(
      (p) => p.category === "tread" && p.material.startsWith("steel"),
    );
    const risers = m.parts.filter((p) => p.category === "riser");
    if (foldedTreads) {
      for (const p of risers) expect(p.id).toBe(`riser-${m.stepping.riserCount}`);
    } else if (project.stair.treads.risers !== "full") {
      // Sans contremarche (démos loft et hélicoïdales à marches bois) : aucune pièce.
      expect(risers).toHaveLength(0);
    } else {
      expect(risers).toHaveLength(m.stepping.riserCount);
    }
  });

  it.each(EXAMPLE_FILES)("%s : cotes principales (non-régression)", (file) => {
    expect(mainDimensions(buildModel(loadExample(file)))).toMatchSnapshot();
  });

  it.each(EXAMPLE_FILES)(
    "%s : le rapport liste toutes les règles applicables, non évaluées comprises",
    (file) => {
      const project = loadExample(file);
      const report = buildModel(project).compliance;
      // Un plugin de structure (jalon 3a) évalue certaines règles sans évaluateur du moteur
      // (limon, crémaillère : `mergeStructureChecks`) ; sans structure, elles restent
      // « non évaluées ».
      const withStructure = project.stair.structure.kind !== "none";
      const active = new Set(report.contexts);
      const ids = new Set(report.results.map((r) => r.ruleId));
      const missing = new Set(ruleCoverage().notImplemented);
      let notEvaluated = 0;
      for (const rule of RULES) {
        if (!isRuleApplicable(rule, active)) continue;
        expect(ids.has(rule.id), rule.id).toBe(true);
        if (missing.has(rule.id)) {
          notEvaluated++;
          if (withStructure) continue;
          for (const r of report.results.filter((x) => x.ruleId === rule.id)) {
            expect(r.status).toBe("non-evaluee");
          }
        }
      }
      expect(notEvaluated).toBeGreaterThan(0);
      // Échappée : évaluée (mesure ou trémie couvrante), jamais « non calculée ».
      const hr = report.results.find((r) => r.ruleId === "ECHAPPEE_MIN_DTU")!;
      expect(hr.status).not.toBe("non-evaluee");
    },
  );

  it.each(EXAMPLE_FILES)("%s : recalcul identique après sérialisation JSON", (file) => {
    const p = loadExample(file);
    const again = parseProjectText(serializeProject(p));
    expect(buildModel(again, { memo: false })).toEqual(buildModel(p, { memo: false }));
  });
});

describe("buildModel — cas d'acceptation n° 1 (CHALLENGE G8)", () => {
  const quarter = loadExample(ACCEPTANCE_01);

  /** Escalier droit sur le même site, arrivant au bord de trémie (x = −2 252), le long du mur. */
  function straightOnSameSite(targetGoing: number | "auto", arrivalX = -2252): Project {
    const n = 15;
    const g = targetGoing === "auto" ? 630 - (2 * 2700) / n : targetGoing;
    const run = (n - 1) * g;
    return ProjectSchema.parse({
      ...quarter,
      stair: {
        ...quarter.stair,
        // Rotation de 90° : montée selon −X, emmarchement de y = 480 à 1 280 (côté mur).
        placement: { origin: { x: Math.round(arrivalX + run), y: 480 }, rotation: 90 },
        layout: { width: 800, legs: [{ length: "auto" }], turns: [] },
        stepping: { ...quarter.stair.stepping, targetGoing },
      },
    });
  }

  it("le quart tournant est sans violation bloquante", () => {
    const m = buildModel(quarter);
    expect(m.errors).toEqual([]);
    expect(blocking(m)).toEqual([]);
    expect(m.headroom!.min).toBeGreaterThanOrEqual(getRule("ECHAPPEE_MIN_DTU").min!);
  });

  it("un escalier droit de même site (giron auto 270) est rejeté pour l'échappée", () => {
    const m = buildModel(straightOnSameSite("auto"));
    expect(m.errors).toEqual([]);
    expect(m.stepping.going).toBeCloseTo(270, 9);
    expect(blocking(m).map((r) => r.ruleId)).toEqual(["ECHAPPEE_MIN_DTU"]);
    // L_trémie ≥ (1 900 + 200)·270/180 = 3 150 > 2 800 : Γ entre dans la trémie à s = 3 780 − 2 800.
    expect(m.headroom!.min).toBeCloseTo(2500 - (180 + ((3780 - 2800) * 180) / 270), 6);
  });

  it("droit rejeté quelle que soit sa position le long de la trémie", () => {
    for (const arrivalX of [-2252, -2000, -1500, -1000, 0, 548]) {
      const m = buildModel(straightOnSameSite("auto", arrivalX));
      expect(
        blocking(m).map((r) => r.ruleId),
        `arrivée x = ${arrivalX}`,
      ).toContain("ECHAPPEE_MIN_DTU");
    }
  });

  it("au giron minimal logement (240), le droit passe tout juste : c'est pourquoi le cas impose g ≤ 240", () => {
    // (1 900 + 200)·240/180 = 2 800 = longueur de la trémie : échappée exactement 1 900 mm.
    const m = buildModel(straightOnSameSite(240));
    expect(m.headroom!.min).toBeCloseTo(1900, 6);
    expect(blocking(m)).toEqual([]);
  });
});

describe("buildModel — paramètres impossibles : modèle partiel, jamais d'exception", () => {
  const base = makeSteppingProject({ width: 900, legs: [2000, 3000] });

  it("tracé impossible (tournant manquant) : tracé vide, hauteurs seules", () => {
    // Les tournants de sens opposés (S / Z) sont pris en charge depuis le 2026-09-29 : tracé
    // impossible = trois volées pour un seul tournant.
    const p = makeSteppingProject({ width: 900, legs: [2000, 2000, 2000] });
    const bad: Project = {
      ...p,
      stair: {
        ...p.stair,
        layout: { ...p.stair.layout, turns: [p.stair.layout.turns[0]!] },
      },
    };
    const m = buildModel(bad);
    expect(frList(m.errors)).toEqual([expect.stringContaining("un tournant de moins")]);
    expect(m.layout).toBe(EMPTY_LAYOUT);
    expect(m.stepping.riserCount).toBe(15);
    expect(m.stepping.rises.reduce((a, b) => a + b, 0)).toBeCloseTo(2700, 9);
    expect(m.stepping.treads).toEqual([]);
    expect(m.parts).toEqual([]);
    expect(m.headroom).toBeUndefined();
    expect(m.compliance.results.length).toBeGreaterThan(0);
  });

  it("volée trop courte : erreur du tracé", () => {
    const m = buildModel(makeSteppingProject({ width: 900, legs: [500, 3000] }));
    expect(frList(m.errors)).toEqual([expect.stringContaining("trop courte")]);
    expect(m.parts).toEqual([]);
  });

  it("hauteurs impossibles : erreur du découpage, tracé conservé", () => {
    const p: Project = {
      ...base,
      stair: { ...base.stair, stepping: { ...base.stair.stepping, firstRiseOffset: -500 } },
    };
    const m = buildModel(p);
    expect(frList(m.errors)).toEqual([expect.stringContaining("Hauteurs de marche impossibles")]);
    expect(m.layout.walkline.segments.length).toBeGreaterThan(0);
    expect(m.stepping.riserCount).toBe(0);
    expect(m.compliance.results.length).toBeGreaterThan(0);
  });

  it("modèle partiel : aucune règle dépendant du tracé ou du découpage ne sort « ok » (relecture)", () => {
    // Régression : tracé en échec → LF_POSITION « ok » avec une mesure NaN, VOLEE_MAX « ok »
    // sur une volée unique supposée ; découpage en échec → G_MIN_* « sans objet » (ok).
    const p = makeSteppingProject({ width: 900, legs: [2000, 2000, 2000] });
    const badLayout: Project = {
      ...p,
      stair: {
        ...p.stair,
        layout: { ...p.stair.layout, turns: [p.stair.layout.turns[0]!] },
      },
    };
    const badStepping: Project = {
      ...base,
      stair: { ...base.stair, stepping: { ...base.stair.stepping, firstRiseOffset: -500 } },
    };
    for (const [project, stage] of [
      [badLayout, "tracé"],
      [badStepping, "découpage"],
    ] as const) {
      const m = buildModel(project, { memo: false });
      expect(m.errors).toHaveLength(1);
      expect(frList(m.compliance.notes)).toEqual(
        expect.arrayContaining([expect.stringContaining(`Modèle partiel (${stage} non calculé)`)]),
      );
      for (const r of m.compliance.results) {
        if (r.measured !== undefined) expect(Number.isNaN(r.measured), r.ruleId).toBe(false);
        const partialOk =
          PARTIAL_MODEL_RULES.project.has(r.ruleId) ||
          (PARTIAL_MODEL_RULES.rises.has(r.ruleId) && m.stepping.rises.length > 0);
        if (!partialOk) expect(r.status, r.ruleId).toBe("non-evaluee");
      }
      for (const id of ["LF_POSITION_DTU_ETROIT", "VOLEE_MAX_DTU", "G_MIN_LOGEMENT"]) {
        const r = m.compliance.results.find((x) => x.ruleId === id);
        expect(r?.status, id).toBe("non-evaluee");
      }
    }
    // Tracé en échec : les hauteurs restent contrôlées.
    const h = buildModel(badLayout, { memo: false }).compliance.results.find(
      (x) => x.ruleId === "H_MAX_LOGEMENT",
    )!;
    expect(h.status).toBe("ok");
    // Hauteurs impossibles : même les règles de hauteur sont non évaluées.
    const h2 = buildModel(badStepping, { memo: false }).compliance.results.find(
      (x) => x.ruleId === "H_MAX_LOGEMENT",
    )!;
    expect(h2.status).toBe("non-evaluee");
  });

  it("propriété : aucun projet valide ne fait lever buildModel", () => {
    const arb = fc.record({
      width: fc.integer({ min: 300, max: 2500 }),
      legs: fc.array(fc.integer({ min: 100, max: 6000 }), { minLength: 1, maxLength: 4 }),
      direction: fc.constantFrom("left" as const, "right" as const),
      mode: fc.constantFrom("winders" as const, "landing" as const),
      floorToFloor: fc.integer({ min: 300, max: 6000 }),
      firstRiseOffset: fc.integer({ min: -200, max: 200 }),
      thickness: fc.integer({ min: 1, max: 300 }),
      method: fc.constantFrom("M0" as const, "M1" as const, "M3" as const),
    });
    fc.assert(
      fc.property(arb, (r) => {
        const p = makeSteppingProject({
          width: r.width,
          legs: r.legs,
          direction: r.direction,
          mode: r.mode,
          floorToFloor: r.floorToFloor,
          stepping: { firstRiseOffset: r.firstRiseOffset },
          treads: { thickness: r.thickness },
          balancing: { method: r.method },
        });
        const m = buildModel(p, { memo: false });
        for (const e of m.errors) expect(isMessage(e)).toBe(true);
        expect(m.errors.some((e) => e.key === "pipeline.internalError")).toBe(false);
        if (m.errors.length === 0) {
          expect(m.stepping.treads).toHaveLength(m.stepping.riserCount - 1);
        }
      }),
      { numRuns: 150 },
    );
  }, 120_000);
});

describe("buildModel — échappée et contrôle de conception", () => {
  it("propriété : échappée sur Γ ≥ minimum ⇔ ECHAPPEE_MIN_DTU conforme", () => {
    const rect = fc.record({
      y: fc.integer({ min: -500, max: 4000 }),
      size: fc.integer({ min: 200, max: 6000 }),
    });
    fc.assert(
      fc.property(stairArb(), rect, ({ project }, o) => {
        const p: Project = {
          ...project,
          site: {
            ...project.site,
            opening: { kind: "rect", x: -6000, y: o.y, sizeX: 12000, sizeY: o.size },
          },
        };
        const m = buildModel(p, { memo: false });
        const r = m.compliance.results.find((x) => x.ruleId === "ECHAPPEE_MIN_DTU")!;
        const emin = getRule("ECHAPPEE_MIN_DTU").min!;
        if (m.headroom) {
          expect(r.status).toBe(m.headroom.min >= emin - 1e-6 ? "ok" : "violation");
          expect(r.measured).toBe(m.headroom.min);
        } else {
          expect(r.status).toBe("ok");
        }
      }),
      { numRuns: 60 },
    );
  }, 120_000);

  it("sans trémie : échappée sans objet", () => {
    const m = buildModel(makeSteppingProject({ width: 900, legs: ["auto"] }));
    expect(m.headroom).toBeUndefined();
    const r = m.compliance.results.find((x) => x.ruleId === "ECHAPPEE_MIN_DTU")!;
    expect(fr(r.message)).toMatch(/Sans objet/);
  });

  it("échappée sur la largeur insuffisante : règle ECHAPPEE_LARGEUR en avertissement (A7)", () => {
    const m = buildModel(loadExample(ACCEPTANCE_01));
    expect(m.headroomWidth!.min).toBeLessThan(1900);
    // Plus de remarque dans Model.notes : la grandeur est portée par une règle de rules.yaml.
    expect(frList(m.notes)).not.toContainEqual(expect.stringContaining("échappée sur la largeur"));
    const rs = m.compliance.results.filter((r) => r.ruleId === "ECHAPPEE_LARGEUR");
    expect(rs).toHaveLength(1);
    const r = rs[0]!;
    expect(r.status).toBe("violation");
    expect(r.severity).toBe("avertissement");
    // Seuil repris de ECHAPPEE_MIN_DTU (bloquante, contextes bois_dtu / logement_interieur).
    expect(r.min).toBe(getRule("ECHAPPEE_MIN_DTU").min);
    expect(r.measured).toBeCloseTo(m.headroomWidth!.min, 9);
    // Nez 3 = dessus de la marche 4 (repère M4) : le message parle de la marche, pas de l'indice.
    // (Nez 4 / marche 5 avant la correction du choix de zone G3 du 2026-09-29 : zone 0 → 4.)
    expect(m.headroomWidth!.nosing).toBe(3);
    expect(fr(r.message)).toContain("au nez de la marche 4");
    expect(m.headroomUnlimited).toBeUndefined();
  });

  it("ECHAPPEE_LARGEUR : seuil = plus grand minimum des ECHAPPEE_* bloquantes actives", () => {
    const p = loadExample(ACCEPTANCE_01);
    const withCtx = (contexts: string[], profile: "strict" | "souple" = "strict") =>
      buildModel({
        ...p,
        compliance: { ...p.compliance, contexts, profile },
      }).compliance.results.find((r) => r.ruleId === "ECHAPPEE_LARGEUR")!;
    // Industriel : ECHAPPEE_INDUSTRIEL (2 300) l'emporte sur ECHAPPEE_MIN_DTU (1 900).
    expect(withCtx(["bois_dtu", "industriel"]).min).toBe(getRule("ECHAPPEE_INDUSTRIEL").min);
    // Profil souple : la sévérité déclarée compte, le seuil reste celui du DTU.
    expect(withCtx(["bois_dtu"], "souple").min).toBe(getRule("ECHAPPEE_MIN_DTU").min);
    // Aucune règle d'échappée bloquante (ERP : recommandation seulement) : sans objet.
    const erp = withCtx(["erp_neuf"]);
    expect(erp.status).toBe("ok");
    expect(fr(erp.message)).toMatch(/Sans objet/);
  });

  it("trémie couvrante : échappée non limitée sur Γ et sur la largeur (A7)", () => {
    const m = buildModel(createProject("half-turn"));
    expect(m.headroom).toBeUndefined();
    expect(m.headroomWidth).toBeUndefined();
    expect(m.headroomUnlimited).toEqual({ walkline: true, width: true });
    const r = m.compliance.results.find((x) => x.ruleId === "ECHAPPEE_LARGEUR")!;
    expect(r.status).toBe("ok");
    expect(fr(r.message)).toMatch(/non limitée/);
    // Sans trémie : rien de « non limité » (échappée non calculée).
    expect(
      buildModel(makeSteppingProject({ width: 900, legs: ["auto"] })).headroomUnlimited,
    ).toBeUndefined();
  });

  it("structure sans plugin : remarque, pièces de base seulement", () => {
    const p = loadExample("straight.blondel.json");
    const q = ProjectSchema.parse({
      ...p,
      stair: { ...p.stair, structure: { kind: "limon-francaise", params: {} } },
    });
    const m = buildModel(q);
    expect(m.notes).toEqual([
      { key: "pipeline.unknownStructure", params: { kind: "limon-francaise" } },
    ]);
    expect(frList(m.notes)).toEqual([expect.stringContaining("aucun plugin de structure")]);
    expect(m.parts.length).toBe(buildModel(p).parts.length);
  });
});

describe("buildModel — mémoïsation", () => {
  const p = loadExample("quarter-left.blondel.json");

  it("même projet : même modèle (identité)", () => {
    expect(buildModel(p)).toBe(buildModel(p));
  });

  it("modification du nom : étapes réutilisées", () => {
    const a = buildModel(p);
    const b = buildModel({ ...p, name: "Autre nom" });
    expect(b).not.toBe(a);
    expect(b.layout).toBe(a.layout);
    expect(b.stepping).toBe(a.stepping);
    expect(b.parts).toBe(a.parts);
    expect(b.compliance).toBe(a.compliance);
  });

  it("modification du contrôle de conception seul : tracé, découpage et pièces réutilisés", () => {
    const a = buildModel(p);
    const b = buildModel({ ...p, compliance: { ...p.compliance, profile: "souple" } });
    expect(b.layout).toBe(a.layout);
    expect(b.stepping).toBe(a.stepping);
    expect(b.parts).toBe(a.parts);
    expect(b.compliance).not.toBe(a.compliance);
    expect(b.compliance.profile).toBe("souple");
  });

  it("modification de la trémie : échappée recalculée, découpage réutilisé", () => {
    const a = buildModel(p);
    const opening = { kind: "rect" as const, x: -5000, y: -5000, sizeX: 10000, sizeY: 10000 };
    const b = buildModel({ ...p, site: { ...p.site, opening } });
    expect(b.stepping).toBe(a.stepping);
    expect(b.headroom).toBeUndefined();
    const stats = modelCacheStats();
    expect(stats.stepping.hits).toBeGreaterThan(0);
  });

  it("modification des marches : découpage et pièces recalculés", () => {
    const a = buildModel(p);
    const b = buildModel({
      ...p,
      stair: { ...p.stair, treads: { ...p.stair.treads, thickness: 50 } },
    });
    expect(b.layout).toBe(a.layout);
    expect(b.parts).not.toBe(a.parts);
  });
});
