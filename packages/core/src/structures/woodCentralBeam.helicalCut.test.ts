/**
 * Écart CUT × limon central bois (F10, sous-lot P2, question F10 (8)), asserté explicitement
 * pour qu'il ne passe pas inaperçu jusqu'à P3. Sous CUT (débord d / sin Δθ entre r_i et R_e,
 * Δθ < 90°), la marche de base d'un hélicoïdal, découpée par le chemin de cage, a son contour
 * coupé sur la ligne du nez k + 2 (décision (2)) ; mais une marche prolongée sous la
 * contremarche suivante (contremarches pleines, A33 (i), `treadsUnderRisers`) garde le contour
 * de l'ancien moteur (`helicalTreadOutline`), **non coupé** : il passe au-delà de la ligne du
 * nez k + 2, côté fût ou jour. Ce test échouera quand `treadsUnderRisers` sera aligné sur
 * `outlineBetween` (P3, si l'utilisateur le décide) : il faudra alors l'inverser.
 */
import { describe, expect, it } from "vitest";
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

describe("CUT × marches prolongées sous contremarche (limon central bois)", () => {
  // j5c-limon-central-bois-helicoidal, 60 marches par tour (Δθ = 6°), débord 40 mm,
  // contremarches pleines : d / sin Δθ = 383 mm entre r_i = 350 et R_e = 1200 (CUT).
  const base = loadExample("j5c-limon-central-bois-helicoidal");
  const tuned = withHelical(base, { sweep: { mode: "treadsPerTurn", count: 60 } });
  const project = withStair(tuned, {
    treads: { ...tuned.stair.treads, nosing: 40, risers: "full" },
  });

  it("marche de base coupée, marche prolongée non coupée", () => {
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
      // Pièce remplacée par une marche prolongée (contour plus grand que celui de la base).
      if (!(plan.outline.length !== t.outline.length || beyond(plan.outline, next2, ahead) > 1e-6))
        continue;
      extended++;
      // Écart asserté : le contour prolongé, non coupé, passe au-delà de la ligne du nez k + 2.
      expect(beyond(plan.outline, next2, ahead), `marche prolongée ${t.number}`).toBeGreaterThan(1);
    }
    // Toutes les marches sauf la dernière sont prolongées (entaille arrière, A33 (i)).
    expect(extended).toBe(treads.length - 1);
  });
});
