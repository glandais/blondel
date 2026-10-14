/**
 * Marches prolongées sous contremarche d'un hélicoïdal (limon central bois, contremarches
 * pleines, A33 (i), `treadsUnderRisers`) : décision F10 (8), appliquée en P3. Sous CUT (débord
 * d / sin Δθ entre r_i et R_e, Δθ < 90°), la marche de base, découpée par le chemin de cage, a
 * son contour coupé sur la ligne du nez k + 2 (décision (2)) ; la marche prolongée est
 * construite avec la **même coupe** (`outlineBetween`) : elle ne passe pas non plus au-delà de
 * cette ligne et contient le contour de base. (En P2, elle gardait le contour de l'ancien
 * moteur, non coupé : l'écart était asserté ici ; c'est désormais l'égalité.)
 */
import { describe, expect, it } from "vitest";
import { pointInPolygon, signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { NosingLine } from "../model/derived.js";
import type { Vec2 } from "../model/primitives.js";
import {
  loadExample,
  withHelical,
  withStair,
} from "../layout/cage/helical-parity-cases-helpers.js";
import { buildModel } from "../pipeline/build.js";
import { readPlanExtrusion } from "./housing.js";

/** Profondeur (mm) du point le plus avancé de `poly` au-delà de la ligne de nez `n`, en montant. */
function beyond(poly: readonly Vec2[], n: NosingLine, up: Vec2): number {
  return Math.max(...poly.map((p) => V.dot(V.sub(p, n.q), up)));
}

const area = (poly: readonly Vec2[]): number => Math.abs(signedArea(poly));

/**
 * Flèche de discrétisation des arcs (0,1 mm, ADR-0003) : un sommet du contour de base posé sur
 * C_i ou C_e peut être hors d'une corde du contour prolongé, discrétisé autrement, d'au plus
 * cette flèche.
 */
const SAGITTA = 0.1;

describe("CUT × marches prolongées sous contremarche (limon central bois), décision F10 (8)", () => {
  // j5c-limon-central-bois-helicoidal, 60 marches par tour (Δθ = 6°), débord 40 mm,
  // contremarches pleines : d / sin Δθ = 383 mm entre r_i = 350 et R_e = 1200 (CUT).
  const base = loadExample("j5c-limon-central-bois-helicoidal");
  const tuned = withHelical(base, { sweep: { mode: "treadsPerTurn", count: 60 } });
  const project = withStair(tuned, {
    treads: { ...tuned.stair.treads, nosing: 40, risers: "full" },
  });

  it("marche prolongée coupée comme la marche de base, et la contenant", () => {
    const model = buildModel(project, { memo: false });
    expect(model.errors).toEqual([]);
    const h = model.layout.helical!;
    const rho = project.stair.treads.nosing / Math.sin(h.stepAngle);
    expect(h.stepAngle).toBeLessThan(Math.PI / 2);
    expect(rho).toBeGreaterThan(h.innerRadius);
    expect(rho).toBeLessThan(h.outerRadius);
    const { nosings, treads } = model.stepping;
    let extended = 0;
    for (const t of treads) {
      const part = model.parts.find((p) => p.id === `tread-${t.number}`);
      const plan = part && readPlanExtrusion(part.solid);
      const next2 = nosings[t.number + 1];
      if (!plan || !next2) continue;
      // Sens de la montée à travers la ligne du nez k + 2.
      const up = V.perpLeft(next2.dir);
      const sign = V.dot(V.sub(nosings[t.number - 1]!.q, next2.q), up) < 0 ? 1 : -1;
      const ahead = V.scale(up, sign);
      // Marche de base (contour du découpage) : jamais au-delà de la ligne du nez k + 2.
      expect(beyond(t.outline, next2, ahead), `marche ${t.number}`).toBeLessThanOrEqual(1e-6);
      // Pièce remplacée par une marche prolongée : contour d'aire plus grande que la base.
      if (!(area(plan.outline) > area(t.outline) + 1e-6)) continue;
      extended++;
      // Même coupe que la base : jamais au-delà de la ligne du nez k + 2.
      expect(
        beyond(plan.outline, next2, ahead),
        `marche prolongée ${t.number}`,
      ).toBeLessThanOrEqual(1e-6);
      // Le contour prolongé contient le contour de base (même coupe sur C_i et C_e).
      for (const q of t.outline) {
        expect(pointInPolygon(q, plan.outline, SAGITTA), `marche prolongée ${t.number}`).not.toBe(
          "outside",
        );
      }
    }
    // Toutes les marches sauf la dernière sont prolongées (entaille arrière, A33 (i)).
    expect(extended).toBe(treads.length - 1);
  });
});
