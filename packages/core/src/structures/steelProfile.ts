/**
 * Plugin `steel-profile` : limons en profilés du commerce UPN / IPN / IPE / HEA (C §2.3),
 * jalon 3c.
 *
 * - **Limons** : un limon de jour et un limon mural par volée (mêmes faces que `steel-flat` :
 *   faces côté marches = bords de l'emmarchement utile, limons hors emprise utile), **âme
 *   verticale**, barre droite. Ligne d'appui [choix Blondel, à valider] : corde de la ligne des
 *   nez de la face (du premier au dernier nez de la portée du limon) ; rive haute à d_h au-dessus
 *   (vertical), hauteur verticale h / cos α. UPN : âme côté marches, ailes vers l'extérieur
 *   (C §2.3 : « le U laisse voir ses ailes ») ; IPN / IPE / HEA : bouts d'ailes côté marches,
 *   supports soudés sur l'âme entre les ailes.
 * - **Choix de section** : une section du catalogue (`catalog/`) ou `auto` = la plus légère de
 *   la famille qui (1) loge les supports dans la hauteur d'âme et (2) passe le
 *   **prédimensionnement indicatif** (`precheck/` : L/200, contrainte, f₁ ≥ 5 Hz) pour tous les
 *   limons.
 * - **Coupes d'extrémité** : départ au sol = coupe de niveau (sol) + coupe d'aplomb ; poteau =
 *   coupe d'aplomb contre sa face ; arrivée = coupe d'aplomb au nez d'arrivée (+ prolongement) ;
 *   angle mural = **coupe d'onglet à 45° en plan**, soudée (le limon qui part de l'angle porte
 *   le cordon).
 * - **Tournants** : poteau → tube carré soudé, **poteau élargi des profilés** (décision A13 :
 *   côté = aile + 2 × jeu, décalé vers le jour, `profileNewel` ; posé par
 *   `applyStructureChoice`, sinon signalé) qui reçoit chaque limon de jour en barre droite,
 *   coupe d'aplomb contre sa face ; angle vif → erreur explicite ; **jour en arc**
 *   → contrôle des rayons de cintrage minimaux par sens (C-M-06 / C-M-07, profil d'atelier :
 *   UPN aile intérieure 650, aile extérieure 500, chant 200 ; IPE / IPN à plat 650, chant 1 400)
 *   → un limon de jour à petit rayon est **exclu** (bloquant) ; au-delà, le cintrage
 *   hélicoïdal reste à valider chez le cintreur et le limon cintré n'est pas généré (jalon 5).
 * - **Supports** : cornières (C §2.3 [58]) sous chaque marche, soudées ou vissées.
 * - **Développé** : vue de l'âme dépliée (face côté marches), repère de la barre (x le long de
 *   l'axe, y perpendiculaire de 0 à h) : coupes d'extrémité, perçages, traçage des supports.
 * - **Débit** : calepinage 1D sur barres de 6 / 12 m (`steelProfileCutting.ts`).
 *
 * Valeurs par défaut non sourcées : paramètres **à valider** (LEDGER §2).
 */
