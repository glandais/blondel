/**
 * Découpage d'un escalier **hélicoïdal** (jalon 5a, B §1.1, §4.3) : `computeStepping` pour un
 * tracé qui porte `layout.helical`.
 *
 * - Hauteurs : `computeRises` (même règle que les escaliers à volées, Σh = H exactement).
 * - Nez : n lignes de nez **rayonnantes** (aucun balancement) aux angles θ_k = θ_0 + sens·k·Δθ ;
 *   P_k sur Γ (rayon r_w), Q_k sur C_i (r_i), R_k sur C_e (R_e), direction radiale sortante.
 *   Abscisses : s_k = r_w·k·Δθ, σ(Q_k) = r_i·k·Δθ, σ(R_k) = R_e·k·Δθ.
 * - Marches (toutes « balancées » au sens de `TreadKind` : marches dansantes rayonnantes) :
 *   giron r_w·Δθ (égal pour toutes), collet en arc r_i·Δθ et en corde 2·r_i·sin(Δθ/2), giron
 *   extérieur R_e·Δθ. Surface de marche = secteur de couronne entre les nez k et k + 1 ; contour
 *   de pièce prolongé sous le nez supérieur du débord `treads.nosing` (même convention que
 *   `outlineBetween`) : bord arrière = droite parallèle au rayon du nez k + 1, décalée du débord
 *   vers le haut de l'escalier, coupée sur C_i et C_e (angles asin(d / r)).
 * - Sous-faces (`Stepping.soffits`, CHALLENGE G4) : chaque marche (contour de pièce, altitude
 *   z_k − `treads.thickness`) et le palier d'arrivée (secteur, altitude H − `treads.thickness`,
 *   épaisseur supposée égale à celle des marches, à valider) forment un plafond pour les parties
 *   de l'escalier situées un tour plus bas (`headroom/`).
 */
import { arcPoints, helicalAngleAt, helicalPoint, helicalSign } from "../layout/helical.js";
import type {
  HelicalLayout,
  Layout,
  NosingLine,
  Soffit,
  Stepping,
  Tread,
} from "../model/derived.js";
import type { Mm, Polygon2, Rad } from "../model/primitives.js";
import type { Project } from "../model/project.js";
import { ensureCCW } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import { dec, msg, type Message } from "@blondel/i18n";
import { SteppingError } from "./errors.js";
import { computeRises } from "./rises.js";

const DEG = Math.PI / 180;

/** Ligne de nez rayonnante k. */
function nosingAt(h: HelicalLayout, k: number, z: Mm): NosingLine {
  const u = k * h.stepAngle;
  const angle = helicalAngleAt(h, u);
  return {
    index: k,
    s: h.walklineRadius * u,
    p: helicalPoint(h, h.walklineRadius, angle),
    dir: V.fromAngle(angle),
    q: helicalPoint(h, h.innerRadius, angle),
    r: helicalPoint(h, h.outerRadius, angle),
    sigmaInner: h.innerRadius * u,
    sigmaOuter: h.outerRadius * u,
    z,
    balanced: false,
  };
}

/** Surface de marche entre les progressions u0 et u1 (secteur de couronne), CCW. */
function sectorBetween(h: HelicalLayout, u0: Rad, u1: Rad): Polygon2 {
  const sign = helicalSign(h);
  const a0 = helicalAngleAt(h, u0);
  const sweep = sign * (u1 - u0);
  const inner = arcPoints(h.center, h.innerRadius, a0, sweep);
  const outer = arcPoints(h.center, h.outerRadius, a0 + sweep, -sweep);
  return ensureCCW([...inner, ...outer]);
}

/**
 * Contour de pièce de la marche entre les nez de progression u0 et u1, prolongé sous le nez
 * supérieur de `depth` : le bord arrière est la droite parallèle au rayon u1 décalée de `depth`
 * vers le haut de l'escalier ; elle coupe le cercle de rayon r à l'angle u1 + asin(depth / r).
 */
