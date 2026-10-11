/**
 * Jonctions tournantes d'une cage (ADR-0010) à ±90° : coins K (jour) et W (mur), raccords de jour
 * (vif, arc, poteau éventuellement décalé), arc de la ligne de foulée Γ, contrôles du poteau.
 * Formes fermées identiques à celles de l'ancien moteur à volées (`layout/legacyFlights.ts` ;
 * conventions : `layout/layout.ts`, « Raccords de jour ») : mêmes opérations, dans le même
 * ordre, pour l'égalité numérique.
 *
 * Repère d'une jonction j : celui du tronçon entrant (`SectionFrame`), d'étendue L (débords
 * compris) et de largeur E. Jonction à gauche : K = A + (L − E)·u (bord gauche),
 * W = A + L·u + E·r ; à droite : K = A + (L − E)·u + E·r (bord droit), W = A + L·u.
 *
 * Raccords pas encore pris en charge (lot 2) : pan coupé côté jour, arc côté mur, marches
 * rayonnantes (refusés par `cage.ts` avant tout calcul).
 */
import type { CurveSeg, Mm, Vec2 } from "../../model/primitives.js";
import type { CageJunction, WellJoint } from "../../model/project.js";
import { arcSeg, lineSeg } from "../../geom2d/segment.js";
import * as V from "../../geom2d/vec.js";
import { msg } from "@blondel/i18n";
import { LayoutError } from "../errors.js";
import { newelOffset, newelProtrusion, newelSetback } from "../newel.js";
import { at, type SectionFrame } from "./frames.js";

export type Side = "left" | "right";

/** Raccord de jour pris en charge au lot 1 (même contrat que `InnerCornerSchema`). */
export type SupportedWell = Exclude<WellJoint, { kind: "chamfer" }>;

/** Côté du jour (et sens) d'une jonction tournante : gauche si l'angle est positif. */
export function junctionSide(junction: Pick<CageJunction, "angle">): Side {
  return junction.angle > 0 ? "left" : "right";
}

/**
 * Raccord de jour de la jonction `index` (0 = première), pan coupé exclu.
 * @throws LayoutError pour un pan coupé (lot 2).
 */
export function supportedWell(junction: CageJunction, index: number): SupportedWell {
  const well = junction.well;
  if (well.kind === "chamfer") {
    throw new LayoutError(msg("layout.cage.chamferNotYetSupported", { junction: index + 1 }));
  }
  return well;
}

/** Retrait de la partie droite du bord du jour de part et d'autre du coin K. */
export function wellSetback(well: SupportedWell): Mm {
  switch (well.kind) {
    case "sharp":
      return 0;
    case "arc":
      return well.radius;
    case "newel":
      return newelSetback(well);
  }
}

/** Retrait de la partie droite de Γ de part et d'autre de K (rayon du raccord de jour). */
export function walkSetback(well: SupportedWell): Mm {
  return well.kind === "arc" ? well.radius : 0;
}

/**
 * Contrôles d'un poteau d'angle (jonction `index`, 0 = première) : décalage δ < a/2 et ligne de
 * foulée hors du poteau (d_f > p·√2), mêmes messages que le moteur à volées.
 * @throws LayoutError sinon.
 */
export function checkNewel(well: SupportedWell, index: number, df: Mm): void {
  if (well.kind !== "newel") return;
  const offset = newelOffset(well);
  if (!(offset < well.size / 2)) {
    throw new LayoutError(
      msg("layout.newelOffsetTooLarge", {
        turn: index + 1,
        offset: String(offset),
        halfSize: String(well.size / 2),
      }),
    );
  }
  // Sommet du poteau côté marches (p, p) : le plus proche de Γ (arc de rayon d_f centré en K).
  const reach = newelProtrusion(well) * Math.SQRT2;
  if (!(df > reach)) {
    throw new LayoutError(
      msg("layout.walklineCrossesNewel", {
        turn: index + 1,
        offset: String(df),
        size: String(well.size),
        required: reach.toFixed(1),
      }),
    );
  }
}

/** Coin intérieur K (intersection des bords côté jour), repère local. */
export function wellCorner(frame: SectionFrame, side: Side, width: Mm): Vec2 {
  return at(frame, frame.length - width, side === "left" ? 0 : width);
}

/** Coin du mur W (intersection des bords côté mur, angle vif), repère local. */
export function wallCorner(frame: SectionFrame, side: Side, width: Mm): Vec2 {
  return at(frame, frame.length, side === "left" ? width : 0);
}

/** Normale unitaire jour → mur du tronçon entrant. */
export function collarNormal(frame: SectionFrame, side: Side): Vec2 {
  return side === "left" ? frame.r : V.scale(frame.r, -1);
}

/**
 * Segments du bord du jour propres à la jonction (entre la fin de la partie droite du tronçon
 * entrant et le début de celle du tronçon sortant), repère local. `k` : coin K ; `u` : direction
 * du tronçon entrant ; `n` : normale jour → mur de ce tronçon.
 */
export function wellTurnSegments(
  well: SupportedWell,
  side: Side,
  k: Vec2,
  u: Vec2,
  n: Vec2,
): CurveSeg[] {
  const turnSign = side === "left" ? 1 : -1;
  switch (well.kind) {
    case "sharp":
      return [];
    case "arc": {
      const r = well.radius;
      const center = V.sub(V.sub(k, V.scale(n, r)), V.scale(u, r));
      return [arcSeg(center, r, V.angleOf(n), (turnSign * Math.PI) / 2)];
    }
    case "newel": {
      // Coordonnées (α, β) dans la base (n, u) centrée sur K ; poteau α, β ∈ [−s ; p]
      // (s = a/2 + δ côté jour, p = a/2 − δ côté marches, `newel.ts`).
      const s = newelSetback(well);
      const p = newelProtrusion(well);
      const pt = (a: number, b: number): Vec2 => V.add(V.add(k, V.scale(n, a)), V.scale(u, b));
      const pts = [pt(0, -s), pt(p, -s), pt(p, p), pt(-s, p), pt(-s, 0)];
      const segs: CurveSeg[] = [];
      for (let i = 0; i + 1 < pts.length; i++) segs.push(lineSeg(pts[i]!, pts[i + 1]!));
      return segs;
    }
  }
}

/**
 * Arc de la ligne de foulée Γ dans la jonction : centre F = K − r·n − r·u (r : rayon du raccord
 * de jour en arc, 0 sinon, donc K pour un angle vif ou un poteau), rayon r + d_f, balayage ±π/2.
 * Rend le segment et sa longueur.
 */
export function walklineArc(
  well: SupportedWell,
  side: Side,
  frame: SectionFrame,
  width: Mm,
  df: Mm,
): { readonly seg: CurveSeg; readonly length: Mm } {
  const r = walkSetback(well);
  const n = collarNormal(frame, side);
  const center = V.sub(V.sub(wellCorner(frame, side, width), V.scale(n, r)), V.scale(frame.u, r));
  const radius = r + df;
  const sign = side === "left" ? 1 : -1;
  return {
    seg: arcSeg(center, radius, V.angleOf(n), (sign * Math.PI) / 2),
    length: (radius * Math.PI) / 2,
  };
}
