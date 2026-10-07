import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { fr } from "../i18n.test-helpers.js";
import { computeLayout } from "../layout/layout.js";
import type { Model } from "../model/derived.js";
import { ProjectSchema, type Project } from "../model/project.js";
import { parseProjectText } from "../project/parse.js";
import { makeSteppingProject } from "../stepping/test-helpers.js";
import { buildModel, clearModelCache, modelCacheStats } from "./build.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const load = (file: string): Project =>
  parseProjectText(readFileSync(join(EXAMPLES_DIR, file), "utf8"));

const STEEL_FLAT = "j3b-acceptance-01-acier-plat.blondel.json";
const FOLDED = "j3b-acceptance-01-tole-pliee.blondel.json";
const CURVED = "j5b-debillarde-soude.blondel.json";
const WOOD = "j3a-acceptance-01-bois.blondel.json";

/** Toutes les pièces citées existent ; quantités entières > 0 ; identifiants uniques. */
function expectConsistent(m: Model): void {
  const ids = new Set(m.parts.map((p) => p.id));
  for (const f of m.fasteners ?? []) {
    expect(Number.isInteger(f.quantity) && f.quantity > 0).toBe(true);
    for (const id of f.partIds) expect(ids.has(id)).toBe(true);
  }
  expect(new Set((m.fasteners ?? []).map((f) => f.id)).size).toBe(m.fasteners?.length ?? 0);
}

function withStructureParams(p: Project, params: Record<string, unknown>): Project {
  return ProjectSchema.parse({
    ...p,
    stair: {
      ...p.stair,
      structure: { ...p.stair.structure, params: { ...p.stair.structure.params, ...params } },
    },
  });
}

beforeEach(() => clearModelCache());

