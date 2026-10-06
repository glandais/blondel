import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import type { Model } from "../model/derived.js";
import type { Project } from "../model/project.js";
import { parseProjectText } from "../project/parse.js";
import { findRule } from "../rules/table.js";
import { GUARD_EVALUATORS } from "../rules/evaluators/guards.js";
import { stairArb } from "../stepping/test-helpers.js";
import { buildModel, clearModelCache } from "./build.js";
import { computeFigures, footprintOf, GUARD_HEIGHT_RULE_IDS } from "./figures.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");

function loadExample(file: string): Project {
  return parseProjectText(readFileSync(join(EXAMPLES_DIR, file), "utf8"));
}

const figuresOf = (m: Model) => {
  expect(m.figures).toBeDefined();
  return m.figures!;
};

beforeEach(() => clearModelCache());

const EXAMPLE_FILES = readdirSync(EXAMPLES_DIR)
  .filter((f) => f.endsWith(".blondel.json"))
  .sort();

describe("Model.figures — chiffres clés", () => {
  it.each(EXAMPLE_FILES)("%s : chiffres cohérents avec le découpage et les pièces", (file) => {
    const p = loadExample(file);
    const m = buildModel(p);
    const f = figuresOf(m);
    const winders = m.stepping.treads.filter((t) => t.kind === "winder");
    expect(f.minCollet).toBe(
      winders.length > 0 ? Math.min(...winders.map((t) => t.colletChord)) : undefined,
    );
    expect(f.footprint!.x).toBeGreaterThan(0);
    expect(f.footprint!.y).toBeGreaterThan(0);
    expect(f.nosingOverlap).toBe(p.stair.treads.nosing);
    expect(f.guards !== undefined).toBe(p.guards !== undefined);
  });

  it("escalier droit sans balancée : pas de collet mini, emprise et recouvrement présents", () => {
    const p = loadExample("straight.blondel.json");
    const m = buildModel(p);
    expect(m.stepping.treads.some((t) => t.kind === "winder")).toBe(false);
    const f = figuresOf(m);
    expect(f.minCollet).toBeUndefined();
    expect(f.footprint!.x).toBeGreaterThan(0);
    expect(f.footprint!.y).toBeGreaterThan(0);
    // Escalier droit : l'emprise couvre au moins l'emmarchement et le reculement.
    const dims = [f.footprint!.x, f.footprint!.y].sort((a, b) => a - b);
    expect(dims[0]).toBeGreaterThanOrEqual(900 - 1e-6);
    expect(dims[1]).toBeGreaterThanOrEqual(m.stepping.run - 1e-6);
    expect(f.nosingOverlap).toBe(p.stair.treads.nosing);
  });

  it("quart tournant balancé : collet mini = plus petite corde des marches balancées", () => {
    const m = buildModel(loadExample("acceptance-01-quart-tournant.blondel.json"));
    const winders = m.stepping.treads.filter((t) => t.kind === "winder");
    expect(winders.length).toBeGreaterThan(0);
    expect(figuresOf(m).minCollet).toBe(Math.min(...winders.map((t) => t.colletChord)));
  });

  it("hélicoïdal : toutes les marches sont balancées, collet mini présent", () => {
    const m = buildModel(loadExample("j5a-helicoidal.blondel.json"));
    expect(m.stepping.treads.every((t) => t.kind === "winder")).toBe(true);
    expect(figuresOf(m).minCollet).toBe(Math.min(...m.stepping.treads.map((t) => t.colletChord)));
  });

  it("projet sans garde-corps : pas de chiffres de garde-corps", () => {
    const p = loadExample("acceptance-01-quart-tournant.blondel.json");
    expect(p.guards).toBeUndefined();
    expect(figuresOf(buildModel(p)).guards).toBeUndefined();
  });

  it.each(["j4-acceptance-01-garde-corps.blondel.json", "demo-helical-glass.blondel.json"])(
    "%s : lignes, longueur en plan, poteaux, hauteur exigée lue dans le contrôle",
    (file) => {
      const m = buildModel(loadExample(file));
      const g = figuresOf(m).guards!;
      expect(g).toBeDefined();
      expect(g.lines).toBeGreaterThan(0);
      expect(g.length).toBeGreaterThan(0);
      const posts = m.parts.filter((p) => p.family === "guards" && p.category === "post").length;
      expect(g.posts).toBe(posts);
      const mins = m.compliance.results
        .filter((r) => GUARD_HEIGHT_RULE_IDS.includes(r.ruleId) && r.status !== "non-evaluee")
        .map((r) => r.min)
        .filter((v): v is number => typeof v === "number");
      expect(mins.length).toBeGreaterThan(0);
      expect(g.requiredHeight).toBe(Math.max(...mins));
    },
  );

  it("règles de hauteur : chacune a un évaluateur de garde-corps et une entrée de rules.yaml", () => {
    for (const id of GUARD_HEIGHT_RULE_IDS) {
      expect(GUARD_EVALUATORS[id], id).toBeDefined();
      expect(findRule(id), id).toBeDefined();
    }
  });

  it("garde-corps sans règle de hauteur évaluée : hauteur exigée absente", () => {
    const m = buildModel(loadExample("j4-acceptance-01-garde-corps.blondel.json"));
    const f = computeFigures({
      layout: m.layout,
      stepping: m.stepping,
      nosing: 30,
      guards: {
        runs: [],
        parts: [],
      } as unknown as Parameters<typeof computeFigures>[0]["guards"],
      requiredGuardHeight: undefined,
    });
    expect(f.guards).toEqual({ lines: 0, length: 0, posts: 0 });
  });

  it("mémoïsation : projet copié aux mêmes sous-objets → chiffres de même identité", () => {
    const p = loadExample("j4-acceptance-01-garde-corps.blondel.json");
    const a = buildModel(p);
    const b = buildModel({ ...p });
    expect(b.figures).toBe(a.figures);
  });

  it("modèle partiel (tracé impossible) : jamais d'exception, chiffres omis", () => {
    const p = loadExample("straight.blondel.json");
    const broken: Project = {
      ...p,
      stair: { ...p.stair, layout: { ...p.stair.layout, width: -1 } as Project["stair"]["layout"] },
    };
    const m = buildModel(broken);
    expect(m.errors.length).toBeGreaterThan(0);
    expect(m.figures?.minCollet).toBeUndefined();
    expect(m.figures?.footprint).toBeUndefined();
  });

  it("propriété : l'emprise contient les contours de toutes les marches", () => {
    fc.assert(
      fc.property(stairArb(), ({ project }) => {
        const m = buildModel(project, { memo: false });
        const fp = footprintOf(m.layout, m.stepping);
        if (fp === undefined) return;
        const pts = [...m.layout.footprint, ...m.stepping.treads.flatMap((t) => t.outline)];
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        for (const t of m.stepping.treads) {
          for (const q of t.outline) {
            expect(q.x - Math.min(...xs)).toBeLessThanOrEqual(fp.x + 1e-9);
            expect(q.y - Math.min(...ys)).toBeLessThanOrEqual(fp.y + 1e-9);
          }
        }
        expect(fp.x).toBeCloseTo(Math.max(...xs) - Math.min(...xs), 9);
        expect(fp.y).toBeCloseTo(Math.max(...ys) - Math.min(...ys), 9);
        expect(m.figures?.footprint).toEqual(fp);
      }),
      { numRuns: 30 },
    );
  });
});
