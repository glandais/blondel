/**
 * Liste et fiche de débit : regroupement des pièces de même repère au bruit d'arrondi près
 * (chantier `stable-tiebreaks`, S2, point 2). Une copie bruitée (≤ 1e-9 mm sur les cotes,
 * 1e-12 en relatif sur volume et masse) rejoint la ligne de sa pièce ; un débit réellement
 * différent (≥ 1e-5 mm) reste sur sa propre ligne, jamais fusionné en silence.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel, parseProjectText, type Part } from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cutSheet } from "../cutsheet.js";
import { treadPart } from "../testing/fixtures.js";
import { cutListRows, QUANTITY_MASS_KG, QUANTITY_VOLUME } from "./cutlist.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");

interface Spec {
  readonly mark: string;
  readonly length: number;
  readonly width: number;
  readonly thickness: number;
  readonly copies: number;
}

/** Pièce de débit : cotes entières, volume et masse dérivés (bois : groupe par épaisseur). */
function partOf(s: Spec, id: string, noise: { mm: readonly number[]; rel: number }): Part {
  const base = treadPart(1, s.mark);
  const length = s.length + noise.mm[0]!;
  const width = s.width + noise.mm[1]!;
  const thickness = s.thickness + noise.mm[2]!;
  const volume = ((s.length * s.width * s.thickness) / 1e9) * (1 + noise.rel);
  const { flat: _flat, ...rest } = base;
  return {
    ...rest,
    id,
    stock: { length, width, thickness },
    quantities: { [QUANTITY_VOLUME]: volume, [QUANTITY_MASS_KG]: volume * 700 * (1 - noise.rel) },
  };
}

const specs = fc
  .uniqueArray(
    fc.record({
      mark: fc.integer({ min: 1, max: 40 }).map((n) => `M${n}`),
      length: fc.integer({ min: 100, max: 4000 }),
      width: fc.integer({ min: 20, max: 600 }),
      thickness: fc.integer({ min: 10, max: 60 }),
      copies: fc.integer({ min: 1, max: 4 }),
    }),
    { minLength: 1, maxLength: 8, selector: (s) => s.mark },
  )
  .map((list): Spec[] => list);

const noiseArb = fc.record({
  mm: fc.array(fc.double({ min: -1e-9, max: 1e-9, noNaN: true }), {
    minLength: 3,
    maxLength: 3,
  }),
  rel: fc.double({ min: -1e-12, max: 1e-12, noNaN: true }),
});

/** Pièces : `copies` exemplaires bruités de chaque spécification, ordre mélangé. */
const noisyParts = fc
  .tuple(
    specs,
    fc.array(noiseArb, { minLength: 32, maxLength: 32 }),
    fc.array(fc.nat(), { minLength: 32, maxLength: 32 }),
  )
  .map(([list, noises, order]) => {
    const parts: Part[] = [];
    let n = 0;
    for (const s of list)
      for (let c = 0; c < s.copies; c++) {
        parts.push(partOf(s, `${s.mark}-${c}`, noises[n % noises.length]!));
        n++;
      }
    const shuffled = parts
      .map((p, i) => ({ p, k: order[i % order.length]! * 64 + i }))
      .sort((a, b) => a.k - b.k)
      .map((e) => e.p);
    return { list, parts: shuffled };
  });

describe("liste de débit : regroupement au bruit près", () => {
  it("copies bruitées : une ligne par repère, quantité et cotes conservées", () => {
    fc.assert(
      fc.property(noisyParts, ({ list, parts }) => {
        const rows = cutListRows(parts);
        expect(rows).toHaveLength(list.length);
        for (const s of list) {
          const r = rows.filter((x) => x.mark === s.mark);
          expect(r).toHaveLength(1);
          expect(r[0]!.quantity).toBe(s.copies);
          expect(Math.abs(r[0]!.length! - s.length)).toBeLessThanOrEqual(1e-6);
          expect(Math.abs(r[0]!.width! - s.width)).toBeLessThanOrEqual(1e-6);
          expect(Math.abs(r[0]!.thickness! - s.thickness)).toBeLessThanOrEqual(1e-6);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("débit réellement différent (≥ 1e-5 mm) : deux lignes, jamais fusionnées", () => {
    fc.assert(
      fc.property(
        specs,
        fc.double({ min: 1e-5, max: 50, noNaN: true }),
        fc.constantFrom(0, 1, 2),
        (list, gap, axis) => {
          const zero = { mm: [0, 0, 0], rel: 0 };
          const s = list[0]!;
          const mm = [0, 0, 0];
          mm[axis] = gap;
          const parts = [partOf(s, "a", zero), partOf(s, "b", { mm, rel: 0 })];
          expect(cutListRows(parts).map((r) => r.quantity)).toEqual([1, 1]);
          const lines = cutSheet(parts).flatMap((g) => g.rows);
          expect(lines.map((r) => r.quantity)).toEqual([1, 1]);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("masse réellement différente (1e-6 en relatif) : deux lignes", () => {
    const s: Spec = { mark: "M1", length: 1000, width: 300, thickness: 40, copies: 2 };
    const a = partOf(s, "a", { mm: [0, 0, 0], rel: 0 });
    const b = partOf(s, "b", { mm: [0, 0, 0], rel: 0 });
    const heavier: Part = {
      ...b,
      quantities: {
        ...b.quantities,
        [QUANTITY_MASS_KG]: b.quantities[QUANTITY_MASS_KG]! * (1 + 1e-6),
      },
    };
    expect(cutListRows([a, heavier]).map((r) => r.quantity)).toEqual([1, 1]);
    expect(cutSheet([a, heavier]).flatMap((g) => g.rows.map((r) => r.quantity))).toEqual([1, 1]);
    expect(cutListRows([a, b]).map((r) => r.quantity)).toEqual([2]);
  });
});

describe("fiche de débit : regroupement au bruit près", () => {
  it("copies bruitées : une ligne par repère, quantité et dimensions conservées", () => {
    fc.assert(
      fc.property(noisyParts, ({ list, parts }) => {
        const rows = cutSheet(parts).flatMap((g) => g.rows);
        expect(rows).toHaveLength(list.length);
        for (const s of list) {
          const r = rows.filter((x) => x.mark === s.mark);
          expect(r).toHaveLength(1);
          expect(r[0]!.quantity).toBe(s.copies);
          expect(Math.abs(r[0]!.length! - s.length)).toBeLessThanOrEqual(1e-6);
          expect(Math.abs(r[0]!.width! - s.width)).toBeLessThanOrEqual(1e-6);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe("cas réel figé : cage-45-palier-acier", () => {
  it("CR1 (cornières sous M1 à M8) sur une seule ligne de quantité 8, liste et fiche", () => {
    const project = parseProjectText(
      readFileSync(join(EXAMPLES_DIR, "cage-45-palier-acier.blondel.json"), "utf8"),
    );
    const model = buildModel(project, { memo: false });
    const rows = cutListRows(model.parts).filter((r) => r.mark === "CR1");
    expect(rows.map((r) => r.quantity)).toEqual([8]);
    const sheet = cutSheet(model.parts)
      .flatMap((g) => g.rows)
      .filter((r) => r.mark === "CR1");
    expect(sheet.map((r) => r.quantity)).toEqual([8]);
  });
});
