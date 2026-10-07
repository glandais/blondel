/**
 * Plugin `steel-central` : limon central métal (QUESTIONS A29, décisions de l'utilisateur du
 * 2026-10-06 ; SPEC §2.3, §2.4 ; C §1.7, §2.2, §2.4 à §2.7).
 *
 * Une poutre unique sous les marches (tube rectangulaire ou caisson en tôles soudées), à l'axe
 * de l'emmarchement par défaut : droite (escalier droit), débillardée (tournants : tronçons
 * roulés, joints bout à bout, EXC2) ou hélicoïdale. La trace et la poutre sont construites par
 * `centralTrace.ts` et `centralBeam.ts` ; ce module pose les marches, les supports de marche,
 * les assemblages et les contrôles :
 *
 * - **Marches** : bois (pièces de base, escalier mixte) ou tôle pliée Z / U (mêmes réglages et
 *   même construction que `steel-flat` : `flatTreadZones`, `arrivalRiserPart`) ; contremarches
 *   bois retirées comme `steel-flat` ; marche en tôle **vissée** sur son support (A31, défaut) :
 *   perçages reportés dans son développé (`drillFoldedTreadPoints`), support percé et visserie
 *   comptée aux seuls points réellement percés dans la marche ; **soudée** : cordons comptés.
 * - **Dessus de la poutre** : ligne des nez prise sur la trace moins `beam.topOffset` ; `auto` :
 *   la plus petite distance qui laisse sous chaque marche, sur toute sa portée sur la trace, au
 *   moins `supports.minHeight` entre le dessous de la marche et le dessus de la poutre, arrondie
 *   aux 5 mm supérieurs (valeur exposée dans `autoValues`).
 * - **Supports de marche** [choix Blondel, à valider] : un par marche, au milieu de la portée
 *   de la marche sur la trace ; sous un palier, plusieurs, répartis le long de la trace à
 *   entraxe ≤ `supports.landingSpacing` (au moins la largeur d'appui : supports jointifs).
 *   Direction en travers d'une console : bissectrice des deux lignes de nez qui bornent la
 *   marche (palier, ou bissectrice à plus de 60° de la normale à la trace : normale à la
 *   trace) ; d'un support plié : normale à la trace (sa section prismatique ne peut épouser le
 *   dessus de la poutre que posée d'équerre). Le support reste dans la zone d'appui de la marche
 *   (marges de nez, de
 *   contremarche et d'ailes retirées, `TreadZone`) ; longueur `auto` = largeur de cette zone en
 *   travers moins 2 × `endClearance`. Types :
 *   - `console` (défaut, C §2.4 [20] : consoles en tôle de 8 mm positionnées au gabarit) : âme
 *     en tôle découpée laser dans le plan vertical en travers, dessus horizontal sous le plat
 *     d'appui, hauteur `tipHeight` aux bouts, descendant jusqu'au dessus de la poutre au droit
 *     de la poutre (soudée dessus) ; sous une marche balancée, la console croise la poutre en
 *     biais : le bas de l'âme suit l'intersection réelle de son plan avec le dessus de la poutre
 *     (largeur b / cos β, dessus incliné, `beamContact`), et plat d'appui
 *     `bearingWidth × bearingThickness` soudé sur
 *     l'âme, percé pour la marche (identifiant `…-bearing`) ; une console est toujours soudée
 *     sur la poutre (aucune aile à boulonner) ;
 *   - `folded-u` / `folded-z` / `folded-triangle` (C §2.6 [43] : supports pliés « adaptés à la
 *     largeur du limon central et à l'angle de pente » ; C §2.2 [42] : tôle de 4 mm pliée en
 *     triangle ouvert) : section prismatique dans le plan vertical de la trace, extrudée en
 *     travers ; U renversé (âme d'appui + deux ailes verticales jusqu'au dessus de la poutre),
 *     Z (âme d'appui + aile verticale avant + retour de `bearingWidth` posé sur la poutre vers
 *     le bas de l'escalier, incliné à la pente), triangle ouvert (âme d'appui + aile verticale
 *     avant + retour incliné à la pente posé sur la poutre jusque sous l'arrière de l'âme) ;
 *     développé rectangulaire en fibre neutre, lignes de pli (loi de pli du profil d'atelier),
 *     contrôles de pli et de bord mini comme `steel-flat`. Fixation sur la poutre : soudée, ou
 *     vissée par le retour posé (Z, triangle ; le U n'a pas d'aile posée et reste soudé).
 * - **Contrôles** : marche portée (FAB_MARCHE_PORTEE : un support qui enjambe la poutre sous
 *   chaque marche), longueur du support (≥ largeur de la poutre), hauteur du support au-dessus
 *   de la poutre (≥ `supports.minHeight`), **double porte-à-faux et torsion**
 *   (`LIMON_CENTRAL_PORTE_A_FAUX`, avertissement, justification jointe comme A12),
 *   prédimensionnement en flexion de la poutre (`precheck/`, largeur reprise = emmarchement
 *   entier : une seule poutre ; torsion et déversement non vérifiés), classe d'exécution
 *   EN 1090-2 (EXC2 dès un joint bout à bout ou un S355 soudé), pliage, laser, formats.
 *
 * `build` ne lève jamais : toute erreur devient un `Message` de `errors`.
 */
import { dec, errorMessage, msg, MessageError, textMessage, type Message } from "@blondel/i18n";
import { ensureCCW } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { FlatPattern, NosingLine, Part, PartFixing, RuleResult } from "../model/derived.js";
import type {
  PartAssembly,
  StructureContext,
  StructureKind,
  StructureLayoutTraits,
  StructureOutput,
  UnsupportedParamOption,
} from "../model/plugins.js";
import type { Mm, Polygon2, Vec2 } from "../model/primitives.js";
import { buildBasicParts } from "../parts/basic.js";
import { analyzeInclinedBeam, type InclinedBeamResult } from "../precheck/beam.js";
import { precheckResults, type PrecheckedBeam } from "../precheck/checks.js";
import { stairLoads } from "../precheck/loads.js";
import { steelMaterialOf } from "../precheck/settings.js";
import { activeContexts, permanentAreaLoad } from "../precheck/stringers.js";
import { sourceSpec } from "../rules/sources.js";
import type { Finding } from "../rules/types.js";
import {
  bendAllowance,
  minBendRadiusFactor,
  type ResolvedBend,
  type SteelGrade,
} from "../workshop/metal.js";
import { resolveWorkshopProfile, type WorkshopProfile } from "../workshop/profile.js";
import { commonAutoValue } from "./autoValue.js";
import {
  buildCentralBeam,
  type CentralBeamInput,
  type CentralBeamResult,
  type SigmaSpan,
} from "./centralBeam.js";
import {
  beamTopAt,
  buildCentralTrace,
  type CentralTrace,
  type CentralTraceResult,
} from "./centralTrace.js";
import { CheckCollector, pluginRuleDef, type CheckItem, type PluginRuleSpec } from "./checks.js";
import {
  sectionPolygon,
  type FlangeCheck,
  type FoldedSection,
  type FoldedTreadResult,
} from "./folded.js";
import { dedupe, minAreaRect } from "./geom.js";
import {
  QUANTITY_WELD_MM,
  STEEL_RULES,
  deduceExecutionClass,
  executionClassReasons,
  holePolygon,
  plateMeasures,
  steelMaterial,
  steelQuantities,
} from "./steelCommon.js";
import {
  CENTRAL_SECTION_KINDS,
  SteelCentralParamsSchema,
  type CentralSupportKind,
  type SteelCentralParams,
} from "./steelCentralParams.js";
import {
  arrivalRiserPart,
  flatTreadZones,
  markGroups,
  resolveFoldedBend,
  sheetFormatMessage,
  treadFixingNotes,
  type FoldedTreadDetail,
  type TreadZone,
} from "./steelFlat.js";
import {
  drillFoldedTreadPoints,
  treadSupportJoint,
  type TreadMaterialKind,
} from "./treadFixing.js";

export {
  CENTRAL_SECTION_KINDS,
  CENTRAL_SUPPORT_KINDS,
  SteelCentralParamsSchema,
  type CentralSectionKind,
  type CentralSupportKind,
  type SteelCentralParams,
} from "./steelCentralParams.js";

// ------------------------------------------------------------------ contrôles propres

