/**
 * Câblage du **limon coudé** dans `steel-profile` (chantier bent-stringer, sous-lots K2b, K2c et K2e ;
 * décisions QUESTIONS A41, conventions CK1 à CK18 du ledger `docs/ledger/LEDGER-bent-stringer.md`).
 * Fonctions pures entre le noyau géométrique (`profileBearing.ts`) et le plugin : faces vues par
 * le noyau, plan par section essayée avec **repli par face sur la barre droite** (K-Q12, K-Q13),
 * contour de l'âme, tronçons (composantes, CK8), cordon de jarret (CK10), cotes de gabarit
 * (CK17), chemin du balayage (solide), écarts d'onglet au bout d'aile (CK13), cornière au coin
 * du mur (K-Q4, sous-lot K2e ; décisions K-Q16 à K-Q18 en K2e2 : marche sans appui côté jour et
 * paliers exclus du retrait, coin du mur seulement), raccords de palier (K-Q27, sous-lot K2f2 :
 * coudé forcé, sinon refus), remarques. Une cornière à cheval sur un
 * jarret reste en place (K-Q10 révisée) : son traçage est coupé au joint et ses perçages trop
 * près de la coupe sont reportés après soudage (plugin).
 * Aucun texte en dur : les remarques sont des `Message` à clés littérales.
 *
 * Lu seulement quand le paramètre `stringerLine` vaut `nosing` (CK16 ; défaut depuis le sous-lot
 * K2d, décision K-Q11) : en `chord`, le plugin n'appelle rien d'ici et ses sorties restent
 * identiques à l'octet. Sous-lot K2d : chaîne de raccords sans limon coudé refusée (K-Q31),
 * jarrets et onglets soudés bout à bout (K-Q2), cotes de gabarit en radians (`Part.jig`, CK17).
 */
import { dec, msg, textMessage, type Message } from "@blondel/i18n";
import type { SteelSection } from "../catalog/sections.js";
import { signedArea } from "../geom2d/polygon.js";
import type { PartJigKnee } from "../model/derived.js";
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
  /** Tronçon au-delà de l'angle maximal de tronçon (K-Q35) ; angles en radians. */
  | { readonly kind: "tooSteepSegment"; readonly alpha: number; readonly maxAngle: number }
  | { readonly kind: "lostSupport"; readonly treads: readonly number[] }
  | { readonly kind: "heavier"; readonly bent: Mm; readonly chord: Mm };

/** Décision pour une face et une section. */
export interface CrankedFacePlan {
  readonly faceId: string;
  /** `nosing` : limon coudé retenu ; `chord` : barre droite (repli, ou face à une seule pente). */
  readonly mode: "chord" | "nosing";
  /** Ligne d'appui coudée retenue (mode `nosing`). */
  readonly bearing?: FaceBearing;
  /**
   * Besoin de hauteur d'âme retenu pour la section (celui du mode choisi). Comme `chordNeed` et
   * `bentNeed`, calculé sans les cornières facultatives du coin du mur (K-Q4, K2e).
   */
  readonly need: Mm;
  readonly chordNeed: Mm;
  /** Besoin du limon coudé, quand il a été évalué. */
  readonly bentNeed?: Mm;
  /** Raison du repli ; absente : limon coudé, ou face à une seule pente (CK7). */
  readonly fallback?: CrankedFallbackReason;
  /**
   * Repli `heavier` annulé par la décision K-Q27 (sous-lot K2f2) : face d'une chaîne de raccords
   * de palier gardée coudée (`mode` = `nosing`, `need` = besoin coudé), section à vérifier.
   */
  readonly landingForced?: Extract<CrankedFallbackReason, { kind: "heavier" }>;
}

/**
 * Raison du refus d'un raccord de palier (K-Q27) : raison du repli que le limon aurait pris, ou
 * besoin coudé au-delà de la section limite : la plus haute de la famille en section automatique
 * (`beyondCatalog`), la section imposée sinon (`beyondSection`, relecture K2f2).
 */
export type LandingRefusalReason =
  | CrankedFallbackReason
  | {
      readonly kind: "beyondCatalog" | "beyondSection";
      readonly bent: Mm;
      readonly section: string;
      readonly h: Mm;
    };

/**
 * Section limite d'un limon de chaîne de palier gardé coudé (K-Q27) : plus haute section de la
 * famille en section automatique, section imposée sinon (`imposed`).
 */
export interface LandingHeightLimit {
  readonly h: Mm;
  readonly section: string;
  readonly imposed?: boolean;
}

/** Limon d'une chaîne de raccords de palier qui ne peut pas être coudé (K-Q27, K-Q31). */
export interface LandingRefusal {
  /** Chaîne de raccords de palier (ids du bas vers le haut). */
  readonly chain: readonly string[];
  readonly faceId: string;
  readonly reason: LandingRefusalReason;
  /**
   * Chaîne sans aucun limon coudé avant la décision (tous repliés en barre droite, K-Q31) :
   * message propre (aucun limon n'est coudé). Absent : la chaîne comptait un limon coudé (K-Q27).
   */
  readonly straight?: true;
}

