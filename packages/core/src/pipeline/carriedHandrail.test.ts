/**
 * Main courante portée par la structure (chantier guard-marks, G2b ; décision G-Q6) : sur
 * `helical-core` à main courante, la main courante de la structure remplace celle du garde-corps
 * extérieur ; une seule pièce, un seul repère, contrôle inchangé et cohérent entre le pipeline et
 * le moteur de règles appelé seul.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import type { MessageKey } from "@blondel/i18n";
import { computeGuards } from "../guards/compute.js";
import type { Model, Part, RuleResult } from "../model/derived.js";
import type { StructureKind } from "../model/plugins.js";
import type { Project } from "../model/project.js";
import { parseProjectText } from "../project/parse.js";
import { evaluateCompliance } from "../rules/engine.js";
import {
  registerStructure,
  structureCarriedHandrails,
  unregisterStructure,
} from "../structures/index.js";
import { buildModel } from "./build.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");

type Json = Record<string, any>;

function example(name: string, patch: (d: Json) => void = () => {}): Project {
  const d = JSON.parse(readFileSync(join(EXAMPLES_DIR, `${name}.blondel.json`), "utf8")) as Json;
  patch(d);
  return parseProjectText(JSON.stringify(d));
}

/** `j5a-helicoidal` avec garde-corps par défaut ; main courante de la structure `enabled`. */
const helical = (enabled?: boolean, extra: (d: Json) => void = () => {}): Project =>
  example("j5a-helicoidal", (d) => {
    d["guards"] = {};
    if (enabled !== undefined) d["stair"].structure.params.handrail = { enabled };
    extra(d);
  });

const build = (p: Project): Model => buildModel(p, { memo: false });
const handrails = (m: Model): Part[] => m.parts.filter((p) => p.category === "handrail");
/** Règles des garde-corps et mains courantes, sans localisation. */
const guardRules = (rs: readonly RuleResult[]) =>
  rs
    .filter((r) => /^(GC|MC)_/.test(r.ruleId))
    .map((r) => ({
      ruleId: r.ruleId,
      status: r.status,
      measured: r.measured,
      min: r.min,
      max: r.max,
    }));

