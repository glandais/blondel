/**
 * Poutre du limon central (`steel-central`, QUESTIONS A29) : pièces de la poutre le long de sa
 * trace (`centralTrace.ts`), platines de pied et de tête, contrôles de fabrication propres.
 *
 * - **Tube rectangulaire** (`section.kind = "tube"`) : barre sciée sur une trace droite ;
 *   aboutage (`beam.splice`) au-delà de la plus grande barre du profil d'atelier ; sur une
 *   trace courbe (tournant, hélicoïdal), cintrage hélicoïdal d'un tube non pris en charge
 *   (C §2.3 : « aucune capacité chiffrée ») : erreur explicite, choisir le caisson.
 * - **Caisson en tôles soudées** (`section.kind = "box"`, C §2.4 [20], §2.5) : deux flasques
 *   (joues verticales parallèles à la trace, fibre neutre à ± (b/2 − t_w/2), développées à la
 *   fibre neutre et roulées sur les arcs, lignes de roulage), semelles haute et basse entre les
 *   flasques (largeur b − 2·t_w ; bandes planes sur une partie droite ; sur un arc, surface gauche
 *   non développable « formée à la griffe », débit approché par une bande de longueur égale à la
 *   longueur 3D de la rive à l'axe, signalé), entretoises à entraxe ≤ `section.diaphragmSpacing`
 *   (une à chaque extrémité munie d'une coupe d'aplomb, une juste après chaque joint) ; tronçons
 *   coupés aux naissances (± δ dans la partie droite, hors supports) et aux formats de tôle,
 *   chaque joint coupant tout le caisson au même σ, soudé bout à bout ⇒ EXC2 (C §2.1). Une
 *   éclisse boulonnée (`beam.splice = bolted`) n'est pas proposée sur un caisson : joints soudés,
 *   remarque.
 * - Dessus de la poutre z = `nosingZ(σ) − topOffset` ; dessous à la hauteur verticale constante
 *   h_v = H / cos α (α : pente nominale de la trace ; hauteur perpendiculaire H sur les parties
 *   droites, « arasement » comme les rives des limons) ; coupe de niveau au sol (dessus de la
 *   platine de pied) et coupe d'aplomb en tête contre le chevêtre (platine de tête), conventions
 *   de `steel-flat` (`developStringer`).
 * - Galvanisé : évents des corps creux placés automatiquement (C §2.8 [28], C-M-10) : un évent à
 *   chaque extrémité de chaque corps creux (flasque gauche du caisson, face du tube) et un au
 *   centre de chaque entretoise.
 * - Repères : tube `TC<i>`, flasques `FG<i>` (gauche) / `FD<i>` (droite), semelles `SH` / `SB`
 *   et entretoises `EC` regroupées par pièces identiques (`markGroups`), platines `PF` / `PH`.
 *
 * Contrat partagé de la vague « limon central » (interfaces **figées**) : implémenté par la
 * tâche « poutre », appelé par le plugin (`steelCentral.ts`) après le placement des supports.
 */