describe("buildModel — visserie (QUESTIONS A27)", () => {
  it("steel-flat : platines de pied (sol), de tête (chevêtre) et de pied de poteau", () => {
    const m = buildModel(load(STEEL_FLAT));
    expect(m.errors).toEqual([]);
    expectConsistent(m);
    const joints = new Set(m.fasteners?.map((f) => f.joint));
    expect(joints.has("plateFloor")).toBe(true);
    expect(joints.has("plateTrimmer")).toBe(true);
    const foot = m.fasteners!.find(
      (f) => f.id === "fastener-plateFloor-plate-foot-stringer-inner-1",
    );
    expect(foot).toMatchObject({ diameter: 12, kind: "anchor", deduced: ["diameter", "quantity"] });
    // Pas de visserie inventée : chaque élément vient d'une pièce percée ou d'une fixation
    // déclarée.
    for (const f of m.fasteners!) {
      const owner = m.parts.find((p) => f.id === `fastener-${f.joint}-${p.id}`);
      expect(owner?.fixings !== undefined || (owner?.flat?.outline.holes.length ?? 0) > 0).toBe(
        true,
      );
    }
  });

  it("steel-flat vissé : supports boulonnés M10, platines d'about boulonnées", () => {
    const m = buildModel(
      withStructureParams(load(STEEL_FLAT), {
        supports: { fixing: "bolted" },
        newel: { joint: "bolted" },
      }),
    );
    expect(m.errors).toEqual([]);
    expectConsistent(m);
    const supports = m.fasteners!.filter((f) => f.joint === "supportBolted");
    expect(supports.length).toBeGreaterThan(0);
    for (const f of supports) {
      expect(f).toMatchObject({ kind: "bolt", grade: "8.8", diameter: 10 });
      // Support et pièce porteuse (limon ou poteau).
      const cats = f.partIds.map((id) => m.parts.find((p) => p.id === id)!.category).sort();
      expect(cats.length).toBe(2);
      expect(cats).toContain("support");
    }
    const bolted = m.fasteners!.filter((f) => f.joint === "plateBolted");
    expect(bolted.length).toBeGreaterThan(0);
    for (const f of bolted) {
      expect(f.partIds.length).toBeGreaterThanOrEqual(3);
      expect(fr(f.name)).toBe("Boulon M12 × 100, classe 8.8");
    }
    // Vis de marche sous les marches bois.
    expect(m.fasteners!.some((f) => f.joint === "treadScrewed")).toBe(true);
  });

  it("tôle pliée vissée (défaut A31) : contremarche d'arrivée au chevêtre, vis à métaux M8", () => {
    const m = buildModel(load(FOLDED));
    expectConsistent(m);
    const riser = m.fasteners!.find((f) => f.joint === "riserTrimmer")!;
    expect(riser).toMatchObject({ quantity: 3, diameter: 10 });
    expect(fr(riser.origin)).toMatch(/^Contremarche d'arrivée CM\d+ → chevêtre$/);
    expect(m.fasteners!.some((f) => f.joint === "treadScrewed")).toBe(false);
    const screws = m.fasteners!.filter((f) => f.joint === "treadBolted");
    expect(screws.length).toBeGreaterThan(0);
    for (const f of screws) {
      expect(f).toMatchObject({ kind: "machine-screw", grade: "8.8", diameter: 8, length: 20 });
      expect(fr(f.name)).toBe("Vis à métaux M8 × 20, classe 8.8");
      // Support et marche en tôle portée.
      const parts = f.partIds.map((id) => m.parts.find((p) => p.id === id)!);
      expect(parts.map((p) => p.category).sort()).toEqual(["support", "tread"]);
      const tread = parts.find((p) => p.category === "tread")!;
      expect(tread.material).toMatch(/^steel-/);
      // Perçages correspondants dans le développé de la marche.
      expect(tread.flat!.outline.holes.length).toBeGreaterThan(0);
    }
  });

  it("tôle pliée soudée (A31) : ni vis de marche ni perçage dans les marches", () => {
    const base = load(FOLDED);
    const sup = (base.stair.structure.params as { supports?: object }).supports ?? {};
    const m = buildModel(
      withStructureParams(base, { supports: { ...sup, treadFixing: "welded" } }),
    );
    expectConsistent(m);
    expect(m.errors).toEqual([]);
    expect(m.fasteners!.some((f) => f.joint === "treadBolted" || f.joint === "treadScrewed")).toBe(
      false,
    );
    for (const p of m.parts.filter((x) => x.category === "tread"))
      expect(p.flat?.outline.holes ?? []).toEqual([]);
  });

  it("steel-curved : platines de pied et de tête (plateObject)", () => {
    const m = buildModel(load(CURVED));
    expectConsistent(m);
    const joints = m.fasteners!.map((f) => f.joint);
    expect(joints).toContain("plateFloor");
    expect(joints).toContain("plateTrimmer");
  });

  it("steel-central (tube et caisson, droit et quart tournant) : platines chevillées au sol et au chevêtre", () => {
    // La platine d'un caisson est soudée à plusieurs pièces de la poutre (flasques, semelles) :
    // ce ne sont pas des partenaires boulonnés, l'ancrage reste au gros œuvre (A27, A29 n° 5).
    for (const [layout, section] of [
      [{ width: 900, legs: ["auto"] }, "tube"],
      [{ width: 900, legs: ["auto"] }, "box"],
      [{ width: 900, legs: [1800, 2300], direction: "left" }, "box"],
    ] as const) {
      const base = makeSteppingProject(layout as Parameters<typeof makeSteppingProject>[0]);
      const m = buildModel(
        ProjectSchema.parse({
          ...base,
          stair: {
            ...base.stair,
            structure: { kind: "steel-central", params: { section: { kind: section } } },
          },
        }),
      );
      expect(m.errors, section).toEqual([]);
      expectConsistent(m);
      const joints = (m.fasteners ?? []).map((f) => f.joint);
      expect(joints, section).toContain("plateFloor");
      expect(joints, section).toContain("plateTrimmer");
      expect(joints, section).not.toContain("plateBolted");
      const foot = m.fasteners!.find((f) => f.id === "fastener-plateFloor-plate-foot-central");
      expect(foot).toMatchObject({ kind: "anchor", quantity: 4 });
    }
  });

  it("structure bois sans assemblage boulonné ni garde-corps : visserie absente", () => {
    const m = buildModel(load(WOOD));
    expect(m.errors).toEqual([]);
    expect(m.fasteners).toBeUndefined();
  });

  it("garde-corps et main courante murale (mur porteur, puis cloison)", () => {
    const base = makeSteppingProject({ width: 900, legs: ["auto"] });
    const layout = computeLayout(base);
    const outerX = Math.max(...layout.footprint.map((p) => p.x));
    const maxY = Math.max(...layout.footprint.map((p) => p.y));
    const wall = (loadBearing: boolean) => ({
      id: "m",
      a: { x: outerX + 120, y: -100 },
      b: { x: outerX + 120, y: maxY + 100 },
      thickness: 200,
      loadBearing,
    });
    const project = (loadBearing: boolean): Project =>
      ProjectSchema.parse({
        ...base,
        site: { ...base.site, walls: [wall(loadBearing)] },
        guards: { handrail: { wallSides: "both" } },
      });
    const a = buildModel(project(true));
    expect(a.errors).toEqual([]);
    expectConsistent(a);
    expect(a.fasteners!.filter((f) => f.joint === "guardPostStair").length).toBeGreaterThan(0);
    const onWall = a.fasteners!.find((f) => f.joint === "handrailWall")!;
    expect(onWall.quantity % 2).toBe(0);
    expect(fr(onWall.origin)).toMatch(/^Main courante MC\d+ : \d+ supports → mur porteur$/);
    const b = buildModel(project(false));
    expect(b.fasteners!.some((f) => f.joint === "handrailPartition")).toBe(true);
    expect(b.fasteners!.some((f) => f.joint === "handrailWall")).toBe(false);
  });

  it("escalier acier avec garde-corps de rampant : poteaux boulonnés, aucun tire-fond", () => {
    for (const file of [
      "j4-demi-tournant-acier-garde-corps.blondel.json",
      "demo-half-turn-industrial.blondel.json",
    ]) {
      const m = buildModel(load(file));
      expectConsistent(m);
      const posts = m.fasteners!.filter((f) => f.joint.startsWith("guardPostStair"));
      expect(posts.length, file).toBeGreaterThan(0);
      expect(
        posts.every((f) => f.joint === "guardPostStairMetal" && f.kind === "bolt"),
        file,
      ).toBe(true);
      expect(
        m.fasteners!.some((f) => f.kind === "lag-screw"),
        file,
      ).toBe(false);
    }
  });

  it("perçages de 14 et 18 mm : désignations normalisées M12 et M16", () => {
    const m = buildModel(
      withStructureParams(load(STEEL_FLAT), {
        plates: { holeDiameter: 18 },
        supports: { fixing: "bolted", holeDiameter: 14 },
      }),
    );
    expect(m.errors).toEqual([]);
    const deduced = m.fasteners!.filter((f) => f.deduced.includes("diameter"));
    expect(deduced.length).toBeGreaterThan(0);
    const diameters = new Set(deduced.map((f) => f.diameter));
    expect([...diameters].every((d) => d === 12 || d === 16)).toBe(true);
    expect(deduced.find((f) => f.joint === "supportBolted")?.diameter).toBe(12);
    expect(deduced.find((f) => f.joint === "plateFloor")?.diameter).toBe(16);
  });
});

describe("buildModel — visserie : mémoïsation", () => {
  it("projet sans changement des dépendances : même tableau", () => {
    const p = load(STEEL_FLAT);
    const a = buildModel(p);
    const b = buildModel({ ...p, name: `${p.name} bis` });
    expect(b.fasteners).toBe(a.fasteners);
    expect(modelCacheStats().fasteners.hits).toBeGreaterThan(0);
  });

  it("régler la visserie ne recalcule ni la structure ni les garde-corps", () => {
    const base = load("demo-half-turn-industrial.blondel.json");
    const a = buildModel(base);
    const before = modelCacheStats();
    // Seule la visserie du profil d'atelier change (autres sous-objets identiques).
    const q: Project = {
      ...base,
      workshop: {
        ...base.workshop,
        fasteners: { joints: { plateFloor: { kind: "chemical-anchor" } } },
      },
    };
    const b = buildModel(q);
    const after = modelCacheStats();
    expect(after.structure.misses).toBe(before.structure.misses);
    expect(after.guards.misses).toBe(before.guards.misses);
    expect(after.fasteners.misses).toBe(before.fasteners.misses + 1);
    expect(b.parts).toBe(a.parts);
    expect(b.fasteners).not.toBe(a.fasteners);
    expect(b.fasteners!.find((f) => f.joint === "plateFloor")!.kind).toBe("chemical-anchor");
  });
});