import { dec, DEFAULT_LOCALE, msg, textMessage, translatorFor, type Message } from "@blondel/i18n";
import { z } from "zod";
import { signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import {
  SECTION_FAMILIES,
  findSection,
  sectionOutline,
  sectionPerimeter,
  sectionsOf,
  type SteelSection,
} from "../catalog/sections.js";
import type { FlatPattern, NosingLine, Part, RuleResult, Tread } from "../model/derived.js";
import type { Mm, Polygon2, Vec2 } from "../model/primitives.js";
import type { StructureContext, StructureKind, StructureOutput } from "../model/plugins.js";
import { buildBasicParts } from "../parts/basic.js";
import { analyzeInclinedBeam, passesPrecheck, type InclinedBeamResult } from "../precheck/beam.js";
import { precheckResults, type PrecheckedBeam } from "../precheck/checks.js";
import { stairLoads } from "../precheck/loads.js";
import { PrecheckSettingsSchema, steelMaterialOf } from "../precheck/settings.js";
import { activeContexts, permanentAreaLoad } from "../precheck/stringers.js";
import { WORKSHOP_DEFAULT_SOURCE, sourceSpec } from "../rules/sources.js";
import type { Finding } from "../rules/types.js";
import { STEEL_GRADES, minProfileBendRadius, type SteelGrade } from "../workshop/metal.js";
import { resolveWorkshopProfile, type WorkshopProfile } from "../workshop/profile.js";
import {
  CheckCollector,
  FAB_RULES,
  flightsOnlyError,
  pluginRuleDef,
  type PluginRuleSpec,
} from "./checks.js";
import { clipHalfPlane, dedupe } from "./geom.js";
import { readPlanExtrusion } from "./housing.js";
import { newelFaces, stairGeometry, type NewelGeometry } from "./legs.js";
import { newelTopWithHandrail } from "./newel.js";
import {
  STEEL_RULES,
  deduceExecutionClass,
  executionClassReasons,
  joinMessages,
  QUANTITY_WELD_MM,
  holePolygon,
  steelMaterial,
  steelQuantities,
} from "./steelCommon.js";
import { ascentDirection, steelStringerFaces, supportOn, treadNotCarried } from "./steelFlat.js";
import { cuttingPlan, type CutPiece, type CuttingPlan } from "./steelProfileCutting.js";
import {
  boltCenters,
  effectiveFixing,
  supportAssemblies,
  supportDepth,
  supportInterval,
  supportPart,
  type SupportFace,
  type SupportPlacement,
  type SupportSpec,
} from "./supports.js";
import type { StringerFace } from "./woodHoused.js";

/** Élément d'un contrôle par élément (`CheckCollector.addItems`). */
interface CheckItem {
  readonly value: Mm;
  readonly label: Message;
  readonly partId?: string;
  readonly treadNumber?: number;
}

/** Élément rattaché à une pièce. */
interface PartCheckItem extends CheckItem {
  readonly partId: string;
}

/** Largeur de profilé reçue par un poteau d'angle (contrôle `FAB_POTEAU_RECEPTION`). */
interface ReceivedCheck extends PartCheckItem {
  /** Repère du poteau récepteur. */
  readonly newelMark: string;
}

const mmInt = z.number().int();
const mmPos = mmInt.positive();
const mmNonNeg = mmInt.nonnegative();

/** Motif du refus d'une section hors catalogue (paramètre `section`). */
const UNKNOWN_SECTION: Message = msg("structure.steelProfile.issue.unknownSection");

export const SteelProfileParamsSchema = z.object({
  grade: z.enum(STEEL_GRADES).default("S235"),
  finish: z.enum(["raw", "painted", "galvanized"]).default("painted"),
  /** Famille de profilé (C §2.3 : UPN, IPN, IPE, HEA). */
  family: z.enum(SECTION_FAMILIES).default("UPN"),
  /** Section du catalogue (ex. `UPN 160`), ou `auto` (plus légère qui passe). */
  section: z
    .union([
      z.literal("auto"),
      // Texte français pour zod, `Message` dans `params` (lu par `zodIssueMessage`, ADR-0007).
      z.string().refine((s) => findSection(s) !== undefined, {
        message: translatorFor(DEFAULT_LOCALE).t(UNKNOWN_SECTION),
        params: { message: UNKNOWN_SECTION },
      }),
    ])
    .default("auto"),
  /** Dépassement vertical de la rive haute au-dessus de la ligne des nez, d_h (à valider). */
  upperOffset: mmNonNeg.default(50),
  /** Longueur du limon en avant du nez de départ (à valider). */
  startExtension: mmNonNeg.default(50),
  /** Longueur du limon au-delà du nez d'arrivée (à valider). */
  endExtension: mmNonNeg.default(0),
  /**
   * Écart toléré entre les rives hautes des deux limons au droit d'un onglet d'angle mural
   * (`FAB_ONGLET_RACCORD`), mm (à valider : ISO 13920 non appliquée).
   */
  miterTolerance: mmNonNeg.default(1),
  /** Aboutage d'un limon plus long que la plus grande barre : soudé bout à bout (EXC2) ou éclissé. */
  splice: z.enum(["welded", "bolted"]).default("welded"),
  newel: z
    .object({
      /**
       * Côté du poteau pour profilés (décision A13) : `auto` = largeur d'aile de la section
       * retenue + 2 × `clearance` ; ou valeur imposée (mm). Le poteau est **décalé vers le jour**
       * pour ne déborder que de `clearance` côté marches (`profileNewel`). Le poteau du tracé
       * (`stair.layout.turns[].inner`) est posé à ces cotes au choix de la structure
       * (`applyStructureChoice`) ou par la correction proposée ; le plugin le signale s'il
       * diffère. Valeur par défaut **à valider** (aucune source).
       */
      size: z.union([z.literal("auto"), mmPos]).default("auto"),
      /**
       * Jeu entre l'aile du profilé reçu et le bord de la face du poteau, de chaque côté
       * (à valider : aucune source ; 20 mm, décision A13 de l'utilisateur).
       */
      clearance: mmPos.default(20),
      /** Épaisseur de paroi du tube carré a × a (à valider). */
      tubeThickness: mmPos.default(4),
      /**
       * Dépassement au-dessus du plus haut élément reçu (à valider). Le poteau monte aussi
       * au-dessus de la main courante d'un garde-corps qui le rejoint (`guards.posts.newelOverrun`).
       */
      topExtension: mmNonNeg.default(0),
    })
    .prefault({}),
  supports: z
    .object({
      fixing: z.enum(["welded", "bolted"]).default("welded"),
      /** Cornière à ailes égales (C §2.3 [58] : cornières ; dimensions à valider). */
      angleLeg: mmPos.default(40),
      angleThickness: mmPos.default(4),
      bolts: mmNonNeg.default(2),
      holeDiameter: mmPos.default(11),
      slotLength: mmNonNeg.default(0),
      holeEdgeDistance: mmPos.default(20),
      treadScrews: mmNonNeg.default(2),
      endMargin: mmNonNeg.default(10),
      edgeMargin: mmNonNeg.default(10),
      minLength: mmPos.default(50),
      /** Profilés en I : appui mini de la cornière au-delà des bouts d'ailes (à valider). */
      minBearing: mmNonNeg.default(20),
    })
    .prefault({}),
  /** Réglages du prédimensionnement indicatif (`precheck/settings.ts`). */
  precheck: PrecheckSettingsSchema.prefault({}),
});
export type SteelProfileParams = z.output<typeof SteelProfileParamsSchema>;

type Side = "inner" | "outer";

export const PROFILE_RULES = {
  bending: {
    id: "FAB_CINTRAGE_PROFILE",
    ...sourceSpec(msg("compliance.source.profileBending")),
    confidence: "moyen",
    nature: "metier",
    severity: "bloquant",
    unit: "mm",
  },
  sectionHeight: {
    id: "FAB_PROFILE_HAUTEUR",
    ...sourceSpec(msg("compliance.source.profileHeight")),
    confidence: "faible",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
  supportBearing: {
    id: "FAB_SUPPORT_DEBORD",
    ...sourceSpec(WORKSHOP_DEFAULT_SOURCE),
    confidence: "faible",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
  miter: {
    id: "FAB_ONGLET_RACCORD",
    ...sourceSpec(msg("compliance.source.profileMiter")),
    confidence: "faible",
    nature: "metier",
    severity: "conseil",
    unit: "mm",
  },
  lateralWidth: {
    id: "FAB_PROFILE_AILE_HORS_EMPRISE",
    ...sourceSpec(msg("compliance.source.profileFlange")),
    confidence: "eleve",
    nature: "metier",
    severity: "conseil",
    unit: "mm",
  },
} as const satisfies Record<string, PluginRuleSpec>;

export interface ProfileStringer {
  readonly face: StringerFace;
  readonly part: Part;
  /** Ligne d'appui (corde) : altitude en u = z0 + m·(u − u0). */
  readonly line: { readonly u0: Mm; readonly z0: Mm; readonly slope: number };
  readonly uLo: Mm;
  readonly uHi: Mm;
  /** Contour de l'âme en (u, z) (coupes comprises). */
  readonly outline: Polygon2;
  readonly supports: readonly SupportPlacement[];
  readonly precheck: InclinedBeamResult;
  /** Longueur de débit (le long de l'axe, onglets compris). */
  readonly cutLength: Mm;
}

export interface SteelProfileResult {
  readonly output: StructureOutput;
  readonly section: SteelSection | null;
  /** Hauteur de section minimale imposée par les supports (mm). */
  readonly requiredHeight: Mm;
  readonly stringers: readonly ProfileStringer[];
  readonly posts: readonly Part[];
  readonly supports: readonly { readonly placement: SupportPlacement; readonly part: Part }[];
  /** Débit par section (`UPN 160`, `L 40 × 40 × 4`, `tube …`). */
  readonly cutting: Readonly<Record<string, CuttingPlan>>;
  readonly executionClass: "EXC1" | "EXC2";
}

const sigmaOf = (k: NosingLine, side: Side): Mm => (side === "inner" ? k.sigmaInner : k.sigmaOuter);

/** Normale horizontale de la ligne de nez, orientée vers le haut de l'escalier. */
function upOf(k: NosingLine, towards: Polygon2, sign: 1 | -1): Vec2 {
  let n = V.perpLeft(V.normalize(k.dir));
  let c = V.ZERO;
  for (const p of towards) c = V.add(c, p);
  c = V.scale(c, 1 / towards.length);
  if (V.dot(V.sub(c, k.p), n) * sign < 0) n = V.scale(n, -1);
  return n;
}

/** Limon avant choix de section : face, portée et ligne d'appui (corde des nez). */
interface Pre {
  face: StringerFace;
  uLo: Mm;
  uHi: Mm;
  line: { u0: Mm; z0: Mm; slope: number };
  candidates: SupportPlacement[];
}

interface TreadZone {
  readonly tread: Tread;
  readonly mark: string;
  readonly zone: Polygon2;
  readonly zUnder: Mm;
}

/** Poteau d'angle attendu par les profilés (contrat `InnerCornerSchema`). */
export interface ProfileNewel {
  readonly kind: "newel";
  readonly size: Mm;
  readonly offset: Mm;
}

/**
 * Poteau élargi des profilés (décision A13 de l'utilisateur, valeurs à valider) : côté
 * a = largeur d'aile b + 2 × jeu (ou côté imposé), **décalé vers le jour** de
 * δ = ⌈a/2 − jeu⌉ (0 si a < 2 × jeu) pour que la face qui reçoit le limon (dont la face côté
 * marches passe par le coin intérieur K) le déborde du jeu côté marches et d'au moins le jeu
 * côté jour : le poteau n'entame les marches que du jeu et reçoit chaque volée en barre droite.
 */
export function profileNewel(
  flangeWidth: Mm,
  newel: { readonly size: "auto" | Mm; readonly clearance: Mm },
): ProfileNewel {
  const c = newel.clearance;
  const size = newel.size === "auto" ? Math.ceil(flangeWidth + 2 * c - 1e-9) : newel.size;
  const offset = Math.max(0, Math.ceil(size / 2 - c - 1e-9));
  return { kind: "newel", size, offset };
}

/**
 * Le poteau (côté `size`, décalage `offset`) convient-il aux profilés d'aile `flangeWidth` ?
 * Côté imposé : exactement le poteau `profileNewel`. Côté `auto` : il reçoit l'aile avec au
 * moins le jeu côté jour (a/2 + δ ≥ b + jeu) et n'entame pas les marches de plus que le jeu
 * arrondi au mm (a/2 − δ ≤ jeu + 0,5) : un poteau posé pour une section plus large convient
 * encore (pas d'aller-retour entre deux sections voisines).
 */
export function profileNewelFits(
  newel: { readonly size: Mm; readonly offset?: Mm | undefined },
  flangeWidth: Mm,
  params: { readonly size: "auto" | Mm; readonly clearance: Mm },
): boolean {
  const offset = newel.offset ?? 0;
  if (params.size !== "auto") {
    const want = profileNewel(flangeWidth, params);
    return newel.size === want.size && offset === want.offset;
  }
  const c = params.clearance;
  return (
    newel.size / 2 + offset >= flangeWidth + c - 1e-9 && newel.size / 2 - offset <= c + 0.5 + 1e-9
  );
}

/**
 * Plus grande largeur d'aile des limons en profilés d'un modèle (section du catalogue lue sur
 * `Part.section`, « UPN 160 (S235) », paramètre `section`), `null` sans limon profilé.
 */
export function profileFlangeWidth(parts: readonly Part[]): Mm | null {
  let best: Mm | null = null;
  for (const p of parts) {
    if (p.category !== "stringer" || !p.section) continue;
    const name =
      p.section.key === "structure.steelProfile.section" ? p.section.params?.["section"] : null;
    const sec = typeof name === "string" ? findSection(name) : undefined;
    if (sec) best = Math.max(best ?? 0, sec.b);
  }
  return best;
}

/** Sens de cintrage d'un limon de jour sur un arc (ailes vers le centre du jour). */
function bendDirection(family: SteelSection["family"]): "flangeIn" | "flat" {
  return family === "UPN" ? "flangeIn" : "flat";
}

/**
 * Plus légère section de `candidates` (triées par masse) qui vérifie `ok`, sinon `null`.
 * Choix `auto` du plugin ; monotone si `ok` l'est (portée plus longue ⇒ section ≥).
 */
export function lightestSection(
  candidates: readonly SteelSection[],
  ok: (s: SteelSection) => boolean,
): SteelSection | null {
  for (const s of [...candidates].sort((a, b) => a.massPerMeter - b.massPerMeter)) {
    if (ok(s)) return s;
  }
  return null;
}

export function buildSteelProfile(
  ctx: StructureContext,
  params: SteelProfileParams,
): SteelProfileResult {
  const { project, stepping } = ctx;
  const profile: WorkshopProfile = resolveWorkshopProfile(project.workshop);
  const metal = profile.metal;
  const nosings = stepping.nosings;
  const notes: Message[] = [];
  const errors: Message[] = [];
  const grade: SteelGrade = params.grade;
  const material = steelMaterial(params.finish);
  const sup = {
    kind: "angle" as const,
    fixing: params.supports.fixing,
    angleLeg: params.supports.angleLeg,
    angleThickness: params.supports.angleThickness,
    plateWidth: params.supports.angleLeg,
    plateThickness: params.supports.angleThickness,
    bolts: params.supports.bolts,
    holeDiameter: params.supports.holeDiameter,
    slotLength: params.supports.slotLength,
    holeEdgeDistance: params.supports.holeEdgeDistance,
    treadScrews: params.supports.treadScrews,
  };
  const empty = (errs: Message[]): SteelProfileResult => ({
    output: { parts: [], checks: [], notes, errors: errs },
    section: null,
    requiredHeight: Number.NaN,
    stringers: [],
    posts: [],
    supports: [],
    cutting: {},
    executionClass: "EXC1",
  });
  const helical = flightsOnlyError(
    "steel-profile",
    msg("structure.steelProfile.shortLabel"),
    ctx.layout,
  );
  if (helical) return empty([helical]);
  if (nosings.length < 2) return empty([msg("structure.steelProfile.error.emptyStepping")]);

  const geo = stairGeometry(project, ctx.layout);
  const turns = project.stair.layout.turns;
  const faceInfo = steelStringerFaces(ctx, geo);
  notes.push(...faceInfo.notes);
  // Jour en arc : message propre (cintrage des profilés), les autres erreurs sont reprises.
  errors.push(...faceInfo.errors.filter((e) => e.key !== "structure.steel.error.arcWell"));
  const faces = faceInfo.faces;
  const baseParts = ctx.baseParts ?? buildBasicParts(project, ctx.layout, stepping).parts;
  const baseById = new Map(baseParts.map((p) => [p.id, p]));
  const checks = new CheckCollector(project, stepping);

  // 1. Zones d'appui des marches (bois, pièces de base).
  const zones = profileTreadZones(project, stepping, params, baseById);

  // 2. Fenêtres des limons et faces porteuses.
  const { windows, supportFaces, newelList } = profileSupportFaces(faces, geo, nosings, params);

  // 3. Supports candidats (marche × face porteuse) ; sur les limons, ils sont ensuite rognés à
  //    la partie de la marche où la cornière tient dans l'âme (dépend de la section).
  const minLen = params.supports.minLength;
  const candidates = supportCandidates(zones, supportFaces);
  const depthSup = supportDepth(sup);
  const edge = params.supports.edgeMargin;

  // 4. Lignes d'appui (cordes des nez de chaque face).
  const bearing = profileBearingLines(faces, windows, stepping, candidates);
  const pres = bearing.pres;
  notes.push(...bearing.notes);
  const top = (p: Pre, u: Mm): Mm =>
    p.line.z0 + p.line.slope * (u - p.line.u0) + params.upperOffset;
  const cosOf = (p: Pre): number => Math.cos(Math.atan(p.line.slope));
  const tfOf = (s: SteelSection | null): Mm => (s && s.shape === "I" ? s.tf : 0);
  /**
   * Partie [u0 ; u1] du support où la cornière tient dans l'âme : dessus sous la rive haute
   * (moins t_f pour un I), dessous à `edgeMargin` au-dessus de la rive basse (plus t_f). Section
   * `null` : hauteur infinie (seule la contrainte haute).
   */
  const fitInWeb = (p: Pre, c: SupportPlacement, s: SteelSection | null): { u0: Mm; u1: Mm } => {
    const tf = tfOf(s);
    const Hv = s ? s.h / cosOf(p) : Infinity;
    const m = p.line.slope;
    const topOk = (u: Mm): boolean => top(p, u) - tf >= c.zTop - 1e-9;
    const botOk = (u: Mm): boolean => top(p, u) - Hv + tf <= c.zTop - depthSup - edge + 1e-9;
    if (Math.abs(m) < 1e-9) {
      return topOk(c.u0) && botOk(c.u0) ? { u0: c.u0, u1: c.u1 } : { u0: c.u0, u1: c.u0 };
    }
    // top(u) croissant (m > 0) : contrainte haute ⇒ u ≥ uA, contrainte basse ⇒ u ≤ uB.
    const uA = p.line.u0 + (c.zTop + tf - p.line.z0 - params.upperOffset) / m;
    const uB = Number.isFinite(Hv)
      ? p.line.u0 + (c.zTop - depthSup - edge - tf + Hv - p.line.z0 - params.upperOffset) / m
      : Infinity;
    const lo = m > 0 ? Math.max(c.u0, uA) : Math.max(c.u0, uB);
    const hi = m > 0 ? Math.min(c.u1, uB) : Math.min(c.u1, uA);
    return { u0: lo, u1: Math.max(lo, hi) };
  };
  /**
   * Hauteur de section nécessaire pour qu'un support garde `minLength` d'appui dans l'âme
   * (0 si ce n'est pas une question de hauteur : support trop court de toute façon).
   */
  const heightNeedOf = (p: Pre, c: SupportPlacement, sec: SteelSection): Mm => {
    const m = p.line.slope;
    if (m <= 1e-9) return 0;
    const tf = tfOf(sec);
    const uA = p.line.u0 + (c.zTop + tf - p.line.z0 - params.upperOffset) / m;
    const a = Math.max(c.u0, uA);
    if (c.u1 - a < minLen - 1e-9) return 0;
    return (top(p, a + minLen) + tf - (c.zTop - depthSup - edge)) * cosOf(p);
  };

  // 5. Prédimensionnement et choix de la section. Charge permanente : cornières **rognées** à
  //    la partie qui tient dans l'âme de la section essayée (dette D4 : comptées avant rognage
  //    jusqu'au 2026-09-30), comme `precheckModel` sur les pièces finales.
  const pc = params.precheck;
  const loads = stairLoads(pc, activeContexts(project, stepping));
  const preByFaceId = new Map(pres.map((p) => [p.face.id, p]));
  /** Supports gardés pour la section `sec` : rognés à l'âme sur les limons, ≥ `minLength`. */
  const trimmedFor = (sec: SteelSection): SupportPlacement[] => {
    const out: SupportPlacement[] = [];
    for (const c of candidates) {
      let pl = c;
      if (c.face.kind === "stringer") {
        const p = preByFaceId.get(c.face.owner);
        if (!p) continue;
        const fit = fitInWeb(p, c, sec);
        pl = { ...c, u0: fit.u0, u1: fit.u1 };
      }
      if (pl.u1 - pl.u0 >= minLen - 1e-9) out.push(pl);
    }
    return out;
  };
  const permanentCache = new Map<SteelSection, number>();
  const permanentAreaOf = (sec: SteelSection): number => {
    let v = permanentCache.get(sec);
    if (v === undefined) {
      const supports = trimmedFor(sec).map((c) => supportPart(c, sup, "S", material, profile));
      v = permanentAreaLoad([...baseParts, ...supports], stepping, profile) + pc.extraPermanent;
      permanentCache.set(sec, v);
    }
    return v;
  };
  const tributaryWidth = project.stair.layout.width / 2;
  const steelMat = steelMaterialOf(grade, pc, metal.density);
  const analyze = (p: Pre, s: SteelSection): InclinedBeamResult =>
    analyzeInclinedBeam({
      spanH: p.uHi - p.uLo,
      slope: Math.max(0, p.line.slope),
      section: { area: s.area, i: s.iy, w: s.wy },
      material: steelMat,
      tributaryWidth,
      permanentArea: permanentAreaOf(s),
      loads,
      settings: pc,
    });
  const needOfPre = (p: Pre, s: SteelSection): Mm =>
    Math.max(0, ...p.candidates.map((c) => heightNeedOf(p, c, s)));
  const heightNeed = (s: SteelSection): Mm => Math.max(0, ...pres.map((p) => needOfPre(p, s)));
  let section: SteelSection | null;
  if (params.section === "auto") {
    const candidates = sectionsOf(params.family);
    section = lightestSection(
      candidates,
      (s) => s.h >= heightNeed(s) - 1e-9 && pres.every((p) => passesPrecheck(analyze(p, s))),
    );
    if (!section) {
      section = candidates[candidates.length - 1] ?? null;
      if (section) {
        errors.push(
          msg("structure.steelProfile.error.noSectionPasses", {
            family: params.family,
            section: section.name,
          }),
        );
      }
    } else {
      notes.push(
        msg("structure.steelProfile.note.autoSection", {
          section: section.name,
          family: params.family,
        }),
      );
    }
  } else {
    section = findSection(params.section)!;
  }
  if (!section) return empty([msg("structure.steelProfile.error.emptyCatalog")]);
  const s = section;
  const requiredHeight = heightNeed(s);
  const permanentArea = permanentAreaOf(s);

  // Supports définitifs : sur les limons, rognés à la partie qui tient dans l'âme.
  const placements: SupportPlacement[] = [];
  const shortSupports: CheckItem[] = [];
  const carried = new Map<number, Set<Side>>();
  const mineOf = new Map<string, SupportPlacement[]>();
  const preByFace = new Map(pres.map((p) => [p.face.id, p]));
  for (const c of candidates) {
    let pl = c;
    if (c.face.kind === "stringer") {
      const p = preByFace.get(c.face.owner);
      if (!p) continue;
      const fit = fitInWeb(p, c, s);
      pl = { ...c, u0: fit.u0, u1: fit.u1 };
    }
    const len = pl.u1 - pl.u0;
    shortSupports.push({
      value: len,
      label: supportOn(c.treadMark, c.face.ownerMark),
      partId: c.face.owner,
      treadNumber: c.tread,
    });
    if (len < minLen - 1e-9) continue;
    placements.push(pl);
    const set = carried.get(c.tread) ?? new Set<Side>();
    set.add(c.face.side);
    carried.set(c.tread, set);
    if (c.face.kind === "stringer") {
      const list = mineOf.get(c.face.owner) ?? [];
      list.push(pl);
      mineOf.set(c.face.owner, list);
    }
  }

  // 6. Jours en arc : cintrage (C-M-06 / C-M-07).
  const bend = profileBendFindings(turns, s, metal);
  const bendFindings = bend.findings;
  errors.push(...bend.errors);

  // 7. Limons.
  const stringers: ProfileStringer[] = [];
  const beams: PrecheckedBeam[] = [];
  const heightFindings: PartCheckItem[] = [];
  const bearingItems: CheckItem[] = [];
  const supportMargins: PartCheckItem[] = [];
  let buttWeldTotal = 0;
  const shift = s.shape === "I" ? (s.b - s.tw) / 2 : 0;
  const sctx: ProfileStringerContext = {
    s,
    sup,
    depthSup,
    params,
    profile,
    material,
    grade,
    shift,
    top,
    analyze,
    needOfPre,
  };
  for (const p of pres) {
    const built = buildProfileStringer(sctx, p, mineOf.get(p.face.id) ?? []);
    notes.push(...built.notes);
    if (!built.stringer) continue;
    supportMargins.push(...built.supportMargins);
    buttWeldTotal += built.buttWeld;
    beams.push(built.beam);
    heightFindings.push(built.height);
    bearingItems.push(...built.bearing);
    stringers.push(built.stringer);
    if (built.spliceNote) notes.push(built.spliceNote);
  }

  // Raccords d'onglet aux angles muraux.
  const miterItems = profileMiterItems(stringers);

  // 8. Supports (pièces) : sur les profilés en I, cornière soudée sur l'âme (face décalée).
  const supportMarked = profileSupportParts(placements, s, shift, sup, material, profile);

  // 9. Poteaux (tube carré soudé).
  const newelPosts = profileNewelPosts(
    ctx,
    newelList,
    stringers,
    placements,
    s,
    params,
    material,
    profile,
  );
  const posts = newelPosts.posts;
  const receivedChecks = newelPosts.received;
  notes.push(...newelPosts.notes);

  // 10. Débit sur barres.
  const debit = profileCutting(s, stringers, [...supportMarked, ...posts], metal);
  const cutting = debit.cutting;
  notes.push(...debit.notes);

  // 11. Classe d'exécution (S355 « soudé » seulement si une pièce porte un cordon, C §2.1) et
  // contrôles.
  const weldTotal = [...stringers.map((x) => x.part), ...posts, ...supportMarked].reduce(
    (acc, p) => acc + (p.quantities[QUANTITY_WELD_MM] ?? 0),
    0,
  );
  const exc = deduceExecutionClass({
    grade,
    buttWeld: buttWeldTotal,
    welded: weldTotal + buttWeldTotal > 1e-9,
  });
  addProfileChecks(checks, {
    exc,
    grade,
    s,
    params,
    metal,
    bendFindings,
    heightFindings,
    bearingItems,
    miterItems,
    stringers,
    others: [...supportMarked, ...posts],
    supportMargins,
    shortSupports,
    zones,
    carried,
    newelList,
    receivedChecks,
  });
  const precheck: readonly RuleResult[] = precheckResults(project, stepping, beams);
  const precheckNote = msg("structure.steelProfile.note.precheck", {
    qk: dec(loads.qk, 1),
    Qk: dec(loads.Qk, 1),
    source: loads.sourceMessage,
    permanent: dec(permanentArea, 2),
  });
  const reasons = joinMessages(exc.reasons);

  notes.push(
    msg("structure.steelProfile.note.summary", {
      section: s.name,
      grade,
      flanges: msg(
        s.shape === "U"
          ? "structure.steelProfile.note.flangesOutward"
          : "structure.steelProfile.note.flangeTipsTreadSide",
      ),
      upperOffset: dec(params.upperOffset, 0),
      leg: dec(sup.angleLeg, 0),
      angleThickness: dec(sup.angleThickness, 0),
      fixing: msg(
        effectiveFixing(sup) === "welded"
          ? "structure.steelProfile.note.anglesWelded"
          : "structure.steelProfile.note.anglesBolted",
      ),
    }),
    precheckNote,
    reasons
      ? msg("structure.steel.exc.note", { executionClass: exc.executionClass, reasons })
      : msg("structure.steel.exc.noteBare", { executionClass: exc.executionClass }),
    msg("structure.steelProfile.note.squareEnds"),
  );

  const supports = placements.map((placement, i) => ({ placement, part: supportMarked[i]! }));
  return {
    output: {
      parts: [...stringers.map((x) => x.part), ...posts, ...supportMarked],
      checks: [...checks.results, ...precheck],
      executionClass: exc.executionClass,
      // Même calcul que les lignes PRECHECK_* (portée uHi − uLo, pente de la ligne, cornières
      // comprises) : seule source de `Model.precheck`.
      precheck: { beams, loads, permanentArea, notes: [precheckNote] },
      notes,
      ...(errors.length > 0 ? { errors } : {}),
      // Côté de poteau `auto` : côté attendu pour l'aile de la section retenue.
      ...(params.newel.size === "auto"
        ? { autoValues: { "newel.size": profileNewel(s.b, params.newel).size } }
        : {}),
      ...(supports.length > 0 ? { assemblies: supportAssemblies(supports) } : {}),
    },
    section: s,
    requiredHeight,
    stringers,
    posts,
    supports,
    cutting,
    executionClass: exc.executionClass,
  };
}

// ------------------------------------------------------------------ étapes de buildSteelProfile

/** Étape 1 : zones d'appui des marches (bois, pièces de base), rognées aux nez ± marges. */
function profileTreadZones(
  project: StructureContext["project"],
  stepping: StructureContext["stepping"],
  params: SteelProfileParams,
  baseById: ReadonlyMap<string, Part>,
): TreadZone[] {
  const nosings = stepping.nosings;
  const zones: TreadZone[] = [];
  const spec = project.stair.treads;
  const m = params.supports.endMargin;
  for (const tread of stepping.treads) {
    const a = nosings[tread.number - 1];
    const b = nosings[tread.number];
    const base = baseById.get(`tread-${tread.number}`);
    if (!a || !b || !base) continue;
    const ex = readPlanExtrusion(base.solid);
    if (!ex) continue;
    const upA = upOf(a, tread.walkingSurface, 1);
    const upB = upOf(b, tread.walkingSurface, -1);
    const front = spec.nosing + (spec.risers === "full" ? spec.riserThickness : 0) + m;
    let zone: Polygon2 = clipHalfPlane(ex.outline, V.addScaled(a.p, upA, front), upA);
    zone = clipHalfPlane(zone, V.addScaled(b.p, upB, spec.nosing - m), V.scale(upB, -1));
    zones.push({ tread, mark: base.mark, zone: dedupe(zone), zUnder: ex.zBottom });
  }
  return zones;
}

/** Portée [uLo ; uHi] d'un limon le long de sa face. */
type StringerWindow = { readonly uLo: Mm; readonly uHi: Mm };

/**
 * Étape 2 : fenêtres des limons (prolongements au départ et à l'arrivée) et faces porteuses des
 * supports (joues des limons, faces des poteaux d'angle).
 */
function profileSupportFaces(
  faces: readonly StringerFace[],
  geo: ReturnType<typeof stairGeometry>,
  nosings: readonly NosingLine[],
  params: SteelProfileParams,
): {
  windows: Map<string, StringerWindow>;
  supportFaces: SupportFace[];
  newelList: ProfileNewelEntry[];
} {
  const windows = new Map(
    faces.map((f) => {
      const u0 = sigmaOf(nosings[0]!, f.side) - f.sigmaA;
      const uN = sigmaOf(nosings[nosings.length - 1]!, f.side) - f.sigmaA;
      return [
        f.id,
        {
          uLo: f.start === "floor" ? u0 - params.startExtension : 0,
          uHi: f.end === "arrival" ? uN + params.endExtension : f.faceLength,
        },
      ];
    }),
  );
  const supportFaces: SupportFace[] = faces.map((f) => {
    const w = windows.get(f.id)!;
    return {
      key: f.id,
      owner: f.id,
      ownerMark: f.mark,
      kind: "stringer",
      side: f.side,
      a: f.a,
      dir: f.dir,
      into: f.into,
      uMin: w.uLo,
      uMax: w.uHi,
    };
  });
  const newelList = geo.newels.map((nw) => ({
    geom: nw,
    id: `post-${nw.turn + 1}`,
    mark: `PT${nw.turn + 1}`,
  }));
  for (const nw of newelList) {
    newelFaces(nw.geom, nw.id).forEach((rf, i) => {
      supportFaces.push({
        key: `${nw.id}-f${i + 1}`,
        owner: nw.id,
        ownerMark: nw.mark,
        kind: "post",
        side: "inner",
        a: rf.a,
        dir: V.normalize(V.sub(rf.b, rf.a)),
        into: rf.into,
        uMin: 0,
        uMax: V.distance(rf.a, rf.b),
      });
    });
  }
  return { windows, supportFaces, newelList };
}

/** Étape 3 : supports candidats (marche × face porteuse), avant rognage à l'âme. */
function supportCandidates(
  zones: readonly TreadZone[],
  supportFaces: readonly SupportFace[],
): SupportPlacement[] {
  const candidates: SupportPlacement[] = [];
  for (const z of zones) {
    for (const face of supportFaces) {
      const iv = supportInterval(z.zone, face, 1);
      if (!iv) continue;
      candidates.push({
        tread: z.tread.number,
        treadMark: z.mark,
        face,
        u0: iv.u0,
        u1: iv.u1,
        zTop: z.zUnder,
      });
    }
  }
  return candidates;
}

/** Étape 4 : lignes d'appui des limons (corde du premier au dernier nez de leur portée). */
function profileBearingLines(
  faces: readonly StringerFace[],
  windows: ReadonlyMap<string, StringerWindow>,
  stepping: StructureContext["stepping"],
  candidates: readonly SupportPlacement[],
): { pres: Pre[]; notes: Message[] } {
  const nosings = stepping.nosings;
  const notes: Message[] = [];
  const pres: Pre[] = [];
  for (const f of faces) {
    const { uLo, uHi } = windows.get(f.id)!;
    const noses = nosings
      .map((k) => ({ u: sigmaOf(k, f.side) - f.sigmaA, z: k.z }))
      .filter((k) => k.u >= uLo - 1e-6 && k.u <= uHi + 1e-6);
    if (noses.length === 0) {
      notes.push(msg("structure.steelProfile.note.noNosing", { mark: f.mark }));
      continue;
    }
    // Corde du premier au dernier nez de la portée. Ancrer la corde au droit d'un angle mural
    // (onglet sans décalage) écarterait davantage la barre des marches balancées : l'écart de
    // rive à l'onglet est signalé (FAB_ONGLET_RACCORD) plutôt qu'imposé nul.
    const first = noses[0]!;
    const last = noses[noses.length - 1]!;
    const slope =
      last.u - first.u > 1
        ? (last.z - first.z) / (last.u - first.u)
        : stepping.rise / stepping.going;
    pres.push({
      face: f,
      uLo,
      uHi,
      line: { u0: first.u, z0: first.z, slope },
      candidates: candidates.filter((c) => c.face.kind === "stringer" && c.face.owner === f.id),
    });
  }
  return { pres, notes };
}

/** Étape 6 : cintrage des limons de jour sur les jours en arc (C-M-06 / C-M-07). */
function profileBendFindings(
  turns: StructureContext["project"]["stair"]["layout"]["turns"],
  s: SteelSection,
  metal: WorkshopProfile["metal"],
): { findings: Finding[]; errors: Message[] } {
  const bendFindings: Finding[] = [];
  const errors: Message[] = [];
  turns.forEach((t, j) => {
    if (t.inner.kind !== "arc") return;
    const r = t.inner.radius;
    const dir = bendDirection(s.family);
    const cap = minProfileBendRadius(metal, s.family, dir, s.h);
    const direction = msg(
      dir === "flangeIn"
        ? "structure.steelProfile.bend.flangeIn"
        : "structure.steelProfile.bend.flat",
    );
    const label = msg("structure.steelProfile.bend.label", {
      turn: j + 1,
      section: s.name,
      direction,
      radius: dec(r, 0),
    });
    if (cap === null) {
      bendFindings.push({
        status: "non-evaluee",
        measured: r,
        message: msg("structure.steelProfile.check.bendUnknown", {
          label,
          family: s.family,
          direction,
        }),
      });
    } else if ("outOfRange" in cap) {
      bendFindings.push({
        status: "violation",
        measured: s.h,
        max: cap.outOfRange,
        message: msg("structure.steelProfile.check.bendOutOfRange", {
          label,
          height: dec(s.h, 0),
          max: dec(cap.outOfRange, 0),
        }),
      });
    } else {
      const ok = r >= cap.radius - 1e-9;
      bendFindings.push({
        status: ok ? "ok" : "violation",
        measured: r,
        min: cap.radius,
        max: null,
        message: ok
          ? msg("structure.steelProfile.check.bendOk", { label, radius: dec(cap.radius, 0) })
          : msg("structure.steelProfile.check.bendTooTight", {
              label,
              radius: dec(cap.radius, 0),
              family: s.family,
              direction,
            }),
      });
    }
    errors.push(
      msg(
        bendFindings[bendFindings.length - 1]!.status === "ok"
          ? "structure.steelProfile.error.arcWellHelical"
          : "structure.steelProfile.error.arcWellRadius",
        { turn: j + 1, section: s.name, flight: j + 1, nextFlight: j + 2 },
      ),
    );
  });
  return { findings: bendFindings, errors };
}

/** Données communes à la construction des limons (étape 7), section choisie. */
interface ProfileStringerContext {
  readonly s: SteelSection;
  readonly sup: SupportSpec;
  readonly depthSup: Mm;
  readonly params: SteelProfileParams;
  readonly profile: WorkshopProfile;
  readonly material: Part["material"];
  readonly grade: SteelGrade;
  /** Débord de l'âme d'un profilé en I derrière la face côté marches, (b − t_w) / 2 (0 : UPN). */
  readonly shift: Mm;
  readonly top: (p: Pre, u: Mm) => Mm;
  readonly analyze: (p: Pre, s: SteelSection) => InclinedBeamResult;
  readonly needOfPre: (p: Pre, s: SteelSection) => Mm;
}

/** Limon construit (étape 7) et ses constats ; `stringer` absent : limon non généré. */
interface BuiltProfileStringer {
  readonly stringer?: ProfileStringer;
  readonly notes: Message[];
  readonly supportMargins: PartCheckItem[];
  readonly buttWeld: Mm;
  readonly beam: PrecheckedBeam;
  readonly height: PartCheckItem;
  readonly bearing: CheckItem[];
  readonly spliceNote?: Message;
}

/**
 * Étape 7 : un limon en profilé (âme dépliée, perçages et traçage des supports, coupes
 * d'extrémité, débit et aboutages, solide extrudé, prédimensionnement).
 */
function buildProfileStringer(
  sc: ProfileStringerContext,
  p: Pre,
  mine: readonly SupportPlacement[],
): BuiltProfileStringer | { readonly stringer?: undefined; readonly notes: Message[] } {
  const { s, sup, depthSup, params, profile, material, grade, shift } = sc;
  const metal = profile.metal;
  const tfBand = s.shape === "I" ? s.tf : 0;
  const supportMargins: PartCheckItem[] = [];
  const f = p.face;
  const alpha = Math.atan(p.line.slope);
  const c = Math.cos(alpha);
  const sn = Math.sin(alpha);
  const Hv = s.h / c;
  const upper = (u: Mm): Mm => sc.top(p, u);
  const lower = (u: Mm): Mm => upper(u) - Hv;
  // Onglet 45° en plan à un angle mural : à la profondeur d derrière la face côté marches, la
  // barre dépasse l'angle de d en plan. L'âme d'un profilé en I est à d = (b − t_w) / 2 : son
  // développé (face de l'âme vue des marches) dépasse l'angle d'autant ; celle d'un UPN est à
  // d = 0 (âme côté marches).
  const uLoW = p.uLo - (f.start === "corner" ? shift : 0);
  const uHiW = p.uHi + (f.end === "corner" ? shift : 0);
  let outline: Vec2[] = [
    V.vec(uLoW, lower(uLoW)),
    V.vec(uHiW, lower(uHiW)),
    V.vec(uHiW, upper(uHiW)),
    V.vec(uLoW, upper(uLoW)),
  ];
  outline = clipHalfPlane(outline, V.vec(0, 0), V.vec(0, 1));
  if (outline.length < 3) {
    return { notes: [msg("structure.steelProfile.note.underFloor", { mark: f.mark })] };
  }
  // Repère de la barre : x le long de l'axe, y perpendiculaire (0 = rive basse).
  const O = V.vec(uLoW, lower(uLoW));
  const toBar = (q: Vec2): Vec2 => {
    const d = V.sub(q, O);
    return V.vec(d.x * c + d.y * sn, -d.x * sn + d.y * c);
  };
  const mirrored = V.dot(V.perpRight(f.into), f.dir) < 0;
  let barPts = outline.map(toBar);
  let xMin = Infinity;
  let xMax = -Infinity;
  for (const q of barPts) {
    xMin = Math.min(xMin, q.x);
    xMax = Math.max(xMax, q.x);
  }
  const norm = (q: Vec2): Vec2 => {
    const x = q.x - xMin;
    return V.vec(mirrored ? xMax - xMin - x : x, q.y);
  };
  const T = (q: Vec2): Vec2 => norm(toBar(q));
  barPts = outline.map(T);
  if (signedArea(barPts) < 0) barPts.reverse();
  const barLength = xMax - xMin;
  // Supports : perçages et traçage.
  const holes: Vec2[][] = [];
  const lines: FlatPattern["lines"][number][] = [];
  for (const sp of mine) {
    for (const cc of boltCenters(sp, sup)) {
      const ring = holePolygon(T(cc), sup.holeDiameter, sup.slotLength, V.vec(1, 0));
      holes.push(signedArea(ring) > 0 ? ring.reverse() : ring);
    }
    const zb = sp.zTop - depthSup;
    const rect = [
      V.vec(sp.u0, zb),
      V.vec(sp.u1, zb),
      V.vec(sp.u1, sp.zTop),
      V.vec(sp.u0, sp.zTop),
    ].map(T);
    rect.forEach((a, i) =>
      lines.push({
        kind: "mark",
        a,
        b: rect[(i + 1) % 4]!,
        ...(i === 0
          ? { label: msg("structure.steel.flatLine.support", { mark: sp.treadMark }) }
          : {}),
      }),
    );
    for (const u of [sp.u0, sp.u1]) {
      supportMargins.push({
        value: Math.min(zb - (lower(u) + tfBand), upper(u) - tfBand - sp.zTop),
        label: supportOn(sp.treadMark, f.mark),
        partId: f.id,
        treadNumber: sp.tread,
      });
    }
  }
  // Coupes d'extrémité (libellés sur le développé).
  const endLabel = (which: "start" | "end"): Message => {
    const kind = which === "start" ? f.start : f.end;
    const angle = { angle: dec((alpha * 180) / Math.PI, 1) };
    switch (kind) {
      case "floor":
        return msg("structure.steelProfile.joint.floor", angle);
      case "arrival":
        return msg("structure.steelProfile.joint.arrival", angle);
      case "newel":
        return msg("structure.steelProfile.joint.newel", angle);
      case "corner":
        return msg(
          which === "start"
            ? "structure.steelProfile.joint.cornerWelded"
            : "structure.steelProfile.joint.corner",
          angle,
        );
    }
  };
  for (const which of ["start", "end"] as const) {
    const u = which === "start" ? uLoW : uHiW;
    const a = T(V.vec(u, Math.max(lower(u), 0)));
    const b = T(V.vec(u, upper(u)));
    lines.push({ kind: "joint", a, b, label: endLabel(which) });
  }
  lines.push({
    kind: "text",
    a: V.vec(barLength / 2 - 20, s.h / 2),
    b: V.vec(barLength / 2 + 20, s.h / 2),
    label: textMessage(f.mark),
  });
  const flat: FlatPattern = {
    outline: { outer: barPts, holes },
    lines,
    thickness: s.tw,
    reference: {
      kind: "face",
      description: msg(
        f.side === "inner"
          ? "structure.steelProfile.reference.outerStringWeb"
          : "structure.steelProfile.reference.wallStringWeb",
        { section: s.name, ascent: ascentDirection(mirrored), height: dec(s.h, 0) },
      ),
    },
  };
  // Débit : onglet d'angle mural (+ b en plan de chaque côté concerné, depuis la face côté
  // marches ; le développé en porte déjà `shift`).
  const miterEnds = (f.start === "corner" ? 1 : 0) + (f.end === "corner" ? 1 : 0);
  const cutLength = barLength + (miterEnds * (s.b - shift)) / c;
  const maxBar = Math.max(...metal.barLengths);
  const splices = cutLength > maxBar + 1e-9 ? Math.ceil(cutLength / maxBar) - 1 : 0;
  const buttWeld = params.splice === "welded" ? splices * sectionPerimeter(s) : 0;
  // Cordon sur une coupe d'aplomb : les deux rives verticales mesurent h / cos α, les
  // longueurs transversales (4b − 2t_w) sont multipliées par `k` (√2 pour l'onglet 45° en plan).
  const plumbPerimeter = (k: number): Mm => (2 * s.h) / c + (sectionPerimeter(s) - 2 * s.h) * k;
  const cornerWeld = f.start === "corner" ? plumbPerimeter(Math.SQRT2) : 0;
  const newelWeld =
    (f.start === "newel" ? plumbPerimeter(1) : 0) + (f.end === "newel" ? plumbPerimeter(1) : 0);
  const cuts = (f.start === "floor" ? 2 : 1) + 1;
  // Solide : section extrudée le long de l'axe (extrémités d'équerre en 3D).
  const into3 = { x: f.into.x, y: f.into.y, z: 0 };
  const axis3 = { x: f.dir.x * c, y: f.dir.y * c, z: sn };
  const up3 = { x: -f.dir.x * sn, y: -f.dir.y * sn, z: c };
  const cross = {
    x: into3.y * up3.z - into3.z * up3.y,
    y: into3.z * up3.x - into3.x * up3.z,
    z: into3.x * up3.y - into3.y * up3.x,
  };
  const forward = cross.x * axis3.x + cross.y * axis3.y + cross.z * axis3.z > 0;
  const startBar = xMin; // abscisse d'axe (non normalisée) du bout bas
  const endBar = xMax;
  const at3 = (x: Mm) => {
    // Point de la rive basse (y = 0) d'abscisse d'axe x, sur la face côté marches.
    const u = O.x + x * c;
    const z = O.y + x * sn;
    const pl = V.addScaled(f.a, f.dir, u);
    return { x: pl.x, y: pl.y, z };
  };
  const o3 = at3(forward ? startBar : endBar);
  const sectionPts = sectionOutline(s).map((q) => V.vec(q.x, q.y));
  const part: Part = {
    id: f.id,
    mark: f.mark,
    category: "stringer",
    name: msg(
      f.side === "inner"
        ? "structure.steelProfile.part.outerString"
        : "structure.steelProfile.part.wallString",
      { section: s.name, flight: f.leg + 1 },
    ),
    material,
    solid: {
      kind: "extrusion",
      frame: { origin: o3, xAxis: into3, yAxis: up3, zAxis: cross },
      profile: { outer: sectionPts, holes: [] },
      depth: barLength,
    },
    flat,
    section: msg("structure.steelProfile.section", { section: s.name, grade }),
    stock: { length: cutLength, width: s.h, thickness: s.b },
    quantities: steelQuantities(
      {
        volumeMm3: s.area * cutLength,
        treatedSurfaceMm2: sectionPerimeter(s) * cutLength + 2 * s.area,
        length: cutLength,
        weld: buttWeld + cornerWeld + newelWeld,
        buttWeld,
        cuts: cuts + splices,
        holes: holes.length,
      },
      profile,
    ),
  };
  const beam = sc.analyze(p, s);
  const bearing: CheckItem[] = [];
  if (s.shape === "I") {
    for (const sp of mine) {
      bearing.push({
        value: sup.angleLeg - shift,
        label: supportOn(sp.treadMark, f.mark),
        partId: f.id,
        treadNumber: sp.tread,
      });
    }
  }
  return {
    stringer: {
      face: f,
      part,
      line: p.line,
      uLo: p.uLo,
      uHi: p.uHi,
      outline,
      supports: mine,
      precheck: beam,
      cutLength,
    },
    notes: [],
    supportMargins,
    buttWeld,
    beam: { partId: f.id, label: textMessage(`${f.mark}, ${s.name} ${grade}`), result: beam },
    height: { value: s.h - sc.needOfPre(p, s), label: textMessage(f.mark), partId: f.id },
    bearing,
    ...(splices > 0
      ? {
          spliceNote: msg(
            params.splice === "welded"
              ? "structure.steelProfile.note.weldedSplices"
              : "structure.steelProfile.note.boltedSplices",
            {
              mark: f.mark,
              length: dec(cutLength, 0),
              bar: dec(maxBar, 0),
              count: splices,
            },
          ),
        }
      : {}),
  };
}

/** Écarts de rive haute des limons muraux au droit des onglets d'angle (FAB_ONGLET_RACCORD). */
function profileMiterItems(stringers: readonly ProfileStringer[]): PartCheckItem[] {
  const miterItems: PartCheckItem[] = [];
  for (const a of stringers) {
    if (a.face.end !== "corner") continue;
    const b = stringers.find((x) => x.face.side === "outer" && x.face.leg === a.face.leg + 1);
    if (!b || b.face.start !== "corner") continue;
    const za = a.line.z0 + a.line.slope * (a.face.faceLength - a.line.u0);
    const zb = b.line.z0 + b.line.slope * (0 - b.line.u0);
    miterItems.push({
      value: Math.abs(za - zb),
      label: textMessage(`${a.face.mark} / ${b.face.mark}`),
      partId: b.face.id,
    });
  }
  return miterItems;
}

/**
 * Étape 8 : pièces supports (cornières), repérées par groupe identique ; sur les profilés en I,
 * cornière soudée sur l'âme (face décalée de `shift`).
 */
function profileSupportParts(
  placements: readonly SupportPlacement[],
  s: SteelSection,
  shift: Mm,
  sup: SupportSpec,
  material: Part["material"],
  profile: WorkshopProfile,
): Part[] {
  const supportParts = placements.map((p) => {
    const onI = p.face.kind === "stringer" && s.shape === "I";
    const face = onI ? { ...p.face, a: V.addScaled(p.face.a, p.face.into, shift) } : p.face;
    return supportPart({ ...p, face }, sup, "S", material, profile);
  });
  const groupKey = (p: Part): string =>
    `${JSON.stringify(p.section)}|${Math.round((p.stock?.length ?? 0) / 0.5)}|${p.quantities["holes"]}`;
  const groupIds = new Map<string, number>();
  return supportParts.map((p) => {
    const k = groupKey(p);
    if (!groupIds.has(k)) groupIds.set(k, groupIds.size + 1);
    return { ...p, mark: `CR${groupIds.get(k)}` };
  });
}

/** Poteau d'angle à construire (étape 9). */
interface ProfileNewelEntry {
  readonly geom: NewelGeometry;
  readonly id: string;
  readonly mark: string;
}

/** Étape 9 : poteaux d'angle en tube carré soudé, largeur des limons reçus. */
function profileNewelPosts(
  ctx: StructureContext,
  newelList: readonly ProfileNewelEntry[],
  stringers: readonly ProfileStringer[],
  placements: readonly SupportPlacement[],
  s: SteelSection,
  params: SteelProfileParams,
  material: Part["material"],
  profile: WorkshopProfile,
): { posts: Part[]; received: ReceivedCheck[]; notes: Message[] } {
  const notes: Message[] = [];
  const posts: Part[] = [];
  const receivedChecks: ReceivedCheck[] = [];
  const expectedNewel = profileNewel(s.b, params.newel);
  for (const nw of newelList) {
    const g: NewelGeometry = nw.geom;
    const a = g.size;
    if (!profileNewelFits(g, s.b, params.newel)) {
      notes.push(
        msg(
          g.offset > 0
            ? "structure.steelProfile.note.newelMismatchOffset"
            : "structure.steelProfile.note.newelMismatchCentered",
          {
            mark: nw.mark,
            size: dec(a, 0),
            offset: dec(g.offset, 0),
            expectedSize: dec(expectedNewel.size, 0),
            expectedOffset: dec(expectedNewel.offset, 0),
            basis:
              params.newel.size === "auto"
                ? msg("structure.steelProfile.note.newelBasisAuto", {
                    flange: dec(s.b, 0),
                    clearance: dec(params.newel.clearance, 0),
                  })
                : msg("structure.steelProfile.note.newelBasisImposed"),
          },
        ),
      );
    }
    const received = stringers.filter(
      (x) =>
        x.face.side === "inner" &&
        ((x.face.end === "newel" && x.face.leg === g.turn) ||
          (x.face.start === "newel" && x.face.leg === g.turn + 1)),
    );
    let topZ = -Infinity;
    for (const x of received) {
      const u = x.face.end === "newel" && x.face.leg === g.turn ? x.uHi : x.uLo;
      topZ = Math.max(topZ, x.line.z0 + x.line.slope * (u - x.line.u0) + params.upperOffset);
      receivedChecks.push({
        value: s.b,
        label: supportOn(x.face.mark, nw.mark),
        partId: x.face.id,
        newelMark: nw.mark,
      });
    }
    for (const p of placements.filter((q) => q.face.owner === nw.id)) topZ = Math.max(topZ, p.zTop);
    if (!Number.isFinite(topZ)) {
      notes.push(msg("structure.steel.note.newelNothingReceived", { mark: nw.mark }));
      continue;
    }
    const raised = newelTopWithHandrail(topZ + params.newel.topExtension, ctx, g.turn);
    const height = raised.top;
    if (raised.raisedBy > 0) {
      notes.push(
        msg("structure.steel.note.newelRaised", {
          mark: nw.mark,
          top: dec(height, 0),
          overrun: dec(raised.overrun, 0),
        }),
      );
    }
    const h2 = a / 2;
    const at = (x: number, y: number): Vec2 =>
      V.add(V.add(g.center, V.scale(g.n, x)), V.scale(g.u, y));
    const sq = (d: Mm): Vec2[] => {
      const pts = [at(-d, -d), at(d, -d), at(d, d), at(-d, d)];
      return signedArea(pts) > 0 ? pts : pts.reverse();
    };
    const tt = params.newel.tubeThickness;
    const outer = sq(h2);
    const inner = sq(h2 - tt).reverse();
    const o = outer[0]!;
    const rel = (q: Vec2): Vec2 => V.sub(q, o);
    const areaS = a * a - (a - 2 * tt) * (a - 2 * tt);
    posts.push({
      id: nw.id,
      mark: nw.mark,
      category: "post",
      name: msg("structure.steel.part.newel", { turn: g.turn + 1 }),
      material,
      solid: {
        kind: "extrusion",
        frame: {
          origin: { x: o.x, y: o.y, z: 0 },
          xAxis: { x: 1, y: 0, z: 0 },
          yAxis: { x: 0, y: 1, z: 0 },
          zAxis: { x: 0, y: 0, z: 1 },
        },
        profile: { outer: outer.map(rel), holes: [inner.map(rel)] },
        depth: height,
      },
      // Limons reçus par le poteau (assemblage soudé), symétrisé par le pipeline.
      ...(received.length > 0 ? { assembledWith: received.map((x) => x.face.id) } : {}),
      section: msg("structure.steel.section.squareTube", {
        size: dec(a, 0),
        thickness: dec(tt, 0),
      }),
      stock: { length: height, width: a, thickness: a },
      quantities: steelQuantities(
        {
          volumeMm3: areaS * height,
          treatedSurfaceMm2: 4 * a * height + 2 * areaS,
          length: height,
          cuts: 2,
        },
        profile,
      ),
    });
  }
  return { posts, received: receivedChecks, notes };
}

/** Étape 10 : débit sur barres (limons de section `s`, puis supports et poteaux par section). */
function profileCutting(
  s: SteelSection,
  stringers: readonly ProfileStringer[],
  others: readonly Part[],
  metal: WorkshopProfile["metal"],
): { cutting: Record<string, CuttingPlan>; notes: Message[] } {
  const notes: Message[] = [];
  const kerf = metal.sawKerf;
  const cutting: Record<string, CuttingPlan> = {};
  /** Désignation affichée de chaque plan de débit. */
  const labels = new Map<string, Message>();
  const addPlan = (key: string, label: Message, pieces: CutPiece[]): void => {
    if (pieces.length === 0) return;
    cutting[key] = cuttingPlan(pieces, metal.barLengths, kerf);
    labels.set(key, label);
  };
  addPlan(
    s.name,
    textMessage(s.name),
    stringers.map((x) => ({ id: x.part.id, mark: x.part.mark, length: x.cutLength })),
  );
  // Clé de débit : désignation de la section dans la langue de référence (identifiant stable
  // de `SteelProfileResult.cutting`, « L 40 × 40 × 4 »), jamais affichée telle quelle.
  const sectionKey = (section: Message): string => translatorFor(DEFAULT_LOCALE).t(section);
  const bySection = new Map<string, { label: Message; pieces: CutPiece[] }>();
  for (const p of others) {
    const key = p.section ? sectionKey(p.section) : p.id;
    const entry = bySection.get(key) ?? { label: p.section ?? textMessage(p.id), pieces: [] };
    entry.pieces.push({ id: p.id, mark: p.mark, length: p.stock?.length ?? 0 });
    bySection.set(key, entry);
  }
  for (const [k, v] of bySection) addPlan(k, v.label, v.pieces);
  for (const [k, plan] of Object.entries(cutting)) {
    const byLen = new Map<number, number>();
    for (const b of plan.bars) byLen.set(b.barLength, (byLen.get(b.barLength) ?? 0) + 1);
    const bars = [...byLen.entries()]
      .sort((x, y) => x[0] - y[0])
      .map(([l, n]) => `${n} × ${Math.round(l / 1000)} m`)
      .join(" + ");
    notes.push(
      msg(
        plan.oversize.length > 0
          ? "structure.steelProfile.note.cuttingOversize"
          : "structure.steelProfile.note.cutting",
        {
          section: labels.get(k)!,
          bars: bars ? textMessage(bars) : msg("structure.steelProfile.note.noBar"),
          utilization: dec(plan.utilization * 100, 0),
          kerf: dec(kerf, 0),
          count: plan.oversize.length,
        },
      ),
    );
  }
  return { cutting, notes };
}

/** Étape 11 : contrôles de fabrication de `steel-profile` (ordre des résultats conservé). */
function addProfileChecks(
  checks: CheckCollector,
  input: {
    readonly exc: ReturnType<typeof deduceExecutionClass>;
    readonly grade: SteelGrade;
    readonly s: SteelSection;
    readonly params: SteelProfileParams;
    readonly metal: WorkshopProfile["metal"];
    readonly bendFindings: readonly Finding[];
    readonly heightFindings: PartCheckItem[];
    readonly bearingItems: CheckItem[];
    readonly miterItems: PartCheckItem[];
    readonly stringers: readonly ProfileStringer[];
    readonly others: readonly Part[];
    readonly supportMargins: PartCheckItem[];
    readonly shortSupports: CheckItem[];
    readonly zones: readonly TreadZone[];
    readonly carried: ReadonlyMap<number, Set<Side>>;
    readonly newelList: readonly ProfileNewelEntry[];
    readonly receivedChecks: readonly ReceivedCheck[];
  },
): void {
  const { exc, grade, s, params, metal } = input;
  const rule = (r: PluginRuleSpec) => pluginRuleDef(r);
  checks.add(rule(STEEL_RULES.executionClass), [
    {
      status: "ok",
      message: msg("structure.steelProfile.exc.check", {
        executionClass: exc.executionClass,
        reasons: executionClassReasons(exc, grade),
      }),
    },
  ]);
  if (input.bendFindings.length > 0) checks.add(rule(PROFILE_RULES.bending), input.bendFindings);
  checks.addItems(
    rule(PROFILE_RULES.sectionHeight),
    input.heightFindings,
    msg("structure.steelProfile.quantity.webHeightReserve"),
    {
      min: -1e-6,
      max: null,
    },
  );
  if (s.shape === "I") {
    checks.addItems(
      rule(PROFILE_RULES.supportBearing),
      input.bearingItems,
      msg("structure.steelProfile.quantity.bearingBeyondFlanges"),
      {
        min: params.supports.minBearing,
        max: null,
      },
    );
  }
  const lateral = profileLateralWidthFindings(params, s);
  if (lateral.length > 0) checks.add(rule(PROFILE_RULES.lateralWidth), lateral);
  if (input.miterItems.length > 0) {
    checks.addItems(
      rule(PROFILE_RULES.miter),
      input.miterItems,
      msg("structure.steelProfile.quantity.miterTopEdgeGap"),
      { min: null, max: params.miterTolerance },
    );
  }
  checks.addItems(
    rule(STEEL_RULES.barLength),
    [
      ...input.stringers.map((x) => ({
        value: x.cutLength,
        label: textMessage(x.part.mark),
        partId: x.part.id,
      })),
      ...input.others.map((p) => ({
        value: p.stock!.length,
        label: textMessage(p.mark),
        partId: p.id,
      })),
    ],
    msg("structure.steel.quantity.barLength"),
    { min: null, max: Math.max(...metal.barLengths) },
  );
  checks.addItems(
    rule(STEEL_RULES.supportInStringer),
    input.supportMargins,
    msg("structure.steel.quantity.supportEdgeMargin"),
    {
      min: -1e-6,
      max: null,
    },
  );
  checks.addItems(
    rule(STEEL_RULES.supportLength),
    input.shortSupports,
    msg("structure.steel.quantity.bearingLength"),
    { min: params.supports.minLength, max: null },
  );
  checks.add(
    rule(STEEL_RULES.treadCarried),
    input.zones.map((z): Finding => {
      const set = input.carried.get(z.tread.number) ?? new Set<Side>();
      const missing = (["inner", "outer"] as const).filter((sd) => !set.has(sd));
      return missing.length === 0
        ? {
            status: "ok",
            location: { kind: "tread", number: z.tread.number },
            message: msg("structure.steel.check.treadCarried", { mark: z.mark }),
          }
        : {
            status: "violation",
            location: { kind: "tread", number: z.tread.number },
            message: treadNotCarried(z.mark, missing),
          };
    }),
  );
  for (const nw of input.newelList) {
    const items = input.receivedChecks.filter((r) => r.newelMark === nw.mark);
    if (items.length === 0) continue;
    checks.addItems(
      pluginRuleDef(FAB_RULES.newelReception),
      items,
      msg("structure.steelProfile.quantity.receivedSectionWidth"),
      { min: null, max: nw.geom.jourExtent },
    );
  }
}

export const STEEL_PROFILE: StructureKind<SteelProfileParams> = {
  kind: "steel-profile",
  labelKey: "structure.steelProfile.label",
  family: "metal",
  paramsSchema: SteelProfileParamsSchema,
  defaults: () => SteelProfileParamsSchema.parse({}),
  build: (ctx, params) => buildSteelProfile(ctx, params).output,
  capabilities: {
    // Limons de jour reçus par le poteau élargi des profilés (décision A13).
    requiresNewel: true,
    // Largeur hors tout du profilé (aile b, UPN et I), hors emprise utile des deux côtés.
    lateralThickness: (p) => {
      const b = profileLateralWidth(p);
      return { inner: b, outer: b };
    },
  },
};

/**
 * Largeur du limon hors emprise utile : aile b de la section nommée ; section `auto` (choisie
 * au calcul, inconnue sans modèle) : aile de la plus légère de la famille, première essayée par
 * le choix automatique (borne basse : la section retenue peut être plus large ; la borne haute,
 * aile la plus large de la famille, exclurait toute trémie de 900 mm avec E ≥ 800 mm).
 */
export function profileLateralWidth(p: SteelProfileParams): Mm {
  const named = p.section === "auto" ? undefined : findSection(p.section);
  if (named) return named.b;
  return sectionsOf(p.family)[0]?.b ?? 0;
}

/**
 * Contrôle a posteriori de l'épaisseur hors emprise en section `auto` (décision de l'utilisateur
 * 2026-09-30, QUESTIONS D4) : l'épaisseur déclarée avant le choix de section
 * (`profileLateralWidth`, borne basse) est comparée à l'aile b de la section retenue. Comme
 * `GC_CONFLIT_DALLE`, un constat seulement si elle est dépassée (constat géométrique, aucun
 * seuil métier) ; rien pour une section nommée (épaisseur déclarée = son aile) ni pour une
 * section retenue égale à la borne basse.
 */
export function profileLateralWidthFindings(
  params: SteelProfileParams,
  section: SteelSection,
): Finding[] {
  if (params.section !== "auto") return [];
  const counted = profileLateralWidth(params);
  const excess = section.b - counted;
  if (!(excess > 1e-9)) return [];
  const lightest = sectionsOf(params.family)[0];
  return [
    {
      status: "violation",
      measured: section.b,
      min: null,
      max: counted,
      message: msg("structure.steelProfile.check.lateralWidth", {
        section: section.name,
        flange: dec(section.b, 0),
        counted: dec(counted, 0),
        lightest: lightest?.name ?? msg("structure.steelProfile.check.lightestOfFamily"),
        excess: dec(excess, 0),
      }),
    },
  ];
}