/** Contrôles propres au plugin (hors rules.yaml) ; descriptions : `rules.<id>.description`. */
export const CENTRAL_RULES = {
  /**
   * Double porte-à-faux des marches sur une poutre unique et torsion de la poutre sous charge
   * excentrée (C §1.5 : torsion à vérifier, EN 16481 § 7.3.1 [3] ; C §1.8 : hors règles de
   * moyens du DTU) : avertissement « justification requise », justification jointe (A29 n° 4,
   * même traitement que `HELICOIDAL_PORTE_A_FAUX`, décision A12).
   */
  cantilever: {
    id: "LIMON_CENTRAL_PORTE_A_FAUX",
    ...sourceSpec(msg("compliance.source.centralCantilever")),
    confidence: "moyen",
    nature: "metier",
    severity: "avertissement",
    unit: null,
  },
  /**
   * Hauteur d'un support de marche au-dessus de la poutre, au droit de la poutre : au moins
   * `supports.minHeight` (paramètre du plugin, à valider), sinon la marche touche presque la
   * poutre et le support ne peut pas être fabriqué.
   */
  supportHeight: {
    id: "FAB_LIMON_CENTRAL_SUPPORT_HAUTEUR",
    ...sourceSpec(msg("compliance.source.centralSupportHeight")),
    confidence: "faible",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
} as const satisfies Record<string, PluginRuleSpec>;

// ------------------------------------------------------------------ résultat détaillé

/** Support de marche placé (plan, altitudes, pièces). */
export interface CentralSupport {
  /** Marche portée et son repère. */
  readonly tread: number;
  readonly treadMark: string;
  /** Rang du support sous la marche (1 sauf sous un palier). */
  readonly index: number;
  /** Abscisse du support sur la trace et portée occupée sur la trace (zone sans joint). */
  readonly sigma: Mm;
  readonly sigma0: Mm;
  readonly sigma1: Mm;
  /** Point de la trace au droit du support. */
  readonly center: Vec2;
  /** Direction en travers (vers la gauche de la montée) et le long de la trace (montée). */
  readonly across: Vec2;
  readonly along: Vec2;
  /** Étendue en travers [s0 ; s1] depuis la trace (mm). */
  readonly s0: Mm;
  readonly s1: Mm;
  /** Largeur d'appui le long de la trace (mm). */
  readonly bearingWidth: Mm;
  /**
   * Dessus du support (dessous de la marche) et dessus de la poutre sous le support (le plus
   * haut de la zone d'appui : une console en biais croise un dessus incliné).
   */
  readonly zTop: Mm;
  readonly zBeam: Mm;
  /**
   * Rives de la poutre dans la direction en travers du support (abscisses s) : ∓ b/2 d'équerre,
   * ∓ b / (2 cos β) pour une console en biais d'un angle β. Le support enjambe la poutre si
   * s0 ≤ beamLo et s1 ≥ beamHi.
   */
  readonly beamLo: Mm;
  readonly beamHi: Mm;
  /** Pièces du support : âme de console puis plat d'appui, ou support plié seul. */
  readonly parts: readonly Part[];
  /** Pièce de la poutre qui porte le support (assemblage), si connue. */
  readonly beamPart?: string;
  /** Points de fixation de la marche (plan, repère monde). */
  readonly treadPoints: readonly Vec2[];
  /** Ailes d'un support plié (contrôle de bord mini) ; vide pour une console. */
  readonly flanges: readonly FlangeCheck[];
}

export interface SteelCentralResult {
  readonly output: StructureOutput;
  readonly trace: CentralTrace | null;
  readonly beam: CentralBeamResult | null;
  /** Distance ligne des nez → dessus de la poutre retenue (mm, NaN sans trace). */
  readonly topOffset: Mm;
  readonly supports: readonly CentralSupport[];
  readonly treads: readonly FoldedTreadDetail[];
  readonly executionClass: "EXC1" | "EXC2";
  /** Prédimensionnement en flexion de la poutre (absent sans poutre). */
  readonly precheck?: InclinedBeamResult;
}

/** Dépendances (trace et poutre), remplaçables dans les tests. */
export interface SteelCentralDeps {
  readonly buildTrace: (ctx: StructureContext, params: SteelCentralParams) => CentralTraceResult;
  readonly buildBeam: (input: CentralBeamInput) => CentralBeamResult;
}

const DEFAULT_DEPS: SteelCentralDeps = {
  buildTrace: buildCentralTrace,
  buildBeam: buildCentralBeam,
};

const ceil5 = (x: Mm): Mm => Math.ceil(x / 5 - 1e-9) * 5;
const UP = { x: 0, y: 0, z: 1 } as const;
const v3 = (v: Vec2): { x: number; y: number; z: number } => ({ x: v.x, y: v.y, z: 0 });
/** Échantillons de la ligne des nez sur la portée d'une marche (`beam.topOffset` auto). */
const TOP_OFFSET_SAMPLES = 24;
/** Tolérance d'appartenance d'un point à la zone d'appui (mm, bruit numérique). */
const ZONE_TOL: Mm = 1e-6;

// ------------------------------------------------------------------ géométrie

/**
 * Intervalle [t0 ; t1] de la droite `p + t·u` intérieur au polygone qui contient t = 0 (à
 * `ZONE_TOL` près) ; `null` si le point `p` est hors du polygone.
 */
export function lineInterval(poly: Polygon2, p: Vec2, u: Vec2): { t0: Mm; t1: Mm } | null {
  if (poly.length < 3) return null;
  const n = V.perpLeft(u);
  const ts: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const da = V.dot(V.sub(a, p), n);
    const db = V.dot(V.sub(b, p), n);
    if (da > 0 === db > 0) continue;
    const q = V.lerp(a, b, da / (da - db));
    ts.push(V.dot(V.sub(q, p), u));
  }
  ts.sort((x, y) => x - y);
  for (let i = 0; i + 1 < ts.length; i += 2) {
    const t0 = ts[i]!;
    const t1 = ts[i + 1]!;
    if (t0 <= ZONE_TOL && t1 >= -ZONE_TOL) return { t0, t1 };
  }
  return null;
}

/** Désignation du type de support (remarques, noms des pièces, sections). */
function supportKindLabel(kind: CentralSupportKind): Message {
  switch (kind) {
    case "console":
      return msg("structure.steelCentral.supportKind.console");
    case "folded-u":
      return msg("structure.steelCentral.supportKind.foldedU");
    case "folded-z":
      return msg("structure.steelCentral.supportKind.foldedZ");
    case "folded-triangle":
      return msg("structure.steelCentral.supportKind.foldedTriangle");
  }
}

/** Fixation effective d'un support sur la poutre (console et U : aucune aile posée à boulonner). */
export function effectiveCentralFixing(sup: SteelCentralParams["supports"]): "welded" | "bolted" {
  return sup.kind === "folded-z" || sup.kind === "folded-triangle" ? sup.fixing : "welded";
}

/** Section pliée d'un support et indices des ailes d'appui (âme) et posée (retour). */
interface FoldedSupportSection {
  readonly section: FoldedSection;
  /** Aile d'appui sous la marche (âme). */
  readonly webIndex: number;
  /** Aile posée sur la poutre (Z, triangle), `null` pour le U. */
  readonly returnIndex: number | null;
  /** Abscisse X (le long de la trace) du milieu de l'âme d'appui. */
  readonly webX: Mm;
}

/**
 * Section pliée à partir de sa ligne moyenne `pts` (sommets ; repère de section : X le long de
 * la trace dans le sens de la montée, Y vertical, 0 au dessus de l'âme d'appui) : plis de rayon
 * moyen r + t/2 aux sommets intérieurs, ailes droites = segments moins les retraits
 * (r + t/2)·tan(θ/2). `refLeft` : la face de référence (dessus de l'âme d'appui) est à gauche
 * du sens de parcours. Lève une `MessageError` si une aile n'a pas de partie droite.
 */
function sectionFromMeanLine(
  pts: readonly Vec2[],
  refLeft: boolean,
  t: Mm,
  r: Mm,
  names: readonly Message[],
  mark: string,
): FoldedSection {
  const rc = r + t / 2;
  const dirs = pts.slice(1).map((p, i) => V.normalize(V.sub(p, pts[i]!)));
  const bends = dirs.slice(1).map((d, i) => {
    const angle = Math.abs(V.signedAngle(dirs[i]!, d));
    const turn: 1 | -1 = V.cross(dirs[i]!, d) >= 0 ? 1 : -1;
    return { angle, turn, up: refLeft ? turn === 1 : turn === -1 };
  });
  const setback = (i: number): Mm => {
    const b = bends[i];
    return b ? rc * Math.tan(b.angle / 2) : 0;
  };
  const straights = dirs.map(
    (_, i) => V.distance(pts[i]!, pts[i + 1]!) - (i > 0 ? setback(i - 1) : 0) - setback(i),
  );
  straights.forEach((len, i) => {
    if (!(len > 0)) {
      throw new MessageError(
        msg("structure.steel.folded.error.flangeNoStraight", {
          mark,
          flange: names[i] ?? textMessage(String(i + 1)),
          length: dec(len, 1),
          radius: dec(r, 1),
        }),
      );
    }
  });
  const steps: FoldedSection["steps"][number][] = [];
  straights.forEach((len, i) => {
    steps.push({ kind: "line", length: len });
    const b = bends[i];
    if (b) steps.push({ kind: "arc", turn: b.turn, angle: b.angle, radius: rc });
  });
  return {
    // Le type `FoldedSection` est commun aux marches pliées : profil sans effet ici.
    profile: "U",
    thickness: t,
    innerRadius: r,
    straights,
    bends: bends.map((b) => ({ angle: b.angle, up: b.up })),
    flangeNames: names,
    start: pts[0]!,
    heading: dirs[0]!,
    steps,
  };
}

/**
 * Section du support plié `kind` (voir l'en-tête) : âme d'appui de largeur `bw` sous la marche,
 * dessus à Y = 0 ; `yb(X)` : dessus de la poutre (Y < 0) à l'abscisse X ; `slope` : pente du
 * dessus de la poutre le long de la trace ; `ret` : longueur du retour posé (Z).
 */
