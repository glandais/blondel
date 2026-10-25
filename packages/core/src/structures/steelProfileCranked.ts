/**
 * Câblage du **limon coudé** dans `steel-profile` (chantier bent-stringer, sous-lots K2b et K2c ;
 * décisions QUESTIONS A41, conventions CK1 à CK18 du ledger `docs/ledger/LEDGER-bent-stringer.md`).
 * Fonctions pures entre le noyau géométrique (`profileBearing.ts`) et le plugin : faces vues par
 * le noyau, plan par section essayée avec **repli par face sur la barre droite** (K-Q12, K-Q13),
 * contour de l'âme, tronçons (composantes, CK8), cordon de jarret (CK10), cotes de gabarit
 * (CK17), chemin du balayage (solide), écarts d'onglet au bout d'aile (CK13), cornière hors du
 * jarret (K-Q10, non branchée), remarques.
 * Aucun texte en dur : les remarques sont des `Message` à clés littérales.
 *
 * Lu seulement quand le paramètre `stringerLine` vaut `nosing` (CK16) : en `chord`, le plugin
 * n'appelle rien d'ici et ses sorties restent identiques à l'octet.
 */
import { dec, msg, type Message } from "@blondel/i18n";
import type { SteelSection } from "../catalog/sections.js";
import { signedArea } from "../geom2d/polygon.js";
import type { Mm, Vec2, Vec3 } from "../model/primitives.js";
import * as V from "../geom2d/vec.js";
import {
  bearingSectionOf,
  chordRives,
  cornerOf,
  faceHeightNeed,
  miterFlangeGap,
  polylineAt,
  profileBearings,
  riveFns,
  type BearingFace,
  type BearingInput,
  type BearingIssue,
  type BearingResult,
  type BearingSegment,
  type FaceBearing,
  type Knee,
  type KneeSettings,
  type RiveFns,
  type WebFitParams,
  type WebSupport,
} from "./profileBearing.js";
import { clipHalfPlane } from "./geom.js";
import { joinMessages } from "./steelCommon.js";
import type { SteelStringerFace } from "./steelFlat.js";

/** Corde d'une face : altitude z0 + slope·(u − u0) (ligne d'appui de la barre droite). */
export interface ChordLine {
  readonly u0: Mm;
  readonly z0: Mm;
  readonly slope: number;
}

/** Limon avant choix de section, vu par le câblage (sous-ensemble de `Pre` du plugin). */
export interface CrankedPre {
  readonly face: SteelStringerFace;
  readonly uLo: Mm;
  readonly uHi: Mm;
  readonly line: ChordLine;
}

/** Raison du repli d'une face sur la barre droite (K-Q12, K-Q13). */
export type CrankedFallbackReason =
  | { readonly kind: "emptyWindow" }
  | { readonly kind: "cutsCross"; readonly shortest: Mm }
  | { readonly kind: "shortSegment"; readonly shortest: Mm }
  | { readonly kind: "noseAboveRive"; readonly excess: Mm }
  | { readonly kind: "steepSegment"; readonly alpha: number }
  | { readonly kind: "lostSupport"; readonly treads: readonly number[] }
  | { readonly kind: "heavier"; readonly bent: Mm; readonly chord: Mm };

/** Décision pour une face et une section. */
export interface CrankedFacePlan {
  readonly faceId: string;
  /** `nosing` : limon coudé retenu ; `chord` : barre droite (repli, ou face à une seule pente). */
  readonly mode: "chord" | "nosing";
  /** Ligne d'appui coudée retenue (mode `nosing`). */
  readonly bearing?: FaceBearing;
  /** Besoin de hauteur d'âme retenu pour la section (celui du mode choisi). */
  readonly need: Mm;
  readonly chordNeed: Mm;
  /** Besoin du limon coudé, quand il a été évalué. */
  readonly bentNeed?: Mm;
  /** Raison du repli ; absente : limon coudé, ou face à une seule pente (CK7). */
  readonly fallback?: CrankedFallbackReason;
}

export interface CrankedSectionPlan {
  readonly faces: ReadonlyMap<string, CrankedFacePlan>;
  readonly result: BearingResult;
}

