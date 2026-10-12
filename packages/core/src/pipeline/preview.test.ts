/**
 * Aperçu de l'éditeur de plan (`buildPlanPreview`, ADR-0010, sous-lot 4c) : même tracé, même
 * découpage et mêmes conflits géométriques que le modèle complet (échappée exclue), caches
 * partagés avec `buildModel`, et jamais d'exception (erreurs en `Message`).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { isMessage } from "@blondel/i18n";
import { beforeEach, describe, expect, it } from "vitest";
import { setSectionLength, setSectionWidth } from "../layout/cageEdit.js";
import type { Project } from "../model/project.js";
import { parseProjectText } from "../project/parse.js";
import { createProject } from "../project/presets.js";
import { buildModel, buildPlanPreview, clearModelCache, modelCacheStats } from "./build.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const EXAMPLE_FILES = readdirSync(EXAMPLES_DIR)
  .filter((f) => f.endsWith(".blondel.json"))
  .sort();

function loadExample(file: string): Project {
  return parseProjectText(readFileSync(join(EXAMPLES_DIR, file), "utf8"));
}

beforeEach(() => clearModelCache());

describe("buildPlanPreview", () => {
  it.each(EXAMPLE_FILES)(
    "%s : tracé, découpage et conflits géométriques du modèle complet",
    (f) => {
      const project = loadExample(f);
      const preview = buildPlanPreview(project, { memo: false });
      const model = buildModel(project, { memo: false });
      expect(preview.layout).toEqual(model.layout);
      expect(preview.stepping?.nosings).toEqual(model.stepping.nosings);
      expect(preview.siteFit).toEqual((model.siteFit ?? []).filter((c) => c.kind !== "headroom"));
      expect(preview.siteFit.some((c) => c.kind === "headroom")).toBe(false);
      for (const e of preview.errors) expect(model.errors).toContainEqual(e);
    },
  );

  it("caches partagés : le modèle complet du même projet retrouve le tracé et le découpage de l'aperçu", () => {
    const project = loadExample("cage-60.blondel.json");
    const preview = buildPlanPreview(project);
    const before = modelCacheStats();
    const model = buildModel(project);
    const after = modelCacheStats();
    expect(model.layout).toBe(preview.layout);
    expect(model.stepping).toBe(preview.stepping);
    expect(after.layout.hits - before.layout.hits).toBe(1);
    expect(after.stepping.hits - before.stepping.hits).toBe(1);
    expect(after.siteFit.hits - before.siteFit.hits).toBe(1);
  });

  it("l'aperçu d'un projet déjà calculé ne recalcule rien", () => {
    const project = loadExample("j3a-acceptance-01-bois.blondel.json");
    buildModel(project);
    const before = modelCacheStats();
    buildPlanPreview(project);
    const after = modelCacheStats();
    expect(after.layout.misses).toBe(before.layout.misses);
    expect(after.stepping.misses).toBe(before.stepping.misses);
    expect(after.siteFit.misses).toBe(before.siteFit.misses);
  });

  it("tracé impossible : pas d'exception, erreurs en Message, sans tracé", () => {
    const base = createProject("straight");
    const project: Project = {
      ...base,
      site: { ...base.site, floorToFloor: -100 },
    };
    const preview = buildPlanPreview(project);
    expect(preview.errors.length).toBeGreaterThan(0);
    for (const e of preview.errors) expect(isMessage(e)).toBe(true);
  });

  it("propriété : cage-60 avec mur, poteau et contour de pièce, mêmes conflits que le modèle complet", () => {
    // Le mur M1 de l'e2e de l'éditeur (devant l'arrivée), un poteau sur la première volée et une
    // pièce que la seconde volée allongée dépasse : types `wall`, `arrivalClearance`,
    // `obstacle`, `outsideRoom` (en plus de `slab`) comparés entre aperçu et modèle complet.
    const base = loadExample("cage-60.blondel.json");
    const cage: Project = {
      ...base,
      site: {
        ...base.site,
        walls: [
          {
            id: "M1",
            a: { x: -2050, y: 2199 },
            b: { x: -1050, y: 3931 },
            thickness: 200,
            loadBearing: false,
          },
        ],
        obstacles: [
          {
            kind: "post",
            id: "P1",
            center: { x: 450, y: 1200 },
            sizeX: 100,
            sizeY: 100,
            rotation: 0,
          },
        ],
        room: {
          points: [
            { x: -1600, y: -200 },
            { x: 1100, y: -200 },
            { x: 1100, y: 3600 },
            { x: -1600, y: 3600 },
          ],
        },
      },
    };
    const seen = new Set<string>();
    fc.assert(
      fc.property(
        fc.integer({ min: 300, max: 4000 }),
        fc.integer({ min: 300, max: 4000 }),
        (first, second) => {
          clearModelCache();
          let p = cage;
          const a = setSectionLength(p, 0, first);
          if (a.project) p = a.project;
          const b = setSectionLength(p, 1, second);
          if (b.project) p = b.project;
          const preview = buildPlanPreview(p);
          const model = buildModel(p);
          const expected = (model.siteFit ?? []).filter((c) => c.kind !== "headroom");
          expect(preview.siteFit).toEqual(expected);
          for (const c of preview.siteFit) seen.add(c.kind);
        },
      ),
      // Tirages de bord : longueurs d'origine, seconde volée qui atteint le mur et sort de la pièce.
      {
        numRuns: 60,
        examples: [
          [1650, 1650],
          [1650, 2300],
          [1650, 4000],
        ],
      },
    );
    for (const kind of ["wall", "arrivalClearance", "obstacle", "outsideRoom"]) {
      expect(seen, kind).toContain(kind);
    }
  });

  it("propriété : longueurs et largeurs quelconques d'une cage, jamais d'exception", () => {
    const cage = loadExample("cage-60.blondel.json");
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 }),
        fc.integer({ min: 0, max: 6000 }),
        fc.integer({ min: 100, max: 2000 }),
        (i, length, width) => {
          let p = cage;
          const a = setSectionLength(p, i, length);
          if (a.project) p = a.project;
          const b = setSectionWidth(p, i, { width });
          if (b.project) p = b.project;
          const preview = buildPlanPreview(p);
          for (const e of preview.errors) expect(isMessage(e)).toBe(true);
          if (preview.layout === undefined) expect(preview.errors.length).toBeGreaterThan(0);
          for (const c of preview.siteFit) {
            expect(c.kind).not.toBe("headroom");
            for (const q of c.zone) expect(Number.isFinite(q.x) && Number.isFinite(q.y)).toBe(true);
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});
