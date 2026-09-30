/**
 * Relevé de trémie par **4 côtés + 2 diagonales** (CHALLENGE P7, jalon 7) : l'artisan mesure
 * AB, BC, CD, DA et les diagonales AC, BD d'une trémie à quatre coins A, B, C, D ; la fonction
 * déduit le quadrilatère.
 *
 * Cinq distances suffisent à fixer un quadrilatère à un déplacement près ; la sixième est
 * **redondante** et sert au contrôle. Méthode :
 * 1. A = (0, 0), B = (AB, 0) ; C par le triangle ABC, D par le triangle ACD, chacun des deux
 *    côtés possibles (angle saillant ou rentrant en B et en D) ;
 * 2. parmi les quatre quadrilatères, le simple parcouru dans le sens trigonométrique dont la
 *    diagonale BD s'accorde le mieux avec la mesure (trémie convexe ou non) ;
 * 3. ajustement aux moindres carrés des six mesures (Gauss-Newton amorti, A fixe, B sur l'axe) :
 *    les écarts résiduels mesure − calcul sont rendus pour chaque mesure, et le relevé est dit
 *    **cohérent** si le plus grand ne dépasse pas la tolérance ;
 * 4. seuil de détection par mesure (`detectable`) : une seule mesure est redondante, l'erreur
 *    d'une mesure se répartit donc sur les six écarts ; sur une trémie allongée, une erreur de
 *    plusieurs centimètres sur un petit côté reste « cohérente ». Le seuil est rendu pour que
 *    l'interface le dise (« cohérent » ne veut pas dire « juste »). Il est **exact** (QUESTIONS
 *    D6) : estimation linéarisée, puis dichotomie sur l'ajustement non linéaire, erreur des deux
 *    signes ; `detectable` rend le plus petit des deux seuils, `undetectable` le plus grand
 *    (angle mort annoncé à l'utilisateur) ; sur un quadrilatère mal conditionné, le seuil
 *    linéarisé s'écartait du seuil réel de plus de 25 % et les deux sens diffèrent (CD : 55 et
 *    84 mm sur l'exemple du ledger).
 *
 * La tolérance de cohérence n'est pas sourcée : paramètre, valeur par défaut « à valider »
 * (`SURVEY_TOLERANCE_DEFAULT`). Placement dans le site : A sur `origin`, AB selon `angle`.
 */
import { signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { Deg, Mm, Vec2 } from "../model/primitives.js";
import { isSelfIntersecting } from "./opening.js";

/**
 * Écart maximal (mm) entre une mesure et la trémie ajustée au-delà duquel le relevé est signalé
 * incohérent. Choix Blondel **à valider** (aucune source) : de l'ordre de la précision d'un
 * mètre ruban sur 3 m, sous la tolérance de trémie finie [0 ; +7 mm] du DTU 36.3 (A §1.7).
 */
export const SURVEY_TOLERANCE_DEFAULT: Mm = 5;

export interface OpeningSurvey {
  readonly ab: Mm;
  readonly bc: Mm;
  readonly cd: Mm;
  readonly da: Mm;
  /** Diagonale A–C. */
  readonly ac: Mm;
  /** Diagonale B–D. */
  readonly bd: Mm;
}

export type SurveyMeasure = keyof OpeningSurvey;
export const SURVEY_MEASURES: readonly SurveyMeasure[] = ["ab", "bc", "cd", "da", "ac", "bd"];

export interface SurveyOptions {
  /** Sens de parcours A → B → C → D vu de dessus (défaut : trigonométrique). */
  readonly orientation?: "ccw" | "cw";
  /** Position de A dans le site (défaut : origine). */
  readonly origin?: Vec2;
  /** Direction de AB dans le site (degrés depuis +X, défaut 0). */
  readonly angle?: Deg;
  /** Tolérance de cohérence (mm), défaut `SURVEY_TOLERANCE_DEFAULT`. */
  readonly tolerance?: Mm;
}

export type SurveyResult =
  | {
      readonly ok: true;
      /** Sommets A, B, C, D dans le repère du site, dans l'ordre du relevé. */
      readonly points: readonly [Vec2, Vec2, Vec2, Vec2];
      /** Écart mesure − distance ajustée, par mesure (mm). */
      readonly residuals: Readonly<Record<SurveyMeasure, Mm>>;
      readonly maxResidual: Mm;
      /** Vrai si `maxResidual` ≤ tolérance. */
      readonly consistent: boolean;
      /**
       * Seuil de détection (mm) par mesure : une erreur isolée plus petite, dans un sens comme
       * dans l'autre, laisse le relevé « cohérent » (seuil exact, plus petit des deux sens ; voir
       * `exactThreshold`). Le contrôle par la sixième
       * mesure est d'autant plus faible que ce seuil est grand.
       */
      readonly detectable: Readonly<Record<SurveyMeasure, Mm>>;
      /**
       * Angle mort (mm) par mesure : plus grande erreur isolée, dans le sens défavorable, qui
       * laisse encore le relevé « cohérent » (≥ `detectable`, le seuil n'étant pas symétrique
       * sur un quadrilatère mal conditionné). C'est la limite à annoncer à l'utilisateur.
       */
      readonly undetectable: Readonly<Record<SurveyMeasure, Mm>>;
      readonly convex: boolean;
      /** Angles intérieurs (degrés) en A, B, C, D. */
      readonly angles: readonly [Deg, Deg, Deg, Deg];
    }
  | { readonly ok: false; readonly reason: string };

const PAIRS: Readonly<Record<SurveyMeasure, readonly [number, number]>> = {
  ab: [0, 1],
  bc: [1, 2],
  cd: [2, 3],
  da: [3, 0],
  ac: [0, 2],
  bd: [1, 3],
};

const LABEL: Readonly<Record<SurveyMeasure, string>> = {
  ab: "AB",
  bc: "BC",
  cd: "CD",
  da: "DA",
  ac: "AC",
  bd: "BD",
};

/**
 * Troisième sommet d'un triangle : P à distance `rp` de `p` et `rq` de `q`, à gauche
 * (`side` = 1) ou à droite (−1) de p → q. `slack` : défaut d'inégalité triangulaire toléré
 * (mesures bruitées d'un triangle très aplati) ; au-delà, null.
 */
function apex(p: Vec2, q: Vec2, rp: Mm, rq: Mm, side: 1 | -1, slack: Mm): Vec2 | null {
  const d = V.distance(p, q);
  if (!(d > 0)) return null;
  const x = (d * d + rp * rp - rq * rq) / (2 * d);
  let h2 = rp * rp - x * x;
  if (h2 < 0) {
    if (-h2 > (2 * rp + slack) * slack) return null;
    h2 = 0;
  }
  const u = V.scale(V.sub(q, p), 1 / d);
  return V.add(V.addScaled(p, u, x), V.scale(V.perpLeft(u), side * Math.sqrt(h2)));
}

/** Résout le système linéaire n × n (pivot partiel) ; null si singulier. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    if (!(Math.abs(M[piv]![c]!) > 1e-12)) return null;
    [M[c], M[piv]] = [M[piv]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

/** Inconnues : B.x, C.x, C.y, D.x, D.y (A = origine, B.y = 0). */
function toPoints(u: readonly number[]): Vec2[] {
  return [
    { x: 0, y: 0 },
    { x: u[0]!, y: 0 },
    { x: u[1]!, y: u[2]! },
    { x: u[3]!, y: u[4]! },
  ];
}

function residualsOf(pts: readonly Vec2[], m: OpeningSurvey): number[] {
  return SURVEY_MEASURES.map((k) => {
    const [i, j] = PAIRS[k];
    return m[k] - V.distance(pts[i]!, pts[j]!);
  });
}

const sumSq = (r: readonly number[]): number => r.reduce((s, v) => s + v * v, 0);

/** Jacobienne (6 × 5) des distances calculées par rapport aux inconnues B.x, C.x, C.y, D.x, D.y. */
function jacobian(pts: readonly Vec2[]): number[][] {
  return SURVEY_MEASURES.map((k) => {
    const [i, j] = PAIRS[k];
    const d = V.sub(pts[i]!, pts[j]!);
    const n = V.norm(d) || 1;
    const g = [0, 0, 0, 0, 0];
    const put = (idx: number, sign: number): void => {
      if (idx === 1) g[0]! += (sign * d.x) / n;
      else if (idx === 2) {
        g[1]! += (sign * d.x) / n;
        g[2]! += (sign * d.y) / n;
      } else if (idx === 3) {
        g[3]! += (sign * d.x) / n;
        g[4]! += (sign * d.y) / n;
      }
    };
    put(i, 1);
    put(j, -1);
    return g;
  });
}

/**
 * Seuil de détection par mesure **linéarisé** à la solution (point de départ de
 * `exactThreshold`) : plus petite erreur isolée sur cette
 * mesure qui porte l'écart maximal ajusté à `tolerance`. Avec une seule mesure redondante,
 * l'erreur se répartit sur toutes les mesures : sur une trémie allongée, une erreur sur un petit
 * côté est très peu visible (seuil de plusieurs centimètres), ce qu'il faut dire à l'utilisateur.
 * `Infinity` : erreur indétectable sur cette mesure.
 */
function detectionThresholds(pts: readonly Vec2[], tolerance: Mm): number[] {
  const J = jacobian(pts);
  const JtJ = [0, 1, 2, 3, 4].map((a) =>
    [0, 1, 2, 3, 4].map((b) => J.reduce((s, row) => s + row[a]! * row[b]!, 0)),
  );
  // Projecteur sur les résidus : P = I − J (JᵀJ)⁻¹ Jᵀ ; colonne k = résidus d'une erreur unité sur k.
  return SURVEY_MEASURES.map((_, k) => {
    const step = solve(JtJ, [...J[k]!]);
    if (!step) return Number.POSITIVE_INFINITY;
    const col = J.map((row, i) => (i === k ? 1 : 0) - row.reduce((s, v, a) => s + v * step[a]!, 0));
    const worst = Math.max(...col.map(Math.abs));
    return worst > 1e-9 ? tolerance / worst : Number.POSITIVE_INFINITY;
  });
}

/** Précision relative de la dichotomie du seuil de détection exact. */
const THRESHOLD_REL_PRECISION = 1e-3;

/**
 * Seuils de détection **exacts** d'une mesure (QUESTIONS D6), dans chaque sens : erreur isolée
 * sur la mesure `k` d'un relevé cohérent (`pts`, distances exactes) qui porte l'écart maximal de
 * l'ajustement non linéaire à `tolerance`. `min` : plus petit des deux sens (toute erreur plus
 * petite passe inaperçue) ; `max` : plus grand (angle mort : une erreur jusqu'à cette valeur,
 * dans le sens défavorable, passe inaperçue). Départ : seuil linéarisé `lin` ; encadrement par
 * doublement puis dichotomie. `Infinity` si, dans ce sens, aucune erreur plus petite que la plus
 * grande mesure n'est détectée.
 */
function exactThreshold(
  pts: readonly Vec2[],
  k: SurveyMeasure,
  lin: number,
  tolerance: Mm,
): { readonly min: number; readonly max: number } {
  const base = Object.fromEntries(
    SURVEY_MEASURES.map((x) => {
      const [i, j] = PAIRS[x];
      return [x, V.distance(pts[i]!, pts[j]!)];
    }),
  ) as Record<SurveyMeasure, Mm>;
  const cap = Math.max(...SURVEY_MEASURES.map((x) => base[x]));
  // Écart maximal du relevé erroné, par le même calcul que `openingFromSurvey` (départ par les
  // triangles, ajustement) ; relevé refusé (quadrilatère impossible) : erreur détectée.
  const worst = (t: number): number => {
    const m = { ...base, [k]: base[k] + t };
    if (!(m[k] > 0)) return Number.POSITIVE_INFINITY;
    const fitted = fitSurvey(m, tolerance);
    if (!fitted.ok) return Number.POSITIVE_INFINITY;
    return Math.max(...residualsOf(fitted.local, m).map(Math.abs));
  };
  const bySign = ([1, -1] as const).map((sign): number => {
    let lo = 0;
    let hi = Number.isFinite(lin) && lin > 0 ? Math.min(lin, cap) : cap / 64;
    while (worst(sign * hi) <= tolerance) {
      lo = hi;
      hi *= 2;
      if (hi > cap) return Number.POSITIVE_INFINITY;
    }
    for (let i = 0; i < 60 && hi - lo > THRESHOLD_REL_PRECISION * hi; i++) {
      const mid = (lo + hi) / 2;
      if (worst(sign * mid) <= tolerance) lo = mid;
      else hi = mid;
    }
    // Plus grande erreur encore « cohérente » (borne basse de l'encadrement).
    return lo;
  });
  return { min: Math.min(...bySign), max: Math.max(...bySign) };
}

/** Ajustement de Levenberg-Marquardt des 5 inconnues sur les 6 mesures. */
function refine(start: readonly Vec2[], m: OpeningSurvey): Vec2[] {
  let u = [start[1]!.x, start[2]!.x, start[2]!.y, start[3]!.x, start[3]!.y];
  let r = residualsOf(toPoints(u), m);
  let cost = sumSq(r);
  let lambda = 1e-3;
  for (let iter = 0; iter < 100 && cost > 1e-24; iter++) {
    const pts = toPoints(u);
    const J = jacobian(pts);
    const JtJ = [0, 1, 2, 3, 4].map((a) =>
      [0, 1, 2, 3, 4].map((b) => J.reduce((s, row) => s + row[a]! * row[b]!, 0)),
    );
    const Jtr = [0, 1, 2, 3, 4].map((a) => J.reduce((s, row, k) => s + row[a]! * r[k]!, 0));
    let improved = false;
    for (let tries = 0; tries < 20 && !improved; tries++) {
      const A = JtJ.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) + 1e-12 : v)));
      const step = solve(A, Jtr);
      if (!step) {
        lambda *= 10;
        continue;
      }
      const cand = u.map((v, i) => v + step[i]!);
      const rc = residualsOf(toPoints(cand), m);
      const cc = sumSq(rc);
      if (cc < cost) {
        u = cand;
        r = rc;
        const gain = cost - cc;
        cost = cc;
        lambda = Math.max(lambda / 10, 1e-12);
        improved = true;
        if (gain < 1e-18 * Math.max(1, cost)) iter = 100;
      } else {
        lambda *= 10;
      }
    }
    if (!improved) break;
  }
  return toPoints(u);
}

