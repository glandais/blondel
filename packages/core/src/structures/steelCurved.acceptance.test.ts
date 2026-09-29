/**
 * Jalon 5b — critère d'acceptation n° 2 (CHALLENGE P2) et exemple
 * `examples/j5b-debillarde-soude.blondel.json` : quart tournant balancé à jour en arc, limon de
 * jour débillardé soudé (`steel-curved`), comparé à des limons UPN (`steel-profile`) sur la
 * **même épure** (même site, même ligne de foulée ; raccord de jour et balancement recalculés
 * par variante, écarts affichés).
 * Régénération : `UPDATE_EXAMPLES=1 pnpm vitest run packages/core/src/structures/steelCurved.acceptance.test.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ProjectSchema, PROJECT_SCHEMA_VERSION, type Project } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { parseProjectText } from "../project/parse.js";
import { serializeProject } from "../project/serialize.js";
import { WorkshopProfileSchema } from "../workshop/profile.js";
import { adaptJour, compareEpure } from "./compare.js";
import { ruledFlatGap } from "./ruled.test-helpers.js";
import "./index.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
export const J5B_EXAMPLE = "j5b-debillarde-soude.blondel.json";

/**
 * Quart tournant balancé à gauche, jour en arc de 250 mm (sous le rayon mini de cintrage d'un
 * UPN aile intérieure, 650 mm, C §2.3), H = 2 700, E = 900, volées 1 800 / 2 830 au mur
 * (g ≈ 245 mm, 2h + g ≈ 605 mm), trémie 2 830 × 1 550 sur la seconde volée et le tournant
 * (échappée ≥ 1 900 mm sur la ligne de foulée). Limon débillardé : paramètres par défaut (à
 * valider), variante M3 automatique (quintique pour un débillardé, décision Q7).
 */
export function j5bDebillardeSoude(): Project {
  const [l1, l2] = [1800, 2830];
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: "Jalon 5b — quart tournant balancé à jour en arc, limon débillardé soudé",
    site: {
      floorToFloor: 2700,
      upperSlabThickness: 200,
      opening: { kind: "rect", x: 900 - l2, y: 250, sizeX: l2, sizeY: l1 - 250 },
    },
    stair: {
      placement: { origin: { x: 0, y: 0 }, rotation: 0 },
      layout: {
        width: 900,
        legs: [{ length: l1 }, { length: l2 }],
        turns: [{ direction: "left", mode: "winders", inner: { kind: "arc", radius: 250 } }],
      },
      treads: { nosing: 10 },
      structure: { kind: "steel-curved", params: {} },
    },
  });
}

if (process.env["UPDATE_EXAMPLES"] === "1") {
  writeFileSync(join(EXAMPLES_DIR, J5B_EXAMPLE), serializeProject(j5bDebillardeSoude()));
}

describe("exemple j5b : limon débillardé soudé", () => {
  const text = readFileSync(join(EXAMPLES_DIR, J5B_EXAMPLE), "utf8");

  it("à jour avec son générateur, sérialisation stable", () => {
    expect(text).toBe(serializeProject(j5bDebillardeSoude()));
    expect(serializeProject(parseProjectText(text))).toBe(text);
  });

  it("modèle complet sans erreur ni violation bloquante, EXC2, M3 quintique", () => {
    const m = buildModel(parseProjectText(text));
    expect(m.errors).toEqual([]);
    expect(m.compliance.summary.bloquant).toBe(0);
    expect(m.executionClass).toBe("EXC2");
    expect(m.stepping.balancedZones.map((z) => z.method)).toEqual(["M3-quintic"]);
    const curved = m.parts.filter((p) => p.id.startsWith("stringer-inner-curved-"));
    expect(curved.length).toBeGreaterThanOrEqual(2);
    for (const p of curved) expect(p.flat?.reference?.kind).toBe("neutral-fiber");
    // Lignes de roulage sur les tronçons qui portent un arc.
    const rolled = curved.filter((p) => (p.quantities["rolled_length_mm"] ?? 0) > 0);
    expect(rolled.length).toBeGreaterThan(0);
    for (const p of rolled) expect(p.flat?.lines.some((l) => l.kind === "roll")).toBe(true);
  });

  it("solide 3D conforme au développé, coin de la coupe de niveau au sol compris", () => {
    // Le coin où la rive basse croise la coupe de niveau (sol) est une génératrice du solide :
    // sinon la surface réglée passe en ligne droite par-dessus (≈ 44 mm d'écart sur LD1).
    const m = buildModel(parseProjectText(text));
    const curved = m.parts.filter((p) => p.id.startsWith("stringer-inner-curved-"));
    for (const p of curved) expect(ruledFlatGap(p), p.id).toBeLessThan(0.5);
    // Même contrôle avec un étage plus bas (coin plus éloigné du départ).
    const low = parseProjectText(text);
    const m2 = buildModel({ ...low, site: { ...low.site, floorToFloor: 2300 } });
    for (const p of m2.parts.filter((q) => q.id.startsWith("stringer-inner-curved-"))) {
      expect(ruledFlatGap(p), p.id).toBeLessThan(0.5);
    }
  });
});

