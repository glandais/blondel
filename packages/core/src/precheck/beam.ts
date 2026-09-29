/**
 * Poutre inclinée sur deux appuis simples (prédimensionnement **indicatif**, CHALLENGE P5 ; ne
 * remplace pas une note de calcul).
 *
 * Modèle [CALCUL Blondel, à valider] :
 * - portée horizontale L_h entre appuis, pente tan α, longueur d'axe L = L_h / cos α ;
 * - charges verticales réparties par mètre **en plan** w_h (exploitation q_k × largeur reprise,
 *   marches et finitions) et poids propre g_s par mètre **d'axe** (g_s / cos α en plan) ;
 * - moment (axe fort, âme verticale) : M = w_h·L_h² / 8 et, pour la charge ponctuelle au milieu,
 *   M = P·L_h / 4 (composantes perpendiculaires à l'axe ; l'effort normal est négligé) ;
 * - flèche perpendiculaire à l'axe : 5·w_⊥·L⁴ / (384·E·I) avec w_⊥ = w_h·cos²α par mètre d'axe,
 *   et P·cos α·L³ / (48·E·I) pour la charge ponctuelle ; combinaisons caractéristiques
 *   w_G + w_q et w_G + w_Q (NF EN 16481 § 6.2, C §1.3), comparées à L/200 et L/300 (SPEC X17) ;
 * - ELU : M_Ed = γ_G·M_G + γ_Q·max(M_q, M_Q), σ = M_Ed / W_el,y ≤ f_d ;
 * - fréquence propre (Rayleigh) : f₁ = √(k / (M + 0,4857·m·L)) / 2π, k = 48·E·I / L³, M =
 *   masse M_k,2 (1 kN) reprise par la poutre, m = masse permanente par mètre d'axe.
 *
 * Unités : mm, N, MPa (N/mm²) ; charges d'entrée en kN/m² et kN.
 */
import type { Mm } from "../model/primitives.js";
import type { StairLoads } from "./loads.js";
import type { BeamMaterial, PrecheckSettings } from "./settings.js";

/** Accélération de la pesanteur (m/s²). */
export const GRAVITY = 9.81;

export interface BeamSection {
  /** Aire, mm². */
  readonly area: number;
  /** Inertie de flexion, mm⁴. */
  readonly i: number;
  /** Module élastique, mm³. */
  readonly w: number;
}

export interface InclinedBeamInput {
  /** Portée horizontale entre appuis, mm. */
  readonly spanH: Mm;
  /** Pente tan α (≥ 0). */
  readonly slope: number;
  readonly section: BeamSection;
  readonly material: BeamMaterial;
  /** Largeur de marche reprise par la poutre, mm. */
  readonly tributaryWidth: Mm;
  /** Charge permanente répartie en plan (marches, contremarches, supports, finitions), kN/m². */
  readonly permanentArea: number;
  readonly loads: StairLoads;
  readonly settings: Pick<PrecheckSettings, "gammaG" | "gammaQ" | "pointLoadShare">;
}

export interface InclinedBeamResult {
  /** Longueur d'axe L (mm), angle α (rad). */
  readonly length: Mm;
  readonly angle: number;
  /** Charges linéiques verticales par mm en plan (N/mm) : permanente, exploitation. */
  readonly gH: number;
  readonly qH: number;
  /** Charge ponctuelle reprise (N). */
  readonly point: number;
  /** Moment de calcul ELU (N·mm), contrainte (MPa), résistance de calcul (MPa). */
  readonly mEd: number;
  readonly stress: number;
  readonly design: number;
  /** Flèches caractéristiques perpendiculaires à l'axe (mm). */
  readonly deflectionG: Mm;
  readonly deflectionQ: Mm;
  readonly deflectionPoint: Mm;
  /** max(w_G + w_q, w_G + w_Q), mm. */
  readonly deflection: Mm;
  /** Rapport L / flèche. */
  readonly spanRatio: number;
  /** Fréquence propre (Hz). */
  readonly frequency: number;
}

export function analyzeInclinedBeam(input: InclinedBeamInput): InclinedBeamResult {
  const { spanH, slope, section, material, loads, settings } = input;
  const angle = Math.atan(Math.max(0, slope));
  const c = Math.cos(angle);
  const L = spanH / c;
  const E = material.e;
  const I = section.i;
  // Poids propre par mm d'axe (N/mm) : A[mm²]·1e-6·ρ·g [N/m] / 1 000.
  const selfAxis = (section.area * 1e-6 * material.density * GRAVITY) / 1000;
  // kN/m² × mm → N/mm : 1 kN/m² = 1e-3 N/mm².
  const gH = input.permanentArea * 1e-3 * input.tributaryWidth + selfAxis / c;
  const qH = loads.qk * 1e-3 * input.tributaryWidth;
  const point = loads.Qk * 1000 * settings.pointLoadShare;
  const mG = (gH * spanH * spanH) / 8;
  const mq = (qH * spanH * spanH) / 8;
  const mQ = (point * spanH) / 4;
  const mEd = settings.gammaG * mG + settings.gammaQ * Math.max(mq, mQ);
  const stress = mEd / section.w;
  const udl = (wH: number): Mm => (5 * wH * c * c * L ** 4) / (384 * E * I);
  const deflectionG = udl(gH);
  const deflectionQ = udl(qH);
  const deflectionPoint = (point * c * L ** 3) / (48 * E * I);
  const deflection = deflectionG + Math.max(deflectionQ, deflectionPoint);
  // Fréquence, unités SI.
  const Lm = L / 1000;
  const k = (48 * E * 1e6 * I * 1e-12) / Lm ** 3;
  const massPerMeterAxis = (gH * c * 1000) / GRAVITY; // kg/m d'axe (permanentes)
  const M = (loads.vibrationMass * 1000 * settings.pointLoadShare) / GRAVITY;
  const frequency = Math.sqrt(k / (M + 0.4857 * massPerMeterAxis * Lm)) / (2 * Math.PI);
  return {
    length: L,
    angle,
    gH,
    qH,
    point,
    mEd,
    stress,
    design: material.design,
    deflectionG,
    deflectionQ,
    deflectionPoint,
    deflection,
    spanRatio: deflection > 0 ? L / deflection : Infinity,
    frequency,
  };
}

/** Critères du prédimensionnement (bornes) : L/200, L/300, f₁ ≥ 5 Hz. */
export const PRECHECK_LIMITS = {
  /** NF EN 16481 § 6.2 (C §1.3) : flèche ≤ L/200, bloquant si calcul (SPEC X17). */
  deflectionRatio: 200,
  /** Usage résidentiel L/300 (C §1.3 [52], confiance faible) : conseil (SPEC X17). */
  deflectionAdvice: 300,
  /** NF EN 16481 § 6.3 (C §1.3) : f₁ ≥ 5 Hz. */
  frequency: 5,
} as const;

/** Vrai si la poutre satisfait les critères de sélection (L/200, contrainte, f₁). */
export function passesPrecheck(r: InclinedBeamResult): boolean {
  return (
    r.deflection <= r.length / PRECHECK_LIMITS.deflectionRatio + 1e-9 &&
    r.stress <= r.design + 1e-9 &&
    r.frequency >= PRECHECK_LIMITS.frequency - 1e-9
  );
}
