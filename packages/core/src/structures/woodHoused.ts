/**
 * Plugin `wood-housed` : limons bois à la française (marches encastrées), C §1.4, B §4.1.
 *
 * - **Un limon par volée droite et par côté** : limon de jour (face interne = C_i) et limon
 *   mural (face interne = C_e). Les faces internes sont les bords de l'emmarchement utile : les
 *   limons sont **hors emprise utile** (CHALLENGE A3), leur épaisseur est prise vers le jour et
 *   vers le mur.
 * - **Tournants** : poteau d'angle (`newel`) → chaque limon de jour s'arrête d'aplomb contre une
 *   face du poteau, avec un tenon (C §1.9) ; le poteau est une pièce `post`. Jour en arc →
 *   limon de jour continu débillardé, **non supporté au J3a** (J5) ; jour à angle vif → les deux
 *   limons de jour se rencontreraient en un point : **erreur explicite** (choisir un poteau).
 *   Dans ces deux cas les limons de jour des volées concernées ne sont pas générés (message
 *   dans `Model.errors`), les limons muraux le sont. Au mur, les limons se rencontrent au coin
 *   W (faces de référence arrêtées au coin ; assemblage à queues, C §1.9, non dessiné).
 * - **Marches encastrées** : les marches, paliers et contremarches pleines (pièces de base)
 *   sont prolongés dans les limons et les poteaux de la profondeur d'encastrement.
 * - **Développés** 1:1 (fibre de référence : face intérieure, côté marches) avec mortaises,
 *   ligne des nez, traits de report, tenons, repère gravé ; largeur de débit = rectangle
 *   englobant orienté minimal.
 * - **Contrôles** : LIMON_EPAISSEUR_MIN_DTU (rules.yaml), entaille ≥ 14 mm (NF EN 16481),
 *   largeur perpendiculaire, bois entre mortaises, joues, longueur de plateau, débit
 *   disponible, réception par le poteau (profil d'atelier, valeurs à valider).
 *
 * Paramètres `auto` : d_h, d_b (par côté), dépassements de départ et d'arrivée sont calculés
 * pour que toutes les mortaises gardent la joue mini du profil d'atelier ; profondeur
 * d'encastrement et épaisseur de tenon : profil d'atelier / tiers de l'épaisseur (à valider).
 */
import { z } from "zod";
import { intersectLines } from "../geom2d/intersect.js";
import * as V from "../geom2d/vec.js";
import type { NosingLine, Part } from "../model/derived.js";
import type { Mm, Vec2 } from "../model/primitives.js";
import type { StructureContext, StructureKind, StructureOutput } from "../model/plugins.js";
import { buildBasicParts } from "../parts/basic.js";
import { fmt } from "../rules/check.js";
import {
  WOOD_MATERIALS,
  resolveWorkshopProfile,
  smallestAvailable,
  type WorkshopProfile,
} from "../workshop/profile.js";
import { CheckCollector, FAB_RULES, flightsOnlyError, pluginRuleDef } from "./checks.js";
import {
  developStringer,
  housingPolygons,
  minCheek,
  minWoodBetween,
  nosingPitchLine,
  pitchAtU,
  toFlatPattern,
  type Housing,
  type StringerDevelopment,
  type StringerEnd,
  type StringerStart,
} from "./development.js";
import { PiecewiseLinear, area } from "./geom.js";
import {
  baseNumber,
  extendIntoFaces,
  pocketInterval,
  readPlanExtrusion,
  verticalExtrusion,
} from "./housing.js";
import { newelFaces, stairGeometry, type ReceivingFace, type StairGeometry } from "./legs.js";
import { buildNewel, type HousedPiece, type ReceivedStringer } from "./newel.js";
import { woodQuantities } from "./quantities.js";

/** Entaille marche / limon minimale de la NF EN 16481 § 5.4.2 (C §1.4, confiance élevée). */
export const EN16481_MIN_HOUSING_DEPTH: Mm = 14;

const mmInt = z.number().int();
const mmPos = mmInt.positive();
const mmNonNeg = mmInt.nonnegative();
const auto = <T extends z.ZodType>(s: T) => z.union([s, z.literal("auto")]).default("auto");

