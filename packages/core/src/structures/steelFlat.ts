/**
 * Plugin `steel-flat` : limons acier en plat découpé laser (C §2.2), jalon 3b.
 *
 * - **Limons** : un limon de jour et un limon mural par volée, faces internes = bords de
 *   l'emmarchement utile (C_i, C_e) : limons **hors emprise utile** (CHALLENGE A3). Développé =
 *   bande (rectiligne en partie droite, C §2.2) bornée par les rives haute et basse à d_h / d_b
 *   verticaux de la ligne des nez (mêmes conventions que les limons bois, `development.ts`),
 *   coupes de niveau et d'aplomb au départ, coupe d'aplomb et de niveau à l'arrivée, coupe
 *   d'aplomb contre le poteau (ou contre la platine d'about), limon arrivant à l'angle mural
 *   prolongé de l'épaisseur du limon voisin, limon partant de l'angle arrêté contre lui
 *   (assemblage soudé d'angle, sans recouvrement) ; limons de départ posés sur leur platine de
 *   pied, limon d'arrivée arrêté contre sa platine de tête. Perçages / lumières des supports vissés, traçage de position des
 *   supports (gabarit de pose, C §2.3).
 * - **Tournants** : jour « poteau » → poteau d'angle en **tube carré** a × a × e_t ou **plein**
 *   (`flat` : plat épais / carré plein de section a × a, seule section pleine compatible avec
 *   le carré réservé par le tracé) ; les limons de jour s'arrêtent contre ses faces (soudés ou
 *   vissés sur platine). Jour à angle vif → **erreur explicite** (choisir un poteau), jour en
 *   arc → limon débillardé métal (jalon 5) : limons de jour non générés, limons muraux générés.
 * - **Supports de marche** (C §2.6, `supports.ts`) : cornières soudées ou vissées, ou plats
 *   soudés, sous chaque marche le long de chaque face porteuse (limon, poteau).
 * - **Marches** : bois (pièces de base, escalier mixte, C §2.4) ou **tôle pliée** Z / U
 *   (`folded.ts`) : développé en fibre neutre avec lignes de pli (angle, sens, r_int, repère),
 *   jeu latéral contre les limons, regroupement des pièces identiques.
 * - **Platines** : platine de pied (départ au sol), platine haute (arrivée, fixation au
 *   chevêtre), platine de pied de poteau ; développés 1:1 avec perçages.
 * - **Classe d'exécution EN 1090-2** déduite (C §2.1, SPEC §2.4) : S235 sans soudure bout à
 *   bout → EXC1 ; soudure bout à bout (aboutage soudé d'un limon plus long que les formats de
 *   tôle) ou S355 → EXC2.
 * - **Contrôles** : loi de pli, rayon mini (C-M-02), bord mini (C-M-03), presse plieuse
 *   (C-M-04), laser, format de tôle, longueur de barre (C-M-08), supports, marches portées,
 *   réception par le poteau.
 *
 * Toutes les cotes par défaut non sourcées sont des paramètres **à valider** (LEDGER §2).
 */
