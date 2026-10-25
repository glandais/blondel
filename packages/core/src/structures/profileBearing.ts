/**
 * Noyau géométrique du **limon coudé** des profilés (`steel-profile`, chantier bent-stringer,
 * sous-lot K2a ; décisions de l'utilisateur QUESTIONS A41, conventions CK1 à CK18 du ledger
 * `docs/ledger/LEDGER-bent-stringer.md`). Fonctions pures, sans DOM ni texte : le noyau ne
 * rend que des données (et des constats typés `BearingIssue`). **Non branché** en K2a :
 * `steelProfile.ts` ne l'appelle pas encore.
 *
 * - **Ligne d'appui** (CK2, K-Q1) : ligne des nez du côté de la face (palier compris), lue sur
 *   toute la fenêtre [uLo ; uHi] de la face, prolongée par le segment extrême avant le premier
 *   et après le dernier nez ; un jarret à chaque nez où la pente change.
 * - **Coin en plan** (K-Q7) : partie de niveau autour du coin, à l'altitude de la ligne des nez
 *   au coin (comme `levelZones` de `steel-flat` et `wood-housed`), assez longue pour contenir
 *   les fibres de l'onglet à φ/2 et les coupes des jarrets voisins avec un tronçon d'au moins
 *   la longueur minimale ; faces trop courtes : coins fusionnés en une seule partie de niveau.
 * - **Nettoyage** (CK6, K-Q9) : sommets alignés retirés (epsilon numérique), puis retrait
 *   déterministe (plus petit |Δα|, puis plus petit u) sous l'angle minimal de jarret et la
 *   longueur minimale de tronçon (`KneeSettings`, valeurs provisoires **à valider**).
 * - **Jarrets** (CK4) : coupe sur la bissectrice dans le plan de l'âme, β = |Δα| / 2 ; rive haute
 *   = ligne d'appui + d_h (verticale), rive basse décalée de h perpendiculairement, sommets sur
 *   les bissectrices.
 * - **Longueurs de fibre** (CK10, corrigé) : fibres haute et basse, plus courte et plus longue
 *   fibre de chaque tronçon (aile comprise aux onglets), encombrement axial (longueur de débit
 *   hors trait de scie). La coupe de sol est ignorée (garde-fou de face non vide :
 *   `MIN_CAGE_STRINGER_LENGTH`).
 * - **Logement des cornières** (CK11) : partie logée exacte sur polylignes, besoin de hauteur
 *   d'âme par dichotomie (aucun nouveau seuil).
 *
 * Repères : u abscisse le long de la face (σ = σ_A + u), z altitude ; les polylignes sont des
 * suites de points (u, z) d'abscisses strictement croissantes.
 */
import { z } from "zod";
import type { SteelSection } from "../catalog/sections.js";
import type { Mm, Vec2 } from "../model/primitives.js";
import type { StringerEnd, StringerStart } from "./development.js";
import { STRUCT_EPS, type PiecewiseLinear } from "./geom.js";
import { MIN_CAGE_STRINGER_LENGTH, type SteelCornerEnd } from "./steelFlat.js";

type Side = "inner" | "outer";

/** Epsilon numérique d'alignement (rad, CK6) : en dessous, il n'y a pas de jarret. */
const EPS_ANGLE = 1e-9;
/** Tolérance des comparaisons de longueurs (mm). */
const TOL = 1e-9;

// ------------------------------------------------------------------------------ section

/**
 * Section vue par le noyau (CK1) : UPN, âme côté marches (shift = 0, pas de semelle à déduire
 * dans l'âme : tf = 0, comme `tfOf` de `steelProfile.ts`) ; IPN / IPE / HEA, bouts d'ailes côté
 * marches, âme à shift = (b − t_w) / 2 derrière la face côté marches, semelles t_f.
 */
export interface BearingSection {
  readonly h: Mm;
  readonly b: Mm;
  readonly shift: Mm;
  readonly tf: Mm;
}

export function bearingSectionOf(s: SteelSection): BearingSection {
  return s.shape === "I"
    ? { h: s.h, b: s.b, shift: (s.b - s.tw) / 2, tf: s.tf }
    : { h: s.h, b: s.b, shift: 0, tf: 0 };
}

// ------------------------------------------------------------------------------ réglages

/**
 * Réglages du nettoyage des sommets (QUESTIONS A41, K-Q9). Pas encore fusionnés dans
 * `SteelProfileParamsSchema` (K2b, clé `knee`).
 */
export const KneeSettingsSchema = z.object({
  /**
   * Longueur minimale de tronçon (mm) : plus courte fibre d'un tronçon entre ses deux coupes
   * (les coupes de jarret h·(tan β₁ + tan β₂) sont donc déjà déduites : c'est la marge d'atelier
   * de K-Q9) ; sert aussi de marge de la partie de niveau au coin. Valeur **provisoire, à
   * valider** : aucune source (`docs/research/` muet) ; défaut fixé d'après la distribution
   * mesurée en K2a (journal `docs/ledger/LEDGER-bent-stringer.md`, lignes K2a ; sonde de
   * session `k2a/`), soumis à l'utilisateur (QUESTIONS A41, K-Q9).
   */
  minSegmentLength: z.number().int().nonnegative().default(50),
  /**
   * Angle minimal de jarret (degrés) : un sommet dont le changement de pente est plus petit est
   * retiré (hors parties de niveau). Valeur **provisoire, à valider** : aucune source
   * (`docs/research/` muet) ; défaut fixé d'après la distribution mesurée en K2a (journal
   * `docs/ledger/LEDGER-bent-stringer.md`, lignes K2a ; sonde de session `k2a/`), soumis à
   * l'utilisateur (QUESTIONS A41, K-Q9).
   */
  minKneeAngle: z.number().nonnegative().max(45).default(0.5),
});
export type KneeSettings = z.output<typeof KneeSettingsSchema>;
/** Réglages par défaut (provisoires, à valider). */
export const PROVISIONAL_KNEE_SETTINGS: KneeSettings = KneeSettingsSchema.parse({});

// ------------------------------------------------------------------------------ entrées

/** Face vue par le noyau : `SteelStringerFace` et sa fenêtre (`profileSupportFaces`). */
export interface BearingFace {
  readonly id: string;
  readonly side: Side;
  readonly sigmaA: Mm;
  readonly faceLength: Mm;
  readonly uLo: Mm;
  readonly uHi: Mm;
  readonly start: StringerStart;
  readonly end: StringerEnd;
  readonly startCorner?: SteelCornerEnd;
  readonly endCorner?: SteelCornerEnd;
}

/** Angle mural des volées (sans `corner` renseigné) : onglet à 45° d'un angle rentrant (CK5). */
const FLIGHT_WALL_CORNER: SteelCornerEnd = { joint: "wall", concave: true, tanHalf: 1 };

/** Coin effectif d'une extrémité `corner` (CK5) ; `undefined` pour les autres extrémités. */
export function cornerOf(f: BearingFace, which: "start" | "end"): SteelCornerEnd | undefined {
  if (which === "start") {
    return f.start === "corner" ? (f.startCorner ?? FLIGHT_WALL_CORNER) : undefined;
  }
  return f.end === "corner" ? (f.endCorner ?? FLIGHT_WALL_CORNER) : undefined;
}