export const WoodHousedParamsSchema = z.object({
  /** Essence (MaterialId bois). */
  material: z.enum(WOOD_MATERIALS).default("wood-oak"),
  /** Épaisseur finie des limons (C §1.4 : 40 à 46 mm usuels, 45 × 250 courant — confiance faible). */
  thickness: mmPos.default(45),
  /** Dépassement vertical de la rive haute au-dessus de la ligne des nez, d_h (B §4.1). */
  upperOffset: auto(mmPos),
  /** Dépassement vertical de la rive basse au-dessous de la ligne des nez, d_b (B §4.1). */
  lowerOffset: auto(mmPos),
  /** Longueur du limon en avant du nez de départ (u, mm). */
  startExtension: auto(mmNonNeg),
  /** Longueur du limon au-delà du nez d'arrivée (u, mm), coupe d'aplomb contre le chevêtre. */
  endExtension: auto(mmNonNeg),
  /** Profondeur d'encastrement des marches ; `auto` = profil d'atelier. */
  housingDepth: auto(mmPos),
  /** Rayon d'arrondi du nez (C §1.7 : ≤ 10 mm, XP P21-211) ; défaut 10 à valider. */
  noseRadius: mmNonNeg.default(10),
  newel: z
    .object({
      /** Assemblage limon / poteau : tenon (C §1.9) ou bout à bout (boulonné). */
      joint: z.enum(["tenon", "butt"]).default("tenon"),
      tenonLength: mmPos.default(30),
      /** Épaisseur du tenon ; `auto` = tiers de l'épaisseur du limon (à valider). */
      tenonThickness: auto(mmPos),
      /** Épaulements haut et bas du tenon. */
      tenonShoulder: mmNonNeg.default(20),
      /** Pied du poteau : sol bas, ou pendant sous le plus bas des limons reçus. */
      foot: z.enum(["floor", "hanging"]).default("floor"),
      bottomExtension: mmNonNeg.default(50),
      /** Dépassement du poteau au-dessus du plus haut élément reçu. */
      topExtension: mmNonNeg.default(150),
    })
    .prefault({}),
});
export type WoodHousedParams = z.output<typeof WoodHousedParamsSchema>;

/** Paramètres `auto` résolus. */
export interface ResolvedHousedParams {
  readonly housingDepth: Mm;
  readonly tenonThickness: Mm;
  readonly upperOffset: { readonly inner: Mm; readonly outer: Mm };
  readonly lowerOffset: { readonly inner: Mm; readonly outer: Mm };
  readonly startExtension: Mm;
  readonly endExtension: Mm;
}

type Side = "inner" | "outer";

/** Face de référence d'un limon droit. */
export interface StringerFace {
  readonly id: string;
  readonly mark: string;
  readonly name: string;
  readonly side: Side;
  readonly leg: number;
  /** Point u = 0 de la face (début de la face, plan). */
  readonly a: Vec2;
  readonly dir: Vec2;
  /** Normale vers l'épaisseur du limon (hors emprise utile). */
  readonly into: Vec2;
  readonly sigmaA: Mm;
  readonly faceLength: Mm;
  readonly start: StringerStart;
  readonly end: StringerEnd;
}

/** Détail d'un limon généré (tests, UI). */
export interface HousedStringer {
  readonly face: StringerFace;
  readonly development: StringerDevelopment;
  readonly part: Part;
  readonly mirrored: boolean;
}

export interface HousedResult {
  readonly output: StructureOutput;
  readonly stringers: readonly HousedStringer[];
  readonly posts: readonly Part[];
  readonly resolved: ResolvedHousedParams;
}

const ceil5 = (x: Mm): Mm => Math.ceil(x / 5 - 1e-9) * 5;
/** Fenêtre provisoire au-delà des extrémités libres, pour localiser les mortaises. */
const PROVISIONAL_REACH: Mm = 2000;

const sigmaOf = (k: NosingLine, side: Side): Mm => (side === "inner" ? k.sigmaInner : k.sigmaOuter);

