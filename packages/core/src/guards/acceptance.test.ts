/**
 * Jalon 4 — critère d'acceptation n° 1 complet (CHALLENGE P1) : quart tournant bas bois,
 * limons à la française avec poteau d'angle, **garde-corps barreaudé côté vide**, garde-corps
 * de trémie ; murs du site le long du bord extérieur.
 *
 * Exemple `examples/j4-acceptance-01-garde-corps.blondel.json`, dérivé de l'exemple du jalon 3a
 * (murs + section `guards`). Régénération :
 * `UPDATE_EXAMPLES=1 pnpm vitest run packages/core/src/guards/acceptance.test.ts`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { Model, RuleResult } from "../model/derived.js";
import { ProjectSchema, type Project, type ProjectInput } from "../model/project.js";
import { buildModel, clearModelCache } from "../pipeline/build.js";
import { parseProjectText } from "../project/parse.js";
import { serializeProject } from "../project/serialize.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const J3A = "j3a-acceptance-01-bois.blondel.json";
const J4_EXAMPLE = "j4-acceptance-01-garde-corps.blondel.json";

/**
 * Murs du site le long du bord extérieur (volée 1 : x = E ; volée 2 : y = L1), au-delà des
 * limons de 54 mm : axes à 154 mm du bord, épaisseur 200 mm (nu à 54 mm du bord). Géométrie
 * d'essai, sans source (le cas d'acceptation ne donne pas les murs).
 */
const WALLS = [
  {
    id: "mur-droit",
    a: { x: 954, y: -200 },
    b: { x: 954, y: 1434 },
    thickness: 200,
    loadBearing: true,
  },
  {
    id: "mur-fond",
    a: { x: 954, y: 1434 },
    b: { x: -2600, y: 1434 },
    thickness: 200,
    loadBearing: true,
  },
];

function readExample(file: string): Project {
  return parseProjectText(readFileSync(join(EXAMPLES_DIR, file), "utf8"));
}

/** Générateur de l'exemple du jalon 4. */
function acceptance01Guards(): Project {
  const base = readExample(J3A);
  const input: ProjectInput = {
    ...base,
    name: "Jalon 4 — cas d'acceptation n° 1, garde-corps barreaudé",
    site: { ...base.site, walls: WALLS },
    compliance: { ...base.compliance, referenceDate: "2026-01-15" },
    guards: { infill: { kind: "balusters" } },
  };
  return ProjectSchema.parse(input);
}

if (process.env["UPDATE_EXAMPLES"] === "1") {
  writeFileSync(join(EXAMPLES_DIR, J4_EXAMPLE), serializeProject(acceptance01Guards()));
}

const blocking = (m: Model): RuleResult[] =>
  m.compliance.results.filter((r) => r.status === "violation" && r.severity === "bloquant");
const results = (m: Model, id: string): RuleResult[] =>
  m.compliance.results.filter((r) => r.ruleId === id);

function withGuards(p: Project, guards: ProjectInput["guards"], date?: string): Project {
  return ProjectSchema.parse({
    ...p,
    guards,
    compliance: { ...p.compliance, ...(date ? { referenceDate: date } : {}) },
  });
}

beforeEach(() => clearModelCache());