/** Décision K-Q27 pour une section : chaînes, faces forcées coudées, refus. */
export interface CrankedLandingPlan {
  readonly chains: readonly (readonly string[])[];
  /**
   * Ids des faces dont le repli `heavier` a été annulé (gardées coudées). Leur besoin coudé
   * dépasse la section du plan (un repli `heavier` ne loge pas dans la section) : section
   * automatique seulement, section alors écartée par le choix ; jamais dans la section retenue.
   */
  readonly forced: readonly string[];
  /** Refus (non vides : palier droit non pris en charge pour cette cage, F17 (3)). */
  readonly refusals: readonly LandingRefusal[];
}

export interface CrankedSectionPlan {
  readonly faces: ReadonlyMap<string, CrankedFacePlan>;
  readonly result: BearingResult;
  /** Cornières au coin du mur (K-Q4, K2e) ; groupes vides : toutes exigées (K2b). */
  readonly corner: CrankedCornerPlan;
  /** Raccords de palier (K-Q27, sous-lot K2f2) ; sans chaîne : rien de forcé, aucun refus. */
  readonly landing: CrankedLandingPlan;
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
  // Dernier (K-Q35, sous-lot K2h) : les raisons de repli antérieures ne changent pas.
  "tooSteepSegment",
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
 *    `noseAboveRive`, `steepSegment`, `tooSteepSegment`, dans cet ordre) → repli (le dernier :
 *    tronçon au-delà de l'angle maximal de tronçon, K-Q35, comme un tronçon trop court) ;
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
      case "tooSteepSegment":
        return {
          mode: "chord",
          fallback: { kind: "tooSteepSegment", alpha: i.alpha, maxAngle: i.maxAngle },
        };
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

// ------------------------------------------------------------------------------ raccords de palier (K-Q27)

/**
 * Décisions K-Q27 (sous-lot K2f2) et K-Q31 (sous-lot K2d) de l'utilisateur (QUESTIONS A41) :
 * « coudé forcé, sinon refus ». À un raccord de palier (chaîne de limons colinéaires aboutés au
 * milieu d'un palier droit, `BearingResult.landingChains`), le limon voisin d'un limon coudé
 * reste coudé : un limon coudé et une barre droite ne sont jamais aboutés ; une chaîne dont tous
 * les limons sont repliés en barre droite n'est pas gardée en barre droite non plus (K-Q31 : le
 * repli ne réintroduit pas la barre droite qui monte le long d'un palier de niveau, refus de
 * F17 (3)) :
 * - chaîne dont tous les membres sont coudés, ou sans aucun membre replié (faces à une seule
 *   pente, CK7, qui ne montent pas le long d'un palier) : inchangée ;
 * - sinon, chaque membre en barre droite (refus marqués `straight` quand la chaîne n'avait aucun
 *   membre coudé, K-Q31) :
 *   - face à une seule pente (CK7, barre droite sans repli : ligne coudée confondue avec la
 *     barre droite) : compatible avec ses voisins, inchangée ;
 *   - repli `heavier` à besoin coudé fini, ligne coudée présente et besoin au plus la hauteur de
 *     la section limite (`limit` : plus haute section de la famille en section automatique,
 *     section imposée sinon) : membre **forcé** coudé (`mode` = `nosing`, `need` = besoin coudé,
 *     repli annulé noté dans `landingForced`) ; sa section peut monter (le choix automatique
 *     écarte la section, dont il dépasse la hauteur) ;
 *   - repli `heavier` fini au-delà de la limite : refus `beyondCatalog` (section automatique) ou
 *     `beyondSection` (section imposée) ;
 *   - tout autre repli (`emptyWindow`, `cutsCross`, `shortSegment`, `noseAboveRive`,
 *     `steepSegment`, `tooSteepSegment`, `lostSupport`, `heavier` infini) ou ligne coudée
 *     absente : refus, avec la raison du repli (`emptyWindow` si elle manque).
 * Les faces hors chaîne ne sont pas touchées (un repli `heavier` hors raccord reste permis,
 * K-Q21). Une chaîne sans membre coudé dont les replis sont tous `heavier` fini sous la limite
 * est donc entièrement forcée coudée (sa section monte : en section automatique, la section
 * essayée est écartée, comme pour K-Q27) ; tout autre repli y est refusé (lecture de K-Q31,
 * sous-lot K2d). Pure, déterministe (chaînes et membres dans l'ordre reçu) ; ne lève jamais.
 */
export function forceLandingChains(
  faces: ReadonlyMap<string, CrankedFacePlan>,
  chains: readonly (readonly string[])[],
  bearingOf: (faceId: string) => FaceBearing | undefined,
  limit?: LandingHeightLimit,
): { faces: Map<string, CrankedFacePlan>; forced: string[]; refusals: LandingRefusal[] } {
  const out = new Map(faces);
  const forced: string[] = [];
  const refusals: LandingRefusal[] = [];
  for (const chain of chains) {
    const plans = chain.map((id) => faces.get(id));
    if (plans.every((fp) => fp?.mode === "nosing")) continue;
    // K-Q31 : chaîne sans limon coudé traitée comme K-Q27 dès qu'un de ses membres est replié.
    const straight = !plans.some((fp) => fp?.mode === "nosing");
    if (straight && !plans.some((fp) => fp?.fallback !== undefined)) continue;
    const mark = straight ? ({ straight: true } as const) : {};
    chain.forEach((id, i) => {
      const fp = plans[i];
      if (fp?.mode === "nosing") return;
      // Face à une seule pente (CK7) : barre droite confondue avec la ligne coudée.
      if (fp && !fp.fallback && bearingOf(id)) return;
      const fb = fp?.fallback;
      const bearing = bearingOf(id);
      if (fp && fb?.kind === "heavier" && Number.isFinite(fb.bent) && bearing) {
        if (limit && !(fb.bent <= limit.h + 1e-9)) {
          refusals.push({
            chain,
            faceId: id,
            reason: {
              kind: limit.imposed ? "beyondSection" : "beyondCatalog",
              bent: fb.bent,
              section: limit.section,
              h: limit.h,
            },
            ...mark,
          });
          return;
        }
        const { fallback: _annulled, ...rest } = fp;
        out.set(id, {
          ...rest,
          mode: "nosing",
          bearing,
          need: fp.bentNeed ?? fb.bent,
          landingForced: fb,
        });
        forced.push(id);
        return;
      }
      refusals.push({
        chain,
        faceId: id,
        reason: bearing && fb ? fb : { kind: "emptyWindow" },
        ...mark,
      });
    });
  }
  return { faces: out, forced, refusals };
}

// ------------------------------------------------------------------------------ cornière au coin du mur

/**
 * Support candidat vu par le plan : zone d'appui brute [u0 ; u1], dessus zTop, marche et face
 * porteuse (sous-ensemble structurel de `SupportPlacement`).
 */
export interface CrankedSupport extends WebSupport {
  readonly tread: number;
  readonly face: {
    readonly key: string;
    readonly owner: string;
    readonly kind: string;
    readonly side: string;
  };
}

/** Candidat d'un groupe du coin du mur : support, face porteuse (`faceId`) et clé unique. */
export type CornerCandidate = WebSupport & {
  readonly tread: number;
  readonly faceId: string;
  readonly key: string;
};

/**
 * Support candidat côté jour d'une marche au coin du mur (limon de jour ou face de poteau) :
 * sert seulement à juger si la marche est appuyée côté jour (K-Q16, sous-lot K2e2).
 */
export type CornerJourCandidate = CornerCandidate & {
  /** Support sur une face de poteau (posé dès que sa zone atteint `minLength`, sans rognage). */
  readonly onPost: boolean;
};

/** Marche au coin du mur : ses supports candidats côté mur, sur au moins deux limons. */
export interface CornerGroup {
  readonly tread: number;
  readonly candidates: readonly CornerCandidate[];
  /** Supports candidats côté jour de la marche (limons et poteaux), pour K-Q16. */
  readonly jour: readonly CornerJourCandidate[];
}

/** Tolérance de parallélisme de deux directions unitaires (sinus de l'angle, tolérance numérique). */
const CORNER_PARALLEL = 1e-9;

/** Clé d'un support (marche × face) dans les ensembles du coin. */
export const cornerSupportKey = (tread: number, faceKey: string): string => `${tread}|${faceKey}`;

/**
 * Groupes du coin du mur (K-Q4, sous-lot K2e) : marches dont les supports candidats tombent,
 * côté mur (`side` = `outer`), sur au moins deux limons différents (volées et cages ; un groupe
 * de trois faces est possible). Le côté jour n'est pas concerné (K-Q4 dit « au coin du mur ») ;
 * les faces de poteau non plus. Avec `dirOf` (direction en plan de chaque limon), deux limons
 * colinéaires (palier entre deux limons alignés, pas de coin) ne forment pas un groupe : il faut
 * deux directions non parallèles. Groupes triés par marche, candidats dans l'ordre reçu.
 *
 * `excludeTread` (K-Q18, sous-lot K2e2) : marches exclues de la règle du coin (les paliers,
 * palier d'angle compris) ; elles ne forment pas de groupe, donc toutes leurs cornières restent
 * exigées, comme en K2b. Chaque groupe porte aussi les supports candidats côté jour de sa marche
 * (`jour`, limons de jour et faces de poteau, `side` = `inner`), lus par `crankedSectionPlan`
 * pour K-Q16 ; ils ne sont jamais rendus facultatifs (K-Q17 : coin du mur seulement).
 */
export function cornerSupportGroups(
  cands: readonly CrankedSupport[],
  dirOf?: (faceId: string) => Vec2 | undefined,
  excludeTread?: (tread: number) => boolean,
): CornerGroup[] {
  const byTread = new Map<number, CornerCandidate[]>();
  const jourOf = new Map<number, CornerJourCandidate[]>();
  for (const c of cands) {
    if (excludeTread?.(c.tread)) continue;
    if (c.face.side === "inner" && (c.face.kind === "stringer" || c.face.kind === "post")) {
      const list = jourOf.get(c.tread) ?? [];
      list.push({
        u0: c.u0,
        u1: c.u1,
        zTop: c.zTop,
        tread: c.tread,
        faceId: c.face.owner,
        key: cornerSupportKey(c.tread, c.face.key),
        onPost: c.face.kind === "post",
      });
      jourOf.set(c.tread, list);
      continue;
    }
    if (c.face.kind !== "stringer" || c.face.side !== "outer") continue;
    const list = byTread.get(c.tread) ?? [];
    list.push({
      u0: c.u0,
      u1: c.u1,
      zTop: c.zTop,
      tread: c.tread,
      faceId: c.face.owner,
      key: cornerSupportKey(c.tread, c.face.key),
    });
    byTread.set(c.tread, list);
  }
  return [...byTread.entries()]
    .filter(([, list]) => {
      const ids = [...new Set(list.map((c) => c.faceId))];
      if (ids.length < 2) return false;
      if (!dirOf) return true;
      const dirs = ids.map(dirOf);
      return dirs.some((d, i) =>
        dirs.slice(i + 1).some((e) => !d || !e || Math.abs(V.cross(d, e)) > CORNER_PARALLEL),
      );
    })
    .sort((a, b) => a[0] - b[0])
    .map(([tread, candidates]) => ({ tread, candidates, jour: jourOf.get(tread) ?? [] }));
}

/** Tolérance des départages de la cornière exigée (mm, précision de la dichotomie du besoin). */
const CORNER_TIE = 1e-6;

/**
 * Cornière exigée de chaque groupe du coin (K-Q4) : celle de plus petit `score` (besoin d'âme
 * pour la loger, `Infinity` si elle n'est pas logeable) ; départages, à 1e-6 mm près : plus
 * longue zone d'appui brute (u1 − u0), puis plus petit rang de face (ordre des limons), puis
 * plus petite clé. Chaque critère filtre un ensemble (minimum, puis filtre) : le résultat ne
 * dépend pas de l'ordre des groupes ni des candidats. Rend les clés exigées.
 */
export function chooseCornerRequired(
  groups: readonly CornerGroup[],
  score: (c: CornerCandidate) => number,
  faceRank: (faceId: string) => number,
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const g of groups) {
    if (g.candidates.length === 0) continue;
    const scored = g.candidates.map((c) => ({ c, s: score(c) }));
    const sMin = Math.min(...scored.map((x) => x.s));
    let pool = scored.filter((x) => x.s === sMin || x.s <= sMin + CORNER_TIE);
    const lMax = Math.max(...pool.map((x) => x.c.u1 - x.c.u0));
    pool = pool.filter((x) => x.c.u1 - x.c.u0 >= lMax - CORNER_TIE);
    const rMin = Math.min(...pool.map((x) => faceRank(x.c.faceId)));
    pool = pool.filter((x) => faceRank(x.c.faceId) === rMin);
    pool.sort((a, b) => (a.c.key < b.c.key ? -1 : a.c.key > b.c.key ? 1 : 0));
    out.add(pool[0]!.c.key);
  }
  return out;
}

