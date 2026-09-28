import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { bbox } from "../geom2d/polygon.js";
import {
  ceilingOf,
  coveredIntervals,
  headroomOnWalkline,
  openingPolygon,
} from "../headroom/headroom.js";
import { computeLayout } from "../layout/layout.js";
import type { Project } from "../model/project.js";
import { getRule } from "../rules/table.js";
import { placeNosings } from "../stepping/positions.js";
import { computeRises } from "../stepping/rises.js";
import { parseProject } from "./parse.js";
import {
  boundingRect,
  createProject,
  deepMerge,
  PRESET_HEADROOM_MIN,
  PRESET_IDS,
  type PresetId,
  type Rect,
} from "./presets.js";

function numericLegs(p: Project): number[] {
  return p.stair.layout.legs.map((l) => {
    if (l.length === "auto") throw new Error("longueur auto inattendue");
    return l.length;
  });
}

function openingRect(p: Project): Rect {
  const o = p.site.opening;
  if (o?.kind !== "rect") throw new Error("trémie rectangulaire attendue");
  return o;
}

/** Nombre de hauteurs `auto` et hauteur nominale. */
function stepping(p: Project) {
  const n = Math.round(p.site.floorToFloor / 175);
  return { n, rise: p.site.floorToFloor / n };
}

/** Tracé réel, nez sur Γ et altitudes. */
function realGeometry(p: Project) {
  const layout = computeLayout(p);
  const rises = computeRises(p);
  const positions = placeNosings(p, layout, rises.riserCount);
  return { layout, rises, positions };
}

/** Giron nominal sur la ligne de foulée (hors palier). */
function goingOf(p: Project): number {
  return realGeometry(p).positions.going;
}

/**
 * Échappée sur la ligne de foulée, recalculée sur le tracé réel à partir de la trémie produite
 * (calcul indépendant de `requiredOpening` : intersections de Γ avec la trémie) : elle atteint
 * l'échappée minimale partout où Γ est sous la dalle.
 */
function checkHeadroomCoverage(p: Project): void {
  const { layout, rises, positions } = realGeometry(p);
  const opening = openingPolygon(p.site.opening)!;
  const covered = coveredIntervals(layout.walkline, opening);
  const profile = { s: positions.s, z: rises.z, landings: positions.landingTreads };
  const hr = headroomOnWalkline(layout.walkline, profile, ceilingOf(p.site), covered);
  if (hr) expect(hr.min).toBeGreaterThanOrEqual(PRESET_HEADROOM_MIN - 1e-6);
}

/** Boîte englobante de l'emprise réelle de l'escalier. */
function footprintRect(p: Project): Rect {
  const b = bbox(computeLayout(p).footprint);
  return boundingRect([b.min, b.max], 1);
}