describe("main courante portée par la structure (G-Q6)", () => {
  it("j5a-helicoidal + garde-corps : une seule main courante extérieure (MC1), trémie en MC2", () => {
    const m = build(helical());
    expect(m.errors).toEqual([]);
    const hr = handrails(m);
    expect(hr.map((p) => [p.id, p.mark])).toEqual(
      expect.arrayContaining([
        ["helical-handrail", "MC1"],
        ["guard-opening-1-handrail", "MC2"],
      ]),
    );
    expect(hr.some((p) => /^guard-outer-.*-handrail$/.test(p.id))).toBe(false);
    // Côté extérieur : une seule pièce de main courante.
    expect(
      hr.filter((p) => p.id === "helical-handrail" || p.id.startsWith("guard-outer")),
    ).toHaveLength(1);
    // Aucun repère porté par deux familles (structure / garde-corps).
    const families = new Map<string, Set<string>>();
    for (const p of m.parts) {
      const s = families.get(p.mark) ?? new Set();
      s.add(p.family ?? "");
      families.set(p.mark, s);
    }
    expect([...families].filter(([, s]) => s.size > 1).map(([mark]) => mark)).toEqual([]);
    // Lignes et mains courantes extérieures : la pièce de la structure.
    const g = computeGuards(helical(), m.layout, m.stepping);
    const outerRuns = g.runs.filter((r) => r.side === "outer");
    expect(outerRuns.length).toBeGreaterThan(0);
    for (const r of outerRuns) {
      expect(r.handrailPartId).toBe("helical-handrail");
      expect(r.primaryPartId).toBe("helical-handrail");
    }
    const outerHandrails = g.handrails.filter((h) => h.side === "outer");
    expect(outerHandrails.length).toBeGreaterThan(0);
    for (const h of outerHandrails) expect(h.partId).toBe("helical-handrail");
    // Toute localisation du contrôle désigne une pièce du modèle.
    const ids = new Set(m.parts.map((p) => p.id));
    for (const r of m.compliance.results) {
      if (r.location.kind === "part") expect(ids.has(r.location.partId), r.ruleId).toBe(true);
    }
  });

  it("contrôle des garde-corps et mains courantes inchangé (statut, mesure, bornes)", () => {
    const on = build(helical());
    const off = build(helical(false));
    expect(handrails(off).some((p) => p.id === "guard-outer-1-handrail")).toBe(true);
    expect(handrails(off).some((p) => p.id === "helical-handrail")).toBe(false);
    expect(guardRules(on.compliance.results)).toEqual(guardRules(off.compliance.results));
  });

  it("moteur de règles appelé seul (garde-corps recalculés) : mêmes résultats que le pipeline", () => {
    const p = helical();
    const m = build(p);
    const alone = evaluateCompliance({ project: p, layout: m.layout, stepping: m.stepping });
    const pick = (rs: readonly RuleResult[]) =>
      rs
        .filter((r) => /^(GC|MC)_/.test(r.ruleId))
        .map((r) => ({ id: r.ruleId, status: r.status, measured: r.measured, at: r.location }));
    expect(pick(alone.results)).toEqual(pick(m.compliance.results));
    expect(pick(alone.results).some((r) => JSON.stringify(r.at).includes("helical-handrail"))).toBe(
      true,
    );
  });

  it("main courante de la structure désactivée (comme demo-helical-*) : le garde-corps garde la sienne", () => {
    const m = build(helical(false));
    expect(handrails(m).map((p) => [p.id, p.mark])).toEqual(
      expect.arrayContaining([
        ["guard-outer-1-handrail", "MC1"],
        ["guard-opening-1-handrail", "MC2"],
      ]),
    );
  });

  it("paramètres de structure invalides : le garde-corps garde sa main courante, erreur de structure", () => {
    const p = helical(undefined, (d) => {
      d["stair"].structure.params.handrail = { diameter: -5 };
    });
    expect(structureCarriedHandrails(p)).toEqual([]);
    const m = build(p);
    expect(m.errors.length).toBeGreaterThan(0);
    expect(handrails(m).some((x) => x.id === "guard-outer-1-handrail")).toBe(true);
    expect(handrails(m).some((x) => x.id === "helical-handrail")).toBe(false);
  });

  it("structure en échec (rayon de main courante impossible) : le garde-corps garde sa main courante, contrôle sur des pièces du modèle", () => {
    const p = helical(true, (d) => {
      d["stair"].structure.params.handrail = { enabled: true, radiusOffset: -100000 };
    });
    // La structure annonce sa main courante, mais ne la produit pas.
    expect(structureCarriedHandrails(p)).toHaveLength(1);
    const m = build(p);
    expect(m.errors.map((e) => e.key)).toContain("structure.helicalCore.error.handrailRadius");
    const hr = handrails(m);
    expect(hr.some((x) => x.id === "helical-handrail")).toBe(false);
    // Sans réservation : repères comme sans main courante portée.
    expect(hr.map((x) => [x.id, x.mark])).toEqual(
      expect.arrayContaining([
        ["guard-outer-1-handrail", "MC1"],
        ["guard-opening-1-handrail", "MC2"],
      ]),
    );
    const ids = new Set(m.parts.map((x) => x.id));
    for (const r of m.compliance.results) {
      if (r.location.kind === "part") expect(ids.has(r.location.partId), r.ruleId).toBe(true);
    }
    // Contrôle des garde-corps identique à celui d'une structure sans main courante portée.
    expect(guardRules(m.compliance.results)).toEqual(
      guardRules(build(helical(false)).compliance.results),
    );
    // Mémoïsé (comme le worker) : même résultat, et retour au cas nominal.
    expect(handrails(buildModel(p)).map((x) => x.id)).toContain("guard-outer-1-handrail");
    expect(handrails(buildModel(helical(true))).map((x) => x.id)).not.toContain(
      "guard-outer-1-handrail",
    );
  });

  it("demo-helical-well à main courante de structure : l'extérieur porte celle de la structure, le jour garde la sienne", () => {
    const m = build(
      example("demo-helical-well", (d) => {
        d["stair"].structure.params.handrail = { enabled: true };
      }),
    );
    expect(m.errors).toEqual([]);
    const hr = handrails(m);
    expect(hr.find((x) => x.id === "helical-handrail")?.mark).toBe("MC1");
    expect(hr.some((x) => /^guard-inner-.*-handrail$/.test(x.id))).toBe(true);
    expect(hr.some((x) => /^guard-outer-.*-handrail$/.test(x.id))).toBe(false);
    expect(hr.filter((x) => x.mark === "MC1").map((x) => x.id)).toEqual(["helical-handrail"]);
  });

  it("capacité carriedHandrails qui lève : buildModel ne lève pas, aucune main courante portée", () => {
    const throwing: StructureKind<{ a: number }> = {
      kind: "test-throwing",
      labelKey: "test.throwing" as MessageKey,
      family: "metal",
      paramsSchema: z.object({ a: z.number().default(1) }),
      defaults: () => ({ a: 1 }),
      build: () => ({ parts: [], checks: [], notes: [] }),
      capabilities: {
        carriedHandrails: () => {
          throw new Error("boom");
        },
      },
    };
    registerStructure(throwing);
    try {
      const p = example("demo-straight-loft", (d) => {
        d["stair"].structure = { kind: "test-throwing", params: {} };
      });
      expect(structureCarriedHandrails(p)).toEqual([]);
      expect(() => build(p)).not.toThrow();
    } finally {
      unregisterStructure("test-throwing");
    }
  });

  it("mémoïsation : basculer handrail.enabled retire puis rend la main courante du garde-corps", () => {
    // Projets à partage structurel (comme le worker) : seule la structure change.
    const on = helical(true);
    const toggled = (enabled: boolean): Project => ({
      ...on,
      stair: {
        ...on.stair,
        structure: {
          ...on.stair.structure,
          params: { ...on.stair.structure.params, handrail: { enabled } },
        },
      },
    });
    const off = toggled(false);
    const ids = (p: Project) => handrails(buildModel(p)).map((x) => x.id);
    expect(ids(on)).not.toContain("guard-outer-1-handrail");
    expect(ids(off)).toContain("guard-outer-1-handrail");
    expect(ids(toggled(true))).not.toContain("guard-outer-1-handrail");
  });
});

