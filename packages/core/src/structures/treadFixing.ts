/**
 * Fixation d'une marche sur son support de marche (QUESTIONS A31, décision de l'utilisateur du
 * 2026-10-06) : paramètre de plugin « vissée | soudée », vissée par défaut (« à valider »).
 *
 * - **Marche bois** : toujours vissée par-dessous sur l'aile horizontale du support (C §2.5,
 *   §2.7 [23]) : `treadScrews` perçages non dimensionnés dans le support, vis à bois
 *   (`treadScrewed`, A27). Le paramètre ne s'applique pas.
 * - **Marche en tôle pliée, vissée** : perçages de diamètre `treadHoleDiameter` dans l'aile du
 *   support **et** dans le développé de la marche (mêmes points), visserie déduite (A27).
 * - **Marche en tôle pliée, soudée** : ni perçage ni visserie ; cordons comptés (`weld_mm`) ;
 *   effet sur la classe d'exécution par la règle existante (« soudé » en S355, C §2.1 [13]).
 * Le chiffrage (`holes`) compte les perçages réellement faits, dans les deux cas.
 *
 * Contrat partagé (vague « limon central ») : les plugins `steel-flat`, `steel-curved` et
 * `steel-central` appellent **ces** fonctions.
 *
 * Choix Blondel **« à valider »** (aucune source ne les chiffre) :
 * - **cordon d'une marche soudée** : un cordon d'angle continu le long du bord libre de l'aile
 *   d'appui du support (le seul côté accessible par-dessous : l'autre bord est contre la joue du
 *   limon ou la face du poteau), soit une longueur de cordon égale à la longueur d'appui ;
 * - **pince d'un perçage de marche** : centre à au moins un diamètre de perçage des bords de la
 *   partie plane du dessus (lignes de tangence des plis et bords latéraux), soit un ligament
 *   d'un demi-diamètre ; un point plus proche n'est pas percé (et n'est pas compté), de même
 *   qu'un point qui chevaucherait un perçage déjà fait.
 */
import { z } from "zod";
import { pointInPolygon, signedArea } from "../geom2d/polygon.js";
import {
  holePolygon,
  polygonPerimeter,
  QUANTITY_HOLES,
  QUANTITY_LASER_CUT_MM,
  QUANTITY_TREATED_SURFACE_M2,
} from "./steelCommon.js";
import { QUANTITY_MASS_KG, QUANTITY_VOLUME_M3 } from "./quantities.js";
import { QUANTITY_VOLUME } from "../parts/basic.js";
import * as V from "../geom2d/vec.js";
import type { Part, PartFixing, SolidDesc } from "../model/derived.js";
import type { Mm, Polygon2, Vec2 } from "../model/primitives.js";
import { foldedFlatTransform, type FoldedTreadResult } from "./folded.js";

/** Fixation d'une marche en tôle pliée sur son support. */
export const TREAD_FIXINGS = ["screwed", "welded"] as const;
export type TreadFixing = (typeof TREAD_FIXINGS)[number];

/**
 * Diamètre de perçage par défaut des vis d'une marche en tôle vissée (mm) : M8 avec 1 mm de
 * jeu (`holeClearance` du profil de visserie), **à valider** (aucune source).
 */
export const DEFAULT_TREAD_HOLE_DIAMETER: Mm = 9;

/**
 * Schéma du paramètre `supports.treadFixing` (A31) : vissée par défaut, **à valider** (aucune
 * source ne tranche ; C §2.3 [58] : marches en tôle larmée soudées ; C §2.6 [23] : marches
 * vissées sur supports soudés).
 */
export const TreadFixingSchema = z.enum(TREAD_FIXINGS).default("screwed");

/**
 * Schéma du paramètre `supports.treadHoleDiameter` (A31) : diamètre de perçage des vis d'une
 * marche en tôle vissée (9 mm : M8 avec 1 mm de jeu, `holeClearance` du profil de visserie),
 * **à valider** (aucune source).
 */
export const TreadHoleDiameterSchema = z
  .number()
  .int()
  .positive()
  .default(DEFAULT_TREAD_HOLE_DIAMETER);

/** Fixation de la marche sur un support (entrée commune des plugins). */
export interface TreadFixingSpec {
  /** Fixation choisie (sans effet sous une marche bois). */
  readonly fixing: TreadFixing;
  /** Nombre de points de fixation de la marche par support (`supports.treadScrews`). */
  readonly screws: number;
  /** Diamètre de perçage d'une marche en tôle vissée (mm). */
  readonly holeDiameter: Mm;
}