/** Face vue par le noyau (`profileBearings`). */
export function crankedBearingFace(p: CrankedPre): BearingFace {
  const f = p.face;
  return {
    id: f.id,
    side: f.side,
    sigmaA: f.sigmaA,
    faceLength: f.faceLength,
    uLo: p.uLo,
    uHi: p.uHi,
    start: f.start,
    end: f.end,
    ...(f.startCorner ? { startCorner: f.startCorner } : {}),
    ...(f.endCorner ? { endCorner: f.endCorner } : {}),
  };
}

/** Faces vues par le noyau, dans l'ordre des limons. */
export function crankedBearingFaces(pres: readonly CrankedPre[]): BearingFace[] {
  return pres.map(crankedBearingFace);
}

/**
 * Face à une seule pente (CK7) : un seul tronçon, sans coin, confondu avec la corde (pente et
 * altitude à 1e-9). La barre droite actuelle est alors gardée telle quelle, sans remarque, pour
 * que les escaliers droits restent identiques à l'octet en `nosing`.
 */
export function isChordEquivalent(fb: FaceBearing, line: ChordLine): boolean {
  if (fb.segments.length !== 1 || fb.start === "corner" || fb.end === "corner") return false;
  const seg = fb.segments[0]!;
  return (
    Math.abs(Math.tan(seg.alpha) - line.slope) < 1e-9 &&
    Math.abs(polylineAt(fb.line, line.u0) - line.z0) < 1e-9
  );
}

/** Tolérance d'égalité des besoins (mm) : précision de la dichotomie de `supportHeightNeed`. */
const NEED_TOL = 1e-6;

/** Constats du noyau qui rendent le limon coudé infaisable sur une face, par priorité. */
const BLOCKING: readonly BearingIssue["kind"][] = [
  "emptyWindow",
  "cutsCross",
  "shortSegment",
  "noseAboveRive",
  "steepSegment",
];

export interface CrankedDecisionInput {
  /** Ligne d'appui coudée de la face (absente : fenêtre vide pour le noyau). */
  readonly fb: FaceBearing | undefined;
  /** Constats du noyau portant sur cette face. */
  readonly issues: readonly BearingIssue[];
  readonly line: ChordLine;
  /** Besoin et marches perdues du limon coudé (`faceHeightNeed`). */
  readonly bentNeed: Mm;
  readonly bentLost: readonly number[];
  /** Besoin et marches perdues de la barre droite (corde, forme fermée actuelle). */
  readonly chordNeed: Mm;
  readonly chordLost: readonly number[];
  /** Hauteur h de la section essayée. */
  readonly sectionHeight: Mm;
}

/**
 * Décision par face (K-Q12, K-Q13), ordre de priorité déterministe :
 * 1. ligne coudée absente → repli `emptyWindow` ;
 * 2. face à une seule pente (CK7) → barre droite **sans** remarque ;
 * 3. constat bloquant du noyau sur la face (`emptyWindow`, `cutsCross`, `shortSegment`,
 *    `noseAboveRive`, `steepSegment`, dans cet ordre) → repli ;
 * 4. marche que la barre droite porte et que le limon coudé ne porte pas → repli `lostSupport` ;
 * 5. limon coudé qui demande plus d'âme que la barre droite **et** que la section essayée
 *    (`Infinity` compris) → repli `heavier`. Un limon coudé un peu plus exigeant que la barre
 *    droite mais logé dans la section reste coudé : c'est la section que la face imposerait qui
 *    compte (lecture de K-Q12 retenue en K2b ; sans elle, j3c replierait trois faces sur quatre
 *    pour 0,03 à 3,4 mm et ses onglets s'ouvriraient de 38 mm au bout d'aile, alors que les
 *    mesures K2a présentées à l'utilisateur les supposaient toutes coudées).
 */
export function decideCrankedFace(input: CrankedDecisionInput): {
  readonly mode: "chord" | "nosing";
  readonly fallback?: CrankedFallbackReason;
} {
  const { fb } = input;
  if (!fb) return { mode: "chord", fallback: { kind: "emptyWindow" } };
  if (isChordEquivalent(fb, input.line)) return { mode: "chord" };
  for (const kind of BLOCKING) {
    const i = input.issues.find((x) => x.kind === kind);
    if (!i) continue;
    switch (i.kind) {
      case "emptyWindow":
        return { mode: "chord", fallback: { kind: "emptyWindow" } };
      case "cutsCross":
      case "shortSegment":
        return { mode: "chord", fallback: { kind: i.kind, shortest: i.shortest } };
      case "noseAboveRive":
        return { mode: "chord", fallback: { kind: "noseAboveRive", excess: i.excess } };
      case "steepSegment":
        return { mode: "chord", fallback: { kind: "steepSegment", alpha: i.alpha } };
      default:
        break;
    }
  }
  const chordLost = new Set(input.chordLost);
  const lost = [...new Set(input.bentLost)].filter((t) => !chordLost.has(t)).sort((a, b) => a - b);
  if (lost.length > 0) return { mode: "chord", fallback: { kind: "lostSupport", treads: lost } };
  const fitsSection = input.bentNeed <= input.sectionHeight + 1e-9;
  if (!(input.bentNeed <= input.chordNeed + NEED_TOL) && !fitsSection) {
    return {
      mode: "chord",
      fallback: { kind: "heavier", bent: input.bentNeed, chord: input.chordNeed },
    };
  }
  return { mode: "nosing" };
}

