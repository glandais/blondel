import { describe, expect, it } from "vitest";
import { slopeExceedsFrom, slopeZ, type SlopeProfile } from "./profile.js";

/** Trois nez sur une volée droite (g = 250, h = 180), puis un palier de 800 et deux nez. */
const profile: SlopeProfile = {
  s: [0, 250, 500, 1300, 1550],
  z: [180, 360, 540, 720, 900],
  landings: new Set([2]),
};

describe("slopeZ", () => {
  it("est affine entre deux nez hors palier", () => {
    expect(slopeZ(profile, 0)).toBe(180);
    expect(slopeZ(profile, 125)).toBeCloseTo(270, 12);
    expect(slopeZ(profile, 250)).toBe(360);
    expect(slopeZ(profile, 1425)).toBeCloseTo(810, 12);
  });

  it("vaut le dessus du palier sur la marche palière, avec un saut au nez d'arrivée", () => {
    expect(slopeZ(profile, 500)).toBe(540);
    expect(slopeZ(profile, 900)).toBe(540);
    expect(slopeZ(profile, 1300)).toBe(720);
    expect(slopeZ(profile, 1300, "left")).toBe(540);
    expect(slopeZ(profile, 250, "left")).toBe(360);
  });

  it("prend l'altitude du nez extrême hors de [s_0 ; s_{n−1}] ; profil vide : NaN", () => {
    expect(slopeZ(profile, -10)).toBe(180);
    expect(slopeZ(profile, 2000)).toBe(900);
    expect(slopeZ(profile, 1550, "left")).toBe(900);
    expect(slopeZ({ s: [], z: [], landings: new Set() }, 0)).toBeNaN();
  });
});

describe("slopeExceedsFrom", () => {
  it("inverse la ligne de pente dans une volée", () => {
    expect(slopeExceedsFrom(profile, 270)).toBeCloseTo(125, 12);
    expect(slopeExceedsFrom(profile, 100)).toBe(0);
    expect(slopeExceedsFrom(profile, 900)).toBeNull();
  });

  it("un palier plat sous le seuil n'est pas couvert : le dépassement commence au nez suivant", () => {
    expect(slopeExceedsFrom(profile, 600)).toBe(1300);
    expect(slopeExceedsFrom(profile, 540)).toBe(1300);
    expect(slopeExceedsFrom(profile, 539)).toBeCloseTo(500 - 250 / 180, 9);
  });

  it("cohérent avec slopeZ : z ≤ seuil avant s*, z > seuil après", () => {
    for (const zMax of [200, 300, 450, 541, 700, 719, 800, 899]) {
      const s = slopeExceedsFrom(profile, zMax)!;
      expect(slopeZ(profile, s - 1e-6, "left")).toBeLessThanOrEqual(zMax + 1e-6);
      expect(slopeZ(profile, s + 1e-6)).toBeGreaterThan(zMax - 1e-6);
    }
  });
});