function foldedSupportSection(
  kind: Exclude<CentralSupportKind, "console">,
  bw: Mm,
  t: Mm,
  r: Mm,
  yb: (x: Mm) => Mm,
  slope: number,
  ret: Mm,
  mark: string,
): FoldedSupportSection {
  const m = t / 2;
  const alpha = Math.atan(slope);
  const tc = t / (2 * Math.cos(alpha));
  const web = msg("structure.steelCentral.flange.web");
  if (kind === "folded-u") {
    const x0 = -bw / 2 + m;
    const x1 = bw / 2 - m;
    const pts = [V.vec(x0, yb(x0)), V.vec(x0, -m), V.vec(x1, -m), V.vec(x1, yb(x1))];
    const names = [
      msg("structure.steelCentral.flange.front"),
      web,
      msg("structure.steelCentral.flange.rear"),
    ];
    return {
      section: sectionFromMeanLine(pts, true, t, r, names, mark),
      webIndex: 1,
      returnIndex: null,
      webX: 0,
    };
  }
  const xf = -bw / 2 + m;
  const p0 = V.vec(bw / 2, -m);
  const p1 = V.vec(xf, -m);
  const p2 = V.vec(xf, yb(xf) + tc);
  const slopeDir = V.vec(Math.cos(alpha), Math.sin(alpha));
  const p3 =
    kind === "folded-z"
      ? V.addScaled(p2, slopeDir, -ret)
      : V.addScaled(p2, slopeDir, (bw / 2 - m - xf) / Math.cos(alpha));
  const names = [
    web,
    msg("structure.steelCentral.flange.front"),
    msg("structure.steelCentral.flange.seat"),
  ];
  return {
    section: sectionFromMeanLine([p0, p1, p2, p3], false, t, r, names, mark),
    webIndex: 0,
    returnIndex: 2,
    webX: (p0.x + p1.x) / 2,
  };
}

/** Positions régulières de `n` points sur [lo ; hi] (milieu si un seul ou intervalle vide). */
function spread(n: number, lo: Mm, hi: Mm): Mm[] {
  if (n <= 0) return [];
  if (n === 1 || !(hi > lo)) return Array.from({ length: n }, () => (lo + hi) / 2);
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
}

/** Ligne de texte (repère) au centre d'un développé. */
function labelLine(x: Mm, y: Mm, mark: string): FlatPattern["lines"][number] {
  return { kind: "text", a: V.vec(x - 20, y), b: V.vec(x + 20, y), label: textMessage(mark) };
}

// ------------------------------------------------------------------ construction

/** Construction complète (détails compris). Ne lève jamais. */
export function buildSteelCentral(
  ctx: StructureContext,
  params: SteelCentralParams,
  deps: SteelCentralDeps = DEFAULT_DEPS,
): SteelCentralResult {
  try {
    return buildUnsafe(ctx, params, deps);
  } catch (err) {
    const checks = new CheckCollector(ctx.project, ctx.stepping);
    addCantileverCheck(checks, params);
    return emptyResult(
      [
        msg("structure.steelCentral.error.notGenerated", {
          label: msg("structure.steelCentral.shortLabel"),
          detail: errorMessage(err),
        }),
      ],
      checks.results,
    );
  }
}

function emptyResult(
  errors: readonly Message[],
  checks: readonly RuleResult[],
): SteelCentralResult {
  return {
    output: { parts: [], checks, notes: [], errors },
    trace: null,
    beam: null,
    topOffset: Number.NaN,
    supports: [],
    treads: [],
    executionClass: "EXC1",
  };
}

/** Contrôle « double porte-à-faux et torsion » (A29 n° 4, comme A12) : toujours présent. */
function addCantileverCheck(checks: CheckCollector, params: SteelCentralParams): void {
  const justification = params.cantileverJustification.trim();
  checks.add(pluginRuleDef(CENTRAL_RULES.cantilever), [
    justification === ""
      ? { status: "violation", message: msg("structure.steelCentral.check.cantileverRequired") }
      : {
          // Une justification n'est pas une vérification : l'avertissement reste affiché,
          // justification jointe au résultat et reprise dans le dossier (décision A12).
          status: "violation",
          message: msg("structure.steelCentral.check.cantileverJustified", { justification }),
          justification,
        },
  ]);
}

/** Largeur reprise par la poutre : l'emmarchement entier (une seule poutre). */
function tributaryWidth(ctx: StructureContext): Mm {
  const h = ctx.layout.helical;
  if (h) return h.outerRadius - h.innerRadius;
  const lay = ctx.project.stair.layout;
  return lay.kind === "helical" ? 0 : lay.width;
}