describe("structureCarriedHandrails", () => {
  it("none, plugin inconnu, structure sans déclaration : aucune", () => {
    const withKind = (kind: string) =>
      example("j5a-helicoidal", (d) => {
        d["stair"].structure = { kind, params: {} };
      });
    expect(structureCarriedHandrails(withKind("none"))).toEqual([]);
    expect(structureCarriedHandrails(withKind("inconnue"))).toEqual([]);
    expect(structureCarriedHandrails(withKind("steel-central"))).toEqual([]);
    expect(structureCarriedHandrails(withKind("helical-core"))).toEqual([
      { side: "outer", partId: "helical-handrail", mark: "MC1" },
    ]);
  });

  it("tracé non accepté, cage saisie refusée : aucune", () => {
    const carrying: StructureKind<{ a: number }> = {
      kind: "test-carrying",
      labelKey: "test.carrying" as MessageKey,
      family: "metal",
      paramsSchema: z.object({ a: z.number().default(1) }),
      defaults: () => ({ a: 1 }),
      build: () => ({ parts: [], checks: [], notes: [] }),
      capabilities: {
        carriedHandrails: () => [{ side: "inner", partId: "x", mark: "MC9" }],
      },
    };
    registerStructure(carrying);
    try {
      const on = (name: string) =>
        example(name, (d) => {
          d["stair"].structure = { kind: "test-carrying", params: {} };
        });
      // Volées : acceptées (défaut `["flights"]`).
      expect(structureCarriedHandrails(on("demo-straight-loft"))).toEqual([
        { side: "inner", partId: "x", mark: "MC9" },
      ]);
      // Hélicoïdal : tracé non accepté.
      expect(structureCarriedHandrails(on("j5a-helicoidal"))).toEqual([]);
      // Cage saisie : refusée (pas de `capabilities.cage`).
      expect(structureCarriedHandrails(on("cage-60"))).toEqual([]);
    } finally {
      unregisterStructure("test-carrying");
    }
  });
});
