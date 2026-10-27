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
import { dec, msg, textMessage, type Message } from "@blondel/i18n";
import { WORKSHOP_DEFAULT_SOURCE, sourceSpec } from "../rules/sources.js";
import { signedArea } from "../geom2d/polygon.js";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import * as V from "../geom2d/vec.js";
import type { FlatPattern, MaterialId, Part, PartFixing } from "../model/derived.js";
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
  /**
   * Part de `buttWeld` faite des jarrets et onglets d'un limon coudé (décision K-Q2 de QUESTIONS
   * A41, sous-lot K2d : soudures bout à bout de continuité, application au jarret à valider),
   * nommée à part dans les raisons. Absent : 0 (autres plugins inchangés).
   */
  readonly crankedButtWeld?: Mm;
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
  // Jarrets et onglets du limon coudé (K-Q2) nommés à part ; la raison générale garde le reste.
  const cranked = Math.min(Math.max(0, input.crankedButtWeld ?? 0), input.buttWeld);
  const rest = input.buttWeld - cranked;
  if (rest > 1e-9)
    reasons.push(msg("structure.steel.exc.reason.buttWeld", { length: dec(rest, 0) }));
  if (cranked > 1e-9)
    reasons.push(msg("structure.steel.exc.reason.crankedButtWeld", { length: dec(cranked, 0) }));
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

/** Comparaison totale de chaînes, indépendante de la locale. */
export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Rangs de valeurs à `eps` près : valeurs triées, rang incrémenté seulement quand l'écart avec la
 * précédente dépasse `eps` (paquets de valeurs voisines). Clé de tri insensible au bruit
 * d'arrondi : deux valeurs égales au bruit près ont le même rang et sont départagées ensuite par
 * identifiant (convention des départages stables, F10 (7) et (11)).
 */
export function ranksWithin(values: readonly number[], eps: number): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i);
  const ranks = new Array<number>(values.length).fill(0);
  let rank = 0;
  order.forEach((o, k) => {
    if (k > 0 && o.v - order[k - 1]!.v > eps) rank++;
    ranks[o.i] = rank;
  });
  return ranks;
}

/**
 * Regroupe des pièces autour d'un représentant (décision F10 Q1a) : les pièces sont triées
 * (clé, puis mesures dans l'ordre lexicographique — chaque mesure par paquets de valeurs à
 * `GEOM_EPS` près, pour que le bruit d'arrondi ne décide pas de l'ordre —, puis identifiant) ;
 * la première pièce non
 * prise ouvre un groupe (l'ancre : en une dimension, la plus courte) qui prend toutes les pièces
 * de même clé dont **chaque** mesure est à au plus `tol` (+ `GEOM_EPS`) de celle de l'ancre.
 * Le résultat ne dépend pas de l'ordre d'entrée ; groupes rendus dans l'ordre de première
 * apparition dans `items`, membres dans l'ordre d'entrée. `tol` : tolérance d'identité du
 * profil d'atelier (`WorkshopProfile.identicalPartTolerance`).
 */
export function groupNearAnchor<X>(items: readonly X[], o: NearAnchorOptions<X>, tol: Mm): X[][] {
  return groupNearAnchorAnchored(items, o, tol).map((g) => g.members);
}

/** Clé, mesures et identifiant d'une pièce pour `groupNearAnchor`. */
export interface NearAnchorOptions<X> {
  readonly key: (x: X) => string;
  readonly measures: (x: X) => readonly number[];
  readonly id: (x: X) => string;
}

/**
 * `groupNearAnchor` avec l'ancre de chaque groupe (la pièce qui l'a ouvert : en une dimension,
 * la plus courte, départagée par identifiant), représentant du repère pour la recopie
 * (décision F10 Q3, `unifyMarkGroup`). Mêmes groupes, dans le même ordre.
 */
export function groupNearAnchorAnchored<X>(
  items: readonly X[],
  o: NearAnchorOptions<X>,
  tol: Mm,
): { anchor: X; members: X[] }[] {
  const rows = items.map((x, index) => ({
    x,
    index,
    key: o.key(x),
    m: o.measures(x),
    id: o.id(x),
  }));
  const dims = rows.reduce((n, r) => Math.max(n, r.m.length), 0);
  const ranks = Array.from({ length: dims }, (_, k) =>
    ranksWithin(
      rows.map((r) => r.m[k] ?? 0),
      GEOM_EPS,
    ),
  );
  const sorted = [...rows].sort((a, b) => {
    const k = cmpStr(a.key, b.key);
    if (k !== 0) return k;
    for (const r of ranks) {
      const d = r[a.index]! - r[b.index]!;
      if (d !== 0) return d;
    }
    return cmpStr(a.id, b.id) || a.index - b.index;
  });
  const lim = tol + GEOM_EPS;
  const taken = new Set<number>();
  const groups: { anchor: (typeof rows)[number]; g: typeof rows }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const anchor = sorted[i]!;
    if (taken.has(anchor.index)) continue;
    taken.add(anchor.index);
    const g = [anchor];
    for (let j = i + 1; j < sorted.length; j++) {
      const r = sorted[j]!;
      if (r.key !== anchor.key) break;
      if (taken.has(r.index)) continue;
      const n = Math.max(r.m.length, anchor.m.length);
      let near = true;
      for (let k = 0; k < n && near; k++)
        near = Math.abs((r.m[k] ?? 0) - (anchor.m[k] ?? 0)) <= lim;
      if (near) {
        taken.add(r.index);
        g.push(r);
      }
    }
    groups.push({ anchor, g: g.sort((a, b) => a.index - b.index) });
  }
  return groups
    .sort((a, b) => a.g[0]!.index - b.g[0]!.index)
    .map(({ anchor, g }) => ({ anchor: anchor.x, members: g.map((r) => r.x) }));
}

