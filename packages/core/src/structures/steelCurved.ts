/**
 * Plugin `steel-curved` : limon porteur débillardé soudé métal (jalon 5b ; B §5, C §2.1,
 * §2.4 ; CHALLENGE G6, G7 ; critère d'acceptation n° 2).
 *
 * - **Limon de jour** : une tôle **continue** le long de C_i (face côté marches sur le bord du
 *   jour, épaisseur vers le jour : hors emprise utile, CHALLENGE A3), du départ à l'arrivée ;
 *   précondition (G7) : **jour en arc à chaque tournant** (sinon erreur explicite : débillardé ⇒
 *   jour courbe) et rayon intérieur de roulage r_j − e ≥ rayon mini de la rouleuse du profil
 *   d'atelier (sinon erreur explicite, limon de jour non généré).
 * - **Rives** (B §5.1) : z_h(σ) = F(σ) + d_h, z_b(σ) = F(σ) − d_b, F = courbe des nez du
 *   balancement (M3, variante **quintique** par défaut pour un débillardé, décision Q7 :
 *   `stepping` choisit `quintic` quand `structure.kind = "steel-curved"` et `variant = "auto"`),
 *   reconstituée zone par zone (`steelCurvedGeometry.ts`), échantillonnée au pas Δσ ; coupes de
 *   niveau au sol (platine de pied) et à l'arrivée, coupes d'aplomb aux extrémités (mêmes
 *   conventions que `steel-flat`, `development.ts`).
 * - **Développé** (B §5.5) : face cylindrique développable déroulée à la **fibre neutre**
 *   (fibre de référence déclarée `neutral-fiber`, référence du roulage) : x = σ sur les droites,
 *   (r_j − e/2)·θ sur les arcs (forme fermée par morceaux), y = z.
 * - **Tronçons** (G7, règles simples) : une coupe à chaque naissance (tangence droite / arc),
 *   décalée de δ dans la partie droite, et repoussée hors des zones de support de marche ; si un
 *   tronçon ne tient dans aucun format de tôle, coupe au milieu de l'arc (sinon de la partie
 *   droite), hors des supports. Joints = **soudures bout à bout** ⇒ EXC2 (C §2.1). Chaque
 *   tronçon est une pièce avec son développé : contour, lignes de roulage (génératrices, rayon
 *   intérieur et rayon de fibre neutre), naissances, traits de joint, reports des nez, supports
 *   et perçages, repère.
 * - **Limons muraux, marches, supports muraux, platines** : plugin `steel-flat` (plat droit par
 *   volée), réutilisé tel quel.
 * - **Supports côté jour** : cornières (ou plats) droites **tangentes** au limon au milieu de la
 *   portée de la marche ; sur un arc, l'écart aux extrémités (flèche c²/8r) est mesuré et
 *   signalé.
 * - **Contrôles** : jour courbe, rayon et épaisseur de roulage, longueur des rouleaux, format de
 *   tôle, épaisseur laser, largeur perpendiculaire mini (face côté jour, la plus pentue),
 *   cassure de pente résiduelle aux naissances (mesurée sur chaque fibre et affichée, B §5.3),
 *   joints hors supports, marches portées, classe d'exécution.
 *
 * Valeurs par défaut non sourcées : paramètres « à valider » (LEDGER §2).
 */
