import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  TEXTURE_KINDS,
  TEXTURE_TILE,
  allocateTexture,
  fbm,
  fillRows,
  generateTexture,
  valueNoise,
  type TextureData,
} from "./proceduralTextures.js";

const SIZE = 64;

/** Écart moyen de luminance entre deux colonnes (x1, x2) ou deux lignes. */
function meanDiff(d: TextureData, a: (i: number) => number, b: (i: number) => number): number {
  let sum = 0;
  for (let i = 0; i < d.size; i++) {
    const ka = a(i);
    const kb = b(i);
    for (let c = 0; c < 3; c++) sum += Math.abs(d.color[ka + c]! - d.color[kb + c]!);
  }
  return sum / (3 * d.size);
}

describe("textures procédurales", () => {
  it("bruits périodiques : valeur identique à une période près, dans [0, 1)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 50, noNaN: true }),
        fc.double({ min: 0, max: 50, noNaN: true }),
        fc.integer({ min: 1, max: 32 }),
        fc.integer({ min: 1, max: 32 }),
        fc.integer({ min: 0, max: 1000 }),
        (x, y, px, py, seed) => {
          const v = valueNoise(x, y, px, py, seed);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(1);
          expect(valueNoise(x + px, y + py, px, py, seed)).toBeCloseTo(v, 9);
          const f = fbm(x / 50, y / 50, px, py, 3, seed);
          expect(fbm(x / 50 + 1, y / 50 + 1, px, py, 3, seed)).toBeCloseTo(f, 6);
        },
      ),
    );
  });

  it.each(TEXTURE_KINDS)("%s : déterministe, opaque, raccord sans couture", (kind) => {
    const a = generateTexture(kind, SIZE);
    const b = generateTexture(kind, SIZE);
    expect(a.color).toEqual(b.color);
    expect(a.color.length).toBe(SIZE * SIZE * 4);
    for (let k = 3; k < a.color.length; k += 4) expect(a.color[k]).toBe(255);
    const row = (y: number) => (x: number) => 4 * (y * SIZE + x);
    const col = (x: number) => (y: number) => 4 * (y * SIZE + x);
    // Raccord : l'écart entre la dernière et la première colonne (ligne) reste du même ordre que
    // l'écart entre deux colonnes (lignes) voisines intérieures.
    let inner = 0;
    let innerRows = 0;
    for (let i = 1; i < SIZE; i++) {
      inner = Math.max(inner, meanDiff(a, col(i - 1), col(i)));
      innerRows = Math.max(innerRows, meanDiff(a, row(i - 1), row(i)));
    }
    expect(meanDiff(a, col(SIZE - 1), col(0))).toBeLessThanOrEqual(inner * 1.5 + 1);
    expect(meanDiff(a, row(SIZE - 1), row(0))).toBeLessThanOrEqual(innerRows * 1.5 + 1);
    expect(TEXTURE_TILE[kind].u).toBeGreaterThan(0);
    expect(TEXTURE_TILE[kind].v).toBeGreaterThan(0);
  });

  it("bois : veines le long du fil (u) — variation plus forte en travers que le long du fil", () => {
    for (const kind of ["oak", "ash", "pine"] as const) {
      const d = generateTexture(kind, SIZE);
      let along = 0;
      let across = 0;
      for (let y = 1; y < SIZE; y++) {
        for (let x = 1; x < SIZE; x++) {
          const k = 4 * (y * SIZE + x);
          along += Math.abs(d.color[k]! - d.color[k - 4]!);
          across += Math.abs(d.color[k]! - d.color[k - 4 * SIZE]!);
        }
      }
      expect(across, kind).toBeGreaterThan(along);
    }
  });

  it("génération par tranches = génération d'un coup ; teinte unie avant génération", () => {
    const whole = generateTexture("glulam", SIZE);
    const sliced = allocateTexture("glulam", SIZE);
    const c0 = sliced.color.slice(0, 4);
    expect(sliced.color.slice(4 * 17, 4 * 17 + 4)).toEqual(c0);
    for (let y = 0; y < SIZE; y += 5) fillRows(sliced, y, y + 5);
    expect(sliced.color).toEqual(whole.color);
    expect(sliced.roughness).toEqual(whole.roughness);
    expect(() => allocateTexture("oak", 2)).toThrow();
  });
});