/**
 * Sens de l'onglet : +1 angle rentrant (les fibres profondes dépassent le coin), −1 saillant
 * (elles s'arrêtent avant lui), 0 raccord de palier (coupe d'aplomb bout à bout).
 */
function cornerSign(c: SteelCornerEnd): -1 | 0 | 1 {
  if (c.joint === "landing") return 0;
  return c.concave ? 1 : -1;
}

export interface BearingInput {
  readonly faces: readonly BearingFace[];
  /** Ligne des nez de chaque côté (`nosingPitchLine`). */
  readonly pitch: Readonly<Record<Side, PiecewiseLinear>>;
  /** Dépassement vertical de la rive haute au-dessus de la ligne d'appui, d_h. */
  readonly upperOffset: Mm;
  readonly section: BearingSection;
  readonly settings: KneeSettings;
}

// ------------------------------------------------------------------------------ sorties

export type SegmentCut =
  | {
      readonly kind: "knee";
      readonly deltaAlpha: number;
      readonly beta: number;
      /** Taux de coupe tan(Δα / 2) : allongement de la fibre par mm de profondeur t. */
      readonly rate: number;
    }
  | {
      readonly kind: "end";
      readonly end: StringerStart | StringerEnd;
      /** Coupe d'aplomb : début + tan α, fin − tan α. */
      readonly rate: number;
      /** Allongement axial selon la profondeur d ∈ [0 ; b] (onglet), 0 sinon. */
      readonly plan: { readonly min: Mm; readonly max: Mm };
    };

export interface FibreLengths {
  /** Fibre de rive haute (t = 0), à la profondeur de l'âme. */
  readonly upper: Mm;
  /** Fibre de rive basse décalée (t = h), à la profondeur de l'âme. */
  readonly lower: Mm;
  /** Plus courte et plus longue fibre sur [0 ; h] × [0 ; b] (ailes comprises). */
  readonly shortest: Mm;
  readonly longest: Mm;
  /** Encombrement axial : longueur de débit hors trait de scie. */
  readonly axialExtent: Mm;
}

export interface BearingSegment {
  /** Ligne d'appui du tronçon (u0, z0) → (u1, z1). */
  readonly u0: Mm;
  readonly u1: Mm;
  readonly z0: Mm;
  readonly z1: Mm;
  readonly alpha: number;
  readonly level: boolean;
  readonly startCut: SegmentCut;
  readonly endCut: SegmentCut;
  readonly fibres: FibreLengths;
}

export interface Knee {
  readonly u: Mm;
  readonly deltaAlpha: number;
  readonly beta: number;
  /**
   * Sommets de rive (u, z) ; le sommet bas est sur la bissectrice, à h des deux décalées. Il est
   * le sommet de `lowerRive` correspondant, sauf quand `lowerRiveOf` effondre un tronçon bas
   * voisin (tronçon trop court, constat `shortSegment` ou `cutsCross` sur la face).
   */
  readonly upper: Vec2;
  readonly lower: Vec2;
  /** Étendue en u de la coupe (du sommet haut au sommet bas). */
  readonly cutSpan: { readonly u0: Mm; readonly u1: Mm };
  /** Jarret d'une partie de niveau (jamais retiré par le nettoyage, sauf aligné). */
  readonly protected: boolean;
}

/** Partie de niveau autour d'un coin en plan (ou d'un groupe de coins fusionnés). */
export interface CornerLevel {
  /** Face avant le (premier) coin, absente si le coin n'est pas apparié. */
  readonly faceBefore?: string;
  /** Face après le (dernier) coin, absente si le coin n'est pas apparié. */
  readonly faceAfter?: string;
  /** Altitude de la ligne d'appui sur la partie de niveau. */
  readonly z: Mm;
  /** λA : longueur de niveau dans la face avant, depuis le coin. */
  readonly lengthBefore: Mm;
  /** λB : longueur de niveau dans la face après, depuis le coin. */
  readonly lengthAfter: Mm;
  readonly merged: boolean;
  /** Indices des nœuds de la ligne des nez (`PiecewiseLinear.xs`) sous la partie de niveau. */
  readonly skippedNoses: readonly number[];
}

export type BearingIssue =
  | {
      readonly kind: "shortSegment";
      readonly faceId: string;
      readonly u0: Mm;
      readonly shortest: Mm;
    }
  /** Plus courte fibre négative : les deux coupes du tronçon se croisent dans la barre. */
  | {
      readonly kind: "cutsCross";
      readonly faceId: string;
      readonly u0: Mm;
      readonly shortest: Mm;
    }
  /**
   * Raccord raide : tronçon en pente touchant une partie de niveau, plus court que la longueur
   * minimale **en plan** alors que sa plus courte fibre l'atteint, et plus raide que tous les
   * segments de la ligne des nez de la fenêtre (aucun seuil d'angle : la référence est la ligne
   * des nez elle-même). Le nettoyage, qui mesure le long de la barre, ne le retire pas.
   */
  | {
      readonly kind: "steepSegment";
      readonly faceId: string;
      readonly u0: Mm;
      readonly planLength: Mm;
      readonly alpha: number;
    }
  /** Nez au-dessus de la rive haute (P − (B + d_h) > 0) : plus grand dépassement de la face. */
  | {
      readonly kind: "noseAboveRive";
      readonly faceId: string;
      readonly u: Mm;
      readonly excess: Mm;
    }
  | { readonly kind: "levelCoversFace"; readonly faceId: string }
  | { readonly kind: "cornerMerged"; readonly faceIds: readonly string[] }
  | { readonly kind: "cornerSigmaMismatch"; readonly faceIds: readonly string[]; readonly gap: Mm }
  | { readonly kind: "unpairedCorner"; readonly faceId: string; readonly which: "start" | "end" }
  | { readonly kind: "emptyWindow"; readonly faceId: string };

export interface RemovedVertex {
  readonly u: Mm;
  /** Changement de pente au sommet au moment du retrait. */
  readonly deltaAlpha: number;
  readonly reason: "collinear" | "angle" | "segment";
  /** Raison `segment` : plus courte fibre (< m) du tronçon voisin au moment du retrait. */
  readonly shortest?: Mm;
}

export interface FaceBearing {
  readonly faceId: string;
  readonly side: Side;
  readonly start: StringerStart;
  readonly end: StringerEnd;
  readonly uLo: Mm;
  readonly uHi: Mm;
  /** Ligne d'appui après nettoyage, de uLo à uHi. */
  readonly line: readonly Vec2[];
  /** Rive haute = ligne + d_h (verticale). */
  readonly upperRive: readonly Vec2[];
  /** Rive basse : rive haute décalée de h perpendiculairement, sommets sur les bissectrices. */
  readonly lowerRive: readonly Vec2[];
  readonly segments: readonly BearingSegment[];
  readonly knees: readonly Knee[];
  readonly removed: readonly RemovedVertex[];
  /** Plus grand écart |B − P| aux nœuds de la ligne des nez dans la fenêtre. */
  readonly nosingDeviation: { readonly max: Mm; readonly atU: Mm };
  /**
   * Écart signé B − P aux extrémités de la fenêtre (uLo, uHi) : déplacement de l'extrémité
   * (hauteur de poteau, CK12) que `nosingDeviation`, mesuré aux nez, ne voit pas.
   */
  readonly endShift: { readonly start: Mm; readonly end: Mm };
}