export interface CrankedPlanInput<P extends CrankedPre> {
  readonly pres: readonly P[];
  readonly bearingFaces: readonly BearingFace[];
  readonly pitch: BearingInput["pitch"];
  readonly upperOffset: Mm;
  readonly knee: KneeSettings;
  readonly section: SteelSection;
  readonly webFit: WebFitParams;
  /** Supports candidats de la face (avant rognage), avec leur marche. */
  readonly supportsOf: (p: P) => readonly (WebSupport & { readonly tread: number })[];
  /** Besoin de la barre droite pour la section (forme fermée du plugin). */
  readonly chordNeedOf: (p: P) => Mm;
  /** Marches que la barre droite ne peut pas porter, quelle que soit la hauteur. */
  readonly chordLostOf: (p: P) => readonly number[];
}

/**
 * Plan d'une section : lignes d'appui coudées de toutes les faces (`profileBearings`, qui
 * dépendent de h, b et shift), besoin du limon coudé par face (`faceHeightNeed`), décision par
 * face (`decideCrankedFace`). Ne lève jamais (le noyau non plus).
 */
export function crankedSectionPlan<P extends CrankedPre>(
  input: CrankedPlanInput<P>,
): CrankedSectionPlan {
  const result = profileBearings({
    faces: input.bearingFaces,
    pitch: input.pitch,
    upperOffset: input.upperOffset,
    section: bearingSectionOf(input.section),
    settings: input.knee,
  });
  const byId = new Map(result.faces.map((f) => [f.faceId, f]));
  const faces = new Map<string, CrankedFacePlan>();
  for (const p of input.pres) {
    const id = p.face.id;
    const fb = byId.get(id);
    const chordNeed = input.chordNeedOf(p);
    const issues = result.issues.filter((i) => "faceId" in i && i.faceId === id);
    const chordEquivalent = fb !== undefined && isChordEquivalent(fb, p.line);
    const bent =
      fb && !chordEquivalent ? faceHeightNeed(fb, input.supportsOf(p), input.webFit) : undefined;
    const decision = decideCrankedFace({
      fb,
      issues,
      line: p.line,
      bentNeed: bent?.need ?? chordNeed,
      bentLost: bent?.lost ?? [],
      chordNeed,
      chordLost: bent ? input.chordLostOf(p) : [],
      sectionHeight: input.section.h,
    });
    const nosing = decision.mode === "nosing" && fb !== undefined;
    faces.set(id, {
      faceId: id,
      mode: nosing ? "nosing" : "chord",
      ...(nosing ? { bearing: fb } : {}),
      need: nosing ? bent!.need : chordNeed,
      chordNeed,
      ...(bent ? { bentNeed: bent.need } : {}),
      ...(decision.fallback ? { fallback: decision.fallback } : {}),
    });
  }
  return { faces, result };
}

// ------------------------------------------------------------------------------ jarrets et cornières

// Décalage K-Q10 (cornière hors du jarret) : `kneeCutBand`, `kneeFreePieces` et `kneeFreeSupport`
// sont prêtes mais **non branchées** dans `steel-profile` (relecture K2c) : branché, le décalage
// fait monter j3c en UPN 200 et j5b en UPN 220 sous la réserve de 5 mm (critères K2b). La
// cornière reste à cheval sur le jarret, son traçage est coupé au joint et ses perçages trop
// près de la coupe sont reportés après soudage (`structure.steelProfile.note.kneeHolesAfterWeld`),
// en attendant l'arbitrage de l'utilisateur (QUESTIONS A41, K-Q10 reposée).