function buildUnsafe(
  ctx: StructureContext,
  params: SteelCentralParams,
  deps: SteelCentralDeps,
): SteelCentralResult {
  const { project, layout, stepping } = ctx;
  const profile = resolveWorkshopProfile(project.workshop);
  const metal = profile.metal;
  const grade: SteelGrade = params.grade;
  const material = steelMaterial(params.finish);
  const sup = params.supports;
  const folded = params.treadKind === "folded-steel";
  const nosings = stepping.nosings;
  const notes: Message[] = [];
  const errors: Message[] = [];
  const checks = new CheckCollector(project, stepping);

  if (nosings.length < 2 || stepping.treads.length === 0) {
    addCantileverCheck(checks, params);
    return emptyResult([msg("structure.steelCentral.error.emptyStepping")], checks.results);
  }

  // 1. Trace de la poutre (configuration non prise en charge : aucune pièce).
  const traced = deps.buildTrace(ctx, params);
  if (!traced.ok) {
    addCantileverCheck(checks, params);
    return emptyResult(traced.errors, checks.results);
  }
  const trace = traced.trace;
  notes.push(...trace.notes);

  // 2. Marches : tôle pliée (même construction que `steel-flat`) ou pièces de base (bois).
  const baseParts = ctx.baseParts ?? buildBasicParts(project, layout, stepping).parts;
  const baseById = new Map(baseParts.map((p) => [p.id, p]));
  const ft = params.folded;
  const treadBend = folded ? resolveFoldedBend(ft.thickness, metal, grade, checks) : null;
  const bend: ResolvedBend | null = treadBend?.bend ?? null;
  errors.push(...(treadBend?.errors ?? []));
  const treadParams = { treadKind: params.treadKind, folded: ft, supports: sup };
  const { treadDetails, zones, foldedErrors } = flatTreadZones(
    project,
    stepping,
    treadParams,
    baseById,
    folded ? bend : null,
    material,
    profile,
  );
  errors.push(
    ...foldedErrors.map((detail) =>
      msg("structure.steelFlat.error.foldedTreadNotDeveloped", { detail }),
    ),
  );
  const arrivalRes = arrivalRiserPart(
    stepping,
    treadParams,
    baseById,
    folded ? bend : null,
    material,
    profile,
  );
  const arrival = arrivalRes.arrival;
  if (arrivalRes.error !== undefined) errors.push(arrivalRes.error);

  // 3. Dessus de la poutre (topOffset), résolu sur la portée de chaque marche sur la trace.
  let need = 0;
  for (const z of zones) {
    const a = trace.nosingSigma[z.tread.number - 1];
    const b = trace.nosingSigma[z.tread.number];
    if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    for (let i = 0; i <= TOP_OFFSET_SAMPLES; i++) {
      const s = a + ((b - a) * i) / TOP_OFFSET_SAMPLES;
      need = Math.max(need, trace.nosingZ(s) - z.zUnder + sup.minHeight);
    }
  }
  const topOffset = params.beam.topOffset === "auto" ? ceil5(need) : params.beam.topOffset;
  const topAt = (s: Mm): Mm => beamTopAt(trace, topOffset, s);

  // 4. Supports de marche (loi de pli propre aux supports pliés).
  const beamWidth = params.section.width;
  let supportBend: ResolvedBend | null = null;
  if (sup.kind !== "console") {
    const sb = resolveFoldedBend(sup.foldedThickness, metal, grade, checks);
    supportBend = sb.bend;
    errors.push(...sb.errors);
  }
  const placeInput: PlaceInput = {
    trace,
    zones,
    nosings,
    steelTreads: new Set(treadDetails.map((d) => d.number)),
    params,
    topAt,
    beamWidth,
    supportBend,
    material,
    profile,
    footprint: layout.footprint,
  };
  let placed = placeSupports(placeInput);

  // 4 bis. Marches en tôle vissées : perçages reportés dans le développé (A31). Un point que la
  // marche ne peut recevoir (hors de la partie plane du dessus, trop près d'un pli, d'un bord ou
  // d'un autre perçage) n'est pas percé ; les supports sont alors reconstruits avec les seuls
  // points percés, pour que les perçages du support, la visserie et la marche concordent.
  let drill = drillCentralTreads(treadDetails, placed.supports, sup);
  if (drill.keep.size > 0) {
    placed = placeSupports({ ...placeInput, treadKeep: drill.keep });
    drill = { ...drillCentralTreads(treadDetails, placed.supports, sup), skipped: drill.skipped };
  }
  if (sup.landingSpacing < sup.bearingWidth && zones.some((z) => z.tread.kind === "landing")) {
    errors.push(
      msg("structure.steelCentral.error.landingSpacing", {
        spacing: dec(sup.landingSpacing, 0),
        width: dec(sup.bearingWidth, 0),
      }),
    );
  }
  errors.push(...placed.errors);

  // 5. Poutre : tronçons hors des portées des supports, platines (`centralBeam.ts`).
  const supportSpans: SigmaSpan[] = placed.supports.map((s) => ({
    sigma0: s.sigma0,
    sigma1: s.sigma1,
    treadNumber: s.tread,
  }));
  const beam = deps.buildBeam({ ctx, params, trace, topOffset, supportSpans, checks });
  errors.push(...beam.errors);
  notes.push(...beam.notes);

  // 6. Pièces des supports : repères par groupes de pièces identiques, fixation sur la poutre.
  const fixing = effectiveCentralFixing(sup);
  const onBeam = placed.supports.map((s) => {
    const beamPart = beam.partAt(s.sigma);
    return beamPart === undefined ? s : { ...s, beamPart };
  });
  const supportParts = markSupportParts(onBeam, sup.kind, fixing);
  const partById = new Map(supportParts.map((p) => [p.id, p]));
  const supports: CentralSupport[] = onBeam.map((s) => ({
    ...s,
    parts: s.parts.map((p) => partById.get(p.id) ?? p),
  }));

  // 7. Marches (perçées à l'étape 4 bis).
  const drilledTreads = drill.treads;
  const treadParts = drilledTreads.map((d) => d.part);
  const foldedParts = arrival ? [...treadParts, arrival.part] : treadParts;

  // 8. Classe d'exécution (C §2.1) : joints bout à bout de la poutre, ou S355 soudé.
  const weldTotal =
    beam.weld +
    [...foldedParts, ...supportParts].reduce(
      (acc, p) => acc + (p.quantities[QUANTITY_WELD_MM] ?? 0),
      0,
    );
  const exc = deduceExecutionClass({
    grade,
    buttWeld: beam.buttWeld,
    welded: weldTotal + beam.buttWeld > 1e-9,
  });

  // 9. Contremarches retirées sous les marches en tôle pliée (même règle que `steel-flat`).
  const foldedRisers = new Set(drilledTreads.map((d) => `riser-${d.number}`));
  const removedBaseParts =
    folded && bend && project.stair.treads.risers === "full"
      ? baseParts
          .filter((p) => /^riser-\d+$/.test(p.id) && (ft.profile !== "Z" || foldedRisers.has(p.id)))
          .map((p) => p.id)
      : [];

  // 10. Prédimensionnement en flexion de la poutre (largeur reprise : E entier).
  const pc = params.precheck;
  const loads = stairLoads(pc, activeContexts(project, stepping));
  const removed = new Set(removedBaseParts);
  const replaced = new Set(foldedParts.map((p) => p.id));
  const permanentArea =
    permanentAreaLoad(
      [
        ...baseParts.filter((p) => !removed.has(p.id) && !replaced.has(p.id)),
        ...foldedParts,
        ...supportParts,
      ],
      stepping,
      profile,
    ) + pc.extraPermanent;
  const midSeg =
    beam.segments.find((x) => trace.length / 2 >= x.sigma0 && trace.length / 2 <= x.sigma1) ??
    beam.segments[0];
  const beamPartId = midSeg?.partIds[0] ?? beam.parts.find((p) => p.category === "stringer")?.id;
  let precheck: InclinedBeamResult | undefined;
  const beams: PrecheckedBeam[] = [];
  if (beamPartId !== undefined && beam.spanH > 0 && beam.section.i > 0) {
    precheck = analyzeInclinedBeam({
      spanH: beam.spanH,
      slope: Math.max(0, beam.slope),
      section: beam.section,
      material: steelMaterialOf(grade, pc, metal.density),
      tributaryWidth: tributaryWidth(ctx),
      permanentArea,
      loads,
      settings: pc,
    });
    const mark = beam.parts.find((p) => p.id === beamPartId)?.mark ?? beamPartId;
    beams.push({
      partId: beamPartId,
      label: msg("structure.steelCentral.precheck.beam", {
        mark,
        section: beam.sectionLabel,
        grade,
      }),
      result: precheck,
    });
  }
  const precheckChecks = precheckResults(project, stepping, beams);
  const precheckNote = msg("structure.steelCentral.note.precheck", {
    qk: dec(loads.qk, 1),
    Qk: dec(loads.Qk, 1),
    source: loads.sourceMessage,
    permanent: dec(permanentArea, 2),
  });

  // 11. Contrôles.
  addCentralChecks(checks, {
    exc,
    grade,
    metal,
    params,
    treadBend: folded ? bend : null,
    supportBend,
    treads: drilledTreads,
    arrival,
    supports,
    zones,
    beamWidth,
  });
  addCantileverCheck(checks, params);

  // 12. Remarques.
  notes.push(
    // Section, dessus de poutre, tronçons et joints : note de la poutre (`beamSummary`).
    msg("structure.steelCentral.note.summary", {
      trace: msg(
        trace.kind === "straight"
          ? "structure.steelCentral.traceKind.straight"
          : trace.kind === "turning"
            ? "structure.steelCentral.traceKind.turning"
            : "structure.steelCentral.traceKind.helical",
      ),
      offset: dec(params.trace.lateralOffset, 0),
      supports: supportKindLabel(sup.kind),
      count: supports.length,
    }),
    precheckNote,
    msg("structure.steel.exc.note", {
      executionClass: exc.executionClass,
      reasons: executionClassReasons(exc, grade),
    }),
  );
  if (folded && drilledTreads.length > 0) notes.push(...treadFixingNotes(sup, drill.skipped));
  if (sup.fixing === "bolted" && fixing === "welded") {
    notes.push(
      msg("structure.steelCentral.note.supportAlwaysWelded", {
        supports: supportKindLabel(sup.kind),
      }),
    );
  }
  // Hélicoïdal à fût : fût non porteur, signalé par la trace (`trace.notes`).
  if (removedBaseParts.length > 0) {
    notes.push(
      msg("structure.steelFlat.note.removedRisers", {
        count: removedBaseParts.length,
        detail: msg(
          ft.profile !== "Z"
            ? "structure.steelFlat.note.removedRisersDetail.openU"
            : arrival
              ? "structure.steelFlat.note.removedRisersDetail.zFoldedArrival"
              : "structure.steelFlat.note.removedRisersDetail.zTimberArrival",
        ),
      }),
    );
  }

  // 13. Assemblages : poutre ; chaque pièce d'un support (une console, âme et plat d'appui, est
  // un sous-ensemble soudé) ↔ marche portée et ↔ pièce de poutre au droit du support ; âme ↔
  // plat d'appui.
  const assemblies: PartAssembly[] = [...beam.assemblies];
  for (const s of supports) {
    const ids = s.parts.map((p) => p.id);
    for (const id of ids) {
      assemblies.push({ a: { partId: id }, b: { treadNumber: s.tread } });
      if (s.beamPart !== undefined)
        assemblies.push({ a: { partId: id }, b: { partId: s.beamPart } });
    }
    if (ids.length > 1) assemblies.push({ a: { partId: ids[0]! }, b: { partId: ids[1]! } });
  }

  const autoValues: Record<string, number> = {};
  if (params.beam.topOffset === "auto") autoValues["beam.topOffset"] = topOffset;
  if (sup.length === "auto") {
    const len = commonAutoValue(supports.map((s) => Math.round(s.s1 - s.s0)));
    if (len !== undefined) autoValues["supports.length"] = len;
  }

  return {
    output: {
      parts: [...foldedParts, ...beam.parts, ...supportParts],
      checks: [...checks.results, ...precheckChecks],
      executionClass: exc.executionClass,
      precheck: { beams, loads, permanentArea, notes: [precheckNote] },
      notes,
      ...(errors.length > 0 ? { errors } : {}),
      ...(removedBaseParts.length > 0 ? { removedBaseParts } : {}),
      ...(Object.keys(autoValues).length > 0 ? { autoValues } : {}),
      ...(assemblies.length > 0 ? { assemblies } : {}),
    },
    trace,
    beam,
    topOffset,
    supports,
    treads: drilledTreads,
    executionClass: exc.executionClass,
    ...(precheck ? { precheck } : {}),
  };
}

// ------------------------------------------------------------------ supports

interface PlaceInput {
  readonly trace: CentralTrace;
  readonly zones: readonly TreadZone[];
  /** Lignes de nez du découpage (direction en travers des marches). */
  readonly nosings: readonly NosingLine[];
  /** Marches en tôle pliée (numéros) : fixation A31 et perçages dessinés. */
  readonly steelTreads: ReadonlySet<number>;
  readonly params: SteelCentralParams;
  readonly topAt: (s: Mm) => Mm;
  readonly beamWidth: Mm;
  readonly supportBend: ResolvedBend | null;
  readonly material: Part["material"];
  readonly profile: WorkshopProfile;
  /** Emprise de l'escalier en plan (retour d'un support en Z hors de la zone d'appui). */
  readonly footprint: Polygon2;
  /**
   * Points de fixation de la marche gardés, par identifiant de support (A31) : seconde passe,
   * après un perçage où des points n'ont pu être reportés dans la marche. Absent : tous.
   */
  readonly treadKeep?: ReadonlyMap<string, readonly boolean[]>;
}

/**
 * Perce les marches en tôle vissées aux points de fixation de leurs supports (A31). `keep` :
 * par support dont un point au moins n'a pas été percé, le sort de chacun de ses points (vide si
 * tout est percé ou sous une marche soudée) ; `skipped` : points non percés.
 */
function drillCentralTreads(
  treads: readonly FoldedTreadDetail[],
  supports: readonly CentralSupport[],
  sup: SteelCentralParams["supports"],
): { treads: FoldedTreadDetail[]; keep: Map<string, boolean[]>; skipped: number } {
  const keep = new Map<string, boolean[]>();
  if (sup.treadFixing !== "screwed") return { treads: [...treads], keep, skipped: 0 };
  let skipped = 0;
  const out = treads.map((d) => {
    const mine = supports.filter((s) => s.tread === d.number && s.treadPoints.length > 0);
    const points = mine.flatMap((s) => s.treadPoints);
    if (points.length === 0) return d;
    const { part, drilled } = drillFoldedTreadPoints(
      d.part,
      d.result,
      points,
      sup.treadHoleDiameter,
    );
    let k = 0;
    for (const s of mine) {
      const flags = drilled.slice(k, k + s.treadPoints.length);
      k += s.treadPoints.length;
      const missing = flags.filter((f) => !f).length;
      if (missing > 0) {
        keep.set(s.parts[0]?.id ?? "", flags);
        skipped += missing;
      }
    }
    return part === d.part ? d : { ...d, part };
  });
  return { treads: out, keep, skipped };
}