export interface BearingResult {
  /** Triées par id. */
  readonly faces: readonly FaceBearing[];
  readonly corners: readonly CornerLevel[];
  readonly issues: readonly BearingIssue[];
}

// ------------------------------------------------------------------------------ polylignes

/** Altitude d'une polyligne en u, prolongée par ses segments extrêmes. */
export function polylineAt(pts: readonly Vec2[], u: Mm): Mm {
  const n = pts.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return pts[0]!.y;
  let i: number;
  if (u <= pts[0]!.x) i = 0;
  else if (u >= pts[n - 1]!.x) i = n - 2;
  else {
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid]!.x <= u) lo = mid;
      else hi = mid;
    }
    i = lo;
  }
  const a = pts[i]!;
  const b = pts[i + 1]!;
  const dx = b.x - a.x;
  return dx > 0 ? a.y + ((b.y - a.y) * (u - a.x)) / dx : Math.max(a.y, b.y);
}

const slopeAngle = (a: Vec2, b: Vec2): number => Math.atan2(b.y - a.y, b.x - a.x);

/** Intersection des droites (p, direction d) et (q, direction e) ; `null` si parallèles. */
function intersect(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null {
  const det = d.x * e.y - d.y * e.x;
  if (Math.abs(det) < 1e-15) return null;
  const s = ((q.x - p.x) * e.y - (q.y - p.y) * e.x) / det;
  return { x: p.x + s * d.x, y: p.y + s * d.y };
}

/**
 * Rive basse d'une rive haute pour une hauteur h (perpendiculaire) : droites décalées de h vers
 * le bas, sommets à leurs intersections (sur les bissectrices), extrémités à l'aplomb des
 * extrémités de la rive haute. Un tronçon bas de longueur négative (h grand devant le tronçon)
 * est retiré et ses voisins prolongés jusqu'à leur intersection, jusqu'à stabilité : la rive
 * basse est strictement croissante en u pour tout h.
 *
 * Domaine de validité : seule la première droite fautive est retirée à chaque tour (pas
 * d'enveloppe globale), la rive basse n'est donc monotone en h que pour des lignes d'appui
 * réalistes (pentes de −0,3 à 2, tronçons ≥ 20 mm : aucun contre-exemple sur 30 000 tirages ni
 * sur les faces réelles, relecture K2a). Un pic quasi vertical de quelques mm (tronçon de 2,7 mm
 * montant de 600 mm puis redescendant) peut faire remonter la rive basse quand h croît ; la
 * dichotomie de `supportHeightNeed`, qui suppose cette monotonie, sort alors de son domaine.
 */
export function lowerRiveOf(upperRive: readonly Vec2[], h: Mm): Vec2[] {
  const n = upperRive.length;
  if (n < 2) return upperRive.map((p) => ({ x: p.x, y: p.y }));
  // Droites de la chaîne : aplomb de début, décalées de chaque segment, aplomb de fin.
  interface Line {
    readonly p: Vec2;
    readonly d: Vec2;
    readonly seg: number; // −1 : aplomb
  }
  const lines: Line[] = [{ p: upperRive[0]!, d: { x: 0, y: 1 }, seg: -1 }];
  for (let i = 0; i + 1 < n; i++) {
    const a = upperRive[i]!;
    const al = slopeAngle(a, upperRive[i + 1]!);
    const e = { x: Math.cos(al), y: Math.sin(al) };
    lines.push({ p: { x: a.x + h * e.y, y: a.y - h * e.x }, d: e, seg: i });
  }
  lines.push({ p: upperRive[n - 1]!, d: { x: 0, y: 1 }, seg: -1 });
  const vertexOf = (l: Line, m: Line, fallback: Vec2): Vec2 =>
    intersect(l.p, l.d, m.p, m.d) ?? fallback;
  for (let guard = 0; guard < 4 * n; guard++) {
    const verts: Vec2[] = [];
    for (let k = 0; k + 1 < lines.length; k++) {
      verts.push(vertexOf(lines[k]!, lines[k + 1]!, lines[k + 1]!.p));
    }
    // Premier tronçon décalé dont la longueur (le long de sa direction) est négative.
    let bad = -1;
    for (let k = 1; k + 1 < lines.length; k++) {
      const l = lines[k]!;
      const a = verts[k - 1]!;
      const b = verts[k]!;
      if ((b.x - a.x) * l.d.x + (b.y - a.y) * l.d.y < -TOL) {
        bad = k;
        break;
      }
    }
    if (bad < 0) return verts;
    lines.splice(bad, 1);
    if (lines.length === 2) {
      // Plus aucune droite décalée : dégénéré, aplomb du milieu.
      const top = upperRive[0]!;
      return [{ x: top.x, y: top.y - h }];
    }
  }
  const verts: Vec2[] = [];
  for (let k = 0; k + 1 < lines.length; k++) {
    verts.push(vertexOf(lines[k]!, lines[k + 1]!, lines[k + 1]!.p));
  }
  return verts;
}

// ------------------------------------------------------------------------------ fibres

interface CutEnd {
  readonly kind: StringerStart | StringerEnd;
  readonly corner?: SteelCornerEnd;
}

/** Tronçons, jarrets, rives d'une ligne d'appui (sommets d'abscisses croissantes). */
function segmentsOf(
  line: readonly Vec2[],
  prot: readonly boolean[],
  startEnd: CutEnd,
  endEnd: CutEnd,
  sec: BearingSection,
  dh: Mm,
): { segments: BearingSegment[]; knees: Knee[] } {
  const n = line.length;
  const alphas: number[] = [];
  for (let i = 0; i + 1 < n; i++) alphas.push(slopeAngle(line[i]!, line[i + 1]!));
  const h = sec.h;
  const knees: Knee[] = [];
  for (let i = 1; i + 1 < n; i++) {
    const a0 = alphas[i - 1]!;
    const a1 = alphas[i]!;
    const delta = a1 - a0;
    const beta = Math.abs(delta) / 2;
    const mean = (a0 + a1) / 2;
    const up = { x: line[i]!.x, y: line[i]!.y + dh };
    const k = h / Math.cos(beta);
    const lo = { x: up.x + k * Math.sin(mean), y: up.y - k * Math.cos(mean) };
    knees.push({
      u: up.x,
      deltaAlpha: delta,
      beta,
      upper: up,
      lower: lo,
      cutSpan: { u0: Math.min(up.x, lo.x), u1: Math.max(up.x, lo.x) },
      protected: prot[i] === true,
    });
  }
  const segments: BearingSegment[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const alpha = alphas[i]!;
    const c = Math.cos(alpha);
    const tanA = Math.tan(alpha);
    const kneeCut = (delta: number): SegmentCut => ({
      kind: "knee",
      deltaAlpha: delta,
      beta: Math.abs(delta) / 2,
      rate: Math.tan(delta / 2),
    });
    // Extrémité : coupe d'aplomb (taux ± tan α) et, à un coin, onglet en plan.
    let u0W = a.x;
    let u1W = b.x;
    const endCut = (e: CutEnd, which: "start" | "end"): { cut: SegmentCut; slope: number } => {
      const rate = which === "start" ? tanA : -tanA;
      if (e.kind === "corner" && e.corner) {
        const sg = cornerSign(e.corner);
        const t = e.corner.tanHalf;
        const off = sg * sec.shift * t;
        if (which === "start") u0W -= off;
        else u1W += off;
        // δ(d) = σc·(d − shift)·t / cos α, d ∈ [0 ; b].
        const slope = (sg * t) / c;
        const d0 = slope * (0 - sec.shift);
        const d1 = slope * (sec.b - sec.shift);
        return {
          cut: {
            kind: "end",
            end: e.kind,
            rate,
            plan: { min: Math.min(d0, d1), max: Math.max(d0, d1) },
          },
          slope,
        };
      }
      return { cut: { kind: "end", end: e.kind, rate, plan: { min: 0, max: 0 } }, slope: 0 };
    };
    let startCut: SegmentCut;
    let endCutV: SegmentCut;
    let ds = 0;
    let de = 0;
    if (i === 0) {
      const r = endCut(startEnd, "start");
      startCut = r.cut;
      ds = r.slope;
    } else startCut = kneeCut(alpha - alphas[i - 1]!);
    if (i + 2 === n) {
      const r = endCut(endEnd, "end");
      endCutV = r.cut;
      de = r.slope;
    } else endCutV = kneeCut(alphas[i + 1]! - alpha);
    const ell = (u1W - u0W) / c;
    const rs = startCut.rate;
    const re = endCutV.rate;
    // δs(d) + δe(d) = (ds + de)·(d − shift), affine : extremums en d = 0 et d = b.
    const dSum0 = (ds + de) * (0 - sec.shift);
    const dSumB = (ds + de) * (sec.b - sec.shift);
    const planMax = (cut: SegmentCut): Mm => (cut.kind === "end" ? cut.plan.max : 0);
    const fibres: FibreLengths = {
      upper: ell,
      lower: ell + h * (rs + re),
      shortest: ell + Math.min(0, h * (rs + re)) + Math.min(dSum0, dSumB),
      longest: ell + Math.max(0, h * (rs + re)) + Math.max(dSum0, dSumB),
      axialExtent:
        ell + Math.max(0, h * rs) + Math.max(0, h * re) + planMax(startCut) + planMax(endCutV),
    };
    segments.push({
      u0: a.x,
      u1: b.x,
      z0: a.y,
      z1: b.y,
      alpha,
      level: Math.abs(alpha) < EPS_ANGLE,
      startCut,
      endCut: endCutV,
      fibres,
    });
  }
  return { segments, knees };
}

// ------------------------------------------------------------------------------ lignes d'appui

interface Vtx {
  readonly u: Mm;
  readonly z: Mm;
  /** Jarret d'une partie de niveau, côté début ou fin de face (jamais retiré, sauf aligné). */
  readonly prot: boolean;
  readonly level?: "start" | "end";
}

/** Configuration de niveau d'une face (parties de niveau aux coins, ou face entière). */
type FaceLevel =
  | { readonly kind: "full"; readonly z: Mm }
  | {
      readonly kind: "ends";
      readonly start?: { readonly z: Mm; readonly lambda: Mm };
      readonly end?: { readonly z: Mm; readonly lambda: Mm };
    };

interface CornerRec {
  before?: number;
  after?: number;
  sigma: Mm;
  corner: SteelCornerEnd;
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Nettoyage (CK6, K-Q9) d'une ligne brute ; rend la ligne, ses tronçons et les retraits. */
function cleanLine(
  raw: readonly Vtx[],
  face: BearingFace,
  sec: BearingSection,
  dh: Mm,
  m: Mm,
  minAngle: number,
): {
  line: Vec2[];
  prot: boolean[];
  segments: BearingSegment[];
  knees: Knee[];
  removed: RemovedVertex[];
} {
  let verts = [...raw];
  const removed: RemovedVertex[] = [];
  const deltaAt = (vs: readonly Vtx[], i: number): number =>
    slopeAngle({ x: vs[i]!.u, y: vs[i]!.z }, { x: vs[i + 1]!.u, y: vs[i + 1]!.z }) -
    slopeAngle({ x: vs[i - 1]!.u, y: vs[i - 1]!.z }, { x: vs[i]!.u, y: vs[i]!.z });
  // 1. Sommets alignés (même protégés) : pas de jarret. Un jarret de partie de niveau aligné
  //    (raccord de niveau) passe sa protection au sommet suivant de la partie de niveau, qui
  //    devient le jarret de fin de niveau.
  for (let i = 1; i + 1 < verts.length;) {
    const d = deltaAt(verts, i);
    if (Math.abs(d) < EPS_ANGLE) {
      const v = verts[i]!;
      removed.push({ u: v.u, deltaAlpha: d, reason: "collinear" });
      verts.splice(i, 1);
      if (v.prot && v.level) {
        const j = v.level === "start" ? i : i - 1;
        const w = verts[j]!;
        if (j > 0 && j + 1 < verts.length && !w.prot) {
          verts[j] = { ...w, prot: true, level: v.level };
        }
      }
      // Le voisin de gauche peut être devenu aligné : on le revoit.
      if (i > 1) i--;
    } else i++;
  }
  const startEnd: CutEnd = { kind: face.start, corner: cornerOf(face, "start") };
  const endEnd: CutEnd = { kind: face.end, corner: cornerOf(face, "end") };
  const build = (vs: readonly Vtx[]) =>
    segmentsOf(
      vs.map((v) => ({ x: v.u, y: v.z })),
      vs.map((v) => v.prot),
      startEnd,
      endEnd,
      sec,
      dh,
    );
  // 2. Retraits sous l'angle minimal et la longueur minimale de tronçon.
  let built = build(verts);
  for (let guard = 0; guard < raw.length + 2; guard++) {
    const cand = new Map<number, { reason: "angle" | "segment"; shortest?: Mm }>();
    for (let i = 1; i + 1 < verts.length; i++) {
      if (!verts[i]!.prot && Math.abs(deltaAt(verts, i)) < minAngle) {
        cand.set(i, { reason: "angle" });
      }
    }
    built.segments.forEach((s, i) => {
      if (s.fibres.shortest >= m - TOL) return;
      for (const j of [i, i + 1]) {
        if (j <= 0 || j + 1 >= verts.length || verts[j]!.prot) continue;
        const c = cand.get(j);
        if (!c) cand.set(j, { reason: "segment", shortest: s.fibres.shortest });
        else if (c.reason === "segment") c.shortest = Math.min(c.shortest!, s.fibres.shortest);
      }
    });
    if (cand.size === 0) break;
    let pick = -1;
    let best = Infinity;
    for (const i of [...cand.keys()].sort((a, b) => a - b)) {
      const d = Math.abs(deltaAt(verts, i));
      if (d < best - 1e-15) {
        best = d;
        pick = i;
      }
    }
    const why = cand.get(pick)!;
    removed.push({
      u: verts[pick]!.u,
      deltaAlpha: deltaAt(verts, pick),
      reason: why.reason,
      ...(why.shortest !== undefined ? { shortest: why.shortest } : {}),
    });
    // Sommet voisin d'une extrémité de face dont le tronçon d'extrémité est trop court : le
    // tronçon suivant est prolongé jusqu'à l'extrémité (comme le prolongement de la ligne des
    // nez au-delà du dernier nez, CK2) plutôt que de tirer une corde qui s'écarterait du nez.
    const n = verts.length;
    const extend = (end: number, a: number, b: number): void => {
      const A = verts[a]!;
      const B = verts[b]!;
      const E = verts[end]!;
      verts[end] = { ...E, z: A.z + ((B.z - A.z) * (E.u - A.u)) / (B.u - A.u) };
    };
    if (pick === 1 && built.segments[0]!.fibres.shortest < m - TOL) extend(0, 1, 2);
    else if (pick === n - 2 && built.segments[n - 2]!.fibres.shortest < m - TOL) {
      extend(n - 1, n - 3, n - 2);
    }
    verts = verts.filter((_, i) => i !== pick);
    built = build(verts);
  }
  return {
    line: verts.map((v) => ({ x: v.u, y: v.z })),
    prot: verts.map((v) => v.prot),
    segments: built.segments,
    knees: built.knees,
    removed,
  };
}

/**
 * Lignes d'appui de toutes les faces (ligne des nez avec parties de niveau aux coins, nettoyées),
 * tronçons, jarrets, rives et fibres. Ne lève jamais : les cas dégénérés sont rendus en
 * constats (`issues`).
 */
export function profileBearings(input: BearingInput): BearingResult {
  const { section: sec, settings, upperOffset: dh } = input;
  const h = sec.h;
  const m = Math.max(settings.minSegmentLength, MIN_CAGE_STRINGER_LENGTH);
  const minAngle = (settings.minKneeAngle * Math.PI) / 180;
  const issues: BearingIssue[] = [];

  // Faces triées (I9 : indépendant de l'ordre d'entrée) ; fenêtres vides ou non finies écartées.
  const sorted = [...input.faces].sort(
    (a, b) => cmpStr(a.side, b.side) || a.sigmaA - b.sigmaA || cmpStr(a.id, b.id),
  );
  const faces: BearingFace[] = [];
  for (const f of sorted) {
    const finite = [f.uLo, f.uHi, f.sigmaA, f.faceLength].every((x) => Number.isFinite(x));
    if (!finite || !(f.uHi - f.uLo > STRUCT_EPS)) {
      issues.push({ kind: "emptyWindow", faceId: f.id });
    } else faces.push(f);
  }
  const P = (f: BearingFace): PiecewiseLinear => input.pitch[f.side];

  // 1. Appariement des coins (§2.1).
  const corners: CornerRec[] = [];
  const startCornerOf = new Map<number, number>();
  const endCornerOf = new Map<number, number>();
  faces.forEach((x, i) => {
    if (x.end !== "corner") return;
    const sigmaEnd = x.sigmaA + x.faceLength;
    let best = -1;
    let bestGap = Infinity;
    faces.forEach((y, j) => {
      if (j === i || y.side !== x.side || y.start !== "corner" || startCornerOf.has(j)) return;
      const gap = Math.abs(y.sigmaA - sigmaEnd);
      if (
        gap < bestGap - 1e-12 ||
        (Math.abs(gap - bestGap) <= 1e-12 && best >= 0 && cmpStr(y.id, faces[best]!.id) < 0)
      ) {
        best = j;
        bestGap = gap;
      }
    });
    const corner = cornerOf(x, "end")!;
    if (best < 0) {
      issues.push({ kind: "unpairedCorner", faceId: x.id, which: "end" });
      endCornerOf.set(i, corners.length);
      corners.push({ before: i, sigma: sigmaEnd, corner });
      return;
    }
    const y = faces[best]!;
    let sigma = y.sigmaA;
    if (bestGap > 1e-6) {
      issues.push({ kind: "cornerSigmaMismatch", faceIds: [x.id, y.id], gap: bestGap });
      sigma = (sigmaEnd + y.sigmaA) / 2;
    }
    endCornerOf.set(i, corners.length);
    startCornerOf.set(best, corners.length);
    corners.push({ before: i, after: best, sigma, corner });
  });
  faces.forEach((y, j) => {
    if (y.start !== "corner" || startCornerOf.has(j)) return;
    issues.push({ kind: "unpairedCorner", faceId: y.id, which: "start" });
    startCornerOf.set(j, corners.length);
    corners.push({ after: j, sigma: y.sigmaA, corner: cornerOf(y, "start")! });
  });

  // Groupes de coins fusionnés (union-find).
  const parent = corners.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
    return i;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const groupMembers = (g: number): number[] =>
    corners
      .map((_, i) => i)
      .filter((i) => find(i) === g)
      .sort((a, b) => corners[a]!.sigma - corners[b]!.sigma);
  const groupZ = (ci: number): Mm => {
    const members = groupMembers(find(ci));
    const first = corners[members[0]!]!;
    const last = corners[members[members.length - 1]!]!;
    const face = faces[(first.before ?? first.after)!]!;
    return P(face).at((first.sigma + last.sigma) / 2);
  };

  const sailFlat = (c: SteelCornerEnd): Mm => (cornerSign(c) < 0 ? sec.b * c.tanHalf : 0);
  /** λB de base (§2.2) : fibres de l'onglet + longueur minimale. */
  const lambdaAfter = (ci: number): Mm => sailFlat(corners[ci]!.corner) + m;
  /** Sommets d'une face avant sa partie de niveau de fin (début compris). */
  const headVertices = (f: BearingFace, start: { z: Mm; lambda: Mm } | undefined): Vtx[] => {
    const pl = P(f);
    const out: Vtx[] = [];
    let lo: Mm;
    if (start) {
      out.push({ u: f.uLo, z: start.z, prot: false });
      out.push({ u: start.lambda, z: start.z, prot: true, level: "start" });
      lo = start.lambda;
    } else {
      out.push({ u: f.uLo, z: pl.at(f.sigmaA + f.uLo), prot: false });
      lo = f.uLo;
    }
    for (let k = 0; k < pl.xs.length; k++) {
      const u = pl.xs[k]! - f.sigmaA;
      if (u > lo + STRUCT_EPS && u < f.uHi - STRUCT_EPS) out.push({ u, z: pl.ys[k]!, prot: false });
    }
    return out;
  };
  /**
   * λA (§2.2) : plus petit λ ≥ base tel que λ ≥ base + h·tan(α_A(λ)/2), α_A étant la pente du
   * raccord depuis le dernier sommet k⁻ d'abscisse < L − λ. Les sommets candidats sont essayés du
   * plus proche du coin au plus éloigné ; pour chacun, point fixe croissant sur l'intervalle de λ
   * où il est k⁻ (64 itérations, puis balayage et dichotomie si le point fixe n'est pas atteint :
   * λ rendu admissible, à 1e-6 mm près à la tangence). `null` si la face entière serait couverte.
   */
  const lambdaBefore = (f: BearingFace, head: readonly Vtx[], zc: Mm, base: Mm): Mm | null => {
    const L = f.faceLength;
    for (let j = head.length - 1; j >= 0; j--) {
      const k = head[j]!;
      const next = head[j + 1];
      let lambda = Math.max(base, next ? L - next.u : base);
      const maxLambda = L - k.u - 1e-9;
      const needOf = (l: Mm): Mm =>
        base + h * Math.max(0, Math.tan(Math.atan((zc - k.z) / (L - l - k.u)) / 2));
      for (let it = 0; it < 64 && lambda < maxLambda; it++) {
        const need = needOf(lambda);
        if (need <= lambda + 1e-9) return lambda;
        lambda = need;
      }
      if (lambda < maxLambda) {
        // Point fixe non atteint (voisinage de la tangence, convergence lente) : λ, inadmissible,
        // reste sous le plus petit point fixe. Balayage de [λ ; λmax] jusqu'au premier λ
        // admissible (l'admissibilité n'est pas monotone : le raccord se redresse vers λmax),
        // puis dichotomie entre le dernier échantillon inadmissible et lui.
        const N = 256;
        let lo = lambda;
        for (let q = 1; q <= N; q++) {
          const x = lambda + ((maxLambda - lambda) * q) / N;
          if (needOf(x) <= x + 1e-9) {
            let hi = x;
            while (hi - lo > 1e-9) {
              const mid = (lo + hi) / 2;
              if (needOf(mid) <= mid + 1e-9) hi = mid;
              else lo = mid;
            }
            return hi;
          }
          lo = x;
        }
        // Tangence (intervalle admissible plus fin que le pas) : déficit résiduel ≤ 1e-6 mm.
        if (needOf(lambda) <= lambda + 1e-6) return needOf(lambda);
      }
    }
    return null;
  };

  // 2. Parties de niveau et fusions (§2.2, §2.3), jusqu'à stabilité.
  const extraS = faces.map(() => 0);
  const extraE = faces.map(() => 0);
  const levelOf = (i: number): FaceLevel => {
    const f = faces[i]!;
    const sc = startCornerOf.get(i);
    const ec = endCornerOf.get(i);
    if (sc !== undefined && ec !== undefined && find(sc) === find(ec)) {
      return { kind: "full", z: groupZ(sc) };
    }
    const start =
      sc !== undefined ? { z: groupZ(sc), lambda: lambdaAfter(sc) + extraS[i]! } : undefined;
    let end: { z: Mm; lambda: Mm } | undefined;
    if (ec !== undefined) {
      const zc = groupZ(ec);
      const base = sailFlat(corners[ec]!.corner) + m + extraE[i]!;
      const lambda = lambdaBefore(f, headVertices(f, start), zc, base);
      end = { z: zc, lambda: lambda ?? f.faceLength - f.uLo };
    }
    return { kind: "ends", ...(start ? { start } : {}), ...(end ? { end } : {}) };
  };
  const covered = new Map<number, Mm>();
  for (let guard = 0; guard <= corners.length + 1; guard++) {
    let changed = false;
    covered.clear();
    faces.forEach((f, i) => {
      const lv = levelOf(i);
      if (lv.kind === "full") return;
      const lo = lv.start ? lv.start.lambda : f.uLo;
      const hi = lv.end ? f.faceLength - lv.end.lambda : f.uHi;
      // Sans coin (poteau à poteau, sol à poteau) : ligne des nez telle quelle, même courte.
      const level = lv.start ?? lv.end;
      if (hi - lo >= m || !level) return;
      const sc = startCornerOf.get(i);
      const ec = endCornerOf.get(i);
      if (sc !== undefined && ec !== undefined) {
        union(sc, ec);
        changed = true;
      } else covered.set(i, level.z);
    });
    if (!changed) break;
  }
  for (const i of [...covered.keys()].sort((a, b) => a - b)) {
    issues.push({ kind: "levelCoversFace", faceId: faces[i]!.id });
  }
  const roots = [...new Set(corners.map((_, i) => find(i)))].sort((a, b) => a - b);
  for (const g of roots) {
    const members = groupMembers(g);
    if (members.length < 2) continue;
    const ids = new Set<string>();
    for (const ci of members) {
      const c = corners[ci]!;
      if (c.before !== undefined) ids.add(faces[c.before]!.id);
      if (c.after !== undefined) ids.add(faces[c.after]!.id);
    }
    issues.push({ kind: "cornerMerged", faceIds: [...ids].sort(cmpStr) });
  }

  // 3. Lignes brutes, nettoyage, correction des parties de niveau (§2.4, §2.5).
  const rawOf = (i: number): { raw: Vtx[]; lv: FaceLevel } => {
    const f = faces[i]!;
    const cz = covered.get(i);
    const lv: FaceLevel = cz !== undefined ? { kind: "full", z: cz } : levelOf(i);
    if (lv.kind === "full") {
      return {
        raw: [
          { u: f.uLo, z: lv.z, prot: false },
          { u: f.uHi, z: lv.z, prot: false },
        ],
        lv,
      };
    }
    const head = headVertices(f, lv.start);
    if (!lv.end) {
      const pl = P(f);
      const last = head[head.length - 1]!;
      if (f.uHi - last.u > STRUCT_EPS)
        head.push({ u: f.uHi, z: pl.at(f.sigmaA + f.uHi), prot: false });
      return { raw: head, lv };
    }
    const knee = f.faceLength - lv.end.lambda;
    const raw = head.filter((v) => v.u < knee - STRUCT_EPS);
    raw.push({ u: knee, z: lv.end.z, prot: true, level: "end" });
    if (f.uHi - knee > STRUCT_EPS) raw.push({ u: f.uHi, z: lv.end.z, prot: false });
    return { raw, lv };
  };
  type Cleaned = ReturnType<typeof cleanLine> & { lv: FaceLevel };
  let cleaned: Cleaned[] = [];
  for (let round = 0; round < 5; round++) {
    cleaned = faces.map((f, i) => {
      const { raw, lv } = rawOf(i);
      return { ...cleanLine(raw, f, sec, dh, m, minAngle), lv };
    });
    if (round === 4) break;
    let deficient = false;
    cleaned.forEach((c, i) => {
      if (c.lv.kind !== "ends" || c.segments.length === 0) return;
      const f = faces[i]!;
      const first = c.segments[0]!;
      const last = c.segments[c.segments.length - 1]!;
      /** Garde l'allongement seulement s'il laisse une place ≥ m entre les deux niveaux. */
      const tryGain = (extra: number[], gain: number): void => {
        const before = extra[i]!;
        extra[i] = before + gain;
        const lv = levelOf(i);
        const lo = lv.kind === "ends" && lv.start ? lv.start.lambda : f.uLo;
        const hi = lv.kind === "ends" && lv.end ? f.faceLength - lv.end.lambda : f.uHi;
        if (lv.kind === "ends" && hi - lo >= m) deficient = true;
        else extra[i] = before;
      };
      if (c.lv.start && first.fibres.shortest < m - TOL) {
        tryGain(extraS, m - first.fibres.shortest + 1e-7);
      }
      if (c.lv.end && last.fibres.shortest < m - TOL) {
        tryGain(extraE, m - last.fibres.shortest + 1e-7);
      }
    });
    if (!deficient) break;
  }

  // 4. Résultats par face.
  const out: FaceBearing[] = [];
  faces.forEach((f, i) => {
    const c = cleaned[i]!;
    // Pente la plus forte de la ligne des nez sur la fenêtre (segments qui la recoupent).
    const plf = P(f);
    let pitchMax = -Infinity;
    for (let k = 0; k + 1 < plf.xs.length; k++) {
      const a = plf.xs[k]! - f.sigmaA;
      const b = plf.xs[k + 1]! - f.sigmaA;
      if (b <= f.uLo || a >= f.uHi || !(b > a)) continue;
      pitchMax = Math.max(pitchMax, Math.atan2(plf.ys[k + 1]! - plf.ys[k]!, b - a));
    }
    c.segments.forEach((s, k) => {
      if (s.fibres.shortest >= m - TOL) {
        const raccord = c.prot[k] === true || c.prot[k + 1] === true;
        const steeper = s.alpha > pitchMax + EPS_ANGLE;
        if (raccord && steeper && !s.level && s.u1 - s.u0 < m - TOL) {
          issues.push({
            kind: "steepSegment",
            faceId: f.id,
            u0: s.u0,
            planLength: s.u1 - s.u0,
            alpha: s.alpha,
          });
        }
        return;
      }
      const removable = (j: number): boolean => j > 0 && j + 1 < c.line.length && !c.prot[j];
      if (!removable(k) && !removable(k + 1)) {
        issues.push({
          kind: s.fibres.shortest < -TOL ? "cutsCross" : "shortSegment",
          faceId: f.id,
          u0: s.u0,
          shortest: s.fibres.shortest,
        });
      }
    });
    const upperRive = c.line.map((p) => ({ x: p.x, y: p.y + dh }));
    const pl = P(f);
    let devMax = 0;
    let devAt = f.uLo;
    let above = 0;
    let aboveAt = f.uLo;
    for (let k = 0; k < pl.xs.length; k++) {
      const u = pl.xs[k]! - f.sigmaA;
      if (u < f.uLo - STRUCT_EPS || u > f.uHi + STRUCT_EPS) continue;
      const B = polylineAt(c.line, u);
      const d = Math.abs(B - pl.ys[k]!);
      if (d > devMax) {
        devMax = d;
        devAt = u;
      }
      const e = pl.ys[k]! - (B + dh);
      if (e > above) {
        above = e;
        aboveAt = u;
      }
    }
    if (above > 1e-6) {
      issues.push({ kind: "noseAboveRive", faceId: f.id, u: aboveAt, excess: above });
    }
    out.push({
      faceId: f.id,
      side: f.side,
      start: f.start,
      end: f.end,
      uLo: f.uLo,
      uHi: f.uHi,
      line: c.line,
      upperRive,
      lowerRive: lowerRiveOf(upperRive, h),
      segments: c.segments,
      knees: c.knees,
      removed: c.removed,
      nosingDeviation: { max: devMax, atU: devAt },
      endShift: {
        start: polylineAt(c.line, f.uLo) - pl.at(f.sigmaA + f.uLo),
        end: polylineAt(c.line, f.uHi) - pl.at(f.sigmaA + f.uHi),
      },
    });
  });

  // 5. Parties de niveau rendues (une par groupe de coins).
  const levelBefore = (i: number): Mm => {
    const c = cleaned[i]!;
    const f = faces[i]!;
    if (c.lv.kind === "full" || covered.has(i)) return f.uHi - f.uLo;
    for (let k = c.line.length - 1; k > 0; k--) {
      if (Math.abs(c.line[k - 1]!.y - c.line[k]!.y) > 1e-9) return f.faceLength - c.line[k]!.x;
    }
    return f.faceLength - f.uLo;
  };
  const levelAfter = (i: number): Mm => {
    const c = cleaned[i]!;
    const f = faces[i]!;
    if (c.lv.kind === "full" || covered.has(i)) return f.uHi - f.uLo;
    for (let k = 0; k + 1 < c.line.length; k++) {
      if (Math.abs(c.line[k + 1]!.y - c.line[k]!.y) > 1e-9) return c.line[k]!.x;
    }
    return f.uHi;
  };
  const cornerLevels: CornerLevel[] = [];
  for (const g of roots) {
    const members = groupMembers(g);
    const first = corners[members[0]!]!;
    const last = corners[members[members.length - 1]!]!;
    const lengthBefore = first.before !== undefined ? levelBefore(first.before) : 0;
    const lengthAfter = last.after !== undefined ? levelAfter(last.after) : 0;
    const face = faces[(first.before ?? first.after)!]!;
    const pl = P(face);
    const s0 = first.sigma - lengthBefore;
    const s1 = last.sigma + lengthAfter;
    const skipped: number[] = [];
    pl.xs.forEach((x, k) => {
      if (x > s0 + STRUCT_EPS && x < s1 - STRUCT_EPS) skipped.push(k);
    });
    cornerLevels.push({
      ...(first.before !== undefined ? { faceBefore: faces[first.before]!.id } : {}),
      ...(last.after !== undefined ? { faceAfter: faces[last.after]!.id } : {}),
      z: groupZ(members[0]!),
      lengthBefore,
      lengthAfter,
      merged: members.length > 1,
      skippedNoses: skipped,
    });
  }
  out.sort((a, b) => cmpStr(a.faceId, b.faceId));
  return { faces: out, corners: cornerLevels, issues };
}

// ------------------------------------------------------------------------------ rives

/** Rives évaluables (prolongées : constantes au-delà d'un coin, segment extrême sinon). */
export interface RiveFns {
  readonly upper: (u: Mm) => Mm;
  readonly lower: (u: Mm) => Mm;
}

function clampedAt(pts: readonly Vec2[], u: Mm, levelBefore: boolean, levelAfter: boolean): Mm {
  if (pts.length === 0) return Number.NaN;
  if (levelBefore && u < pts[0]!.x) return pts[0]!.y;
  if (levelAfter && u > pts[pts.length - 1]!.x) return pts[pts.length - 1]!.y;
  return polylineAt(pts, u);
}

export function riveFns(fb: FaceBearing): RiveFns {
  const lb = fb.start === "corner";
  const la = fb.end === "corner";
  return {
    upper: (u) => clampedAt(fb.upperRive, u, lb, la),
    lower: (u) => clampedAt(fb.lowerRive, u, lb, la),
  };
}

/** Rives d'une barre droite sur une corde z = z0 + slope·(u − u0) (convention actuelle). */
export function chordRives(
  line: { readonly u0: Mm; readonly z0: Mm; readonly slope: number },
  upperOffset: Mm,
  h: Mm,
): RiveFns {
  const Hv = h / Math.cos(Math.atan(line.slope));
  const upper = (u: Mm): Mm => line.z0 + line.slope * (u - line.u0) + upperOffset;
  return { upper, lower: (u) => upper(u) - Hv };
}

/**
 * Écart à l'onglet entre deux barres consécutives (CK3, CK13, I2) : à la profondeur d derrière
 * la face côté marches, la fibre de la barre avant est en u = L_A + σc·d·tan(φ/2) et celle de la
 * barre après en u = −σc·d·tan(φ/2) ; écarts de rive haute à d = 0 (face côté marches), shift
 * (âme) et b (bout d'aile), et plus grand écart de rive basse aux mêmes profondeurs.
 */
export function miterFlangeGap(
  before: RiveFns,
  after: RiveFns,
  faceLengthBefore: Mm,
  corner: SteelCornerEnd,
  section: Pick<BearingSection, "b" | "shift">,
): { faceSide: Mm; web: Mm; flangeTip: Mm; lowerMax: Mm; max: Mm } {
  const sg = cornerSign(corner);
  const t = corner.tanHalf;
  const at = (d: Mm): { up: Mm; low: Mm } => {
    const uA = faceLengthBefore + sg * d * t;
    const uB = -sg * d * t;
    return {
      up: Math.abs(before.upper(uA) - after.upper(uB)),
      low: Math.abs(before.lower(uA) - after.lower(uB)),
    };
  };
  const g0 = at(0);
  const gw = at(section.shift);
  const gb = at(section.b);
  const lowerMax = Math.max(g0.low, gw.low, gb.low);
  return {
    faceSide: g0.up,
    web: gw.up,
    flangeTip: gb.up,
    lowerMax,
    max: Math.max(g0.up, gw.up, gb.up, lowerMax),
  };
}

// ------------------------------------------------------------------------------ logement

/** Support (cornière) sur une face : étendue [u0 ; u1] et altitude de son dessus. */
export interface WebSupport {
  readonly u0: Mm;
  readonly u1: Mm;
  readonly zTop: Mm;
}

/** Réglages du logement : hauteur du support, marge au-dessus de la rive basse, semelle. */
export interface WebFitParams {
  readonly depth: Mm;
  readonly edge: Mm;
  readonly tf: Mm;
  readonly minLength: Mm;
}

/**
 * Partie [u0 ; u1] du support logée dans l'âme (CK11) : dessus sous la rive haute moins t_f,
 * dessous à `edge` au-dessus de la rive basse plus t_f ; `lower = null` : hauteur infinie (seule
 * la contrainte haute). Exacte sur polylignes (fonctions affines entre sommets) : plus longue
 * partie admissible contiguë, départagée par le plus petit u ; vide → { u0: c.u0, u1: c.u0 }.
 */
export function fitInWebPolyline(
  upper: readonly Vec2[],
  lower: readonly Vec2[] | null,
  c: WebSupport,
  p: WebFitParams,
): { u0: Mm; u1: Mm } {
  if (!(c.u1 > c.u0)) return { u0: c.u0, u1: c.u0 };
  const cuts = new Set<number>([c.u0, c.u1]);
  for (const q of upper) if (q.x > c.u0 && q.x < c.u1) cuts.add(q.x);
  if (lower) for (const q of lower) if (q.x > c.u0 && q.x < c.u1) cuts.add(q.x);
  const xs = [...cuts].sort((a, b) => a - b);
  const zBot = c.zTop - p.depth - p.edge;
  const g1 = (u: Mm): Mm => polylineAt(upper, u) - p.tf - c.zTop;
  const g2 = (u: Mm): Mm => (lower ? zBot - polylineAt(lower, u) - p.tf : Infinity);
  /** Partie de [a ; b] où l'affine g ≥ 0 (tolérance TOL), `null` si vide. */
  const admissible = (g: (u: Mm) => Mm, a: Mm, b: Mm): [Mm, Mm] | null => {
    const ga = g(a);
    const gb = g(b);
    const okA = ga >= -TOL;
    const okB = gb >= -TOL;
    if (okA && okB) return [a, b];
    if (!okA && !okB) return null;
    const x = Math.min(b, Math.max(a, a + ((0 - ga) * (b - a)) / (gb - ga)));
    return okA ? [a, x] : [x, b];
  };
  const parts: [Mm, Mm][] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i]!;
    const b = xs[i + 1]!;
    const r1 = admissible(g1, a, b);
    if (!r1) continue;
    const r2 = lower ? admissible(g2, a, b) : ([a, b] as [Mm, Mm]);
    if (!r2) continue;
    const lo = Math.max(r1[0], r2[0]);
    const hi = Math.min(r1[1], r2[1]);
    if (hi < lo) continue;
    const prev = parts[parts.length - 1];
    if (prev && Math.abs(prev[1] - lo) <= 1e-12) prev[1] = hi;
    else parts.push([lo, hi]);
  }
  let best: [Mm, Mm] | null = null;
  for (const q of parts) if (!best || q[1] - q[0] > best[1] - best[0] + 1e-12) best = q;
  return best ? { u0: best[0], u1: best[1] } : { u0: c.u0, u1: c.u0 };
}