import {
  dec,
  errorMessage,
  msg,
  MessageError,
  textMessage,
  type Message,
  type MessageKey,
} from "@blondel/i18n";
import { z } from "zod";
import { signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { FlatPattern, NosingLine, Part, Tread } from "../model/derived.js";
import type { Mm, Polygon2, Vec2 } from "../model/primitives.js";
import type { StructureContext, StructureKind, StructureOutput } from "../model/plugins.js";
import { buildBasicParts } from "../parts/basic.js";
import type { Finding } from "../rules/types.js";
import {
  STEEL_GRADES,
  findBendLaw,
  minBendRadiusFactor,
  outsideSetback,
  resolveBend,
  type ResolvedBend,
  type SteelGrade,
} from "../workshop/metal.js";
import { resolveWorkshopProfile, type WorkshopProfile } from "../workshop/profile.js";
import {
  CheckCollector,
  FAB_RULES,
  flightsOnlyError,
  pluginRuleDef,
  type CheckItem,
} from "./checks.js";
import { commonAutoValue } from "./autoValue.js";
import {
  developStringer,
  flatTransform,
  nosingPitchLine,
  pitchAtU,
  toFlatPattern,
  type StringerDevelopment,
} from "./development.js";
import {
  developArrivalRiser,
  developFoldedTread,
  insetPlate,
  sectionPolygon,
  type ArrivalRiserResult,
  type FoldedTreadResult,
  type PlanLine,
} from "./folded.js";
import { PiecewiseLinear, clipHalfPlane, dedupe, minAreaRect } from "./geom.js";
import { readPlanExtrusion, verticalExtrusion } from "./housing.js";
import { newelFaces, stairGeometry, type NewelGeometry, type StairGeometry } from "./legs.js";
import { newelTopWithHandrail } from "./newel.js";
import {
  STEEL_RULES,
  assembledTo,
  deduceExecutionClass,
  executionClassReasons,
  QUANTITY_WELD_MM,
  groupIdenticalFlats,
  holePolygon,
  plateMeasures,
  steelMaterial,
  steelQuantities,
  IDENTICAL_TOLERANCE,
} from "./steelCommon.js";
import {
  boltCenters,
  effectiveFixing,
  supportDepth,
  supportInterval,
  supportAssemblies,
  supportPart,
  type SupportFace,
  type SupportPlacement,
  type SupportSpec,
} from "./supports.js";
import type { StringerFace } from "./woodHoused.js";

const mmInt = z.number().int();
const mmPos = mmInt.positive();
const mmNonNeg = mmInt.nonnegative();
const auto = <T extends z.ZodType>(s: T) => z.union([s, z.literal("auto")]).default("auto");

export const SteelFlatParamsSchema = z.object({
  /** Nuance d'acier (S355 ⇒ EXC2, C §2.1). */
  grade: z.enum(STEEL_GRADES).default("S235"),
  /** Finition (matériau `steel-*`). */
  finish: z.enum(["raw", "painted", "galvanized"]).default("painted"),
  /** Épaisseur des limons (C §2.2 : limons en tôle de 8 mm relevés [20], exemple à valider). */
  thickness: mmPos.default(8),
  /** Dépassement vertical de la rive haute au-dessus de la ligne des nez, d_h (à valider). */
  upperOffset: mmPos.default(50),
  /** Dépassement vertical de la rive basse, d_b ; `auto` : supports sur la joue avec marge. */
  lowerOffset: auto(mmPos),
  /** Longueur du limon en avant du nez de départ (à valider). */
  startExtension: mmNonNeg.default(50),
  /** Longueur du limon au-delà du nez d'arrivée (à valider). */
  endExtension: mmNonNeg.default(0),
  /** Aboutage d'un limon plus long que les formats de tôle : soudé bout à bout (EXC2) ou éclissé. */
  splice: z.enum(["welded", "bolted"]).default("welded"),
  newel: z
    .object({
      /** Tube carré a × a × e_t, ou section pleine a × a (`flat`). */
      section: z.enum(["tube", "flat"]).default("tube"),
      /** Épaisseur de paroi du tube (à valider). */
      tubeThickness: mmPos.default(4),
      /** Assemblage limon / poteau : soudé (cordons d'angle) ou vissé sur platine d'about. */
      joint: z.enum(["welded", "bolted"]).default("welded"),
      /** Boulons par assemblage vissé (à valider). */
      bolts: mmNonNeg.default(4),
      foot: z.enum(["floor", "hanging"]).default("floor"),
      bottomExtension: mmNonNeg.default(50),
      /**
       * Dépassement au-dessus du plus haut élément reçu (à valider). Le poteau monte aussi
       * au-dessus de la main courante d'un garde-corps qui le rejoint (`guards.posts.newelOverrun`).
       */
      topExtension: mmNonNeg.default(0),
    })
    .prefault({}),
  supports: z
    .object({
      kind: z.enum(["angle", "plate"]).default("angle"),
      fixing: z.enum(["welded", "bolted"]).default("welded"),
      /** Cornière à ailes égales (à valider). */
      angleLeg: mmPos.default(40),
      angleThickness: mmPos.default(4),
      /** Plat support (C §2.6 : consoles en tôle de 8 mm [20]). */
      plateWidth: mmPos.default(40),
      plateThickness: mmPos.default(8),
      bolts: mmNonNeg.default(2),
      /** Perçage (M10 : 11 mm, à valider) ; `slotLength` > diamètre : lumière oblongue. */
      holeDiameter: mmPos.default(11),
      slotLength: mmNonNeg.default(0),
      holeEdgeDistance: mmPos.default(20),
      /** Vis de fixation de la marche par support. */
      treadScrews: mmNonNeg.default(2),
      /** Marge entre le support et les ailes / contremarches voisines. */
      endMargin: mmNonNeg.default(10),
      /** Marge entre le bas du support et la rive basse du limon. */
      edgeMargin: mmNonNeg.default(10),
      /** Longueur d'appui minimale. */
      minLength: mmPos.default(50),
    })
    .prefault({}),
  plates: z
    .object({
      foot: z.boolean().default(true),
      head: z.boolean().default(true),
      thickness: mmPos.default(10),
      /** Largeur (en travers du limon) des platines de pied et de tête. */
      width: mmPos.default(120),
      /** Longueur de la platine de pied le long du limon. */
      length: mmPos.default(150),
      /** Débord de la platine de pied de poteau autour du poteau. */
      margin: mmNonNeg.default(40),
      holeDiameter: mmPos.default(13),
      holeEdgeDistance: mmPos.default(25),
    })
    .prefault({}),
  /** Marches : bois (pièces de base, mixte) ou tôle pliée. */
  treadKind: z.enum(["wood", "folded-steel"]).default("wood"),
  folded: z
    .object({
      profile: z.enum(["Z", "U"]).default("Z"),
      /** Épaisseur de tôle (C §2.6 : Z auto-porteuse 4 à 6 mm [62], exemple à valider). */
      thickness: mmPos.default(5),
      /** U : hauteurs extérieures de l'aile de nez et de l'aile arrière. */
      noseHeight: mmPos.default(40),
      rearHeight: mmPos.default(40),
      /** Z : longueur du retour depuis la ligne de nez. */
      returnLength: mmPos.default(40),
      /** Jeu latéral marche / limon (C §2.3 : ≈ 10 mm de chaque côté [58], confiance faible). */
      clearance: mmNonNeg.default(10),
      /**
       * Z : contremarche d'arrivée (sous le nez d'arrivée, qu'aucune pièce Z ne porte) en plat
       * plié en L fixé au chevêtre (décision A11), même tôle et même loi de pli que les marches,
       * retour de `returnLength` sous la dernière marche. Cotes non sourcées, **à valider**.
       */
      arrivalRiser: z
        .object({
          /** Arête haute sous le niveau du sol fini d'arrivée (mm). */
          topOffset: mmNonNeg.default(0),
          /** Perçages de fixation au chevêtre, à mi-hauteur de la contremarche. */
          fixings: mmNonNeg.default(3),
          /** Diamètre de perçage (M10 : 11 mm, comme les supports vissés). */
          holeDiameter: mmPos.default(11),
          /** Distance des perçages extrêmes aux bords latéraux. */
          holeEdgeDistance: mmPos.default(50),
        })
        .prefault({}),
    })
    .prefault({}),
});
export type SteelFlatParams = z.output<typeof SteelFlatParamsSchema>;

type Side = "inner" | "outer";

export interface SteelStringer {
  readonly face: StringerFace;
  readonly development: StringerDevelopment;
  readonly part: Part;
  readonly mirrored: boolean;
  readonly supports: readonly SupportPlacement[];
  /** Aboutages nécessaires (format de tôle). */
  readonly splices: number;
}

export interface FoldedTreadDetail {
  readonly number: number;
  readonly part: Part;
  readonly result: FoldedTreadResult;
}

export interface SteelFlatResult {
  readonly output: StructureOutput;
  readonly stringers: readonly SteelStringer[];
  readonly posts: readonly Part[];
  readonly supports: readonly { readonly placement: SupportPlacement; readonly part: Part }[];
  readonly plates: readonly Part[];
  readonly treads: readonly FoldedTreadDetail[];
  readonly lowerOffset: Readonly<Record<Side, Mm>>;
  readonly executionClass: "EXC1" | "EXC2";
  /** Groupes de marches en tôle pliée identiques (ids), tolérance 0,5 mm. */
  readonly treadGroups: readonly (readonly string[])[];
}

const ceil5 = (x: Mm): Mm => Math.ceil(x / 5 - 1e-9) * 5;
const sigmaOf = (k: NosingLine, side: Side): Mm => (side === "inner" ? k.sigmaInner : k.sigmaOuter);

/** Épaisseur de limon reçue par un poteau d'angle (contrôle `FAB_POTEAU_RECEPTION`). */
interface ReceivedCheck {
  readonly value: Mm;
  readonly label: Message;
  readonly partId: string;
  /** Repère du poteau récepteur. */
  readonly newelMark: string;
}

/** Libellé « M3 sur LI1 » (support d'une marche sur une face porteuse, limon reçu par un poteau). */
export function supportOn(mark: string, on: string): Message {
  return msg("structure.steel.check.supportOn", { mark, on });
}

/** Sens de la montée sur un développé vu depuis les marches. */
export function ascentDirection(mirrored: boolean): Message {
  return msg(
    mirrored
      ? "structure.common.flat.riseTowardsDecreasingX"
      : "structure.common.flat.riseTowardsIncreasingX",
  );
}

/** Constat de format de tôle d'un développé (« LE1 : développé 3200 × 300 mm … »). */
export function sheetFormatMessage(
  key: MessageKey,
  mark: string,
  box: { readonly length: Mm; readonly width: Mm },
): Message {
  return msg(key, { mark, length: dec(box.length, 0), width: dec(box.width, 0) });
}

/** Marche sans support d'un côté ou des deux (contrôle `FAB_MARCHE_PORTEE`). */
export function treadNotCarried(mark: string, missing: readonly Side[]): Message {
  const inner = missing.includes("inner");
  const outer = missing.includes("outer");
  return msg(
    inner && outer
      ? "structure.steel.check.treadNotCarried.both"
      : inner
        ? "structure.steel.check.treadNotCarried.well"
        : "structure.steel.check.treadNotCarried.wall",
    { mark },
  );
}

/** Désignation des supports de marche (« cornières soudés »). */
function supportsText(kind: SteelFlatParams["supports"]["kind"], fixing: string): Message {
  const welded = fixing === "welded";
  return kind === "angle"
    ? msg(
        welded ? "structure.steel.supports.weldedAngles" : "structure.steel.supports.boltedAngles",
      )
    : msg(welded ? "structure.steel.supports.weldedFlats" : "structure.steel.supports.boltedFlats");
}

/** Faces de référence des limons acier (mêmes règles que les limons bois, messages propres). */
export function steelStringerFaces(
  ctx: StructureContext,
  geo: StairGeometry,
): { faces: StringerFace[]; errors: Message[]; notes: Message[] } {
  const turns = ctx.project.stair.layout.turns;
  const faces: StringerFace[] = [];
  const errors: Message[] = [];
  const notes: Message[] = [];
  turns.forEach((t, j) => {
    const params = { turn: j + 1, flight: j + 1, nextFlight: j + 2 };
    if (t.inner.kind === "arc") {
      errors.push(msg("structure.steel.error.arcWell", params));
    } else if (t.inner.kind === "sharp") {
      errors.push(msg("structure.steel.error.sharpWell", params));
    }
  });
  const last = geo.legs.length - 1;
  for (const leg of geo.legs) {
    const i = leg.index;
    const before = i > 0 ? turns[i - 1]!.inner.kind : null;
    const after = i < last ? turns[i]!.inner.kind : null;
    const start = i === 0 ? "floor" : before === "newel" ? "newel" : null;
    const end = i === last ? "arrival" : after === "newel" ? "newel" : null;
    const len = leg.innerT1 - leg.innerT0;
    if (start && end) {
      if (len > 1) {
        faces.push({
          id: `stringer-inner-${i + 1}`,
          mark: `LI${i + 1}`,
          name: msg("structure.steel.part.outerString", { flight: i + 1 }),
          side: "inner",
          leg: i,
          a: V.addScaled(leg.innerOrigin, leg.u, leg.innerT0),
          dir: leg.u,
          into: V.scale(leg.n, -1),
          sigmaA: leg.innerSigma0,
          faceLength: len,
          start,
          end,
        });
      } else {
        notes.push(msg("structure.steel.note.noOuterString", { flight: i + 1 }));
      }
    }
    faces.push({
      id: `stringer-outer-${i + 1}`,
      mark: `LE${i + 1}`,
      name: msg("structure.steel.part.wallString", { flight: i + 1 }),
      side: "outer",
      leg: i,
      a: leg.outerStart,
      dir: leg.u,
      into: leg.n,
      sigmaA: leg.outerSigma0,
      faceLength: leg.length,
      start: i === 0 ? "floor" : "corner",
      end: i === last ? "arrival" : "corner",
    });
  }
  return { faces, errors, notes };
}

/**
 * Fenêtre [u_lo ; u_hi] d'un limon acier (u depuis `face.a`). À un angle mural, contrairement
 * au bois (assemblage à queues : les deux limons occupent le carré e × e du coin), deux plats
 * soudés ne peuvent pas se recouvrir : le limon **qui arrive** à l'angle est prolongé de
 * l'épaisseur e jusqu'à l'arête extérieure du coin, le limon **qui part** de l'angle s'arrête
 * contre lui (u_lo = 0) et porte la soudure d'angle.
 */
function windowOf(
  f: StringerFace,
  nosings: readonly NosingLine[],
  startExt: Mm,
  endExt: Mm,
  e: Mm,
): { uLo: Mm; uHi: Mm } {
  const u0 = sigmaOf(nosings[0]!, f.side) - f.sigmaA;
  const uN = sigmaOf(nosings[nosings.length - 1]!, f.side) - f.sigmaA;
  return {
    uLo: f.start === "floor" ? u0 - startExt : 0,
    uHi: f.end === "arrival" ? uN + endExt : f.end === "corner" ? f.faceLength + e : f.faceLength,
  };
}

function levelZones(f: StringerFace): { levelBefore?: Mm; levelAfter?: Mm } {
  return {
    ...(f.start === "corner" ? { levelBefore: 0 } : {}),
    ...(f.end === "corner" ? { levelAfter: f.faceLength } : {}),
  };
}

/** Altitude d'une polyligne (u croissants) en u (bornée aux extrémités). */
function polyAt(line: readonly Vec2[], u: Mm): Mm {
  if (line.length === 0) return Number.NaN;
  if (u <= line[0]!.x) return line[0]!.y;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    if (u <= b.x + 1e-9) {
      return b.x - a.x > 1e-9 ? a.y + ((b.y - a.y) * (u - a.x)) / (b.x - a.x) : Math.max(a.y, b.y);
    }
  }
  return line[line.length - 1]!.y;
}