/**
 * Étape 4 : supports de marche (voir l'en-tête). Une marche dont la trace ne traverse pas la
 * zone d'appui n'a pas de support (contrôle `FAB_MARCHE_PORTEE`) ; un support que la géométrie
 * ne permet pas de fabriquer devient une erreur explicite.
 */
function placeSupports(input: PlaceInput): { supports: CentralSupport[]; errors: Message[] } {
  const { trace, zones, params } = input;
  const sup = params.supports;
  const supports: CentralSupport[] = [];
  const errors: Message[] = [];
  for (const z of zones) {
    const n = z.tread.number;
    const a = trace.nosingSigma[n - 1];
    const b = trace.nosingSigma[n];
    if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const landing = z.tread.kind === "landing";
    // Entraxe ≤ `landingSpacing`, mais jamais inférieur à la largeur d'appui (supports au plus
    // jointifs ; `landingSpacing` < largeur d'appui : erreur signalée).
    let count = landing ? Math.max(1, Math.ceil((hi - lo) / sup.landingSpacing - 1e-9)) : 1;
    if (count > 1 && (hi - lo) / count < sup.bearingWidth) {
      count = Math.max(1, Math.floor((hi - lo) / sup.bearingWidth + 1e-9));
    }
    for (let k = 0; k < count; k++) {
      const sigma = lo + ((hi - lo) * (k + 0.5)) / count;
      try {
        const s = placeOne(input, z, sigma, landing, count > 1 ? k + 1 : 0);
        if (s) supports.push(s);
      } catch (err) {
        errors.push(
          msg("structure.steelCentral.error.supportNotBuilt", {
            mark: z.mark,
            detail: errorMessage(err),
          }),
        );
      }
    }
  }
  return { supports, errors };
}

/**
 * Direction en travers d'une marche : bissectrice des deux lignes de nez qui la bornent
 * (orientées de l'intérieur vers l'extérieur) ; repli sur la normale à la trace `fallback` si
 * elle s'en écarte de plus de 60° (choix Blondel, à valider).
 */
function acrossOf(da: Vec2 | undefined, db: Vec2 | undefined, fallback: Vec2): Vec2 {
  if (!da || !db) return fallback;
  const sum = V.add(V.normalize(da), V.normalize(db));
  if (V.norm(sum) < 1e-6) return fallback;
  const d = V.normalize(sum);
  return Math.abs(V.dot(d, fallback)) < 0.5 ? fallback : d;
}

interface SupportBase {
  readonly tread: number;
  readonly treadMark: string;
  readonly sigma: Mm;
  readonly center: Vec2;
  readonly across: Vec2;
  readonly along: Vec2;
  readonly s0: Mm;
  readonly s1: Mm;
  readonly bearingWidth: Mm;
  readonly zTop: Mm;
  readonly zBeam: Mm;
}

/** Sélection des points de fixation de la marche gardés (seconde passe A31). */
type KeepPoints = (holes: readonly { s: Mm; y: Mm }[]) => { s: Mm; y: Mm }[];

interface BuiltSupport {
  /** Dessus de la poutre le plus haut sous le support, s'il diffère de celui au droit de σ. */
  readonly zBeam?: Mm;
  /** Rives de la poutre en travers du support (défaut : ∓ b/2). */
  readonly beamLo?: Mm;
  readonly beamHi?: Mm;
  readonly parts: Part[];
  readonly treadPoints: Vec2[];
  /** Longueur occupée en arrière de la largeur d'appui le long de la trace (retour du Z). */
  readonly backReach: Mm;
  readonly flanges: FlangeCheck[];
}

/**
 * Un support sous la zone `z` au droit de σ (palier : `index` > 0, normale à la trace). `null`
 * si la trace ne passe pas dans la zone d'appui ; lève une `MessageError` si la géométrie ne
 * permet pas de fabriquer le support.
 */
function placeOne(
  input: PlaceInput,
  z: TreadZone,
  sigmaMid: Mm,
  landing: boolean,
  index: number,
): CentralSupport | null {
  const { trace, params, topAt, beamWidth } = input;
  const sup = params.supports;
  const n = z.tread.number;
  const tg = trace.tangent(sigmaMid);
  const left = trace.left(sigmaMid);
  // Direction en travers (orientée vers la gauche de la montée) et direction le long. Support
  // plié : normale à la trace (section prismatique posée d'équerre sur la poutre).
  let across =
    landing || sup.kind !== "console"
      ? left
      : acrossOf(input.nosings[n - 1]?.dir, input.nosings[n]?.dir, left);
  if (V.dot(across, left) < 0) across = V.scale(across, -1);
  let along = V.perpRight(across);
  if (V.dot(along, tg) < 0) along = V.scale(along, -1);
  // Largeur d'appui le long de la trace, recentrée dans la zone d'appui si besoin.
  const alongIv = lineInterval(z.zone, trace.point(sigmaMid), along);
  if (!alongIv) return null;
  const bw = Math.min(sup.bearingWidth, alongIv.t1 - alongIv.t0);
  if (!(bw > 1)) return null;
  const uc = Math.min(Math.max(0, alongIv.t0 + bw / 2), alongIv.t1 - bw / 2);
  const cosA = Math.max(1e-6, V.dot(along, tg));
  const sigma = sigmaMid + uc * cosA;
  const center = trace.point(sigma);
  // Étendue en travers : les deux rives et le milieu de la largeur d'appui restent dans la zone.
  let S0 = -Infinity;
  let S1 = Infinity;
  for (const off of [-bw / 2, 0, bw / 2]) {
    const iv = lineInterval(z.zone, V.addScaled(center, along, off), across);
    if (!iv) return null;
    S0 = Math.max(S0, iv.t0);
    S1 = Math.min(S1, iv.t1);
  }
  if (sup.kind === "folded-z") {
    // Retour du Z posé sur la poutre vers le bas de l'escalier, sous la marche précédente
    // (portée en plan ≤ `bearingWidth`) : il reste dans l'emprise de l'escalier.
    for (const off of [-bw, -1.5 * bw]) {
      const iv = lineInterval(input.footprint, V.addScaled(center, along, off), across);
      if (!iv) return null;
      S0 = Math.max(S0, iv.t0);
      S1 = Math.min(S1, iv.t1);
    }
  }
  const lo = S0 + sup.endClearance;
  const hi = S1 - sup.endClearance;
  if (!(hi > lo)) return null;
  let s0 = lo;
  let s1 = hi;
  if (sup.length !== "auto") {
    // Longueur imposée : centrée sur la poutre, décalée pour rester dans la zone, rognée sinon.
    const L = sup.length;
    if (hi - lo >= L) {
      s0 = Math.min(Math.max(-L / 2, lo), hi - L);
      s1 = s0 + L;
    }
  }
  const base: SupportBase = {
    tread: n,
    treadMark: z.mark,
    sigma,
    center,
    across,
    along,
    s0,
    s1,
    bearingWidth: bw,
    zTop: z.zUnder,
    zBeam: topAt(sigma),
  };
  const id = index > 0 ? `support-${n}-central-${index}` : `support-${n}-central`;
  const treadMaterial: TreadMaterialKind = input.steelTreads.has(n) ? "steel" : "wood";
  const spec = {
    fixing: sup.treadFixing,
    screws: sup.treadScrews,
    holeDiameter: sup.treadHoleDiameter,
  };
  // Points de la marche : disposés pour le nombre prévu, puis réduits aux points gardés
  // (seconde passe A31) ; perçages du support et visserie sur les seuls points gardés.
  const layoutCount = treadSupportJoint(spec, treadMaterial, s1 - s0).holes;
  const keep = treadMaterial === "steel" ? input.treadKeep?.get(id) : undefined;
  const kept = keep ? keep.filter(Boolean).length : layoutCount;
  const joint = treadSupportJoint({ ...spec, screws: kept }, treadMaterial, s1 - s0);
  const pick = (h: readonly { s: Mm; y: Mm }[]) => (keep ? h.filter((_, i) => keep[i]) : [...h]);
  const built =
    sup.kind === "console"
      ? consoleParts(id, base, sup, beamWidth, joint, treadMaterial, input, layoutCount, pick)
      : foldedSupportPart(
          id,
          base,
          sup,
          beamWidth,
          joint,
          treadMaterial,
          input,
          cosA,
          layoutCount,
          pick,
        );
  if (!built) return null;
  return {
    ...base,
    zBeam: built.zBeam ?? base.zBeam,
    beamLo: built.beamLo ?? -beamWidth / 2,
    beamHi: built.beamHi ?? beamWidth / 2,
    index: Math.max(1, index),
    sigma0: sigma - (bw / 2 + built.backReach) * cosA,
    sigma1: sigma + (bw / 2) * cosA,
    parts: built.parts,
    treadPoints: built.treadPoints,
    flanges: built.flanges,
  };
}

/**
 * Points de fixation de la marche dans l'appui, (s, y) dans le repère du support : une rangée
 * sur l'axe (`yOffset` = 0), ou deux rangées à ± `yOffset` de part et d'autre de l'âme d'une
 * console ; extrêmes à `edge` des bouts du support.
 */