/** Tolérance de recouvrement (mm) : une cornière qui touche une coupe de jarret n'est pas à cheval. */
const BAND_EPS = 1e-9;

/**
 * Étendue en u de la coupe d'un jarret dans la tranche z ∈ [z0 ; z1] : demi-droite de la
 * bissectrice issue du sommet de rive haute vers le sommet bas (et au-delà), indépendante de la
 * hauteur h de la section (la bissectrice ne dépend que des deux pentes) ; `null` si la tranche
 * est au-dessus du sommet de rive haute.
 */
export function kneeCutBand(k: Knee, z0: Mm, z1: Mm): { u0: Mm; u1: Mm } | null {
  const zh = Math.min(z1, k.upper.y);
  if (z0 > zh) return null;
  const d = V.sub(k.lower, k.upper);
  if (!(d.y < -1e-12)) return { u0: k.upper.x, u1: k.upper.x };
  const uAt = (z: Mm): Mm => k.upper.x + (d.x * (z - k.upper.y)) / d.y;
  const a = uAt(z0);
  const b = uAt(zh);
  return { u0: Math.min(a, b), u1: Math.max(a, b) };
}

/**
 * Cornière à cheval sur un jarret **décalée hors du jarret** (décision K-Q10 de l'utilisateur,
 * convention Blondel non sourcée, à valider) : on retire de [c.u0 ; c.u1] l'étendue de chaque
 * coupe de jarret de la face dans la hauteur de la cornière [zTop − depth ; zTop] (`kneeFreePieces`)
 * et l'on garde le morceau de plus petit `score` (défaut : le plus long ; à égalité, le plus
 * petit u0). Aucun jeu ajouté entre la cornière et le cordon du jarret (aucune valeur sourcée).
 * Aucune coupe touchée : rend **le même objet** (identité) ; plus aucun morceau : support vide en
 * c.u0.
 *
 * **Non branché en K2c** : décaler la cornière hors du jarret de son propre nez repousse sa partie
 * logée vers le haut du tronçon et fait monter l'âme requise (j3c UPN 180 → UPN 200, j5b réserve
 * 4,65 mm en UPN 220, sous le critère K2b de 5 mm ; journal K2c) ; le plan K2c demandait alors de
 * s'arrêter et de reposer la question. Les cornières à cheval restent posées comme en K2b et
 * leur traçage est coupé au joint des tronçons (CK9).
 */
export function kneeFreeSupport<S extends WebSupport>(
  fb: FaceBearing,
  c: S,
  depth: Mm,
  score?: (piece: S) => number,
): S {
  const pieces = kneeFreePieces(fb, c, depth);
  if (pieces === null) return c;
  let best: S | null = null;
  let bestScore = Infinity;
  for (const [a, b] of pieces) {
    const piece = { ...c, u0: a, u1: b };
    const sc = score ? score(piece) : -(b - a);
    if (sc < bestScore - 1e-9) {
      best = piece;
      bestScore = sc;
    }
  }
  return best ?? { ...c, u0: c.u0, u1: c.u0 };
}

/** Morceaux de [c.u0 ; c.u1] hors des coupes de jarret (u croissants) ; `null` : aucune coupe touchée. */
export function kneeFreePieces(fb: FaceBearing, c: WebSupport, depth: Mm): [Mm, Mm][] | null {
  const bands: { u0: Mm; u1: Mm }[] = [];
  for (const k of fb.knees) {
    const b = kneeCutBand(k, c.zTop - depth, c.zTop);
    if (b && b.u0 < c.u1 - BAND_EPS && b.u1 > c.u0 + BAND_EPS) bands.push(b);
  }
  if (bands.length === 0) return null;
  bands.sort((a, b) => a.u0 - b.u0);
  const out: [Mm, Mm][] = [];
  let cur = c.u0;
  for (const b of bands) {
    if (b.u0 > cur) out.push([cur, b.u0]);
    cur = Math.max(cur, b.u1);
  }
  if (cur < c.u1) out.push([cur, c.u1]);
  return out;
}

// ------------------------------------------------------------------------------ tronçons

/** Normale unitaire de la coupe d'un jarret, orientée vers les u croissants (tronçon du dessus). */
export function kneeNormal(k: Knee): Vec2 {
  const d = V.sub(k.lower, k.upper);
  return V.normalize(V.vec(-d.y, d.x));
}

