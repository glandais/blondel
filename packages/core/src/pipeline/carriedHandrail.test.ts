/**
 * Main courante portée par la structure (chantier guard-marks, G2b et G2c ; décisions G-Q6,
 * G-Q12, G-Q13) : sur `helical-core` à main courante, la main courante de la structure remplace
 * celle du garde-corps extérieur et celle du mur de ce côté ; une seule pièce, un seul repère,
 * contrôle inchangé et cohérent entre le pipeline et le moteur de règles appelé seul, remarque
 * visible.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { msg, type MessageKey } from "@blondel/i18n";
import { computeGuards } from "../guards/compute.js";
import { computeLayout } from "../layout/layout.js";
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

/** Murs en couronne (48 segments) à 120 mm du bord extérieur, sur `arc` tour, épaisseur 200. */
function ring(d: Json, arc: number): void {
  const layout = computeLayout(parseProjectText(JSON.stringify(d)));
  const xs = layout.footprint.map((q) => q.x);
  const ys = layout.footprint.map((q) => q.y);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const R = Math.max(...layout.footprint.map((q) => Math.hypot(q.x - cx, q.y - cy)));
  const n = 48;
  const r = (R + 120) / Math.cos(Math.PI / n);
  const walls: Json[] = [];
  for (let i = 0; i < n * arc; i++) {
    const a0 = (2 * Math.PI * i) / n;
    const a1 = (2 * Math.PI * (i + 1)) / n;
    walls.push({
      id: `w${i}`,
      a: { x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) },
      b: { x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1) },
      thickness: 200,
      loadBearing: true,
    });
  }
  d["site"].walls = walls;
}

/** `j5a-helicoidal` à garde-corps, entouré de murs, `wallSides` donné. */
const walled = (wallSides: string, enabled: boolean | undefined, arc = 1): Project =>
  helical(enabled, (d) => {
    d["guards"] = { handrail: { wallSides } };
    ring(d, arc);
  });

const CARRIED_NOTE = "guard.note.carriedHandrail";
const carriedNotes = (m: Model) => (m.notes ?? []).filter((n) => n.key === CARRIED_NOTE);