describe("critère d'acceptation n° 2 : comparateur sur la même épure", () => {
  const project = j5bDebillardeSoude();
  const [upn, curved] = compareEpure(project, [
    { kind: "steel-profile", params: { family: "UPN" } },
    { kind: "steel-curved" },
  ]);

  it("UPN impossible en limon de jour à petit rayon : variante adaptée (poteau) et signalée", () => {
    expect(upn!.kind).toBe("steel-profile");
    expect(upn!.adaptations).toHaveLength(1);
    expect(upn!.adaptations[0]!.from).toEqual({ kind: "arc", radius: 250 });
    expect(upn!.adaptations[0]!.to.kind).toBe("newel");
    expect(upn!.signals[0]).toMatch(/UPN impossible en limon de jour à petit rayon \(C §2\.3\)/);
    expect(upn!.signals[0]).toMatch(/650 mm/);
    // Limon de jour UPN généré contre le poteau (seul le prédimensionnement peut alerter).
    expect(upn!.errors.filter((x) => /jour|poteau/i.test(x))).toEqual([]);
    expect(upn!.model.parts.some((p) => p.id.startsWith("stringer-inner-"))).toBe(true);
    expect(upn!.epure.jours[0]!.kind).toBe("newel");
    // Le débillardé garde le jour en arc de l'épure.
    expect(curved!.adaptations).toEqual([]);
    expect(curved!.epure.jours[0]).toEqual({ kind: "arc", radius: 250 });
  });

  it("même épure : même site, même ligne de foulée et même nombre de hauteurs", () => {
    expect(upn!.model.stepping.riserCount).toBe(curved!.model.stepping.riserCount);
    expect(upn!.model.layout.walklineOffset).toBe(curved!.model.layout.walklineOffset);
    expect(upn!.model.stepping.rise).toBeCloseTo(curved!.model.stepping.rise, 9);
  });

  it("raccord de jour et balancement recalculés par variante, écarts affichés", () => {
    expect(upn!.epure.balancing.every((x) => x === "M3-cubic")).toBe(true);
    expect(curved!.epure.balancing.every((x) => x === "M3-quintic")).toBe(true);
    expect(upn!.deviations).toEqual([]);
    const text = curved!.deviations.join("\n");
    expect(text).toMatch(/Tournant 1 : jour en arc R 250 mm \(référence : poteau 100 mm\)/);
    expect(text).toMatch(/Giron : /);
    expect(text).toMatch(/Balancement : .*M3-quintic \(référence : .*M3-cubic\)/);
  });

  it("grandeurs physiques : masse, pièces, pièces uniques, cordons dont bout à bout, EXC", () => {
    expect(curved!.errors).toEqual([]);
    for (const r of [upn!, curved!]) {
      expect(r.massKg).toBeGreaterThan(0);
      expect(r.partCount).toBeGreaterThan(0);
      expect(r.uniqueParts).toBeGreaterThan(0);
      expect(r.uniqueParts).toBeLessThanOrEqual(r.partCount);
      expect(r.weldMm).toBeGreaterThan(0);
    }
    expect(upn!.buttWeldMm).toBe(0);
    expect(upn!.executionClass).toBe("EXC1");
    expect(curved!.buttWeldMm).toBeGreaterThan(0);
    expect(curved!.weldMm).toBeGreaterThan(curved!.buttWeldMm);
    expect(curved!.executionClass).toBe("EXC2");
  });

  it("coût : pas d'euros sans barème d'atelier ; chiffré pour les deux variantes sinon", () => {
    for (const r of [upn!, curved!]) {
      expect(r.cost).toBeNull();
      expect(r.costMissing).toContain("hourlyRate");
    }
    // Barème de test (valeurs arbitraires, pas des défauts : aucun défaut non sourcé, C §5.4).
    const rates = {
      hourlyRate: 60,
      minutesPerCut: 2,
      minutesPerWeldMeter: 10,
      minutesPerBend: 1,
      minutesPerHole: 1,
      minutesPerUniquePart: 15,
      steelPricePerKg: 1.5,
      woodPricePerM3: 1800,
      finishPricePerM2: 20,
    };
    const priced: Project = { ...project, workshop: WorkshopProfileSchema.parse({ costs: rates }) };
    const [pu, pc] = compareEpure(priced, [
      { kind: "steel-profile", params: { family: "UPN" } },
      { kind: "steel-curved" },
    ]);
    for (const r of [pu!, pc!]) {
      expect(r.costMissing).toEqual([]);
      const c = r.cost!;
      expect(c.total).toBeGreaterThan(0);
      expect(c.total).toBeCloseTo(c.material + c.labour + c.finish, 6);
      expect(c.labour).toBeCloseTo(c.hours * rates.hourlyRate, 6);
    }
    // Même masse et mêmes pièces qu'en l'absence de barème : le coût ne change pas le modèle.
    expect(pu!.massKg).toBeCloseTo(upn!.massKg, 6);
    expect(pc!.partCount).toBe(curved!.partCount);
    // Les cordons bout à bout du débillardé pèsent dans la main-d'œuvre.
    expect(pc!.weldMm).toBeGreaterThan(pu!.weldMm);
  });

  it("épure conservée (`jour: keep`) : incompatibilité seulement signalée, variante partielle", () => {
    const [kept] = compareEpure(project, [
      { kind: "steel-profile", params: { family: "UPN" }, jour: "keep" },
    ]);
    expect(kept!.adaptations).toEqual([]);
    expect(kept!.signals[0]).toMatch(/UPN impossible .* épure conservée/);
    expect(kept!.errors.some((x) => /jour en arc/.test(x))).toBe(true);
  });

  it("débillardé : jour en arc trop serré pour la rouleuse agrandi, épaisseur du plugin", () => {
    const withArc = (radius: number): Project => ({
      ...project,
      stair: {
        ...project.stair,
        layout: {
          ...project.stair.layout,
          turns: [{ direction: "left", mode: "winders", inner: { kind: "arc", radius } }],
        },
      },
    });
    // r_j − e = 150 − 8 < 150 : arc agrandi à 160 (150 + e = 8 du plugin, arrondi à 10 mm).
    const [c] = compareEpure(withArc(150), [{ kind: "steel-curved" }]);
    expect(c!.adaptations[0]!.to).toEqual({ kind: "arc", radius: 160 });
    expect(c!.signals[0]).toMatch(/sous le rayon de roulage/);
    expect(c!.errors).toEqual([]);
    // r_j = 158 = 150 + 8 : roulable, épure conservée.
    expect(adaptJour(withArc(158), { kind: "steel-curved" }).adaptations).toEqual([]);
    // Épaisseur de la variante prise en compte (12 mm ⇒ 162 → 170).
    const thick = adaptJour(withArc(150), { kind: "steel-curved", params: { thickness: 12 } });
    expect(thick.adaptations[0]!.to).toEqual({ kind: "arc", radius: 170 });
  });

  it("débillardé sur une épure à poteau : jour en arc substitué (G7)", () => {
    const withNewel: Project = {
      ...project,
      stair: {
        ...project.stair,
        layout: {
          ...project.stair.layout,
          turns: [{ direction: "left", mode: "winders", inner: { kind: "newel", size: 100 } }],
        },
      },
    };
    const [c] = compareEpure(withNewel, [{ kind: "steel-curved" }]);
    expect(c!.adaptations[0]!.to).toEqual({ kind: "arc", radius: 160 });
    expect(c!.signals[0]).toMatch(/débillardé ⇒ jour courbe/);
    expect(c!.errors).toEqual([]);
  });
});