/** Le point q est-il du côté du tronçon du dessus de la coupe du jarret (bissectrice) ? */
export function afterKnee(k: Knee, q: Vec2): boolean {
  return V.dot(V.sub(q, k.upper), kneeNormal(k)) >= 0;
}

/**
 * Numéro (1 à n, du bas vers le haut) du tronçon qui contient le point q de l'âme : côté de la
 * bissectrice de chaque jarret (une seule composante par point : le point sur une coupe va au
 * tronçon du dessus).
 */
export function componentIndexAt(fb: FaceBearing, q: Vec2): number {
  for (let j = 0; j < fb.knees.length; j++) if (!afterKnee(fb.knees[j]!, q)) return j + 1;
  return fb.knees.length + 1;
}

/** Composante (tronçon) d'un limon coudé : polygone de l'âme, coupes, longueur de débit. */
export interface CrankedComponentSpec {
  /** Numéro du tronçon, de 1 (bas) à n (haut). */
  readonly index: number;
  readonly segment: BearingSegment;
  /** Partie du contour de l'âme (u, z), coupé au sol, entre les coupes des jarrets voisins. */
  readonly polygon: readonly Vec2[];
  /** Jarret du bas (absent : extrémité basse de la face). */
  readonly startKnee?: Knee;
  /** Jarret du haut (absent : extrémité haute de la face). */
  readonly endKnee?: Knee;
  /**
   * Longueur de débit (CK10) : encombrement axial du tronçon (coupes de jarret et onglets
   * compris), moins la coupe de sol pour le premier.
   */
  readonly length: Mm;
}

/**
 * Composantes d'un limon coudé (CK8) : contour de l'âme coupé au sol, intersecté avec les
 * demi-plans des coupes des jarrets voisins (bissectrices). Chaque polygone est convexe
 * (intersection de demi-plans : sous la rive haute droite du tronçon, au-dessus de sa rive basse
 * droite, entre deux coupes, au-dessus du sol) ; leur réunion est le contour. La bissectrice
 * d'un jarret coupe une seule fois chaque rive (rives croissantes, bissectrice de pente
 * négative) : le découpage par droite infinie est sûr.
 */
export function crankedComponentSpecs(
  fb: FaceBearing,
  outline: readonly Vec2[],
  floorTrim: Mm,
): CrankedComponentSpec[] {
  const n = fb.segments.length;
  const out: CrankedComponentSpec[] = [];
  for (let i = 0; i < n; i++) {
    const startKnee = i > 0 ? fb.knees[i - 1] : undefined;
    const endKnee = i + 1 < n ? fb.knees[i] : undefined;
    let poly: Vec2[] = [...outline];
    if (startKnee) poly = clipHalfPlane(poly, startKnee.upper, kneeNormal(startKnee));
    if (endKnee) poly = clipHalfPlane(poly, endKnee.upper, V.scale(kneeNormal(endKnee), -1));
    if (signedArea(poly) < 0) poly.reverse();
    const seg = fb.segments[i]!;
    out.push({
      index: i + 1,
      segment: seg,
      polygon: poly,
      ...(startKnee ? { startKnee } : {}),
      ...(endKnee ? { endKnee } : {}),
      length: seg.fibres.axialExtent - (i === 0 ? floorTrim : 0),
    });
  }
  return out;
}

/**
 * Cordon d'un jarret (CK10) : coupe sur la bissectrice, rives de la coupe h / cos β (β = |Δα| / 2),
 * longueurs transversales (ailes, P − 2h) inchangées ; porté par le tronçon du dessus [choix
 * Blondel, à valider : F17 (2) ne vise que l'onglet en plan].
 */
export function kneeWeldLength(k: Pick<Knee, "beta">, h: Mm, perimeter: Mm): Mm {
  return (2 * h) / Math.cos(k.beta) + (perimeter - 2 * h);
}

/** Cote de gabarit d'un jarret (CK17). */
export interface CrankedJigItem {
  readonly index: number;
  /** Abscisse horizontale du sommet de rive haute depuis l'extrémité basse du limon (mm). */
  readonly x: Mm;
  /** Cote de la rive haute au jarret, au-dessus du sol fini (mm). */
  readonly z: Mm;
  /** Pentes avant et après le jarret (degrés). */
  readonly before: number;
  readonly after: number;
}

/**
 * Cotes de gabarit (CK17, préfabrication au marbre) : pour chaque jarret, abscisse du sommet de
 * rive haute depuis l'extrémité basse (`uOrigin`, plus petit u du contour), cote de rive haute,
 * pentes du tronçon avant et après.
 */
