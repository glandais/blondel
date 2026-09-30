/**
 * M2 — méthode de la herse / « Winkelmethode » (B §3.4, SPEC Q9 : option V1, α borné,
 * avertissement sur le raccord).
 *
 * Construction de proportion (projection centrale) : sur une demi-zone, entre un nez fixe et
 * l'angle, les girons de la ligne de foulée (longueur W = m·g) sont reportés sur une droite
 * inclinée de α ; la droite joignant son extrémité B_m au bout A de la ligne des collets (de
 * longueur L_c, longueur de jour de la demi-zone) coupe la verticale de l'origine en S ; chaque
 * point B_w = w·(cos α, sin α) est projeté depuis S sur la ligne des collets (formule fermée de
 * B §3.4, vérifiée numériquement) :
 *
 *   y_S = W·sin α · L_c / (L_c − W·cos α),   t = −y_S / (w·sin α − y_S),   x(w) = t·w·cos α.
 *
 * x(0) = 0 et x(W) = L_c ; les collets décroissent vers l'angle tant que α < α_eq =
 * arccos(L_c / W) (équipartition à α_eq, progression inversée au-delà : inutilisable). Le
 * paramètre `alpha` (degrés) doit donc rester dans ]0 ; α_eq[ **pour chaque demi-zone** :
 * sinon la stratégie échoue en donnant la borne (curseur borné par `herseAlphaMax`).
 *
 * La herse ne raccorde **jamais** la partie droite : le premier collet vaut au plus
 * g·K/(1 + K) < g (B §3.4) ; le saut de collet en entrée de zone est signalé par le découpage.
 *
 * Découpage de la zone [a ; b] [ANALYSE, choix Blondel] : demi-zones séparées par le point
 * d'angle de chaque tournant (milieu de la partie tournante de Γ et sa projection σ_A sur le
 * jour, comme M1 ; « tracer la bissectrice de l'angle, en cas d'asymétrie répartir au
 * prorata ») et, dans une zone unique de 180°, par le milieu entre deux angles ; chaque
 * demi-zone reçoit sa herse depuis son extrémité opposée à l'angle (« recommencer après
 * l'angle »). Les nez ne tombant pas sur l'angle, w est le giron cumulé (réel) depuis
 * l'extrémité : la construction est la même, avec W non entier en girons.
 *
 * Paramètres (`BalancingInput.params`) : `alpha` (degrés, défaut `HERSE_DEFAULT_ANGLE`) ;
 * `cornerSigma` (σ_A imposé, zone à un seul angle).
 */
import { msg } from "@blondel/i18n";
import { curvePointAt } from "../geom2d/curve.js";
import { projectOnCurve } from "../geom2d/intersect.js";
import type { BalancingInput, BalancingSolution, BalancingStrategy } from "../model/plugins.js";
import type { Mm } from "../model/primitives.js";
import { numberParam, zoneEnds, zoneTurns } from "./zone.js";

/**
 * Angle par défaut de la herse (degrés) : « environ 20° » dans la construction de trepedia
 * (B §3.4, [4], USAGE, confiance moyenne). Paramètre du projet (`BalancingSchema.herseAngle`).
 */
export const HERSE_DEFAULT_ANGLE = 20;

const DEG = Math.PI / 180;

/**
 * Borne supérieure de α (radians) pour une demi-zone : α_eq = arccos(L_c / W). `0` si le jour
 * est au moins aussi long que la ligne de foulée (L_c ≥ W : aucune herse décroissante).
 */
export function herseAlphaBound(lc: Mm, w: Mm): number {
  if (!(lc > 0) || !(w > lc)) return 0;
  return Math.acos(lc / w);
}

/**
 * Projection centrale de la herse : abscisse x(w) sur la ligne des collets du point B_w de la
 * ligne inclinée (w ∈ [0 ; W]). Précondition : 0 < α < α_eq.
 */
export function herseMap(lc: Mm, total: Mm, alpha: number): (w: Mm) => Mm {
  const sin = Math.sin(alpha);
  const cos = Math.cos(alpha);
  const yS = (total * sin * lc) / (lc - total * cos);
  return (w) => {
    if (w <= 0) return 0;
    const t = -yS / (w * sin - yS);
    return t * w * cos;
  };
}

/**
 * Collets de la herse discrète de B §3.4 : m girons g, longueur de jour L_c, angle α (rad).
 * Exemple de B : 740 mm, 5 × 225,8 mm, α = 20° → 195 / 166 / 144 / 125 / 110 mm.
 */
export function herseCollets(lc: Mm, m: number, g: Mm, alpha: number): Mm[] {
  const x = herseMap(lc, m * g, alpha);
  return Array.from({ length: m }, (_, i) => x((i + 1) * g) - x(i * g));
}

