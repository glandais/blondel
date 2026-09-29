import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { orientation, pointInPolygon, signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import { computeLayout } from "../layout/layout.js";
import type { Part, Stepping } from "../model/derived.js";
import type { Project } from "../model/project.js";
import { createProject } from "../project/presets.js";
import { computeStepping } from "../stepping/stepping.js";
import { makeSteppingProject, stairArb } from "../stepping/test-helpers.js";
import {
  buildBasicParts,
  DEFAULT_WOOD_MATERIAL,
  QUANTITY_SURFACE,
  QUANTITY_VOLUME,
} from "./basic.js";

function partsOf(p: Project) {
  const layout = computeLayout(p);
  const stepping = computeStepping(p, layout);
  return { layout, stepping, ...buildBasicParts(p, layout, stepping) };
}

function extrusion(part: Part) {
  if (part.solid.kind !== "extrusion") throw new Error("extrusion attendue");
  return part.solid;
}

/** Contour du profil en repère monde (le repère local est une translation). */
function worldOutline(part: Part) {
  const s = extrusion(part);
  return s.profile.outer.map((p) => V.add(p, s.frame.origin));
}

describe("buildBasicParts — escalier droit", () => {
  const p = makeSteppingProject({
    width: 900,
    legs: ["auto"],
    treads: { thickness: 40, nosing: 20, risers: "full", riserThickness: 20 },
  });
  const { stepping, parts, notes } = partsOf(p);
  const treads = parts.filter((x) => x.category === "tread");
  const risers = parts.filter((x) => x.category === "riser");

  it("n − 1 marches M1…, n contremarches CM1…, identifiants stables", () => {
    expect(notes).toEqual([]);
    expect(treads.map((t) => t.mark)).toEqual(stepping.treads.map((t) => `M${t.number}`));
    expect(treads.map((t) => t.id)).toEqual(stepping.treads.map((t) => `tread-${t.number}`));
    expect(risers.map((r) => r.mark)).toEqual(stepping.nosings.map((n) => `CM${n.index + 1}`));
    expect(new Set(parts.map((x) => x.id)).size).toBe(parts.length);
    for (const x of parts) expect(x.material).toBe(DEFAULT_WOOD_MATERIAL);
  });

  it("marche : extrusion du contour sous le dessus, volume et surface", () => {
    for (const [i, part] of treads.entries()) {
      const tread = stepping.treads[i]!;
      const solid = extrusion(part);
      expect(solid.frame.origin.z).toBeCloseTo(tread.z - 40, 9);
      expect(solid.depth).toBe(40);
      const outline = worldOutline(part);
      outline.forEach((pt, j) => expect(V.distance(pt, tread.outline[j]!)).toBeLessThan(1e-9));
      const area = signedArea(tread.outline);
      expect(part.quantities[QUANTITY_VOLUME]).toBeCloseTo((area * 40) / 1e9, 12);
      expect(part.quantities[QUANTITY_SURFACE]).toBeCloseTo(area / 1e6, 12);
      // Droit : 900 × (270 + 20 de débord sous le nez supérieur).
      expect(part.stock).toEqual({
        length: expect.closeTo(900, 6) as number,
        width: expect.closeTo(290, 6) as number,
        thickness: 40,
      });
      // Fil selon le giron (montée +Y).
      expect(part.grain!.x).toBeCloseTo(0, 12);
      expect(part.grain!.y).toBeCloseTo(1, 12);
    }
  });

  it("contremarche : en retrait du débord, de la sous-face inférieure à la sous-face supérieure", () => {
    const nosings = stepping.nosings;
    for (const [k, part] of risers.entries()) {
      const solid = extrusion(part);
      const bottom = k === 0 ? 0 : nosings[k - 1]!.z - 40;
      expect(solid.frame.origin.z).toBeCloseTo(bottom, 9);
      expect(solid.frame.origin.z + solid.depth).toBeCloseTo(nosings[k]!.z - 40, 9);
      const ys = worldOutline(part).map((pt) => pt.y);
      expect(Math.min(...ys)).toBeCloseTo(nosings[k]!.s + 20, 9);
      expect(Math.max(...ys)).toBeCloseTo(nosings[k]!.s + 40, 9);
      expect(part.stock!.length).toBeCloseTo(900, 9);
      expect(part.stock!.thickness).toBe(20);
      // Contremarche k : face avant = bord arrière de la marche k (appui).
      if (k > 0) {
        const back = Math.max(...stepping.treads[k - 1]!.outline.map((pt) => pt.y));
        expect(Math.min(...ys)).toBeCloseTo(back, 9);
      }
    }
    // Somme des hauteurs des contremarches = H − e (la première part du sol).
    const total = risers.reduce((acc, r) => acc + extrusion(r).depth, 0);
    expect(total).toBeCloseTo(2700 - 40, 9);
  });

  it("contremarches ajourées ou absentes : aucune contremarche", () => {
    for (const risersMode of ["open", "none"] as const) {
      const q = makeSteppingProject({ width: 900, legs: ["auto"], treads: { risers: risersMode } });
      expect(partsOf(q).parts.every((x) => x.category === "tread")).toBe(true);
    }
  });

  it("marche plus épaisse que la 1re hauteur : contremarche de départ omise et signalée", () => {
    const q = makeSteppingProject({ width: 900, legs: ["auto"], treads: { thickness: 200 } });
    const res = partsOf(q);
    const marks = res.parts.filter((x) => x.category === "riser").map((x) => x.mark);
    expect(marks).not.toContain("CM1");
    expect(marks).toContain("CM2");
    expect(res.notes).toEqual([expect.stringContaining("Contremarche 1 : hauteur nulle")]);
  });
});

describe("buildBasicParts — palier", () => {
  it("le palier est une pièce P1 de catégorie landing, numérotée comme sa marche", () => {
    const p = createProject("quarter-landing");
    const { stepping, parts } = partsOf(p);
    const landingTread = stepping.treads.find((t) => t.kind === "landing")!;
    const landings = parts.filter((x) => x.category === "landing");
    expect(landings).toHaveLength(1);
    expect(landings[0]!.mark).toBe("P1");
    expect(landings[0]!.id).toBe(`tread-${landingTread.number}`);
    expect(parts.some((x) => x.mark === `M${landingTread.number}`)).toBe(false);
  });
});

describe("buildBasicParts — propriétés (escaliers tournants contraints)", () => {
  it("contours simples orientés CCW, volumes positifs, repères uniques", () => {
    fc.assert(
      fc.property(stairArb(), ({ project }) => {
        const { stepping, parts } = partsOf(project);
        expect(new Set(parts.map((x) => x.mark)).size).toBe(parts.length);
        expect(parts.filter((x) => x.category !== "riser")).toHaveLength(stepping.treads.length);
        for (const part of parts) {
          expect(orientation(extrusion(part).profile.outer)).toBe("ccw");
          expect(part.quantities[QUANTITY_VOLUME]).toBeGreaterThan(0);
          expect(extrusion(part).depth).toBeGreaterThan(0);
          const g = part.grain!;
          expect(Math.hypot(g.x, g.y, g.z)).toBeCloseTo(1, 9);
        }
      }),
      { numRuns: 40 },
    );
  });
});

/**
 * Contremarche k (sauf celle d'arrivée) : dans la surface de la marche supérieure, entre la
 * ligne du nez k et celle du nez k + 1 (elle ne passe pas sous la marche suivante).
 */
function checkRisersStayUnderUpperTread(stepping: Stepping, parts: readonly Part[]) {
  for (const part of parts.filter((x) => x.category === "riser")) {
    const k = Number(part.id.slice("riser-".length)) - 1;
    const upper = stepping.treads[k];
    if (!upper) continue;
    for (const v of worldOutline(part)) {
      expect(
        pointInPolygon(v, upper.walkingSurface, 1e-2),
        `${part.mark} hors de M${k + 1}`,
      ).not.toBe("outside");
    }
  }
}

describe("buildBasicParts — contremarches coupées au nez suivant (relecture)", () => {
  it("U à jour vif : la contremarche dont le nez passe par l'angle ne file pas sous la volée suivante", () => {
    // Régression : dans le préréglage U, la ligne du nez 5 passe par l'angle du jour et est
    // presque parallèle à la 3e volée ; la face de CM6 ne recoupait le jour que 340 mm plus loin.
    // Volées de l'ancien préréglage U (1 120 / 2 100 / 2 625), figées : le préréglage place
    // désormais le premier tournant à 2 girons du départ (collet ≥ 100 mm).
    const p = createProject("two-quarters-u", {
      patch: { stair: { layout: { legs: [1120, 2100, 2625].map((length) => ({ length })) } } },
    });
    const { stepping, parts } = partsOf(p);
    checkRisersStayUnderUpperTread(stepping, parts);
    // Avant correction, l'extrémité côté jour de CM6 était en (−400 ; −70), au-delà du nez 6.
    const n6 = stepping.nosings[6]!;
    const cm6 = worldOutline(parts.find((x) => x.id === "riser-6")!);
    expect(Math.min(...cm6.map((v) => v.y))).toBeGreaterThan(n6.q.y);
  });

  it("propriété : contremarches dans la surface de la marche supérieure", () => {
    fc.assert(
      fc.property(stairArb(), ({ project }) => {
        const p: Project = {
          ...project,
          stair: {
            ...project.stair,
            treads: { ...project.stair.treads, risers: "full", riserThickness: 20 },
          },
        };
        const { stepping, parts } = partsOf(p);
        checkRisersStayUnderUpperTread(stepping, parts);
      }),
      { numRuns: 60 },
    );
  });
});
