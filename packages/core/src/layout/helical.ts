/**
 * Tracé **hélicoïdal** (jalon 5a, B §1.1, §2.2, §4.3) : `computeLayout` pour
 * `stair.layout.kind = "helical"`.
 *
 * - Axe vertical au point (0, 0) du repère local, placé par `stair.placement` (origine = axe,
 *   rotation autour de l'axe).
 * - C_i : arc de rayon r_i = r_f (fût) ou r_j (jour) ; C_e : arc de rayon R_e ; Γ : arc
 *   concentrique de rayon r_w = r_i + d_f. Les trois arcs couvrent l'angle total des marches
 *   Θ = (n − 1)·Δθ, du nez de départ au nez d'arrivée, dans le sens de la montée
 *   (trigonométrique pour `left`, horaire pour `right`). Ils sont découpés en arcs d'au plus 90°
 *   pour que les algorithmes génériques (intersections, sous-courbes) ne voient jamais un arc de
 *   plus d'un demi-tour.
 * - d_f : même règle que les escaliers à volées (`resolveWalklineOffset`, DTU sur
 *   l'emmarchement E = R_e − r_i, ou `fromInner`). Les sources divergent pour l'hélicoïdal (B §2.2 :
 *   « 50 cm de l'axe », « 60 cm du fût ») : c'est un paramètre (`walkline.fromInner`), point en
 *   suspens au ledger.
 * - Δθ : angle total imposé (Θ / (n − 1)) ou nombre de marches par tour N (2π / N). Aucun
 *   balancement : lignes de nez rayonnantes, girons égaux sur Γ (r_w·Δθ), collet r_i·Δθ.
 * - `turns` est vide (aucun tournant à 90°) ; `innerSide` = sens de rotation (l'axe est du côté
 *   intérieur).
 * - Emprise : secteur de couronne des marches et du palier d'arrivée (r_i ≤ r ≤ R_e) si
 *   Θ + Λ < 2π, disque de rayon R_e sinon (l'escalier se recouvre lui-même ; `Polygon2` n'a pas
 *   de trou).
 */
import type { HelicalLayout, Layout } from "../model/derived.js";
import type { Mm, Rad, Vec2 } from "../model/primitives.js";
import type { HelicalLayoutSpec, Project } from "../model/project.js";
import { arcPoints, discPolygon, sectorRing, splitArc } from "../geom2d/arc.js";
import { makeCurve } from "../geom2d/curve.js";
import * as V from "../geom2d/vec.js";
import { msg } from "@blondel/i18n";
import { LayoutError } from "./errors.js";
import { resolveRiserCount, resolveWalklineOffset } from "./resolve.js";

// Primitives d'arc (découpage à 90°, points, secteur, disque) : `geom2d/arc.ts`, partagées avec
// le moteur de cage (F10, sous-lot P1) ; réexportées ici pour les appelants existants.
export { arcPoints, sectorRing, splitArc };
const disc = discPolygon;

const DEG = Math.PI / 180;

/** Signe du sens de rotation : +1 à gauche (trigonométrique), −1 à droite. */
export function helicalSign(h: Pick<HelicalLayout, "direction">): 1 | -1 {
  return h.direction === "left" ? 1 : -1;
}

/** Angle (repère monde) du rayon situé à la progression `u` (rad, ≥ 0) depuis le nez 0. */
export function helicalAngleAt(h: HelicalLayout, u: Rad): Rad {
  return h.startAngle + helicalSign(h) * u;
}

/** Point à la distance `radius` de l'axe, sur le rayon d'angle `angle`. */
export function helicalPoint(h: Pick<HelicalLayout, "center">, radius: Mm, angle: Rad): Vec2 {
  return V.addScaled(h.center, V.fromAngle(angle), radius);
}

/**
 * Angle par marche Δθ et angle total Θ = (n − 1)·Δθ.
 * @throws LayoutError si Δθ n'est pas dans ]0 ; 180°[.
 */
export function helicalStepAngle(spec: HelicalLayoutSpec, riserCount: number): Rad {
  const goings = riserCount - 1;
  const step =
    spec.sweep.mode === "angle"
      ? (spec.sweep.degrees * DEG) / goings
      : (2 * Math.PI) / spec.sweep.count;
  if (!(step > 0 && step < Math.PI)) {
    throw new LayoutError(
      msg("layout.helical.invalidStepAngle", { angle: (step / DEG).toFixed(1) }),
    );
  }
  return step;
}

/**
 * Tracé d'un escalier hélicoïdal, repère monde.
 * @throws LayoutError si n sort du domaine, si la ligne de foulée sort de l'emmarchement ou si
 *   l'angle par marche est impossible.
 */
export function computeHelicalLayout(project: Project, spec: HelicalLayoutSpec): Layout {
  const n = resolveRiserCount(project);
  const rIn = spec.core.radius;
  const rOut = spec.outerRadius;
  if (!(rOut > rIn)) {
    throw new LayoutError(
      msg(
        spec.core.kind === "column"
          ? "layout.helical.outerRadiusBelowColumn"
          : "layout.helical.outerRadiusBelowWell",
        { outer: String(rOut), inner: String(rIn) },
      ),
    );
  }
  const df = resolveWalklineOffset(project);
  const rWalk = rIn + df;
  const step = helicalStepAngle(spec, n);
  const total = (n - 1) * step;
  const sign = spec.direction === "left" ? 1 : -1;

  const { origin, rotation } = project.stair.placement;
  const center: Vec2 = { x: origin.x, y: origin.y };
  const start = (spec.startAngle + rotation) * DEG;
  const sweep = sign * total;

  const inner = makeCurve(splitArc(center, rIn, start, sweep));
  const outer = makeCurve(splitArc(center, rOut, start, sweep));
  const walkline = makeCurve(splitArc(center, rWalk, start, sweep));

  const landingAngle = spec.landing ? spec.landing.angle * DEG : 0;
  const landingOutline =
    landingAngle > 0
      ? sectorRing(center, rIn, rOut, start + sweep, sign * landingAngle)
      : undefined;
  // Emprise : marches **et** palier d'arrivée (partie de l'escalier, comme les paliers des
  // escaliers à volées).
  const covered = total + landingAngle;
  // Au-delà d'un tour, disque de R_e troué du jour central de R_i (`footprintHoles`, D3).
  const partial = covered < 2 * Math.PI - 1e-9;
  const footprint = partial
    ? sectorRing(center, rIn, rOut, start, sign * covered)
    : disc(center, rOut);
  const footprintHoles = !partial && rIn > 0 ? [disc(center, rIn)] : undefined;

  const helical: HelicalLayout = {
    center,
    direction: spec.direction,
    core: spec.core.kind,
    innerRadius: rIn,
    outerRadius: rOut,
    walklineRadius: rWalk,
    startAngle: start,
    stepAngle: step,
    treadsPerTurn: (2 * Math.PI) / step,
    totalAngle: total,
    landingAngle,
    ...(landingOutline ? { landingOutline } : {}),
  };
  return {
    inner,
    outer,
    walkline,
    walklineOffset: df,
    footprint,
    ...(footprintHoles ? { footprintHoles } : {}),
    turns: [],
    innerSide: spec.direction,
    helical,
  };
}
