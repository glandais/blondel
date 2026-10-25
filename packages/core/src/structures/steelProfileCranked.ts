/**
 * Câblage du **limon coudé** dans `steel-profile` (chantier bent-stringer, sous-lot K2b ;
 * décisions QUESTIONS A41, conventions CK1 à CK18 du ledger `docs/ledger/LEDGER-bent-stringer.md`).
 * Fonctions pures entre le noyau géométrique (`profileBearing.ts`) et le plugin : faces vues par
 * le noyau, plan par section essayée avec **repli par face sur la barre droite** (K-Q12, K-Q13),
 * contour de l'âme, chemin du balayage (solide), écarts d'onglet au bout d'aile (CK13), remarques.
 * Aucun texte en dur : les remarques sont des `Message` à clés littérales.
 *
 * Lu seulement quand le paramètre `stringerLine` vaut `nosing` (CK16) : en `chord`, le plugin
 * n'appelle rien d'ici et ses sorties restent identiques à l'octet.
 */
import { dec, msg, type Message } from "@blondel/i18n";
import type { SteelSection } from "../catalog/sections.js";
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
  type FaceBearing,
  type KneeSettings,
  type RiveFns,
  type WebFitParams,
  type WebSupport,
} from "./profileBearing.js";
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
 * Limite connue (K2b, à reprendre en K2c) : à un coin mural, l'extrémité d'équerre s'arrête sur
 * l'âme au droit du coin, alors que l'extrusion de la barre droite va jusqu'à l'onglet ; l'aperçu
 * 3D montre un vide d'environ b × b dans les ailes au coin. Piste : prolonger le chemin par un
 * court segment horizontal dans la direction de la face voisine (raccord du balayage sur la
 * bissectrice en plan, onglet à φ/2).
 */
export function crankedSweepPath(
  fb: FaceBearing,
  face: Pick<SteelStringerFace, "a" | "dir" | "into">,
  outline: readonly Vec2[],
  uLoW: Mm,
  uHiW: Mm,
): Vec3[] {
  const { pts: base, t0, t1, start, end } = crankedAxialEnds(fb, outline, uLoW, uHiW);
  const pts = [...base];
  const n = pts.length;
  pts[0] = V.addScaled(pts[0]!, t0, start);
  pts[n - 1] = V.addScaled(pts[n - 1]!, t1, end);
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

/** Remarque d'une face en limon coudé (approximations de K2b). */
export function crankedNote(mark: string, fb: FaceBearing): Message {
  return msg("structure.steelProfile.note.cranked", {
    mark,
    knees: fb.knees.length,
    segments: fb.segments.length,
  });
}