function interiorAngle(prev: Vec2, p: Vec2, next: Vec2, ccw: boolean): Deg {
  const a = V.sub(prev, p);
  const b = V.sub(next, p);
  // Angle de b vers a, dans le sens trigonométrique pour un parcours CCW.
  let t = Math.atan2(V.cross(b, a), V.dot(b, a));
  if (!ccw) t = -t;
  if (t < 0) t += 2 * Math.PI;
  return (t * 180) / Math.PI;
}

/**
 * Ajustement d'un relevé (étapes 1 à 3 de l'en-tête) : quadrilatère A, B, C, D dans le repère
 * local (A à l'origine, B sur +X), ou raison de l'échec.
 */
function fitSurvey(
  m: OpeningSurvey,
  tolerance: Mm,
): { readonly ok: true; readonly local: Vec2[] } | { readonly ok: false; readonly reason: string } {
  for (const k of SURVEY_MEASURES) {
    const v = m[k];
    if (!(typeof v === "number" && Number.isFinite(v) && v > 0)) {
      return { ok: false, reason: `mesure ${LABEL[k]} manquante ou non positive` };
    }
  }
  const A: Vec2 = { x: 0, y: 0 };
  const B: Vec2 = { x: m.ab, y: 0 };
  // C à gauche de AB (angle en B saillant) ou à droite (angle rentrant en B, trémie en
  // « flèche ») : les deux sont essayés, le bon est départagé par l'aire et la diagonale BD.
  const Cs = ([1, -1] as const)
    .map((side) => apex(A, B, m.ac, m.bc, side, tolerance))
    .filter((p): p is Vec2 => p !== null);
  if (Cs.length === 0) {
    return {
      ok: false,
      reason: `triangle ABC impossible : AB + BC doit dépasser AC (AB ${m.ab}, BC ${m.bc}, AC ${m.ac})`,
    };
  }
  const quads = Cs.flatMap((C) =>
    ([1, -1] as const)
      .map((side) => apex(A, C, m.da, m.cd, side, tolerance))
      .filter((p): p is Vec2 => p !== null)
      .map((D) => [A, B, C, D]),
  );
  if (quads.length === 0) {
    return {
      ok: false,
      reason: `triangle ACD impossible : CD + DA doit dépasser AC (CD ${m.cd}, DA ${m.da}, AC ${m.ac})`,
    };
  }
  // Départ : quadrilatère simple parcouru dans le sens trigonométrique dont la diagonale BD
  // s'accorde le mieux avec la mesure.
  const starts = quads
    .map((pts) => ({
      pts,
      valid: !isSelfIntersecting(pts) && signedArea(pts) > 0,
      err: Math.abs(V.distance(B, pts[3]!) - m.bd),
    }))
    .sort((x, y) => Number(y.valid) - Number(x.valid) || x.err - y.err);
  const local = refine(starts[0]!.pts, m);
  if (isSelfIntersecting(local) || !(signedArea(local) > 0)) {
    return { ok: false, reason: "les mesures ne décrivent pas un quadrilatère simple A, B, C, D" };
  }
  return { ok: true, local };
}

