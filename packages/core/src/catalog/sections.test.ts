import { msg, textMessage } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import {
  SECTION_FAMILIES,
  STEEL_SECTIONS,
  findSection,
  sectionInLabel,
  sectionOutline,
  sectionsOf,
} from "./sections.js";

/** Masse volumique de l'acier utilisée par les tables de profilés (kg/m³). */
const STEEL_DENSITY = 7850;

function polygonArea(pts: readonly { x: number; y: number }[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

describe("catalogue des profilés", () => {
  it("contient les quatre familles, désignations uniques", () => {
    for (const f of SECTION_FAMILIES) expect(sectionsOf(f).length).toBeGreaterThanOrEqual(8);
    const names = STEEL_SECTIONS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("masse linéique = aire × 7 850 kg/m³ (à 1 % près, arrondis des tables)", () => {
    for (const s of STEEL_SECTIONS) {
      const mass = (s.area / 1e6) * STEEL_DENSITY;
      expect(Math.abs(mass - s.massPerMeter) / s.massPerMeter, s.name).toBeLessThan(0.01);
    }
  });

  it("module élastique W_y = 2·I_y / h (à 1,5 % près), I_y > I_z", () => {
    for (const s of STEEL_SECTIONS) {
      const w = (2 * s.iy) / s.h;
      expect(Math.abs(w - s.wy) / s.wy, s.name).toBeLessThan(0.015);
      expect(s.iy, s.name).toBeGreaterThan(s.iz);
    }
  });

  it("aire cohérente avec le profil simplifié (âme + ailes, congés négligés)", () => {
    for (const s of STEEL_SECTIONS) {
      const a = polygonArea(sectionOutline(s));
      expect(a, s.name).toBeGreaterThan(0);
      const ratio = s.area / a;
      expect(ratio, s.name).toBeGreaterThan(0.95);
      expect(ratio, s.name).toBeLessThan(1.15);
    }
  });

  it("grandeurs croissantes avec la masse dans chaque famille", () => {
    for (const f of SECTION_FAMILIES) {
      const list = sectionsOf(f);
      for (let i = 1; i < list.length; i++) {
        expect(list[i]!.iy).toBeGreaterThan(list[i - 1]!.iy);
        expect(list[i]!.wy).toBeGreaterThan(list[i - 1]!.wy);
        expect(list[i]!.h).toBeGreaterThan(list[i - 1]!.h);
      }
    }
  });

  it("valeurs de référence C §2.3 (UPN 160 : 925 cm⁴, 116 cm³, 18,8 kg/m)", () => {
    const s = findSection("upn  160")!;
    expect(s.iy).toBe(925e4);
    expect(s.wy).toBe(116e3);
    expect(s.massPerMeter).toBeCloseTo(18.8, 6);
    expect(sectionInLabel("UPN 160 (S235)")?.name).toBe("UPN 160");
    expect(sectionInLabel(textMessage("IPE 200"))?.name).toBe("IPE 200");
    expect(sectionInLabel(msg("part.section.thickness", { thickness: "8" }))).toBeUndefined();
    expect(sectionInLabel("tôle 8 (S235)")).toBeUndefined();
  });
});
