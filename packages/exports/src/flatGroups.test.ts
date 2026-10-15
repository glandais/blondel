/**
 * Partition des développés commune au DXF et au PDF (`flatPartGroups`, convention C3 du
 * chantier part-marks R2b).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel, parseProjectText, type Model, type Part } from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { exportPartsDxf } from "./dxf/parts.js";
import { flatPartGroups } from "./flatGroups.js";
import { RecordingCanvas } from "./pdf/canvas.js";
import { renderPdf, type PdfPages } from "./pdf/document.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../examples");
const model: Model = buildModel(
  parseProjectText(readFileSync(join(EXAMPLES_DIR, "cage-60-palier-central.blondel.json"), "utf8")),
  { memo: false },
);
const flats = model.parts.filter((p) => p.flat !== undefined);

const canonical = (groups: readonly { ids: readonly string[] }[]): string[] =>
  groups.map((g) => [...g.ids].sort().join(",")).sort();

/** Copie d'une pièce, développé déplacé d'un bruit `eps` (mm) sur chaque sommet. */
const noisy = (p: Part, id: string, eps: number): Part => ({
  ...p,
  id,
  flat: {
    ...p.flat!,
    outline: {
      outer: p.flat!.outline.outer.map((q, i) => ({ x: q.x + (i % 2 ? eps : -eps), y: q.y + eps })),
      holes: p.flat!.outline.holes.map((h) => h.map((q) => ({ x: q.x - eps, y: q.y }))),
    },
  },
});

const FLATS_ONLY: PdfPages = {
  toc: false,
  plan: false,
  elevation: false,
  installation: false,
  bom: false,
  fasteners: false,
  cutsheet: false,
  compliance: false,
  flats: true,
  templates: false,
};

describe("flatPartGroups (C3) : partition des développés commune au DXF et au PDF", () => {
  it("la partition ne dépend pas de l'ordre des pièces", () => {
    const reference = canonical(flatPartGroups(flats));
    fc.assert(
      fc.property(fc.shuffledSubarray(flats, { minLength: flats.length }), (shuffled) => {
        expect(canonical(flatPartGroups(shuffled))).toEqual(reference);
      }),
      { numRuns: 50 },
    );
  });

  it("un bruit ≤ 1e-7 mm réunit deux développés de même repère ; un écart réel les sépare", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...flats),
        fc.double({ min: -1e-7, max: 1e-7, noNaN: true }),
        (p, eps) => {
          expect(flatPartGroups([p, noisy(p, `${p.id}-bis`, eps)])).toHaveLength(1);
        },
      ),
      { numRuns: 100 },
    );
    const p = flats[0]!;
    expect(flatPartGroups([p, noisy(p, "autre", 0.01)])).toHaveLength(2);
    expect(flatPartGroups([p, { ...noisy(p, "autre", 0), mark: "ZZ1" }])).toHaveLength(2);
  });

  it("DXF et PDF : même partition, bruit d'arrondi compris", () => {
    const twins = flats.slice(0, 6).flatMap((p) => [p, noisy(p, `${p.id}-bis`, 1e-8)]);
    const m: Model = { ...model, parts: twins };
    const dxf = exportPartsDxf(m).map((f) => ({ ids: f.partIds }));
    const pdf = renderPdf(new RecordingCanvas(), m, { pages: FLATS_ONLY })
      .filter((x) => x.kind === "flat")
      .map((x) => ({ ids: x.partIds ?? [] }));
    expect(dxf).toHaveLength(6);
    expect([...new Set(canonical(pdf))]).toEqual(canonical(dxf));
  });
});