import {
  dec,
  errorMessage,
  msg,
  textMessage,
  type Message,
  type MessageKey,
  type MessageParam,
} from "@blondel/i18n";
import { z } from "zod";
import { cumulativeLengths } from "../geom2d/curve.js";
import { projectOnCurve } from "../geom2d/intersect.js";
import { pointInPolygon, signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { FlatPattern, NosingLine, Part, Tread } from "../model/derived.js";
import type { Mm, Polygon2, Vec2, Vec3 } from "../model/primitives.js";
import type {
  PartAssembly,
  StructureContext,
  StructureKind,
  StructureOutput,
} from "../model/plugins.js";
import { buildBasicParts } from "../parts/basic.js";
import { WORKSHOP_DEFAULT_SOURCE, sourceSpec } from "../rules/sources.js";
import type { Finding } from "../rules/types.js";
import { findBendLaw } from "../workshop/metal.js";
import { resolveWorkshopProfile, type WorkshopProfile } from "../workshop/profile.js";
import {
  CheckCollector,
  FAB_RULES,
  flightsOnlyError,
  pluginRuleDef,
  type CheckItem,
  type PluginRuleSpec,
} from "./checks.js";
import { commonAutoValue } from "./autoValue.js";
import { developStringer, type StringerDevelopment } from "./development.js";
import { insetPlate, type PlanLine } from "./folded.js";
import { PiecewiseLinear, clipHalfPlane, dedupe, minAreaRect, removeCollinear } from "./geom.js";
import type { OrientedBox } from "./geom.js";
import { readPlanExtrusion } from "./housing.js";
import {
  QUANTITY_BUTT_WELD_MM,
  QUANTITY_WELD_MM,
  STEEL_RULES,
  assembledTo,
  deduceExecutionClass,
  executionClassReasons,
  holePolygon,
  joinMessages,
  plateMeasures,
  steelMaterial,
  steelQuantities,
  IDENTICAL_TOLERANCE,
} from "./steelCommon.js";
import {
  SteelFlatParamsSchema,
  ascentDirection,
  buildSteelFlat,
  endPlateFrame,
  markGroups,
  plateHoles,
  plateObject,
  rectFlat,
  sheetFormatMessage,
  supportOn,
  treadNotCarried,
  type SteelFlatResult,
} from "./steelFlat.js";
import {
  fiberDevelopment,
  jourNormal,
  naissances,
  nosingProfile,
  pointAtExtended,
  slopeBreakAt,
  tangentAtExtended,
  type FiberDevelopment,
  type JourSide,
  type Naissance,
  type NosingProfile,
  type SlopeBreak,
} from "./steelCurvedGeometry.js";
import {
  boltCenters,
  supportAssemblies,
  supportDepth,
  supportPart,
  type SupportFace,
  type SupportPlacement,
} from "./supports.js";
import type { StringerFace } from "./woodHoused.js";

const mmInt = z.number().int();
const mmPos = mmInt.positive();
const mmNonNeg = mmInt.nonnegative();

/** Longueur roulée (génératrices sur arc, fibre neutre) d'un tronçon, mm (nomenclature). */
export const QUANTITY_ROLLED_LENGTH_MM = "rolled_length_mm";

export const SteelCurvedParamsSchema = SteelFlatParamsSchema.extend({
  curved: z
    .object({
      /**
       * Décalage δ de la coupe par rapport à la naissance, dans la partie droite (B §5.4 : δ ≥
       * longueur d'about ; C §2.4 : joint hors des consoles, à courbure constante de part et
       * d'autre ; valeur **à valider**).
       */
      jointOffset: mmNonNeg.default(100),
      /** Marge entre un joint et l'extrémité d'un support de marche (à valider). */
      jointSupportMargin: mmNonNeg.default(20),
      /** Longueur minimale d'un tronçon (développé), sinon pas de coupe (à valider). */
      minSegmentLength: mmPos.default(200),
      /** Pas d'échantillonnage des rives Δσ, mm (B §5.2 : « ex. 5 mm »). */
      sampleStep: z.number().positive().default(5),
      /** Espacement des lignes de roulage tracées sur le développé (à valider). */
      rollLineSpacing: mmPos.default(50),
      /** Largeur perpendiculaire mini du limon (CHALLENGE G6, à valider). */
      minPerpendicularWidth: mmPos.default(150),
      /**
       * Cassure de pente résiduelle maximale aux naissances (degrés, B §5.3) ; absent : mesurée
       * et affichée sans seuil (aucune valeur sourcée).
       */
      maxSlopeBreak: z.number().positive().optional(),
    })
    .prefault({}),
});
export type SteelCurvedParams = z.output<typeof SteelCurvedParamsSchema>;

/** Source des contrôles réglés par le profil d'atelier (valeurs par défaut « à valider »). */
const WORKSHOP_SOURCE = sourceSpec(WORKSHOP_DEFAULT_SOURCE);

export const CURVED_RULES = {
  jour: {
    id: "FAB_DEBILLARDE_JOUR",
    ...sourceSpec(msg("compliance.source.curvedWell")),
    confidence: "eleve",
    nature: "metier",
    severity: "bloquant",
    unit: null,
  },
  rollingRadius: {
    id: "FAB_ROULAGE_RAYON_MIN",
    ...sourceSpec(msg("compliance.source.rollingRadius", { workshop: WORKSHOP_DEFAULT_SOURCE })),
    confidence: "faible",
    nature: "metier",
    severity: "bloquant",
    unit: "mm",
  },
  rollingThickness: {
    id: "FAB_ROULAGE_EPAISSEUR",
    ...WORKSHOP_SOURCE,
    confidence: "faible",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
  rollLength: {
    id: "FAB_ROULAGE_LONGUEUR_ROULEAUX",
    ...sourceSpec(msg("compliance.source.rollLength", { workshop: WORKSHOP_DEFAULT_SOURCE })),
    confidence: "faible",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
  slopeBreak: {
    id: "FAB_DEBILLARDE_CASSURE_PENTE",
    ...sourceSpec(msg("compliance.source.slopeBreak")),
    confidence: "moyen",
    nature: "metier",
    severity: "conseil",
    unit: "°",
  },
  jointPlacement: {
    id: "FAB_DEBILLARDE_JOINT",
    ...sourceSpec(msg("compliance.source.curvedJoint")),
    confidence: "faible",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
} as const satisfies Record<string, PluginRuleSpec>;

// ------------------------------------------------------------------ Types du résultat

/** Support de marche sur le limon débillardé (portée en σ sur C_i). */
export interface CurvedSupport {
  readonly placement: SupportPlacement;
  readonly sigma0: Mm;
  readonly sigma1: Mm;
  /** Écart maximal entre la cornière droite (tangente) et la joue courbe (mm). */
  readonly gap: Mm;
  readonly part: Part;
}

export interface CurvedJoint {
  /** Abscisse du joint sur C_i (face côté marches) et sur la fibre neutre. */
  readonly sigma: Mm;
  readonly neutral: Mm;
  readonly reason: "naissance" | "format";
  /** Longueur du cordon bout à bout (hauteur de la coupe d'aplomb), mm. */
  readonly weld: Mm;
  /** Distance au support de marche le plus proche (mm, ∞ sans support). */
  readonly supportClearance: Mm;
  /**
   * Coupe de naissance : abscisse de la naissance et décalage effectif |σ − σ_n| (mm). Un
   * décalage < δ (partie droite encombrée : repli vers la naissance ou sur l'arc) est signalé.
   */
  readonly naissance?: Mm;
  readonly naissanceOffset?: Mm;
  /** Coupe placée sur l'arc (repli). */
  readonly onArc?: boolean;
}

export interface CurvedArcZone {
  readonly faceRadius: Mm;
  readonly innerRadius: Mm;
  readonly neutralRadius: Mm;
  /** Portée sur C_i et sur la fibre neutre. */
  readonly sigma0: Mm;
  readonly sigma1: Mm;
  readonly neutral0: Mm;
  readonly neutral1: Mm;
  /** Étendue du développé le long des génératrices roulées (mm). */
  readonly generatrixExtent: Mm;
}

export interface CurvedSegment {
  readonly index: number;
  readonly sigma0: Mm;
  readonly sigma1: Mm;
  readonly neutral0: Mm;
  readonly neutral1: Mm;
  /** Contour du tronçon en (x = σ fibre neutre, y = z), avant mise à plat du développé. */
  readonly outline: Polygon2;
  readonly box: OrientedBox;
  readonly fits: boolean;
  readonly arcs: readonly CurvedArcZone[];
  readonly part: Part;
}

export interface CurvedStringerResult {
  readonly jour: JourSide;
  readonly thickness: Mm;
  readonly profile: NosingProfile;
  /** Développement (face côté marches, u = σ) et fibres. */
  readonly development: StringerDevelopment;
  readonly neutral: FiberDevelopment;
  readonly jourFace: FiberDevelopment;
  readonly stepsFace: FiberDevelopment;
  readonly naissances: readonly Naissance[];
  readonly slopeBreaks: readonly { readonly sigma: Mm; readonly fibers: readonly SlopeBreak[] }[];
  /**
   * Cassures de la courbe des nez F elle-même (donc des rives z = F ± d) aux nez : F n'est que C0
   * aux bornes d'une zone balancée à extrémité libre et aux nez hors zone (droite par morceaux),
   * B §5.3 ; mesurées sur les trois fibres, nez sans cassure (< 0,01°) omis.
   */
  readonly nosingKinks: readonly {
    readonly sigma: Mm;
    readonly nosing: number;
    readonly fibers: readonly SlopeBreak[];
  }[];
  readonly joints: readonly CurvedJoint[];
  readonly segments: readonly CurvedSegment[];
  readonly supports: readonly CurvedSupport[];
  readonly plates: readonly Part[];
  readonly lowerOffset: Mm;
  /** Largeur perpendiculaire minimale (face côté jour), mm. */
  readonly minPerpendicularWidth: Mm;
  readonly buttWeld: Mm;
}

export interface SteelCurvedResult {
  readonly output: StructureOutput;
  readonly flat: SteelFlatResult;
  readonly curved: CurvedStringerResult | null;
  readonly executionClass: "EXC1" | "EXC2";
}

// ------------------------------------------------------------------ Outils

const ceil5 = (x: Mm): Mm => Math.ceil(x / 5 - 1e-9) * 5;

/**
 * Tolérance de position des joints par rapport aux zones interdites (mm) : absorbe le bruit
 * numérique des bornes de supports (dichotomie, tests d'appartenance au polygone).
 */
const JOINT_TOLERANCE = 1e-3;

/** Altitude d'une polyligne (x croissants) en x, bornée aux extrémités. */
function polyAt(line: readonly Vec2[], x: Mm): Mm {
  if (line.length === 0) return Number.NaN;
  if (x <= line[0]!.x) return line[0]!.y;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    if (x <= b.x + 1e-9) {
      return b.x - a.x > 1e-9 ? a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) : Math.max(a.y, b.y);
    }
  }
  return line[line.length - 1]!.y;
}

/**
 * Change l'abscisse d'une polyligne ou d'un polygone (x ↦ toX(x)) en insérant un sommet à
 * chaque abscisse de rupture `breaks` traversée (l'application est affine par morceaux).
 */
function remapX(
  pts: readonly Vec2[],
  toX: (x: Mm) => Mm,
  breaks: readonly Mm[],
  closed: boolean,
): Vec2[] {
  const out: Vec2[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    out.push(V.vec(toX(a.x), a.y));
    if (!closed && i === n - 1) break;
    const b = pts[(i + 1) % n]!;
    const inside = breaks.filter(
      (x) => x > Math.min(a.x, b.x) + 1e-9 && x < Math.max(a.x, b.x) - 1e-9,
    );
    inside.sort((p, q) => (b.x > a.x ? p - q : q - p));
    for (const x of inside) {
      const t = (x - a.x) / (b.x - a.x);
      out.push(V.vec(toX(x), a.y + t * (b.y - a.y)));
    }
  }
  return dedupe(out);
}

function lineOf(k: NosingLine): PlanLine {
  return { p: k.p, dir: k.dir };
}

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
  /** Recherche du support : décalage du point d'essai depuis C_i vers les marches. */
  readonly probe: Mm;
}

/**
 * Zones d'appui des marches (mêmes retraits que `steel-flat` : marche bois = pièce de base,
 * tôle pliée = dessus inséré du jeu latéral).
 */
function treadZones(
  ctx: StructureContext,
  params: SteelCurvedParams,
  flat: SteelFlatResult,
): TreadZone[] {
  const { project, stepping } = ctx;
  const nosings = stepping.nosings;
  const baseParts = ctx.baseParts ?? buildBasicParts(project, ctx.layout, stepping).parts;
  const baseById = new Map(baseParts.map((p) => [p.id, p]));
  const metal = resolveWorkshopProfile(project.workshop).metal;
  const ft = params.folded;
  const m = params.supports.endMargin;
  const out: TreadZone[] = [];
  for (const tread of stepping.treads) {
    const a = nosings[tread.number - 1];
    const b = nosings[tread.number];
    const base = baseById.get(`tread-${tread.number}`);
    if (!a || !b || !base) continue;
    const upA = upOf(a, tread.walkingSurface, 1);
    const upB = upOf(b, tread.walkingSurface, -1);
    const folded = flat.treads.find((d) => d.number === tread.number);
    if (folded) {
      const t = ft.thickness;
      const r = findBendLaw(metal, params.grade, t)?.innerRadius ?? t;
      const plate = insetPlate(tread.walkingSurface, [lineOf(a), lineOf(b)], ft.clearance);
      if (plate) {
        const front = t + r + m;
        const rearLimit = ft.profile === "Z" ? -(ft.returnLength + m) : -(t + r + m);
        let zone: Polygon2 = clipHalfPlane(plate, V.addScaled(a.p, upA, front), upA);
        zone = clipHalfPlane(zone, V.addScaled(b.p, upB, rearLimit), V.scale(upB, -1));
        out.push({
          tread,
          mark: base.mark,
          zone: dedupe(zone),
          zUnder: tread.z - t,
          probe: ft.clearance + 0.5,
        });
        continue;
      }
    }
    const ex = readPlanExtrusion(base.solid);
    if (!ex) continue;
    const spec = project.stair.treads;
    const front = spec.nosing + (spec.risers === "full" ? spec.riserThickness : 0) + m;
    let zone: Polygon2 = clipHalfPlane(ex.outline, V.addScaled(a.p, upA, front), upA);
    zone = clipHalfPlane(zone, V.addScaled(b.p, upB, spec.nosing - m), V.scale(upB, -1));
    out.push({ tread, mark: base.mark, zone: dedupe(zone), zUnder: ex.zBottom, probe: 0.5 });
  }
  return out;
}

/** Plus petit intervalle [σ0 ; σ1] où C_i (décalée de `probe` vers les marches) longe la zone. */
function curveInterval(
  inside: (sigma: Mm) => boolean,
  lo: Mm,
  hi: Mm,
  step: Mm,
): { s0: Mm; s1: Mm } | null {
  let first = Number.NaN;
  let last = Number.NaN;
  for (let s = lo; s <= hi + 1e-9; s += step) {
    if (inside(s)) {
      if (Number.isNaN(first)) first = s;
      last = s;
    }
  }
  if (Number.isNaN(first)) return null;
  const refine = (ok: Mm, ko: Mm): Mm => {
    let a = ok;
    let b = ko;
    for (let i = 0; i < 30; i++) {
      const mid = (a + b) / 2;
      if (inside(mid)) a = mid;
      else b = mid;
    }
    return a;
  };
  return {
    s0: first - step >= lo ? refine(first, first - step) : first,
    s1: last + step <= hi ? refine(last, last + step) : last,
  };
}

// ------------------------------------------------------------------ Construction

/** Construction complète (détails compris). */
/**
 * Valeur retenue de `lowerOffset` laissé en `auto` (`StructureOutput.autoValues`) : d_b est
 * résolu par limon (limons droits de `steel-flat`, limon débillardé) ; la valeur n'est exposée
 * que si tous les limons générés ont la même (`commonAutoValue`).
 */
function curvedAutoValues(
  params: SteelCurvedParams,
  flat: SteelFlatResult,
  curved: CurvedStringerResult | null,
): Record<string, number> | undefined {
  if (params.lowerOffset !== "auto") return undefined;
  const value = commonAutoValue([
    ...flat.stringers.map((s) => flat.lowerOffset[s.face.side]),
    ...(curved ? [curved.lowerOffset] : []),
  ]);
  return value === undefined ? undefined : { lowerOffset: value };
}

export function buildSteelCurved(
  ctx: StructureContext,
  params: SteelCurvedParams,
): SteelCurvedResult {
  const { project, layout, stepping } = ctx;
  const profile = resolveWorkshopProfile(project.workshop);
  const metal = profile.metal;
  const e = params.thickness;
  const sup = params.supports;
  const turns = project.stair.layout.turns;
  const helical = flightsOnlyError("steel-curved", msg("structure.steelCurved.shortLabel"), layout);
  const flat = buildSteelFlat(ctx, params);
  if (helical) {
    return {
      output: { parts: [], checks: [], notes: [], errors: [helical] },
      flat,
      curved: null,
      executionClass: "EXC1",
    };
  }
  const errors: Message[] = [
    ...(flat.output.errors ?? []).filter((x) => x.key !== "structure.steel.error.arcWell"),
  ];
  // Classe d'exécution : recalculée ici (joints du débillardé), celle de `steel-flat` est retirée.
  const notes: Message[] = flat.output.notes.filter((x) => x.key !== "structure.steel.exc.note");
  const checks = new CheckCollector(project, stepping);
  const rule = (spec: PluginRuleSpec) => pluginRuleDef(spec);

  // 1. Préconditions (G7) : jour courbe, rayon de roulage.
  const jourFindings: Finding[] = [];
  let curvedOk = stepping.nosings.length >= 2;
  if (turns.length === 0) {
    curvedOk = false;
    errors.push(msg("structure.steelCurved.error.noTurn"));
    jourFindings.push({
      status: "violation",
      message: msg("structure.steelCurved.check.noTurn"),
    });
  }
  turns.forEach((t, j) => {
    if (t.inner.kind !== "arc") {
      curvedOk = false;
      const what = msg(
        t.inner.kind === "sharp"
          ? "structure.steelCurved.well.sharp"
          : "structure.steelCurved.well.newel",
      );
      errors.push(msg("structure.steelCurved.error.wellNotArc", { turn: j + 1, well: what }));
      jourFindings.push({
        status: "violation",
        message: msg("structure.steelCurved.check.wellNotArc", { turn: j + 1, well: what }),
      });
    } else {
      jourFindings.push({
        status: "ok",
        measured: t.inner.radius,
        message: msg("structure.steelCurved.check.arcWell", {
          turn: j + 1,
          radius: dec(t.inner.radius, 0),
        }),
      });
    }
  });
  checks.add(rule(CURVED_RULES.jour), jourFindings);
  const rolling = metal.plateRolling;
  const radiusItems: { value: Mm; label: Message }[] = [];
  turns.forEach((t, j) => {
    if (t.inner.kind !== "arc") return;
    const inner = t.inner.radius - e;
    radiusItems.push({
      value: inner,
      label: msg("structure.steelCurved.check.rollingRadiusItem", {
        turn: j + 1,
        radius: dec(t.inner.radius, 0),
        thickness: dec(e, 0),
      }),
    });
    if (inner < rolling.minInnerRadius - 1e-9) {
      curvedOk = false;
      errors.push(
        msg("structure.steelCurved.error.rollingRadius", {
          turn: j + 1,
          inner: dec(inner, 0),
          min: dec(rolling.minInnerRadius, 0),
        }),
      );
    }
  });
  checks.addItems(
    rule(CURVED_RULES.rollingRadius),
    radiusItems,
    msg("structure.steelCurved.quantity.rollingInnerRadius"),
    { min: rolling.minInnerRadius - 1e-9, max: null },
  );
  checks.addItems(
    rule(CURVED_RULES.rollingThickness),
    radiusItems.length > 0
      ? [{ value: e, label: msg("structure.steelCurved.check.wreathedPlate") }]
      : [],
    msg("structure.steelCurved.quantity.rolledThickness"),
    { min: null, max: rolling.maxThickness },
  );

  let curved: CurvedStringerResult | null = null;
  let innerSupports: CurvedSupport[] = [];
  const zones = treadZones(ctx, params, flat);
  if (curvedOk) {
    try {
      curved = buildCurvedStringer(ctx, params, zones, checks, notes, errors);
      innerSupports = [...curved.supports];
    } catch (err) {
      errors.push(msg("structure.steelCurved.error.notGenerated", { detail: errorMessage(err) }));
      curved = null;
    }
  }

  // 2. Repères : supports et platines regroupés avec ceux de `steel-flat`.
  const flatSupportIds = new Set(flat.supports.map((s) => s.part.id));
  const flatPlateIds = new Set(flat.plates.map((p) => p.id));
  const allSupports = markGroups(
    [...flat.supports.map((s) => s.part), ...innerSupports.map((s) => s.part)],
    sup.kind === "angle" ? "CR" : "PS",
    (p) =>
      `${JSON.stringify(p.section)}|${Math.round((p.stock?.length ?? 0) / IDENTICAL_TOLERANCE)}|${p.quantities["holes"]}`,
  );
  const plates = [...flat.plates, ...(curved?.plates ?? [])];
  const byPrefix = (prefix: string, mark: string): Part[] =>
    markGroups(
      plates.filter((p) => p.id.startsWith(prefix)),
      mark,
      () => null,
    );
  const allPlates = [
    ...byPrefix("plate-foot-", "PF"),
    ...byPrefix("plate-head-", "PH"),
    ...byPrefix("plate-post-", "PP"),
    ...byPrefix("plate-end-", "PA"),
  ];

  // 3. Marches portées (jour : supports du limon débillardé).
  const carried = new Map<number, Set<"inner" | "outer">>();
  const carry = (tread: number, side: "inner" | "outer"): void => {
    const set = carried.get(tread) ?? new Set();
    set.add(side);
    carried.set(tread, set);
  };
  for (const s of flat.supports) carry(s.placement.tread, s.placement.face.side);
  for (const s of innerSupports) carry(s.placement.tread, "inner");
  checks.add(
    rule(STEEL_RULES.treadCarried),
    zones.map((zn): Finding => {
      const set = carried.get(zn.tread.number) ?? new Set();
      const missing = (["inner", "outer"] as const).filter((sd) => !set.has(sd));
      return missing.length === 0
        ? {
            status: "ok",
            location: { kind: "tread", number: zn.tread.number },
            message: msg("structure.steel.check.treadCarried", { mark: zn.mark }),
          }
        : {
            status: "violation",
            location: { kind: "tread", number: zn.tread.number },
            message: treadNotCarried(zn.mark, missing),
          };
    }),
  );

  // 4. Classe d'exécution (joints bout à bout du débillardé).
  const flatButt = flat.stringers.reduce(
    (s, x) => s + (x.part.quantities[QUANTITY_BUTT_WELD_MM] ?? 0),
    0,
  );
  const weldedParts = [
    ...flat.output.parts,
    ...(curved?.segments.map((x) => x.part) ?? []),
    ...innerSupports.map((x) => x.part),
    ...(curved?.plates ?? []),
  ];
  const exc = deduceExecutionClass({
    grade: params.grade,
    buttWeld: flatButt + (curved?.buttWeld ?? 0),
    welded: weldedParts.some((x) => (x.quantities[QUANTITY_WELD_MM] ?? 0) > 0),
  });
  checks.add(rule(STEEL_RULES.executionClass), [
    {
      status: "ok",
      message: msg("structure.steel.exc.check", {
        executionClass: exc.executionClass,
        reasons: executionClassReasons(exc, params.grade),
      }),
    },
  ]);
  notes.push(
    msg("structure.steel.exc.note", {
      executionClass: exc.executionClass,
      reasons: executionClassReasons(exc, params.grade),
    }),
  );

  const flatChecks = flat.output.checks.filter(
    (c) => c.ruleId !== STEEL_RULES.executionClass.id && c.ruleId !== STEEL_RULES.treadCarried.id,
  );
  const otherParts = flat.output.parts.filter(
    (p) => !flatSupportIds.has(p.id) && !flatPlateIds.has(p.id),
  );
  const parts = [
    ...otherParts,
    ...(curved?.segments.map((s) => s.part) ?? []),
    ...allSupports,
    ...allPlates,
  ];
  // Assemblages : supports (marche portée, limon ou poteau porteur), tronçons consécutifs du
  // limon débillardé (joints soudés bout à bout).
  const segmentIds = curved?.segments.map((s) => s.part.id) ?? [];
  const assemblies: PartAssembly[] = [
    ...supportAssemblies(flat.supports),
    ...supportAssemblies(innerSupports),
    ...segmentIds.slice(1).map((id, i) => ({ a: { partId: segmentIds[i]! }, b: { partId: id } })),
  ];
  const autoValues = curvedAutoValues(params, flat, curved);
  return {
    output: {
      parts,
      checks: [...flatChecks, ...checks.results],
      executionClass: exc.executionClass,
      notes,
      ...(errors.length > 0 ? { errors } : {}),
      ...(flat.output.removedBaseParts ? { removedBaseParts: flat.output.removedBaseParts } : {}),
      ...(autoValues ? { autoValues } : {}),
      ...(assemblies.length > 0 ? { assemblies } : {}),
    },
    flat,
    curved: curved
      ? {
          ...curved,
          supports: curved.supports.map((s) => ({
            ...s,
            part: allSupports.find((p) => p.id === s.part.id) ?? s.part,
          })),
        }
      : null,
    executionClass: exc.executionClass,
  };
}

/** Limon de jour débillardé : développement, tronçons, supports, platines, contrôles. */
function buildCurvedStringer(
  ctx: StructureContext,
  params: SteelCurvedParams,
  zones: readonly TreadZone[],
  checks: CheckCollector,
  notes: Message[],
  errors: Message[],
): CurvedStringerResult {
  const { project, layout, stepping } = ctx;
  const profile = resolveWorkshopProfile(project.workshop);
  const metal = profile.metal;
  const e = params.thickness;
  const cp = params.curved;
  const sup = params.supports;
  const material = steelMaterial(params.finish);
  const nosings = stepping.nosings;
  const jour: JourSide = layout.innerSide;
  const curve = layout.inner;
  const cum = cumulativeLengths(curve);
  const P = (s: Mm): Vec2 => pointAtExtended(curve, cum, s);
  const T = (s: Mm): Vec2 => tangentAtExtended(curve, cum, s);
  const N = (s: Mm): Vec2 => jourNormal(T(s), jour);

  const stepsFace = fiberDevelopment(curve, 0, jour);
  const neutral = fiberDevelopment(curve, e / 2, jour);
  const jourFace = fiberDevelopment(curve, e, jour);
  const births = naissances(curve);
  const F = nosingProfile(layout, stepping);
  notes.push(...F.notes);

  // Fenêtre du limon (mêmes conventions que `steel-flat`).
  const headPlateT = params.plates.head ? params.plates.thickness : 0;
  const s0 = nosings[0]!.sigmaInner;
  const sN = nosings[nosings.length - 1]!.sigmaInner;
  const uLo = s0 - params.startExtension;
  const uHi = sN + params.endExtension - headPlateT;
  const floorLevel = params.plates.foot ? params.plates.thickness : 0;
  const topCut = nosings[nosings.length - 1]!.z + params.upperOffset;

  // 1. Supports côté jour (cornières tangentes à la joue).
  const depthSup = supportDepth(sup);
  const { raw, shortSupports } = curvedRawSupports(zones, nosings, uLo, uHi, P, N, sup);

  // 2. Rive basse automatique : supports sur la joue à `edgeMargin` de la rive basse.
  const lowerOffset = curvedLowerOffset(raw, F, depthSup, params);

  // 3. Développement (face côté marches, u = σ) : F échantillonnée au pas Δσ.
  // Hors zones balancées, F est affine entre deux nez : seuls les nez, les naissances et les
  // zones (échantillonnées au pas Δσ) portent des nœuds.
  const step = cp.sampleStep;
  const knotSet = new Set<number>([uLo - step, uHi + step]);
  for (const k of nosings) knotSet.add(k.sigmaInner);
  for (const b of births) knotSet.add(b.sigma);
  for (const z of F.zones) {
    for (let s = z.sigmaA; s < z.sigmaB; s += step) knotSet.add(s);
    knotSet.add(z.sigmaB);
  }
  const pitch = new PiecewiseLinear([...knotSet].map((s) => ({ x: s, y: F.at(s) })));
  const solidRows = (a: Mm, b: Mm): Mm[] => curvedSolidRows(pitch, dev, stepsFace, step, a, b);
  const dev = developStringer({
    pitch,
    sigmaA: 0,
    uLo,
    uHi,
    start: "floor",
    end: "arrival",
    upperOffset: params.upperOffset,
    lowerOffset,
    topCut,
    floorLevel,
    housings: [],
  });
  const zLowAt = (s: Mm): Mm => Math.max(polyAt(dev.lowerRive, s), floorLevel);
  const zHighAt = (s: Mm): Mm => polyAt(dev.upperRive, s);

  // 4. Joints : naissances ± δ (dans la partie droite), hors supports ; puis format de tôle.
  const { cuts, outlineN, upperN, lowerN, clipX, fits } = placeCurvedJoints(
    { raw, births, uLo, uHi, cp, neutral, stepsFace, dev, metal },
    notes,
  );
  const intervals = (): { a: Mm; b: Mm }[] => {
    const xs = [uLo, ...cuts.map((c) => c.sigma), uHi];
    return xs.slice(0, -1).map((a, i) => ({ a, b: xs[i + 1]! }));
  };

  // 5. Pièces : tronçons.
  const mirrored = jour === "right";
  const ivs = intervals();
  const segCount = ivs.length;
  const idOf = (i: number): string => `stringer-inner-curved-${i + 1}`;
  const markOf = (i: number): string => `LD${i + 1}`;
  const g: CurvedGeometry = {
    params,
    cp,
    e,
    sup,
    material,
    profile,
    metal,
    nosings,
    layout,
    P,
    T,
    N,
    stepsFace,
    neutral,
    jourFace,
    births,
    F,
    dev,
    zLowAt,
    zHighAt,
    s0,
    sN,
    uLo,
    uHi,
    floorLevel,
    topCut,
    depthSup,
    step,
    lowerOffset,
    outlineN,
    upperN,
    lowerN,
    clipX,
    fits,
    mirrored,
    idOf,
    markOf,
    solidRows,
  };
  const supports = curvedSupportsOf(g, raw, ivs);
  const joints = curvedJointsOf(g, cuts, raw);
  const buttWeld = joints.reduce((s, j) => s + j.weld, 0);
  const segments: CurvedSegment[] = ivs.map((iv, i) =>
    curvedSegment(g, iv, i, segCount, supports, joints),
  );

  // 6. Platines de pied et de tête du limon de jour.
  const plates = curvedPlates(g, segCount);

  // 7. Contrôles.
  const { minPerp, slopeBreaks, nosingKinks } = addCurvedChecks(g, checks, notes, {
    joints,
    segments,
    supports,
    // Appui rapporté au tronçon de la joue qui le porte (localisation « LD2 · M3 »).
    shortSupports: shortSupports.map(({ sigma, ...item }) => {
      const i = ivs.findIndex((iv) => iv.a <= sigma && sigma <= iv.b);
      return i < 0 ? item : { ...item, partId: idOf(i) };
    }),
  });

  // 8. Remarques.
  const maxGap = supports.reduce((m, s) => Math.max(m, s.gap), 0);
  const endText = (x: string): Message =>
    msg(x === "tangent" ? "structure.steelCurved.zone.tangent" : "structure.steelCurved.zone.free");
  const zonesText = joinMessages(
    F.zones.map((zn) =>
      zn.kind === "m3"
        ? msg("structure.steelCurved.zone.m3", {
            from: zn.from,
            to: zn.to,
            variant: msg(
              zn.variant === "quintic"
                ? "structure.steelCurved.zone.quintic"
                : "structure.steelCurved.zone.cubic",
            ),
            ends: zn.ends
              ? msg("structure.steelCurved.zone.ends", {
                  start: endText(zn.ends[0]),
                  end: endText(zn.ends[1]),
                })
              : "",
          })
        : msg("structure.steelCurved.zone.interpolated", { from: zn.from, to: zn.to }),
    ),
  );
  notes.push(
    msg("structure.steelCurved.note.summary", {
      thickness: dec(e, 0),
      grade: params.grade,
      upperOffset: dec(params.upperOffset, 0),
      lowerOffset: dec(lowerOffset, 0),
      zones: zonesText ?? msg("structure.steelCurved.zone.none"),
      segments: msg("structure.steelCurved.count.segments", { count: segCount }),
      joints: msg("structure.steelCurved.count.buttJoints", { count: joints.length }),
      weld: dec(buttWeld, 0),
    }),
  );
  if (maxGap > 0.05) {
    notes.push(msg("structure.steelCurved.note.supportGap", { gap: dec(maxGap, 1) }));
  }
  if (segments.some((s) => !s.fits)) {
    errors.push(
      msg("structure.steelCurved.error.segmentsOutOfFormats", {
        count: segments.filter((s) => !s.fits).length,
      }),
    );
  }
  return {
    jour,
    thickness: e,
    profile: F,
    development: dev,
    neutral,
    jourFace,
    stepsFace,
    naissances: births,
    slopeBreaks,
    nosingKinks,
    joints,
    segments,
    supports,
    plates,
    lowerOffset,
    minPerpendicularWidth: minPerp,
    buttWeld,
  };
}

// ------------------------------------------------------------------ étapes de buildCurvedStringer

/** Longueur d'appui d'un support côté jour, à l'abscisse `sigma` (milieu) sur la joue. */
type CurvedShortSupport = CheckItem & { readonly sigma: Mm };

/** Étape 1 : supports côté jour (cornières tangentes à la joue), portées sur C_i. */
function curvedRawSupports(
  zones: readonly TreadZone[],
  nosings: readonly NosingLine[],
  uLo: Mm,
  uHi: Mm,
  P: (s: Mm) => Vec2,
  N: (s: Mm) => Vec2,
  sup: SteelCurvedParams["supports"],
): { raw: CurvedRawSupport[]; shortSupports: CurvedShortSupport[] } {
  const raw: CurvedRawSupport[] = [];
  const shortSupports: CurvedShortSupport[] = [];
  for (const zn of zones) {
    const a = nosings[zn.tread.number - 1]!;
    const b = nosings[zn.tread.number]!;
    const lo = Math.max(uLo, Math.min(a.sigmaInner, b.sigmaInner) - 150);
    const hi = Math.min(uHi, Math.max(a.sigmaInner, b.sigmaInner) + 150);
    if (!(hi > lo)) continue;
    const inside = (s: Mm): boolean =>
      pointInPolygon(V.addScaled(P(s), N(s), -zn.probe), zn.zone, 1e-6) !== "outside";
    const iv = curveInterval(inside, lo, hi, 5);
    if (!iv) continue;
    const len = iv.s1 - iv.s0;
    shortSupports.push({
      value: len,
      label: msg("structure.steelCurved.check.onOuterString", { mark: zn.mark }),
      treadNumber: zn.tread.number,
      sigma: (iv.s0 + iv.s1) / 2,
    });
    if (len < sup.minLength) continue;
    raw.push({ zone: zn, s0: iv.s0, s1: iv.s1 });
  }
  return { raw, shortSupports };
}

/** Étape 2 : rive basse automatique, supports sur la joue à `edgeMargin` de la rive basse. */
function curvedLowerOffset(
  raw: readonly CurvedRawSupport[],
  F: NosingProfile,
  depthSup: Mm,
  params: SteelCurvedParams,
): Mm {
  const sup = params.supports;
  let need = 0;
  for (const r of raw) {
    for (const s of [r.s0, r.s1, (r.s0 + r.s1) / 2]) {
      need = Math.max(need, F.at(s) - (r.zone.zUnder - depthSup - sup.edgeMargin));
    }
  }
  const lowerOffset =
    params.lowerOffset === "auto" ? ceil5(Math.max(need, params.upperOffset)) : params.lowerOffset;
  return lowerOffset;
}

/**
 * Abscisses d'échantillonnage du solide sur [a ; b] : nœuds de F (`pitch`), sommets du contour
 * développé et arcs (face côté marches) au pas Δσ (`step`).
 */
function curvedSolidRows(
  pitch: PiecewiseLinear,
  dev: StringerDevelopment,
  stepsFace: FiberDevelopment,
  step: Mm,
  a: Mm,
  b: Mm,
): Mm[] {
  const xs = new Set<number>([a, b]);
  // Nœuds presque confondus avec une extrémité (joint) écartés : rangées dégénérées sinon.
  for (const x of pitch.xs) if (x > a + JOINT_TOLERANCE && x < b - JOINT_TOLERANCE) xs.add(x);
  // Sommets du contour développé (u = σ) : coins des coupes de niveau basse (sol, platine) et
  // haute (arrivée), où les rives écrêtées ont un coude qui n'est pas un nœud de F. Sans eux,
  // la surface réglée interpole en ligne droite par-dessus le coin et s'écarte du développé.
  for (const p of dev.outline) {
    if (p.x > a + JOINT_TOLERANCE && p.x < b - JOINT_TOLERANCE) xs.add(p.x);
  }
  for (const p of stepsFace.pieces) {
    if (p.kind !== "arc") continue;
    const lo = Math.max(p.sigma0, a);
    const hi = Math.min(p.sigma1, b);
    for (let x = lo; x < hi - JOINT_TOLERANCE; x += step) if (x > a + JOINT_TOLERANCE) xs.add(x);
    if (hi > lo && (hi === b || hi < b - JOINT_TOLERANCE)) xs.add(hi);
  }
  // Rangées presque confondues (sommet du contour au bruit numérique d'un nœud) fusionnées.
  const sorted = [...xs].sort((u, v) => u - v);
  return sorted.filter((x, i) => i === 0 || x - sorted[i - 1]! > JOINT_TOLERANCE || x === b);
}

/** Coupe retenue sur le limon (naissance décalée de δ ou format de tôle). */
interface CurvedCut {
  sigma: Mm;
  reason: "naissance" | "format";
  naissance?: Mm;
  onArc?: boolean;
}

/**
 * Étape 4 : joints — naissances ± δ (dans la partie droite), hors supports ; puis coupes au
 * milieu de l'arc tant qu'un tronçon ne tient dans aucun format de tôle. Contour en fibre
 * neutre et découpe par tronçons (`clipX`).
 */
function placeCurvedJoints(
  input: {
    readonly raw: readonly CurvedRawSupport[];
    readonly births: readonly Naissance[];
    readonly uLo: Mm;
    readonly uHi: Mm;
    readonly cp: SteelCurvedParams["curved"];
    readonly neutral: FiberDevelopment;
    readonly stepsFace: FiberDevelopment;
    readonly dev: StringerDevelopment;
    readonly metal: WorkshopProfile["metal"];
  },
  notes: Message[],
): {
  cuts: CurvedCut[];
  outlineN: Vec2[];
  upperN: Vec2[];
  lowerN: Vec2[];
  clipX: (poly: readonly Vec2[], x0: Mm, x1: Mm) => Vec2[];
  fits: (length: Mm, width: Mm) => boolean;
} {
  const { raw, births, uLo, uHi, cp, neutral, stepsFace, dev, metal } = input;
  const margin = cp.jointSupportMargin;
  const forbidden = raw.map((r) => ({ lo: r.s0 - margin, hi: r.s1 + margin }));
  const minSeg = cp.minSegmentLength;
  const limitLo = uLo + minSeg;
  const limitHi = uHi - minSeg;
  /** Première abscisse libre depuis `s` en allant dans le sens `dir`, ou `null`. */
  const freeFrom = (s: Mm, dir: 1 | -1, lo: Mm, hi: Mm): Mm | null => {
    let x = s;
    for (let guard = 0; guard < 200; guard++) {
      if (x < lo - 1e-9 || x > hi + 1e-9) return null;
      // Intérieur strict : un joint au bord d'une zone interdite est à la marge exacte. Deux
      // supports espacés d'exactement 2 × marge (cas courant des retraits de `steel-flat`) ont
      // des zones interdites jointives au bruit numérique près (≈ 2e-6 mm, bornes des supports
      // par dichotomie) : tolérance JOINT_TOLERANCE, sinon l'intervalle libre est sauté.
      const hit = forbidden.find((f) => x > f.lo + JOINT_TOLERANCE && x < f.hi - JOINT_TOLERANCE);
      if (!hit) return x;
      x = dir > 0 ? hit.hi : hit.lo;
    }
    return null;
  };
  const nearestFree = (s: Mm, lo: Mm, hi: Mm): Mm | null => {
    const a = freeFrom(s, 1, lo, hi);
    const b = freeFrom(s, -1, lo, hi);
    if (a === null) return b;
    if (b === null) return a;
    return Math.abs(a - s) <= Math.abs(b - s) ? a : b;
  };
  const cuts: CurvedCut[] = [];
  const accept = (
    s: Mm,
    reason: "naissance" | "format",
    extra: { naissance?: Mm; onArc?: boolean } = {},
  ): boolean => {
    if (s < limitLo - 1e-9 || s > limitHi + 1e-9) return false;
    // Distances comptées sur la fibre neutre (longueur de tôle).
    if (cuts.some((c) => Math.abs(neutral.toFiber(c.sigma) - neutral.toFiber(s)) < minSeg)) {
      return false;
    }
    cuts.push({ sigma: s, reason, ...extra });
    cuts.sort((x, y) => x.sigma - y.sigma);
    return true;
  };
  for (const b of births) {
    if (b.sigma <= uLo || b.sigma >= uHi) continue;
    const dir: 1 | -1 = b.after === "line" ? 1 : b.before === "line" ? -1 : 1;
    const target =
      b.before === "arc" && b.after === "arc" ? b.sigma : b.sigma + dir * cp.jointOffset;
    const lo = dir > 0 ? b.sigma : limitLo;
    const hi = dir > 0 ? limitHi : b.sigma;
    let s = freeFrom(target, dir, lo, hi);
    let onArc = false;
    if (s === null) {
      // Partie droite trop courte ou encombrée : repli vers l'arc, puis abandon.
      s = freeFrom(target, dir > 0 ? -1 : 1, limitLo, limitHi);
      onArc = s !== null && (dir > 0 ? s < b.sigma : s > b.sigma);
    }
    const arcArc = b.before === "arc" && b.after === "arc";
    if (s === null || !accept(s, "naissance", { naissance: b.sigma, onArc })) {
      notes.push(
        msg("structure.steelCurved.note.springingNoCut", {
          sigma: dec(b.sigma, 0),
          minSegment: dec(minSeg, 0),
        }),
      );
    } else if (onArc) {
      notes.push(
        msg("structure.steelCurved.note.springingCutOnArc", {
          sigma: dec(b.sigma, 0),
          cut: dec(s, 0),
        }),
      );
    } else if (!arcArc && Math.abs(s - b.sigma) < cp.jointOffset - 1e-6) {
      // Repli vers la naissance : le décalage δ (méplats d'extrémité de roulage, B §5.5) n'est
      // pas tenu ; signalé (et contrôlé, `FAB_DEBILLARDE_JOINT`).
      notes.push(
        msg("structure.steelCurved.note.springingCutClose", {
          sigma: dec(b.sigma, 0),
          distance: dec(Math.abs(s - b.sigma), 0),
          offset: dec(cp.jointOffset, 0),
        }),
      );
    }
  }

  // Contour en fibre neutre (x = σ_n, y = z) et découpe par tronçons.
  const breaks = births.map((b) => b.sigma);
  const outlineN = remapX(dev.outline, neutral.toFiber, breaks, true);
  const upperN = remapX(dev.upperRive, neutral.toFiber, breaks, false);
  const lowerN = remapX(dev.lowerRive, neutral.toFiber, breaks, false);
  // Coupe d'un tronçon : les sommets à moins de JOINT_TOLERANCE d'un trait de coupe sans être
  // dessus (nœud d'échantillonnage des rives presque confondu avec le joint) sont retirés, sinon
  // le contour garde une arête parasite de l'ordre du micron (développé, DXF) ; les sommets de
  // coupe, calculés sur la même arête pour les deux tronçons voisins, sont conservés. De même,
  // deux sommets consécutifs à moins de JOINT_TOLERANCE (naissance ou nez presque confondu avec
  // un nœud d'échantillonnage des rives) sont fusionnés.
  const nearCut = (x: Mm, c: Mm): boolean => {
    const d = Math.abs(x - c);
    return d > 1e-9 && d < JOINT_TOLERANCE;
  };
  const clipX = (poly: readonly Vec2[], x0: Mm, x1: Mm): Vec2[] =>
    removeCollinear(
      dedupe(
        clipHalfPlane(
          clipHalfPlane(poly, V.vec(x0, 0), V.vec(1, 0)),
          V.vec(x1, 0),
          V.vec(-1, 0),
        ).filter((p) => !nearCut(p.x, x0) && !nearCut(p.x, x1)),
        JOINT_TOLERANCE,
      ),
    );
  const fits = (length: Mm, width: Mm): boolean =>
    metal.sheetFormats.some(
      (f) =>
        (length <= f.length + 1e-6 && width <= f.width + 1e-6) ||
        (length <= f.width + 1e-6 && width <= f.length + 1e-6),
    );
  const intervals = (): { a: Mm; b: Mm }[] => {
    const xs = [uLo, ...cuts.map((c) => c.sigma), uHi];
    return xs.slice(0, -1).map((a, i) => ({ a, b: xs[i + 1]! }));
  };
  const boxOf = (a: Mm, b: Mm): OrientedBox =>
    minAreaRect(clipX(outlineN, neutral.toFiber(a), neutral.toFiber(b)));
  const unsplittable = new Set<string>();
  for (let iter = 0; iter < 12; iter++) {
    const bad = intervals().find((iv) => {
      const box = boxOf(iv.a, iv.b);
      return !fits(box.length, box.width) && !unsplittable.has(`${iv.a}|${iv.b}`);
    });
    if (!bad) break;
    // Milieu de la plus longue portion d'arc du tronçon, sinon milieu du tronçon.
    let best: { lo: Mm; hi: Mm } | null = null;
    for (const p of stepsFace.pieces) {
      if (p.kind !== "arc") continue;
      const lo = Math.max(p.sigma0, bad.a);
      const hi = Math.min(p.sigma1, bad.b);
      if (hi - lo > (best ? best.hi - best.lo : 0)) best = { lo, hi };
    }
    const mid = best ? (best.lo + best.hi) / 2 : (bad.a + bad.b) / 2;
    const s = nearestFree(mid, bad.a + minSeg, bad.b - minSeg);
    if (s === null || !accept(s, "format")) unsplittable.add(`${bad.a}|${bad.b}`);
  }
  return { cuts, outlineN, upperN, lowerN, clipX, fits };
}

/** Géométrie commune aux étapes du limon débillardé (après développement et découpe). */
interface CurvedGeometry {
  readonly params: SteelCurvedParams;
  readonly cp: SteelCurvedParams["curved"];
  readonly e: Mm;
  readonly sup: SteelCurvedParams["supports"];
  readonly material: Part["material"];
  readonly profile: WorkshopProfile;
  readonly metal: WorkshopProfile["metal"];
  readonly nosings: readonly NosingLine[];
  readonly layout: StructureContext["layout"];
  readonly P: (s: Mm) => Vec2;
  readonly T: (s: Mm) => Vec2;
  readonly N: (s: Mm) => Vec2;
  readonly stepsFace: FiberDevelopment;
  readonly neutral: FiberDevelopment;
  readonly jourFace: FiberDevelopment;
  readonly births: readonly Naissance[];
  readonly F: NosingProfile;
  readonly dev: StringerDevelopment;
  readonly zLowAt: (s: Mm) => Mm;
  readonly zHighAt: (s: Mm) => Mm;
  readonly s0: Mm;
  readonly sN: Mm;
  readonly uLo: Mm;
  readonly uHi: Mm;
  readonly floorLevel: Mm;
  readonly topCut: Mm;
  readonly depthSup: Mm;
  readonly step: Mm;
  readonly lowerOffset: Mm;
  readonly outlineN: readonly Vec2[];
  readonly upperN: readonly Vec2[];
  readonly lowerN: readonly Vec2[];
  readonly clipX: (poly: readonly Vec2[], x0: Mm, x1: Mm) => Vec2[];
  readonly fits: (length: Mm, width: Mm) => boolean;
  readonly mirrored: boolean;
  readonly idOf: (i: number) => string;
  readonly markOf: (i: number) => string;
  readonly solidRows: (a: Mm, b: Mm) => Mm[];
}

/** Portée d'un support côté jour sur C_i, avant découpe en tronçons. */
interface CurvedRawSupport {
  zone: TreadZone;
  s0: Mm;
  s1: Mm;
}

/** Supports côté jour : tronçon porteur (milieu de la portée), repère, face tangente. */
function curvedSupportsOf(
  g: CurvedGeometry,
  raw: readonly CurvedRawSupport[],
  ivs: readonly { a: Mm; b: Mm }[],
): CurvedSupport[] {
  const { P, T, N, sup, material, profile, idOf, markOf } = g;
  return raw.map((r) => {
    const mid = (r.s0 + r.s1) / 2;
    const owner = Math.max(
      0,
      ivs.findIndex((iv) => mid >= iv.a - 1e-9 && mid <= iv.b + 1e-9),
    );
    const t = T(mid);
    const pm = P(mid);
    const u0 = V.dot(V.sub(P(r.s0), pm), t);
    const u1 = V.dot(V.sub(P(r.s1), pm), t);
    const lineDist = (s: Mm): Mm => Math.abs(V.dot(V.sub(P(s), pm), N(mid)));
    let gap = 0;
    for (let k = 0; k <= 8; k++) gap = Math.max(gap, lineDist(r.s0 + ((r.s1 - r.s0) * k) / 8));
    const face: SupportFace = {
      key: `stringer-inner-curved-t${r.zone.tread.number}`,
      owner: idOf(owner),
      ownerMark: markOf(owner),
      kind: "stringer",
      side: "inner",
      a: pm,
      dir: t,
      into: N(mid),
      uMin: u0,
      uMax: u1,
    };
    const placement: SupportPlacement = {
      tread: r.zone.tread.number,
      treadMark: r.zone.mark,
      face,
      u0,
      u1,
      zTop: r.zone.zUnder,
    };
    return {
      placement,
      sigma0: r.s0,
      sigma1: r.s1,
      gap,
      part: supportPart(placement, sup, "S", material, profile),
    };
  });
}

/** Joints soudés bout à bout (cordon, dégagement aux supports, naissance). */
function curvedJointsOf(
  g: CurvedGeometry,
  cuts: readonly CurvedCut[],
  raw: readonly CurvedRawSupport[],
): CurvedJoint[] {
  const { neutral, zHighAt, zLowAt } = g;
  return cuts.map((c) => {
    const clearance = raw.reduce(
      (m, r) => Math.min(m, c.sigma < r.s0 ? r.s0 - c.sigma : c.sigma > r.s1 ? c.sigma - r.s1 : 0),
      Infinity,
    );
    return {
      sigma: c.sigma,
      neutral: neutral.toFiber(c.sigma),
      reason: c.reason,
      weld: Math.max(0, zHighAt(c.sigma) - zLowAt(c.sigma)),
      supportClearance: clearance,
      ...(c.naissance !== undefined
        ? {
            naissance: c.naissance,
            naissanceOffset: Math.abs(c.sigma - c.naissance),
            onArc: c.onArc ?? false,
          }
        : {}),
    };
  });
}

/** Tronçon i du limon débillardé : développé en fibre neutre, traçages, perçages, solide. */
function curvedSegment(
  g: CurvedGeometry,
  iv: { readonly a: Mm; readonly b: Mm },
  i: number,
  segCount: number,
  supports: readonly CurvedSupport[],
  joints: readonly CurvedJoint[],
): CurvedSegment {
  const { e, cp, sup, material, profile, params, nosings, layout, neutral, depthSup } = g;
  const { outlineN, upperN, lowerN, clipX, fits, floorLevel, topCut, mirrored } = g;
  const { idOf, markOf, solidRows, zLowAt, zHighAt, P, N } = g;
  const x0 = neutral.toFiber(iv.a);
  const x1 = neutral.toFiber(iv.b);
  const outline = clipX(outlineN, x0, x1);
  const box = minAreaRect(outline);
  let xMin = Infinity;
  let xMax = -Infinity;
  for (const p of outline) {
    xMin = Math.min(xMin, p.x);
    xMax = Math.max(xMax, p.x);
  }
  const toFlat = (p: Vec2): Vec2 => (mirrored ? V.vec(xMax - p.x, p.y) : V.vec(p.x - xMin, p.y));
  const riveAt = (line: readonly Vec2[], x: Mm): Mm => polyAt(line, x);
  const vertical = (x: Mm): [Vec2, Vec2] | null => {
    const lo = Math.max(riveAt(lowerN, x), floorLevel);
    const hi = Math.min(riveAt(upperN, x), topCut);
    return hi > lo ? [toFlat(V.vec(x, lo)), toFlat(V.vec(x, hi))] : null;
  };
  const lines: FlatPattern["lines"][number][] = [];
  // Lignes de roulage (génératrices) et naissances.
  const arcs: CurvedArcZone[] = [];
  for (const p of neutral.pieces) {
    if (p.kind !== "arc") continue;
    const lo = Math.max(p.fiber0, x0);
    const hi = Math.min(p.fiber1, x1);
    if (!(hi - lo > 1e-6)) continue;
    const faceR = p.faceRadius!;
    const innerR = p.concave ? faceR - e : faceR;
    const neutralR = p.fiberRadius!;
    let zMin = Infinity;
    let zMax = -Infinity;
    for (const q of outline) {
      if (q.x < lo - 1e-6 || q.x > hi + 1e-6) continue;
      zMin = Math.min(zMin, q.y);
      zMax = Math.max(zMax, q.y);
    }
    for (const x of [lo, hi]) {
      zMin = Math.min(zMin, Math.max(riveAt(lowerN, x), floorLevel));
      zMax = Math.max(zMax, Math.min(riveAt(upperN, x), topCut));
    }
    arcs.push({
      faceRadius: faceR,
      innerRadius: innerR,
      neutralRadius: neutralR,
      sigma0: neutral.toFace(lo),
      sigma1: neutral.toFace(hi),
      neutral0: lo,
      neutral1: hi,
      generatrixExtent: zMax - zMin,
    });
    const count = Math.max(1, Math.floor((hi - lo) / cp.rollLineSpacing));
    for (let k = 0; k <= count; k++) {
      const x = lo + ((hi - lo) * k) / count;
      const seg = vertical(x);
      if (!seg) continue;
      lines.push({
        kind: "roll",
        a: seg[0],
        b: seg[1],
        ...(k === 0
          ? {
              label: msg("structure.steelCurved.flatLine.rolling", {
                inner: dec(innerR, 0),
                neutral: dec(neutralR, 0),
              }),
            }
          : {}),
      });
    }
    for (const x of [p.fiber0, p.fiber1]) {
      if (x <= x0 + 1e-6 || x >= x1 - 1e-6) continue;
      const seg = vertical(x);
      if (seg) {
        lines.push({
          kind: "mark",
          a: seg[0],
          b: seg[1],
          label: msg("structure.steelCurved.flatLine.springing"),
        });
      }
    }
  }
  // Traits de joint.
  const jointAt = (s: Mm, other: number): void => {
    const seg = vertical(neutral.toFiber(s));
    if (seg) {
      lines.push({
        kind: "joint",
        a: seg[0],
        b: seg[1],
        label: msg("structure.steelCurved.flatLine.joint", { mark: markOf(other) }),
      });
    }
  };
  if (i > 0) jointAt(iv.a, i - 1);
  if (i < segCount - 1) jointAt(iv.b, i + 1);
  // Reports des nez.
  for (const k of nosings) {
    if (k.sigmaInner < iv.a - 1e-6 || k.sigmaInner > iv.b + 1e-6) continue;
    const seg = vertical(neutral.toFiber(k.sigmaInner));
    if (seg) lines.push({ kind: "mark", a: seg[0], b: seg[1], label: textMessage(`N${k.index}`) });
  }
  // Supports (position de soudage / de pose) et perçages.
  const holes: Vec2[][] = [];
  for (const s of supports) {
    if (s.placement.face.owner !== idOf(i)) continue;
    const zt = s.placement.zTop;
    const zb = zt - depthSup;
    const xa = neutral.toFiber(s.sigma0);
    const xb = neutral.toFiber(s.sigma1);
    const rect = [V.vec(xa, zb), V.vec(xb, zb), V.vec(xb, zt), V.vec(xa, zt)].map(toFlat);
    rect.forEach((a, q) =>
      lines.push({
        kind: "mark",
        a,
        b: rect[(q + 1) % 4]!,
        ...(q === 0
          ? { label: msg("structure.steel.flatLine.support", { mark: s.placement.treadMark }) }
          : {}),
      }),
    );
    for (const c of boltCenters(s.placement, sup)) {
      const pt = V.addScaled(s.placement.face.a, s.placement.face.dir, c.x);
      const sigma = projectOnCurve(pt, layout.inner).s;
      const ring = holePolygon(
        toFlat(V.vec(neutral.toFiber(sigma), c.y)),
        sup.holeDiameter,
        sup.slotLength,
        V.vec(1, 0),
      );
      holes.push(signedArea(ring) > 0 ? ring.reverse() : ring);
    }
  }
  // Repère gravé.
  const xm = (x0 + x1) / 2;
  const ym = (Math.max(riveAt(lowerN, xm), floorLevel) + Math.min(riveAt(upperN, xm), topCut)) / 2;
  const la = toFlat(V.vec(xm - 20, ym));
  const lb = toFlat(V.vec(xm + 20, ym));
  const [ta, tb] = mirrored ? [lb, la] : [la, lb];
  lines.push({ kind: "text", a: ta, b: tb, label: textMessage(markOf(i)) });
  let outer = outline.map(toFlat);
  if (mirrored) outer = outer.reverse();
  const flat: FlatPattern = {
    outline: { outer, holes },
    lines,
    thickness: e,
    reference: {
      kind: "neutral-fiber",
      description: msg("structure.steelCurved.reference.segment", {
        segment: i + 1,
        segments: segCount,
        ascent: ascentDirection(mirrored),
      }),
    },
  };
  // Solide : surface réglée (face côté marches) épaissie vers le jour.
  const rows = solidRows(iv.a, iv.b);
  const lower: Vec3[] = [];
  const upper: Vec3[] = [];
  const normals: Vec2[] = [];
  for (const s of rows) {
    const zl = zLowAt(s);
    const zh = zHighAt(s);
    if (!(zh - zl > 0.1)) continue;
    const p = P(s);
    lower.push({ x: p.x, y: p.y, z: zl });
    upper.push({ x: p.x, y: p.y, z: zh });
    normals.push(N(s));
  }
  const meas = plateMeasures(flat.outline, e);
  const rolled = arcs.reduce((s, a) => s + (a.neutral1 - a.neutral0), 0);
  const endWeld = i < segCount - 1 ? (joints[i]?.weld ?? 0) : 0;
  const part: Part = {
    id: idOf(i),
    mark: markOf(i),
    category: "stringer",
    name: msg("structure.steelCurved.part.segment", { segment: i + 1, segments: segCount }),
    material,
    solid: { kind: "ruled", a: lower, b: upper, thickness: e, normals },
    flat,
    section: msg("structure.steelCurved.section.rolledPlate", {
      thickness: dec(e, 0),
      grade: params.grade,
      width: dec(Math.ceil(box.width), 0),
    }),
    stock: { length: box.length, width: box.width, thickness: e },
    quantities: {
      ...steelQuantities(
        {
          volumeMm3: meas.volumeMm3,
          treatedSurfaceMm2: meas.treatedSurfaceMm2,
          length: box.length,
          weld: endWeld,
          buttWeld: endWeld,
          cuts: 1,
          laserCut: meas.laserCut,
          holes: holes.length,
        },
        profile,
      ),
      [QUANTITY_ROLLED_LENGTH_MM]: rolled,
    },
  };
  return {
    index: i,
    sigma0: iv.a,
    sigma1: iv.b,
    neutral0: x0,
    neutral1: x1,
    outline,
    box,
    fits: fits(box.length, box.width),
    arcs,
    part,
  };
}

/** Étape 6 : platines de pied et de tête du limon de jour. */
function curvedPlates(g: CurvedGeometry, segCount: number): Part[] {
  const { params, dev, floorLevel, idOf, markOf, P, T, N, uHi, e, material, profile } = g;
  const { zLowAt, zHighAt } = g;
  const plates: Part[] = [];
  const pl = params.plates;
  const pseudoFace = (s: Mm): StringerFace => {
    const dir = T(s);
    return {
      id: idOf(0),
      mark: markOf(0),
      name: msg("structure.steelCurved.part.outerString"),
      side: "inner",
      leg: 0,
      a: V.addScaled(P(s), dir, -s),
      dir,
      into: N(s),
      sigmaA: 0,
      faceLength: uHi,
      start: "floor",
      end: "arrival",
    };
  };
  if (pl.foot) {
    const onFloor = dev.outline.filter((p) => Math.abs(p.y - floorLevel) < 1e-6).map((p) => p.x);
    if (onFloor.length >= 2) {
      const mid = (Math.min(...onFloor) + Math.max(...onFloor)) / 2;
      const f = pseudoFace(mid);
      const L = pl.length;
      const holesAt = plateHoles(L, pl.width, pl.holeEdgeDistance, 1);
      const pf = rectFlat(
        L,
        pl.width,
        pl.thickness,
        holesAt,
        pl.holeDiameter,
        "PF",
        msg("structure.steel.reference.footPlate", { mark: markOf(0) }),
      );
      const o = V.add(V.addScaled(f.a, f.dir, mid - L / 2), V.scale(f.into, -(pl.width - e) / 2));
      const sgn = V.cross(f.dir, f.into) > 0 ? 1 : -1;
      plates.push(
        assembledTo(
          plateObject(
            `plate-foot-${idOf(0)}`,
            msg("structure.steel.part.footPlate", { mark: markOf(0) }),
            pf,
            pl.thickness,
            2 * L,
            material,
            profile,
            {
              origin: { x: o.x, y: o.y, z: 0 },
              xAxis: { x: f.dir.x, y: f.dir.y, z: 0 },
              yAxis: { x: f.into.x, y: f.into.y, z: 0 },
              zAxis: { x: 0, y: 0, z: sgn },
              depth: sgn * pl.thickness,
            },
          ),
          [idOf(0)],
        ),
      );
    }
  }
  if (pl.head) {
    const zLo = zLowAt(uHi);
    const zHi = zHighAt(uHi);
    const H = zHi - zLo;
    if (H > 1) {
      const last = segCount - 1;
      const holesAt = plateHoles(H, pl.width, pl.holeEdgeDistance, 1);
      const ph = rectFlat(
        H,
        pl.width,
        pl.thickness,
        holesAt,
        pl.holeDiameter,
        "PH",
        msg("structure.steel.reference.headPlate", { mark: markOf(last) }),
      );
      plates.push(
        assembledTo(
          plateObject(
            `plate-head-${idOf(last)}`,
            msg("structure.steel.part.headPlate", { mark: markOf(last) }),
            ph,
            pl.thickness,
            2 * H,
            material,
            profile,
            endPlateFrame(pseudoFace(uHi), uHi, zLo, pl.width, e, pl.thickness, 1),
          ),
          [idOf(last)],
        ),
      );
    }
  }
  return plates;
}

/**
 * Étape 7 : contrôles du limon débillardé (largeur perpendiculaire, cassures de pente aux
 * naissances et aux nez, joints, format de tôle, laser, rouleuse, supports).
 */
function addCurvedChecks(
  g: CurvedGeometry,
  checks: CheckCollector,
  notes: Message[],
  input: {
    readonly joints: readonly CurvedJoint[];
    readonly segments: readonly CurvedSegment[];
    readonly supports: readonly CurvedSupport[];
    readonly shortSupports: readonly CheckItem[];
  },
): {
  minPerp: Mm;
  slopeBreaks: CurvedStringerResult["slopeBreaks"];
  nosingKinks: CurvedStringerResult["nosingKinks"];
} {
  const { s0, sN, uLo, uHi, step, jourFace, F, params, lowerOffset, idOf, cp } = g;
  const { stepsFace, neutral, births, nosings, e, metal, sup, depthSup, dev } = g;
  const { joints, segments, supports, shortSupports } = input;
  const rule = (spec: PluginRuleSpec) => pluginRuleDef(spec);
  const minSigma = Math.min(s0, uLo);
  const maxSigma = Math.max(sN, uHi);
  // Largeur perpendiculaire sur la face côté jour (pente développée la plus forte).
  let minPerp = Infinity;
  for (let s = minSigma; s + step <= maxSigma + 1e-9; s += step) {
    const dx = jourFace.toFiber(s + step) - jourFace.toFiber(s);
    if (!(dx > 1e-9)) continue;
    const slope = (F.at(s + step) - F.at(s)) / dx;
    minPerp = Math.min(minPerp, (params.upperOffset + lowerOffset) / Math.sqrt(1 + slope * slope));
  }
  if (!Number.isFinite(minPerp)) minPerp = params.upperOffset + lowerOffset;
  checks.addItems(
    rule(FAB_RULES.perpendicularWidth),
    [
      {
        value: minPerp,
        label: msg("structure.steelCurved.check.outerStringWellFace"),
        partId: idOf(0),
      },
    ],
    msg("structure.steelCurved.quantity.perpendicularWidth"),
    { min: cp.minPerpendicularWidth, max: null },
  );
  // Cassure de pente résiduelle aux naissances.
  const fibers = [stepsFace, neutral, jourFace];
  const slopeBreaks = births
    .filter((b) => b.sigma > uLo && b.sigma < uHi)
    .map((b) => ({ sigma: b.sigma, fibers: fibers.map((d) => slopeBreakAt(F.at, d, b.sigma)) }));
  // Cassures de F elle-même aux nez (hors naissance déjà mesurée) : bornes de zone balancée à
  // extrémité libre, nez tournants non balancés (F droite par morceaux entre les nez).
  const nosingKinks = nosings
    .filter(
      (k) =>
        k.sigmaInner > uLo + 1 &&
        k.sigmaInner < uHi - 1 &&
        !slopeBreaks.some((sb) => Math.abs(sb.sigma - k.sigmaInner) < 1),
    )
    .map((k) => ({
      sigma: k.sigmaInner,
      nosing: k.index,
      // Pas de 0,05 mm : sur une courbe dérivable, l'écart des différences finies unilatérales
      // (≈ |F''|·h) reste sous le seuil d'affichage de 0,01°.
      fibers: fibers.map((d) => slopeBreakAt(F.at, d, k.sigmaInner, 0.05)),
    }))
    .filter((kk) => kk.fibers.some((f) => f.degrees >= 0.01));
  /** Cassure de pente sur les trois fibres (face côté marches, fibre neutre, face côté jour). */
  const breakFinding = (
    key: MessageKey,
    params: Readonly<Record<string, MessageParam>>,
    fibersAt: readonly SlopeBreak[],
  ): Finding => {
    const worst = Math.max(...fibersAt.map((f) => f.degrees));
    const bad = cp.maxSlopeBreak !== undefined && worst > cp.maxSlopeBreak;
    return {
      status: bad ? "violation" : "ok",
      measured: worst,
      ...(cp.maxSlopeBreak !== undefined ? { max: cp.maxSlopeBreak } : {}),
      message: msg(key, {
        ...params,
        fibers: msg("structure.steelCurved.check.fiberBreaks", {
          steps: dec(fibersAt[0]!.degrees, 2),
          neutral: dec(fibersAt[1]!.degrees, 2),
          well: dec(fibersAt[2]!.degrees, 2),
        }),
        threshold:
          cp.maxSlopeBreak !== undefined
            ? msg("structure.steelCurved.check.threshold", { max: dec(cp.maxSlopeBreak, 2) })
            : msg("structure.steelCurved.check.noThreshold"),
      }),
    };
  };
  checks.add(
    rule(CURVED_RULES.slopeBreak),
    nosingKinks.map((kk) =>
      breakFinding(
        "structure.steelCurved.check.nosingKink",
        { nosing: kk.nosing, sigma: dec(kk.sigma, 0) },
        kk.fibers,
      ),
    ),
  );
  if (nosingKinks.length > 0) {
    const worst = nosingKinks.reduce((m, kk) => Math.max(m, ...kk.fibers.map((f) => f.degrees)), 0);
    notes.push(
      msg("structure.steelCurved.note.nosingKinks", {
        nosings: nosingKinks.map((kk) => kk.nosing).join(", "),
        worst: dec(worst, 1),
      }),
    );
  }
  checks.add(
    rule(CURVED_RULES.slopeBreak),
    slopeBreaks.length === 0
      ? [{ status: "ok", message: msg("structure.steelCurved.check.noSpringing") }]
      : slopeBreaks.map((sb): Finding =>
          breakFinding(
            "structure.steelCurved.check.springingBreak",
            { sigma: dec(sb.sigma, 0) },
            sb.fibers,
          ),
        ),
  );
  // Joints.
  checks.addItems(
    rule(CURVED_RULES.jointPlacement),
    joints.map((j) => ({
      value: Number.isFinite(j.supportClearance) ? j.supportClearance : 1e6,
      label: msg(
        j.reason === "naissance"
          ? "structure.steelCurved.check.jointSpringing"
          : "structure.steelCurved.check.jointFormat",
        { sigma: dec(j.sigma, 0) },
      ),
    })),
    msg("structure.steelCurved.quantity.jointSupportDistance"),
    { min: cp.jointSupportMargin - JOINT_TOLERANCE, max: null },
  );
  // Décalage δ des coupes de naissance dans la partie droite (hors naissance arc / arc).
  const offsetJoints = joints.filter(
    (j) =>
      j.naissance !== undefined &&
      !births.some(
        (b) => Math.abs(b.sigma - j.naissance!) < 1e-6 && b.before === "arc" && b.after === "arc",
      ),
  );
  if (offsetJoints.length > 0) {
    checks.addItems(
      rule(CURVED_RULES.jointPlacement),
      offsetJoints.map((j) => ({
        value: j.onArc ? -j.naissanceOffset! : j.naissanceOffset!,
        label: msg(
          j.onArc
            ? "structure.steelCurved.check.jointOffsetOnArc"
            : "structure.steelCurved.check.jointOffset",
          { sigma: dec(j.sigma, 0), springing: dec(j.naissance!, 0) },
        ),
      })),
      msg("structure.steelCurved.quantity.jointSpringingOffset"),
      { min: cp.jointOffset - 1e-6, max: null },
    );
  }
  // Format de tôle, laser, rouleaux.
  checks.add(
    rule(STEEL_RULES.sheetFormat),
    segments.map((sg): Finding => ({
      status: sg.fits ? "ok" : "violation",
      measured: sg.box.length,
      location: { kind: "part", partId: sg.part.id },
      message: sheetFormatMessage(
        sg.fits
          ? "structure.steel.check.inSheetFormat"
          : "structure.steelCurved.check.outOfSheetFormats",
        sg.part.mark,
        sg.box,
      ),
    })),
  );
  checks.addItems(
    rule(STEEL_RULES.laser),
    segments.map((sg) => ({ value: e, label: textMessage(sg.part.mark), partId: sg.part.id })),
    msg("structure.steel.quantity.cutThickness"),
    { min: null, max: metal.laser.maxThickness },
  );
  checks.addItems(
    rule(CURVED_RULES.rollLength),
    segments.flatMap((sg) =>
      sg.arcs.map((a) => ({
        value: a.generatrixExtent,
        label: msg("structure.steelCurved.check.arcItem", {
          mark: sg.part.mark,
          radius: dec(a.innerRadius, 0),
        }),
        partId: sg.part.id,
      })),
    ),
    msg("structure.steelCurved.quantity.generatrixExtent"),
    { min: null, max: metal.plateRolling.rollLength },
  );
  checks.addItems(
    rule(STEEL_RULES.supportLength),
    shortSupports,
    msg("structure.steel.quantity.bearingLength"),
    { min: sup.minLength, max: null },
  );
  checks.addItems(
    rule(STEEL_RULES.supportInStringer),
    supports.map((s) => {
      const zt = s.placement.zTop;
      const zb = zt - depthSup;
      const value = Math.min(
        zb - polyAt(dev.lowerRive, s.sigma0),
        zb - polyAt(dev.lowerRive, s.sigma1),
        polyAt(dev.upperRive, s.sigma0) - zt,
        polyAt(dev.upperRive, s.sigma1) - zt,
      );
      return {
        value,
        label: supportOn(s.placement.treadMark, s.placement.face.ownerMark),
        partId: s.placement.face.owner,
        treadNumber: s.placement.tread,
      };
    }),
    msg("structure.steel.quantity.supportEdgeMargin"),
    { min: -1e-6, max: null },
  );
  return { minPerp, slopeBreaks, nosingKinks };
}

export const STEEL_CURVED: StructureKind<SteelCurvedParams> = {
  kind: "steel-curved",
  labelKey: "structure.steelCurved.label",
  family: "metal",
  paramsSchema: SteelCurvedParamsSchema,
  defaults: () => SteelCurvedParamsSchema.parse({}),
  build: (ctx, params) => buildSteelCurved(ctx, params).output,
  capabilities: {
    // Limon de jour débillardé et limons muraux en plat, hors emprise utile (jour en arc exigé,
    // pas de poteau).
    lateralThickness: (p) => ({ inner: p.thickness, outer: p.thickness }),
  },
};
