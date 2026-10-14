/**
 * **Réservé aux tests, retiré après P3** (F10, sous-lot P2, ADR-0010).
 *
 * Copie figée de l'ancien chemin hélicoïdal, à l'état du commit 67672d2 (avant la bascule) :
 * tracé (`computeHelicalLayout`, `layout/helical.ts`) et découpage (`computeHelicalStepping`,
 * `stepping/helical.ts`), fonctions renommées `legacy*`. Depuis P2, `computeLayout` convertit un
 * hélicoïdal en cage (`helicalToCage`) et le calcule par le moteur de cage ; cette copie sert de
 * référence aux tests de parité (`layout/cage/helicalParity.test.ts`,
 * `pipeline/helicalSwitch.parity.test.ts`, `layout/cage/parity.test.ts`). Ne doit être importée
 * que par des tests ou leurs assistants (vérifié par `legacyHelical.test.ts`) ; **copie figée,
 * ne pas corriger ce fichier : il sert de référence** (sur le modèle de `legacyFlights.ts`,
 * sous-lot 1c).
 *
 * Imports : primitives partagées non visées par P2 (`geom2d/*`, `layout/resolve.ts`,
 * `stepping/rises.ts`, i18n) ; aucun import de `layout/helical.ts` ni de `stepping/helical.ts`,
 * pour que P3 puisse les retirer sans toucher la référence. L'échappée (`headroom/selfcover.ts`)
 * n'est pas copiée : le départage des minima ex æquo (décision F10 (3)) vaut pour les deux
 * chemins.
 *
 * Conventions : voir les en-têtes de `layout/helical.ts` et `stepping/helical.ts` (commit
 * 67672d2).
 */
import type {
  HelicalLayout,
  Layout,
  NosingLine,
  Soffit,
  Stepping,
  Tread,
} from "../model/derived.js";
import type { Mm, Polygon2, Rad, Vec2 } from "../model/primitives.js";
import type { HelicalLayoutSpec, Project } from "../model/project.js";
import { arcPoints, discPolygon, sectorRing, splitArc } from "../geom2d/arc.js";
import { makeCurve } from "../geom2d/curve.js";
import { ensureCCW } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import { dec, msg, type Message } from "@blondel/i18n";
import { LayoutError } from "./errors.js";
import { resolveRiserCount, resolveWalklineOffset } from "./resolve.js";
import { SteppingError } from "../stepping/errors.js";
import { computeRises } from "../stepping/rises.js";

const disc = discPolygon;

const DEG = Math.PI / 180;

// ------------------------------------------------------------------ tracé (layout/helical.ts)

/** Signe du sens de rotation : +1 à gauche (trigonométrique), −1 à droite. */
function helicalSign(h: Pick<HelicalLayout, "direction">): 1 | -1 {
  return h.direction === "left" ? 1 : -1;
}

/** Angle (repère monde) du rayon situé à la progression `u` (rad, ≥ 0) depuis le nez 0. */
function helicalAngleAt(h: HelicalLayout, u: Rad): Rad {
  return h.startAngle + helicalSign(h) * u;
}

/** Point à la distance `radius` de l'axe, sur le rayon d'angle `angle`. */
function helicalPoint(h: Pick<HelicalLayout, "center">, radius: Mm, angle: Rad): Vec2 {
  return V.addScaled(h.center, V.fromAngle(angle), radius);
}

/**
 * Angle par marche Δθ et angle total Θ = (n − 1)·Δθ.
 * @throws LayoutError si Δθ n'est pas dans ]0 ; 180°[.
 */
export function legacyHelicalStepAngle(spec: HelicalLayoutSpec, riserCount: number): Rad {
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
 * Tracé d'un escalier hélicoïdal, repère monde (copie figée de `computeHelicalLayout`).
 * @throws LayoutError si n sort du domaine, si la ligne de foulée sort de l'emmarchement ou si
 *   l'angle par marche est impossible.
 */
export function legacyComputeHelicalLayout(project: Project, spec: HelicalLayoutSpec): Layout {
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
  const step = legacyHelicalStepAngle(spec, n);
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

// ------------------------------------------------------------------ découpage (stepping/helical.ts)

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
 * supérieur de `depth` (copie figée de `helicalTreadOutline`).
 */
export function legacyHelicalTreadOutline(h: HelicalLayout, u0: Rad, u1: Rad, depth: Mm): Polygon2 {
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
 * Découpage d'un tracé hélicoïdal (copie figée de `computeHelicalStepping`).
 * @throws LayoutError si n sort du domaine ; SteppingError si les hauteurs sont impossibles ou si
 *   le débord de nez atteint le rayon du fût ou du jour.
 */
export function legacyComputeHelicalStepping(project: Project, layout: Layout): Stepping {
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
    const outline = legacyHelicalTreadOutline(h, k * step, (k + 1) * step, depth);
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
