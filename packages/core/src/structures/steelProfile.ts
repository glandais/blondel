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
 * - **Tournants** : poteau → tube carré soudé ; angle vif → erreur explicite ; **jour en arc**
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
import { fmt } from "../rules/check.js";
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
import {
  STEEL_RULES,
  deduceExecutionClass,
  QUANTITY_WELD_MM,
  holePolygon,
  steelMaterial,
  steelQuantities,
} from "./steelCommon.js";
import { steelStringerFaces } from "./steelFlat.js";
import { cuttingPlan, type CutPiece, type CuttingPlan } from "./steelProfileCutting.js";
import {
  boltCenters,
  effectiveFixing,
  supportDepth,
  supportInterval,
  supportPart,
  type SupportFace,
  type SupportPlacement,
} from "./supports.js";
import type { StringerFace } from "./woodHoused.js";

const mmInt = z.number().int();
const mmPos = mmInt.positive();
const mmNonNeg = mmInt.nonnegative();

export const SteelProfileParamsSchema = z.object({
  grade: z.enum(STEEL_GRADES).default("S235"),
  finish: z.enum(["raw", "painted", "galvanized"]).default("painted"),
  /** Famille de profilé (C §2.3 : UPN, IPN, IPE, HEA). */
  family: z.enum(SECTION_FAMILIES).default("UPN"),
  /** Section du catalogue (ex. `UPN 160`), ou `auto` (plus légère qui passe). */
  section: z
    .union([
      z.literal("auto"),
      z.string().refine((s) => findSection(s) !== undefined, {
        message: "section absente du catalogue",
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
      /** Épaisseur de paroi du tube carré a × a (à valider). */
      tubeThickness: mmPos.default(4),
      /** Dépassement au-dessus du plus haut élément reçu (à valider). */
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
    description:
      "Cintrage d'un profilé : rayon ≥ rayon minimal du profil d'atelier pour la famille et le sens (C-M-06 UPN : aile extérieure 500, aile intérieure 650, chant 200 ; C-M-07 IPE / IPN : chant 1 400, à plat 650)",
    source:
      "docs/research/C-structures.md §2.3 et §4.1 [15] (capacités d'un cintreur, confiance moyenne, paramétrables)",
    confidence: "moyen",
    nature: "metier",
    severity: "bloquant",
    unit: "mm",
  },
  sectionHeight: {
    id: "FAB_PROFILE_HAUTEUR",
    description:
      "Hauteur de profilé suffisante pour loger les supports de marche dans l'âme (marge de rive comprise)",
    source: "Géométrie de la structure (supports générés) ; marges à valider",
    confidence: "faible",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
  supportBearing: {
    id: "FAB_SUPPORT_DEBORD",
    description:
      "Profilé en I : aile horizontale de la cornière au-delà des bouts d'ailes ≥ appui mini (paramètre)",
    source: "Profil d'atelier Blondel (valeur par défaut à valider, LEDGER §2)",
    confidence: "faible",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
  miter: {
    id: "FAB_ONGLET_RACCORD",
    description:
      "Angle mural en onglet : écart d'altitude des rives hautes des deux limons au droit de l'angle (corde de chaque volée) ; au-delà de la tolérance, pièce de raccord ou limon coudé à prévoir (non généré)",
    source: "Géométrie de la structure ; tolérance à valider (ISO 13920 non appliquée)",
    confidence: "faible",
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

interface TreadZone {
  readonly tread: Tread;
  readonly mark: string;
  readonly zone: Polygon2;
  readonly zUnder: Mm;
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
  const notes: string[] = [];
  const errors: string[] = [];
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
  const empty = (errs: string[]): SteelProfileResult => ({
    output: { parts: [], checks: [], notes, errors: errs },
    section: null,
    requiredHeight: Number.NaN,
    stringers: [],
    posts: [],
    supports: [],
    cutting: {},
    executionClass: "EXC1",
  });
  const helical = flightsOnlyError("steel-profile", "limons en profilés", ctx.layout);
  if (helical) return empty([helical]);
  if (nosings.length < 2) return empty(["Limons en profilés : découpage vide, aucune structure."]);

  const geo = stairGeometry(project, ctx.layout);
  const turns = project.stair.layout.turns;
  const faceInfo = steelStringerFaces(ctx, geo);
  notes.push(...faceInfo.notes);
  // Jour en arc : message propre (cintrage des profilés), les autres erreurs sont reprises.
  errors.push(...faceInfo.errors.filter((e) => !/jour en arc/.test(e)));
  const faces = faceInfo.faces;
  const baseParts = ctx.baseParts ?? buildBasicParts(project, ctx.layout, stepping).parts;
  const baseById = new Map(baseParts.map((p) => [p.id, p]));
  const checks = new CheckCollector(project, stepping);

  // 1. Zones d'appui des marches (bois, pièces de base).
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

  // 2. Fenêtres des limons et faces porteuses.
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

  // 3. Supports candidats (marche × face porteuse) ; sur les limons, ils sont ensuite rognés à
  //    la partie de la marche où la cornière tient dans l'âme (dépend de la section).
  const minLen = params.supports.minLength;
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
  const depthSup = supportDepth(sup);
  const edge = params.supports.edgeMargin;

  // 4. Lignes d'appui (cordes des nez de chaque face).
  interface Pre {
    face: StringerFace;
    uLo: Mm;
    uHi: Mm;
    line: { u0: Mm; z0: Mm; slope: number };
    candidates: SupportPlacement[];
  }
  const pres: Pre[] = [];
  for (const f of faces) {
    const { uLo, uHi } = windows.get(f.id)!;
    const noses = nosings
      .map((k) => ({ u: sigmaOf(k, f.side) - f.sigmaA, z: k.z }))
      .filter((k) => k.u >= uLo - 1e-6 && k.u <= uHi + 1e-6);
    if (noses.length === 0) {
      notes.push(`${f.mark} : aucun nez dans la portée du limon, limon non généré.`);
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

  // 5. Prédimensionnement et choix de la section.
  const pc = params.precheck;
  const loads = stairLoads(pc, activeContexts(project, stepping));
  const supportPartsRaw = candidates
    .filter((c) => c.u1 - c.u0 >= minLen)
    .map((c) => supportPart(c, sup, "S", material, profile));
  const permanentArea =
    permanentAreaLoad([...baseParts, ...supportPartsRaw], stepping, profile) + pc.extraPermanent;
  const tributaryWidth = project.stair.layout.width / 2;
  const steelMat = steelMaterialOf(grade, pc, metal.density);
  const analyze = (p: Pre, s: SteelSection): InclinedBeamResult =>
    analyzeInclinedBeam({
      spanH: p.uHi - p.uLo,
      slope: Math.max(0, p.line.slope),
      section: { area: s.area, i: s.iy, w: s.wy },
      material: steelMat,
      tributaryWidth,
      permanentArea,
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
          `Limons en profilés : aucune section ${params.family} du catalogue ne passe le prédimensionnement indicatif et la hauteur d'âme ; ${section.name} retenue (la plus lourde), à reprendre (famille plus raide, limon intermédiaire, note de calcul).`,
        );
      }
    } else {
      notes.push(
        `Section automatique : ${section.name} (plus légère de la famille ${params.family} qui loge les supports et passe le prédimensionnement indicatif : L/200, contrainte, f₁ ≥ 5 Hz).`,
      );
    }
  } else {
    section = findSection(params.section)!;
  }
  if (!section) return empty(["Limons en profilés : catalogue vide pour la famille choisie."]);
  const s = section;
  const requiredHeight = heightNeed(s);

  // Supports définitifs : sur les limons, rognés à la partie qui tient dans l'âme.
  const placements: SupportPlacement[] = [];
  const shortSupports: { value: Mm; label: string }[] = [];
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
    shortSupports.push({ value: len, label: `${c.treadMark} sur ${c.face.ownerMark}` });
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
  const bendFindings: Finding[] = [];
  turns.forEach((t, j) => {
    if (t.inner.kind !== "arc") return;
    const r = t.inner.radius;
    const dir = bendDirection(s.family);
    const cap = minProfileBendRadius(metal, s.family, dir, s.h);
    const dirLabel = dir === "flangeIn" ? "aile intérieure" : "à plat";
    const label = `Tournant ${j + 1}, limon de jour ${s.name} cintré ${dirLabel}, rayon ${fmt(r, 0)} mm`;
    if (cap === null) {
      bendFindings.push({
        status: "non-evaluee",
        measured: r,
        message: `${label} : aucune capacité de cintrage connue pour ${s.family} (${dirLabel}) dans le profil d'atelier — à valider chez le cintreur.`,
      });
    } else if ("outOfRange" in cap) {
      bendFindings.push({
        status: "violation",
        measured: s.h,
        max: cap.outOfRange,
        message: `${label} : section plus haute (${fmt(s.h, 0)} mm) que la capacité du cintreur (${fmt(cap.outOfRange, 0)} mm) — limon de jour exclu.`,
      });
    } else {
      const ok = r >= cap.radius - 1e-9;
      bendFindings.push({
        status: ok ? "ok" : "violation",
        measured: r,
        min: cap.radius,
        max: null,
        message: ok
          ? `${label} ≥ ${fmt(cap.radius, 0)} mm : cintrage possible en plan ; cintrage hélicoïdal (plan + pente) à valider chez le cintreur (C §2.3).`
          : `${label} < ${fmt(cap.radius, 0)} mm (rayon minimal ${s.family} ${dirLabel}) : limon de jour en profilé **exclu** (limon débillardé en plat, jalon 5).`,
      });
    }
    errors.push(
      `Tournant ${j + 1} : jour en arc — limon de jour cintré en ${s.name} non généré (${bendFindings[bendFindings.length - 1]!.status === "ok" ? "cintrage hélicoïdal à valider, jalon 5" : "rayon de cintrage insuffisant ou inconnu"}) ; limons de jour des volées ${j + 1} et ${j + 2} absents.`,
    );
  });

  // 7. Limons.
  const stringers: ProfileStringer[] = [];
  const beams: PrecheckedBeam[] = [];
  const heightFindings: { value: Mm; label: string; partId: string }[] = [];
  const bearingItems: { value: Mm; label: string; partId?: string }[] = [];
  const supportMargins: { value: Mm; label: string; partId: string }[] = [];
  let buttWeldTotal = 0;
  const shift = s.shape === "I" ? (s.b - s.tw) / 2 : 0;
  const tfBand = s.shape === "I" ? s.tf : 0;
  for (const p of pres) {
    const f = p.face;
    const mine = mineOf.get(f.id) ?? [];
    const alpha = Math.atan(p.line.slope);
    const c = Math.cos(alpha);
    const sn = Math.sin(alpha);
    const Hv = s.h / c;
    const upper = (u: Mm): Mm => top(p, u);
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
      notes.push(`${f.mark} : limon entièrement sous le sol, non généré.`);
      continue;
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
          ...(i === 0 ? { label: `Support ${sp.treadMark}` } : {}),
        }),
      );
      for (const u of [sp.u0, sp.u1]) {
        supportMargins.push({
          value: Math.min(zb - (lower(u) + tfBand), upper(u) - tfBand - sp.zTop),
          label: `${sp.treadMark} sur ${f.mark}`,
          partId: f.id,
        });
      }
    }
    // Coupes d'extrémité (libellés sur le développé).
    const endLabel = (which: "start" | "end"): string => {
      const kind = which === "start" ? f.start : f.end;
      const aDeg = fmt((alpha * 180) / Math.PI, 1);
      switch (kind) {
        case "floor":
          return `Départ : coupe de niveau (sol) et coupe d'aplomb (${aDeg}° sur l'axe)`;
        case "arrival":
          return `Arrivée : coupe d'aplomb (${aDeg}° sur l'axe)`;
        case "newel":
          return `Coupe d'aplomb contre le poteau (${aDeg}° sur l'axe), soudée`;
        case "corner":
          return `Angle mural : coupe d'onglet 45° en plan, d'aplomb (${aDeg}° sur l'axe)${which === "start" ? ", soudée" : ""}`;
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
      label: f.mark,
    });
    const flat: FlatPattern = {
      outline: { outer: barPts, holes },
      lines,
      thickness: s.tw,
      reference: {
        kind: "face",
        description: `Âme dépliée du ${f.side === "inner" ? "limon de jour" : "limon mural"} ${s.name}, vue depuis les marches ; x le long de l'axe de la barre (${mirrored ? "la montée va vers les x décroissants" : "la montée va vers les x croissants"}), y perpendiculaire à l'axe (0 = rive basse, ${fmt(s.h, 0)} = rive haute), mm, 1:1.`,
      },
    };
    // Débit : onglet d'angle mural (+ b en plan de chaque côté concerné, depuis la face côté
    // marches ; le développé en porte déjà `shift`).
    const miterEnds = (f.start === "corner" ? 1 : 0) + (f.end === "corner" ? 1 : 0);
    const cutLength = barLength + (miterEnds * (s.b - shift)) / c;
    const maxBar = Math.max(...metal.barLengths);
    const splices = cutLength > maxBar + 1e-9 ? Math.ceil(cutLength / maxBar) - 1 : 0;
    const buttWeld = params.splice === "welded" ? splices * sectionPerimeter(s) : 0;
    buttWeldTotal += buttWeld;
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
      name: `${f.side === "inner" ? "Limon de jour" : "Limon mural"} ${s.name}, volée ${f.leg + 1}`,
      material,
      solid: {
        kind: "extrusion",
        frame: { origin: o3, xAxis: into3, yAxis: up3, zAxis: cross },
        profile: { outer: sectionPts, holes: [] },
        depth: barLength,
      },
      flat,
      section: `${s.name} (${grade})`,
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
    const beam = analyze(p, s);
    beams.push({ partId: f.id, label: `${f.mark}, ${s.name} ${grade}`, result: beam });
    heightFindings.push({
      value: s.h - needOfPre(p, s),
      label: f.mark,
      partId: f.id,
    });
    if (s.shape === "I") {
      for (const sp of mine) {
        bearingItems.push({
          value: sup.angleLeg - shift,
          label: `${sp.treadMark} sur ${f.mark}`,
          partId: f.id,
        });
      }
    }
    stringers.push({
      face: f,
      part,
      line: p.line,
      uLo: p.uLo,
      uHi: p.uHi,
      outline,
      supports: mine,
      precheck: beam,
      cutLength,
    });
    if (splices > 0) {
      notes.push(
        `${f.mark} : longueur de débit ${fmt(cutLength, 0)} mm > barre de ${fmt(maxBar, 0)} mm, ${splices} aboutage(s) ${params.splice === "welded" ? "soudé(s) bout à bout (EXC2)" : "éclissé(s)"}.`,
      );
    }
  }

  // Raccords d'onglet aux angles muraux.
  const miterItems: { value: Mm; label: string; partId: string }[] = [];
  for (const a of stringers) {
    if (a.face.end !== "corner") continue;
    const b = stringers.find((x) => x.face.side === "outer" && x.face.leg === a.face.leg + 1);
    if (!b || b.face.start !== "corner") continue;
    const za = a.line.z0 + a.line.slope * (a.face.faceLength - a.line.u0);
    const zb = b.line.z0 + b.line.slope * (0 - b.line.u0);
    miterItems.push({
      value: Math.abs(za - zb),
      label: `${a.face.mark} / ${b.face.mark}`,
      partId: b.face.id,
    });
  }

  // 8. Supports (pièces) : sur les profilés en I, cornière soudée sur l'âme (face décalée).
  const supportParts = placements.map((p) => {
    const onI = p.face.kind === "stringer" && s.shape === "I";
    const face = onI ? { ...p.face, a: V.addScaled(p.face.a, p.face.into, shift) } : p.face;
    return supportPart({ ...p, face }, sup, "S", material, profile);
  });
  const groupKey = (p: Part): string =>
    `${p.section}|${Math.round((p.stock?.length ?? 0) / 0.5)}|${p.quantities["holes"]}`;
  const groupIds = new Map<string, number>();
  const supportMarked = supportParts.map((p) => {
    const k = groupKey(p);
    if (!groupIds.has(k)) groupIds.set(k, groupIds.size + 1);
    return { ...p, mark: `CR${groupIds.get(k)}` };
  });

  // 9. Poteaux (tube carré soudé).
  const posts: Part[] = [];
  const receivedChecks: { value: Mm; label: string; partId: string }[] = [];
  for (const nw of newelList) {
    const g: NewelGeometry = nw.geom;
    const a = g.size;
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
        label: `${x.face.mark} sur ${nw.mark}`,
        partId: x.face.id,
      });
    }
    for (const p of placements.filter((q) => q.face.owner === nw.id)) topZ = Math.max(topZ, p.zTop);
    if (!Number.isFinite(topZ)) {
      notes.push(`${nw.mark} : aucun limon ni support reçu, poteau non généré.`);
      continue;
    }
    const height = topZ + params.newel.topExtension;
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
      name: `Poteau d'angle acier, tournant ${g.turn + 1}`,
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
      section: `tube carré ${fmt(a, 0)} × ${fmt(a, 0)} × ${fmt(tt, 0)}`,
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

  // 10. Débit sur barres.
  const kerf = metal.sawKerf;
  const cutting: Record<string, CuttingPlan> = {};
  const addPlan = (key: string, pieces: CutPiece[]): void => {
    if (pieces.length > 0) cutting[key] = cuttingPlan(pieces, metal.barLengths, kerf);
  };
  addPlan(
    s.name,
    stringers.map((x) => ({ id: x.part.id, mark: x.part.mark, length: x.cutLength })),
  );
  const bySection = new Map<string, CutPiece[]>();
  for (const p of [...supportMarked, ...posts]) {
    const list = bySection.get(p.section ?? p.id) ?? [];
    list.push({ id: p.id, mark: p.mark, length: p.stock?.length ?? 0 });
    bySection.set(p.section ?? p.id, list);
  }
  for (const [k, v] of bySection) addPlan(k, v);
  for (const [k, plan] of Object.entries(cutting)) {
    const byLen = new Map<number, number>();
    for (const b of plan.bars) byLen.set(b.barLength, (byLen.get(b.barLength) ?? 0) + 1);
    const bars = [...byLen.entries()]
      .sort((x, y) => x[0] - y[0])
      .map(([l, n]) => `${n} × ${fmt(l / 1000, 0)} m`)
      .join(" + ");
    notes.push(
      `Débit ${k} : ${bars || "aucune barre"}, utilisation ${fmt(plan.utilization * 100, 0)} % (trait de scie ${fmt(kerf, 0)} mm, à valider)${plan.oversize.length > 0 ? ` ; ${plan.oversize.length} pièce(s) plus longue(s) que la plus grande barre (aboutage)` : ""}.`,
    );
  }

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
  const rule = (r: PluginRuleSpec) => pluginRuleDef(r);
  checks.add(rule(STEEL_RULES.executionClass), [
    {
      status: "ok",
      message: `Classe d'exécution déduite : ${exc.executionClass} (${exc.reasons.length > 0 ? exc.reasons.join(", ") : `${grade}, aucune soudure bout à bout`} ; profilés sur cornières soudées d'angle, famille B → CC1, SC1 supposée).`,
    },
  ]);
  if (bendFindings.length > 0) checks.add(rule(PROFILE_RULES.bending), bendFindings);
  checks.addItems(rule(PROFILE_RULES.sectionHeight), heightFindings, "Réserve de hauteur d'âme", {
    min: -1e-6,
    max: null,
  });
  if (s.shape === "I") {
    checks.addItems(rule(PROFILE_RULES.supportBearing), bearingItems, "Appui au-delà des ailes", {
      min: params.supports.minBearing,
      max: null,
    });
  }
  if (miterItems.length > 0) {
    checks.addItems(rule(PROFILE_RULES.miter), miterItems, "Écart de rive haute à l'onglet", {
      min: null,
      max: params.miterTolerance,
    });
  }
  checks.addItems(
    rule(STEEL_RULES.barLength),
    [
      ...stringers.map((x) => ({ value: x.cutLength, label: x.part.mark, partId: x.part.id })),
      ...[...supportMarked, ...posts].map((p) => ({
        value: p.stock!.length,
        label: p.mark,
        partId: p.id,
      })),
    ],
    "Longueur de barre",
    { min: null, max: Math.max(...metal.barLengths) },
  );
  checks.addItems(rule(STEEL_RULES.supportInStringer), supportMargins, "Marge support / rive", {
    min: -1e-6,
    max: null,
  });
  checks.addItems(rule(STEEL_RULES.supportLength), shortSupports, "Longueur d'appui", {
    min: params.supports.minLength,
    max: null,
  });
  checks.add(
    rule(STEEL_RULES.treadCarried),
    zones.map((z): Finding => {
      const set = carried.get(z.tread.number) ?? new Set<Side>();
      const missing = (["inner", "outer"] as const).filter((sd) => !set.has(sd));
      return missing.length === 0
        ? {
            status: "ok",
            location: { kind: "tread", number: z.tread.number },
            message: `${z.mark} portée des deux côtés.`,
          }
        : {
            status: "violation",
            location: { kind: "tread", number: z.tread.number },
            message: `${z.mark} sans support côté ${missing.map((x) => (x === "inner" ? "jour" : "mur")).join(" et ")}.`,
          };
    }),
  );
  for (const nw of newelList) {
    const items = receivedChecks.filter((r) => r.label.endsWith(nw.mark));
    if (items.length === 0) continue;
    checks.addItems(pluginRuleDef(FAB_RULES.newelReception), items, "Largeur du profilé reçu", {
      min: null,
      max: nw.geom.size / 2,
    });
  }
  const precheck: readonly RuleResult[] = precheckResults(project, stepping, beams);
  const precheckNote = `Prédimensionnement indicatif (ne remplace pas une note de calcul) : q_k ${fmt(loads.qk, 1)} kN/m², Q_k ${fmt(loads.Qk, 1)} kN (${loads.source}) ; permanentes ${fmt(permanentArea, 2)} kN/m² ; déversement et torsion (charge excentrée sur l'âme d'un U) non vérifiés.`;

  notes.push(
    `Limons en profilés ${s.name} (${grade}), âme verticale, ${s.shape === "U" ? "ailes vers l'extérieur" : "bouts d'ailes côté marches"} ; d_h = ${fmt(params.upperOffset, 0)} mm ; cornières L ${fmt(sup.angleLeg, 0)} × ${fmt(sup.angleLeg, 0)} × ${fmt(sup.angleThickness, 0)} ${effectiveFixing(sup) === "welded" ? "soudées" : "vissées"} ; valeurs par défaut à valider.`,
    precheckNote,
    `Classe d'exécution EN 1090-2 : ${exc.executionClass}${exc.reasons.length > 0 ? ` (${exc.reasons.join(", ")})` : ""}.`,
    "Limons en profilés : solides 3D à extrémités d'équerre (coupes réelles sur les développés) ; platines de pied et de tête non générées (fixation à définir).",
  );

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
    },
    section: s,
    requiredHeight,
    stringers,
    posts,
    supports: placements.map((placement, i) => ({ placement, part: supportMarked[i]! })),
    cutting,
    executionClass: exc.executionClass,
  };
}

export const STEEL_PROFILE: StructureKind<SteelProfileParams> = {
  kind: "steel-profile",
  label: "Limons acier en profilés du commerce (UPN, IPN, IPE, HEA), marches bois",
  family: "metal",
  paramsSchema: SteelProfileParamsSchema,
  defaults: () => SteelProfileParamsSchema.parse({}),
  build: (ctx, params) => buildSteelProfile(ctx, params).output,
};