function treadHoleLayout(count: number, s0: Mm, s1: Mm, edge: Mm, yOffset: Mm): { s: Mm; y: Mm }[] {
  if (count <= 0) return [];
  const e = Math.min(edge, (s1 - s0) / 2);
  if (yOffset <= 0) return spread(count, s0 + e, s1 - e).map((s) => ({ s, y: 0 }));
  const xs = spread(Math.ceil(count / 2), s0 + e, s1 - e);
  return Array.from({ length: count }, (_, i) => ({
    s: xs[Math.floor(i / 2)]!,
    y: i % 2 === 0 ? yOffset : -yOffset,
  }));
}

/** Subdivisions du profil du dessus de la poutre dans le plan d'une console. */
const CONTACT_SAMPLES = 8;

/**
 * Contact d'un plan vertical (point `center` de la trace en σ, direction `across`) avec le dessus
 * de la poutre de demi-largeur `half` : abscisses `lo` < 0 < `hi` des rives (distance latérale
 * à la trace ±`half`) et profil (s, z) du dessus entre elles, z = topAt(σ(s)), σ(s) projection
 * sur la trace du point center + s·across — le dessus de la poutre est horizontal en travers de
 * la trace (flasques de même hauteur, semelle haute). Plan normal à la trace : [−b/2 ; b/2] et
 * dessus quasi horizontal ; plan en biais d'un angle β : largeur b / cos β, dessus incliné.
 */
export function beamContact(
  trace: CentralTrace,
  topAt: (sigma: Mm) => Mm,
  center: Vec2,
  sigma: Mm,
  across: Vec2,
  half: Mm,
): { lo: Mm; hi: Mm; profile: Vec2[] } {
  const project = (s: Mm): { sigma: Mm; d: Mm } => {
    const p = V.addScaled(center, across, s);
    let x = sigma + s * V.dot(across, trace.tangent(sigma));
    for (let k = 0; k < 6; k++) x += V.dot(V.sub(p, trace.point(x)), trace.tangent(x));
    return { sigma: x, d: V.dot(V.sub(p, trace.point(x)), trace.left(x)) };
  };
  const cos = Math.max(0.2, Math.abs(V.dot(across, trace.left(sigma))));
  const edge = (sign: 1 | -1): Mm => {
    // d(s) croît avec s (across orienté vers la gauche) : dichotomie sur d = sign · half.
    let a = 0;
    let b = (sign * 2 * half) / cos;
    for (let k = 0; k < 40; k++) {
      const m = (a + b) / 2;
      if (sign * project(m).d < half) a = m;
      else b = m;
    }
    return (a + b) / 2;
  };
  const lo = edge(-1);
  const hi = edge(1);
  const profile = Array.from({ length: CONTACT_SAMPLES + 1 }, (_, k) => {
    const s = lo + ((hi - lo) * k) / CONTACT_SAMPLES;
    return V.vec(s, topAt(project(s).sigma));
  });
  return { lo, hi, profile };
}

/** Altitude d'un profil (s, z) croissant en s, interpolée linéairement (bornée aux extrémités). */
function profileAt(profile: readonly Vec2[], s: Mm): Mm {
  if (s <= profile[0]!.x) return profile[0]!.y;
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1]!;
    const b = profile[i]!;
    if (s <= b.x) return b.x - a.x > 1e-12 ? a.y + ((b.y - a.y) * (s - a.x)) / (b.x - a.x) : b.y;
  }
  return profile[profile.length - 1]!.y;
}

/** Console : âme découpée laser (plan vertical en travers) et plat d'appui percé. */
function consoleParts(
  id: string,
  b: SupportBase,
  sup: SteelCentralParams["supports"],
  beamWidth: Mm,
  joint: ReturnType<typeof treadSupportJoint>,
  treadMaterial: TreadMaterialKind,
  input: PlaceInput,
  layoutCount: number,
  pick: KeepPoints,
): BuiltSupport {
  const { material, profile } = input;
  const { s0, s1, zTop, center, across } = b;
  const t = sup.consoleThickness;
  const bt = sup.bearingThickness;
  const bw = b.bearingWidth;
  const top = zTop - bt;
  // Appui sur la poutre : intersection du plan de l'âme avec le dessus de la poutre.
  const contact = beamContact(input.trace, input.topAt, center, b.sigma, across, beamWidth / 2);
  const cLo = Math.max(s0, contact.lo);
  const cHi = Math.min(s1, contact.hi);
  if (!(cHi > cLo)) {
    throw new MessageError(
      msg("structure.steelCentral.error.supportOffBeam", { mark: b.treadMark }),
    );
  }
  const bottom: Vec2[] = [
    V.vec(cHi, profileAt(contact.profile, cHi)),
    ...contact.profile.filter((p) => p.x < cHi - 1e-6 && p.x > cLo + 1e-6).reverse(),
    V.vec(cLo, profileAt(contact.profile, cLo)),
  ];
  const zBeam = Math.max(...bottom.map((p) => p.y));
  if (!(top - zBeam > 1)) {
    throw new MessageError(
      msg("structure.steelCentral.error.supportTooLow", {
        mark: b.treadMark,
        height: dec(zTop - zBeam, 0),
      }),
    );
  }
  const tipBase = top - sup.tipHeight;
  // Contour de l'âme (s, z) : dessus horizontal, bouts de hauteur `tipHeight`, appui sur le
  // dessus de la poutre (profil réel, à cheval sur la trace).
  const raw: Vec2[] = [V.vec(s0, top), V.vec(s1, top)];
  if (s1 > cHi + 1e-6) raw.push(V.vec(s1, Math.max(tipBase, bottom[0]!.y)));
  raw.push(...bottom);
  if (s0 < cLo - 1e-6) raw.push(V.vec(s0, Math.max(tipBase, bottom[bottom.length - 1]!.y)));
  const outline = [...ensureCCW(dedupe(raw))];
  const zMin = Math.min(...outline.map((p) => p.y));
  const flatOuter = outline.map((p) => V.vec(p.x - s0, p.y - zMin));
  const webFlat: FlatPattern = {
    outline: { outer: flatOuter, holes: [] },
    lines: [labelLine((s1 - s0) / 2, (top - zMin) / 2, "CO")],
    thickness: t,
    reference: {
      kind: "face",
      description: msg("structure.steelCentral.reference.console", { tread: b.treadMark }),
    },
  };
  const zAxis = V.perpRight(across);
  const o = V.addScaled(center, zAxis, -t / 2);
  const meas = plateMeasures(webFlat.outline, t);
  const box = minAreaRect(flatOuter);
  // Cordons de l'âme sur la poutre : deux faces, sur la longueur de contact réelle.
  let contactLength = 0;
  for (let i = 1; i < bottom.length; i++) contactLength += V.distance(bottom[i - 1]!, bottom[i]!);
  const web: Part = {
    id,
    mark: "CO",
    category: "support",
    name: msg("structure.steelCentral.part.console", { tread: b.treadMark }),
    material,
    solid: {
      kind: "extrusion",
      frame: { origin: { x: o.x, y: o.y, z: 0 }, xAxis: v3(across), yAxis: UP, zAxis: v3(zAxis) },
      profile: { outer: outline, holes: [] },
      depth: t,
    },
    flat: webFlat,
    section: msg("structure.steel.section.plate", { thickness: dec(t, 0) }),
    stock: { length: box.length, width: box.width, thickness: t },
    quantities: steelQuantities(
      {
        volumeMm3: meas.volumeMm3,
        treatedSurfaceMm2: meas.treatedSurfaceMm2,
        length: box.length,
        weld: 2 * contactLength,
        cuts: 1,
        laserCut: meas.laserCut,
      },
      profile,
    ),
  };
  // Plat d'appui (s ∈ [s0 ; s1], y ∈ [−bw/2 ; bw/2]), percé pour la marche de part et d'autre
  // de l'âme ; perçages dessinés sous une marche en tôle (diamètre connu, A31), seulement
  // comptés sous une marche bois (vis à bois, perçage non dimensionné).
  const yOffset = (bw / 2 + t / 2) / 2;
  const holes = pick(treadHoleLayout(layoutCount, s0, s1, sup.holeEdgeDistance, yOffset));
  const drawn = treadMaterial === "steel" ? holes : [];
  const L = s1 - s0;
  const flat: FlatPattern = {
    outline: {
      outer: [V.vec(0, 0), V.vec(L, 0), V.vec(L, bw), V.vec(0, bw)],
      holes: drawn.map((h) => holePolygon(V.vec(h.s - s0, h.y + bw / 2), sup.treadHoleDiameter)),
    },
    lines: [labelLine(L / 2, bw / 2, "AP")],
    thickness: bt,
    reference: {
      kind: "face",
      description: msg("structure.steelCentral.reference.bearing", { tread: b.treadMark }),
    },
  };
  const yAxis = V.perpLeft(across);
  const pm = plateMeasures(flat.outline, bt);
  const bearing: Part = {
    id: `${id}-bearing`,
    mark: "AP",
    category: "support",
    name: msg("structure.steelCentral.part.bearing", { tread: b.treadMark }),
    material,
    solid: {
      kind: "extrusion",
      frame: {
        origin: { x: center.x, y: center.y, z: zTop - bt },
        xAxis: v3(across),
        yAxis: v3(yAxis),
        zAxis: UP,
      },
      profile: {
        outer: [V.vec(s0, -bw / 2), V.vec(s1, -bw / 2), V.vec(s1, bw / 2), V.vec(s0, bw / 2)],
        holes: drawn.map((h) => holePolygon(V.vec(h.s, h.y), sup.treadHoleDiameter)),
      },
      depth: bt,
    },
    flat,
    section: msg("structure.steel.section.plate", { thickness: dec(bt, 0) }),
    stock: { length: L, width: bw, thickness: bt },
    quantities: steelQuantities(
      {
        volumeMm3: pm.volumeMm3,
        treatedSurfaceMm2: pm.treatedSurfaceMm2,
        length: L,
        // Plat d'appui sur l'âme (deux cordons), plus la marche soudée (A31).
        weld: 2 * L + joint.weld,
        cuts: 1,
        laserCut: pm.laserCut,
        holes: joint.holes,
      },
      profile,
    ),
    ...(joint.fixings.length > 0 ? { fixings: [...joint.fixings] } : {}),
  };
  const world = (h: { s: Mm; y: Mm }): Vec2 =>
    V.addScaled(V.addScaled(center, across, h.s), yAxis, h.y);
  return {
    zBeam,
    beamLo: contact.lo,
    beamHi: contact.hi,
    parts: [web, bearing],
    treadPoints: holes.map(world),
    backReach: 0,
    flanges: [],
  };
}

