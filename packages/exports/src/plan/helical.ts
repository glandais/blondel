/**
 * Plan d'un escalier **hélicoïdal** (jalon 5a) : marches en secteur de couronne à arcs exacts
 * (bord intérieur C_i et extérieur C_e concentriques), palier d'arrivée en secteur, position des
 * numéros de marche par tour (les tours supérieurs recouvrent les tours inférieurs en plan) et
 * lignes du cartouche. Présentation seulement : la géométrie vient de `Layout.helical`.
 */
import {
  helicalAngleAt,
  helicalPoint,
  type HelicalLayout,
  type Mm,
  type Vec2,
} from "@blondel/core";
import { formatFr } from "../format.js";
import type { PathVertex, PlanPath } from "../path.js";

/** Balayage maximal d'un tronçon d'arc des chemins produits ici (SVG : pas de grand arc). */
const MAX_PIECE: number = Math.PI / 2;
const DEG = 180 / Math.PI;

/** Sommets d'un arc (centre de l'hélicoïdal) de l'angle `a0` à `a0 + sweep`, extrémité exclue. */
function arcVertices(h: HelicalLayout, radius: Mm, a0: number, sweep: number): PathVertex[] {
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / MAX_PIECE - 1e-12));
  const step = sweep / count;
  const bulge = Math.tan(step / 4);
  const out: PathVertex[] = [];
  for (let i = 0; i < count; i++) {
    const p = helicalPoint(h, radius, a0 + i * step);
    out.push({ x: p.x, y: p.y, bulge });
  }
  return out;
}

/**
 * Secteur de couronne fermé (r_in ≤ r ≤ r_out, angles de `a0` à `a0 + sweep`, signé) à arcs
 * exacts : bord intérieur au départ, rayon, arc extérieur, rayon, arc intérieur de retour.
 */
export function sectorPath(
  h: HelicalLayout,
  rIn: Mm,
  rOut: Mm,
  a0: number,
  sweep: number,
): PlanPath {
  const a1 = a0 + sweep;
  const outer = arcVertices(h, rOut, a0, sweep);
  const inner = arcVertices(h, rIn, a1, -sweep);
  // Rayon de départ (intérieur → extérieur) puis arc extérieur ; rayon d'arrivée puis retour.
  const start = helicalPoint(h, rIn, a0);
  const end = helicalPoint(h, rOut, a1);
  return {
    vertices: [
      { x: start.x, y: start.y, bulge: 0 },
      ...outer,
      { x: end.x, y: end.y, bulge: 0 },
      ...inner,
    ],
    closed: true,
  };
}

/** Angle du nez k (repère monde). */
function nosingAngle(h: HelicalLayout, k: number): number {
  return helicalAngleAt(h, k * h.stepAngle);
}

/** Surface de la marche `number` (entre les nez number − 1 et number), secteur à arcs exacts. */
export function helicalTreadPath(h: HelicalLayout, number: number): PlanPath {
  const a0 = nosingAngle(h, number - 1);
  const a1 = nosingAngle(h, number);
  return sectorPath(h, h.innerRadius, h.outerRadius, a0, a1 - a0);
}

/** Palier d'arrivée (secteur de `landingAngle` à partir du nez d'arrivée), s'il existe. */
export function helicalLandingPath(h: HelicalLayout): PlanPath | undefined {
  if (!(h.landingAngle > 0)) return undefined;
  const sign = h.direction === "left" ? 1 : -1;
  const a0 = helicalAngleAt(h, h.totalAngle);
  return sectorPath(h, h.innerRadius, h.outerRadius, a0, sign * h.landingAngle);
}

/** Nombre de tours couverts par les marches (au moins 1). */
export function helicalTurnCount(h: HelicalLayout): number {
  return Math.max(1, Math.ceil(h.totalAngle / (2 * Math.PI) - 1e-9));
}

/**
 * Position du numéro de la marche `number` : au milieu angulaire de la marche, sur un anneau
 * propre à son tour (premier tour à l'extérieur, tours suivants vers l'axe) pour que les numéros
 * des marches superposées en plan restent lisibles. Sur un seul tour : entre la ligne de foulée
 * et le bord extérieur, comme les escaliers à volées.
 */
export function helicalLabelPoint(h: HelicalLayout, number: number): Vec2 {
  const u = (number - 0.5) * h.stepAngle;
  const turns = helicalTurnCount(h);
  const width = h.outerRadius - h.innerRadius;
  const radius =
    turns === 1
      ? (h.walklineRadius + h.outerRadius) / 2
      : h.innerRadius +
        width * (1 - (Math.min(turns - 1, Math.floor(u / (2 * Math.PI))) + 0.5) / turns);
  return helicalPoint(h, radius, helicalAngleAt(h, u));
}

const fr = (v: number, d = 0): string => formatFr(v, { decimals: d, thousands: " " });

/** Lignes du cartouche propres à l'hélicoïdal. */
export function helicalCartouche(h: HelicalLayout): string[] {
  const core = h.core === "column" ? "fût" : "jour central";
  const lines = [
    `Hélicoïdal (${h.direction === "left" ? "à gauche" : "à droite"}) : R_e = ${fr(h.outerRadius)} mm, ${core} r = ${fr(h.innerRadius)} mm, ligne de foulée à r = ${fr(h.walklineRadius, 1)} mm`,
    `Angle par marche ${fr(h.stepAngle * DEG, 1)}° (${fr(h.treadsPerTurn, 1)} marches par tour), rotation des marches ${fr(h.totalAngle * DEG, 1)}°`,
  ];
  if (h.landingAngle > 0)
    lines.push(`Palier d'arrivée en secteur de ${fr(h.landingAngle * DEG, 1)}°`);
  return lines;
}
