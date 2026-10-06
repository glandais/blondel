/**
 * Éléments communs aux structures métal (jalon 3b) : matériau, grandeurs de nomenclature
 * acier, classe d'exécution EN 1090-2, contrôles de fabrication métal, perçages et regroupement
 * des pièces identiques.
 *
 * Grandeurs acier (`Part.quantities`, unité dans le nom) : `mass_kg` (masse volumique du profil
 * d'atelier), `volume_m3` (et la clé historique `volume`), `treated_surface_m2` (surface à
 * traiter : deux faces et chants), `weld_mm` (longueur totale de cordon), `butt_weld_mm` (dont
 * soudures bout à bout), `cuts` (coupes : 2 par barre sciée, 1 contour par pièce découpée au
 * laser), `laser_cut_mm` (longueur de découpe laser, contour et perçages), `bends` (plis),
 * `bend_length_mm` (longueur cumulée des lignes de pli), `holes` (perçages et lumières),
 * `length_mm`.
 */
import { dec, msg, type Message } from "@blondel/i18n";
import { WORKSHOP_DEFAULT_SOURCE, sourceSpec } from "../rules/sources.js";
import { signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { FlatPattern, MaterialId, Part } from "../model/derived.js";
import type { Mm, Polygon2, Vec2 } from "../model/primitives.js";
import type { SteelGrade } from "../workshop/metal.js";
import type { WorkshopProfile } from "../workshop/profile.js";
import type { PluginRuleSpec } from "./checks.js";
import { QUANTITY_LENGTH_MM, QUANTITY_MASS_KG, QUANTITY_VOLUME_M3 } from "./quantities.js";
import { QUANTITY_VOLUME } from "../parts/basic.js";

export const QUANTITY_TREATED_SURFACE_M2 = "treated_surface_m2";
export const QUANTITY_WELD_MM = "weld_mm";
export const QUANTITY_BUTT_WELD_MM = "butt_weld_mm";
export const QUANTITY_CUTS = "cuts";
export const QUANTITY_LASER_CUT_MM = "laser_cut_mm";
export const QUANTITY_BENDS = "bends";
export const QUANTITY_BEND_LENGTH_MM = "bend_length_mm";
export const QUANTITY_HOLES = "holes";

const MM3_PER_M3 = 1e9;
const MM2_PER_M2 = 1e6;

export type SteelFinish = "raw" | "painted" | "galvanized";

export function steelMaterial(finish: SteelFinish): MaterialId {
  return finish === "raw"
    ? "steel-raw"
    : finish === "painted"
      ? "steel-painted"
      : "steel-galvanized";
}

export interface SteelMeasures {
  /** Volume de matière (mm³). */
  readonly volumeMm3: number;
  /** Surface à traiter (mm²). */
  readonly treatedSurfaceMm2: number;
  readonly length: Mm;
  readonly weld?: Mm;
  readonly buttWeld?: Mm;
  readonly cuts?: number;
  readonly laserCut?: Mm;
  readonly bends?: number;
  readonly bendLength?: Mm;
  readonly holes?: number;
}

/** Grandeurs normalisées d'une pièce acier. */
export function steelQuantities(
  m: SteelMeasures,
  profile: WorkshopProfile,
): Record<string, number> {
  const volume = m.volumeMm3 / MM3_PER_M3;
  return {
    [QUANTITY_VOLUME]: volume,
    [QUANTITY_VOLUME_M3]: volume,
    [QUANTITY_MASS_KG]: volume * profile.metal.density,
    [QUANTITY_TREATED_SURFACE_M2]: m.treatedSurfaceMm2 / MM2_PER_M2,
    [QUANTITY_LENGTH_MM]: m.length,
    [QUANTITY_WELD_MM]: m.weld ?? 0,
    [QUANTITY_BUTT_WELD_MM]: m.buttWeld ?? 0,
    [QUANTITY_CUTS]: m.cuts ?? 0,
    [QUANTITY_LASER_CUT_MM]: m.laserCut ?? 0,
    [QUANTITY_BENDS]: m.bends ?? 0,
    [QUANTITY_BEND_LENGTH_MM]: m.bendLength ?? 0,
    [QUANTITY_HOLES]: m.holes ?? 0,
  };
}

export function polygonPerimeter(poly: Polygon2): Mm {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += V.distance(poly[i]!, poly[(i + 1) % poly.length]!);
  return s;
}

/**
 * Mesures d'une tôle plane découpée (développé `outline` à trous, épaisseur t) : volume =
 * aire nette × t, surface à traiter = 2 × aire nette + périmètres × t, découpe laser = contour
 * et trous.
 */
export function plateMeasures(
  shape: FlatPattern["outline"],
  thickness: Mm,
): { volumeMm3: number; treatedSurfaceMm2: number; laserCut: Mm; netArea: number } {
  const holesArea = shape.holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
  const netArea = Math.abs(signedArea(shape.outer)) - holesArea;
  const perimeter =
    polygonPerimeter(shape.outer) + shape.holes.reduce((s, h) => s + polygonPerimeter(h), 0);
  return {
    volumeMm3: netArea * thickness,
    treatedSurfaceMm2: 2 * netArea + perimeter * thickness,
    laserCut: perimeter,
    netArea,
  };
}

// ------------------------------------------------------------------ Classe d'exécution

export interface ExecutionClassInput {
  readonly grade: SteelGrade;
  /** Longueur de soudures bout à bout (assemblages de continuité), mm. */
  readonly buttWeld: Mm;
  readonly hotForming?: boolean;
  /**
   * La structure comporte-t-elle **au moins une soudure** (cordons d'angle compris) ? La nuance
   * S355 ne fait passer en PC2 que les éléments **soudés** (C §2.1 : « PC1 pour les éléments non
   * soudés »). Absent : `true` (lecture conservatrice, comportement antérieur).
   */
  readonly welded?: boolean;
}

/**
 * Classe d'exécution EN 1090-2 déduite (C §2.1 d'après CNC2M N0169 [13], SPEC §2.4) : famille B
 * (limons et supports) ⇒ CC1 ; catégorie de production PC1 pour les éléments **non soudés**
 * (toutes nuances) ou soudés en nuance < S355 ; PC2 pour les soudures bout à bout de
 * continuité, les éléments **soudés** en nuance ≥ S355 et le formage à chaud ; SC1 supposée (un
 * escalier de secours peut relever de SC2, non pris en compte). CC1 + SC1 + PC1 ⇒ EXC1 ;
 * CC1 + SC1 + PC2 ⇒ EXC2. Un S355 entièrement boulonné reste donc en EXC1 (corrigé le
 * 2026-09-29 : la synthèse « S355 → EXC2 » de C §2.1 et SPEC §2.4 omet la condition de soudure
 * que porte le texte source cité en C §2.1).
 */
export function deduceExecutionClass(input: ExecutionClassInput): {
  readonly executionClass: "EXC1" | "EXC2";
  readonly reasons: readonly Message[];
} {
  const reasons: Message[] = [];
  if (input.grade === "S355" && (input.welded ?? true))
    reasons.push(msg("structure.steel.exc.reason.s355Welded"));
  if (input.buttWeld > 1e-9)
    reasons.push(msg("structure.steel.exc.reason.buttWeld", { length: dec(input.buttWeld, 0) }));
  if (input.hotForming) reasons.push(msg("structure.steel.exc.reason.hotForming"));
  return { executionClass: reasons.length > 0 ? "EXC2" : "EXC1", reasons };
}

/** Liste de messages séparés par des virgules (« a, b, c ») ; `null` pour une liste vide. */
export function joinMessages(items: readonly Message[]): Message | null {
  if (items.length === 0) return null;
  let out = items[items.length - 1]!;
  for (let i = items.length - 2; i >= 0; i--) {
    out = msg("structure.steel.list", { head: items[i]!, tail: out });
  }
  return out;
}

/**
 * Raisons de la classe d'exécution (« nuance S355 soudée, … ») ou, sans raison, « S235, aucune
 * soudure bout à bout ».
 */
export function executionClassReasons(
  exc: { readonly reasons: readonly Message[] },
  grade: SteelGrade,
): Message {
  return joinMessages(exc.reasons) ?? msg("structure.steel.exc.noButtWeld", { grade });
}

// ------------------------------------------------------------------ Contrôles métal

/** Source des contrôles réglés par le profil d'atelier (valeurs par défaut « à valider »). */
const WORKSHOP_SOURCE = sourceSpec(WORKSHOP_DEFAULT_SOURCE);

/** Contrôles métal ; descriptions : `rules.<id>.description` (ADR-0007). */
export const STEEL_RULES = {
  executionClass: {
    id: "EXC_CLASSE_EXECUTION",
    ...sourceSpec(msg("compliance.source.executionClass")),
    confidence: "eleve",
    nature: "normatif",
    severity: "conseil",
    unit: null,
  },
  bendRadius: {
    id: "FAB_PLI_RAYON_MIN",
    ...sourceSpec(msg("compliance.source.bendRadius")),
    confidence: "moyen",
    nature: "metier",
    severity: "bloquant",
    unit: "mm",
  },
  bendFlange: {
    id: "FAB_PLI_BORD_MIN",
    ...sourceSpec(msg("compliance.source.bendFlange")),
    confidence: "moyen",
    nature: "metier",
    severity: "bloquant",
    unit: "mm",
  },
  pressBrake: {
    id: "FAB_PRESSE_PLIEUSE",
    ...sourceSpec(msg("compliance.source.pressBrake")),
    confidence: "moyen",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
  bendLaw: {
    id: "FAB_LOI_DE_PLI",
    ...WORKSHOP_SOURCE,
    confidence: "faible",
    nature: "metier",
    severity: "bloquant",
    unit: "mm",
  },
  laser: {
    id: "FAB_LASER_EPAISSEUR",
    ...WORKSHOP_SOURCE,
    confidence: "faible",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
  sheetFormat: {
    id: "FAB_FORMAT_TOLE",
    ...sourceSpec(msg("compliance.source.sheetFormat")),
    confidence: "faible",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
  barLength: {
    id: "FAB_BARRE_LONGUEUR",
    ...sourceSpec(msg("compliance.source.barLength")),
    confidence: "moyen",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
  supportInStringer: {
    id: "FAB_SUPPORT_DANS_LIMON",
    ...WORKSHOP_SOURCE,
    confidence: "faible",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
  supportLength: {
    id: "FAB_SUPPORT_LONGUEUR_MIN",
    ...WORKSHOP_SOURCE,
    confidence: "faible",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
  treadCarried: {
    id: "FAB_MARCHE_PORTEE",
    ...sourceSpec(msg("compliance.source.treadCarried")),
    confidence: "eleve",
    nature: "metier",
    severity: "avertissement",
    unit: null,
  },
} as const satisfies Record<string, PluginRuleSpec>;

// ------------------------------------------------------------------ Perçages

/**
 * Perçage rond (polygone régulier inscrit à 24 côtés, CW : trou d'un `Shape2`) ou lumière
 * oblongue (longueur hors tout `slot` le long de `axis`), centré en `c`.
 */
export function holePolygon(c: Vec2, diameter: Mm, slot = 0, axis: Vec2 = V.vec(1, 0)): Vec2[] {
  const r = diameter / 2;
  const a = V.normalize(axis);
  const n = V.perpLeft(a);
  const half = Math.max(0, (slot - diameter) / 2);
  const pts: Vec2[] = [];
  const at = (along: Mm, t: number): Vec2 =>
    V.add(V.add(c, V.scale(a, along + r * Math.cos(t))), V.scale(n, r * Math.sin(t)));
  if (half <= 1e-9) {
    for (let i = 0; i < 24; i++) pts.push(at(0, (2 * Math.PI * i) / 24));
  } else {
    // Demi-cercle côté +a puis côté −a (parcours CCW dans le repère (a, n)).
    for (let i = 0; i <= 12; i++) pts.push(at(half, -Math.PI / 2 + (Math.PI * i) / 12));
    for (let i = 0; i <= 12; i++) pts.push(at(-half, Math.PI / 2 + (Math.PI * i) / 12));
  }
  return pts.reverse();
}

// ------------------------------------------------------------------ Pièces identiques

/** Tolérance de regroupement des pièces identiques (mm). */
export const IDENTICAL_TOLERANCE: Mm = 0.5;

interface Canon {
  readonly thickness: Mm;
  readonly material: string;
  readonly outer: readonly Vec2[];
  readonly holes: readonly (readonly Vec2[])[];
  readonly lines: readonly { a: Vec2; b: Vec2; key: string }[];
}

function canon(p: Part): Canon | null {
  const f = p.flat;
  if (!f) return null;
  return {
    thickness: f.thickness,
    material: p.material,
    outer: f.outline.outer,
    holes: f.outline.holes,
    lines: f.lines
      .filter((l) => l.kind === "bend")
      .map((l) => ({
        a: l.a,
        b: l.b,
        key: `${l.bendAngle ?? ""}|${l.bendUp ?? ""}|${l.bendRadius ?? ""}`,
      })),
  };
}

type Rigid = (p: Vec2) => Vec2;

function rigidFrom(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): Rigid | null {
  const da = V.sub(a1, a0);
  const db = V.sub(b1, b0);
  const la = V.norm(da);
  const lb = V.norm(db);
  if (la < 1e-9 || lb < 1e-9) return null;
  const ang = V.signedAngle(da, db);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return (p) => {
    const q = V.sub(p, a0);
    return V.add(b0, V.vec(c * q.x - s * q.y, s * q.x + c * q.y));
  };
}

function ringsMatch(a: readonly Vec2[], b: readonly Vec2[], T: Rigid, tol: Mm): boolean {
  if (a.length !== b.length) return false;
  const ta = a.map(T);
  const start = b.findIndex((q) => V.distance(q, ta[0]!) <= tol);
  if (start < 0) return false;
  for (let i = 0; i < ta.length; i++) {
    if (V.distance(ta[i]!, b[(start + i) % b.length]!) > tol) return false;
  }
  return true;
}

function sameUpToRigid(A: Canon, B: Canon, tol: Mm): boolean {
  if (Math.abs(A.thickness - B.thickness) > 1e-9 || A.material !== B.material) return false;
  const n = A.outer.length;
  if (n !== B.outer.length || A.holes.length !== B.holes.length) return false;
  if (A.lines.length !== B.lines.length || n < 2) return false;
  const a0 = A.outer[0]!;
  const a1 = A.outer[1]!;
  const la = V.distance(a0, a1);
  for (let j = 0; j < n; j++) {
    const b0 = B.outer[j]!;
    const b1 = B.outer[(j + 1) % n]!;
    if (Math.abs(V.distance(b0, b1) - la) > tol) continue;
    const T = rigidFrom(a0, a1, b0, b1);
    if (!T || !ringsMatch(A.outer, B.outer, T, tol)) continue;
    const holesOk = A.holes.every((h) => B.holes.some((g) => ringsMatch(h, g, T, tol)));
    if (!holesOk) continue;
    const linesOk = A.lines.every((l) => {
      const a = T(l.a);
      const b = T(l.b);
      return B.lines.some(
        (m) =>
          m.key === l.key &&
          ((V.distance(a, m.a) <= tol && V.distance(b, m.b) <= tol) ||
            (V.distance(a, m.b) <= tol && V.distance(b, m.a) <= tol)),
      );
    });
    if (linesOk) return true;
  }
  return false;
}

/**
 * Regroupe les pièces à développé identique (même épaisseur, matériau, contour, trous et lignes
 * de pli à `tol` près, à un déplacement plan près — sans retournement, qui inverserait le sens
 * des plis). Pièces sans développé : ignorées. Groupes dans l'ordre de première apparition.
 */
export function groupIdenticalFlats(
  parts: readonly Part[],
  tol: Mm = IDENTICAL_TOLERANCE,
): string[][] {
  const groups: { canon: Canon; ids: string[] }[] = [];
  for (const p of parts) {
    const c = canon(p);
    if (!c) continue;
    const g = groups.find((x) => sameUpToRigid(x.canon, c, tol));
    if (g) g.ids.push(p.id);
    else groups.push({ canon: c, ids: [p.id] });
  }
  return groups.map((g) => g.ids);
}

/**
 * Pièce déclarée assemblée aux pièces `ids` (`Part.assembledWith`, complété et symétrisé par le
 * pipeline). Sans identifiant : pièce rendue telle quelle.
 */
export function assembledTo(part: Part, ids: readonly string[]): Part {
  if (ids.length === 0) return part;
  const all = [...new Set([...(part.assembledWith ?? []), ...ids])];
  return { ...part, assembledWith: all };
}