/** Faces de référence des limons générables, et messages des tournants non supportés. */
export function stringerFaces(
  ctx: StructureContext,
  geo: StairGeometry,
): { faces: StringerFace[]; errors: string[]; notes: string[] } {
  const turns = ctx.project.stair.layout.turns;
  const faces: StringerFace[] = [];
  const errors: string[] = [];
  const notes: string[] = [];
  turns.forEach((t, j) => {
    if (t.inner.kind === "arc") {
      errors.push(
        `Tournant ${j + 1} : jour en arc — limon de jour continu (débillardé) non supporté au jalon 3a (jalon 5) ; limons de jour des volées ${j + 1} et ${j + 2} non générés.`,
      );
    } else if (t.inner.kind === "sharp") {
      errors.push(
        `Tournant ${j + 1} : jour à angle vif — les limons de jour se rencontreraient en un point ; choisir un poteau d'angle (jour « poteau ») ; limons de jour des volées ${j + 1} et ${j + 2} non générés.`,
      );
    }
  });
  const last = geo.legs.length - 1;
  for (const leg of geo.legs) {
    const i = leg.index;
    const before = i > 0 ? turns[i - 1]!.inner.kind : null;
    const after = i < last ? turns[i]!.inner.kind : null;
    const start: StringerStart | null = i === 0 ? "floor" : before === "newel" ? "newel" : null;
    const end: StringerEnd | null = i === last ? "arrival" : after === "newel" ? "newel" : null;
    const len = leg.innerT1 - leg.innerT0;
    if (start && end) {
      if (len > 1) {
        faces.push({
          id: `stringer-inner-${i + 1}`,
          mark: `LI${i + 1}`,
          name: `Limon de jour, volée ${i + 1}`,
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
        notes.push(`Volée ${i + 1} sans partie droite côté jour : pas de limon de jour.`);
      }
    }
    faces.push({
      id: `stringer-outer-${i + 1}`,
      mark: `LE${i + 1}`,
      name: `Limon mural, volée ${i + 1}`,
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
 * Fenêtre [u_lo ; u_hi] d'un limon (u depuis `face.a`). À un angle mural, le limon est prolongé
 * de l'épaisseur `e` du limon voisin, jusqu'à l'arête extérieure du coin (zone de l'assemblage
 * à queues, C §1.9) : sans ce prolongement, le carré e × e du coin n'appartient à aucun limon.
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
    uLo: f.start === "floor" ? u0 - startExt : f.start === "corner" ? -e : 0,
    uHi: f.end === "arrival" ? uN + endExt : f.end === "corner" ? f.faceLength + e : f.faceLength,
  };
}

/** Portée de la face de référence proprement dite (hors zones d'angle mural). */
function faceSpan(f: StringerFace, uLo: Mm, uHi: Mm): { lo: Mm; hi: Mm } {
  return {
    lo: f.start === "corner" ? Math.max(uLo, 0) : uLo,
    hi: f.end === "corner" ? Math.min(uHi, f.faceLength) : uHi,
  };
}

/** Zones de niveau (angle mural) du développé d'un limon. */
function levelZones(f: StringerFace): { levelBefore?: Mm; levelAfter?: Mm } {
  return {
    ...(f.start === "corner" ? { levelBefore: 0 } : {}),
    ...(f.end === "corner" ? { levelAfter: f.faceLength } : {}),
  };
}

function receivingFace(f: StringerFace, uLo: Mm, uHi: Mm): ReceivingFace {
  return {
    owner: f.id,
    a: V.addScaled(f.a, f.dir, uLo),
    b: V.addScaled(f.a, f.dir, uHi),
    into: f.into,
  };
}

/**
 * Mortaises d'un limon (marche + contremarche sous son nez, contremarche d'arrivée). Une marche
 * n'est « portée » (champ `tread`) que si elle entre dans le limon sur la portée de sa face de
 * référence ; une marche qui n'entre que dans la zone d'angle mural (coin d'une marche de la
 * volée voisine) donne un encastrement d'angle, sans numéro de marche.
 */
function housingsOn(
  f: StringerFace,
  pieces: readonly HousedPiece[],
  nosings: readonly NosingLine[],
  depth: Mm,
  clearance: Mm,
  noseRadius: Mm,
  uLo: Mm,
  uHi: Mm,
): Housing[] {
  const face = { a: f.a, dir: f.dir, into: f.into };
  const span = faceSpan(f, uLo, uHi);
  const treads = pieces.filter((p) => p.kind === "tread").sort((a, b) => a.number - b.number);
  const risers = new Map(pieces.filter((p) => p.kind === "riser").map((p) => [p.number, p]));
  const out: Housing[] = [];
  const used = new Set<number>();
  for (const t of treads) {
    const tp = pocketInterval(t.outline, face, depth, uLo, uHi);
    const riser = risers.get(t.number);
    const rp = riser ? pocketInterval(riser.outline, face, depth, uLo, uHi) : null;
    if (!tp && !rp) continue;
    if (riser) used.add(riser.number);
    const carried =
      (span.lo <= uLo && span.hi >= uHi) ||
      pocketInterval(t.outline, face, depth, span.lo, span.hi) !== null ||
      (riser !== undefined &&
        pocketInterval(riser.outline, face, depth, span.lo, span.hi) !== null);
    const nosing = nosings[t.number - 1];
    let noseU: Mm | null = null;
    let sinBeta = 1;
    if (nosing && tp) {
      const hit = intersectLines(
        { origin: nosing.p, dir: nosing.dir },
        { origin: f.a, dir: f.dir },
      );
      if (hit) noseU = V.dot(V.sub(hit.point, f.a), f.dir);
      sinBeta = Math.abs(V.cross(nosing.dir, f.dir));
    }
    out.push(
      housingPolygons(
        {
          label: carried ? t.mark : `${t.mark} (angle)`,
          ...(carried ? { tread: t.number } : {}),
          ...(tp
            ? {
                treadPocket: {
                  u0: tp.u0,
                  u1: tp.u1,
                  zBottom: t.zBottom - clearance,
                  zTop: t.zTop,
                  noseU,
                  sinBeta,
                },
              }
            : {}),
          ...(rp && riser
            ? {
                riserPocket: {
                  u0: rp.u0,
                  u1: rp.u1,
                  zBottom: riser.zBottom,
                  zTop: Math.min(riser.zTop, t.zBottom - clearance),
                },
              }
            : {}),
        },
        noseRadius,
      ),
    );
  }
  for (const [num, riser] of risers) {
    if (used.has(num)) continue;
    const rp = pocketInterval(riser.outline, face, depth, uLo, uHi);
    if (!rp) continue;
    out.push(
      housingPolygons(
        { label: riser.mark, riserPocket: { ...rp, zBottom: riser.zBottom, zTop: riser.zTop } },
        noseRadius,
      ),
    );
  }
  return out;
}

function housingVertices(hs: readonly Housing[]): Vec2[] {
  return hs.flatMap((h) => h.polygons.flatMap((p) => [...p]));
}

/** Pente maximale |dz/dσ| de la ligne des nez sur [s0 ; s1]. */
function maxSlope(pitch: PiecewiseLinear, s0: Mm, s1: Mm): number {
  let m = 0;
  const { xs, ys } = pitch;
  for (let i = 0; i + 1 < xs.length; i++) {
    if (xs[i + 1]! < s0 || xs[i]! > s1) continue;
    m = Math.max(m, Math.abs((ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]!)));
  }
  if (xs.length >= 2) {
    // Prolongements.
    if (s0 < xs[0]!) m = Math.max(m, Math.abs((ys[1]! - ys[0]!) / (xs[1]! - xs[0]!)));
    const n = xs.length;
    if (s1 > xs[n - 1]!)
      m = Math.max(m, Math.abs((ys[n - 1]! - ys[n - 2]!) / (xs[n - 1]! - xs[n - 2]!)));
  }
  return m;
}

/** Débit brut (L × l × e) d'une pièce de dimensions finies, selon le profil d'atelier. */
export function stockOf(
  length: Mm,
  width: Mm,
  thickness: Mm,
  profile: WorkshopProfile,
  sections?: readonly Mm[],
): {
  stock: NonNullable<Part["stock"]>;
  widthOk: boolean;
  thicknessOk: boolean;
  need: { w: Mm; t: Mm };
} {
  const w = profile.wood;
  const needW = width + w.planingAllowance;
  const needT = thickness + w.planingAllowance;
  const t = smallestAvailable(sections ?? w.thicknesses, needT);
  const l = smallestAvailable(sections ?? w.widths, needW);
  return {
    stock: { length: length + w.lengthAllowance, width: l ?? needW, thickness: t ?? needT },
    widthOk: l !== null,
    thicknessOk: t !== null,
    need: { w: needW, t: needT },
  };
}

/** Pièces encastrables (marches, paliers, contremarches) prolongées dans les faces réceptrices. */
function extendPieces(
  baseParts: readonly Part[],
  nosings: readonly NosingLine[],
  faces: readonly ReceivingFace[],
  depth: Mm,
  profile: WorkshopProfile,
  notes: string[],
): { pieces: HousedPiece[]; replaced: Part[] } {
  const pieces: HousedPiece[] = [];
  const replaced: Part[] = [];
  for (const part of baseParts) {
    const num = baseNumber(part);
    if (!num) continue;
    const ex = readPlanExtrusion(part.solid);
    if (!ex) continue;
    let extended = extendIntoFaces(ex.outline, faces, depth);
    if (!extended) {
      // Repli : limons seuls (poteaux jointifs, arêtes plus courtes que l'encastrement).
      extended = extendIntoFaces(
        ex.outline,
        faces.filter((f) => !f.owner.startsWith("post-")),
        depth,
      );
      notes.push(
        extended
          ? `${part.mark} : non encastrée dans le poteau (contour prolongé non simple).`
          : `${part.mark} : prolongement dans les limons impossible (contour non simple), pièce laissée telle quelle.`,
      );
    }
    const outline = extended ?? ex.outline;
    pieces.push({
      kind: num.kind,
      number: num.number,
      mark: part.mark,
      outline,
      zBottom: ex.zBottom,
      zTop: ex.zBottom + ex.height,
    });
    if (extended && area(extended) > area(ex.outline) + 1e-6) {
      const volumeMm3 = area(extended) * ex.height;
      const surfaceMm2 = (part.quantities["surface"] ?? 0) * 1e6;
      const box = extentBox(extended, nosings[num.number - 1]);
      const stock = part.stock
        ? num.kind === "riser"
          ? { ...part.stock, length: box.length }
          : { ...part.stock, length: box.length, width: box.width }
        : undefined;
      replaced.push({
        ...part,
        solid: verticalExtrusion(extended, ex.zBottom, ex.height),
        ...(stock ? { stock } : {}),
        quantities: {
          ...part.quantities,
          ...woodQuantities(
            { volumeMm3, surfaceMm2, length: stock?.length ?? box.length },
            part.material,
            profile,
            stock,
          ),
        },
      });
    }
  }
  return { pieces, replaced };
}

/**
 * Étendues du contour prolongé selon les axes du débit des pièces de base (`parts/basic.ts`) :
 * longueur le long de la ligne de nez avant, largeur perpendiculairement.
 */
function extentBox(
  outline: readonly Vec2[],
  nosing: NosingLine | undefined,
): { length: Mm; width: Mm } {
  const across = nosing ? nosing.dir : V.vec(1, 0);
  const along = V.perpLeft(across);
  const ext = (axis: Vec2): Mm => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of outline) {
      const d = V.dot(p, axis);
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    }
    return hi - lo;
  };
  return { length: ext(across), width: ext(along) };
}