/** Rectangle plein de développé (platines) avec perçages. */
export function rectFlat(
  length: Mm,
  width: Mm,
  thickness: Mm,
  holes: readonly Vec2[],
  holeDiameter: Mm,
  mark: string,
  description: Message,
): FlatPattern {
  return {
    outline: {
      outer: [V.vec(0, 0), V.vec(length, 0), V.vec(length, width), V.vec(0, width)],
      holes: holes.map((c) => holePolygon(c, holeDiameter)),
    },
    lines: [
      {
        kind: "text",
        a: V.vec(length / 2 - 20, width / 2),
        b: V.vec(length / 2 + 20, width / 2),
        label: textMessage(mark),
      },
    ],
    thickness,
    reference: { kind: "face", description },
  };
}

/** Perçages d'une platine L × W : deux rangées à `edge` des grands côtés, `perRow` par rangée. */
export function plateHoles(length: Mm, width: Mm, edge: Mm, perRow: number): Vec2[] {
  const xs =
    perRow <= 1
      ? [length / 2]
      : Array.from({ length: perRow }, (_, i) => edge + ((length - 2 * edge) * i) / (perRow - 1));
  return xs.flatMap((x) => [V.vec(x, edge), V.vec(x, width - edge)]);
}

/** Marque les pièces identiques d'une liste : `${prefix}${rang du groupe}`. */
export function markGroups(parts: Part[], prefix: string, key: (p: Part) => string | null): Part[] {
  const groups: string[][] = [];
  const flatGroups = groupIdenticalFlats(parts.filter((p) => p.flat));
  for (const g of flatGroups) groups.push(g);
  const rest = parts.filter((p) => !p.flat);
  const byKey = new Map<string, string[]>();
  for (const p of rest) {
    const k = key(p) ?? p.id;
    const list = byKey.get(k) ?? [];
    list.push(p.id);
    byKey.set(k, list);
  }
  groups.push(...byKey.values());
  const markOf = new Map<string, string>();
  groups.forEach((g, i) => g.forEach((id) => markOf.set(id, `${prefix}${i + 1}`)));
  return parts.map((p) => {
    const mark = markOf.get(p.id) ?? p.mark;
    const flat = p.flat
      ? {
          ...p.flat,
          lines: p.flat.lines.map((l) =>
            l.kind === "text" ? { ...l, label: textMessage(mark) } : l,
          ),
        }
      : undefined;
    return { ...p, mark, ...(flat ? { flat } : {}) };
  });
}