export function crankedJigItems(fb: FaceBearing, uOrigin: Mm): CrankedJigItem[] {
  const deg = (a: number): number => (a * 180) / Math.PI;
  return fb.knees.map((k, j) => ({
    index: j + 1,
    x: k.upper.x - uOrigin,
    z: k.upper.y,
    before: deg(fb.segments[j]!.alpha),
    after: deg(fb.segments[j + 1]!.alpha),
  }));
}

// ------------------------------------------------------------------------------ géométrie

/**
 * Contour de l'âme en (u, z) d'un limon coudé entre ses coupes d'extrémité (abscisses `uLoW`,
 * `uHiW` à l'âme, onglets compris) : rive basse de gauche à droite, puis rive haute de droite à
 * gauche. Les sommets intérieurs des rives sont gardés ; aux bornes, les rives sont évaluées par
 * `riveFns` (constantes au-delà d'un coin, partie de niveau, segment extrême sinon). Polygone
 * simple : les deux rives sont des polylignes d'abscisses strictement croissantes, la rive haute
 * au-dessus de la rive basse.
 */
export function crankedOutline(fb: FaceBearing, uLoW: Mm, uHiW: Mm): Vec2[] {
  const r = riveFns(fb);
  const inner = (pts: readonly Vec2[]): Vec2[] =>
    pts.filter((q) => q.x > uLoW + 1e-9 && q.x < uHiW - 1e-9).map((q) => V.vec(q.x, q.y));
  return [
    V.vec(uLoW, r.lower(uLoW)),
    ...inner(fb.lowerRive),
    V.vec(uHiW, r.lower(uHiW)),
    V.vec(uHiW, r.upper(uHiW)),
    ...inner(fb.upperRive).reverse(),
    V.vec(uLoW, r.upper(uLoW)),
  ];
}

/**
 * Extrémités axiales d'un limon coudé : rive basse (u, z) entre les coupes d'extrémité, directions
 * t0 / t1 du premier et du dernier tronçon, et décalages le long de ces directions des bouts
 * d'équerre qui enferment le contour coupé au sol : `start` = plus petite projection sur t0 des
 * points du contour avant le premier jarret (> 0 quand la coupe de sol retire le bas du limon),
 * `end` = plus grande projection sur t1 des points après le dernier jarret (h·tan α d'une coupe
 * d'aplomb). Bornés à 1 mm du premier (dernier) sommet intérieur.
 */
export function crankedAxialEnds(
  fb: FaceBearing,
  outline: readonly Vec2[],
  uLoW: Mm,
  uHiW: Mm,
): { pts: Vec2[]; t0: Vec2; t1: Vec2; start: Mm; end: Mm } {
  const r = riveFns(fb);
  const pts: Vec2[] = [
    V.vec(uLoW, r.lower(uLoW)),
    ...fb.lowerRive.filter((q) => q.x > uLoW + 1e-9 && q.x < uHiW - 1e-9),
    V.vec(uHiW, r.lower(uHiW)),
  ];
  const n = pts.length;
  const firstKnee = fb.knees.length > 0 ? fb.knees[0]!.u : Infinity;
  const lastKnee = fb.knees.length > 0 ? fb.knees[fb.knees.length - 1]!.u : -Infinity;
  const t0 = V.normalize(V.sub(pts[1]!, pts[0]!));
  const t1 = V.normalize(V.sub(pts[n - 1]!, pts[n - 2]!));
  let s0 = Infinity;
  let s1 = -Infinity;
  for (const q of outline) {
    if (q.x <= firstKnee + 1e-9) s0 = Math.min(s0, V.dot(V.sub(q, pts[0]!), t0));
    if (q.x >= lastKnee - 1e-9) s1 = Math.max(s1, V.dot(V.sub(q, pts[n - 1]!), t1));
  }
  const len0 = V.distance(pts[0]!, pts[1]!);
  const len1 = V.distance(pts[n - 2]!, pts[n - 1]!);
  return {
    pts,
    t0,
    t1,
    start: Number.isFinite(s0) ? Math.min(s0, Math.max(0, len0 - 1)) : 0,
    end: Number.isFinite(s1) ? Math.max(s1, Math.min(0, 1 - len1)) : 0,
  };
}