describe("jalon 4 — cas d'acceptation n° 1 (garde-corps)", () => {
  it("l'exemple existe et est à jour avec son générateur", () => {
    const path = join(EXAMPLES_DIR, J4_EXAMPLE);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(serializeProject(acceptance01Guards()));
  });

  it("garde-corps barreaudé côté vide : aucune violation bloquante, critère n° 1 complet", () => {
    const p = readExample(J4_EXAMPLE);
    const m = buildModel(p);
    expect(m.errors).toEqual([]);
    expect(blocking(m)).toEqual([]);
    // Trémie plus large que l'escalier côté jour : aucun rampant ne traverse la dalle haute.
    expect(results(m, "GC_CONFLIT_DALLE")).toEqual([]);
    // Côté jour vide, côté extérieur le long des murs.
    const guards = m.parts.filter((x) => x.id.startsWith("guard-"));
    expect(guards.some((x) => x.id.startsWith("guard-inner-1-baluster"))).toBe(true);
    expect(guards.some((x) => x.id.startsWith("guard-outer"))).toBe(false);
    expect(guards.some((x) => x.id.startsWith("guard-opening-1-baluster"))).toBe(true);
    // Pièces avec repères, nomenclature (longueur) et main courante balayée.
    for (const part of guards) {
      expect(part.mark).toMatch(/^(PG|BA|MC)\d+$/);
      expect(part.quantities["length_mm"]).toBeGreaterThan(0);
    }
    expect(m.parts.find((x) => x.id === "guard-inner-1-handrail")?.solid.kind).toBe("sweep");
    // Règles de garde-corps et de mains courantes évaluées (régime 2024, date 2026).
    expect(m.compliance.contexts).toContain("garde_corps_2024");
    for (const id of [
      "GC_OBLIGATOIRE",
      "GC_HAUTEUR_RAMPANT_2024",
      "GC_HAUTEUR_2024",
      "GC_GABARIT_T1_2024",
      "GC_GABARIT_T2_2024",
      "GC_GABARIT_B_2024",
      "MC_LOGEMENT",
      "MC_PROLONGEMENT_BHC",
      "MC_EPAISSEUR_MAX",
    ]) {
      expect(
        results(m, id).map((r) => r.status),
        id,
      ).toEqual(["ok"]);
    }
    // Charge horizontale : information seulement (jamais une violation).
    expect(results(m, "CHARGE_GC_HORIZONTALE").map((r) => r.status)).toEqual(["non-evaluee"]);
  });

  it("barreaudage à entraxe trop grand : violation localisée sur un balustre", () => {
    const p = readExample(J4_EXAMPLE);
    const m = buildModel(withGuards(p, { infill: { kind: "balusters", spacing: 200 } }));
    const t1 = results(m, "GC_GABARIT_T1_2024").filter((r) => r.status === "violation");
    expect(t1.length).toBeGreaterThan(0);
    for (const r of t1) {
      expect(r.severity).toBe("bloquant");
      expect(r.location.kind).toBe("part");
      const partId = r.location.kind === "part" ? r.location.partId : "";
      expect(m.parts.find((x) => x.id === partId)?.category).toBe("baluster");
      expect(r.measured).toBeGreaterThanOrEqual(110);
      expect(r.message).toMatch(/entre balustres|sous les balustres/);
    }
  });

  it("lisses horizontales en 2024 : appuis dans la zone du gabarit B → rehausse exigée", () => {
    const p = readExample(J4_EXAMPLE);
    const m = buildModel(withGuards(p, { infill: { kind: "rails", count: 8 } }, "2026-01-15"));
    const b = results(m, "GC_GABARIT_B_2024");
    const bad = b.filter((r) => r.status === "violation");
    expect(bad.length).toBeGreaterThan(0);
    for (const r of bad) {
      expect(r.location.kind).toBe("part");
      const partId = r.location.kind === "part" ? r.location.partId : "";
      expect(m.parts.find((x) => x.id === partId)?.name).toBe("Lisse");
      // H ≥ 1 000 + X avec X ∈ [100 ; 600[.
      expect(r.min).toBeGreaterThanOrEqual(1100);
      expect(r.min).toBeLessThan(1600);
      expect(r.measured).toBeLessThan(r.min!);
    }
    // Même garde-corps à 1 700 mm : la rehausse est satisfaite.
    const high = buildModel(
      withGuards(p, {
        infill: { kind: "rails", count: 12 },
        flight: { height: 1700 },
        opening: { height: 1700 },
      }),
    );
    expect(results(high, "GC_GABARIT_B_2024").every((r) => r.status === "ok")).toBe(true);
  });

  it("régime 1988 ou 2024 selon la date de référence", () => {
    const p = readExample(J4_EXAMPLE);
    const old = buildModel(withGuards(p, p.guards, "2024-03-01"));
    const ids = (m: Model) => new Set(m.compliance.results.map((r) => r.ruleId));
    expect(old.compliance.contexts).toContain("garde_corps_1988");
    expect(ids(old).has("GC_HAUTEUR_RAMPANT_1988")).toBe(true);
    expect(ids(old).has("GC_VIDE_1988_BARREAUX")).toBe(true);
    expect(ids(old).has("GC_GABARIT_T1_2024")).toBe(false);
    // 1988 : garde-corps de trémie de 1 000 mm (palier), barreaudage ≤ 110 mm → conforme.
    expect(blocking(old)).toEqual([]);
    const recent = buildModel(withGuards(p, p.guards, "2025-06-01"));
    expect(recent.compliance.contexts).toContain("garde_corps_2024");
    expect(ids(recent).has("GC_VIDE_1988_BARREAUX")).toBe(false);
    expect(ids(recent).has("GC_GABARIT_B_2024")).toBe(true);
    // Lisses en 1988 : partie basse escaladable (appui sous 450 mm) → violation localisée.
    const rails1988 = buildModel(
      withGuards(p, { infill: { kind: "rails", count: 5 } }, "2024-03-01"),
    );
    const low = results(rails1988, "GC_PARTIE_BASSE_1988").filter((r) => r.status === "violation");
    expect(low.length).toBeGreaterThan(0);
    expect(low[0]!.location.kind).toBe("part");
  });

  it("câbles : traités comme des lisses, avertissement de détente", () => {
    const p = readExample(J4_EXAMPLE);
    const m = buildModel(withGuards(p, { infill: { kind: "cables" } }));
    const slack = results(m, "GC_CABLES_DETENTE");
    expect(slack.length).toBeGreaterThan(0);
    expect(slack.every((r) => r.status === "violation" && r.severity === "avertissement")).toBe(
      true,
    );
    // Contrôlés comme des lisses (gabarit B, T1 / T2).
    expect(results(m, "GC_GABARIT_B_2024").length).toBeGreaterThan(0);
    expect(m.parts.some((x) => x.name === "Câble" && x.material === "stainless-brushed")).toBe(
      true,
    );
  });

  it("sans section guards : aucune pièce de garde-corps, règles non évaluées", () => {
    const m = buildModel(readExample(J3A));
    expect(m.parts.some((x) => x.id.startsWith("guard-"))).toBe(false);
    for (const id of ["GC_OBLIGATOIRE", "MC_LOGEMENT", "GC_GABARIT_T1_2024"]) {
      expect(
        results(m, id).map((r) => r.status),
        id,
      ).toEqual(["non-evaluee"]);
    }
  });

  it("garde-corps désactivé côté vide : GC_OBLIGATOIRE en violation au point de chute", () => {
    const p = readExample(J4_EXAMPLE);
    const m = buildModel(
      withGuards(p, { flight: { enabled: false }, opening: { enabled: false } }),
    );
    const v = results(m, "GC_OBLIGATOIRE").filter((r) => r.status === "violation");
    expect(v.length).toBeGreaterThanOrEqual(2);
    expect(v.every((r) => r.location.kind === "point")).toBe(true);
    expect(v.some((r) => /côté jour/.test(r.message))).toBe(true);
    expect(v.some((r) => /trémie/.test(r.message))).toBe(true);
  });
});
