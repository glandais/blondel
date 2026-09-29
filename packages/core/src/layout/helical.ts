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
import type { CurveSeg, Mm, Polygon2, Rad, Vec2 } from "../model/primitives.js";
import type { HelicalLayoutSpec, Project } from "../model/project.js";
import { flattenCurve, makeCurve } from "../geom2d/curve.js";
import { ensureCCW } from "../geom2d/polygon.js";
import { arcSeg } from "../geom2d/segment.js";
import * as V from "../geom2d/vec.js";
import { LayoutError } from "./errors.js";
import { resolveRiserCount, resolveWalklineOffset } from "./resolve.js";

/** Balayage maximal d'un arc élémentaire des bords et de Γ. */
const MAX_ARC_SWEEP: Rad = Math.PI / 2;
/** Flèche de discrétisation des contours (mm), comme les marches des escaliers à volées. */
const CHORD_TOL: Mm = 0.1;

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

/** Arc découpé en arcs élémentaires d'au plus 90°. */
export function splitArc(center: Vec2, radius: Mm, start: Rad, sweep: Rad): CurveSeg[] {
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / MAX_ARC_SWEEP - 1e-12));
  const step = sweep / count;
  return Array.from({ length: count }, (_, i) => arcSeg(center, radius, start + i * step, step));
}

/** Points d'un arc (flèche ≤ 0,1 mm), extrémités comprises. */
export function arcPoints(center: Vec2, radius: Mm, start: Rad, sweep: Rad): Vec2[] {
  if (sweep === 0) return [V.addScaled(center, V.fromAngle(start), radius)];
  return flattenCurve(makeCurve(splitArc(center, radius, start, sweep)), CHORD_TOL);
}

/** Secteur de couronne (r_in ≤ r ≤ r_out, angles de `start` à `start + sweep`), CCW. */
export function sectorRing(center: Vec2, rIn: Mm, rOut: Mm, start: Rad, sweep: Rad): Polygon2 {
  const outer = arcPoints(center, rOut, start, sweep);
  const inner = arcPoints(center, rIn, start, sweep).reverse();
  return ensureCCW([...outer, ...inner]);
}

/** Disque (polygone inscrit, flèche ≤ 0,1 mm), CCW. */
function disc(center: Vec2, radius: Mm): Polygon2 {
  const pts = arcPoints(center, radius, 0, 2 * Math.PI);
  pts.pop(); // dernier point = premier
  return ensureCCW(pts);
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
      `Angle par marche de l'hélicoïdal impossible (${(step / DEG).toFixed(1)}°) : il doit être compris entre 0 et 180°.`,
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
      `Le rayon extérieur de l'hélicoïdal (${rOut} mm) doit dépasser le rayon ${spec.core.kind === "column" ? "du fût" : "du jour"} (${rIn} mm).`,
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
  const footprint =
    covered < 2 * Math.PI - 1e-9
      ? sectorRing(center, rIn, rOut, start, sign * covered)
      : disc(center, rOut);

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
    turns: [],
    innerSide: spec.direction,
    helical,
  };
}