/** Déduit la trémie d'un relevé 4 côtés + 2 diagonales (voir l'en-tête du module). */
export function openingFromSurvey(m: OpeningSurvey, options: SurveyOptions = {}): SurveyResult {
  const tolerance = options.tolerance ?? SURVEY_TOLERANCE_DEFAULT;
  const fitted = fitSurvey(m, tolerance);
  if (!fitted.ok) return fitted;
  let local = fitted.local;
  const residuals = residualsOf(local, m);
  const maxResidual = Math.max(...residuals.map(Math.abs));
  const res = Object.fromEntries(SURVEY_MEASURES.map((k, i) => [k, residuals[i]!])) as Record<
    SurveyMeasure,
    Mm
  >;
  const linear = detectionThresholds(local, tolerance);
  const thresholds = SURVEY_MEASURES.map((k, i) => exactThreshold(local, k, linear[i]!, tolerance));
  const detectable = Object.fromEntries(
    SURVEY_MEASURES.map((k, i) => [k, thresholds[i]!.min]),
  ) as Record<SurveyMeasure, Mm>;
  const undetectable = Object.fromEntries(
    SURVEY_MEASURES.map((k, i) => [k, thresholds[i]!.max]),
  ) as Record<SurveyMeasure, Mm>;
  const ccw = (options.orientation ?? "ccw") === "ccw";
  if (!ccw) local = local.map((p) => ({ x: p.x, y: -p.y }));
  const angle = ((options.angle ?? 0) * Math.PI) / 180;
  const origin = options.origin ?? { x: 0, y: 0 };
  const placed = local.map((p) => V.add(origin, V.rotate(p, angle))) as [Vec2, Vec2, Vec2, Vec2];
  const angles = placed.map((p, i) =>
    interiorAngle(placed[(i + 3) % 4]!, p, placed[(i + 1) % 4]!, ccw),
  ) as [Deg, Deg, Deg, Deg];
  return {
    ok: true,
    points: placed,
    residuals: res,
    maxResidual,
    consistent: maxResidual <= tolerance,
    detectable,
    undetectable,
    convex: angles.every((a) => a < 180),
    angles,
  };
}