describe("createProject", () => {
  it.each(PRESET_IDS)("« %s » est valide, réaliste et reparsable", (preset: PresetId) => {
    const p = createProject(preset);
    expect(parseProject(p)).toEqual(p);
    expect(p.site.floorToFloor).toBe(2700);
    expect(p.site.upperSlabThickness).toBe(200);
    expect(p.stair.layout.width).toBeGreaterThanOrEqual(800);
    expect(p.stair.layout.width).toBeLessThanOrEqual(900);
    expect(p.stair.layout.legs.length).toBe(p.stair.layout.turns.length + 1);
    for (const l of numericLegs(p)) expect(Number.isInteger(l)).toBe(true);
    const { rise } = stepping(p);
    const blondel = 2 * rise + goingOf(p);
    expect(blondel).toBeGreaterThan(625);
    expect(blondel).toBeLessThan(635);
    checkHeadroomCoverage(p);
    const o = openingRect(p);
    const fp = footprintRect(p);
    expect(o.x).toBeGreaterThanOrEqual(fp.x - 10);
    expect(o.y).toBeGreaterThanOrEqual(fp.y - 10);
    expect(o.x + o.sizeX).toBeLessThanOrEqual(fp.x + fp.sizeX + 10);
    expect(o.y + o.sizeY).toBeLessThanOrEqual(fp.y + fp.sizeY + 10);
  });

  it("l'échappée minimale est lue dans rules.yaml (ECHAPPEE_MIN_DTU)", () => {
    expect(PRESET_HEADROOM_MIN).toBe(getRule("ECHAPPEE_MIN_DTU").min);
  });

  it("débord de nez conforme au contexte logement (DEBORD_NEZ_LOGEMENT)", () => {
    for (const preset of PRESET_IDS) {
      const p = createProject(preset);
      expect(p.compliance.contexts).toContain("logement_interieur");
      expect(p.stair.treads.nosing).toBeLessThanOrEqual(getRule("DEBORD_NEZ_LOGEMENT").max!);
    }
  });

  it("formes attendues", () => {
    expect(createProject("straight").stair.layout.turns).toEqual([]);
    const u = createProject("two-quarters-u").stair.layout;
    expect(u.turns.map((t) => t.direction)).toEqual(["left", "left"]);
    const half = createProject("half-turn").stair.layout;
    expect(half.legs[1]?.length).toBe(2 * half.width + 200); // volée centrale = 2E + jour
    expect(createProject("quarter-landing").stair.layout.turns[0]?.mode).toBe("landing");
    expect(createProject("quarter-left").stair.layout.turns[0]).toEqual({
      direction: "left",
      mode: "winders",
      inner: { kind: "sharp" },
    });
  });

  it("le quart à droite est le symétrique du quart à gauche (x → E − x)", () => {
    const l = createProject("quarter-left");
    const r = createProject("quarter-right");
    const w = l.stair.layout.width;
    expect(r.stair.layout.legs).toEqual(l.stair.layout.legs);
    const ol = openingRect(l);
    const or = openingRect(r);
    expect(or).toEqual({
      kind: "rect",
      x: w - (ol.x + ol.sizeX),
      y: ol.y,
      sizeX: ol.sizeX,
      sizeY: ol.sizeY,
    });
  });

  it("l'option de sens et la surcharge libre", () => {
    expect(
      createProject("half-turn", { direction: "right" }).stair.layout.turns.map((t) => t.direction),
    ).toEqual(["right", "right"]);
    expect(() => createProject("straight", { direction: "left" })).toThrow(RangeError);
    expect(() => createProject("quarter-left", { direction: "right" })).toThrow(RangeError);
    const p = createProject("straight", {
      name: "Test",
      patch: { stair: { treads: { thickness: 50 } } },
    });
    expect(p.name).toBe("Test");
    expect(p.stair.treads.thickness).toBe(50);
    expect(p.stair.treads.nosing).toBe(getRule("DEBORD_NEZ_LOGEMENT").recommande);
  });

  it("refuse les paramètres hors domaine par une RangeError (jamais une ZodError)", () => {
    expect(() => createProject("straight", { width: 1300 })).toThrow(RangeError);
    expect(() => createProject("half-turn", { floorToFloor: 1200 })).toThrow(/trop faible/);
    for (const floorToFloor of [100, 0, -5, Number.NaN, 2700.5, 12000]) {
      expect(() => createProject("straight", { floorToFloor }), `H = ${floorToFloor}`).toThrow(
        RangeError,
      );
    }
    expect(() => createProject("straight", { width: 850.5 })).toThrow(RangeError);
    expect(() => createProject("straight", { width: 0 })).toThrow(RangeError);
    expect(() => createProject("straight", { upperSlabThickness: 0 })).toThrow(RangeError);
    expect(() => createProject("straight", { upperSlabThickness: -100 })).toThrow(RangeError);
    expect(() => createProject("quarter-landing", { floorToFloor: 700 })).toThrow(RangeError);
    // Même valeur en option et dans `patch` : acceptée ; deux valeurs différentes : refusées.
    expect(
      createProject("straight", { floorToFloor: 3000, patch: { site: { floorToFloor: 3000 } } })
        .site.floorToFloor,
    ).toBe(3000);
    expect(() =>
      createProject("straight", { floorToFloor: 3000, patch: { site: { floorToFloor: 2800 } } }),
    ).toThrow(RangeError);
  });

  it("palier : la trémie couvre aussi le palier et la première volée quand l'échappée l'exige", () => {
    // n = 14, h ≈ 171 : H − ep − h < 1 900 dès la première marche → tout l'escalier sous la trémie.
    const p = createProject("quarter-landing", { floorToFloor: 2400, upperSlabThickness: 350 });
    checkHeadroomCoverage(p);
    const o = openingRect(p);
    expect(o.y).toBe(0);
    expect(o.x + o.sizeX).toBe(p.stair.layout.width);
    // Cas courant : palier dégagé (2 700 − 200 − 3 × 180 = 1 960 ≥ 1 900), première volée hors
    // trémie (sur un palier, la ligne de pente est le dessus du palier).
    const q = createProject("quarter-landing");
    expect(openingRect(q).y).toBe(numericLegs(q)[0]! - q.stair.layout.width);
  });

  it("un patch sur H, E, la dalle ou le réglage des hauteurs garde volées et trémie cohérentes", () => {
    for (const preset of PRESET_IDS) {
      const viaOption = createProject(preset, {
        floorToFloor: 3000,
        width: 850,
        upperSlabThickness: 250,
      });
      const viaPatch = createProject(preset, {
        patch: {
          site: { floorToFloor: 3000, upperSlabThickness: 250 },
          stair: { layout: { width: 850 } },
        },
      });
      expect(viaPatch).toEqual(viaOption);
    }
    // n imposé : les longueurs suivent le nouveau giron auto (630 − 2h).
    const p = createProject("straight", { patch: { stair: { stepping: { riserCount: 16 } } } });
    expect(p.stair.stepping.riserCount).toBe(16);
    expect(numericLegs(p)).toEqual([Math.round(15 * (630 - (2 * 2700) / 16))]);
    // Giron imposé.
    const q = createProject("straight", { patch: { stair: { stepping: { targetGoing: 250 } } } });
    expect(numericLegs(q)).toEqual([14 * 250]);
    // Volées explicites : elles remplacent le calcul.
    const r = createProject("straight", {
      patch: { stair: { layout: { legs: [{ length: 4000 }] } } },
    });
    expect(numericLegs(r)).toEqual([4000]);
  });

  it("deepMerge ignore une clé __proto__ venue d'un JSON", () => {
    const merged = deepMerge({ a: 1 }, JSON.parse('{"__proto__": {"polluted": true}, "b": 2}'));
    expect(merged).toEqual({ a: 1, b: 2 });
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("propriété : trémie cohérente pour toute hauteur, emmarchement et dalle réalistes", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PRESET_IDS),
        fc.integer({ min: 2200, max: 3600 }),
        fc.integer({ min: 600, max: 1200 }),
        fc.integer({ min: 120, max: 350 }),
        (preset, floorToFloor, width, upperSlabThickness) => {
          let p: Project;
          try {
            p = createProject(preset, { floorToFloor, width, upperSlabThickness });
          } catch (e) {
            if (e instanceof RangeError) return; // forme impossible pour ces cotes
            throw e;
          }
          checkHeadroomCoverage(p);
          const o = openingRect(p);
          expect(o.sizeX % 10).toBe(0);
          expect(o.sizeY % 10).toBe(0);
          expect(Math.min(o.sizeX, o.sizeY)).toBeGreaterThanOrEqual(width);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("createProject — isolation", () => {
  it("deux projets créés ne partagent aucun objet", () => {
    const a = createProject("straight");
    const b = createProject("straight");
    expect(a.stair.structure.params).not.toBe(b.stair.structure.params);
  });
});