/** Point de rupture de la zone : abscisses sur Γ et sur le jour, angle ou non. */
interface Breakpoint {
  readonly s: Mm;
  readonly sigma: Mm;
  corner: boolean;
}

/** Demi-zones de la zone : suite de points de rupture de s_a à s_b. */
function breakpoints(input: BalancingInput): Breakpoint[] {
  const { a, b, sigmaA, sigmaB } = zoneEnds(input);
  const sa = input.nosings[a]!.s;
  const sb = input.nosings[b]!.s;
  const { layout } = input;
  const project = (s: Mm): Mm => projectOnCurve(curvePointAt(layout.walkline, s), layout.inner).s;
  const turns = zoneTurns(input);
  const mids = turns.map((j) => (layout.turns[j]!.sStart + layout.turns[j]!.sEnd) / 2);
  const given = turns.length === 1 ? numberParam(input, "cornerSigma") : undefined;
  const inner: Breakpoint[] = [];
  mids.forEach((sm, i) => {
    if (i > 0) {
      const mm = (mids[i - 1]! + sm) / 2;
      inner.push({ s: mm, sigma: project(mm), corner: false });
    }
    inner.push({ s: sm, sigma: given ?? project(sm), corner: true });
  });
  const pts: Breakpoint[] = [{ s: sa, sigma: sigmaA, corner: false }];
  for (const p of inner) {
    if (p.s <= sa) {
      if (p.corner) pts[0]!.corner = true;
      continue;
    }
    if (p.s >= sb) {
      if (p.corner) pts.push({ s: sb, sigma: sigmaB, corner: true });
      continue;
    }
    pts.push({ s: p.s, sigma: Math.min(sigmaB, Math.max(sigmaA, p.sigma)), corner: p.corner });
  }
  const last = pts[pts.length - 1]!;
  if (last.s < sb) pts.push({ s: sb, sigma: sigmaB, corner: false });
  return pts;
}

function alphaOf(input: BalancingInput): number {
  return (numberParam(input, "alpha") ?? HERSE_DEFAULT_ANGLE) * DEG;
}

/**
 * Borne supérieure de α (degrés) pour la zone : plus petite α_eq de ses demi-zones ; `0` si
 * aucune herse n'est possible. Sert à borner le curseur de l'interface.
 */
export function herseAlphaMax(input: BalancingInput): number {
  const pts = breakpoints(input);
  let bound = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const w = pts[i + 1]!.s - pts[i]!.s;
    const lc = pts[i + 1]!.sigma - pts[i]!.sigma;
    if (!(w > 1e-9)) continue;
    bound = Math.min(bound, herseAlphaBound(lc, w));
  }
  return Number.isFinite(bound) ? bound / DEG : 0;
}

function solve(input: BalancingInput): BalancingSolution {
  const { a, b } = zoneEnds(input);
  const alpha = alphaOf(input);
  if (!(alpha > 0 && alpha < Math.PI / 2)) {
    return {
      kind: "fail",
      reason: msg("balancing.m2.fail.invalidAngle", { angle: String(alpha / DEG) }),
    };
  }
  const pts = breakpoints(input);
  const maps: ((s: Mm) => Mm)[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[i + 1]!;
    const w = q.s - p.s;
    const lc = q.sigma - p.sigma;
    if (!(w > 1e-9)) {
      maps.push(() => p.sigma);
      continue;
    }
    if (!(lc > 0)) {
      return { kind: "fail", reason: msg("balancing.fail.zeroWellLength", { a, b }) };
    }
    const bound = herseAlphaBound(lc, w);
    if (!(alpha < bound)) {
      return {
        kind: "fail",
        reason:
          bound > 0
            ? msg("balancing.m2.fail.angleOutOfRange", {
                angle: (alpha / DEG).toFixed(1),
                max: (bound / DEG).toFixed(1),
              })
            : msg("balancing.m2.fail.wellLongerThanWalkline"),
      };
    }
    if (q.corner && !p.corner) {
      const x = herseMap(lc, w, alpha);
      maps.push((s) => p.sigma + x(s - p.s));
    } else if (p.corner && !q.corner) {
      const x = herseMap(lc, w, alpha);
      maps.push((s) => q.sigma - x(q.s - s));
    } else {
      // Pas d'angle dans cette partie (zone sans tournant) : équipartition.
      maps.push((s) => p.sigma + (lc * (s - p.s)) / w);
    }
  }
  const sigma: Mm[] = [];
  for (let k = a + 1; k < b; k++) {
    const s = input.nosings[k]!.s;
    let i = 0;
    while (i + 1 < maps.length && s > pts[i + 1]!.s) i++;
    sigma.push(maps[i]!(s));
  }
  return { kind: "sigma", sigma };
}

export const M2_STRATEGY: BalancingStrategy = {
  id: "M2",
  labelKey: "balancing.m2.label",
  solve,
};