/** Matériau de la marche portée par le support. */
export type TreadMaterialKind = "wood" | "steel";

/** Effet de la fixation de la marche sur la pièce support. */
export interface TreadSupportJoint {
  /** Fixations déclarées par le support pour la marche (`Part.fixings`, visserie A27). */
  readonly fixings: readonly PartFixing[];
  /** Perçages faits dans le support pour la marche (quantité `holes`). */
  readonly holes: number;
  /** Cordons de soudure marche ↔ support (mm, quantité `weld_mm`). */
  readonly weld: Mm;
}

/**
 * Fixation de la marche sur un support de longueur d'appui `bearingLength` (mm) :
 *
 * - bois : `screws` vis à bois (`treadScrewed`, perçages non dimensionnés), aucun cordon ;
 * - tôle vissée : `screws` vis à métaux (`treadBolted`, perçage `holeDiameter`), aucun cordon ;
 * - tôle soudée : ni perçage ni fixation, un cordon de longueur `bearingLength` (voir l'en-tête).
 *
 * Nombre de vis négatif ou non fini : aucun perçage. Ne lève jamais.
 */
export function treadSupportJoint(
  spec: TreadFixingSpec,
  tread: TreadMaterialKind,
  bearingLength: Mm,
): TreadSupportJoint {
  const screws = Number.isFinite(spec.screws) ? Math.max(0, Math.floor(spec.screws)) : 0;
  if (tread === "wood") {
    return {
      fixings: screws > 0 ? [{ joint: "treadScrewed", points: screws }] : [],
      holes: screws,
      weld: 0,
    };
  }
  if (spec.fixing === "welded") {
    return {
      fixings: [],
      holes: 0,
      weld: Number.isFinite(bearingLength) ? Math.max(0, bearingLength) : 0,
    };
  }
  return {
    fixings:
      screws > 0 ? [{ joint: "treadBolted", points: screws, holeDiameter: spec.holeDiameter }] : [],
    holes: screws,
    weld: 0,
  };
}

/** Distance d'un point au contour d'un polygone (arêtes). */
function distanceToBoundary(p: Vec2, poly: Polygon2): Mm {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ab = V.sub(b, a);
    const l2 = V.normSq(ab);
    const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, V.dot(V.sub(p, a), ab) / l2));
    best = Math.min(best, V.distance(p, V.addScaled(a, ab, t)));
  }
  return best;
}

/** Centre (moyenne des sommets) d'un perçage polygonal. */
function holeCenter(hole: readonly Vec2[]): Vec2 {
  let c = V.ZERO;
  for (const p of hole) c = V.add(c, p);
  return V.scale(c, 1 / Math.max(1, hole.length));
}

type Extrusion = Extract<SolidDesc, { kind: "extrusion" }>;

/** Extrusion verticale (axe Z monde, repère non tourné) : le dessus en plan d'une marche. */
function isVerticalExtrusion(solid: SolidDesc): solid is Extrusion {
  if (solid.kind !== "extrusion") return false;
  const { xAxis, yAxis, zAxis } = solid.frame;
  const eps = 1e-9;
  return (
    Math.abs(zAxis.z - 1) < eps &&
    Math.abs(xAxis.x - 1) < eps &&
    Math.abs(yAxis.y - 1) < eps &&
    Math.abs(xAxis.y) < eps &&
    Math.abs(yAxis.x) < eps
  );
}

/**
 * Perce le développé d'une marche en tôle pliée vissée aux points `points` (plan, repère monde,
 * sous le dessus de la marche), au diamètre `holeDiameter` : un trou rond (`holePolygon`) par
 * point retenu dans `flat.outline.holes`, à la même place que dans le dessus (transformation
 * `foldedFlatTransform`). Un point est retenu s'il est dans la partie plane du dessus
 * (`result.top`) à au moins `edgeDistance` (défaut : `holeDiameter`, « à valider ») de son
 * contour, et à au moins `holeDiameter` d'un perçage existant ; les autres sont ignorés.
 * Quantités mises à jour : `holes` (+ trous percés), `laser_cut_mm` (+ périmètres), volume,
 * masse et surface à traiter (aire des trous retirée). Le solide, s'il est une extrusion
 * verticale du dessus (marches non prismatiques), reçoit les mêmes trous. Ne lève jamais :
 * sans développé, diamètre non positif ou aucun point retenu, la pièce est rendue telle quelle.
 */