describe("main courante portée par la structure : mur et remarque (G-Q12, G-Q13)", () => {
  it.each([
    ["auto", 1],
    ["both", 1],
    ["outer", 1],
    ["auto", 0.5],
    ["outer", 0.5],
  ] as const)(
    "j5a-helicoidal dans des murs, wallSides %s (arc %s) : pas de main courante murale du côté porté, contrôle inchangé, une remarque",
    (wallSides, arc) => {
      const p = walled(wallSides, undefined, arc);
      const m = build(p);
      expect(m.errors).toEqual([]);
      const hr = handrails(m);
      expect(hr.filter((x) => x.id.startsWith("handrail-wall-outer")).map((x) => x.id)).toEqual([]);
      expect(hr.filter((x) => x.mark === "MC1").map((x) => x.id)).toEqual(["helical-handrail"]);
      expect(
        hr.filter((x) => x.id === "helical-handrail" || /^guard-outer-.*-handrail$/.test(x.id)),
      ).toHaveLength(1);
      // Tronçons muraux extérieurs : rattachés à la pièce de la structure, marqués portés.
      const g = computeGuards(p, m.layout, m.stepping);
      const wallRuns = g.handrails.filter((h) => h.side === "outer" && !h.onGuard);
      expect(wallRuns.length).toBeGreaterThan(0);
      for (const h of wallRuns) {
        expect(h.partId).toBe("helical-handrail");
        expect(h.carried).toBe(true);
      }
      for (const h of g.handrails.filter((x) => x.side === "outer")) expect(h.carried).toBe(true);
      // Aucun support mural sur la main courante de la structure.
      const wallJoints = (m.fasteners ?? []).filter(
        (f) =>
          (f.joint === "handrailWall" || f.joint === "handrailPartition") &&
          f.partIds.includes("helical-handrail"),
      );
      expect(wallJoints).toEqual([]);
      // Contrôle identique à celui du garde-corps et des mains courantes murales (sans
      // main courante portée), sauf le dégagement au mur : aucune main courante n'est fixée au
      // mur extérieur, il n'est pas mesuré sur la main courante de la structure (G-Q15).
      for (const h of wallRuns) expect(h.wallClearance).toBeUndefined();
      const off = build(walled(wallSides, false, arc));
      expect(handrails(off).some((x) => x.id.startsWith("handrail-wall-outer"))).toBe(true);
      const notClearance = (rs: readonly RuleResult[]) =>
        guardRules(rs).filter((r) => r.ruleId !== "MC_DEGAGEMENT_MUR");
      expect(notClearance(m.compliance.results)).toEqual(notClearance(off.compliance.results));
      const clearance = m.compliance.results.filter((r) => r.ruleId === "MC_DEGAGEMENT_MUR");
      for (const r of clearance) {
        expect(r.location.kind === "part" && r.location.partId === "helical-handrail").toBe(false);
      }
      expect(
        off.compliance.results.some(
          (r) =>
            r.ruleId === "MC_DEGAGEMENT_MUR" &&
            r.location.kind === "part" &&
            r.location.partId.startsWith("handrail-wall-outer"),
        ),
      ).toBe(true);
      const ids = new Set(m.parts.map((x) => x.id));
      for (const r of m.compliance.results) {
        if (r.location.kind === "part") expect(ids.has(r.location.partId), r.ruleId).toBe(true);
      }
      // G-Q12 : une remarque, côté extérieur ; aucune sans main courante portée.
      expect(carriedNotes(m)).toHaveLength(1);
      expect(carriedNotes(m)[0]).toEqual(
        msg("guard.note.carriedHandrail", { side: msg("guard.side.outer") }),
      );
      expect(carriedNotes(off)).toEqual([]);
      // Les remarques des garde-corps passent dans le modèle telles quelles.
      expect(g.notes.filter((n) => n.key === CARRIED_NOTE)).toHaveLength(1);
    },
    60_000,
  );

  it.each(["inner", "none"] as const)(
    "wallSides %s : aucune main courante murale extérieure, comme avant",
    (wallSides) => {
      const m = build(walled(wallSides, undefined));
      const off = build(walled(wallSides, false));
      for (const x of [m, off]) {
        expect(handrails(x).some((q) => q.id.startsWith("handrail-wall-outer"))).toBe(false);
      }
      expect(guardRules(m.compliance.results)).toEqual(guardRules(off.compliance.results));
      // Garde-corps de rampant porté : la remarque reste.
      expect(carriedNotes(m)).toHaveLength(1);
    },
    60_000,
  );

  it("main courante de la structure désactivée, ou structure en échec : mains courantes murales rendues, pas de remarque", () => {
    const off = build(walled("auto", false));
    expect(handrails(off).some((x) => x.id.startsWith("handrail-wall-outer"))).toBe(true);
    expect(carriedNotes(off)).toEqual([]);
    const failed = build(
      helical(true, (d) => {
        d["guards"] = { handrail: { wallSides: "auto" } };
        d["stair"].structure.params.handrail = { enabled: true, radiusOffset: -100000 };
        ring(d, 1);
      }),
    );
    expect(failed.errors.map((e) => e.key)).toContain("structure.helicalCore.error.handrailRadius");
    expect(handrails(failed).some((x) => x.id.startsWith("handrail-wall-outer"))).toBe(true);
    expect(handrails(failed).some((x) => x.id === "helical-handrail")).toBe(false);
    expect(carriedNotes(failed)).toEqual([]);
  });

  it("sans mur : la remarque est émise (garde-corps de rampant porté)", () => {
    const m = build(helical());
    expect(helical().site.walls ?? []).toEqual([]);
    expect(carriedNotes(m)).toHaveLength(1);
    expect(carriedNotes(build(helical(false)))).toEqual([]);
  });

  it("côté porté sans garde-corps ni main courante murale : pas de remarque (G-Q12)", () => {
    // `demo-cage-room`, `wallSides: none` : le côté extérieur est tout en murs, aucun tronçon
    // (ni rampant ni mural) ; le côté intérieur garde son garde-corps.
    const p = example("demo-cage-room", (d) => {
      d["guards"] = { ...(d["guards"] ?? {}), handrail: { wallSides: "none" } };
    });
    const m = build(p);
    const carriedOn = (side: "inner" | "outer") =>
      computeGuards(p, m.layout, m.stepping, {
        carried: [{ side, partId: "structure-handrail", mark: "MC1" }],
      });
    const outer = carriedOn("outer");
    expect(outer.handrails.some((h) => h.side === "outer")).toBe(false);
    expect(outer.notes.filter((n) => n.key === CARRIED_NOTE)).toEqual([]);
    // Contrôle : du côté intérieur, garde-corps de rampant porté, remarque émise.
    const inner = carriedOn("inner");
    expect(inner.handrails.some((h) => h.side === "inner" && h.carried)).toBe(true);
    expect(inner.notes.filter((n) => n.key === CARRIED_NOTE)).toEqual([
      msg("guard.note.carriedHandrail", { side: msg("guard.side.inner") }),
    ]);
  });

  it("exemples : aucune remarque de main courante portée (aucun n'en a avec garde-corps)", () => {
    const names = readdirSync(EXAMPLES_DIR)
      .filter((f) => f.endsWith(".blondel.json"))
      .map((f) => f.slice(0, -".blondel.json".length));
    expect(names.length).toBeGreaterThan(10);
    for (const name of names) {
      expect(carriedNotes(build(example(name))), name).toEqual([]);
    }
  }, 120_000);
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
