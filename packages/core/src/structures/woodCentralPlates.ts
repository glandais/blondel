/**
 * Platines à âme noyée du limon central bois (`wood-central`, QUESTIONS A33 (f), A34 (c),
 * décisions du 2026-10-09 ; C §1.11 [80], [71]) : ancrage `anchors.kind` = `embeddedPlate`
 * (défaut sur une poutre cintrée, `resolveAnchorKind`), à côté du sabot en U
 * (`woodCentralShoes.ts`, défaut sur une poutre droite).
 *
 * Contrat partagé (squelette posé par l'architecte de la vague « suites du limon central ») :
 * même entrée que les sabots (`WoodCentralShoesInput`, géométrie de la poutre
 * `ShoeBeamGeometry`) ; la poutre (`woodCentralBeam.ts`) appelle
 * `buildWoodCentralEmbeddedPlates` à la place de `buildWoodCentralShoes` et :
 * - coupe la poutre de niveau sur le dessus de la platine de pied (z = `anchors.plate.thickness`)
 *   et d'aplomb en tête à `trimmerSigma − anchors.plate.thickness − wood.clearance` ;
 * - reporte sur son développé les perçages des broches (`beamHoles`, horizontaux, au travers
 *   des faces : vrais trous du développé, comme ceux des boulons de sabot) et le **trait de
 *   scie** de chaque âme (`beamKerfs`, rectangle tracé en lignes de traçage) ;
 * - écarte ses boulons et tire-fonds de marche des broches (entraxe a1 au moins) ;
 * - transmet `welded` au plugin (classe d'exécution : âme soudée en T sur la platine).
 *
 * Convention Blondel **à valider** (dimensions de `anchors.plate`, aucune source escalier ;
 * principe et ordre de grandeur d'un pied de poteau à âme du commerce, C §1.11 [80]) :
 * - **Pied** (`PP1` platine, `AP1` âme) : platine d'appui posée au sol sous la poutre, le long
 *   de la trace sur `anchors.length` depuis la face avant de la poutre, largeur
 *   `anchors.plate.width` (`auto` : b + 4 × `anchors.holeEdgeDistance`), chevillée au sol
 *   (`anchors.anchors` chevilles de perçage `anchors.anchorHoleDiameter`, de part et d'autre de
 *   la poutre, fixation `plateFloor`) ; âme verticale de `webLength` × `webDepth` dans le plan
 *   médian de la poutre, soudée sur la platine, noyée vers le haut dans un trait de scie de la
 *   sous-face (épaisseur `webThickness` + 2 × `wood.clearance`).
 * - **Tête** (`PT1` platine, `AT1` âme) : platine verticale contre le chevêtre, de hauteur
 *   `anchors.length` depuis le dessous de la poutre à sa coupe de tête, fixée au chevêtre
 *   (`plateTrimmer`) ; âme dans le plan médian, noyée le long de la trace dans un trait de scie
 *   de la coupe de tête (`webDepth` le long de la trace, `webLength` en hauteur).
 * - **Broches** (`anchors.plate.pins`, Ø `pinDiameter`, perçage `pinHoleDiameter` dans l'âme)
 *   horizontales au travers des faces de la poutre et de l'âme, placées selon les entraxes et
 *   pinces des broches de l'EC5 (`ec5Spacing("dowel", d)`, C §1.11 [71]) ; fixation
 *   `embeddedPlatePinned` déclarée sur l'âme (`with` = la poutre, longueur = b).
 * - Sur une poutre cintrée, l'âme reste plane (corde) : sa flèche dans la poutre est contrôlée
 *   (l'âme et le trait de scie restent dans le bois, à la pince a4 des faces).
 *
 * `buildWoodCentralEmbeddedPlates` ne lève jamais : erreurs dans `errors`.
 */
import { dec, errorMessage, msg, textMessage, type Message } from "@blondel/i18n";
import * as V from "../geom2d/vec.js";
import type { FlatPattern, Part, PartFixing } from "../model/derived.js";
import type { PartAssembly } from "../model/plugins.js";
import type { Mm, Vec2, Vec3 } from "../model/primitives.js";
import { sourceSpec } from "../rules/sources.js";
import type { Finding } from "../rules/types.js";
import type { CentralTrace } from "./centralTrace.js";
import { pluginRuleDef, type PluginRuleSpec } from "./checks.js";
import { minAreaRect, pointSegmentDistance } from "./geom.js";
import {
  STEEL_RULES,
  holePolygon,
  plateMeasures,
  steelMaterial,
  steelQuantities,
} from "./steelCommon.js";
import { ec5Spacing } from "./woodSpacing.js";
import { spread, type ShoeBeamHole, type WoodCentralShoesInput } from "./woodCentralShoes.js";

/**
 * Contrôles de fabrication des platines à âme noyée (hors rules.yaml) ; titres et descriptions :
 * `rules.<id>.title` / `rules.<id>.description`. Repris dans `WOOD_CENTRAL_BEAM_RULES`
 * (`rules/messages.test.ts`). Nom **figé**.
 */