/**
 * Chemin du balayage du solide d'un limon coudé (CK15) : rive basse sur la face côté marches,
 * en 3D (f.a + f.dir·u, z). Les sommets intérieurs de la rive basse sont sur les bissectrices des
 * jarrets (CK4) : l'onglet du balayage dans le plan bissecteur coïncide avec la coupe de jarret,
 * et la section (repère `upright` : v perpendiculaire au tronçon dans le plan vertical de l'âme)
 * redonne la rive haute. Extrémités d'équerre comme l'extrusion de la barre droite : début
 * avancé jusqu'à la plus petite projection sur le premier tronçon du contour coupé au sol (borné
 * avant le premier jarret), fin prolongée jusqu'à la plus grande projection sur le dernier
 * tronçon (h·tan α d'une coupe d'aplomb). Parcours dans le sens où u = v × t pointe vers `into`
 * (sinon chemin inversé), comme l'axe de l'extrusion.
 *
 * Coins en plan (K2c, limite de K2b corrigée) : à une extrémité `corner`, le chemin est prolongé
 * horizontalement de `extend` (mm en plan, `miterCutExtra` du plugin : (b − shift)·tan(φ/2) à un
 * angle rentrant, shift·tan(φ/2) à un angle saillant, b − shift en volées, 0 au raccord de
 * palier) le long du tronçon d'extrémité (de niveau, K-Q7), bout d'équerre : la réunion des deux
 * barres prolongées couvre le L de l'onglet, sans le vide d'environ b × b dans les ailes que
 * laissait l'extrémité arrêtée sur l'âme au droit du coin.
 */
export function crankedSweepPath(
  fb: FaceBearing,
  face: Pick<SteelStringerFace, "a" | "dir" | "into">,
  outline: readonly Vec2[],
  uLoW: Mm,
  uHiW: Mm,
  extend: { readonly start: Mm; readonly end: Mm } = { start: 0, end: 0 },
): Vec3[] {
  const { pts: base, t0, t1, start, end } = crankedAxialEnds(fb, outline, uLoW, uHiW);
  const pts = [...base];
  const n = pts.length;
  // Seulement aux extrémités `corner` (sol, poteau et arrivée : coupes d'aplomb, comme K2b).
  const along = (t: Vec2, e: Mm, corner: boolean): Mm =>
    corner && e > 0 && t.x > 1e-9 ? e / t.x : 0;
  pts[0] = V.addScaled(pts[0]!, t0, start - along(t0, extend.start, fb.start === "corner"));
  pts[n - 1] = V.addScaled(pts[n - 1]!, t1, end + along(t1, extend.end, fb.end === "corner"));
  const path = pts.map((q): Vec3 => {
    const pl = V.addScaled(face.a, face.dir, q.x);
    return { x: pl.x, y: pl.y, z: q.y };
  });
  const forward = V.dot(face.into, V.perpLeft(face.dir)) > 0;
  return forward ? path : path.reverse();
}

/** Limon construit, vu par le contrôle d'onglet. */
export interface CrankedMiterStringer {
  readonly face: SteelStringerFace;
  readonly uLo: Mm;
  readonly uHi: Mm;
  readonly line: ChordLine;
  readonly bearing?: FaceBearing;
}

/** Écart d'onglet (FAB_ONGLET_RACCORD), à la manière de `PartCheckItem`. */
export interface CrankedMiterItem {
  readonly value: Mm;
  readonly label: Message;
  readonly partId: string;
}

/**
 * Écarts de rive haute **au bout d'aile** (fibre la plus longue, CK13) aux onglets et raccords
 * entre limons consécutifs d'un même côté (fin `corner` d'une face, début `corner` de la face
 * qui la suit le long du côté, σ continu) : rives coudées (`riveFns`) d'un limon coudé, rives de
 * la barre droite (`chordRives`) d'un limon replié ; coin effectif `cornerOf` (CK5 : onglet à 45°
 * d'un angle rentrant en volées). `bentOnly` : seulement les coins où l'un des deux limons au
 * moins est coudé (deux limons repliés sont mesurés comme en `chord` par le plugin).
 */