import { dec, errorMessage, msg, textMessage, type Message, type MessageKey } from "@blondel/i18n";
import { pointInPolygon, signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import { cumulativeLengths } from "../geom2d/curve.js";
import type { FlatPattern, Part } from "../model/derived.js";
import type { PartAssembly, StructureContext } from "../model/plugins.js";
import type { Mm, Vec2, Vec3 } from "../model/primitives.js";
import { buildBasicParts } from "../parts/basic.js";
import type { BeamSection } from "../precheck/beam.js";
import { sourceSpec } from "../rules/sources.js";
import type { Finding } from "../rules/types.js";
import { resolveWorkshopProfile, type WorkshopProfile } from "../workshop/profile.js";
import {
  pluginRuleDef,
  type CheckCollector,
  type CheckItem,
  type PluginRuleSpec,
} from "./checks.js";
import type { CentralTrace } from "./centralTrace.js";
import { developStringer, type StringerDevelopment } from "./development.js";
import { PiecewiseLinear, clipHalfPlane, dedupe, minAreaRect, removeCollinear } from "./geom.js";
import {
  STEEL_RULES,
  holePolygon,
  plateMeasures,
  steelMaterial,
  steelQuantities,
} from "./steelCommon.js";
import type { SteelCentralParams } from "./steelCentralParams.js";
import { CURVED_RULES, QUANTITY_ROLLED_LENGTH_MM } from "./steelCurved.js";
import {
  fiberDevelopment,
  polyAt,
  remapX,
  slopeBreakAt,
  type FiberDevelopment,
} from "./steelCurvedGeometry.js";
import {
  ascentDirection,
  markGroups,
  plateHoles,
  plateObject,
  rectFlat,
  sheetFormatMessage,
} from "./steelFlat.js";

/** Portée d'un support de marche sur la trace (zone interdite aux joints). */
export interface SigmaSpan {
  readonly sigma0: Mm;
  readonly sigma1: Mm;
  /** Marche portée (localisation des constats). */
  readonly treadNumber?: number;
}

export interface CentralBeamInput {
  readonly ctx: StructureContext;
  readonly params: SteelCentralParams;
  readonly trace: CentralTrace;
  /** Distance verticale ligne des nez → dessus de la poutre, résolue (mm, > 0). */
  readonly topOffset: Mm;
  /** Portées des supports de marche sur la trace : aucun joint de tronçon dedans (± marge). */
  readonly supportSpans: readonly SigmaSpan[];
  /** Collecteur des contrôles du plugin : la poutre y ajoute ses contrôles de fabrication. */
  readonly checks: CheckCollector;
}

/** Joint entre deux tronçons de la poutre. */
export interface CentralBeamJoint {
  /** Abscisse du joint sur la trace. */
  readonly sigma: Mm;
  /** Coupe de naissance (débillardé), de format de tôle ou de longueur de barre. */
  readonly reason: "naissance" | "format" | "bar";
  /** Soudure bout à bout (EXC2) ou éclisse boulonnée (`beam.splice`). */
  readonly kind: "butt-weld" | "bolted-splice";
  /** Longueur de cordon bout à bout (mm, 0 pour une éclisse). */
  readonly weld: Mm;
  /** Distance au support de marche le plus proche (mm, ∞ sans support). */
  readonly supportClearance: Mm;
}

/** Tronçon de la poutre entre deux joints. */
export interface CentralBeamSegment {
  readonly index: number;
  readonly sigma0: Mm;
  readonly sigma1: Mm;
  /** Pièces du tronçon (barre de tube ; flasques, semelles et entretoises d'un caisson). */
  readonly partIds: readonly string[];
  /** Le tronçon tient dans un format de tôle (caisson) ou une longueur de barre (tube). */
  readonly fits: boolean;
}

export interface CentralBeamResult {
  /** Pièces de la poutre et platines de pied / de tête (catégories `stringer`, `fixing`). */
  readonly parts: readonly Part[];
  readonly segments: readonly CentralBeamSegment[];
  readonly joints: readonly CentralBeamJoint[];
  /** Assemblages internes : tronçons consécutifs, flasques ↔ semelles ↔ entretoises, platines. */
  readonly assemblies: readonly PartAssembly[];
  /** Cordons bout à bout (mm) : EXC2 dès qu'il y en a un (C §2.1). */
  readonly buttWeld: Mm;
  /** Cordons d'angle de la poutre (mm) : semelles, entretoises, platines. */
  readonly weld: Mm;
  /** Section brute pour le prédimensionnement en flexion (aire mm², inertie mm⁴, module mm³). */
  readonly section: BeamSection;
  /** Désignation de la section (« tube 200 × 100 × 5 », « caisson 200 × 100, flasques 8 »). */
  readonly sectionLabel: Message;
  /** Portée horizontale développée entre appuis (mm) et pente nominale tan α, prédimensionnement. */
  readonly spanH: Mm;
  readonly slope: number;
  /** Dessus de la poutre en σ (mm). */
  topAt(sigma: Mm): Mm;
  /**
   * Identifiant de la pièce de poutre qui reçoit un support en σ (assemblage support ↔ poutre) :
   * barre du tube, semelle haute du tronçon d'un caisson.
   */
  partAt(sigma: Mm): string | undefined;
  readonly notes: readonly Message[];
  /** Configurations non prises en charge (poutre partielle ou absente). */
  readonly errors: readonly Message[];
  /**
   * Ajouts (hors contrat figé) : étendue de la poutre sur la trace (début de la coupe au sol ou
   * coupe d'aplomb de départ, coupe d'aplomb de tête), hauteur verticale h_v, dessous de la
   * poutre en σ (`null` hors de la poutre), développement (axe, u = σ).
   */
  readonly extent?: { readonly sigma0: Mm; readonly sigma1: Mm };
  readonly verticalHeight?: Mm;
  bottomAt?(sigma: Mm): Mm;
  readonly development?: StringerDevelopment;
}

// ------------------------------------------------------------------ Contrôles

/** Contrôles de la poutre : ids existants réutilisés quand le sens est identique. */
export const CENTRAL_BEAM_RULES = {
  /** Évents des corps creux galvanisés (C §2.8 [28], C-M-10 « bloquant si galva »). */
  vents: {
    id: "FAB_CAISSON_EVENTS",
    ...sourceSpec(msg("compliance.source.galvanizingVents")),
    confidence: "faible",
    nature: "metier",
    severity: "bloquant",
    unit: "mm",
  },
  /** Tube sur trace courbe : cintrage hélicoïdal sans capacité chiffrée (C §2.2, §2.3). */
  tubeOnCurve: {
    id: "FAB_LIMON_CENTRAL_TUBE_COURBE",
    ...sourceSpec(msg("compliance.source.tubeHelicalBending")),
    confidence: "moyen",
    nature: "metier",
    severity: "bloquant",
    unit: null,
  },
  rollingRadius: CURVED_RULES.rollingRadius,
  rollingThickness: CURVED_RULES.rollingThickness,
  rollLength: CURVED_RULES.rollLength,
  slopeBreak: CURVED_RULES.slopeBreak,
  jointPlacement: CURVED_RULES.jointPlacement,
  sheetFormat: STEEL_RULES.sheetFormat,
  laser: STEEL_RULES.laser,
  barLength: STEEL_RULES.barLength,
} as const satisfies Record<string, PluginRuleSpec>;

// ------------------------------------------------------------------ Sections

/**
 * Tube rectangulaire creux b × H × t (H vertical, flexion verticale) : A = bH − (b − 2t)(H − 2t),
 * I = [bH³ − (b − 2t)(H − 2t)³] / 12, W = I / (H/2) (rectangle creux, angles vifs).
 */
export function tubeSection(height: Mm, width: Mm, wall: Mm): BeamSection {
  const bi = Math.max(0, width - 2 * wall);
  const hi = Math.max(0, height - 2 * wall);
  const area = width * height - bi * hi;
  const i = (width * height ** 3 - bi * hi ** 3) / 12;
  return { area, i, w: i / (height / 2) };
}

/**
 * Caisson : deux flasques t_w × H (pleine hauteur) et deux semelles (b − 2·t_w) × t_f entre les
 * flasques : A = 2·t_w·H + 2·(b − 2t_w)·t_f ; I = 2·t_w·H³/12 + 2·[(b − 2t_w)·t_f³/12 +
 * (b − 2t_w)·t_f·(H/2 − t_f/2)²] (Huygens) ; W = I / (H/2).
 */
export function boxSection(height: Mm, width: Mm, web: Mm, flange: Mm): BeamSection {
  const wf = Math.max(0, width - 2 * web);
  const d = height / 2 - flange / 2;
  const area = 2 * web * height + 2 * wf * flange;
  const i = (2 * web * height ** 3) / 12 + 2 * ((wf * flange ** 3) / 12 + wf * flange * d * d);
  return { area, i, w: i / (height / 2) };
}

function sectionOf(sec: SteelCentralParams["section"]): { section: BeamSection; label: Message } {
  return sec.kind === "tube"
    ? {
        section: tubeSection(sec.height, sec.width, sec.wallThickness),
        label: msg("structure.steelCentral.section.tube", {
          height: dec(sec.height, 0),
          width: dec(sec.width, 0),
          wall: dec(sec.wallThickness, 0),
        }),
      }
    : {
        section: boxSection(sec.height, sec.width, sec.webThickness, sec.flangeThickness),
        label: msg("structure.steelCentral.section.box", {
          height: dec(sec.height, 0),
          width: dec(sec.width, 0),
          web: dec(sec.webThickness, 0),
          flange: dec(sec.flangeThickness, 0),
        }),
      };
}

/**
 * Cohérence géométrique de la section (sans seuil métier) : tube 2·t < min(b, H) ; caisson
 * 2·t_w < b (semelles de largeur b − 2·t_w > 0) et 2·t_f < H. Liste vide si la section est
 * constructible.
 */
export function sectionProblems(sec: SteelCentralParams["section"]): Message[] {
  if (sec.kind === "tube") {
    return 2 * sec.wallThickness < Math.min(sec.width, sec.height)
      ? []
      : [
          msg("structure.steelCentral.error.tubeWallTooThick", {
            wall: dec(sec.wallThickness, 0),
            width: dec(sec.width, 0),
            height: dec(sec.height, 0),
          }),
        ];
  }
  const out: Message[] = [];
  if (!(2 * sec.webThickness < sec.width)) {
    out.push(
      msg("structure.steelCentral.error.websTooThick", {
        web: dec(sec.webThickness, 0),
        width: dec(sec.width, 0),
      }),
    );
  }
  if (!(2 * sec.flangeThickness < sec.height)) {
    out.push(
      msg("structure.steelCentral.error.flangesTooThick", {
        flange: dec(sec.flangeThickness, 0),
        height: dec(sec.height, 0),
      }),
    );
  }
  return out;
}

// ------------------------------------------------------------------ Outils

/** Tolérance de position des joints par rapport aux zones interdites (mm), cf. `steel-curved`. */
const JOINT_TOLERANCE = 1e-3;
/** Écart toléré à la linéarité de la courbe des nez entre deux nœuds (mm). */
const LINEAR_TOL = 1e-6;

const v3 = (p: Vec2, z: Mm): Vec3 => ({ x: p.x, y: p.y, z });
const h3 = (p: Vec2): Vec3 => ({ x: p.x, y: p.y, z: 0 });

/** Coupe d'un polygone (x, y) entre les verticales x0 et x1, sommets parasites retirés. */
function clipX(poly: readonly Vec2[], x0: Mm, x1: Mm): Vec2[] {
  const nearCut = (x: Mm, c: Mm): boolean => {
    const d = Math.abs(x - c);
    return d > 1e-9 && d < JOINT_TOLERANCE;
  };
  return removeCollinear(
    dedupe(
      clipHalfPlane(
        clipHalfPlane(poly, V.vec(x0, 0), V.vec(1, 0)),
        V.vec(x1, 0),
        V.vec(-1, 0),
      ).filter((p) => !nearCut(p.x, x0) && !nearCut(p.x, x1)),
      JOINT_TOLERANCE,
    ),
  );
}

function fitsSheet(metal: WorkshopProfile["metal"], length: Mm, width: Mm): boolean {
  return metal.sheetFormats.some(
    (f) =>
      (length <= f.length + 1e-6 && width <= f.width + 1e-6) ||
      (length <= f.width + 1e-6 && width <= f.length + 1e-6),
  );
}

function emptyResult(
  input: CentralBeamInput,
  errors: readonly Message[],
  notes: readonly Message[] = [],
): CentralBeamResult {
  const { trace, topOffset, params } = input;
  const { section, label } = sectionOf(params.section);
  return {
    parts: [],
    segments: [],
    joints: [],
    assemblies: [],
    buttWeld: 0,
    weld: 0,
    section,
    sectionLabel: label,
    spanH: 0,
    slope: trace.slope,
    topAt: (sigma) => trace.nosingZ(sigma) - topOffset,
    partAt: () => undefined,
    notes,
    errors,
  };
}

// ------------------------------------------------------------------ Construction

/**
 * Poutre du limon central. Ne lève jamais : erreurs dans `errors`, poutre partielle.
 */
export function buildCentralBeam(input: CentralBeamInput): CentralBeamResult {
  try {
    return beamOf(input);
  } catch (err) {
    return emptyResult(input, [
      msg("structure.steelCentral.error.beamNotGenerated", { detail: errorMessage(err) }),
    ]);
  }
}

/** Géométrie commune (développement à l'axe, fenêtre, rives). */
interface BeamGeometry {
  readonly input: CentralBeamInput;
  readonly profile: WorkshopProfile;
  readonly metal: WorkshopProfile["metal"];
  readonly material: Part["material"];
  readonly trace: CentralTrace;
  readonly dev: StringerDevelopment;
  readonly pitch: PiecewiseLinear;
  readonly floorLevel: Mm;
  readonly sStart: Mm;
  readonly sEnd: Mm;
  /** Fin de la coupe au sol (début de la rive basse au-dessus du sol), `null` sans coupe au sol. */
  readonly floorCut: { readonly x0: Mm; readonly x1: Mm } | null;
  readonly zLowAt: (s: Mm) => Mm;
  readonly zHighAt: (s: Mm) => Mm;
  /** Abscisses des jonctions de segments de la trace (ruptures de l'application σ → fibre). */
  readonly breaks: readonly Mm[];
  readonly treadMark: (n: number | undefined) => string;
  readonly hV: Mm;
}

function beamOf(input: CentralBeamInput): CentralBeamResult {
  const { ctx, params, trace, topOffset, checks } = input;
  const sec = params.section;
  const bp = params.beam;
  const pl = params.plates;
  const notes: Message[] = [];
  const errors: Message[] = [];
  const { section, label: sectionLabel } = sectionOf(sec);
  const isTube = sec.kind === "tube";

  // 0. Tube sur trace courbe : non pris en charge (C §2.3).
  if (isTube) {
    const curved = trace.kind !== "straight";
    checks.add(pluginRuleDef(CENTRAL_BEAM_RULES.tubeOnCurve), [
      {
        status: curved ? "violation" : "ok",
        message: msg(
          curved
            ? "structure.steelCentral.check.tubeOnCurve"
            : "structure.steelCentral.check.tubeStraight",
        ),
      },
    ]);
    if (curved) return emptyResult(input, [msg("structure.steelCentral.error.tubeOnCurve")]);
  }
  // 0 bis. Section incohérente (parois plus épaisses que la demi-section) : aucune pièce.
  const invalid = sectionProblems(sec);
  if (invalid.length > 0) return emptyResult(input, invalid);
  if (!isTube && !(sec.diaphragmSpacing > sec.diaphragmThickness)) {
    // Entretoises jointives ou superposées : seules les entretoises imposées (extrémités,
    // joints) sont posées.
    errors.push(
      msg("structure.steelCentral.error.diaphragmSpacing", {
        spacing: dec(sec.diaphragmSpacing, 0),
        thickness: dec(sec.diaphragmThickness, 0),
      }),
    );
  }

  // 1. Développement à l'axe (u = σ) : rives, coupes au sol et d'aplomb.
  const profile = resolveWorkshopProfile(ctx.project.workshop);
  const metal = profile.metal;
  const slope = trace.slope;
  const hV = sec.height * Math.hypot(1, slope);
  const headT = pl.head ? pl.thickness : 0;
  const floorLevel = pl.foot ? pl.thickness : 0;
  const sigmas = trace.nosingSigma;
  const uLo = sigmas[0]! - bp.startExtension;
  const uHi = sigmas[sigmas.length - 1]! + bp.endExtension - headT;
  if (!(uHi > uLo + 1)) {
    return emptyResult(input, [msg("structure.steelCentral.error.beamTooShort")]);
  }
  const step = bp.sampleStep;
  const pitch = pitchOf(trace, uLo, uHi, step);
  const dev = developStringer({
    pitch,
    sigmaA: 0,
    uLo,
    uHi,
    start: "floor",
    end: "arrival",
    upperOffset: -topOffset,
    lowerOffset: topOffset + hV,
    floorLevel,
    housings: [],
  });
  if (dev.outline.length < 3 || !(Math.abs(signedArea(dev.outline)) > 1)) {
    return emptyResult(input, [msg("structure.steelCentral.error.beamBelowFloor")]);
  }
  let sStart = Infinity;
  let sEnd = -Infinity;
  for (const p of dev.outline) {
    sStart = Math.min(sStart, p.x);
    sEnd = Math.max(sEnd, p.x);
  }
  const onFloor = dev.outline.filter((p) => Math.abs(p.y - floorLevel) < 1e-6).map((p) => p.x);
  const floorCut =
    onFloor.length >= 2 && Math.max(...onFloor) - Math.min(...onFloor) > 1e-6
      ? { x0: Math.min(...onFloor), x1: Math.max(...onFloor) }
      : null;
  const cum = cumulativeLengths(trace.curve);
  const breaks = cum.slice(1, -1);
  const baseParts = ctx.baseParts ?? buildBasicParts(ctx.project, ctx.layout, ctx.stepping).parts;
  const markOfTread = new Map(
    baseParts.filter((p) => p.treadNumber !== undefined).map((p) => [p.treadNumber!, p.mark]),
  );
  const g: BeamGeometry = {
    input,
    profile,
    metal,
    material: steelMaterial(params.finish),
    trace,
    dev,
    pitch,
    floorLevel,
    sStart,
    sEnd,
    floorCut,
    zLowAt: (s) => Math.max(polyAt(dev.lowerRive, s), floorLevel),
    zHighAt: (s) => polyAt(dev.upperRive, s),
    breaks,
    treadMark: (n) => (n === undefined ? "" : (markOfTread.get(n) ?? String(n))),
    hV,
  };

  // 2. Tronçons.
  const cuts = placeJoints(g, notes);
  const xs = [sStart, ...cuts.map((c) => c.sigma), sEnd];
  const ivs = xs.slice(0, -1).map((a, i) => ({ a, b: xs[i + 1]! }));
  const jointKind: CentralBeamJoint["kind"] =
    isTube && bp.splice === "bolted" ? "bolted-splice" : "butt-weld";
  if (!isTube && bp.splice === "bolted" && cuts.length > 0) {
    notes.push(msg("structure.steelCentral.note.boxSpliceWelded"));
  }
  const joints: CentralBeamJoint[] = cuts.map((c) => {
    // Cordon bout à bout = périmètre de la section coupée : deux parois verticales (hauteur
    // d'aplomb au joint) et les parois horizontales présentes (semelle basse absente au-dessus
    // de la coupe au sol d'un caisson).
    const h = Math.max(0, g.zHighAt(c.sigma) - g.zLowAt(c.sigma));
    // Même règle que `flangeRange` : semelle basse au-delà de la fin de la coupe au sol.
    const bottom = c.sigma - (floorCut?.x1 ?? sStart) > 1;
    const across = isTube
      ? 2 * sec.width
      : Math.max(0, sec.width - 2 * sec.webThickness) * (bottom ? 2 : 1);
    return {
      sigma: c.sigma,
      reason: c.reason,
      kind: jointKind,
      weld: jointKind === "butt-weld" ? 2 * h + across : 0,
      supportClearance: input.supportSpans.reduce(
        (m, r) =>
          Math.min(
            m,
            c.sigma < r.sigma0 ? r.sigma0 - c.sigma : c.sigma > r.sigma1 ? c.sigma - r.sigma1 : 0,
          ),
        Infinity,
      ),
    };
  });

  // 3. Pièces.
  const built = isTube ? tubeParts(g, ivs, joints) : boxParts(g, ivs, joints);

  // 4. Platines de pied et de tête.
  const firstId = built.segments[0]?.partIds[0];
  const lastSeg = built.segments[built.segments.length - 1];
  const lastId = lastSeg?.partIds[0];
  const firstMark = built.parts.find((p) => p.id === firstId)?.mark ?? "";
  const lastMark = built.parts.find((p) => p.id === lastId)?.mark ?? "";
  const plates = beamPlates(g, firstId, firstMark, lastId, lastMark);
  const assemblies: PartAssembly[] = [...built.assemblies];
  for (const p of plates.parts) {
    const target = p.id === "plate-foot-central" ? built.segments[0] : lastSeg;
    for (const id of target?.partIds.filter((x) => !x.startsWith("central-diaphragm-")) ?? []) {
      assemblies.push({ a: { partId: p.id }, b: { partId: id } });
    }
  }

  // 5. Contrôles.
  addBeamChecks(g, checks, built, joints);

  // 6. Synthèse.
  const buttWeld = joints.reduce((s, j) => s + j.weld, 0);
  const weld = built.fillet + plates.weld;
  const footMid = floorCut ? (floorCut.x0 + floorCut.x1) / 2 : sStart;
  const segCount = built.segments.length;
  notes.push(
    msg("structure.steelCentral.note.beamSummary", {
      section: sectionLabel,
      grade: params.grade,
      topOffset: dec(topOffset, 0),
      height: dec(hV, 0),
      segments: msg("structure.steelCurved.count.segments", { count: segCount }),
      joints: msg("structure.steelCurved.count.buttJoints", {
        count: joints.filter((j) => j.kind === "butt-weld").length,
      }),
      weld: dec(buttWeld, 0),
    }),
  );
  if (!isTube && trace.arcs.length > 0)
    notes.push(msg("structure.steelCentral.note.warpedFlanges"));
  const outOf = built.segments.filter((s) => !s.fits).length;
  if (outOf > 0) {
    errors.push(msg("structure.steelCentral.error.segmentsOutOfFormats", { count: outOf }));
  }
  const segments = built.segments;
  // Pièce qui reçoit un support : le dessus de la poutre, soit la barre du tube, soit la
  // semelle haute du tronçon d'un caisson (la console ou le retour d'un support plié y est posé,
  // les boulons d'un support vissé la traversent).
  const partAt = (sigma: Mm): string | undefined => {
    if (segments.length === 0) return undefined;
    const s = Math.min(sEnd, Math.max(sStart, sigma));
    const seg = segments.find((x) => s >= x.sigma0 - 1e-9 && s <= x.sigma1 + 1e-9) ?? segments[0]!;
    const top = seg.partIds.find((id) => id.startsWith("central-flange-top-"));
    return top ?? seg.partIds[0];
  };
  return {
    parts: [...built.parts, ...plates.parts],
    segments,
    joints,
    assemblies,
    buttWeld,
    weld,
    section,
    sectionLabel,
    spanH: Math.max(0, uHi - footMid),
    slope,
    topAt: (sigma) => trace.nosingZ(sigma) - topOffset,
    partAt,
    notes,
    errors,
    extent: { sigma0: sStart, sigma1: sEnd },
    verticalHeight: hV,
    bottomAt: (sigma) => trace.nosingZ(sigma) - topOffset - hV,
    development: dev,
  };
}

/**
 * Ligne des nez sur la trace, polyligne pour `developStringer` : nœuds aux nez, aux naissances
 * et aux bornes ; entre deux nœuds où la courbe n'est pas affine (palier, balancement, raccord
 * monotone), échantillonnage au pas Δσ (B §5.2).
 */
function pitchOf(trace: CentralTrace, uLo: Mm, uHi: Mm, step: Mm): PiecewiseLinear {
  const F = trace.nosingZ;
  const base = [
    uLo - step,
    uHi + step,
    ...trace.nosingSigma,
    ...trace.naissances.map((n) => n.sigma),
  ].sort((a, b) => a - b);
  const xs = new Set<number>(base);
  for (let i = 0; i + 1 < base.length; i++) {
    const a = base[i]!;
    const b = base[i + 1]!;
    if (!(b - a > step)) continue;
    let linear = true;
    for (const t of [0.25, 0.5, 0.75]) {
      const x = a + (b - a) * t;
      if (Math.abs(F(x) - (F(a) + (F(b) - F(a)) * t)) > LINEAR_TOL) {
        linear = false;
        break;
      }
    }
    if (linear) continue;
    for (let x = a + step; x < b - 1e-6; x += step) xs.add(x);
  }
  return new PiecewiseLinear([...xs].map((x) => ({ x, y: F(x) })));
}

// ------------------------------------------------------------------ Joints

interface Cut {
  readonly sigma: Mm;
  readonly reason: "naissance" | "format" | "bar";
  readonly naissance?: Mm;
  readonly onArc?: boolean;
}

/**
 * Joints : naissances ± δ dans la partie droite (caisson sur trace débillardée), hors des
 * supports ± marge, puis coupes de format (caisson : milieu de la plus longue portion d'arc,
 * sinon milieu du tronçon) ou de longueur de barre (tube : partage égal), tronçons ≥ longueur
 * minimale. Même algorithme que `steel-curved`, distances comptées sur l'axe.
 */
function placeJoints(g: BeamGeometry, notes: Message[]): Cut[] {
  const { input, sStart, sEnd, trace, metal } = g;
  const bp = input.params.beam;
  const isTube = input.params.section.kind === "tube";
  const margin = bp.jointSupportMargin;
  const forbidden = input.supportSpans.map((r) => ({
    lo: r.sigma0 - margin,
    hi: r.sigma1 + margin,
  }));
  const minSeg = bp.minSegmentLength;
  const limitLo = sStart + minSeg;
  const limitHi = sEnd - minSeg;
  const freeFrom = (s: Mm, dir: 1 | -1, lo: Mm, hi: Mm): Mm | null => {
    let x = s;
    for (let guard = 0; guard < 400; guard++) {
      if (x < lo - 1e-9 || x > hi + 1e-9) return null;
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
  const cuts: Cut[] = [];
  const accept = (s: Mm, reason: Cut["reason"], extra: Partial<Cut> = {}): boolean => {
    if (s < limitLo - 1e-9 || s > limitHi + 1e-9) return false;
    if (cuts.some((c) => Math.abs(c.sigma - s) < minSeg)) return false;
    cuts.push({ sigma: s, reason, ...extra });
    cuts.sort((x, y) => x.sigma - y.sigma);
    return true;
  };
  if (!isTube) {
    for (const b of trace.naissances) {
      if (b.sigma <= sStart || b.sigma >= sEnd) continue;
      const arcArc = b.before === "arc" && b.after === "arc";
      const dir: 1 | -1 = b.after === "line" ? 1 : b.before === "line" ? -1 : 1;
      const target = arcArc ? b.sigma : b.sigma + dir * bp.jointOffset;
      const lo = dir > 0 ? b.sigma : limitLo;
      const hi = dir > 0 ? limitHi : b.sigma;
      let s = freeFrom(target, dir, lo, hi);
      let onArc = false;
      if (s === null) {
        s = freeFrom(target, dir > 0 ? -1 : 1, limitLo, limitHi);
        onArc = s !== null && (dir > 0 ? s < b.sigma : s > b.sigma);
      }
      if (s === null || !accept(s, "naissance", { naissance: b.sigma, onArc })) {
        notes.push(
          msg("structure.steelCentral.note.springingNoCut", {
            sigma: dec(b.sigma, 0),
            minSegment: dec(minSeg, 0),
          }),
        );
      } else if (onArc) {
        notes.push(
          msg("structure.steelCentral.note.springingCutOnArc", {
            sigma: dec(b.sigma, 0),
            cut: dec(s, 0),
          }),
        );
      } else if (!arcArc && Math.abs(s - b.sigma) < bp.jointOffset - 1e-6) {
        notes.push(
          msg("structure.steelCentral.note.springingCutClose", {
            sigma: dec(b.sigma, 0),
            distance: dec(Math.abs(s - b.sigma), 0),
            offset: dec(bp.jointOffset, 0),
          }),
        );
      }
    }
  }
  const intervals = (): { a: Mm; b: Mm }[] => {
    const xs = [sStart, ...cuts.map((c) => c.sigma), sEnd];
    return xs.slice(0, -1).map((a, i) => ({ a, b: xs[i + 1]! }));
  };
  const maxBar = Math.max(...metal.barLengths);
  const tooLong = (a: Mm, b: Mm): boolean =>
    isTube ? minAreaRect(clipX(g.dev.outline, a, b)).length > maxBar + 1e-6 : !boxFits(g, a, b);
  const unsplittable = new Set<string>();
  for (let iter = 0; iter < 24; iter++) {
    const bad = intervals().find(
      (iv) => tooLong(iv.a, iv.b) && !unsplittable.has(`${iv.a}|${iv.b}`),
    );
    if (!bad) break;
    let mid = (bad.a + bad.b) / 2;
    if (isTube) {
      // Partage égal en barres de longueur ≤ barre maximale : première coupe.
      const len = minAreaRect(clipX(g.dev.outline, bad.a, bad.b)).length;
      const pieces = Math.max(2, Math.ceil(len / maxBar));
      mid = bad.a + (bad.b - bad.a) / pieces;
    } else {
      let best: { lo: Mm; hi: Mm } | null = null;
      for (const a of trace.arcs) {
        const lo = Math.max(a.sigma0, bad.a);
        const hi = Math.min(a.sigma1, bad.b);
        if (hi - lo > (best ? best.hi - best.lo : 0)) best = { lo, hi };
      }
      if (best) mid = (best.lo + best.hi) / 2;
    }
    const s = nearestFree(mid, bad.a + minSeg, bad.b - minSeg);
    if (s === null || !accept(s, isTube ? "bar" : "format")) unsplittable.add(`${bad.a}|${bad.b}`);
  }
  return cuts;
}

// ------------------------------------------------------------------ Caisson

/** Flasque (gauche ou droite) : développement de sa fibre neutre et contour développé. */
interface Web {
  readonly side: "left" | "right";
  readonly dev: FiberDevelopment;
  readonly outline: Vec2[];
  readonly upper: Vec2[];
  readonly lower: Vec2[];
}

function websOf(g: BeamGeometry): readonly [Web, Web] {
  const sec = g.input.params.section;
  const dw = sec.width / 2 - sec.webThickness / 2;
  const make = (side: "left" | "right"): Web => {
    const dev = fiberDevelopment(g.trace.curve, dw, side);
    return {
      side,
      dev,
      outline: remapX(g.dev.outline, dev.toFiber, g.breaks, true),
      upper: remapX(g.dev.upperRive, dev.toFiber, g.breaks, false),
      lower: remapX(g.dev.lowerRive, dev.toFiber, g.breaks, false),
    };
  };
  return [make("left"), make("right")];
}

const websCache = new WeakMap<BeamGeometry, readonly [Web, Web]>();
function websFor(g: BeamGeometry): readonly [Web, Web] {
  let w = websCache.get(g);
  if (!w) {
    w = websOf(g);
    websCache.set(g, w);
  }
  return w;
}

/** Portée de semelle sur [a ; b] (rive au-dessus du sol) : haute ou basse. */
function flangeRange(g: BeamGeometry, which: "top" | "bottom", a: Mm, b: Mm): [Mm, Mm] | null {
  const start = which === "top" ? g.sStart : (g.floorCut?.x1 ?? g.sStart);
  const lo = Math.max(a, start);
  const hi = Math.min(b, g.sEnd);
  return hi - lo > 1 ? [lo, hi] : null;
}

/** Longueur 3D d'une rive (à l'axe) sur [lo ; hi]. */
function riveLength(g: BeamGeometry, which: "top" | "bottom", lo: Mm, hi: Mm): Mm {
  const z = (s: Mm): Mm => (which === "top" ? g.zHighAt(s) : polyAt(g.dev.lowerRive, s));
  const xs = rowsBetween(g, lo, hi);
  let len = 0;
  for (let i = 1; i < xs.length; i++) {
    len += Math.hypot(xs[i]! - xs[i - 1]!, z(xs[i]!) - z(xs[i - 1]!));
  }
  return len;
}

/** Le tronçon [a ; b] du caisson tient-il dans les formats de tôle (flasques et semelles) ? */
function boxFits(g: BeamGeometry, a: Mm, b: Mm): boolean {
  const sec = g.input.params.section;
  const wf = Math.max(0, sec.width - 2 * sec.webThickness);
  for (const w of websFor(g)) {
    const box = minAreaRect(clipX(w.outline, w.dev.toFiber(a), w.dev.toFiber(b)));
    if (!fitsSheet(g.metal, box.length, box.width)) return false;
  }
  for (const which of ["top", "bottom"] as const) {
    const r = flangeRange(g, which, a, b);
    if (r && !fitsSheet(g.metal, riveLength(g, which, r[0], r[1]), wf)) return false;
  }
  return true;
}

/**
 * Abscisses d'échantillonnage sur [a ; b] : nœuds de la ligne des nez, sommets du contour
 * développé, arcs de la trace au pas Δσ (cf. `curvedSolidRows`).
 */
function rowsBetween(g: BeamGeometry, a: Mm, b: Mm): Mm[] {
  const xs = new Set<number>([a, b]);
  for (const x of g.pitch.xs) if (x > a + JOINT_TOLERANCE && x < b - JOINT_TOLERANCE) xs.add(x);
  for (const p of g.dev.outline) {
    if (p.x > a + JOINT_TOLERANCE && p.x < b - JOINT_TOLERANCE) xs.add(p.x);
  }
  const step = g.input.params.beam.sampleStep;
  for (const arc of g.trace.arcs) {
    const lo = Math.max(arc.sigma0, a);
    const hi = Math.min(arc.sigma1, b);
    for (let x = lo; x < hi - JOINT_TOLERANCE; x += step) if (x > a + JOINT_TOLERANCE) xs.add(x);
    if (hi > lo && hi < b - JOINT_TOLERANCE) xs.add(hi);
  }
  const sorted = [...xs].sort((u, v) => u - v);
  return sorted.filter((x, i) => i === 0 || x - sorted[i - 1]! > JOINT_TOLERANCE || x === b);
}

/** Subdivisions de la coupe au sol ajoutées aux génératrices d'une flasque (`webRows`). */
const FLOOR_CUT_ROWS = 16;

/**
 * Génératrices d'une flasque sur [a ; b] : `rowsBetween`, plus des abscisses régulières sur la
 * coupe au sol. La pointe au sol a une hauteur nulle (génératrice écartée) : sans elles, un
 * premier tronçon court (dessus de poutre bas, joint proche du départ) n'avait qu'une
 * génératrice valide et son solide réglé était incohérent.
 */
function webRows(g: BeamGeometry, a: Mm, b: Mm): Mm[] {
  const xs = rowsBetween(g, a, b);
  const fc = g.floorCut;
  if (!fc) return xs;
  const lo = Math.max(a, fc.x0);
  const hi = Math.min(b, fc.x1);
  if (!(hi - lo > 2 * JOINT_TOLERANCE * FLOOR_CUT_ROWS)) return xs;
  const extra = Array.from(
    { length: FLOOR_CUT_ROWS - 1 },
    (_, k) => lo + ((hi - lo) * (k + 1)) / FLOOR_CUT_ROWS,
  );
  const sorted = [...xs, ...extra].sort((u, v) => u - v);
  return sorted.filter((x, i) => i === 0 || x - sorted[i - 1]! > JOINT_TOLERANCE);
}

interface BuiltBeam {
  readonly parts: Part[];
  readonly segments: CentralBeamSegment[];
  readonly assemblies: PartAssembly[];
  /** Cordons d'angle des pièces de poutre (mm). */
  readonly fillet: Mm;
  /** Contrôles par tronçon. */
  readonly formatParts: { part: Part; box: { length: Mm; width: Mm }; fits: boolean }[];
  readonly laserParts: Part[];
  readonly rollItems: CheckItem[];
  readonly barItems: CheckItem[];
  readonly vents: { placed: number; missing: Message[] };
  readonly webs?: readonly [Web, Web];
}

const segmentName = (key: MessageKey, wholeKey: MessageKey, i: number, count: number): Message =>
  count === 1 ? msg(wholeKey) : msg(key, { index: i + 1, count });

/** Vertical (x, z bas → z haut) d'un développé, entre les rives (coupes au sol comprises). */
function verticalOf(
  upper: readonly Vec2[],
  lower: readonly Vec2[],
  floorLevel: Mm,
  x: Mm,
  toFlat: (p: Vec2) => Vec2,
): [Vec2, Vec2] | null {
  const lo = Math.max(polyAt(lower, x), floorLevel);
  const hi = polyAt(upper, x);
  return hi > lo ? [toFlat(V.vec(x, lo)), toFlat(V.vec(x, hi))] : null;
}

/** Évent dans un développé : près de l'extrémité `end` (vers `dir`), à mi-hauteur. */
function ventNear(
  outline: readonly Vec2[],
  upper: readonly Vec2[],
  lower: readonly Vec2[],
  floorLevel: Mm,
  end: Mm,
  dir: 1 | -1,
  limit: Mm,
  diameter: Mm,
): Vec2 | null {
  // Première abscisse (depuis l'extrémité) où la hauteur laisse 3 diamètres ; centre à un
  // diamètre au moins de la coupe d'extrémité, à mi-hauteur (diamètre : paramètre « à valider »).
  for (let k = 0; k < 400; k++) {
    const x = end + dir * diameter * (1 + k * 0.5);
    if ((dir > 0 && x > limit) || (dir < 0 && x < limit)) return null;
    const lo = Math.max(polyAt(lower, x), floorLevel);
    const hi = polyAt(upper, x);
    if (hi - lo >= 3 * diameter) {
      const c = V.vec(x, (lo + hi) / 2);
      const ring = holePolygon(c, diameter);
      if (ring.every((p) => pointInPolygon(p, outline, 1e-6) === "inside")) return c;
    }
  }
  return null;
}

function boxParts(
  g: BeamGeometry,
  ivs: readonly { a: Mm; b: Mm }[],
  joints: readonly CentralBeamJoint[],
): BuiltBeam {
  const { input, trace, floorLevel, profile, material } = g;
  const { params } = input;
  const sec = params.section;
  const tw = sec.webThickness;
  const tf = sec.flangeThickness;
  const td = sec.diaphragmThickness;
  const wf = Math.max(0, sec.width - 2 * tw);
  // Entraxe des entretoises intermédiaires ; jointives ou superposées (entraxe ≤ épaisseur,
  // erreur signalée par `beamOf`) : aucune entretoise intermédiaire.
  const spacing = sec.diaphragmSpacing > td ? sec.diaphragmSpacing : Infinity;
  const galvanized = params.finish === "galvanized";
  const ventD = sec.ventDiameter;
  const webs = websFor(g);
  const count = ivs.length;
  const parts: Part[] = [];
  const segments: CentralBeamSegment[] = [];
  const assemblies: PartAssembly[] = [];
  const formatParts: BuiltBeam["formatParts"] = [];
  const laserParts: Part[] = [];
  const rollItems: CheckItem[] = [];
  const vents = { placed: 0, missing: [] as Message[] };
  let fillet = 0;
  const webMark = (side: "left" | "right", i: number): string =>
    `${side === "left" ? "FG" : "FD"}${i + 1}`;
  const webId = (side: "left" | "right", i: number): string => `central-web-${side}-${i + 1}`;
  const tops: Part[] = [];
  const bottoms: Part[] = [];
  const segParts: string[][] = ivs.map(() => []);

  // Entretoises : positions sur l'axe (extrémités d'aplomb, après chaque joint, entraxe max).
  const fixed: Mm[] = [];
  const startFace = g.zHighAt(g.sStart) - g.zLowAt(g.sStart);
  if (startFace > 2 * tf + 1) fixed.push(g.sStart + td / 2);
  for (const j of joints) fixed.push(j.sigma + td / 2);
  fixed.push(g.sEnd - td / 2);
  fixed.sort((a, b) => a - b);
  // Entre deux positions imposées (ou depuis le début de la poutre), entretoises intermédiaires
  // équidistantes à entraxe ≤ `diaphragmSpacing` (celles de hauteur nulle, dans la pointe au
  // sol, sont omises plus bas).
  const positions: Mm[] = [];
  let prev = g.sStart;
  for (const f of fixed) {
    const gap = f - prev;
    const n = Number.isFinite(spacing) ? Math.max(0, Math.ceil(gap / spacing - 1e-9) - 1) : 0;
    for (let k = 1; k <= n; k++) positions.push(prev + (gap * k) / (n + 1));
    positions.push(f);
    prev = f;
  }

  for (let i = 0; i < count; i++) {
    const { a, b } = ivs[i]!;
    let fits = true;
    // Flasques.
    for (const w of webs) {
      const x0 = w.dev.toFiber(a);
      const x1 = w.dev.toFiber(b);
      const outline = clipX(w.outline, x0, x1);
      const box = minAreaRect(outline);
      let xMin = Infinity;
      let xMax = -Infinity;
      for (const p of outline) {
        xMin = Math.min(xMin, p.x);
        xMax = Math.max(xMax, p.x);
      }
      // Vue de l'extérieur du caisson : flasque gauche vue de la gauche (montée vers les x
      // décroissants), flasque droite vue de la droite.
      const mirrored = w.side === "left";
      const toFlat = (p: Vec2): Vec2 =>
        mirrored ? V.vec(xMax - p.x, p.y) : V.vec(p.x - xMin, p.y);
      const vertical = (x: Mm) => verticalOf(w.upper, w.lower, floorLevel, x, toFlat);
      const lines: FlatPattern["lines"][number][] = [];
      let rolled = 0;
      let hasArc = false;
      for (const p of w.dev.pieces) {
        if (p.kind !== "arc") continue;
        const lo = Math.max(p.fiber0, x0);
        const hi = Math.min(p.fiber1, x1);
        if (!(hi - lo > 1e-6)) continue;
        hasArc = true;
        rolled += hi - lo;
        const neutralR = p.fiberRadius!;
        const innerR = neutralR - tw / 2;
        let zMin = Infinity;
        let zMax = -Infinity;
        for (const q of outline) {
          if (q.x < lo - 1e-6 || q.x > hi + 1e-6) continue;
          zMin = Math.min(zMin, q.y);
          zMax = Math.max(zMax, q.y);
        }
        for (const x of [lo, hi]) {
          zMin = Math.min(zMin, Math.max(polyAt(w.lower, x), floorLevel));
          zMax = Math.max(zMax, polyAt(w.upper, x));
        }
        rollItems.push({
          value: zMax - zMin,
          label: msg("structure.steelCurved.check.arcItem", {
            mark: webMark(w.side, i),
            radius: dec(innerR, 0),
          }),
          partId: webId(w.side, i),
        });
        // Au moins deux intervalles : le libellé est porté par une ligne intérieure (milieu de la
        // zone roulée), loin des repères de naissance et de joint tracés aux bords.
        const n = Math.max(2, Math.floor((hi - lo) / params.beam.rollLineSpacing));
        const labelled = Math.ceil(n / 2);
        for (let k = 0; k <= n; k++) {
          const seg = vertical(lo + ((hi - lo) * k) / n);
          if (!seg) continue;
          lines.push({
            kind: "roll",
            a: seg[0],
            b: seg[1],
            ...(k === labelled
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
        const seg = vertical(w.dev.toFiber(s));
        if (seg) {
          lines.push({
            kind: "joint",
            a: seg[0],
            b: seg[1],
            label: msg("structure.steelCurved.flatLine.joint", { mark: webMark(w.side, other) }),
          });
        }
      };
      if (i > 0) jointAt(a, i - 1);
      if (i < count - 1) jointAt(b, i + 1);
      // Reports des nez et des supports de marche.
      trace.nosingSigma.forEach((s, k) => {
        if (s < a - 1e-6 || s > b + 1e-6) return;
        const seg = vertical(w.dev.toFiber(s));
        if (seg) lines.push({ kind: "mark", a: seg[0], b: seg[1], label: textMessage(`N${k}`) });
      });
      for (const sp of input.supportSpans) {
        [sp.sigma0, sp.sigma1].forEach((s, q) => {
          if (s < a - 1e-6 || s > b + 1e-6) return;
          const seg = vertical(w.dev.toFiber(s));
          if (!seg) return;
          lines.push({
            kind: "mark",
            a: seg[0],
            b: seg[1],
            ...(q === 0
              ? {
                  label: msg("structure.steel.flatLine.support", {
                    mark: g.treadMark(sp.treadNumber),
                  }),
                }
              : {}),
          });
        });
      }
      // Évents extérieurs (flasque gauche) aux extrémités du corps creux.
      const holes: Vec2[][] = [];
      if (galvanized && w.side === "left") {
        const ends: [Mm, 1 | -1, Mm][] = [];
        if (i === 0) ends.push([x0, 1, x1]);
        if (i === count - 1) ends.push([x1, -1, x0]);
        for (const [end, dir, limit] of ends) {
          const c = ventNear(outline, w.upper, w.lower, floorLevel, end, dir, limit, ventD);
          if (c) {
            const ring = holePolygon(toFlat(c), ventD);
            holes.push(signedArea(ring) > 0 ? ring.reverse() : ring);
            vents.placed++;
          } else vents.missing.push(textMessage(webMark(w.side, i)));
        }
      }
      // Repère.
      const xm = (x0 + x1) / 2;
      const ym = (Math.max(polyAt(w.lower, xm), floorLevel) + polyAt(w.upper, xm)) / 2;
      const la = toFlat(V.vec(xm - 20, ym));
      const lb = toFlat(V.vec(xm + 20, ym));
      const [ta, tb] = mirrored ? [lb, la] : [la, lb];
      lines.push({ kind: "text", a: ta, b: tb, label: textMessage(webMark(w.side, i)) });
      let outer = outline.map(toFlat);
      if (mirrored) outer = outer.reverse();
      const flat: FlatPattern = {
        outline: { outer, holes },
        lines,
        thickness: tw,
        reference: {
          kind: "neutral-fiber",
          description: msg(
            w.side === "left"
              ? "structure.steelCentral.reference.webLeft"
              : "structure.steelCentral.reference.webRight",
            { segment: i + 1, segments: count, ascent: ascentDirection(mirrored) },
          ),
        },
      };
      // Solide : surface réglée sur la face intérieure, épaissie vers l'extérieur.
      const sgn = w.side === "left" ? 1 : -1;
      const inner = sec.width / 2 - tw;
      const lower: Vec3[] = [];
      const upper: Vec3[] = [];
      const normals: Vec2[] = [];
      for (const s of webRows(g, a, b)) {
        const zl = g.zLowAt(s);
        const zh = g.zHighAt(s);
        if (!(zh - zl > 0.1)) continue;
        const n = V.scale(trace.left(s), sgn);
        const p = V.addScaled(trace.point(s), n, inner);
        lower.push(v3(p, zl));
        upper.push(v3(p, zh));
        normals.push(n);
      }
      const meas = plateMeasures(flat.outline, tw);
      const endWeld = i < count - 1 ? (joints[i]?.weld ?? 0) : 0;
      // Part du cordon bout à bout portée par la flasque : sa hauteur au joint.
      const endH = i < count - 1 ? Math.max(0, g.zHighAt(b) - g.zLowAt(b)) : 0;
      const buttShare = endWeld > 0 ? endH : 0;
      const id = webId(w.side, i);
      const part: Part = {
        id,
        mark: webMark(w.side, i),
        category: "stringer",
        name: segmentName(
          w.side === "left"
            ? "structure.steelCentral.part.webLeft"
            : "structure.steelCentral.part.webRight",
          w.side === "left"
            ? "structure.steelCentral.part.webLeftWhole"
            : "structure.steelCentral.part.webRightWhole",
          i,
          count,
        ),
        material,
        solid:
          lower.length >= 2
            ? { kind: "ruled", a: lower, b: upper, thickness: tw, normals }
            : { kind: "ruled", a: [], b: [], thickness: tw, normals: [] },
        flat,
        section: hasArc
          ? msg("structure.steelCurved.section.rolledPlate", {
              thickness: dec(tw, 0),
              grade: params.grade,
              width: dec(Math.ceil(box.width), 0),
            })
          : msg("structure.steel.section.plate", { thickness: dec(tw, 0) }),
        stock: { length: box.length, width: box.width, thickness: tw },
        quantities: {
          ...steelQuantities(
            {
              volumeMm3: meas.volumeMm3,
              treatedSurfaceMm2: meas.treatedSurfaceMm2,
              length: box.length,
              weld: buttShare,
              buttWeld: buttShare,
              cuts: 1,
              laserCut: meas.laserCut,
              holes: holes.length,
            },
            profile,
          ),
          [QUANTITY_ROLLED_LENGTH_MM]: rolled,
        },
      };
      const fit = fitsSheet(g.metal, box.length, box.width);
      fits &&= fit;
      formatParts.push({ part, box, fits: fit });
      laserParts.push(part);
      parts.push(part);
      segParts[i]!.push(id);
    }
    // Semelles.
    for (const which of ["top", "bottom"] as const) {
      const r = flangeRange(g, which, a, b);
      if (!r) continue;
      const [lo, hi] = r;
      const len = riveLength(g, which, lo, hi);
      const onArc = trace.arcs.some((x) => x.sigma1 > lo + 1e-6 && x.sigma0 < hi - 1e-6);
      const markPrefix = which === "top" ? "SH" : "SB";
      const flat = rectFlat(
        len,
        wf,
        tf,
        [],
        0,
        markPrefix,
        msg(
          onArc
            ? "structure.steelCentral.reference.flangeWarped"
            : "structure.steelCentral.reference.flange",
          { segment: i + 1, segments: count },
        ),
      );
      // Solide : balayage de la section (b − 2t_w) × t_f le long de la rive à l'axe.
      const path: Vec3[] = [];
      for (const s of rowsBetween(g, lo, hi)) {
        const z = which === "top" ? g.zHighAt(s) : polyAt(g.dev.lowerRive, s);
        path.push(v3(trace.point(s), z));
      }
      const v0 = which === "top" ? -tf : 0;
      const sectionPts = [
        V.vec(-wf / 2, v0),
        V.vec(wf / 2, v0),
        V.vec(wf / 2, v0 + tf),
        V.vec(-wf / 2, v0 + tf),
      ];
      const meas = plateMeasures(flat.outline, tf);
      const own = 2 * len; // cordons d'angle flasques ↔ semelle (deux rives)
      const endWeld = i < count - 1 && (joints[i]?.weld ?? 0) > 0 && hi >= b - 1e-6 ? wf : 0;
      fillet += own;
      const id = `central-flange-${which}-${i + 1}`;
      const part: Part = {
        id,
        mark: markPrefix,
        category: "stringer",
        name: segmentName(
          which === "top"
            ? "structure.steelCentral.part.flangeTop"
            : "structure.steelCentral.part.flangeBottom",
          which === "top"
            ? "structure.steelCentral.part.flangeTopWhole"
            : "structure.steelCentral.part.flangeBottomWhole",
          i,
          count,
        ),
        material,
        solid: { kind: "sweep", path, section: { outer: sectionPts, holes: [] } },
        flat,
        section: msg("structure.steel.section.plate", { thickness: dec(tf, 0) }),
        stock: { length: len, width: wf, thickness: tf },
        quantities: steelQuantities(
          {
            volumeMm3: meas.volumeMm3,
            treatedSurfaceMm2: meas.treatedSurfaceMm2,
            length: len,
            weld: own + endWeld,
            buttWeld: endWeld,
            cuts: 1,
            laserCut: meas.laserCut,
          },
          profile,
        ),
      };
      const fit = fitsSheet(g.metal, len, wf);
      fits &&= fit;
      formatParts.push({ part, box: { length: len, width: wf }, fits: fit });
      laserParts.push(part);
      (which === "top" ? tops : bottoms).push(part);
      parts.push(part);
      segParts[i]!.push(id);
      for (const w of ["left", "right"] as const) {
        assemblies.push({ a: { partId: id }, b: { partId: webId(w, i) } });
      }
    }
    segments.push({ index: i, sigma0: a, sigma1: b, partIds: segParts[i]!, fits });
  }

  // Entretoises.
  const diaphragms: Part[] = [];
  positions.forEach((s, j) => {
    const i = Math.max(
      0,
      ivs.findIndex((iv) => s >= iv.a - 1e-9 && s <= iv.b + 1e-9),
    );
    const zh = g.zHighAt(s);
    const zl = g.zLowAt(s);
    const lowerRive = polyAt(g.dev.lowerRive, s);
    const dzds = (g.zHighAt(s + 1) - g.zHighAt(s - 1)) / 2;
    const tfv = tf * Math.hypot(1, dzds);
    const bottomFlange = lowerRive > floorLevel + 1e-6;
    const z0 = zl + (bottomFlange ? tfv : 0);
    const h = zh - tfv - z0;
    if (!(h > 1)) return;
    const holesAt = galvanized ? [V.vec(wf / 2, h / 2)] : [];
    const canVent = galvanized && h > 2 * ventD && wf > 2 * ventD;
    if (galvanized) {
      if (canVent) vents.placed++;
      else vents.missing.push(msg("structure.steelCentral.part.diaphragm", { index: j + 1 }));
    }
    const flat = rectFlat(
      wf,
      h,
      td,
      canVent ? holesAt : [],
      ventD,
      "EC",
      msg("structure.steelCentral.reference.diaphragm", { index: j + 1 }),
    );
    const left = trace.left(s);
    const t = trace.tangent(s);
    const o = V.addScaled(V.addScaled(trace.point(s), left, -wf / 2), t, -td / 2);
    const perimeter = 2 * (wf + h);
    fillet += perimeter;
    const id = `central-diaphragm-${j + 1}`;
    const base = plateObject(
      id,
      msg("structure.steelCentral.part.diaphragm", { index: j + 1 }),
      flat,
      td,
      perimeter,
      material,
      profile,
      {
        origin: v3(o, z0),
        xAxis: h3(left),
        yAxis: { x: 0, y: 0, z: 1 },
        zAxis: h3(t),
        depth: td,
      },
    );
    const part: Part = { ...base, category: "stringer", mark: "EC" };
    diaphragms.push(part);
    laserParts.push(part);
    segParts[i]!.push(id);
    for (const w of ["left", "right"] as const) {
      assemblies.push({ a: { partId: id }, b: { partId: webId(w, i) } });
    }
  });

  // Tronçons consécutifs (joints soudés bout à bout).
  for (let i = 1; i < count; i++) {
    for (const w of ["left", "right"] as const) {
      assemblies.push({ a: { partId: webId(w, i - 1) }, b: { partId: webId(w, i) } });
    }
    for (const which of ["top", "bottom"] as const) {
      const pa = `central-flange-${which}-${i}`;
      const pb = `central-flange-${which}-${i + 1}`;
      if (segParts[i - 1]!.includes(pa) && segParts[i]!.includes(pb)) {
        assemblies.push({ a: { partId: pa }, b: { partId: pb } });
      }
    }
  }

  // Repères des pièces identiques (semelles, entretoises).
  const marked = new Map<string, Part>();
  for (const p of [
    ...markGroups(tops, "SH", () => null),
    ...markGroups(bottoms, "SB", () => null),
    ...markGroups(diaphragms, "EC", () => null),
  ]) {
    marked.set(p.id, p);
  }
  const all = [...parts, ...diaphragms].map((p) => marked.get(p.id) ?? p);
  const byId = new Map(all.map((p) => [p.id, p]));
  return {
    parts: all,
    segments,
    assemblies,
    fillet,
    formatParts: formatParts.map((f) => ({ ...f, part: byId.get(f.part.id) ?? f.part })),
    laserParts: laserParts.map((p) => byId.get(p.id) ?? p),
    rollItems,
    barItems: [],
    vents,
    webs,
  };
}

// ------------------------------------------------------------------ Tube

function tubeParts(
  g: BeamGeometry,
  ivs: readonly { a: Mm; b: Mm }[],
  joints: readonly CentralBeamJoint[],
): BuiltBeam {
  const { input, trace, floorLevel, profile, material, dev } = g;
  const { params } = input;
  const sec = params.section;
  const count = ivs.length;
  const area = tubeSection(sec.height, sec.width, sec.wallThickness).area;
  const galvanized = params.finish === "galvanized";
  const ventD = sec.ventDiameter;
  // Corps creux : la poutre entière (barres soudées bout à bout) ou chaque barre (éclisses).
  const bodies = joints.length > 0 && joints[0]!.kind === "bolted-splice";
  const parts: Part[] = [];
  const segments: CentralBeamSegment[] = [];
  const assemblies: PartAssembly[] = [];
  const barItems: CheckItem[] = [];
  const vents = { placed: 0, missing: [] as Message[] };
  const maxBar = Math.max(...g.metal.barLengths);
  const p0 = trace.point(0);
  const t = trace.tangent(0);
  const left = trace.left(0);
  for (let i = 0; i < count; i++) {
    const { a, b } = ivs[i]!;
    const mark = `TC${i + 1}`;
    const id = `central-tube-${i + 1}`;
    const outline = clipX(dev.outline, a, b);
    const box = minAreaRect(outline);
    let xMin = Infinity;
    for (const p of outline) xMin = Math.min(xMin, p.x);
    const toFlat = (p: Vec2): Vec2 => V.vec(p.x - xMin, p.y);
    const vertical = (x: Mm) => verticalOf(dev.upperRive, dev.lowerRive, floorLevel, x, toFlat);
    const lines: FlatPattern["lines"][number][] = [];
    if (i > 0) {
      const seg = vertical(a);
      if (seg) {
        lines.push({
          kind: "joint",
          a: seg[0],
          b: seg[1],
          label: tubeJointLabel(joints[i - 1]!, `TC${i}`),
        });
      }
    }
    if (i < count - 1) {
      const seg = vertical(b);
      if (seg) {
        lines.push({
          kind: "joint",
          a: seg[0],
          b: seg[1],
          label: tubeJointLabel(joints[i]!, `TC${i + 2}`),
        });
      }
    }
    trace.nosingSigma.forEach((s, k) => {
      if (s < a - 1e-6 || s > b + 1e-6) return;
      const seg = vertical(s);
      if (seg) lines.push({ kind: "mark", a: seg[0], b: seg[1], label: textMessage(`N${k}`) });
    });
    for (const sp of input.supportSpans) {
      [sp.sigma0, sp.sigma1].forEach((s, q) => {
        if (s < a - 1e-6 || s > b + 1e-6) return;
        const seg = vertical(s);
        if (!seg) return;
        lines.push({
          kind: "mark",
          a: seg[0],
          b: seg[1],
          ...(q === 0
            ? {
                label: msg("structure.steel.flatLine.support", {
                  mark: g.treadMark(sp.treadNumber),
                }),
              }
            : {}),
        });
      });
    }
    const holes: Vec2[][] = [];
    if (galvanized) {
      const ends: [Mm, 1 | -1, Mm][] = [];
      if (i === 0 || bodies) ends.push([a, 1, b]);
      if (i === count - 1 || bodies) ends.push([b, -1, a]);
      for (const [end, dir, limit] of ends) {
        const c = ventNear(
          outline,
          dev.upperRive,
          dev.lowerRive,
          floorLevel,
          end,
          dir,
          limit,
          ventD,
        );
        if (c) {
          const ring = holePolygon(toFlat(c), ventD);
          holes.push(signedArea(ring) > 0 ? ring.reverse() : ring);
          vents.placed++;
        } else vents.missing.push(textMessage(mark));
      }
    }
    const xm = (a + b) / 2;
    const ym = (Math.max(polyAt(dev.lowerRive, xm), floorLevel) + polyAt(dev.upperRive, xm)) / 2;
    lines.push({
      kind: "text",
      a: toFlat(V.vec(xm - 20, ym)),
      b: toFlat(V.vec(xm + 20, ym)),
      label: textMessage(mark),
    });
    const flat: FlatPattern = {
      outline: { outer: outline.map(toFlat), holes },
      lines,
      thickness: sec.wallThickness,
      reference: {
        kind: "face",
        description: msg("structure.steelCentral.reference.tube", {
          segment: i + 1,
          segments: count,
          ascent: ascentDirection(false),
        }),
      },
    };
    // Longueur d'axe : aire de la vue de face / H (prisme de hauteur perpendiculaire H).
    const axisLength = Math.abs(signedArea(outline)) / sec.height;
    const cutLength = box.length;
    const endWeld = i < count - 1 ? (joints[i]?.weld ?? 0) : 0;
    const o = V.addScaled(p0, left, sec.width / 2);
    const part: Part = {
      id,
      mark,
      category: "stringer",
      name: segmentName(
        "structure.steelCentral.part.tube",
        "structure.steelCentral.part.tubeWhole",
        i,
        count,
      ),
      material,
      // Vue de face (coupes au sol et d'aplomb) extrudée sur la largeur du tube.
      solid: {
        kind: "extrusion",
        frame: {
          origin: v3(o, 0),
          xAxis: h3(t),
          yAxis: { x: 0, y: 0, z: 1 },
          zAxis: h3(V.scale(left, -1)),
        },
        profile: { outer: outline, holes: [] },
        depth: sec.width,
      },
      flat,
      section: msg("structure.steelCentral.section.tubePart", {
        height: dec(sec.height, 0),
        width: dec(sec.width, 0),
        wall: dec(sec.wallThickness, 0),
        grade: params.grade,
      }),
      stock: { length: cutLength, width: sec.height, thickness: sec.width },
      quantities: steelQuantities(
        {
          volumeMm3: area * axisLength,
          treatedSurfaceMm2: 2 * (sec.width + sec.height) * axisLength + 2 * area,
          length: cutLength,
          weld: endWeld,
          buttWeld: endWeld,
          cuts: 2,
          holes: holes.length,
        },
        profile,
      ),
    };
    parts.push(part);
    barItems.push({ value: cutLength, label: textMessage(mark), partId: id });
    segments.push({
      index: i,
      sigma0: a,
      sigma1: b,
      partIds: [id],
      fits: cutLength <= maxBar + 1e-6,
    });
    if (i > 0) assemblies.push({ a: { partId: `central-tube-${i}` }, b: { partId: id } });
  }
  return {
    parts,
    segments,
    assemblies,
    fillet: 0,
    formatParts: [],
    laserParts: [],
    rollItems: [],
    barItems,
    vents,
  };
}

function tubeJointLabel(j: CentralBeamJoint, other: string): Message {
  return j.kind === "butt-weld"
    ? msg("structure.steelCurved.flatLine.joint", { mark: other })
    : msg("structure.steelCentral.flatLine.boltedSplice", { mark: other });
}

// ------------------------------------------------------------------ Platines

/**
 * Platines de pied (sous la coupe au sol, centrée sur elle) et de tête (contre le chevêtre),
 * mêmes réglages que `steel-flat` (A29 n° 5). Largeur en travers : max(`plates.width`,
 * b + 4·pince) et longueur de la platine de pied : max(`plates.length`, coupe au sol + 4·pince),
 * pour que les perçages (à une pince du bord) restent à une pince au moins de la poutre (règle
 * Blondel, **à valider**).
 */
function beamPlates(
  g: BeamGeometry,
  firstId: string | undefined,
  firstMark: string,
  lastId: string | undefined,
  lastMark: string,
): { parts: Part[]; weld: Mm } {
  const { input, trace, profile, material, floorCut } = g;
  const pl = input.params.plates;
  const sec = input.params.section;
  const W = Math.max(pl.width, sec.width + 4 * pl.holeEdgeDistance);
  const out: Part[] = [];
  let weld = 0;
  if (pl.foot && floorCut && firstId) {
    const cut = floorCut.x1 - floorCut.x0;
    const L = Math.max(pl.length, cut + 4 * pl.holeEdgeDistance);
    const mid = (floorCut.x0 + floorCut.x1) / 2;
    const t = trace.tangent(mid);
    const left = trace.left(mid);
    const flat = rectFlat(
      L,
      W,
      pl.thickness,
      plateHoles(L, W, pl.holeEdgeDistance, 2),
      pl.holeDiameter,
      "PF",
      msg("structure.steel.reference.footPlate", { mark: firstMark }),
    );
    const o = V.addScaled(V.addScaled(trace.point(mid), t, -L / 2), left, -W / 2);
    const w = 2 * (cut + sec.width);
    weld += w;
    out.push(
      ...markGroups(
        [
          plateObject(
            "plate-foot-central",
            msg("structure.steel.part.footPlate", { mark: firstMark }),
            flat,
            pl.thickness,
            w,
            material,
            profile,
            {
              origin: v3(o, 0),
              xAxis: h3(t),
              yAxis: h3(left),
              zAxis: { x: 0, y: 0, z: 1 },
              depth: pl.thickness,
            },
          ),
        ],
        "PF",
        () => null,
      ),
    );
  }
  if (pl.head && lastId) {
    const s = g.sEnd;
    const zLo = g.zLowAt(s);
    const H = g.zHighAt(s) - zLo;
    if (H > 1) {
      const t = trace.tangent(s);
      const left = trace.left(s);
      const flat = rectFlat(
        H,
        W,
        pl.thickness,
        plateHoles(H, W, pl.holeEdgeDistance, 1),
        pl.holeDiameter,
        "PH",
        msg("structure.steel.reference.headPlate", { mark: lastMark }),
      );
      const o = V.addScaled(trace.point(s), left, -W / 2);
      const w = 2 * (H + sec.width);
      weld += w;
      out.push(
        ...markGroups(
          [
            plateObject(
              "plate-head-central",
              msg("structure.steel.part.headPlate", { mark: lastMark }),
              flat,
              pl.thickness,
              w,
              material,
              profile,
              {
                origin: v3(o, zLo),
                xAxis: { x: 0, y: 0, z: 1 },
                yAxis: h3(left),
                zAxis: h3(V.scale(t, -1)),
                depth: -pl.thickness,
              },
            ),
          ],
          "PH",
          () => null,
        ),
      );
    }
  }
  return {
    parts: out.map((p) => {
      const foot = p.id === "plate-foot-central";
      const holes = p.flat?.outline.holes.length ?? 0;
      return {
        ...p,
        assembledWith: [foot ? firstId! : lastId!],
        // Ancrage au gros œuvre (A27, mêmes fixations que `steel-flat`) : la platine est soudée
        // aux pièces de la poutre (flasques et semelles d'un caisson, assemblées par
        // `assemblies`), qui ne sont pas des pièces boulonnées ; fixation déclarée pour que
        // l'étape « Visserie » n'en fasse pas une platine boulonnée acier sur acier.
        ...(holes > 0
          ? {
              fixings: [
                {
                  joint: foot ? ("plateFloor" as const) : ("plateTrimmer" as const),
                  points: holes,
                  holeDiameter: pl.holeDiameter,
                },
              ],
            }
          : {}),
      };
    }),
    weld,
  };
}

// ------------------------------------------------------------------ Contrôles

function addBeamChecks(
  g: BeamGeometry,
  checks: CheckCollector,
  built: BuiltBeam,
  joints: readonly CentralBeamJoint[],
): void {
  const { input, trace, metal } = g;
  const { params } = input;
  const sec = params.section;
  const bp = params.beam;
  const rule = (spec: PluginRuleSpec) => pluginRuleDef(spec);
  const isTube = sec.kind === "tube";
  const rolling = metal.plateRolling;

  if (!isTube) {
    // Roulage des flasques sur les arcs : rayon intérieur de la flasque côté centre R − b/2.
    checks.addItems(
      rule(CENTRAL_BEAM_RULES.rollingRadius),
      trace.arcs
        .map((a) => ({
          value: a.radius - sec.width / 2,
          label: msg("structure.steelCentral.check.rollingRadiusItem", {
            radius: dec(a.radius, 0),
            half: dec(sec.width / 2, 0),
          }),
          partId: built.segments.find((s) => s.sigma1 > a.sigma0 && s.sigma0 < a.sigma1)
            ?.partIds[0],
        }))
        .map((it) => (it.partId === undefined ? { value: it.value, label: it.label } : it)),
      msg("structure.steelCurved.quantity.rollingInnerRadius"),
      { min: rolling.minInnerRadius - 1e-9, max: null },
    );
    checks.addItems(
      rule(CENTRAL_BEAM_RULES.rollingThickness),
      trace.arcs.length > 0
        ? [{ value: sec.webThickness, label: msg("structure.steelCentral.check.webs") }]
        : [],
      msg("structure.steelCurved.quantity.rolledThickness"),
      { min: null, max: rolling.maxThickness },
    );
    checks.addItems(
      rule(CENTRAL_BEAM_RULES.rollLength),
      built.rollItems,
      msg("structure.steelCurved.quantity.generatrixExtent"),
      { min: null, max: rolling.rollLength },
    );
    // Cassure de pente des flasques aux naissances (B §5.3), mesurée sans seuil.
    const webs = built.webs;
    if (webs) {
      const births = trace.naissances.filter((b) => b.sigma > g.sStart && b.sigma < g.sEnd);
      checks.add(
        rule(CENTRAL_BEAM_RULES.slopeBreak),
        births.length === 0
          ? [{ status: "ok", message: msg("structure.steelCentral.check.noSpringing") }]
          : births.map((b): Finding => {
              const [l, r] = webs.map((w) => slopeBreakAt(trace.nosingZ, w.dev, b.sigma));
              return {
                status: "ok",
                measured: Math.max(l!.degrees, r!.degrees),
                message: msg("structure.steelCentral.check.springingBreak", {
                  sigma: dec(b.sigma, 0),
                  left: dec(l!.degrees, 2),
                  right: dec(r!.degrees, 2),
                }),
              };
            }),
      );
    }
  }

  // Joints hors supports.
  checks.addItems(
    rule(CENTRAL_BEAM_RULES.jointPlacement),
    joints.map((j) => ({
      value: Number.isFinite(j.supportClearance) ? j.supportClearance : 1e6,
      label: msg(
        j.reason === "naissance"
          ? "structure.steelCurved.check.jointSpringing"
          : j.reason === "format"
            ? "structure.steelCurved.check.jointFormat"
            : "structure.steelCentral.check.jointBar",
        { sigma: dec(j.sigma, 0) },
      ),
    })),
    msg("structure.steelCurved.quantity.jointSupportDistance"),
    { min: bp.jointSupportMargin - JOINT_TOLERANCE, max: null },
  );

  if (isTube) {
    checks.addItems(
      rule(CENTRAL_BEAM_RULES.barLength),
      built.barItems,
      msg("structure.steel.quantity.barLength"),
      { min: null, max: Math.max(...metal.barLengths) },
    );
  } else {
    checks.add(
      rule(CENTRAL_BEAM_RULES.sheetFormat),
      built.formatParts.map(({ part, box, fits }): Finding => ({
        status: fits ? "ok" : "violation",
        measured: box.length,
        location: { kind: "part", partId: part.id },
        message: sheetFormatMessage(
          fits ? "structure.steel.check.inSheetFormat" : "structure.steel.check.outOfSheetFormats",
          part.mark,
          box,
        ),
      })),
    );
    checks.addItems(
      rule(CENTRAL_BEAM_RULES.laser),
      built.laserParts.map((p) => ({
        value: p.flat?.thickness ?? 0,
        label: textMessage(p.mark),
        partId: p.id,
      })),
      msg("structure.steel.quantity.cutThickness"),
      { min: null, max: metal.laser.maxThickness },
    );
  }

  // Évents des corps creux galvanisés (C §2.8 [28], C-M-10).
  if (params.finish !== "galvanized") {
    checks.add(rule(CENTRAL_BEAM_RULES.vents), [
      { status: "ok", message: msg("structure.steelCentral.check.ventsNotRequired") },
    ]);
  } else {
    const findings: Finding[] = built.vents.missing.map((m) => ({
      status: "violation",
      message: msg("structure.steelCentral.check.ventMissing", {
        item: m,
        diameter: dec(sec.ventDiameter, 0),
      }),
    }));
    if (findings.length === 0) {
      findings.push({
        status: "ok",
        measured: sec.ventDiameter,
        message: msg("structure.steelCentral.check.ventsPlaced", {
          count: built.vents.placed,
          diameter: dec(sec.ventDiameter, 0),
        }),
      });
    }
    checks.add(rule(CENTRAL_BEAM_RULES.vents), findings);
  }
}