export const WOOD_CENTRAL_PLATE_RULES = {
  /**
   * Platine et âme logées : platine sous la coupe au sol (pied) ou dans la hauteur de la coupe
   * de tête, âme et trait de scie dans le bois (profondeur, flèche de l'âme plane dans une
   * poutre cintrée, pince a4 des faces), broches aux entraxes et pinces de l'EC5 (C §1.11 [71]).
   */
  plateFit: {
    id: "FAB_PLATINE_AME_NOYEE",
    ...sourceSpec(msg("compliance.source.woodCentralPlateFit")),
    confidence: "faible",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
} as const satisfies Record<string, PluginRuleSpec>;

/** Identifiants et repères des platines et de leurs âmes (contrat de la vague). */
export const WOOD_CENTRAL_PLATE_FOOT_ID = "wood-central-plate-foot";
export const WOOD_CENTRAL_PLATE_FOOT_WEB_ID = "wood-central-plate-foot-web";
export const WOOD_CENTRAL_PLATE_HEAD_ID = "wood-central-plate-head";
export const WOOD_CENTRAL_PLATE_HEAD_WEB_ID = "wood-central-plate-head-web";
export const WOOD_CENTRAL_PLATE_FOOT_MARK = "PP1";
export const WOOD_CENTRAL_PLATE_FOOT_WEB_MARK = "AP1";
export const WOOD_CENTRAL_PLATE_HEAD_MARK = "PT1";
export const WOOD_CENTRAL_PLATE_HEAD_WEB_MARK = "AT1";

/**
 * Trait de scie d'une âme dans la poutre (développement à l'axe) : rectangle [σ0 ; σ1] ×
 * [z0 ; z1] dans le plan médian, de largeur `width` perpendiculairement aux faces.
 */
export interface BeamKerf {
  /** Repère de l'âme logée. */
  readonly mark: string;
  readonly sigma0: Mm;
  readonly sigma1: Mm;
  readonly z0: Mm;
  readonly z1: Mm;
  /** Largeur du trait de scie (âme + 2 × jeu), mm. */
  readonly width: Mm;
}

export interface WoodCentralPlatesResult {
  /** Platines et âmes (catégorie `fixing`). */
  readonly parts: readonly Part[];
  /** Perçages des broches au travers de la poutre (même forme que ceux des boulons de sabot). */
  readonly beamHoles: readonly ShoeBeamHole[];
  /** Traits de scie des âmes, à tracer sur le développé de la poutre. */
  readonly beamKerfs: readonly BeamKerf[];
  /** Assemblages : platine ↔ âme, âme ↔ poutre. */
  readonly assemblies: readonly PartAssembly[];
  /** Âmes soudées sur leur platine (classe d'exécution du plugin). */
  readonly welded: boolean;
  readonly notes: readonly Message[];
  readonly errors: readonly Message[];
}

/**
 * Largeur de la platine d'appui en travers de la poutre : saisie, ou `auto` → b + 4 ×
 * `anchors.holeEdgeDistance` (chevilles de part et d'autre de la poutre, à la pince du bord de
 * la platine et de la face de la poutre). Contrat partagé (valeur `auto` exposée par le plugin).
 */
export function resolvePlateWidth(params: WoodCentralShoesInput["params"]): Mm {
  const w = params.anchors.plate.width;
  return w !== "auto" ? w : params.section.width + 4 * params.anchors.holeEdgeDistance;
}

/** Constat élémentaire d'une platine (joint aux autres dans un constat par platine). */
interface Issue {
  readonly message: Message;
  readonly measured: Mm;
  readonly min?: Mm;
  readonly max?: Mm;
}

/** Broche placée : abscisse sur la trace et altitude (développement à l'axe). */
export interface EmbeddedPin {
  readonly sigma: Mm;
  readonly z: Mm;
}

/** Pinces mesurées d'une broche (mm) : extrémité, rive du dessus, rive de la sous-face. */
interface PinDistances {
  readonly end: Mm;
  readonly top: Mm;
  readonly under: Mm;
}

/** Côté d'une platine (pied ou tête), dimensions retenues après réductions. */
interface PlateSpec {
  readonly foot: boolean;
  readonly id: string;
  readonly mark: string;
  readonly webId: string;
  readonly webMark: string;
  /** Pied : longueur le long de la trace ; tête : hauteur. */
  readonly length: Mm;
  /** Âme : longueur le long de la trace (pied) ou hauteur (tête). */
  readonly webLength: Mm;
  /** Âme : profondeur dans la poutre (hauteur au pied, le long de la trace en tête). */
  readonly webDepth: Mm;
  /** σ du repère de pose : milieu de la platine (pied), face du chevêtre (tête). */
  readonly at: Mm;
  /** Pied : début de l'âme en σ. Tête : bas de l'âme en z. */
  readonly webStart: Mm;
  /** Plan de l'âme en plan (corde de la trace, décalée pour centrer la flèche). */
  readonly line: EmbeddedWebLine;
  readonly pins: readonly EmbeddedPin[];
  readonly kerf: BeamKerf;
}

const UP: Vec3 = { x: 0, y: 0, z: 1 };
const v3 = (p: Vec2, z: Mm): Vec3 => ({ x: p.x, y: p.y, z });
const h3 = (p: Vec2): Vec3 => ({ x: p.x, y: p.y, z: 0 });
const EPS = 1e-6;
/** Pas de recherche des positions des broches (mm, précision géométrique, pas une valeur métier). */
const SCAN_STEP: Mm = 1;
/** Portée de la sous-face examinée de part et d'autre d'une broche (mm, ≫ pinces de l'EC5). */
const UNDER_REACH: Mm = 1000;
/** Tolérance de mesure des pinces (mm, arrondi d'affichage). */
const PINCH_TOL: Mm = 0.5;

/** Messages joints par « ; » (constat unique par platine). */
function joinIssues(items: readonly Message[]): Message {
  let out = items[items.length - 1]!;
  for (let i = items.length - 2; i >= 0; i--) {
    out = msg("compliance.join.semicolon", { first: items[i]!, next: out });
  }
  return out;
}

/** Distance (développé) d'un point à la courbe σ ↦ z échantillonnée sur [s0 ; s1]. */
function distanceToCurve(p: Vec2, s0: Mm, s1: Mm, z: (s: Mm) => Mm): Mm {
  if (!(s1 > s0)) return Infinity;
  const n = Math.max(1, Math.ceil((s1 - s0) / 2));
  let best = Infinity;
  let prev = V.vec(s0, z(s0));
  for (let i = 1; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    const q = V.vec(s, z(s));
    best = Math.min(best, pointSegmentDistance(p, prev, q));
    prev = q;
  }
  return best;
}

/** `count` valeurs réparties sur [lo ; hi] (une seule : au milieu). */
function evenly(lo: Mm, hi: Mm, count: number): Mm[] {
  if (count <= 0) return [];
  if (count === 1 || !(hi > lo)) return [(lo + hi) / 2];
  return Array.from({ length: count }, (_, i) => lo + ((hi - lo) * i) / (count - 1));
}

/** Nombre de broches qui tiennent sur [lo ; hi] à l'entraxe `a1` (au plus `wanted`). */
function fitting(lo: Mm, hi: Mm, a1: Mm, wanted: number): number {
  if (wanted <= 0) return 0;
  if (!(hi > lo)) return 1;
  return Math.min(wanted, Math.floor((hi - lo) / a1 + 1e-9) + 1);
}

/** Plan (vertical) d'une âme plane dans la poutre, vu en plan. */
export interface EmbeddedWebLine {
  /** Milieu de l'âme en plan (repère monde). */
  readonly center: Vec2;
  /** Direction de l'âme : corde de la trace sur la portée de l'âme, dans le sens de la montée. */
  readonly dir: Vec2;
  /**
   * Flèche (mm) : plus grand écart entre le plan de l'âme et le plan médian de la poutre sur la
   * portée de l'âme (nul sur une trace droite, ≈ L² / 16R sur un arc de rayon R).
   */
  readonly sag: Mm;
}

/**
 * Plan de l'âme plane d'une platine sur σ ∈ [from ; to] : parallèle à la corde de la trace et
 * décalé pour centrer les écarts au plan médian de la poutre (la flèche est partagée de part et
 * d'autre du plan de l'âme). Convention Blondel **à valider** : sur une poutre cintrée, l'âme
 * est soudée sur la platine selon cette corde (en tête, légèrement biaise par rapport à la
 * normale du chevêtre) ; sur une trace droite, l'âme est dans le plan médian.
 */
export function embeddedWebLine(trace: CentralTrace, from: Mm, to: Mm): EmbeddedWebLine {
  const a = trace.point(from);
  const b = trace.point(to);
  const chord = V.sub(b, a);
  const len = V.norm(chord);
  const dir = len > EPS ? V.scale(chord, 1 / len) : trace.tangent((from + to) / 2);
  const n = V.perpLeft(dir);
  const steps = Math.max(2, Math.ceil(Math.abs(to - from) / 5));
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i <= steps; i++) {
    const d = V.dot(n, V.sub(trace.point(from + ((to - from) * i) / steps), a));
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return {
    center: V.addScaled(V.scale(V.add(a, b), 0.5), n, (lo + hi) / 2),
    dir,
    sag: (hi - lo) / 2,
  };
}

/**
 * Platines à âme noyée de pied et de tête. Ne lève jamais (erreur inattendue : `errors`, sans
 * platine). Ajoute le contrôle `FAB_PLATINE_AME_NOYEE` (un constat par platine demandée) et
 * les contrôles de découpe laser à `checks`.
 */
export function buildWoodCentralEmbeddedPlates(
  input: WoodCentralShoesInput,
): WoodCentralPlatesResult {
  try {
    return buildPlates(input);
  } catch (err) {
    return {
      ...EMPTY,
      errors: [msg("structure.woodCentral.error.plate", { detail: errorMessage(err) })],
    };
  }
}

const EMPTY: WoodCentralPlatesResult = {
  parts: [],
  beamHoles: [],
  beamKerfs: [],
  assemblies: [],
  welded: false,
  notes: [],
  errors: [],
};

function buildPlates(input: WoodCentralShoesInput): WoodCentralPlatesResult {
  const { params, profile, beam, checks, trace } = input;
  const an = params.anchors;
  const P = an.plate;
  const rule = pluginRuleDef(WOOD_CENTRAL_PLATE_RULES.plateFit);
  if (!an.foot && !an.head) {
    checks.add(rule, [{ status: "ok", message: msg("structure.woodCentral.check.plate.none") }]);
    return EMPTY;
  }
  const b = params.section.width;
  const c = profile.wood.clearance;
  const tp = P.thickness;
  const W = resolvePlateWidth(params);
  const hE = an.holeEdgeDistance;
  const minLength = 2 * hE;
  const ec5 = ec5Spacing("dowel", P.pinDiameter);
  const loc = { kind: "part" as const, partId: beam.beamId };
  const kerfWidth = P.webThickness + 2 * c;
  const Z = (s: Mm): Mm => trace.nosingZ(s);

  const findings: Finding[] = [];
  const specs: PlateSpec[] = [];
  const notes: Message[] = [msg("structure.woodCentral.note.plate")];

  /** Constats communs : chevilles hors de l'emprise de la poutre, flèche de l'âme, broches. */
  const commonIssues = (
    mark: string,
    webMark: string,
    sag: Mm,
    pins: readonly EmbeddedPin[],
    dist: (p: EmbeddedPin) => PinDistances,
  ): Issue[] => {
    const issues: Issue[] = [];
    const half = W / 2 - hE;
    const need = b / 2 + an.anchorHoleDiameter / 2;
    if (an.anchors > 0 && half < need - EPS) {
      issues.push({
        measured: half,
        min: need,
        message: msg("structure.woodCentral.check.plate.anchorsUnderBeam", {
          mark,
          distance: dec(half, 0),
          half: dec(b / 2, 0),
        }),
      });
    }
    // Trait de scie dans le bois : flèche de l'âme plane + demi-trait ≤ b/2 − a4,c.
    const reach = sag + kerfWidth / 2;
    const allowed = b / 2 - ec5.a4c;
    if (reach > allowed + EPS) {
      issues.push({
        measured: reach,
        max: allowed,
        message: msg("structure.woodCentral.check.plate.webCurved", {
          web: webMark,
          sag: dec(sag, 1),
          edge: dec(b / 2 - reach, 1),
          a4c: dec(ec5.a4c, 0),
        }),
      });
    }
    if (pins.length < P.pins) {
      issues.push({
        measured: pins.length,
        min: P.pins,
        message: msg("structure.woodCentral.check.plate.pinsMissing", {
          web: webMark,
          placed: pins.length,
          wanted: P.pins,
          a1: dec(ec5.a1, 0),
        }),
      });
    }
    let end = Infinity;
    let edge = Infinity;
    for (const p of pins) {
      const d = dist(p);
      end = Math.min(end, d.end);
      edge = Math.min(edge, d.top, d.under);
    }
    if (end < ec5.a3t - PINCH_TOL) {
      issues.push({
        measured: end,
        min: ec5.a3t,
        message: msg("structure.woodCentral.check.plate.pinEnd", {
          web: webMark,
          distance: dec(end, 0),
          a3t: dec(ec5.a3t, 0),
        }),
      });
    }
    if (edge < ec5.a4t - PINCH_TOL) {
      issues.push({
        measured: edge,
        min: ec5.a4t,
        message: msg("structure.woodCentral.check.plate.pinEdge", {
          web: webMark,
          distance: dec(edge, 0),
          a4t: dec(ec5.a4t, 0),
        }),
      });
    }
    return issues;
  };

  /** Platine plus courte que deux pinces de perçage (non générée). */
  const tooShort = (mark: string, length: Mm): Issue => ({
    measured: length,
    min: minLength,
    message: msg("structure.woodCentral.check.plate.tooShort", {
      mark,
      length: dec(length, 0),
      min: dec(minLength, 0),
    }),
  });

  const record = (ok: Message, okMeasured: Mm, okMax: Mm, issues: readonly Issue[]): void => {
    if (issues.length === 0) {
      findings.push({ status: "ok", measured: okMeasured, max: okMax, location: loc, message: ok });
      return;
    }
    const first = issues[0]!;
    findings.push({
      status: "violation",
      measured: first.measured,
      min: first.min ?? null,
      max: first.max ?? null,
      location: loc,
      message: joinIssues(issues.map((i) => i.message)),
    });
  };

  /**
   * Âme plus profonde que le bois disponible (`webDepth` est une profondeur maximale, comme la
   * hauteur des joues du sabot) : ramenée au bois disponible, avec une remarque ; constat en
   * violation si elle ne laisse plus deux pinces de perçage (platine non générée). Une âme
   * réduite qui ne tient plus ses broches aux pinces de l'EC5 est signalée par leurs constats.
   */
  const limitDepth = (
    webMark: string,
    mark: string,
    room: Mm,
    depth: Mm,
    issues: Issue[],
  ): void => {
    if (!(P.webDepth + c > room + EPS)) {
      // Âme saisie trop peu profonde pour ses deux pinces de perçage : platine non générée.
      if (depth < minLength) {
        issues.push({
          measured: depth,
          min: minLength,
          message: msg("structure.woodCentral.check.plate.webTooShallow", {
            web: webMark,
            mark,
            depth: dec(depth, 0),
            min: dec(minLength, 0),
          }),
        });
      }
      return;
    }
    if (depth >= minLength) {
      notes.push(
        msg("structure.woodCentral.note.plateWebReduced", {
          web: webMark,
          wanted: dec(P.webDepth, 0),
          room: dec(room, 0),
          depth: dec(depth, 0),
        }),
      );
      return;
    }
    issues.push({
      measured: P.webDepth + c,
      max: room,
      message: msg("structure.woodCentral.check.plate.webMissing", {
        web: webMark,
        mark,
        room: dec(room, 0),
      }),
    });
  };

  // ---------------------------------------------------------------- Pied
  if (an.foot) {
    const mark = WOOD_CENTRAL_PLATE_FOOT_MARK;
    const webMark = WOOD_CENTRAL_PLATE_FOOT_WEB_MARK;
    const cut = beam.floorCutLength;
    const L = Math.min(an.length, cut);
    const issues: Issue[] = [];
    if (an.length > cut + EPS) {
      issues.push({
        measured: an.length,
        max: cut,
        message:
          L >= minLength
            ? msg("structure.woodCentral.check.plate.footReduced", {
                mark,
                wanted: dec(an.length, 0),
                cut: dec(cut, 0),
                length: dec(L, 0),
              })
            : msg("structure.woodCentral.check.plate.footMissing", { mark, cut: dec(cut, 0) }),
      });
    } else if (L < minLength) {
      issues.push(tooShort(mark, L));
    }
    // Âme dans le bois : sous le dessous de la première marche moins la joue minimale.
    const room = beam.firstSeatZ - profile.wood.minCheek - tp;
    const depth = Math.min(P.webDepth, room - c);
    if (L >= minLength) limitDepth(webMark, mark, room, depth, issues);
    if (L >= minLength && depth >= minLength) {
      const at = beam.frontSigma + L / 2;
      const Lw = Math.min(P.webLength, L);
      const ws0 = at - Lw / 2;
      const ws1 = at + Lw / 2;
      // Sous-face au-delà de la coupe au sol : parallèle à la ligne des nez (développé).
      const x1 = beam.frontSigma + beam.floorCutLength;
      const under = (s: Mm): Mm => tp + Z(s) - Z(x1);
      const dist = (p: EmbeddedPin): PinDistances => ({
        end: p.z - tp,
        top: beam.firstSeatZ - p.z,
        under: distanceToCurve(
          V.vec(p.sigma, p.z),
          Math.max(x1, p.sigma - UNDER_REACH),
          Math.max(x1, p.sigma) + UNDER_REACH,
          under,
        ),
      });
      // Hauteur de la rangée : pince d'extrémité au-dessus de la coupe au sol (a3,t), pince de
      // rive sous la première marche (a4,t), pinces de perçage de l'âme.
      const webLo = tp + Math.min(hE, depth / 2);
      const webHi = tp + depth - Math.min(hE, depth / 2);
      const zLo = Math.max(webLo, tp + ec5.a3t);
      const zHi = Math.min(webHi, beam.firstSeatZ - ec5.a4t);
      const z = zLo <= zHi ? (zLo + zHi) / 2 : Math.min(webHi, Math.max(webLo, (zLo + zHi) / 2));
      // Rangée le long de la trace, dans l'âme, à la pince de rive de la sous-face (a4,t).
      const xLo = ws0 + Math.min(hE, Lw / 2);
      let xHi = ws1 - Math.min(hE, Lw / 2);
      const okAt = (s: Mm): boolean => dist({ sigma: s, z }).under >= ec5.a4t;
      if (okAt(xLo)) {
        while (xHi > xLo && !okAt(xHi)) xHi = Math.max(xLo, xHi - SCAN_STEP);
      }
      const count = fitting(xLo, xHi, ec5.a1, P.pins);
      const pins = evenly(xLo, xHi, count).map((sigma) => ({ sigma, z }));
      const line = embeddedWebLine(trace, ws0, ws1);
      issues.push(...commonIssues(mark, webMark, line.sag, pins, dist));
      specs.push({
        foot: true,
        id: WOOD_CENTRAL_PLATE_FOOT_ID,
        mark,
        webId: WOOD_CENTRAL_PLATE_FOOT_WEB_ID,
        webMark,
        length: L,
        webLength: Lw,
        webDepth: depth,
        at,
        webStart: ws0,
        line,
        pins,
        // Trait de scie borné à la coupe au sol (âme aussi longue que la platine : trait
        // débouchant sur la face avant de la poutre).
        kerf: {
          mark: webMark,
          sigma0: Math.max(ws0 - c, beam.frontSigma),
          sigma1: Math.min(ws1 + c, x1),
          z0: tp,
          z1: tp + depth + c,
          width: kerfWidth,
        },
      });
    }
    record(
      msg("structure.woodCentral.check.plate.footOk", {
        mark,
        web: webMark,
        length: dec(L, 0),
        cut: dec(cut, 0),
      }),
      an.length,
      cut,
      issues,
    );
  }

  // ---------------------------------------------------------------- Tête
  if (an.head) {
    const mark = WOOD_CENTRAL_PLATE_HEAD_MARK;
    const webMark = WOOD_CENTRAL_PLATE_HEAD_WEB_MARK;
    const height = Math.max(0, beam.headTop - beam.headBottom);
    const H = Math.min(an.length, height);
    const issues: Issue[] = [];
    if (an.length > height + EPS) {
      issues.push({
        measured: an.length,
        max: height,
        message:
          H >= minLength
            ? msg("structure.woodCentral.check.plate.headReduced", {
                mark,
                wanted: dec(an.length, 0),
                height: dec(height, 0),
                length: dec(H, 0),
              })
            : msg("structure.woodCentral.check.plate.headMissing", {
                mark,
                height: dec(height, 0),
              }),
      });
    } else if (H < minLength) {
      issues.push(tooShort(mark, H));
    }
    // Coupe d'aplomb de la poutre (contrat : épaisseur de la platine et jeu devant le chevêtre).
    const sH = beam.trimmerSigma - tp - c;
    const Hw = Math.min(P.webLength, H);
    const wz0 = beam.headBottom + (H - Hw) / 2;
    // Bois disponible le long de la trace : le trait de scie, bande horizontale [wz0 ; wz0 + Hw]
    // (jeu compris), reste sous le dessus de la poutre (assises, dessus fini `topAt`) ; il ne
    // remonte pas sous l'assise précédente, plus basse.
    // Âme aussi haute que la coupe de tête : trait débouchant au dessus et au dessous de la
    // poutre, borné à la coupe.
    const kerfTop = Math.min(wz0 + Hw + c, beam.headTop);
    const kerfBottom = Math.max(wz0 - c, beam.headBottom);
    const topAt = beam.topAt ?? ((): Mm => beam.headTop);
    let sWood = sH;
    while (sWood > beam.frontSigma && topAt(sWood - SCAN_STEP) >= kerfTop - EPS) {
      sWood -= SCAN_STEP;
    }
    const room = sH - Math.max(beam.frontSigma, sWood);
    const depth = Math.min(P.webDepth, room - c);
    if (H >= minLength) limitDepth(webMark, mark, room, depth, issues);
    if (H >= minLength && depth >= minLength) {
      const at = beam.trimmerSigma;
      const wa = beam.trimmerSigma - tp - depth;
      const wb = beam.trimmerSigma - tp;
      // Sous-face en deçà de la coupe de tête : parallèle à la ligne des nez (développé).
      const under = (s: Mm): Mm => beam.headBottom + Z(s) - Z(sH);
      const dist = (p: EmbeddedPin): PinDistances => ({
        end: sH - p.sigma,
        top: topAt(p.sigma) - p.z,
        under: distanceToCurve(
          V.vec(p.sigma, p.z),
          Math.min(sH, p.sigma) - UNDER_REACH,
          Math.min(sH, p.sigma + UNDER_REACH),
          under,
        ),
      });
      // Colonne verticale : pince d'extrémité depuis la coupe d'aplomb (a3,t), pinces de l'âme.
      const sLo = wa + Math.min(hE, depth / 2);
      const sWebHi = wb - Math.min(hE, depth / 2);
      const sHi = Math.min(sWebHi, sH - ec5.a3t);
      const sigma = sLo <= sHi ? (sLo + sHi) / 2 : sLo;
      // Rives : sous-face (a4,t, recherchée) et dessus à la coupe de tête (a4,t).
      const zWebLo = wz0 + Math.min(hE, Hw / 2);
      const zWebHi = wz0 + Hw - Math.min(hE, Hw / 2);
      const zTop = Math.min(zWebHi, topAt(sigma) - ec5.a4t);
      const zHi = zTop >= zWebLo ? zTop : zWebHi;
      let zLo = zWebLo;
      const okAt = (z: Mm): boolean => dist({ sigma, z }).under >= ec5.a4t;
      while (zLo < zHi && !okAt(zLo)) zLo = Math.min(zHi, zLo + SCAN_STEP);
      const count = fitting(zLo, zHi, ec5.a1, P.pins);
      const pins = evenly(zLo, zHi, count).map((z) => ({ sigma, z }));
      const line = embeddedWebLine(trace, wa, wb);
      issues.push(...commonIssues(mark, webMark, line.sag, pins, dist));
      specs.push({
        foot: false,
        id: WOOD_CENTRAL_PLATE_HEAD_ID,
        mark,
        webId: WOOD_CENTRAL_PLATE_HEAD_WEB_ID,
        webMark,
        length: H,
        webLength: Hw,
        webDepth: depth,
        at,
        webStart: wz0,
        line,
        pins,
        kerf: {
          mark: webMark,
          sigma0: wa - c,
          sigma1: sH,
          z0: kerfBottom,
          z1: kerfTop,
          width: kerfWidth,
        },
      });
    }
    record(
      msg("structure.woodCentral.check.plate.headOk", {
        mark,
        web: webMark,
        length: dec(H, 0),
        height: dec(height, 0),
      }),
      an.length,
      height,
      issues,
    );
  }
  checks.add(rule, findings);
  if (specs.length === 0) return { ...EMPTY, notes: notes.slice(1) };

  const parts: Part[] = [];
  const beamHoles: ShoeBeamHole[] = [];
  const assemblies: PartAssembly[] = [];
  for (const s of specs) {
    const built = plateParts(input, s, W);
    parts.push(built.plate, built.web);
    beamHoles.push(
      ...s.pins.map((p) => ({ mark: s.webMark, sigma: p.sigma, z: p.z, diameter: P.pinDiameter })),
    );
    assemblies.push(
      { a: { partId: s.id }, b: { partId: s.webId } },
      { a: { partId: s.webId }, b: { partId: beam.beamId } },
    );
  }
  checks.addItems(
    pluginRuleDef(STEEL_RULES.laser),
    parts.map((p) => ({ value: p.flat!.thickness, label: textMessage(p.mark), partId: p.id })),
    msg("structure.steel.quantity.cutThickness"),
    { min: null, max: profile.metal.laser.maxThickness },
  );
  return {
    parts,
    beamHoles,
    beamKerfs: specs.map((s) => s.kerf),
    assemblies,
    welded: true,
    notes,
    errors: [],
  };
}

/** Platine et âme d'un côté : développés, solides, quantités, fixations. */
function plateParts(
  input: WoodCentralShoesInput,
  s: PlateSpec,
  W: Mm,
): { readonly plate: Part; readonly web: Part } {
  const { params, trace, profile, beam } = input;
  const an = params.anchors;
  const P = an.plate;
  const tp = P.thickness;
  const tw = P.webThickness;
  const hE = an.holeEdgeDistance;
  const material = steelMaterial(an.finish);

  // Platine : chevilles en deux rangées, de part et d'autre de la poutre, à la pince du bord.
  // Pied : x le long de la trace, y en travers (y = 0 à droite de la montée). Tête : x en
  // travers (x = 0 à droite), y vertical depuis le dessous de la poutre.
  const nLeft = Math.ceil(an.anchors / 2);
  const nRight = an.anchors - nLeft;
  const holes: Vec2[][] = [];
  const lines: FlatPattern["lines"][number][] = [];
  const webLabel = msg("structure.woodCentral.flatLine.plateWeb", { mark: s.webMark });
  const L = s.length;
  const outer: Vec2[] = s.foot
    ? [V.vec(0, 0), V.vec(L, 0), V.vec(L, W), V.vec(0, W)]
    : [V.vec(0, 0), V.vec(W, 0), V.vec(W, L), V.vec(0, L)];
  const along = (u: Mm, across: Mm): Vec2 => (s.foot ? V.vec(u, across) : V.vec(across, u));
  for (const u of spread(L, hE, nLeft))
    holes.push(holePolygon(along(u, W - hE), an.anchorHoleDiameter));
  for (const u of spread(L, hE, nRight))
    holes.push(holePolygon(along(u, hE), an.anchorHoleDiameter));
  // Tracé de l'âme : son plan est décalé de `lateral` (vers la gauche) de l'axe de la platine
  // pour centrer sa flèche dans une poutre cintrée (`embeddedWebLine`), nul sur une droite.
  const u0 = s.foot ? s.webStart - (s.at - L / 2) : s.webStart - beam.headBottom;
  const lateral = V.dot(trace.left(s.at), V.sub(s.line.center, trace.point(s.at)));
  [W / 2 + lateral - tw / 2, W / 2 + lateral + tw / 2].forEach((across, i) => {
    lines.push({
      kind: "mark",
      a: along(u0, across),
      b: along(u0 + s.webLength, across),
      ...(i === 0 ? { label: webLabel } : {}),
    });
  });
  const corner = outer[2]!;
  lines.push({
    kind: "text",
    a: V.vec(corner.x / 4 - 20, corner.y / 4),
    b: V.vec(corner.x / 4 + 20, corner.y / 4),
    label: textMessage(s.mark),
  });
  const plateFlat: FlatPattern = {
    outline: { outer, holes },
    lines,
    thickness: tp,
    reference: {
      kind: "face",
      description: msg(
        s.foot
          ? "structure.woodCentral.reference.plateFoot"
          : "structure.woodCentral.reference.plateHead",
        { mark: s.mark, web: s.webMark, beam: beam.beamMark },
      ),
    },
  };

  // Âme : x le long de la trace (vers la montée), y vertical ; perçages des broches.
  const wx = s.foot ? s.webLength : s.webDepth;
  const wy = s.foot ? s.webDepth : s.webLength;
  const webX0 = s.foot ? s.webStart : beam.trimmerSigma - tp - s.webDepth;
  const webY0 = s.foot ? tp : s.webStart;
  const webHoles = s.pins.map((p) =>
    holePolygon(V.vec(p.sigma - webX0, p.z - webY0), P.pinHoleDiameter),
  );
  const webFlat: FlatPattern = {
    outline: { outer: [V.vec(0, 0), V.vec(wx, 0), V.vec(wx, wy), V.vec(0, wy)], holes: webHoles },
    lines: [
      {
        kind: "text",
        a: V.vec(wx / 2 - 20, wy * 0.85),
        b: V.vec(wx / 2 + 20, wy * 0.85),
        label: textMessage(s.webMark),
      },
    ],
    thickness: tw,
    reference: {
      kind: "face",
      description: msg("structure.woodCentral.reference.plateWeb", {
        mark: s.webMark,
        plate: s.mark,
        beam: beam.beamMark,
      }),
    },
  };

  // Solides : repère sur la trace (pied : tangente au milieu de la platine ; tête : au chevêtre).
  const T = trace.tangent(s.at);
  const left = trace.left(s.at);
  const o = trace.point(s.at);
  const plateSolid: Part["solid"] = s.foot
    ? {
        kind: "extrusion",
        frame: {
          origin: v3(V.addScaled(V.addScaled(o, T, -L / 2), left, -W / 2), 0),
          xAxis: h3(T),
          yAxis: h3(left),
          zAxis: UP,
        },
        profile: { outer, holes },
        depth: tp,
      }
    : {
        kind: "extrusion",
        frame: {
          origin: v3(V.addScaled(V.addScaled(o, T, -tp), left, -W / 2), beam.headBottom),
          xAxis: h3(left),
          yAxis: UP,
          zAxis: h3(T),
        },
        profile: { outer, holes },
        depth: tp,
      };
  // Âme : plan vertical sur la corde décalée (`embeddedWebLine`), extrudée de +tw/2 à −tw/2.
  const n = V.perpLeft(s.line.dir);
  const webSolid: Part["solid"] = {
    kind: "extrusion",
    frame: {
      origin: v3(V.addScaled(V.addScaled(s.line.center, s.line.dir, -wx / 2), n, tw / 2), webY0),
      xAxis: h3(s.line.dir),
      yAxis: UP,
      zAxis: h3(V.scale(n, -1)),
    },
    profile: webFlat.outline,
    depth: tw,
  };

  const plateMeas = plateMeasures(plateFlat.outline, tp);
  const plateBox = minAreaRect(outer);
  const webMeas = plateMeasures(webFlat.outline, tw);
  const plateFixings: PartFixing[] =
    an.anchors > 0
      ? [
          {
            joint: s.foot ? "plateFloor" : "plateTrimmer",
            points: an.anchors,
            holeDiameter: an.anchorHoleDiameter,
          },
        ]
      : [];
  // Broches : diamètre nominal lu sur le perçage de l'âme, longueur = largeur de la poutre.
  const webFixings: PartFixing[] =
    s.pins.length > 0
      ? [
          {
            joint: "embeddedPlatePinned",
            points: s.pins.length,
            holeDiameter: P.pinHoleDiameter,
            length: params.section.width,
            with: [beam.beamId],
          },
        ]
      : [];
  const plate: Part = {
    id: s.id,
    mark: s.mark,
    category: "fixing",
    name: msg(
      s.foot ? "structure.woodCentral.part.plateFoot" : "structure.woodCentral.part.plateHead",
    ),
    material,
    solid: plateSolid,
    flat: plateFlat,
    section: msg("structure.woodCentral.section.plate", { thickness: dec(tp, 0), grade: an.grade }),
    stock: { length: plateBox.length, width: plateBox.width, thickness: tp },
    quantities: steelQuantities(
      {
        volumeMm3: plateMeas.volumeMm3,
        treatedSurfaceMm2: plateMeas.treatedSurfaceMm2,
        length: plateBox.length,
        cuts: 1,
        laserCut: plateMeas.laserCut,
        holes: holes.length,
      },
      profile,
    ),
    assembledWith: [s.webId],
    ...(plateFixings.length > 0 ? { fixings: plateFixings } : {}),
  };
  const web: Part = {
    id: s.webId,
    mark: s.webMark,
    category: "fixing",
    name: msg(
      s.foot
        ? "structure.woodCentral.part.plateFootWeb"
        : "structure.woodCentral.part.plateHeadWeb",
    ),
    material,
    solid: webSolid,
    flat: webFlat,
    section: msg("structure.woodCentral.section.plate", { thickness: dec(tw, 0), grade: an.grade }),
    stock: { length: Math.max(wx, wy), width: Math.min(wx, wy), thickness: tw },
    quantities: steelQuantities(
      {
        volumeMm3: webMeas.volumeMm3,
        treatedSurfaceMm2: webMeas.treatedSurfaceMm2,
        length: Math.max(wx, wy),
        cuts: 1,
        laserCut: webMeas.laserCut,
        holes: webHoles.length,
        // Deux cordons d'angle le long de l'âme sur la platine.
        weld: 2 * s.webLength,
      },
      profile,
    ),
    assembledWith: [s.id, beam.beamId],
    ...(webFixings.length > 0 ? { fixings: webFixings } : {}),
  };
  return { plate, web };
}