export function drillFoldedTread(
  part: Part,
  result: FoldedTreadResult,
  points: readonly Vec2[],
  holeDiameter: Mm,
  edgeDistance: Mm = holeDiameter,
): Part {
  return drillFoldedTreadPoints(part, result, points, holeDiameter, edgeDistance).part;
}

/**
 * Comme `drillFoldedTread`, avec le sort de chaque point : `drilled[i]` vrai si `points[i]` a été
 * percé. Sert à aligner les perçages du support et la visserie sur les trous réellement faits
 * dans la marche (A31 : mêmes points dans l'aile du support et dans la marche, chiffrage aligné).
 */
export function drillFoldedTreadPoints(
  part: Part,
  result: FoldedTreadResult,
  points: readonly Vec2[],
  holeDiameter: Mm,
  edgeDistance: Mm = holeDiameter,
): { part: Part; drilled: boolean[] } {
  const drilled = points.map(() => false);
  const flat = part.flat;
  const top = result.top;
  if (!flat || !(holeDiameter > 0) || points.length === 0 || !top || top.length < 3) {
    return { part, drilled };
  }
  const toFlat = foldedFlatTransform(result);
  const taken: Vec2[] = flat.outline.holes.map(holeCenter);
  const drilledWorld: Vec2[] = [];
  const drilledFlat: Vec2[] = [];
  points.forEach((p, i) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    if (pointInPolygon(p, top) !== "inside") return;
    if (distanceToBoundary(p, top) < edgeDistance - 1e-9) return;
    const c = toFlat(p);
    if (taken.some((h) => V.distance(h, c) < holeDiameter - 1e-9)) return;
    taken.push(c);
    drilledWorld.push(p);
    drilledFlat.push(c);
    drilled[i] = true;
  });
  if (drilledFlat.length === 0) return { part, drilled };
  const newHoles = drilledFlat.map((c) => holePolygon(c, holeDiameter));
  const holeArea = newHoles.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
  const holePerimeter = newHoles.reduce((s, h) => s + polygonPerimeter(h), 0);
  const t = flat.thickness;
  const q = part.quantities;
  const quantities: Record<string, number> = {
    ...q,
    [QUANTITY_HOLES]: (q[QUANTITY_HOLES] ?? 0) + drilledFlat.length,
  };
  const laser = q[QUANTITY_LASER_CUT_MM];
  if (laser !== undefined) quantities[QUANTITY_LASER_CUT_MM] = laser + holePerimeter;
  const volume = q[QUANTITY_VOLUME_M3] ?? q[QUANTITY_VOLUME];
  if (volume !== undefined && volume > 0) {
    const next = Math.max(0, volume - (holeArea * t) / MM3_PER_M3);
    if (q[QUANTITY_VOLUME] !== undefined) quantities[QUANTITY_VOLUME] = next;
    if (q[QUANTITY_VOLUME_M3] !== undefined) quantities[QUANTITY_VOLUME_M3] = next;
    const mass = q[QUANTITY_MASS_KG];
    if (mass !== undefined) quantities[QUANTITY_MASS_KG] = (mass * next) / volume;
  }
  const treated = q[QUANTITY_TREATED_SURFACE_M2];
  if (treated !== undefined) {
    quantities[QUANTITY_TREATED_SURFACE_M2] = Math.max(
      0,
      treated + (holePerimeter * t - 2 * holeArea) / MM2_PER_M2,
    );
  }
  let solid = part.solid;
  if (isVerticalExtrusion(solid)) {
    const o = solid.frame.origin;
    solid = {
      ...solid,
      profile: {
        outer: solid.profile.outer,
        holes: [
          ...solid.profile.holes,
          ...drilledWorld.map((c) => holePolygon(V.vec(c.x - o.x, c.y - o.y), holeDiameter)),
        ],
      },
    };
  }
  return {
    part: {
      ...part,
      solid,
      flat: {
        ...flat,
        outline: { outer: flat.outline.outer, holes: [...flat.outline.holes, ...newHoles] },
      },
      quantities,
    },
    drilled,
  };
}

const MM3_PER_M3 = 1e9;
const MM2_PER_M2 = 1e6;