export function crankedMiterItems(
  stringers: readonly CrankedMiterStringer[],
  s: SteelSection,
  upperOffset: Mm,
  label: (a: CrankedMiterStringer, b: CrankedMiterStringer) => Message,
  bentOnly = false,
): CrankedMiterItem[] {
  const sec = bearingSectionOf(s);
  const rivesOf = (x: CrankedMiterStringer): RiveFns =>
    x.bearing ? riveFns(x.bearing) : chordRives(x.line, upperOffset, s.h);
  const items: CrankedMiterItem[] = [];
  for (const a of stringers) {
    if (a.face.end !== "corner") continue;
    const sigmaEnd = a.face.sigmaA + a.face.faceLength;
    const b = stringers.find(
      (x) =>
        x !== a &&
        x.face.side === a.face.side &&
        x.face.start === "corner" &&
        Math.abs(x.face.sigmaA - sigmaEnd) < 1e-6,
    );
    if (!b) continue;
    if (bentOnly && !a.bearing && !b.bearing) continue;
    const corner = cornerOf(crankedBearingFace(a), "end")!;
    const gap = miterFlangeGap(rivesOf(a), rivesOf(b), a.face.faceLength, corner, sec);
    items.push({ value: gap.flangeTip, label: label(a, b), partId: b.face.id });
  }
  return items;
}

// ------------------------------------------------------------------------------ remarques

/** Raison d'un repli, traduite à l'affichage. */
export function crankedFallbackReasonMessage(reason: CrankedFallbackReason): Message {
  switch (reason.kind) {
    case "emptyWindow":
      return msg("structure.steelProfile.crankedFallback.emptyWindow");
    case "cutsCross":
      return msg("structure.steelProfile.crankedFallback.cutsCross", {
        shortest: dec(reason.shortest, 0),
      });
    case "shortSegment":
      return msg("structure.steelProfile.crankedFallback.shortSegment", {
        shortest: dec(reason.shortest, 0),
      });
    case "noseAboveRive":
      return msg("structure.steelProfile.crankedFallback.noseAboveRive", {
        excess: dec(reason.excess, 0),
      });
    case "steepSegment":
      return msg("structure.steelProfile.crankedFallback.steepSegment", {
        angle: dec((reason.alpha * 180) / Math.PI, 1),
      });
    case "lostSupport":
      return msg("structure.steelProfile.crankedFallback.lostSupport", {
        treads: reason.treads.join(", "),
      });
    case "heavier":
      // Besoin coudé infini (aucune hauteur ne loge le coudé) : clé dédiée, sans unité.
      return Number.isFinite(reason.bent)
        ? msg("structure.steelProfile.crankedFallback.heavier", {
            bent: dec(reason.bent, 1),
            chord: dec(reason.chord, 1),
          })
        : msg("structure.steelProfile.crankedFallback.heavierUnbounded", {
            chord: dec(reason.chord, 1),
          });
  }
}

/** Remarque d'une face repliée sur la barre droite (K-Q12, K-Q13). */
export function crankedFallbackNote(mark: string, reason: CrankedFallbackReason): Message {
  return msg("structure.steelProfile.note.crankedFallback", {
    mark,
    reason: crankedFallbackReasonMessage(reason),
  });
}

/** Repère de la composante k (1 à n, du bas vers le haut) d'un limon coudé (CK8 : `LE2-1`…). */
export function crankedComponentMark(mark: string, index: number): string {
  return `${mark}-${index}`;
}

/** Remarque d'une face en limon coudé à plusieurs tronçons (CK8, CK10). */
export function crankedNote(mark: string, fb: FaceBearing): Message {
  const n = fb.segments.length;
  return msg("structure.steelProfile.note.cranked", {
    mark,
    segments: n,
    first: crankedComponentMark(mark, 1),
    last: crankedComponentMark(mark, n),
    knees: fb.knees.length,
  });
}

/** Remarque d'une face coudée faite d'un seul tronçon (pente propre, sans jarret). */
export function crankedSingleNote(mark: string, fb: FaceBearing): Message {
  const a = fb.segments[0]?.alpha ?? 0;
  return msg("structure.steelProfile.note.crankedSingle", {
    mark,
    angle: dec((a * 180) / Math.PI, 1),
  });
}

/** Remarque des cotes de gabarit d'un limon coudé (CK17) ; `null` sans jarret. */
export function crankedJigNote(mark: string, items: readonly CrankedJigItem[]): Message | null {
  const knees = joinMessages(
    items.map((it) =>
      msg("structure.steelProfile.note.jigKnee", {
        index: it.index,
        x: dec(it.x, 0),
        z: dec(it.z, 0),
        before: dec(it.before, 1),
        after: dec(it.after, 1),
      }),
    ),
  );
  return knees ? msg("structure.steelProfile.note.jigDimensions", { mark, knees }) : null;
}