/** Cornières du coin pour une section : groupes, exigées, facultatives, groupes basculés. */
export interface CrankedCornerPlan {
  readonly groups: readonly CornerGroup[];
  /** Clés exigées (une par groupe ; toutes celles d'un groupe revenu à « tout exigé »). */
  readonly required: ReadonlySet<string>;
  /** Clés facultatives : hors du besoin d'âme, posées seulement si elles tiennent. */
  readonly optional: ReadonlySet<string>;
  /** Nombre de groupes revenus à « tout exigé » par le garde-fou (comportement de K2b). */
  readonly reverted: number;
  /**
   * Marches des groupes **sans appui côté jour** dans la section (K-Q16, K2e2) : toutes leurs
   * cornières murales exigées, aucune facultative.
   */
  readonly jourless: ReadonlySet<number>;
}

export interface CrankedPlanInput<P extends CrankedPre, S extends CrankedSupport> {
  readonly pres: readonly P[];
  readonly bearingFaces: readonly BearingFace[];
  readonly pitch: BearingInput["pitch"];
  readonly upperOffset: Mm;
  readonly knee: KneeSettings;
  readonly section: SteelSection;
  readonly webFit: WebFitParams;
  /** Supports candidats de la face (avant rognage), avec leur marche et leur face. */
  readonly supportsOf: (p: P) => readonly S[];
  /** Besoin de la barre droite pour un support et la section (forme fermée du plugin). */
  readonly chordNeedOfSupport: (p: P, c: S) => Mm;
  /** La barre droite ne peut pas porter ce support, quelle que soit la hauteur. */
  readonly chordLostOfSupport: (p: P, c: S) => boolean;
  /** Groupes du coin du mur (K-Q4) ; absent ou vide : plan de K2b (toutes les cornières exigées). */
  readonly cornerGroups?: readonly CornerGroup[];
  /**
   * Section limite (K-Q27) : plus haute section de la famille en section automatique, section
   * imposée sinon ; un membre de chaîne de palier dont le besoin coudé la dépasse est refusé
   * (`beyondCatalog`, `beyondSection`). Absente : aucune limite (tests du noyau seulement).
   */
  readonly forcedHeightLimit?: LandingHeightLimit;
}