export function helicalTreadOutline(h: HelicalLayout, u0: Rad, u1: Rad, depth: Mm): Polygon2 {
  if (!(depth > 0)) return sectorBetween(h, u0, u1);
  const sign = helicalSign(h);
  const a0 = helicalAngleAt(h, u0);
  const ui = u1 + Math.asin(depth / h.innerRadius);
  const ue = u1 + Math.asin(depth / h.outerRadius);
  const inner = arcPoints(h.center, h.innerRadius, a0, sign * (ui - u0));
  const outer = arcPoints(h.center, h.outerRadius, helicalAngleAt(h, ue), -sign * (ue - u0));
  return ensureCCW([...inner, ...outer]);
}

/**
 * Découpage d'un tracé hélicoïdal.
 * @throws LayoutError si n sort du domaine ; SteppingError si les hauteurs sont impossibles ou si
 *   le débord de nez atteint le rayon du fût ou du jour.
 */
export function computeHelicalStepping(project: Project, layout: Layout): Stepping {
  const h = layout.helical;
  if (!h) throw new SteppingError(msg("stepping.helical.flightLayout"));
  const { riserCount: n, rise, rises, z } = computeRises(project);
  const depth = project.stair.treads.nosing;
  const thickness = project.stair.treads.thickness;
  if (!(depth < h.innerRadius)) {
    throw new SteppingError(
      msg(
        h.core === "column"
          ? "stepping.helical.nosingReachesColumn"
          : "stepping.helical.nosingReachesWell",
        { depth: String(depth), radius: String(h.innerRadius) },
      ),
    );
  }
  const step = h.stepAngle;
  const going = h.walklineRadius * step;
  const nosings = Array.from({ length: n }, (_, k) => nosingAt(h, k, z[k]!));

  const treads: Tread[] = [];
  const soffits: Soffit[] = [];
  for (let k = 0; k + 1 < n; k++) {
    const a = nosings[k]!;
    const outline = helicalTreadOutline(h, k * step, (k + 1) * step, depth);
    treads.push({
      number: k + 1,
      kind: "winder",
      z: a.z,
      walkingSurface: sectorBetween(h, k * step, (k + 1) * step),
      outline,
      going,
      colletArc: h.innerRadius * step,
      colletChord: 2 * h.innerRadius * Math.sin(step / 2),
      goingOuter: h.outerRadius * step,
    });
    soffits.push({ outline, z: a.z - thickness, sStart: a.s, tread: k + 1 });
  }
  if (h.landingOutline) {
    const last = nosings[n - 1]!;
    soffits.push({ outline: h.landingOutline, z: last.z - thickness, sStart: last.s });
  }

  const notes: Message[] = [
    msg("stepping.helical.summary", {
      stepAngle: dec(step / DEG),
      treadsPerTurn: dec(h.treadsPerTurn),
      totalAngle: dec(h.totalAngle / DEG),
      going: dec(going),
      walklineRadius: dec(h.walklineRadius),
      collet: dec(h.innerRadius * step),
    }),
  ];
  // Réglages propres aux escaliers à volées : jamais ignorés en silence (CHALLENGE A4).
  const { targetGoing } = project.stair.stepping;
  if (targetGoing !== "auto") {
    notes.push(
      msg("stepping.helical.targetGoingIgnored", {
        target: dec(targetGoing),
        going: dec(going),
      }),
    );
  }
  for (const o of project.stair.nosingOverrides) {
    notes.push(
      msg("stepping.helical.overrideIgnored", {
        kind: msg(o.kind === "fixed" ? "stepping.override.fixed" : "stepping.override.angle"),
        nosing: o.index,
      }),
    );
  }
  return {
    riserCount: n,
    rises,
    rise,
    going,
    blondel: 2 * rise + going,
    run: nosings[n - 1]!.s - nosings[0]!.s,
    nosings,
    treads,
    balancedZones: [],
    notes,
    soffits,
    helical: true,
  };
}