interface Canon {
  readonly thickness: Mm;
  readonly material: string;
  /**
   * Nature et texte de référence du développé (clé, sans ses paramètres, qui peuvent nommer la
   * pièce, son tronçon ou son repère) : une semelle plane et une semelle gauche (formée « à la
   * griffe ») de même développé ne partagent pas un repère. Le texte complet est commun au repère
   * par la recopie du représentant (décision F10 Q5).
   */
  readonly reference: string;
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
    reference: JSON.stringify([f.reference?.kind ?? null, f.reference?.description.key ?? null]),
    outer: f.outline.outer,
    holes: f.outline.holes,
    // Toutes les lignes tracées sauf le texte du repère (réécrit au repère de chaque membre) :
    // plis, traçages, roulages, joints. `unifyMarkGroup` recopie ces lignes du représentant :
    // deux pièces n'ont un même repère que si elles les portent toutes, à T près.
    lines: f.lines
      .filter((l) => l.kind !== "text")
      .map((l) => ({
        a: l.a,
        b: l.b,
        key: JSON.stringify([
          l.kind,
          l.bendAngle ?? null,
          l.bendUp ?? null,
          l.bendRadius ?? null,
          l.feature ?? null,
          l.depth ?? null,
          l.label ?? null,
        ]),
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
  if (A.reference !== B.reference) return false;
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

/** Aire nette d'un développé (contour moins trous), mm² : clé de tri des développés. */
function netFlatArea(c: Canon): number {
  return Math.abs(signedArea(c.outer)) - c.holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
}

/** Périmètre du contour d'un développé (mm) : échelle de la tolérance de bruit sur l'aire. */
function outerPerimeter(c: Canon): number {
  return c.outer.reduce((s, p, i) => s + V.distance(p, c.outer[(i + 1) % c.outer.length]!), 0);
}

/**
 * Regroupe les pièces à développé identique (même épaisseur, matériau, nature et clé du texte
 * de référence, contour, trous et lignes tracées — plis, traçages, roulages, joints, même
 * nature et mêmes attributs, texte du repère excepté — à `tol` près, à un déplacement plan
 * près — sans retournement, qui inverserait le sens des plis). Chaque pièce est comparée au premier membre de chaque groupe (l'ancre), dans un
 * ordre indépendant de celui du modèle (décision F10 Q1b) : aire nette croissante, puis
 * identifiant (aires égales à `GEOM_EPS` × périmètre près confondues, pour que l'ordre ne
 * dépende pas du bruit d'arrondi lié à la position de la pièce) ; l'ancre d'un groupe est donc
 * sa plus petite pièce. Écarts comparés à `tol` + `GEOM_EPS`, comme dans `groupNearAnchor`
 * (T = 0 réunit encore les pièces identiques au bruit près). Pièces sans développé :
 * ignorées. Groupes dans l'ordre de première apparition dans `parts`, membres dans l'ordre de
 * `parts`. `tol` : tolérance d'identité du profil d'atelier (`identicalPartTolerance`).
 */
export function groupIdenticalFlats(parts: readonly Part[], tol: Mm): string[][] {
  return groupIdenticalFlatsAnchored(parts, tol).map((g) => g.members);
}

/**
 * `groupIdenticalFlats` avec l'ancre de chaque groupe (identifiant de sa plus petite pièce par
 * l'aire nette, départagée par identifiant), représentant du repère pour la recopie (décision
 * F10 Q3, `unifyMarkGroup`). Mêmes groupes, dans le même ordre.
 */
export function groupIdenticalFlatsAnchored(
  parts: readonly Part[],
  tol: Mm,
): { anchor: string; members: string[] }[] {
  const rows: { canon: Canon; id: string; index: number; area: number }[] = [];
  parts.forEach((p, index) => {
    const c = canon(p);
    if (c) rows.push({ canon: c, id: p.id, index, area: netFlatArea(c) });
  });
  // Aires égales au bruit d'arrondi près (bruit qui dépend de la position de la pièce dans le
  // plan) : même rang, départage par identifiant. Tolérance : `GEOM_EPS` × plus grand périmètre.
  const areaEps = GEOM_EPS * rows.reduce((m, r) => Math.max(m, outerPerimeter(r.canon)), 1);
  const areaRank = ranksWithin(
    rows.map((r) => r.area),
    areaEps,
  );
  const ranked = rows.map((r, k) => ({ ...r, rank: areaRank[k]! }));
  ranked.sort((a, b) => a.rank - b.rank || cmpStr(a.id, b.id) || a.index - b.index);
  const lim = tol + GEOM_EPS;
  const groups: {
    canon: Canon;
    anchor: string;
    members: { id: string; index: number }[];
  }[] = [];
  for (const r of ranked) {
    const g = groups.find((x) => sameUpToRigid(x.canon, r.canon, lim));
    if (g) g.members.push(r);
    else groups.push({ canon: r.canon, anchor: r.id, members: [r] });
  }
  return groups
    .map((g) => ({ anchor: g.anchor, members: g.members.sort((a, b) => a.index - b.index) }))
    .sort((a, b) => a.members[0]!.index - b.members[0]!.index)
    .map((g) => ({ anchor: g.anchor, members: g.members.map((m) => m.id) }));
}

/**
 * Grandeurs d'assemblage d'une pièce (cordons de soudure faits en place, sur la pièce posée) :
 * gardées par chaque membre d'un repère lors de la recopie (`unifyMarkGroup`), pour que les
 * totaux de soudure (et la classe d'exécution qui en dépend) restent ceux de l'ouvrage. Deux
 * tronçons de semelle au développé identique peuvent porter des joints bout à bout différents.
 */
const ASSEMBLY_QUANTITIES: readonly string[] = [QUANTITY_WELD_MM, QUANTITY_BUTT_WELD_MM];

/**
 * Une ligne de débit par repère (décision F10 Q3) : chaque membre d'un groupe de repère reçoit
 * les cotes de débit du représentant `representative` — `stock` et `quantities` (copies, sauf
 * les grandeurs d'assemblage `weld_mm` et `butt_weld_mm`, gardées du membre), `flat` en entier
 * (contour, trous, lignes, texte de référence commun au repère, sans pièce porteuse : décision
 * Q5 ; textes « repère » au repère du membre), désignation commune `markName` (Q6) et positions
 * des perçages (`PartFixing.positions`, décision (27)) — et garde sa géométrie réelle
 * (`solid`), son identifiant, sa désignation propre (`name`, avec sa pièce porteuse), sa
 * section, ses fixations (hors positions) et ses assemblages. Le représentant est choisi par
 * l'appelant selon
 * l'ajustement de la famille (`markGroups` : plus petite par l'aire nette pour un développé,
 * plus courte pour une barre). Le représentant et le membre d'un groupe d'une pièce sont rendus
 * à l'identique (même objet, pour la mémoïsation) ; idempotente (en valeur). Ne lève jamais.
 */
export function unifyMarkGroup(members: readonly Part[], representative: Part): Part[] {
  if (members.length < 2) return [...members];
  return members.map((m) => unifyMember(m, representative));
}

function unifyMember(m: Part, r: Part): Part {
  if (m === r) return m;
  const flat = r.flat
    ? {
        ...r.flat,
        lines: r.flat.lines.map((l) =>
          l.kind === "text" ? { ...l, label: textMessage(m.mark) } : l,
        ),
      }
    : undefined;
  const quantities: Record<string, number> = { ...r.quantities };
  for (const k of ASSEMBLY_QUANTITIES) {
    const v = m.quantities[k];
    if (v !== undefined) quantities[k] = v;
    else delete quantities[k];
  }
  const fixings = m.fixings ? withRepresentativePositions(m.fixings, r.fixings ?? []) : undefined;
  return {
    ...m,
    quantities,
    ...(r.stock ? { stock: { ...r.stock } } : {}),
    ...(flat ? { flat } : {}),
    ...(fixings ? { fixings } : {}),
    ...(r.markName ? { markName: r.markName } : {}),
  };
}

/**
 * Positions des perçages du représentant (`PartFixing.positions`, décision F10 (27)) reportées
 * sur les fixations du membre : la pièce est percée d'après le plan de son repère. Fixations
 * appariées par assemblage, nombre de points, diamètre, régime et nombre de positions, dans
 * l'ordre ; le reste (pièces assemblées `with`, longueur) est gardé du membre. Sans fixation
 * appariée : positions du membre gardées.
 */
function withRepresentativePositions(
  mine: readonly PartFixing[],
  rep: readonly PartFixing[],
): PartFixing[] {
  const sig = (f: PartFixing): string =>
    `${f.joint}:${f.points}:${f.holeDiameter ?? "-"}:${f.distribution ?? "-"}:${f.positions?.length ?? "-"}`;
  const pool = new Map<string, PartFixing[]>();
  for (const f of rep) pool.set(sig(f), [...(pool.get(sig(f)) ?? []), f]);
  return mine.map((f) => {
    if (!f.positions) return f;
    const r = pool.get(sig(f))?.shift();
    return r?.positions ? { ...f, positions: [...r.positions] } : f;
  });
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