const fittedLength = (
  upper: readonly Vec2[],
  lower: readonly Vec2[] | null,
  c: WebSupport,
  p: WebFitParams,
): Mm => {
  const r = fitInWebPolyline(upper, lower, c, p);
  return r.u1 - r.u0;
};

/**
 * Hauteur perpendiculaire de section nécessaire pour que le support garde `minLength` logé
 * (CK11), par dichotomie sur h (rive haute fixe, rive basse `lowerRiveOf`) ; 0 si la hauteur
 * n'y peut rien (support trop court même à h infini) ou si h = 0 suffit ; `Infinity` si la
 * longueur n'est pas atteinte à h = 102 400 mm (aucune section ne convient).
 */
export function supportHeightNeed(upperRive: readonly Vec2[], c: WebSupport, p: WebFitParams): Mm {
  const need = p.minLength - TOL;
  if (fittedLength(upperRive, null, c, p) < need) return 0;
  const f = (h: Mm): Mm => fittedLength(upperRive, lowerRiveOf(upperRive, h), c, p);
  if (f(0) >= need) return 0;
  let lo = 0;
  let hi = 100;
  while (f(hi) < need && hi < 1e5) {
    lo = hi;
    hi *= 2;
  }
  if (f(hi) < need) return Infinity;
  while (hi - lo > 1e-6) {
    const mid = (lo + hi) / 2;
    if (f(mid) >= need) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Besoin de hauteur d'une face (max sur ses supports), marche déterminante, supports perdus. */
export function faceHeightNeed(
  fb: FaceBearing,
  supports: readonly (WebSupport & { readonly tread?: number })[],
  p: WebFitParams,
): { need: Mm; worstTread?: number; lost: readonly number[] } {
  let need = 0;
  let worst: number | undefined;
  const lost: number[] = [];
  for (const c of supports) {
    const n = supportHeightNeed(fb.upperRive, c, p);
    if (n > need) {
      need = n;
      worst = c.tread;
    }
    if (
      c.u1 - c.u0 >= p.minLength - TOL &&
      fittedLength(fb.upperRive, null, c, p) < p.minLength - TOL &&
      c.tread !== undefined
    ) {
      lost.push(c.tread);
    }
  }
  return { need, ...(worst !== undefined ? { worstTread: worst } : {}), lost };
}

/**
 * Section la plus légère (par masse linéique) dont h couvre le besoin calculé avec SA propre
 * ligne d'appui (les parties de niveau et le nettoyage dépendent de h, b et shift) ; `null` si
 * aucune.
 */
export function lightestBearingSection(
  sectionsByMass: readonly SteelSection[],
  need: (s: SteelSection) => Mm,
): SteelSection | null {
  for (const s of [...sectionsByMass].sort((a, b) => a.massPerMeter - b.massPerMeter)) {
    if (s.h >= need(s) - 1e-9) return s;
  }
  return null;
}
