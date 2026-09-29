import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ComplianceReport, Part, RuleResult } from "../model/derived.js";
import type { StructureKind } from "../model/plugins.js";
import type { Project } from "../model/project.js";
import { makeSteppingProject } from "../stepping/test-helpers.js";
import { registerStructure, unregisterStructure } from "../structures/index.js";
import { QUANTITY_MASS_KG, QUANTITY_VOLUME_M3 } from "../structures/quantities.js";
import { buildModel, clearModelCache, mergeStructureChecks, modelCacheStats } from "./build.js";

const base = makeSteppingProject({ width: 900, legs: ["auto"] });
const withKind = (p: Project, kind: string, params: Record<string, unknown> = {}): Project => ({
  ...p,
  stair: { ...p.stair, structure: { kind, params } },
});

const result = (
  ruleId: string,
  status: RuleResult["status"],
  severity: RuleResult["severity"] = "avertissement",
): RuleResult => ({
  ruleId,
  description: ruleId,
  status,
  severity,
  declaredSeverity: severity,
  location: { kind: "stair" },
  nature: "metier",
  confidence: "faible",
  source: "essai",
  secondarySource: false,
  message: ruleId,
});

beforeEach(() => clearModelCache());

describe("pipeline — plugins de structure", () => {
  const seen: unknown[] = [];
  const probe: StructureKind<{ size: number; label: string }> = {
    kind: "test-probe",
    label: "Sonde",
    family: "bois",
    paramsSchema: z.object({ size: z.number().int().positive(), label: z.string() }),
    defaults: () => ({ size: 10, label: "défaut" }),
    build: (ctx, params) => {
      seen.push(params);
      const tread = ctx.baseParts!.find((p) => p.id === "tread-1")!;
      const extra: Part = {
        ...tread,
        id: "probe-1",
        mark: "S1",
        category: "support",
        name: "Sonde",
      };
      return {
        parts: [{ ...tread, name: "Marche remplacée" }, extra],
        checks: [result("LIMON_EPAISSEUR_MIN_DTU", "violation"), result("FAB_PROBE", "ok")],
        notes: ["note de la sonde"],
        errors: ["erreur de la sonde"],
      };
    },
  };
  const failing: StructureKind<Record<string, never>> = {
    kind: "test-failing",
    label: "Échec",
    family: "bois",
    paramsSchema: z.object({}),
    defaults: () => ({}),
    build: () => {
      throw new Error("boum");
    },
  };

  const nested: StructureKind<{ sub: { a: number; b: number } }> = {
    kind: "test-nested",
    label: "Imbriqué",
    family: "bois",
    // Sous-objet sans défaut dans le schéma : les défauts viennent de `defaults(ctx)`.
    paramsSchema: z.object({ sub: z.object({ a: z.number(), b: z.number() }) }),
    defaults: () => ({ sub: { a: 1, b: 2 } }),
    build: (_ctx, params) => {
      seen.push(params);
      return { parts: [], checks: [], notes: [] };
    },
  };

  beforeEach(() => {
    registerStructure(nested, { replace: true });
    registerStructure(probe, { replace: true });
    registerStructure(failing, { replace: true });
    seen.length = 0;
  });
  afterEach(() => {
    unregisterStructure(nested.kind);
    unregisterStructure(probe.kind);
    unregisterStructure(failing.kind);
  });

  it("défauts surchargés par le projet, pièces remplacées par id ou ajoutées, contrôles et messages fusionnés", () => {
    const m = buildModel(withKind(base, "test-probe", { label: "projet" }));
    expect(seen).toEqual([{ size: 10, label: "projet" }]);
    expect(m.parts.find((p) => p.id === "tread-1")!.name).toBe("Marche remplacée");
    expect(m.parts.filter((p) => p.id === "tread-1")).toHaveLength(1);
    expect(m.parts.at(-1)!.id).toBe("probe-1");
    expect(m.notes).toContain("note de la sonde");
    expect(m.errors).toContain("erreur de la sonde");
    const thick = m.compliance.results.filter((r) => r.ruleId === "LIMON_EPAISSEUR_MIN_DTU");
    expect(thick.map((r) => r.status)).toEqual(["violation"]);
    expect(m.compliance.results.at(-1)!.ruleId).toBe("FAB_PROBE");
    expect(m.compliance.summary.avertissement).toBeGreaterThanOrEqual(1);
  });

  it("paramètres refusés par le schéma du plugin : erreur, pièces de base", () => {
    const m = buildModel(withKind(base, "test-probe", { size: -1 }));
    expect(m.errors.join(" ")).toMatch(/test-probe.*paramètres invalides.*size/);
    expect(seen).toEqual([]);
    expect(m.parts.some((p) => p.category === "tread")).toBe(true);
  });

  it("exception du plugin : erreur interne, aucune exception", () => {
    const m = buildModel(withKind(base, "test-failing"));
    expect(m.errors.join(" ")).toMatch(/Structure : erreur interne \(boum\)/);
    expect(m.parts.length).toBeGreaterThan(0);
    // Relecture : les pièces de base de repli portent aussi les grandeurs normalisées.
    for (const p of m.parts) expect(p.quantities[QUANTITY_VOLUME_M3], p.id).toBeGreaterThan(0);
  });

  it("paramètres imbriqués partiels : fusion profonde avec les défauts du plugin (relecture)", () => {
    const m = buildModel(withKind(base, "test-nested", { sub: { a: 5 } }));
    expect(m.errors).toEqual([]);
    expect(seen).toEqual([{ sub: { a: 5, b: 2 } }]);
  });

  it("mémoïsation de l'étape structure", () => {
    const p = withKind(base, "test-probe");
    buildModel(p);
    buildModel({ ...p, name: "autre nom" });
    expect(seen).toHaveLength(1);
    expect(modelCacheStats().structure.hits).toBeGreaterThanOrEqual(1);
  });

  it("structure `none` : grandeurs normalisées sur les pièces bois de base", () => {
    const m = buildModel(base);
    for (const p of m.parts) {
      expect(p.quantities[QUANTITY_VOLUME_M3]).toBeCloseTo(p.quantities["volume"]!, 12);
      expect(p.quantities[QUANTITY_MASS_KG]).toBeGreaterThan(0);
    }
  });
});

describe("mergeStructureChecks", () => {
  const report: ComplianceReport = {
    rulesVersion: 1,
    contexts: [],
    profile: "strict",
    results: [
      result("A", "ok"),
      result("LIMON_EPAISSEUR_MIN_DTU", "non-evaluee"),
      result("B", "violation", "bloquant"),
    ],
    summary: { bloquant: 1, avertissement: 0, conseil: 0 },
  };

  it("remplace à sa place la règle de rules.yaml, ajoute les contrôles propres, recalcule la synthèse", () => {
    const merged = mergeStructureChecks(report, [
      result("LIMON_EPAISSEUR_MIN_DTU", "violation"),
      result("LIMON_EPAISSEUR_MIN_DTU", "ok"),
      result("FAB_X", "violation", "conseil"),
    ]);
    expect(merged.results.map((r) => `${r.ruleId}:${r.status}`)).toEqual([
      "A:ok",
      "LIMON_EPAISSEUR_MIN_DTU:violation",
      "LIMON_EPAISSEUR_MIN_DTU:ok",
      "B:violation",
      "FAB_X:violation",
    ]);
    expect(merged.summary).toEqual({ bloquant: 1, avertissement: 1, conseil: 1 });
    expect(mergeStructureChecks(report, [])).toBe(report);
  });
});