/** Support plié (U, Z, triangle) : section extrudée en travers, développé rectangulaire. */
function foldedSupportPart(
  id: string,
  b: SupportBase,
  sup: SteelCentralParams["supports"],
  beamWidth: Mm,
  joint: ReturnType<typeof treadSupportJoint>,
  treadMaterial: TreadMaterialKind,
  input: PlaceInput,
  cosA: number,
  layoutCount: number,
  pick: KeepPoints,
): BuiltSupport | null {
  const bend = input.supportBend;
  if (!bend) return null;
  const { material, profile, topAt } = input;
  const kind = sup.kind as Exclude<CentralSupportKind, "console">;
  const { s0, s1, zTop, zBeam, center, across, along, sigma } = b;
  const bw = b.bearingWidth;
  const t = bend.thickness;
  const r = bend.innerRadius;
  // Pente du dessus de la poutre le long de `along` au droit du support.
  const h = Math.max(1, bw / 2);
  const slope = (topAt(sigma + h * cosA) - topAt(sigma - h * cosA)) / (2 * h);
  const yb = (x: Mm): Mm => zBeam + slope * x - zTop;
  const ret = bw;
  const fs = foldedSupportSection(kind, bw, t, r, yb, slope, ret, b.treadMark);
  const section = fs.section;
  const bas = section.bends.map((bd) => bendAllowance(bd.angle, r, bend.k, t));
  const starts: Mm[] = [];
  let acc = 0;
  section.straights.forEach((len, i) => {
    starts.push(acc);
    acc += len + (bas[i] ?? 0);
  });
  const W = acc;
  const L = s1 - s0;
  // Perçages : marche (âme d'appui), boulons dans le retour posé sur la poutre (vissé).
  const holes = pick(treadHoleLayout(layoutCount, s0, s1, sup.holeEdgeDistance, 0));
  const drawnTread = treadMaterial === "steel" ? holes : [];
  const bolted = effectiveCentralFixing(sup) === "bolted" && fs.returnIndex !== null;
  const half = beamWidth / 2;
  const boltS = bolted
    ? spread(
        sup.bolts,
        Math.max(s0, -half) + sup.holeEdgeDistance,
        Math.min(s1, half) - sup.holeEdgeDistance,
      )
    : [];
  const webY = starts[fs.webIndex]! + section.straights[fs.webIndex]! / 2;
  const retY =
    fs.returnIndex !== null ? starts[fs.returnIndex]! + section.straights[fs.returnIndex]! / 2 : 0;
  const lines: FlatPattern["lines"][number][] = section.bends.map((bd, i) => {
    const y = starts[i]! + section.straights[i]! + bas[i]! / 2;
    const deg = (bd.angle * 180) / Math.PI;
    return {
      kind: "bend" as const,
      a: V.vec(0, y),
      b: V.vec(L, y),
      label: msg(
        bd.up ? "structure.steel.folded.bendLine.up" : "structure.steel.folded.bendLine.down",
        { n: i + 1, angle: dec(deg, 0), radius: dec(r, 1) },
      ),
      bendAngle: deg,
      bendUp: bd.up,
      bendRadius: r,
    };
  });
  lines.push(labelLine(L / 2, webY, "SP"));
  const flat: FlatPattern = {
    outline: {
      outer: [V.vec(0, 0), V.vec(L, 0), V.vec(L, W), V.vec(0, W)],
      holes: [
        ...drawnTread.map((p) => holePolygon(V.vec(p.s - s0, webY), sup.treadHoleDiameter)),
        ...boltS.map((s) => holePolygon(V.vec(s - s0, retY), sup.holeDiameter)),
      ],
    },
    lines,
    thickness: t,
    reference: {
      kind: "neutral-fiber",
      description: msg("structure.steelCentral.reference.foldedSupport", {
        kind: supportKindLabel(sup.kind),
        k: dec(bend.k, 3),
        radius: dec(r, 1),
        thickness: dec(t, 1),
        method: bend.method,
      }),
    },
  };
  const poly = sectionPolygon(section).map((p) => V.vec(p.x, p.y + zTop));
  // Repère direct : X = le long de la trace, Y = verticale, Z = X × Y = perpRight(X).
  const zAxis = V.perpRight(along);
  const forward = V.dot(zAxis, across) > 0;
  const o = V.addScaled(center, across, forward ? s0 : s1);
  const meas = plateMeasures(flat.outline, t);
  // Cordons sur la poutre : deux par aile posée (ailes du U, retour), sur sa largeur.
  const contact = Math.max(0, Math.min(half, s1) - Math.max(-half, s0));
  const seats = kind === "folded-u" ? 2 : 1;
  const fixings: PartFixing[] = [
    ...joint.fixings,
    ...(boltS.length > 0
      ? [{ joint: "supportBolted" as const, points: boltS.length, holeDiameter: sup.holeDiameter }]
      : []),
  ];
  const part: Part = {
    id,
    mark: "SP",
    category: "support",
    name: msg("structure.steelCentral.part.foldedSupport", {
      kind: supportKindLabel(sup.kind),
      tread: b.treadMark,
    }),
    material,
    solid: {
      kind: "extrusion",
      frame: { origin: { x: o.x, y: o.y, z: 0 }, xAxis: v3(along), yAxis: UP, zAxis: v3(zAxis) },
      profile: { outer: poly, holes: [] },
      depth: L,
    },
    flat,
    section: msg("structure.steelCentral.section.foldedSupport", {
      thickness: dec(t, 0),
      kind: supportKindLabel(sup.kind),
    }),
    stock: { length: L, width: W, thickness: t },
    quantities: steelQuantities(
      {
        volumeMm3: meas.volumeMm3,
        treatedSurfaceMm2: meas.treatedSurfaceMm2,
        length: L,
        weld: (bolted ? 0 : 2 * seats * contact) + joint.weld,
        cuts: 1,
        laserCut: meas.laserCut,
        bends: section.bends.length,
        bendLength: section.bends.length * L,
        holes: joint.holes + boltS.length,
      },
      profile,
    ),
    ...(fixings.length > 0 ? { fixings } : {}),
  };
  const world = (p: { s: Mm; y: Mm }): Vec2 =>
    V.addScaled(V.addScaled(center, across, p.s), along, fs.webX);
  const flanges: FlangeCheck[] = section.straights.map((len, i) => ({
    label: section.flangeNames[i]!,
    atStart: len,
    atEnd: len,
  }));
  const backReach = kind === "folded-z" ? ret * Math.cos(Math.atan(slope)) : 0;
  return { parts: [part], treadPoints: holes.map(world), backReach, flanges };
}

/**
 * Repères des pièces des supports par groupes de pièces identiques (`markGroups` : CO âmes de
 * console, AP plats d'appui, SP supports pliés) et pièce de poutre des boulons d'un support
 * vissé (`PartFixing.with`).
 */
function markSupportParts(
  supports: readonly CentralSupport[],
  kind: CentralSupportKind,
  fixing: "welded" | "bolted",
): Part[] {
  const first: Part[] = [];
  const bearings: Part[] = [];
  for (const s of supports) {
    const [p0, p1] = s.parts;
    if (!p0) continue;
    const beam = s.beamPart;
    first.push(
      fixing === "bolted" && beam !== undefined && p0.fixings
        ? {
            ...p0,
            fixings: p0.fixings.map((f) =>
              f.joint === "supportBolted" ? { ...f, with: [beam] } : f,
            ),
          }
        : p0,
    );
    if (p1) bearings.push(p1);
  }
  const key = (p: Part): string => p.id;
  return [
    ...markGroups(first, kind === "console" ? "CO" : "SP", key),
    ...markGroups(bearings, "AP", key),
  ];
}

// ------------------------------------------------------------------ contrôles

interface CentralChecksInput {
  readonly exc: ReturnType<typeof deduceExecutionClass>;
  readonly grade: SteelGrade;
  readonly metal: WorkshopProfile["metal"];
  readonly params: SteelCentralParams;
  readonly treadBend: ResolvedBend | null;
  readonly supportBend: ResolvedBend | null;
  readonly treads: readonly FoldedTreadDetail[];
  readonly arrival: {
    readonly part: Part;
    readonly result: Pick<FoldedTreadResult, "flanges" | "bendLines">;
  } | null;
  readonly supports: readonly CentralSupport[];
  readonly zones: readonly TreadZone[];
  readonly beamWidth: Mm;
}