/** Valeurs d'un support pour une section, calculées une seule fois par plan. */
interface SupportEntry {
  readonly key: string;
  readonly tread: number;
  readonly raw: Mm;
  readonly chordNeed: Mm;
  readonly chordLost: boolean;
  readonly bentNeed?: Mm;
  readonly bentLost?: boolean;
}

/**
 * Plan d'une section : lignes d'appui coudées de toutes les faces (`profileBearings`, qui
 * dépendent de h, b et shift), besoin du limon coudé par face (`faceHeightNeed`), décision par
 * face (`decideCrankedFace`). Ne lève jamais (le noyau non plus).
 *
 * **Cornière au coin du mur** (K-Q4, sous-lot K2e ; `cornerGroups` non vide, `nosing` seulement),
 * en un nombre fini de passes :
 * 1. décision provisoire de chaque face sans aucune cornière des groupes du coin ;
 * 2. cornière exigée par groupe (`chooseCornerRequired`) : celle qui demande le moins d'âme sur
 *    la ligne d'appui du mode provisoire de sa face (`Infinity` si sa zone brute ou sa partie
 *    logée à hauteur infinie est sous `minLength` : sans cela, une cornière perdue, de besoin
 *    nul, serait choisie), puis plus longue zone brute, puis rang de face ;
 * 2 bis. marche sans appui côté jour (K-Q16, sous-lot K2e2) : un groupe dont aucun support
 *    candidat côté jour n'est logeable dans la section (poteau : zone ≥ `minLength`, règle de pose
 *    des supports sur poteau ; limon de jour : besoin d'âme ≤ h dans le mode provisoire de sa face,
 *    même critère que le garde-fou ; face absente ou support perdu : non logeable) garde toutes
 *    ses cornières murales, toutes exigées dans le besoin d'âme (la section peut monter) ; il
 *    n'entre ni dans le choix de l'exigée ni dans le garde-fou. Le mode d'une face de jour ne
 *    dépend d'aucune cornière du coin (toutes côté mur) : le jugement de la passe provisoire vaut
 *    pour toutes les passes ;
 * 3. décision finale avec les cornières hors coin et les exigées ; les facultatives ne comptent
 *    ni dans le besoin de leur face, ni dans ses marches perdues, ni dans le besoin de la barre
 *    droite du repli (K-Q12, K-Q14) ;
 * 4. garde-fou : un groupe dont l'exigée n'est pas logeable dans la section, dans le mode final
 *    de sa face (besoin supérieur à h, ou perdue : face basculée en barre droite, section imposée
 *    ou trop basse), redevient « tout exigé », comme en K2b, et les faces sont redécidées ; une
 *    section faisable (besoin de chaque face ≤ h) n'en bascule aucun ; dans une section
 *    insuffisante (une face au-delà de h), tous les groupes basculent (ceux sans appui côté jour
 *    sont déjà « tout exigé ») : plan de K2b ; l'ensemble des groupes basculés ne fait que
 *    croître, donc au plus (nombre de groupes + 3) passes, sans itération instable.
 * `need`, `chordNeed` et `bentNeed` de chaque face sont ceux de la liste retenue (sans les
 * facultatives). Sans groupe, le plan est exactement celui de K2b.
 *
 * **Raccords de palier** (K-Q27, sous-lot K2f2) : à chaque passe (provisoire, choix, garde-fou,
 * section insuffisante), la décision par face est suivie de `forceLandingChains` sur les chaînes
 * du noyau ; la décision reste une fonction pure de (section, ensemble actif), donc les passes
 * finissent comme avant. `landing` est lu sur la dernière passe ; sans chaîne, le plan est
 * identique à celui de K2f.
 */