/** Construction complète (détails compris). */
export function buildWoodHoused(ctx: StructureContext, params: WoodHousedParams): HousedResult {
  const { project, layout, stepping } = ctx;
  const profile = resolveWorkshopProfile(project.workshop);
  const nosings = stepping.nosings;
  const notes: string[] = [];
  const e = params.thickness;
  const depth = params.housingDepth === "auto" ? profile.wood.housingDepth : params.housingDepth;
  const tenonThickness =
    params.newel.tenonThickness === "auto" ? Math.round(e / 3) : params.newel.tenonThickness;
  const clearance = profile.wood.clearance;
  const cheek = profile.wood.minCheek;
  const empty = (errors: string[]): HousedResult => ({
    output: { parts: [], checks: [], notes, errors },
    stringers: [],
    posts: [],
    resolved: {
      housingDepth: depth,
      tenonThickness,
      upperOffset: { inner: Number.NaN, outer: Number.NaN },
      lowerOffset: { inner: Number.NaN, outer: Number.NaN },
      startExtension: Number.NaN,
      endExtension: Number.NaN,
    },
  });
  const helical = flightsOnlyError("wood-housed", "limons à la française", layout);
  if (helical) return empty([helical]);
  if (nosings.length < 2) return empty(["Limons : découpage vide, aucune structure générée."]);

  const geo = stairGeometry(project, layout);
  const { faces, errors, notes: faceNotes } = stringerFaces(ctx, geo);
  notes.push(...faceNotes);

  // 1. Faces réceptrices (fenêtres provisoires) et prolongement des pièces de base.
  const provisional = faces.map((f) => ({
    f,
    uLo: f.start === "floor" ? -PROVISIONAL_REACH : f.start === "corner" ? -e : 0,
    uHi:
      f.end === "arrival"
        ? f.faceLength + PROVISIONAL_REACH
        : f.end === "corner"
          ? f.faceLength + e
          : f.faceLength,
  }));
  const newelList = geo.newels.map((nw) => ({
    geom: nw,
    id: `post-${nw.turn + 1}`,
    mark: `PT${nw.turn + 1}`,
  }));
  const receiving: ReceivingFace[] = [
    ...provisional.map(({ f, uLo, uHi }) => receivingFace(f, uLo, uHi)),
    ...newelList.flatMap((nw) => newelFaces(nw.geom, nw.id)),
  ];
  const baseParts = ctx.baseParts ?? buildBasicParts(project, layout, stepping).parts;
  const { pieces, replaced } = extendPieces(baseParts, nosings, receiving, depth, profile, notes);

  // 2. Mortaises provisoires → paramètres `auto`.
  const pitch: Record<Side, PiecewiseLinear> = {
    inner: nosingPitchLine(nosings, stepping.treads, "inner"),
    outer: nosingPitchLine(nosings, stepping.treads, "outer"),
  };
  const need = {
    upper: { inner: profile.wood.minUpperOffset, outer: profile.wood.minUpperOffset },
    lower: { inner: 0, outer: 0 },
    start: cheek,
    end: 0,
  };
  for (const { f, uLo, uHi } of provisional) {
    const hs = housingsOn(f, pieces, nosings, depth, clearance, params.noseRadius, uLo, uHi);
    const verts = housingVertices(hs);
    if (verts.length === 0) continue;
    const us = verts.map((p) => p.x);
    const uMin = Math.min(...us);
    const uMax = Math.max(...us);
    const P = pitch[f.side];
    const k = Math.sqrt(1 + maxSlope(P, f.sigmaA + uMin - 50, f.sigmaA + uMax + 50) ** 2);
    const zAt = (u: Mm): Mm => pitchAtU({ pitch: P, sigmaA: f.sigmaA, ...levelZones(f) }, u);
    for (const p of verts) {
      const z = zAt(p.x);
      need.lower[f.side] = Math.max(need.lower[f.side], z - p.y + cheek * k);
      need.upper[f.side] = Math.max(need.upper[f.side], p.y - z + cheek * k);
    }
    if (f.start === "floor") {
      const u0 = sigmaOf(nosings[0]!, f.side) - f.sigmaA;
      need.start = Math.max(need.start, u0 - uMin + cheek);
    }
    if (f.end === "arrival") {
      const uN = sigmaOf(nosings[nosings.length - 1]!, f.side) - f.sigmaA;
      need.end = Math.max(need.end, uMax - uN + cheek);
    }
  }
  const pick = (v: number | "auto", computed: Mm): Mm => (v === "auto" ? ceil5(computed) : v);
  const resolved: ResolvedHousedParams = {
    housingDepth: depth,
    tenonThickness,
    upperOffset: {
      inner: pick(params.upperOffset, need.upper.inner),
      outer: pick(params.upperOffset, need.upper.outer),
    },
    lowerOffset: {
      inner: pick(params.lowerOffset, need.lower.inner),
      outer: pick(params.lowerOffset, need.lower.outer),
    },
    startExtension: pick(params.startExtension, need.start),
    endExtension: pick(params.endExtension, Math.max(0, need.end)),
  };

  // 3. Limons.
  const stringers: HousedStringer[] = [];
  const stocks = new Map<string, ReturnType<typeof stockOf>>();
  for (const f of faces) {
    const { uLo, uHi } = windowOf(f, nosings, resolved.startExtension, resolved.endExtension, e);
    const housings = housingsOn(f, pieces, nosings, depth, clearance, params.noseRadius, uLo, uHi);
    const dev = developStringer({
      pitch: pitch[f.side],
      sigmaA: f.sigmaA,
      uLo,
      uHi,
      start: f.start,
      end: f.end,
      upperOffset: resolved.upperOffset[f.side],
      lowerOffset: resolved.lowerOffset[f.side],
      ...levelZones(f),
      ...(f.end === "arrival"
        ? { topCut: nosings[nosings.length - 1]!.z + resolved.upperOffset[f.side] }
        : {}),
      housings,
      ...(params.newel.joint === "tenon"
        ? { tenon: { length: params.newel.tenonLength, shoulder: params.newel.tenonShoulder } }
        : {}),
    });
    // Vu depuis les marches : la droite de l'observateur (qui regarde vers `into`) est +u ?
    const mirrored = V.dot(V.perpRight(f.into), f.dir) < 0;
    let uMin = Infinity;
    let uMax = -Infinity;
    for (const p of dev.outline) {
      uMin = Math.min(uMin, p.x);
      uMax = Math.max(uMax, p.x);
    }
    const span = faceSpan(f, uLo, uHi);
    const noses = nosings
      .map((k) => ({ u: sigmaOf(k, f.side) - f.sigmaA, z: k.z, index: k.index }))
      .filter((k) => k.u >= span.lo - 1e-6 && k.u <= span.hi + 1e-6);
    const joints: { u: Mm; label: string }[] = [];
    // Angle mural : trait à l'angle intérieur (face du limon voisin) ; au-delà, zone des queues.
    if (f.start === "corner") joints.push({ u: 0, label: "Angle mural (assemblage à queues)" });
    if (f.end === "corner")
      joints.push({ u: f.faceLength, label: "Angle mural (assemblage à queues)" });
    if (f.start === "newel") joints.push({ u: uLo, label: "Face du poteau" });
    if (f.end === "newel") joints.push({ u: uHi, label: "Face du poteau" });
    const sideLabel = f.side === "inner" ? "limon de jour" : "limon mural";
    const flat = toFlatPattern(dev, {
      mirrored,
      thickness: e,
      depth,
      mark: f.mark,
      referenceDescription: `Face intérieure du ${sideLabel} (côté marches), vue depuis les marches ; x = abscisse horizontale le long du limon (${mirrored ? "la montée va vers les x décroissants" : "la montée va vers les x croissants"}), y = altitude (sol fini bas = 0), mm, 1:1.`,
      noses,
      joints,
    });
    const box = dev.box;
    const st = stockOf(box.length, box.width, e, profile);
    stocks.set(f.id, st);
    const pocketArea = housings.reduce(
      (s, h) => s + h.polygons.reduce((t, p) => t + area(p), 0),
      0,
    );
    const devArea = area(dev.outline);
    const xDir = mirrored ? V.scale(f.dir, -1) : f.dir;
    const originPlan = V.addScaled(f.a, f.dir, mirrored ? uMax : uMin);
    const first = dev.pitchLine[0]!;
    const lastP = dev.pitchLine[dev.pitchLine.length - 1]!;
    const slope = Math.atan2(lastP.y - first.y, lastP.x - first.x);
    const part: Part = {
      id: f.id,
      mark: f.mark,
      category: "stringer",
      name: f.name,
      material: params.material,
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
      section: `${fmt(e, 0)} × ${fmt(Math.ceil(box.width), 0)}`,
      stock: st.stock,
      quantities: woodQuantities(
        { volumeMm3: devArea * e - pocketArea * depth, surfaceMm2: devArea, length: box.length },
        params.material,
        profile,
        st.stock,
      ),
      grain: {
        x: f.dir.x * Math.cos(slope),
        y: f.dir.y * Math.cos(slope),
        z: Math.sin(slope),
      },
    };
    stringers.push({ face: f, development: dev, part, mirrored });
  }

  // 4. Poteaux.
  const posts: Part[] = [];
  for (const nw of newelList) {
    const received: ReceivedStringer[] = [];
    for (const s of stringers) {
      if (s.face.side !== "inner") continue;
      const atEnd = s.face.end === "newel" && s.face.leg === nw.geom.turn;
      const atStart = s.face.start === "newel" && s.face.leg === nw.geom.turn + 1;
      if (!atEnd && !atStart) continue;
      const u = atEnd ? s.development.uHi : s.development.uLo;
      const idx = atEnd ? s.development.lowerRive.length - 1 : 0;
      const tenon = s.development.tenons.find((t) => t.toward === (atEnd ? 1 : -1));
      received.push({
        mark: s.face.mark,
        endPoint: V.addScaled(s.face.a, s.face.dir, u),
        into: s.face.into,
        thickness: e,
        lowerZ: s.development.lowerRive[idx]!.y,
        upperZ: s.development.upperRive[idx]!.y,
        ...(tenon ? { tenon: { zBottom: tenon.zBottom, zTop: tenon.zTop } } : {}),
      });
    }
    const r = buildNewel(nw.geom, pieces, nosings, received, {
      id: nw.id,
      mark: nw.mark,
      name: `Poteau d'angle, tournant ${nw.geom.turn + 1}`,
      material: params.material,
      housingDepth: depth,
      clearance,
      noseRadius: params.noseRadius,
      tenonLength: params.newel.tenonLength,
      tenonThickness,
      foot: params.newel.foot,
      bottomExtension: params.newel.bottomExtension,
      topExtension: params.newel.topExtension,
    });
    const a = nw.geom.size;
    const height = r.top - r.foot;
    const st = stockOf(height, a, a, profile, profile.wood.postSections);
    stocks.set(nw.id, st);
    posts.push({
      id: nw.id,
      mark: nw.mark,
      category: "post",
      name: `Poteau d'angle, tournant ${nw.geom.turn + 1}`,
      material: params.material,
      solid: r.solid,
      flat: r.flat,
      section: `${fmt(a, 0)} × ${fmt(a, 0)}`,
      stock: st.stock,
      quantities: woodQuantities(
        { volumeMm3: r.volumeMm3, surfaceMm2: r.surfaceMm2, length: height },
        params.material,
        profile,
        st.stock,
      ),
      grain: { x: 0, y: 0, z: 1 },
    });
  }

  // 5. Contrôles.
  const checks = new CheckCollector(project, stepping);
  const partLoc = (id: string) => ({ partId: id });
  const thicknessRule = checks.yamlRule("LIMON_EPAISSEUR_MIN_DTU");
  if (thicknessRule && stringers.length > 0) {
    const E = project.stair.layout.width;
    if (E > 1200) {
      checks.add(thicknessRule, [
        {
          status: "non-evaluee",
          message: `Hors domaine des règles de moyens (emmarchement ${fmt(E, 0)} mm > 1 200 mm) : justification par le calcul (C §1.4).`,
        },
      ]);
    } else {
      checks.addItems(
        thicknessRule,
        stringers.map((s) => ({ value: e, label: s.face.mark, ...partLoc(s.face.id) })),
        "Épaisseur de limon",
        { min: thicknessRule.min, max: thicknessRule.max },
      );
    }
  }
  if (stringers.length > 0) {
    checks.addItems(
      pluginRuleDef(FAB_RULES.housingDepth),
      [{ value: depth, label: "profondeur d'encastrement" }],
      "Entaille marche / limon",
      { min: EN16481_MIN_HOUSING_DEPTH, max: null },
    );
    checks.addItems(
      pluginRuleDef(FAB_RULES.perpendicularWidth),
      stringers.map((s) => ({
        value: s.development.minPerpendicularWidth,
        label: s.face.mark,
        ...partLoc(s.face.id),
      })),
      "Largeur perpendiculaire",
      { min: profile.wood.minPerpendicularWidth, max: null },
    );
    const between = stringers.flatMap((s) => {
      const w = minWoodBetween(s.development);
      return w
        ? [{ value: w.value, label: `${s.face.mark} (${w.label})`, ...partLoc(s.face.id) }]
        : [];
    });
    checks.addItems(pluginRuleDef(FAB_RULES.woodBetweenHousings), between, "Bois entre mortaises", {
      min: profile.wood.minWoodBetweenHousings,
      max: null,
    });
    const cheeks = stringers.flatMap((s) => {
      const c = minCheek(s.development);
      return c
        ? [{ value: c.value, label: `${s.face.mark} (${c.label})`, ...partLoc(s.face.id) }]
        : [];
    });
    checks.addItems(pluginRuleDef(FAB_RULES.cheek), cheeks, "Joue", {
      min: profile.wood.minCheek - 1e-6,
      max: null,
    });
  }
  const allParts = [...stringers.map((s) => s.part), ...posts];
  if (allParts.length > 0) {
    checks.addItems(
      pluginRuleDef(FAB_RULES.boardLength),
      allParts.map((p) => ({ value: p.stock!.length, label: p.mark, ...partLoc(p.id) })),
      "Longueur de débit",
      { min: null, max: profile.wood.maxBoardLength },
    );
    const stockFindings = allParts.map((p) => {
      const st = stocks.get(p.id)!;
      const loc = { kind: "part" as const, partId: p.id };
      return st.widthOk && st.thicknessOk
        ? {
            status: "ok" as const,
            measured: st.need.w,
            location: loc,
            message: `${p.mark} : débit brut ${fmt(st.stock.width, 0)} × ${fmt(st.stock.thickness, 0)} mm disponible.`,
          }
        : {
            status: "violation" as const,
            measured: st.need.w,
            location: loc,
            message: `${p.mark} : débit brut nécessaire ${fmt(st.need.w, 0)} × ${fmt(st.need.t, 0)} mm${st.thicknessOk ? "" : " (épaisseur indisponible)"}${st.widthOk ? "" : " (largeur indisponible)"} dans le profil d'atelier.`,
          };
    });
    checks.add(pluginRuleDef(FAB_RULES.stockAvailable), stockFindings);
  }
  for (const nw of newelList) {
    const half = nw.geom.size / 2;
    checks.addItems(
      pluginRuleDef(FAB_RULES.newelReception),
      stringers
        .filter(
          (s) =>
            s.face.side === "inner" &&
            ((s.face.end === "newel" && s.face.leg === nw.geom.turn) ||
              (s.face.start === "newel" && s.face.leg === nw.geom.turn + 1)),
        )
        .map((s) => ({ value: e, label: `${s.face.mark} sur ${nw.mark}`, ...partLoc(s.face.id) })),
      "Épaisseur du limon reçu par le poteau",
      { min: null, max: half },
    );
  }

  notes.push(
    `Limons à la française : d_h = ${fmt(resolved.upperOffset.inner, 0)} / ${fmt(resolved.upperOffset.outer, 0)} mm, d_b = ${fmt(resolved.lowerOffset.inner, 0)} / ${fmt(resolved.lowerOffset.outer, 0)} mm (jour / mur), encastrement ${fmt(depth, 0)} mm ; valeurs par défaut du profil d'atelier à valider.`,
  );

  return {
    output: {
      parts: [...replaced, ...allParts],
      checks: checks.results,
      notes,
      ...(errors.length > 0 ? { errors } : {}),
    },
    stringers,
    posts,
    resolved,
  };
}

export const WOOD_HOUSED: StructureKind<WoodHousedParams> = {
  kind: "wood-housed",
  label: "Limons bois à la française (marches encastrées)",
  family: "bois",
  paramsSchema: WoodHousedParamsSchema,
  defaults: () => WoodHousedParamsSchema.parse({}),
  build: (ctx, params) => buildWoodHoused(ctx, params).output,
};