interface TreadZone {
  readonly tread: Tread;
  readonly mark: string;
  /** Zone d'appui possible (marges retirées), en plan. */
  readonly zone: Polygon2;
  /** Dessous de la marche. */
  readonly zUnder: Mm;
  /** Bande de recherche devant les faces (jeu latéral + 1 mm). */
  readonly band: Mm;
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

/** Construction complète (détails compris). */
export function buildSteelFlat(ctx: StructureContext, params: SteelFlatParams): SteelFlatResult {
  const { project, layout, stepping } = ctx;
  const profile = resolveWorkshopProfile(project.workshop);
  const metal = profile.metal;
  const nosings = stepping.nosings;
  const notes: Message[] = [];
  const errors: Message[] = [];
  const e = params.thickness;
  const grade: SteelGrade = params.grade;
  const material = steelMaterial(params.finish);
  const sup = params.supports;
  const folded = params.treadKind === "folded-steel";
  const empty = (errs: Message[]): SteelFlatResult => ({
    output: { parts: [], checks: [], notes, errors: errs },
    stringers: [],
    posts: [],
    supports: [],
    plates: [],
    treads: [],
    lowerOffset: { inner: Number.NaN, outer: Number.NaN },
    executionClass: "EXC1",
    treadGroups: [],
  });
  const helical = flightsOnlyError("steel-flat", msg("structure.steelFlat.shortLabel"), layout);
  if (helical) return empty([helical]);
  if (nosings.length < 2) return empty([msg("structure.steelFlat.error.emptyStepping")]);

  const geo = stairGeometry(project, layout);
  const faceInfo = steelStringerFaces(ctx, geo);
  errors.push(...faceInfo.errors);
  notes.push(...faceInfo.notes);
  const faces = faceInfo.faces;
  const baseParts = ctx.baseParts ?? buildBasicParts(project, layout, stepping).parts;
  const baseById = new Map(baseParts.map((p) => [p.id, p]));
  const checks = new CheckCollector(project, stepping);

  // 1. Loi de pli (marches en tôle pliée).
  const ft = params.folded;
  const bendLaw = folded ? resolveFoldedBend(ft.thickness, metal, grade, checks) : null;
  const bend: ResolvedBend | null = bendLaw?.bend ?? null;
  errors.push(...(bendLaw?.errors ?? []));

  // 2. Marches : dessus (tôle pliée) ou pièces de base (bois), zones d'appui.
  const { treadDetails, zones, foldedErrors } = flatTreadZones(
    project,
    stepping,
    params,
    baseById,
    folded ? bend : null,
    material,
    profile,
  );
  if (foldedErrors.length > 0) {
    errors.push(
      ...foldedErrors.map((detail) =>
        msg("structure.steelFlat.error.foldedTreadNotDeveloped", { detail }),
      ),
    );
  }

  // 2 bis. Profil Z : contremarche d'arrivée en plat plié en L fixé au chevêtre (décision A11),
  // à la place de la contremarche bois de base de même identifiant.
  const arrivalRes = arrivalRiserPart(
    stepping,
    params,
    baseById,
    folded ? bend : null,
    material,
    profile,
  );
  const arrival = arrivalRes.arrival;
  if (arrivalRes.error !== undefined) errors.push(arrivalRes.error);

  // 3. Faces porteuses : joues des limons (portée de la face) et faces des poteaux.
  const pitch: Record<Side, PiecewiseLinear> = {
    inner: nosingPitchLine(nosings, stepping.treads, "inner"),
    outer: nosingPitchLine(nosings, stepping.treads, "outer"),
  };
  // Platines d'about (poteau, assemblage vissé) et de tête (arrivée) : le limon est raccourci de
  // leur épaisseur (la platine s'intercale entre le bout du limon et la face d'appui).
  const endPlateT = params.newel.joint === "bolted" ? params.plates.thickness : 0;
  const headPlateT = params.plates.head ? params.plates.thickness : 0;
  const { windows, supportFaces, newelList } = flatSupportFaces(
    faces,
    geo,
    nosings,
    params,
    endPlateT,
    headPlateT,
  );
  // 4. Supports.
  const { placements, shortSupports, carried } = placeSupports(zones, supportFaces, sup);
  const depthSup = supportDepth(sup);

  // 5. d_b automatique : chaque support sur la joue, à `edgeMargin` de la rive basse.
  const lowerOffset = autoLowerOffset(placements, faces, pitch, depthSup, params);

  // 6. Limons.
  const stringers: SteelStringer[] = [];
  let buttWeldTotal = 0;
  const formatFindings: Finding[] = [];
  const sc: FlatStringerContext = {
    params,
    nosings,
    metal,
    profile,
    material,
    grade,
    pitch,
    windows,
    lowerOffset,
    placements,
    depthSup,
    endPlateT,
  };
  for (const f of faces) {
    const built = buildFlatStringer(sc, f);
    formatFindings.push(built.formatFinding);
    buttWeldTotal += built.buttWeld;
    stringers.push(built.stringer);
  }

  // 7. Poteaux.
  const newelOut = flatNewelPosts(
    ctx,
    newelList,
    stringers,
    placements,
    depthSup,
    params,
    material,
    profile,
  );
  const posts = newelOut.posts;
  const plates: Part[] = [...newelOut.plates];
  const receivedChecks = newelOut.received;
  notes.push(...newelOut.notes);

  // 8. Platines de pied et de tête des limons.
  plates.push(...stringerPlates(stringers, params, material, profile));

  // 9. Pièces supports (marques par groupe de pièces identiques).
  const supportParts = markGroups(
    placements.map((p) => supportPart(p, sup, "S", material, profile)),
    sup.kind === "angle" ? "CR" : "PS",
    (p) =>
      `${JSON.stringify(p.section)}|${Math.round((p.stock?.length ?? 0) / IDENTICAL_TOLERANCE)}|${p.quantities["holes"]}`,
  );
  const platesMarked = [
    ...markGroups(
      plates.filter((p) => p.id.startsWith("plate-foot-")),
      "PF",
      () => null,
    ),
    ...markGroups(
      plates.filter((p) => p.id.startsWith("plate-head-")),
      "PH",
      () => null,
    ),
    ...markGroups(
      plates.filter((p) => p.id.startsWith("plate-post-")),
      "PP",
      () => null,
    ),
    ...markGroups(
      plates.filter((p) => p.id.startsWith("plate-end-")),
      "PA",
      () => null,
    ),
  ];
  const treadParts = treadDetails.map((d) => d.part);
  const treadGroups = groupIdenticalFlats(treadParts);
  /** Tôles pliées : marches et contremarche d'arrivée (contrôles de pliage, laser, format). */
  const foldedParts = arrival ? [...treadParts, arrival.part] : treadParts;
  const foldedChecks = [
    ...treadDetails.map((d) => ({
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
  ];

  // 10. Classe d'exécution : S355 « soudé » seulement si une pièce porte un cordon (angle ou
  // bout à bout) ; supports vissés sans cordon ⇒ PC1 (C §2.1).
  const weldTotal = [
    ...foldedParts,
    ...stringers.map((s) => s.part),
    ...posts,
    ...supportParts,
    ...platesMarked,
  ].reduce((acc, p) => acc + (p.quantities[QUANTITY_WELD_MM] ?? 0), 0);
  const exc = deduceExecutionClass({
    grade,
    buttWeld: buttWeldTotal,
    welded: weldTotal + buttWeldTotal > 1e-9,
  });

  // 11. Contrôles.
  addFlatChecks(checks, {
    exc,
    grade,
    bend: folded ? bend : null,
    metal,
    foldedChecks,
    stringers,
    foldedParts,
    platesMarked,
    formatFindings,
    supportParts,
    posts,
    depthSup,
    shortSupports,
    sup,
    zones,
    carried,
    receivedChecks,
    newelList,
  });

  // 12. Remarques.
  notes.push(
    msg("structure.steelFlat.note.summary", {
      thickness: dec(e, 0),
      grade,
      upperOffset: dec(params.upperOffset, 0),
      lowerOffsetInner: dec(lowerOffset.inner, 0),
      lowerOffsetOuter: dec(lowerOffset.outer, 0),
      supports: supportsText(sup.kind, effectiveFixing(sup)),
    }),
    msg("structure.steel.exc.note", {
      executionClass: exc.executionClass,
      reasons: executionClassReasons(exc, grade),
    }),
  );
  if (folded && treadParts.length > 0) {
    notes.push(
      msg("structure.steelFlat.note.foldedTreads", {
        profile: ft.profile,
        parts: msg("structure.steelFlat.count.parts", { count: treadParts.length }),
        unique: msg("structure.steelFlat.count.uniqueParts", { count: treadGroups.length }),
        tolerance: dec(IDENTICAL_TOLERANCE, 1),
      }),
    );
    notes.push(msg("structure.steelFlat.note.foldedSolids"));
  }
  // Profil Z : la pièce de la marche t porte la contremarche sous son propre nez (nez t − 1,
  // contremarche de base `riser-t`) ; ces contremarches sont retirées. La contremarche
  // d'arrivée (sous le dernier nez), qu'aucune pièce Z ne porte, est remplacée (même
  // identifiant) par un plat plié en L fixé au chevêtre (décision A11) ; à défaut (développé
  // impossible), la pièce de base reste : sans elle, le dessus de la dernière pièce ne bute
  // contre rien et le vide sous le nez d'arrivée n'est pas fermé. Profil U (claire-voie) :
  // toutes les contremarches sont retirées.
  const foldedRisers = new Set(treadDetails.map((d) => `riser-${d.number}`));
  const removedBaseParts =
    folded && bend && project.stair.treads.risers === "full"
      ? baseParts
          .filter((p) => /^riser-\d+$/.test(p.id) && (ft.profile !== "Z" || foldedRisers.has(p.id)))
          .map((p) => p.id)
      : [];
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

  const supports = placements.map((placement, i) => ({ placement, part: supportParts[i]! }));
  const autoValues = params.lowerOffset === "auto" ? flatAutoValues(lowerOffset, faces) : undefined;
  return {
    output: {
      parts: [
        ...foldedParts,
        ...stringers.map((s) => s.part),
        ...posts,
        ...supportParts,
        ...platesMarked,
      ],
      checks: checks.results,
      executionClass: exc.executionClass,
      notes,
      ...(errors.length > 0 ? { errors } : {}),
      ...(removedBaseParts.length > 0 ? { removedBaseParts } : {}),
      ...(autoValues ? { autoValues } : {}),
      ...(supports.length > 0 ? { assemblies: supportAssemblies(supports) } : {}),
    },
    stringers,
    posts,
    supports,
    plates: platesMarked,
    treads: treadDetails,
    lowerOffset,
    executionClass: exc.executionClass,
    treadGroups,
  };
}

// ------------------------------------------------------------------ étapes de buildSteelFlat

/** Étape 1 : loi de pli des marches en tôle pliée (profil d'atelier), contrôle `FAB_LOI_PLI`. */
function resolveFoldedBend(
  thickness: Mm,
  metal: WorkshopProfile["metal"],
  grade: SteelGrade,
  checks: CheckCollector,
): { bend: ResolvedBend | null; errors: Message[] } {
  const errors: Message[] = [];
  let bend: ResolvedBend | null = null;
  const law = findBendLaw(metal, grade, thickness);
  if (!law) {
    errors.push(
      msg("structure.steelFlat.error.noBendLaw", { grade, thickness: dec(thickness, 1) }),
    );
    checks.add(pluginRuleDef(STEEL_RULES.bendLaw), [
      {
        status: "violation",
        measured: thickness,
        message: msg("structure.steelFlat.check.noBendLaw", {
          grade,
          thickness: dec(thickness, 1),
        }),
      },
    ]);
  } else {
    try {
      bend = resolveBend(law, metal.defaultK);
      checks.add(pluginRuleDef(STEEL_RULES.bendLaw), [
        {
          status: "ok",
          measured: thickness,
          message: msg("structure.steelFlat.check.bendLaw", {
            grade,
            thickness: dec(thickness, 1),
            radius: dec(bend.innerRadius, 1),
            method: bend.method,
            k: dec(bend.k, 3),
          }),
        },
      ]);
    } catch (err) {
      errors.push(msg("structure.steelFlat.error.bendLaw", { detail: errorMessage(err) }));
    }
  }
  return { bend, errors };
}

/**
 * Étape 2 : marches en tôle pliée développées (dessus, développé, repère) ou pièces de base
 * (bois), et leurs zones d'appui ; erreurs de développement (pièce de base conservée).
 */
function flatTreadZones(
  project: StructureContext["project"],
  stepping: StructureContext["stepping"],
  params: SteelFlatParams,
  baseById: ReadonlyMap<string, Part>,
  bend: ResolvedBend | null,
  material: Part["material"],
  profile: WorkshopProfile,
): { treadDetails: FoldedTreadDetail[]; zones: TreadZone[]; foldedErrors: Message[] } {
  const nosings = stepping.nosings;
  const folded = params.treadKind === "folded-steel";
  const ft = params.folded;
  const sup = params.supports;
  const treadDetails: FoldedTreadDetail[] = [];
  const zones: TreadZone[] = [];
  const foldedErrors: Message[] = [];
  for (const tread of stepping.treads) {
    const a = nosings[tread.number - 1];
    const b = nosings[tread.number];
    const base = baseById.get(`tread-${tread.number}`);
    if (!a || !b || !base) continue;
    const upA = upOf(a, tread.walkingSurface, 1);
    const upB = upOf(b, tread.walkingSurface, -1);
    if (folded && bend) {
      const t = bend.thickness;
      const r = bend.innerRadius;
      const plate = insetPlate(tread.walkingSurface, [lineOf(a), lineOf(b)], ft.clearance);
      if (!plate) {
        foldedErrors.push(msg("structure.steelFlat.error.degenerateTop", { mark: base.mark }));
      } else {
        const prevZ = tread.number >= 2 ? nosings[tread.number - 2]!.z : null;
        const riserDrop = prevZ === null ? tread.z - t : tread.z - (prevZ - t);
        try {
          const res = developFoldedTread({
            profile: ft.profile,
            plate,
            front: lineOf(a),
            rear: lineOf(b),
            bend,
            riserDrop,
            returnLength: ft.returnLength,
            noseHeight: ft.noseHeight,
            rearHeight: ft.rearHeight,
            mark: base.mark,
          });
          const setback = outsideSetback(Math.PI / 2, r, t);
          const solid = res.prismatic
            ? (() => {
                const m0 = V.addScaled(
                  V.addScaled(res.frontOrigin, res.frontAxis, res.s0),
                  res.inward,
                  -setback,
                );
                return {
                  kind: "extrusion" as const,
                  frame: {
                    origin: { x: m0.x, y: m0.y, z: tread.z },
                    xAxis: { x: res.inward.x, y: res.inward.y, z: 0 },
                    yAxis: { x: 0, y: 0, z: 1 },
                    zAxis: { x: res.frontAxis.x, y: res.frontAxis.y, z: 0 },
                  },
                  profile: { outer: sectionPolygon(res.section), holes: [] },
                  depth: res.s1 - res.s0,
                };
              })()
            : verticalExtrusion(plate, tread.z - t, t);
          const meas = plateMeasures(res.flat.outline, t);
          const box = minAreaRect(res.flat.outline.outer);
          const part: Part = {
            id: base.id,
            mark: base.mark,
            category: base.category,
            name: msg("structure.steelFlat.part.foldedTread", {
              name: base.name,
              profile: ft.profile,
            }),
            material,
            solid,
            flat: res.flat,
            section: msg("structure.steel.section.foldedPlate", {
              thickness: dec(t, 0),
              profile: ft.profile,
            }),
            stock: { length: box.length, width: box.width, thickness: t },
            quantities: steelQuantities(
              {
                volumeMm3: meas.volumeMm3,
                treatedSurfaceMm2: meas.treatedSurfaceMm2,
                length: box.length,
                cuts: 1,
                laserCut: meas.laserCut,
                bends: res.bendLines.length,
                bendLength: res.bendLines.reduce((s, l) => s + l.length, 0),
              },
              profile,
            ),
          };
          treadDetails.push({ number: tread.number, part, result: res });
          const m = sup.endMargin;
          const front = t + r + m;
          const rearLimit = ft.profile === "Z" ? -(ft.returnLength + m) : -(t + r + m);
          let zone: Polygon2 = clipHalfPlane(plate, V.addScaled(a.p, upA, front), upA);
          zone = clipHalfPlane(zone, V.addScaled(b.p, upB, rearLimit), V.scale(upB, -1));
          zones.push({
            tread,
            mark: base.mark,
            zone: dedupe(zone),
            zUnder: tread.z - t,
            band: ft.clearance + 1,
          });
          continue;
        } catch (err) {
          foldedErrors.push(errorMessage(err));
        }
      }
    }
    // Marche bois (mixte), ou repli sur la pièce de base.
    const ex = readPlanExtrusion(base.solid);
    if (!ex) continue;
    const spec = project.stair.treads;
    const m = sup.endMargin;
    const front = spec.nosing + (spec.risers === "full" ? spec.riserThickness : 0) + m;
    let zone: Polygon2 = clipHalfPlane(ex.outline, V.addScaled(a.p, upA, front), upA);
    zone = clipHalfPlane(zone, V.addScaled(b.p, upB, spec.nosing - m), V.scale(upB, -1));
    zones.push({ tread, mark: base.mark, zone: dedupe(zone), zUnder: ex.zBottom, band: 1 });
  }
  return { treadDetails, zones, foldedErrors };
}

/**
 * Étape 2 bis : contremarche d'arrivée en plat plié en L fixé au chevêtre (profil Z, décision
 * A11), à la place de la contremarche bois de base de même identifiant.
 */
function arrivalRiserPart(
  stepping: StructureContext["stepping"],
  params: SteelFlatParams,
  baseById: ReadonlyMap<string, Part>,
  bend: ResolvedBend | null,
  material: Part["material"],
  profile: WorkshopProfile,
): {
  arrival: { readonly part: Part; readonly result: ArrivalRiserResult } | null;
  error?: Message;
} {
  const nosings = stepping.nosings;
  const folded = params.treadKind === "folded-steel";
  const ft = params.folded;
  let error: Message | undefined;
  let arrival: { readonly part: Part; readonly result: ArrivalRiserResult } | null = null;
  const arrivalBase = baseById.get(`riser-${nosings.length}`);
  const lastTread = stepping.treads.find((tr) => tr.number === nosings.length - 1);
  if (folded && bend && ft.profile === "Z" && arrivalBase && lastTread) {
    const a = nosings[nosings.length - 2]!;
    const b = nosings[nosings.length - 1]!;
    const t = bend.thickness;
    const ar = ft.arrivalRiser;
    try {
      const plate = insetPlate(lastTread.walkingSurface, [lineOf(a), lineOf(b)], ft.clearance);
      // Étendue : arête du dessus de la dernière marche portée par la ligne du nez d'arrivée.
      const dir = V.normalize(b.dir);
      const onB = (plate ?? []).filter((p) => Math.abs(V.cross(dir, V.sub(p, b.p))) <= 1e-3);
      if (onB.length < 2)
        throw new MessageError(
          msg("structure.steelFlat.error.arrivalNosingNotFound", { mark: arrivalBase.mark }),
        );
      const ss = onB.map((p) => V.dot(V.sub(p, b.p), dir));
      const zTop = b.z - ar.topOffset;
      const result = developArrivalRiser({
        start: V.addScaled(b.p, dir, Math.min(...ss)),
        end: V.addScaled(b.p, dir, Math.max(...ss)),
        up: upOf(b, lastTread.walkingSurface, -1),
        zTop,
        riserDrop: zTop - (a.z - t),
        returnLength: ft.returnLength,
        bend,
        holes: ar.fixings,
        holeDiameter: ar.holeDiameter,
        holeEdgeDistance: ar.holeEdgeDistance,
        mark: arrivalBase.mark,
      });
      const meas = plateMeasures(result.flat.outline, t);
      const box = minAreaRect(result.flat.outline.outer);
      arrival = {
        result,
        part: {
          id: arrivalBase.id,
          mark: arrivalBase.mark,
          category: "riser",
          name: msg("structure.steelFlat.part.arrivalRiser"),
          material,
          solid: {
            kind: "extrusion",
            frame: result.frame,
            profile: { outer: sectionPolygon(result.section), holes: [] },
            depth: result.length,
          },
          flat: result.flat,
          section: msg("structure.steel.section.foldedPlate", {
            thickness: dec(t, 0),
            profile: "L",
          }),
          stock: { length: box.length, width: box.width, thickness: t },
          quantities: steelQuantities(
            {
              volumeMm3: meas.volumeMm3,
              treatedSurfaceMm2: meas.treatedSurfaceMm2,
              length: box.length,
              cuts: 1,
              laserCut: meas.laserCut,
              bends: 1,
              bendLength: result.length,
              holes: result.holeCenters.length,
            },
            profile,
          ),
        },
      };
    } catch (err) {
      error = msg("structure.steelFlat.error.arrivalRiserNotDeveloped", {
        detail: errorMessage(err),
      });
    }
  }
  return error === undefined ? { arrival } : { arrival, error };
}

/** Coupe basse d'un limon partant du sol : dessus de la platine de pied (0 sans platine). */
function floorLevel(f: StringerFace, params: SteelFlatParams): Mm {
  return f.start === "floor" && params.plates.foot ? params.plates.thickness : 0;
}

/**
 * Étape 3 : fenêtres des limons (raccourcis des platines d'about et de tête) et faces porteuses
 * des supports (joues des limons, faces des poteaux d'angle).
 */
function flatSupportFaces(
  faces: readonly StringerFace[],
  geo: ReturnType<typeof stairGeometry>,
  nosings: readonly NosingLine[],
  params: SteelFlatParams,
  endPlateT: Mm,
  headPlateT: Mm,
): {
  windows: Map<string, { uLo: Mm; uHi: Mm }>;
  supportFaces: SupportFace[];
  newelList: { geom: NewelGeometry; id: string; mark: string }[];
} {
  const e = params.thickness;
  const windows = new Map(
    faces.map((f) => {
      const w = windowOf(f, nosings, params.startExtension, params.endExtension, e);
      return [
        f.id,
        {
          uLo: w.uLo + (f.start === "newel" ? endPlateT : 0),
          uHi: w.uHi - (f.end === "newel" ? endPlateT : f.end === "arrival" ? headPlateT : 0),
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
      uMin: f.start === "corner" ? Math.max(w.uLo, 0) : w.uLo,
      uMax: f.end === "corner" ? Math.min(w.uHi, f.faceLength) : w.uHi,
    };
  });
  const newelList = geo.newels.map((nw) => ({
    geom: nw,
    id: `post-${nw.turn + 1}`,
    mark: `PT${nw.turn + 1}`,
  }));
  for (const nw of newelList) {
    newelFaces(nw.geom, nw.id).forEach((rf, i) => {
      const len = V.distance(rf.a, rf.b);
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
        uMax: len,
      });
    });
  }
  return { windows, supportFaces, newelList };
}

/** Étape 4 : supports (marche × face porteuse) d'au moins `minLength`, côtés portés. */
function placeSupports(
  zones: readonly TreadZone[],
  supportFaces: readonly SupportFace[],
  sup: SteelFlatParams["supports"],
): {
  placements: SupportPlacement[];
  shortSupports: CheckItem[];
  carried: Map<number, Set<Side>>;
} {
  const placements: SupportPlacement[] = [];
  const shortSupports: CheckItem[] = [];
  const carried = new Map<number, Set<Side>>();
  for (const z of zones) {
    for (const face of supportFaces) {
      const iv = supportInterval(z.zone, face, z.band);
      if (!iv) continue;
      const len = iv.u1 - iv.u0;
      const label = supportOn(z.mark, face.ownerMark);
      shortSupports.push({ value: len, label, partId: face.owner, treadNumber: z.tread.number });
      if (len < sup.minLength) continue;
      placements.push({
        tread: z.tread.number,
        treadMark: z.mark,
        face,
        u0: iv.u0,
        u1: iv.u1,
        zTop: z.zUnder,
      });
      const set = carried.get(z.tread.number) ?? new Set<Side>();
      set.add(face.side);
      carried.set(z.tread.number, set);
    }
  }
  return { placements, shortSupports, carried };
}

/**
 * Valeur retenue de `lowerOffset` laissé en `auto` (`StructureOutput.autoValues`) : d_b est
 * résolu par limon (jour, mur) ; la valeur n'est exposée que si tous les limons générés ont la
 * même (`commonAutoValue`).
 */
function flatAutoValues(
  lowerOffset: Record<Side, Mm>,
  faces: readonly StringerFace[],
): Record<string, number> | undefined {
  const value = commonAutoValue(
    [...new Set(faces.map((f) => f.side))].map((side) => lowerOffset[side]),
  );
  return value === undefined ? undefined : { lowerOffset: value };
}

/** Étape 5 : d_b automatique, chaque support sur la joue à `edgeMargin` de la rive basse. */
function autoLowerOffset(
  placements: readonly SupportPlacement[],
  faces: readonly StringerFace[],
  pitch: Record<Side, PiecewiseLinear>,
  depthSup: Mm,
  params: SteelFlatParams,
): Record<Side, Mm> {
  const sup = params.supports;
  const need: Record<Side, Mm> = { inner: 0, outer: 0 };
  const faceById = new Map(faces.map((f) => [f.id, f]));
  for (const p of placements) {
    const f = faceById.get(p.face.owner);
    if (!f || p.face.kind !== "stringer") continue;
    const input = { pitch: pitch[f.side], sigmaA: f.sigmaA, ...levelZones(f) };
    const us = [
      p.u0,
      p.u1,
      ...pitch[f.side].knotsBetween(f.sigmaA + p.u0, f.sigmaA + p.u1).map((s) => s - f.sigmaA),
    ];
    for (const u of us) {
      const needed = pitchAtU(input, u) - (p.zTop - depthSup - sup.edgeMargin);
      need[f.side] = Math.max(need[f.side], needed);
    }
  }
  const lowerOffset: Record<Side, Mm> = {
    inner:
      params.lowerOffset === "auto"
        ? ceil5(Math.max(need.inner, params.upperOffset))
        : params.lowerOffset,
    outer:
      params.lowerOffset === "auto"
        ? ceil5(Math.max(need.outer, params.upperOffset))
        : params.lowerOffset,
  };
  return lowerOffset;
}

/** Étape 11 : contrôles de fabrication de `steel-flat` (ordre des résultats conservé). */
function addFlatChecks(
  checks: CheckCollector,
  input: {
    readonly exc: ReturnType<typeof deduceExecutionClass>;
    readonly grade: SteelGrade;
    /** Loi de pli des marches en tôle pliée (`null` : marches bois ou loi absente). */
    readonly bend: ResolvedBend | null;
    readonly metal: WorkshopProfile["metal"];
    readonly foldedChecks: readonly {
      readonly part: Part;
      readonly flanges: FoldedTreadResult["flanges"];
      readonly bendLines: FoldedTreadResult["bendLines"];
    }[];
    readonly stringers: readonly SteelStringer[];
    readonly foldedParts: readonly Part[];
    readonly platesMarked: readonly Part[];
    /** Constats de format des limons, complétés ici par ceux des tôles pliées et platines. */
    readonly formatFindings: Finding[];
    readonly supportParts: readonly Part[];
    readonly posts: readonly Part[];
    readonly depthSup: Mm;
    readonly shortSupports: CheckItem[];
    readonly sup: SteelFlatParams["supports"];
    readonly zones: readonly TreadZone[];
    readonly carried: ReadonlyMap<number, Set<Side>>;
    readonly receivedChecks: readonly ReceivedCheck[];
    readonly newelList: readonly { geom: NewelGeometry; id: string; mark: string }[];
  },
): void {
  const { exc, grade, bend, metal, foldedChecks, stringers, foldedParts, platesMarked } = input;
  const { formatFindings, supportParts, posts, depthSup, shortSupports, sup, zones } = input;
  const { carried, receivedChecks, newelList } = input;
  const rule = (spec: (typeof STEEL_RULES)[keyof typeof STEEL_RULES]) => pluginRuleDef(spec);
  checks.add(rule(STEEL_RULES.executionClass), [
    {
      status: "ok",
      message: msg("structure.steel.exc.check", {
        executionClass: exc.executionClass,
        reasons: executionClassReasons(exc, grade),
      }),
    },
  ]);
  if (bend) {
    const factor = minBendRadiusFactor(grade);
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
      { min: factor * bend.thickness - 1e-9, max: null },
    );
    checks.addItems(
      rule(STEEL_RULES.bendFlange),
      foldedChecks.flatMap((d) =>
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
      [
        ...foldedChecks.flatMap((d) =>
          d.bendLines.map((l) => ({
            value: l.length,
            label: textMessage(`${d.part.mark}, ${l.mark}`),
            partId: d.part.id,
          })),
        ),
      ],
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
  const laserParts = [...stringers.map((s) => s.part), ...foldedParts, ...platesMarked];
  checks.addItems(
    rule(STEEL_RULES.laser),
    laserParts.map((p) => ({
      value: p.flat!.thickness,
      label: textMessage(p.mark),
      partId: p.id,
    })),
    msg("structure.steel.quantity.cutThickness"),
    { min: null, max: metal.laser.maxThickness },
  );
  for (const p of [...foldedParts, ...platesMarked]) {
    const box = minAreaRect(p.flat!.outline.outer);
    formatFindings.push(
      fitsSheet(metal, box.length, box.width)
        ? {
            status: "ok",
            measured: box.length,
            location: { kind: "part", partId: p.id },
            message: sheetFormatMessage("structure.steel.check.inSheetFormat", p.mark, box),
          }
        : {
            status: "violation",
            measured: box.length,
            location: { kind: "part", partId: p.id },
            message: sheetFormatMessage("structure.steel.check.outOfSheetFormats", p.mark, box),
          },
    );
  }
  if (formatFindings.length > 0) checks.add(rule(STEEL_RULES.sheetFormat), formatFindings);
  const bars = [...supportParts, ...posts];
  checks.addItems(
    rule(STEEL_RULES.barLength),
    bars.map((p) => ({ value: p.stock!.length, label: textMessage(p.mark), partId: p.id })),
    msg("structure.steel.quantity.barLength"),
    { min: null, max: Math.max(...metal.barLengths) },
  );
  checks.addItems(
    rule(STEEL_RULES.supportInStringer),
    stringers.flatMap((s) =>
      s.supports.map((p) => {
        const zb = p.zTop - depthSup;
        const margin = Math.min(
          zb - polyAt(s.development.lowerRive, p.u0),
          zb - polyAt(s.development.lowerRive, p.u1),
          polyAt(s.development.upperRive, p.u0) - p.zTop,
        );
        return {
          value: margin,
          label: supportOn(p.treadMark, s.face.mark),
          partId: s.part.id,
          treadNumber: p.tread,
        };
      }),
    ),
    msg("structure.steel.quantity.supportEdgeMargin"),
    { min: -1e-6, max: null },
  );
  checks.addItems(
    rule(STEEL_RULES.supportLength),
    shortSupports,
    msg("structure.steel.quantity.bearingLength"),
    { min: sup.minLength, max: null },
  );
  checks.add(
    rule(STEEL_RULES.treadCarried),
    zones.map((z): Finding => {
      const set = carried.get(z.tread.number) ?? new Set<Side>();
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
  if (receivedChecks.length > 0) {
    for (const nw of newelList) {
      checks.addItems(
        pluginRuleDef(FAB_RULES.newelReception),
        receivedChecks.filter((r) => r.newelMark === nw.mark),
        msg("structure.steel.quantity.receivedStringThickness"),
        { min: null, max: nw.geom.jourExtent },
      );
    }
  }
}

/** Données communes à la construction des limons en plat (étape 6). */
interface FlatStringerContext {
  readonly params: SteelFlatParams;
  readonly nosings: readonly NosingLine[];
  readonly metal: WorkshopProfile["metal"];
  readonly profile: WorkshopProfile;
  readonly material: Part["material"];
  readonly grade: SteelGrade;
  readonly pitch: Record<Side, PiecewiseLinear>;
  readonly windows: ReadonlyMap<string, { uLo: Mm; uHi: Mm }>;
  readonly lowerOffset: Record<Side, Mm>;
  readonly placements: readonly SupportPlacement[];
  readonly depthSup: Mm;
  readonly endPlateT: Mm;
}

/** Le développé L × l tient-il dans un format de tôle du profil d'atelier (dans un sens) ? */
function fitsSheet(metal: WorkshopProfile["metal"], length: Mm, width: Mm): boolean {
  return metal.sheetFormats.some(
    (f) =>
      (length <= f.length + 1e-6 && width <= f.width + 1e-6) ||
      (length <= f.width + 1e-6 && width <= f.length + 1e-6),
  );
}

/**
 * Étape 6 : un limon en plat (développé, perçages et traçage des supports, format de tôle et
 * aboutages, soudures, solide extrudé).
 */
function buildFlatStringer(
  sc: FlatStringerContext,
  f: StringerFace,
): { stringer: SteelStringer; formatFinding: Finding; buttWeld: Mm } {
  const { params, nosings, metal, profile, material, grade, pitch, windows, lowerOffset } = sc;
  const { placements, depthSup, endPlateT } = sc;
  const e = params.thickness;
  const sup = params.supports;
  const floorLevelOf = (face: StringerFace): Mm => floorLevel(face, params);
  const { uLo, uHi } = windows.get(f.id)!;
  const dev = developStringer({
    pitch: pitch[f.side],
    sigmaA: f.sigmaA,
    uLo,
    uHi,
    start: f.start,
    end: f.end,
    upperOffset: params.upperOffset,
    lowerOffset: lowerOffset[f.side],
    ...levelZones(f),
    ...(f.end === "arrival" ? { topCut: nosings[nosings.length - 1]!.z + params.upperOffset } : {}),
    floorLevel: floorLevelOf(f),
    housings: [],
  });
  const mirrored = V.dot(V.perpRight(f.into), f.dir) < 0;
  const span = {
    lo: f.start === "corner" ? Math.max(uLo, 0) : uLo,
    hi: f.end === "corner" ? Math.min(uHi, f.faceLength) : uHi,
  };
  const noses = nosings
    .map((k) => ({ u: sigmaOf(k, f.side) - f.sigmaA, z: k.z, index: k.index }))
    .filter((k) => k.u >= span.lo - 1e-6 && k.u <= span.hi + 1e-6);
  const joints: { u: Mm; label: Message }[] = [];
  const cornerJoint = msg("structure.steel.joint.wallCorner");
  if (f.start === "corner") joints.push({ u: 0, label: cornerJoint });
  if (f.end === "corner") joints.push({ u: f.faceLength, label: cornerJoint });
  const newelJoint = msg(
    endPlateT > 0 ? "structure.steel.joint.newelEndPlate" : "structure.common.joint.newelFace",
  );
  if (f.start === "newel") joints.push({ u: uLo, label: newelJoint });
  if (f.end === "newel") joints.push({ u: uHi, label: newelJoint });
  const base = toFlatPattern(dev, {
    mirrored,
    thickness: e,
    depth: 0,
    mark: f.mark,
    referenceDescription: msg(
      f.side === "inner"
        ? "structure.steel.reference.outerStringFace"
        : "structure.steel.reference.wallStringFace",
      { ascent: ascentDirection(mirrored) },
    ),
    noses,
    joints,
  });
  const T = flatTransform(dev, mirrored);
  const mine = placements.filter((p) => p.face.kind === "stringer" && p.face.owner === f.id);
  const holes: Vec2[][] = [];
  const extra: FlatPattern["lines"][number][] = [];
  for (const p of mine) {
    for (const c of boltCenters(p, sup)) {
      const ring = holePolygon(T(c), sup.holeDiameter, sup.slotLength, V.vec(1, 0));
      holes.push(signedArea(ring) > 0 ? ring.reverse() : ring);
    }
    const zb = p.zTop - depthSup;
    const rect = [V.vec(p.u0, zb), V.vec(p.u1, zb), V.vec(p.u1, p.zTop), V.vec(p.u0, p.zTop)].map(
      T,
    );
    rect.forEach((a, i) => {
      extra.push({
        kind: "mark",
        a,
        b: rect[(i + 1) % 4]!,
        ...(i === 0
          ? { label: msg("structure.steel.flatLine.support", { mark: p.treadMark }) }
          : {}),
      });
    });
  }
  const flat: FlatPattern = {
    ...base,
    outline: { outer: base.outline.outer, holes },
    lines: [...base.lines, ...extra],
  };
  const meas = plateMeasures(flat.outline, e);
  const box = dev.box;
  // Aboutages (format de tôle).
  let splices = 0;
  let formatFinding: Finding;
  if (!fitsSheet(metal, box.length, box.width)) {
    const maxLen = Math.max(
      0,
      ...metal.sheetFormats.filter((s) => s.width >= box.width - 1e-6).map((s) => s.length),
    );
    splices = maxLen > 0 ? Math.ceil(box.length / maxLen) - 1 : Number.NaN;
    formatFinding = {
      status: "violation",
      measured: box.length,
      location: { kind: "part", partId: f.id },
      message: Number.isFinite(splices)
        ? msg(
            params.splice === "welded"
              ? "structure.steelFlat.check.weldedSplices"
              : "structure.steelFlat.check.boltedSplices",
            {
              mark: f.mark,
              length: dec(box.length, 0),
              width: dec(box.width, 0),
              count: splices,
            },
          )
        : msg("structure.steelFlat.check.widthOutOfSheetFormats", {
            mark: f.mark,
            width: dec(box.width, 0),
          }),
    };
  } else {
    formatFinding = {
      status: "ok",
      measured: box.length,
      location: { kind: "part", partId: f.id },
      message: sheetFormatMessage("structure.steel.check.inSheetFormat", f.mark, box),
    };
  }
  const buttWeld =
    params.splice === "welded" && Number.isFinite(splices)
      ? splices * dev.minPerpendicularWidth
      : 0;
  // Soudure d'angle mural : comptée sur le limon qui part de l'angle (deux cordons).
  const cornerWeld =
    f.start === "corner"
      ? 2 * Math.max(0, polyAt(dev.upperRive, 0) - Math.max(polyAt(dev.lowerRive, 0), 0))
      : 0;
  const xDir = mirrored ? V.scale(f.dir, -1) : f.dir;
  let uMin = Infinity;
  let uMax = -Infinity;
  for (const p of dev.outline) {
    uMin = Math.min(uMin, p.x);
    uMax = Math.max(uMax, p.x);
  }
  const originPlan = V.addScaled(f.a, f.dir, mirrored ? uMax : uMin);
  const part: Part = {
    id: f.id,
    mark: f.mark,
    category: "stringer",
    name: f.name,
    material,
    solid: {
      kind: "extrusion",
      frame: {
        origin: { x: originPlan.x, y: originPlan.y, z: 0 },
        xAxis: { x: xDir.x, y: xDir.y, z: 0 },
        yAxis: { x: 0, y: 0, z: 1 },
        zAxis: { x: f.into.x, y: f.into.y, z: 0 },
      },
      profile: flat.outline,
      depth: e,
    },
    flat,
    section: msg("structure.steel.section.stringPlate", {
      thickness: dec(e, 0),
      grade,
      width: dec(Math.ceil(box.width), 0),
    }),
    stock: { length: box.length, width: box.width, thickness: e },
    quantities: steelQuantities(
      {
        volumeMm3: meas.volumeMm3,
        treatedSurfaceMm2: meas.treatedSurfaceMm2,
        length: box.length,
        weld: buttWeld + cornerWeld,
        buttWeld,
        cuts: 1,
        laserCut: meas.laserCut,
        holes: holes.length,
      },
      profile,
    ),
  };
  return {
    stringer: { face: f, development: dev, part, mirrored, supports: mine, splices },
    formatFinding,
    buttWeld,
  };
}

/** Étape 7 : poteaux d'angle (tube ou plein), platines d'about et de pied des poteaux. */
function flatNewelPosts(
  ctx: StructureContext,
  newelList: readonly { geom: NewelGeometry; id: string; mark: string }[],
  stringers: readonly SteelStringer[],
  placements: readonly SupportPlacement[],
  depthSup: Mm,
  params: SteelFlatParams,
  material: Part["material"],
  profile: WorkshopProfile,
): {
  posts: Part[];
  plates: Part[];
  received: ReceivedCheck[];
  notes: Message[];
} {
  const e = params.thickness;
  const sup = params.supports;
  const notes: Message[] = [];
  const posts: Part[] = [];
  const plates: Part[] = [];
  const receivedChecks: ReceivedCheck[] = [];
  for (const nw of newelList) {
    const g: NewelGeometry = nw.geom;
    const a = g.size;
    const received = stringers.filter(
      (s) =>
        s.face.side === "inner" &&
        ((s.face.end === "newel" && s.face.leg === g.turn) ||
          (s.face.start === "newel" && s.face.leg === g.turn + 1)),
    );
    const onPost = placements.filter((p) => p.face.owner === nw.id);
    let top = -Infinity;
    let bottom = Infinity;
    const endHeights: Mm[] = [];
    for (const s of received) {
      const atEnd = s.face.end === "newel" && s.face.leg === g.turn;
      const idx = atEnd ? s.development.upperRive.length - 1 : 0;
      const up = s.development.upperRive[idx]!.y;
      const lo = s.development.lowerRive[atEnd ? s.development.lowerRive.length - 1 : 0]!.y;
      top = Math.max(top, up);
      bottom = Math.min(bottom, lo);
      endHeights.push(up - Math.max(lo, 0));
      receivedChecks.push({
        value: e,
        label: supportOn(s.face.mark, nw.mark),
        partId: s.face.id,
        newelMark: nw.mark,
      });
    }
    for (const p of onPost) {
      top = Math.max(top, p.zTop);
      bottom = Math.min(bottom, p.zTop - depthSup);
    }
    if (!Number.isFinite(top)) {
      notes.push(msg("structure.steel.note.newelNothingReceived", { mark: nw.mark }));
      continue;
    }
    top += params.newel.topExtension;
    const raised = newelTopWithHandrail(top, ctx, g.turn);
    if (raised.raisedBy > 0) {
      top = raised.top;
      notes.push(
        msg("structure.steel.note.newelRaised", {
          mark: nw.mark,
          top: dec(top, 0),
          overrun: dec(raised.overrun, 0),
        }),
      );
    }
    // Pied au sol : le poteau repose sur sa platine de pied (raccourci de son épaisseur).
    const foot =
      params.newel.foot === "floor"
        ? params.plates.foot
          ? params.plates.thickness
          : 0
        : Math.max(0, bottom - params.newel.bottomExtension);
    const height = top - foot;
    const h = a / 2;
    const at = (x: number, y: number): Vec2 =>
      V.add(V.add(g.center, V.scale(g.n, x)), V.scale(g.u, y));
    const sq = (d: Mm): Vec2[] => {
      const pts = [at(-d, -d), at(d, -d), at(d, d), at(-d, d)];
      return signedArea(pts) > 0 ? pts : pts.reverse();
    };
    const tube = params.newel.section === "tube";
    const tt = params.newel.tubeThickness;
    const outer = sq(h);
    const inner = tube ? sq(h - tt).reverse() : null;
    const o = outer[0]!;
    const rel = (p: Vec2): Vec2 => V.sub(p, o);
    const areaS = tube ? a * a - (a - 2 * tt) * (a - 2 * tt) : a * a;
    const bolted = params.newel.joint === "bolted";
    const jointWeld = bolted ? 0 : endHeights.reduce((s, x) => s + 2 * x, 0);
    const postHoles =
      (bolted ? params.newel.bolts * received.length : 0) +
      onPost.reduce((s, p) => s + boltCenters(p, sup).length, 0);
    const post: Part = {
      id: nw.id,
      mark: nw.mark,
      category: "post",
      name: msg("structure.steel.part.newel", { turn: g.turn + 1 }),
      material,
      solid: {
        kind: "extrusion",
        frame: {
          origin: { x: o.x, y: o.y, z: foot },
          xAxis: { x: 1, y: 0, z: 0 },
          yAxis: { x: 0, y: 1, z: 0 },
          zAxis: { x: 0, y: 0, z: 1 },
        },
        profile: { outer: outer.map(rel), holes: inner ? [inner.map(rel)] : [] },
        depth: height,
      },
      section: tube
        ? msg("structure.steel.section.squareTube", { size: dec(a, 0), thickness: dec(tt, 0) })
        : msg("structure.steel.section.solidSquare", { size: dec(a, 0) }),
      stock: { length: height, width: a, thickness: a },
      quantities: steelQuantities(
        {
          volumeMm3: areaS * height,
          treatedSurfaceMm2: 4 * a * height + 2 * areaS,
          length: height,
          weld: jointWeld,
          cuts: 2,
          holes: postHoles,
        },
        profile,
      ),
    };
    posts.push(
      assembledTo(
        post,
        received.map((s) => s.face.id),
      ),
    );
    // Platines d'about (assemblage vissé) : une par limon reçu.
    if (bolted) {
      received.forEach((s, i) => {
        const hgt = endHeights[i]!;
        const pl = params.plates;
        const holesAt = plateHoles(
          hgt,
          a,
          Math.min(pl.holeEdgeDistance, a / 4),
          Math.max(1, Math.ceil(params.newel.bolts / 2)),
        );
        const flat = rectFlat(
          hgt,
          a,
          pl.thickness,
          holesAt,
          pl.holeDiameter,
          "PA",
          msg("structure.steel.reference.endPlate", { string: s.face.mark, newel: nw.mark }),
        );
        const atEnd = s.face.end === "newel" && s.face.leg === g.turn;
        const u = atEnd ? s.development.uHi : s.development.uLo;
        const zLo = Math.max(polyAt(s.development.lowerRive, u), 0);
        plates.push(
          assembledTo(
            plateObject(
              `plate-end-${s.face.id}`,
              msg("structure.steel.part.endPlate", { string: s.face.mark, newel: nw.mark }),
              flat,
              pl.thickness,
              2 * hgt,
              material,
              profile,
              endPlateFrame(s.face, u, zLo, a, e, pl.thickness, atEnd ? 1 : -1),
            ),
            [s.face.id, nw.id],
          ),
        );
      });
    }
    if (params.newel.foot === "floor" && params.plates.foot) {
      const pl = params.plates;
      const side = a + 2 * pl.margin;
      const holesAt = plateHoles(side, side, pl.holeEdgeDistance, 2);
      const flat = rectFlat(
        side,
        side,
        pl.thickness,
        holesAt,
        pl.holeDiameter,
        "PP",
        msg("structure.steel.reference.newelFootPlate", { mark: nw.mark }),
      );
      const corner = at(-side / 2, -side / 2);
      plates.push(
        assembledTo(
          plateObject(
            `plate-post-${g.turn + 1}`,
            msg("structure.steel.part.newelFootPlate", { mark: nw.mark }),
            flat,
            pl.thickness,
            4 * a,
            material,
            profile,
            {
              origin: { x: corner.x, y: corner.y, z: 0 },
              xAxis: { x: g.n.x, y: g.n.y, z: 0 },
              yAxis: { x: g.u.x, y: g.u.y, z: 0 },
              zAxis: { x: 0, y: 0, z: V.cross(g.n, g.u) > 0 ? 1 : -1 },
              depth: V.cross(g.n, g.u) > 0 ? pl.thickness : -pl.thickness,
            },
          ),
          [nw.id],
        ),
      );
    }
  }
  return { posts, plates, received: receivedChecks, notes };
}

/** Étape 8 : platines de pied (sol) et de tête (arrivée) des limons. */
function stringerPlates(
  stringers: readonly SteelStringer[],
  params: SteelFlatParams,
  material: Part["material"],
  profile: WorkshopProfile,
): Part[] {
  const e = params.thickness;
  const pl = params.plates;
  const plates: Part[] = [];
  const floorLevelOf = (face: StringerFace): Mm => floorLevel(face, params);
  for (const s of stringers) {
    const f = s.face;
    const dev = s.development;
    const across = (W: Mm): Vec2 => V.scale(f.into, -(W - e) / 2);
    if (f.start === "floor" && pl.foot) {
      const zFloor = floorLevelOf(f);
      const onFloor = dev.outline.filter((p) => Math.abs(p.y - zFloor) < 1e-6).map((p) => p.x);
      if (onFloor.length >= 2) {
        const mid = (Math.min(...onFloor) + Math.max(...onFloor)) / 2;
        const L = pl.length;
        const holesAt = plateHoles(L, pl.width, pl.holeEdgeDistance, 1);
        const flat = rectFlat(
          L,
          pl.width,
          pl.thickness,
          holesAt,
          pl.holeDiameter,
          "PF",
          msg("structure.steel.reference.footPlate", { mark: f.mark }),
        );
        const o = V.add(V.addScaled(f.a, f.dir, mid - L / 2), across(pl.width));
        const sgn = V.cross(f.dir, f.into) > 0 ? 1 : -1;
        plates.push(
          assembledTo(
            plateObject(
              `plate-foot-${f.id}`,
              msg("structure.steel.part.footPlate", { mark: f.mark }),
              flat,
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
            [f.id],
          ),
        );
      }
    }
    if (f.end === "arrival" && pl.head) {
      const zLo = Math.max(polyAt(dev.lowerRive, dev.uHi), 0);
      const zHi = polyAt(dev.upperRive, dev.uHi);
      const H = zHi - zLo;
      if (H > 1) {
        const holesAt = plateHoles(H, pl.width, pl.holeEdgeDistance, 1);
        const flat = rectFlat(
          H,
          pl.width,
          pl.thickness,
          holesAt,
          pl.holeDiameter,
          "PH",
          msg("structure.steel.reference.headPlate", { mark: f.mark }),
        );
        plates.push(
          assembledTo(
            plateObject(
              `plate-head-${f.id}`,
              msg("structure.steel.part.headPlate", { mark: f.mark }),
              flat,
              pl.thickness,
              2 * H,
              material,
              profile,
              endPlateFrame(f, dev.uHi, zLo, pl.width, e, pl.thickness, 1),
            ),
            [f.id],
          ),
        );
      }
    }
  }
  return plates;
}

/**
 * Repère d'une platine verticale perpendiculaire au limon en u (profil : x = altitude depuis
 * `zLo`, y = travers du limon, centrée sur son épaisseur), épaisse vers `toward`·dir.
 */
export function endPlateFrame(
  f: StringerFace,
  u: Mm,
  zLo: Mm,
  width: Mm,
  e: Mm,
  thickness: Mm,
  toward: 1 | -1,
): PlateFrame {
  const o = V.add(V.addScaled(f.a, f.dir, u), V.scale(f.into, -(width - e) / 2));
  // (0, 0, 1) × into = perpLeft(into) : repère direct.
  const zAxis = V.perpLeft(f.into);
  const sign = V.dot(zAxis, f.dir) * toward > 0 ? 1 : -1;
  return {
    origin: { x: o.x, y: o.y, z: zLo },
    xAxis: { x: 0, y: 0, z: 1 },
    yAxis: { x: f.into.x, y: f.into.y, z: 0 },
    zAxis: { x: zAxis.x, y: zAxis.y, z: 0 },
    depth: sign * thickness,
  };
}

export interface PlateFrame {
  readonly origin: { x: number; y: number; z: number };
  readonly xAxis: { x: number; y: number; z: number };
  readonly yAxis: { x: number; y: number; z: number };
  readonly zAxis: { x: number; y: number; z: number };
  readonly depth: Mm;
}

/** Platine découpée (développé rectangulaire percé), soudée sur `weld` mm. */
export function plateObject(
  id: string,
  name: Message,
  flat: FlatPattern,
  thickness: Mm,
  weld: Mm,
  material: Part["material"],
  profile: WorkshopProfile,
  place: PlateFrame | null,
): Part {
  const meas = plateMeasures(flat.outline, thickness);
  const box = minAreaRect(flat.outline.outer);
  const frame = place ?? {
    origin: { x: 0, y: 0, z: 0 },
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 1, z: 0 },
    zAxis: { x: 0, y: 0, z: 1 },
    depth: thickness,
  };
  return {
    id,
    mark: "PL",
    category: "fixing",
    name,
    material,
    solid: {
      kind: "extrusion",
      frame: { origin: frame.origin, xAxis: frame.xAxis, yAxis: frame.yAxis, zAxis: frame.zAxis },
      profile: flat.outline,
      depth: frame.depth,
    },
    flat,
    section: msg("structure.steel.section.plate", { thickness: dec(thickness, 0) }),
    stock: { length: box.length, width: box.width, thickness },
    quantities: steelQuantities(
      {
        volumeMm3: meas.volumeMm3,
        treatedSurfaceMm2: meas.treatedSurfaceMm2,
        length: box.length,
        weld,
        cuts: 1,
        laserCut: meas.laserCut,
        holes: flat.outline.holes.length,
      },
      profile,
    ),
  };
}

export const STEEL_FLAT: StructureKind<SteelFlatParams> = {
  kind: "steel-flat",
  labelKey: "structure.steelFlat.label",
  family: "metal",
  paramsSchema: SteelFlatParamsSchema,
  defaults: () => SteelFlatParamsSchema.parse({}),
  build: (ctx, params) => buildSteelFlat(ctx, params).output,
  capabilities: {
    // Limons de jour assemblés sur un poteau d'angle (jour vif refusé).
    requiresNewel: true,
    // Limons hors emprise utile, côté jour et côté mur (CHALLENGE A3).
    lateralThickness: (p) => ({ inner: p.thickness, outer: p.thickness }),
  },
};