export function crankedSectionPlan<P extends CrankedPre, S extends CrankedSupport>(
  input: CrankedPlanInput<P, S>,
): CrankedSectionPlan {
  const result = profileBearings({
    faces: input.bearingFaces,
    pitch: input.pitch,
    upperOffset: input.upperOffset,
    section: bearingSectionOf(input.section),
    settings: input.knee,
  });
  const byId = new Map(result.faces.map((f) => [f.faceId, f]));
  const minLen = input.webFit.minLength;
  // Valeurs par support, une fois par section : chaque passe ne fait ensuite que des max.
  const ctxs = input.pres.map((p, rank) => {
    const id = p.face.id;
    const fb = byId.get(id);
    const issues = result.issues.filter((i) => "faceId" in i && i.faceId === id);
    const bentEvaluated = fb !== undefined && !isChordEquivalent(fb, p.line);
    const entries: SupportEntry[] = input.supportsOf(p).map((c) => {
      const bent = bentEvaluated ? faceHeightNeed(fb, [c], input.webFit) : undefined;
      return {
        key: cornerSupportKey(c.tread, c.face.key),
        tread: c.tread,
        raw: c.u1 - c.u0,
        chordNeed: input.chordNeedOfSupport(p, c),
        chordLost: input.chordLostOfSupport(p, c),
        ...(bent ? { bentNeed: bent.need, bentLost: bent.lost.length > 0 } : {}),
      };
    });
    return { p, id, rank, fb, issues, bentEvaluated, entries };
  });
  type FaceCtx = (typeof ctxs)[number];
  /** Décision d'une face sur ses supports actifs (même ordre de priorité qu'en K2b). */
  const decideFor = (f: FaceCtx, active: (key: string) => boolean): CrankedFacePlan => {
    const list = f.entries.filter((e) => active(e.key));
    const chordNeed = Math.max(0, ...list.map((e) => e.chordNeed));
    const bentNeed = f.bentEvaluated ? Math.max(0, ...list.map((e) => e.bentNeed!)) : undefined;
    const decision = decideCrankedFace({
      fb: f.fb,
      issues: f.issues,
      line: f.p.line,
      bentNeed: bentNeed ?? chordNeed,
      bentLost: f.bentEvaluated ? list.filter((e) => e.bentLost).map((e) => e.tread) : [],
      chordNeed,
      chordLost: f.bentEvaluated ? list.filter((e) => e.chordLost).map((e) => e.tread) : [],
      sectionHeight: input.section.h,
    });
    const nosing = decision.mode === "nosing" && f.fb !== undefined;
    return {
      faceId: f.id,
      mode: nosing ? "nosing" : "chord",
      ...(nosing ? { bearing: f.fb } : {}),
      need: nosing ? bentNeed! : chordNeed,
      chordNeed,
      ...(bentNeed !== undefined ? { bentNeed } : {}),
      ...(decision.fallback ? { fallback: decision.fallback } : {}),
    };
  };
  const chains = result.landingChains;
  let landing: CrankedLandingPlan = { chains, forced: [], refusals: [] };
  const decideAll = (active: (key: string) => boolean): Map<string, CrankedFacePlan> => {
    const raw = new Map(ctxs.map((f) => [f.id, decideFor(f, active)]));
    if (chains.length === 0) return raw;
    // K-Q27 : coudé forcé aux raccords de palier, sinon refus (lu sur la dernière passe).
    const kq27 = forceLandingChains(raw, chains, (id) => byId.get(id), input.forcedHeightLimit);
    landing = { chains, forced: kq27.forced, refusals: kq27.refusals };
    return kq27.faces;
  };

  const groups = input.cornerGroups ?? [];
  if (groups.length === 0) {
    const faces = decideAll(() => true);
    return {
      faces,
      result,
      landing,
      corner: {
        groups,
        required: new Set(),
        optional: new Set(),
        reverted: 0,
        jourless: new Set(),
      },
    };
  }
  const cornerKeys = new Set(groups.flatMap((g) => g.candidates.map((c) => c.key)));
  const ctxById = new Map(ctxs.map((f) => [f.id, f]));
  const faceRank = (id: string): number => ctxById.get(id)?.rank ?? Infinity;
  const entryOf = (c: CornerCandidate): SupportEntry | undefined =>
    ctxById.get(c.faceId)?.entries.find((e) => e.key === c.key);
  /** Besoin d'âme du support dans le mode de sa face ; `Infinity` s'il n'y est pas logeable. */
  const needIn = (plan: CrankedFacePlan | undefined, e: SupportEntry | undefined): number => {
    if (!plan || !e || e.raw < minLen - 1e-9) return Infinity;
    if (plan.mode === "nosing") return e.bentLost ? Infinity : (e.bentNeed ?? Infinity);
    return e.chordLost ? Infinity : e.chordNeed;
  };
  // Passe 1 : modes provisoires sans aucune cornière du coin ; passe 2 : exigée par groupe.
  const provisional = decideAll((key) => !cornerKeys.has(key));
  // K-Q16 : appui côté jour logeable dans la section (jugé sur les modes provisoires).
  const jourBears = (j: CornerJourCandidate): boolean =>
    j.onPost
      ? j.u1 - j.u0 >= minLen - 1e-9
      : needIn(provisional.get(j.faceId), entryOf(j)) <= input.section.h + 1e-9;
  const jourlessIdx = new Set(groups.flatMap((g, gi) => (g.jour.some(jourBears) ? [] : [gi])));
  const chosen = chooseCornerRequired(
    groups.filter((_, gi) => !jourlessIdx.has(gi)),
    (c) => needIn(provisional.get(c.faceId), entryOf(c)),
    faceRank,
  );
  // Passes suivantes : décision finale, puis garde-fou des groupes dont l'exigée est perdue.
  const reverted = new Set<number>();
  const requiredNow = (): Set<string> => {
    const out = new Set(chosen);
    for (const gi of jourlessIdx) for (const c of groups[gi]!.candidates) out.add(c.key);
    for (const gi of reverted) for (const c of groups[gi]!.candidates) out.add(c.key);
    return out;
  };
  let required = requiredNow();
  let faces = decideAll((key) => !cornerKeys.has(key) || required.has(key));
  for (;;) {
    let changed = false;
    groups.forEach((g, gi) => {
      if (reverted.has(gi) || jourlessIdx.has(gi)) return;
      const req = g.candidates.find((c) => chosen.has(c.key));
      // Exigée logeable dans la section elle-même (et pas seulement à hauteur infinie) : une
      // section imposée ou trop basse ne doit pas retirer l'appui mural que K2b gardait.
      if (req && needIn(faces.get(req.faceId), entryOf(req)) <= input.section.h + 1e-9) return;
      reverted.add(gi);
      changed = true;
    });
    if (!changed) break;
    required = requiredNow();
    faces = decideAll((key) => !cornerKeys.has(key) || required.has(key));
  }
  // Section insuffisante (une face demande plus que h : section imposée, ou aucune section
  // faisable) : plan de K2b pour tous les groupes. Retirer une facultative y changerait le mode
  // d'une face (barre droite → coudé) et ferait perdre des marches hors du coin.
  if ([...faces.values()].some((f) => f.need > input.section.h + 1e-9)) {
    groups.forEach((_, gi) => {
      if (!jourlessIdx.has(gi)) reverted.add(gi);
    });
    required = requiredNow();
    faces = decideAll(() => true);
  }
  const optional = new Set([...cornerKeys].filter((k) => !required.has(k)));
  const jourless = new Set([...jourlessIdx].map((gi) => groups[gi]!.tread));
  return {
    faces,
    result,
    landing,
    corner: { groups, required, optional, reverted: reverted.size, jourless },
  };
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

/**
 * Cote de gabarit d'un jarret (CK17) : `PartJigKnee` du modèle (abscisse et cote de la rive haute
 * en mm, pentes avant et après en radians, ADR-0003 ; publiée sur la pièce finie, sous-lot K2d).
 */
export type CrankedJigItem = PartJigKnee;

/**
 * Cotes de gabarit (CK17, préfabrication au marbre) : pour chaque jarret, abscisse du sommet de
 * rive haute depuis l'extrémité basse (`uOrigin`, plus petit u du contour), cote de rive haute,
 * pentes du tronçon avant et après (radians).
 */
export function crankedJigItems(fb: FaceBearing, uOrigin: Mm): CrankedJigItem[] {
  return fb.knees.map((k, j) => ({
    index: j + 1,
    x: k.upper.x - uOrigin,
    z: k.upper.y,
    before: fb.segments[j]!.alpha,
    after: fb.segments[j + 1]!.alpha,
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

/**
 * Partenaire d'onglet de `b` : limon du même côté qui finit au coin où `b` commence (σ continu à
 * 1e-6, même appariement que `crankedMiterItems`) ; `undefined` si `b` ne commence pas à un coin.
 * Sert à dire si l'onglet d'un coin est celui d'un limon coudé (K-Q2, sous-lot K2d).
 */
export function cornerPartnerOf<F extends { readonly face: SteelStringerFace }>(
  items: readonly F[],
  b: F,
): F | undefined {
  if (b.face.start !== "corner") return undefined;
  return items.find(
    (x) =>
      x !== b &&
      x.face.side === b.face.side &&
      x.face.end === "corner" &&
      Math.abs(x.face.sigmaA + x.face.faceLength - b.face.sigmaA) < 1e-6,
  );
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
    case "tooSteepSegment":
      return msg("structure.steelProfile.crankedFallback.tooSteepSegment", {
        angle: dec((reason.alpha * 180) / Math.PI, 1),
        max: dec((reason.maxAngle * 180) / Math.PI, 1),
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

/** Raison du refus d'un raccord de palier (K-Q27), traduite à l'affichage. */
export function landingRefusalReasonMessage(reason: LandingRefusalReason): Message {
  switch (reason.kind) {
    case "beyondCatalog":
      return msg("structure.steelProfile.landingRefusal.beyondCatalog", {
        bent: dec(reason.bent, 1),
        section: reason.section,
        h: dec(reason.h, 0),
      });
    case "beyondSection":
      return msg("structure.steelProfile.landingRefusal.beyondSection", {
        bent: dec(reason.bent, 1),
        section: reason.section,
        h: dec(reason.h, 0),
      });
    default:
      return crankedFallbackReasonMessage(reason);
  }
}

/** Libellé d'un raccord de palier : repères de la chaîne, du bas vers le haut (« LI2 / LI3 »). */
export function spliceLabel(chain: readonly string[], markOf: (faceId: string) => string): Message {
  const marks = chain.map((id) => textMessage(markOf(id)));
  return marks
    .slice(1)
    .reduce<Message>(
      (first, second) => msg("structure.common.housingPair", { first, second }),
      marks[0] ?? textMessage(""),
    );
}

/**
 * Erreur du refus d'un raccord de palier (K-Q27, K-Q31) : palier droit non pris en charge pour
 * cette cage (F17 (3)), raccord, limon qui ne peut pas être coudé et cause chiffrée ; chaîne
 * sans aucun limon coudé (K-Q31) : message propre.
 */
export function landingRefusalMessage(
  r: LandingRefusal,
  markOf: (faceId: string) => string,
): Message {
  const params = {
    splice: spliceLabel(r.chain, markOf),
    mark: markOf(r.faceId),
    reason: landingRefusalReasonMessage(r.reason),
  };
  return r.straight
    ? msg("structure.steelProfile.error.landingChainStraight", params)
    : msg("structure.steelProfile.error.landingSpliceRefused", params);
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

/**
 * Remarques des plats de palier que la ligne d'appui d'une face coudée ne suit pas de niveau
 * (constat `landingNotLevel` du noyau, sous-lot K2f) : une par plat, plus grand écart arrondi au
 * mm. Palier trop court entre les parties de niveau de ses coins, ou jarret retiré pour tronçon
 * court : la rive n'est pas de niveau sur le palier, à vérifier (aucun repli : la barre droite
 * ne l'est pas davantage).
 */
export function landingNotLevelNotes(
  mark: string,
  faceId: string,
  issues: readonly BearingIssue[],
): Message[] {
  return issues.flatMap((i) =>
    i.kind === "landingNotLevel" && i.faceId === faceId
      ? [
          msg("structure.steelProfile.note.landingNotLevel", {
            mark,
            excess: dec(i.excess, 0),
            from: dec(i.u0, 0),
            to: dec(i.u1, 0),
          }),
        ]
      : [],
  );
}

/** Remarque des cotes de gabarit d'un limon coudé (CK17) ; `null` sans jarret. */
export function crankedJigNote(mark: string, items: readonly CrankedJigItem[]): Message | null {
  const deg = (a: number): number => (a * 180) / Math.PI;
  const knees = joinMessages(
    items.map((it) =>
      msg("structure.steelProfile.note.jigKnee", {
        index: it.index,
        x: dec(it.x, 0),
        z: dec(it.z, 0),
        before: dec(deg(it.before), 1),
        after: dec(deg(it.after), 1),
      }),
    ),
  );
  return knees ? msg("structure.steelProfile.note.jigDimensions", { mark, knees }) : null;
}

/**
 * Remarque d'une marche au coin du mur dont la cornière facultative ne tient pas dans la section
 * retenue (K-Q4, K2e) : faces retirées, faces qui gardent la marche côté mur et longueur minimale
 * d'appui (`supports.minLength`, règle existante de FAB_SUPPORT_LONGUEUR_MIN). La partie logée
 * n'est pas citée : elle est le plus souvent nulle (zone entière hors de l'âme utile), ou c'est la
 * zone brute elle-même qui est trop courte. Clé plurielle par nombre de faces retirées.
 */
export function cornerAngleRemovedNote(
  treadMark: string,
  removed: readonly string[],
  kept: readonly string[],
  min: Mm,
): Message {
  return msg("structure.steelProfile.note.cornerAngleRemoved", {
    mark: treadMark,
    count: removed.length,
    removed: joinMessages(removed.map((m) => textMessage(m))) ?? "",
    kept: joinMessages(kept.map((m) => textMessage(m))) ?? "",
    min: dec(min, 0),
  });
}