/** Le développé L × l tient-il dans un format de tôle du profil d'atelier (dans un sens) ? */
function fitsSheet(metal: WorkshopProfile["metal"], length: Mm, width: Mm): boolean {
  return metal.sheetFormats.some(
    (f) =>
      (length <= f.length + 1e-6 && width <= f.width + 1e-6) ||
      (length <= f.width + 1e-6 && width <= f.length + 1e-6),
  );
}

/** Pièce pliée contrôlée : ailes (bord mini) et lignes de pli (presse plieuse). */
interface FoldedItem {
  readonly part: Part;
  readonly flanges: readonly FlangeCheck[];
  readonly bendLines: readonly { readonly mark: string; readonly length: Mm }[];
}

/** Contrôles de pliage d'une loi de pli (rayon mini, bord mini, presse plieuse). */
function addBendChecks(
  checks: CheckCollector,
  grade: SteelGrade,
  metal: WorkshopProfile["metal"],
  bend: ResolvedBend,
  items: readonly FoldedItem[],
): void {
  const rule = (spec: PluginRuleSpec) => pluginRuleDef(spec);
  checks.addItems(
    rule(STEEL_RULES.bendRadius),
    [
      {
        value: bend.innerRadius,
        label: msg("structure.steel.check.gradeThickness", {
          grade,
          thickness: dec(bend.thickness, 1),
        }),
      },
    ],
    msg("structure.steel.quantity.bendInnerRadius"),
    { min: minBendRadiusFactor(grade) * bend.thickness - 1e-9, max: null },
  );
  checks.addItems(
    rule(STEEL_RULES.bendFlange),
    items.flatMap((d) =>
      d.flanges.flatMap((fl) => [
        {
          value: fl.atStart,
          label: msg("structure.steel.check.flangeBendStart", {
            mark: d.part.mark,
            flange: fl.label,
          }),
          partId: d.part.id,
        },
        {
          value: fl.atEnd,
          label: msg("structure.steel.check.flangeBendEnd", {
            mark: d.part.mark,
            flange: fl.label,
          }),
          partId: d.part.id,
        },
      ]),
    ),
    msg("structure.steel.quantity.innerFlangeLength"),
    { min: bend.minFlange - 1e-9, max: null },
  );
  checks.addItems(
    rule(STEEL_RULES.pressBrake),
    items.flatMap((d) =>
      d.bendLines.map((l) => ({
        value: l.length,
        label: textMessage(`${d.part.mark}, ${l.mark}`),
        partId: d.part.id,
      })),
    ),
    msg("structure.steel.quantity.bendLength"),
    { min: null, max: metal.pressBrake.maxLength },
  );
  checks.addItems(
    rule(STEEL_RULES.pressBrake),
    [{ value: bend.thickness, label: msg("structure.steel.check.foldedPlateThickness") }],
    msg("structure.steel.quantity.foldedThickness"),
    { min: null, max: metal.pressBrake.maxThickness },
  );
}

/** Étape 11 : contrôles de fabrication et de portée des marches (ordre stable). */
function addCentralChecks(checks: CheckCollector, input: CentralChecksInput): void {
  const { exc, grade, metal, params, treadBend, supportBend, treads, arrival } = input;
  const { supports, zones, beamWidth } = input;
  const rule = (spec: PluginRuleSpec) => pluginRuleDef(spec);
  checks.add(rule(STEEL_RULES.executionClass), [
    {
      status: "ok",
      message: msg("structure.steel.exc.check", {
        executionClass: exc.executionClass,
        reasons: executionClassReasons(exc, grade),
      }),
    },
  ]);
  // Pliage : marches et contremarche d'arrivée (loi des marches), supports pliés (leur loi).
  if (treadBend) {
    addBendChecks(checks, grade, metal, treadBend, [
      ...treads.map((d) => ({
        part: d.part,
        flanges: d.result.flanges,
        bendLines: d.result.bendLines,
      })),
      ...(arrival
        ? [
            {
              part: arrival.part,
              flanges: arrival.result.flanges,
              bendLines: arrival.result.bendLines,
            },
          ]
        : []),
    ]);
  }
  const supportParts = supports.flatMap((s) => s.parts);
  if (supportBend && params.supports.kind !== "console") {
    addBendChecks(
      checks,
      grade,
      metal,
      supportBend,
      supports.map((s) => ({
        part: s.parts[0]!,
        flanges: s.flanges,
        bendLines: (s.parts[0]!.flat?.lines ?? [])
          .filter((l) => l.kind === "bend")
          .map((l, i) => ({ mark: `P${i + 1}`, length: V.distance(l.a, l.b) })),
      })),
    );
  }
  // Découpe laser et formats de tôle : marches, contremarche d'arrivée, supports.
  const flats = [
    ...treads.map((d) => d.part),
    ...(arrival ? [arrival.part] : []),
    ...supportParts,
  ].filter((p) => p.flat);
  checks.addItems(
    rule(STEEL_RULES.laser),
    flats.map((p) => ({ value: p.flat!.thickness, label: textMessage(p.mark), partId: p.id })),
    msg("structure.steel.quantity.cutThickness"),
    { min: null, max: metal.laser.maxThickness },
  );
  const formats: Finding[] = flats.map((p) => {
    const box = minAreaRect(p.flat!.outline.outer);
    const ok = fitsSheet(metal, box.length, box.width);
    return {
      status: ok ? "ok" : "violation",
      measured: box.length,
      location: { kind: "part", partId: p.id },
      message: sheetFormatMessage(
        ok ? "structure.steel.check.inSheetFormat" : "structure.steel.check.outOfSheetFormats",
        p.mark,
        box,
      ),
    };
  });
  if (formats.length > 0) checks.add(rule(STEEL_RULES.sheetFormat), formats);
  // Supports : longueur (enjambe la poutre), hauteur au-dessus de la poutre.
  const item = (s: CentralSupport, value: number): CheckItem => ({
    value,
    label: textMessage(`${s.treadMark}, ${s.parts[0]!.mark}`),
    partId: s.parts[0]!.id,
    treadNumber: s.tread,
  });
  checks.addItems(
    rule(STEEL_RULES.supportLength),
    supports.map((s) => item(s, s.s1 - s.s0)),
    msg("structure.steelCentral.quantity.supportLength"),
    { min: beamWidth, max: null },
  );
  checks.addItems(
    rule(CENTRAL_RULES.supportHeight),
    supports.map((s) => item(s, s.zTop - s.zBeam)),
    msg("structure.steelCentral.quantity.supportHeight"),
    { min: params.supports.minHeight - 1e-9, max: null },
  );
  // Marches portées : au moins un support qui enjambe la poutre (rives dans sa direction).
  const carried = new Set(
    supports.filter((s) => s.s0 <= s.beamLo + 1e-6 && s.s1 >= s.beamHi - 1e-6).map((s) => s.tread),
  );
  checks.add(
    rule(STEEL_RULES.treadCarried),
    zones.map((z): Finding =>
      carried.has(z.tread.number)
        ? {
            status: "ok",
            location: { kind: "tread", number: z.tread.number },
            message: msg("structure.steelCentral.check.treadCarried", { mark: z.mark }),
          }
        : {
            status: "violation",
            location: { kind: "tread", number: z.tread.number },
            message: msg("structure.steelCentral.check.treadNotCarried", { mark: z.mark }),
          },
    ),
  );
}

// ------------------------------------------------------------------ plugin

/** Le tracé porte-t-il une trace courbe (tournant ou hélicoïdal) ? */
function curvedLayout(traits: StructureLayoutTraits): boolean {
  return traits.kind === "helical" || traits.turns > 0;
}

/**
 * Options non prises en charge : section tube sur une trace courbe (tournant, hélicoïdal) —
 * C §2.3 : aucune capacité chiffrée de cintrage hélicoïdal d'un tube ; le caisson (flasques
 * roulées, C §2.4 [20]) est la seule section proposée.
 */
export function centralUnsupportedOptions(
  traits: StructureLayoutTraits,
): readonly UnsupportedParamOption[] {
  return curvedLayout(traits)
    ? [
        {
          path: ["section", "kind"],
          value: "tube",
          reason: msg("structure.steelCentral.unsupported.tubeCurved"),
        },
      ]
    : [];
}

export const STEEL_CENTRAL: StructureKind<SteelCentralParams> = {
  kind: "steel-central",
  labelKey: "structure.steelCentral.label",
  family: "metal",
  paramsSchema: SteelCentralParamsSchema,
  // Section par défaut : tube sur un escalier droit, caisson sur une trace courbe (le tube
  // n'y est pas pris en charge, `unsupportedOptions`).
  defaults: (ctx) => {
    const lay = ctx.project.stair.layout;
    const curved = curvedLayout(
      lay.kind === "helical"
        ? { kind: "helical", turns: 0 }
        : { kind: "flights", turns: lay.turns.length },
    );
    return SteelCentralParamsSchema.parse({
      section: { kind: curved ? CENTRAL_SECTION_KINDS[1] : CENTRAL_SECTION_KINDS[0] },
    });
  },
  build: (ctx, params) => buildSteelCentral(ctx, params).output,
  capabilities: {
    layouts: ["flights", "helical"],
    requiresNewel: false,
    // Poutre sous les marches : aucune épaisseur hors de l'emmarchement utile.
    lateralThickness: () => ({ inner: 0, outer: 0 }),
    unsupportedOptions: centralUnsupportedOptions,
  },
};
