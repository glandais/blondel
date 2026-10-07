/**
 * Visserie (QUESTIONS A27, décision du 2026-10-06) : contrat des éléments de visserie du modèle
 * (`Model.fasteners`) et identifiants partagés par le cœur, le profil d'atelier, les exports et
 * l'interface.
 *
 * La visserie n'est pas une pièce (`Part`) : elle n'a ni solide ni développé. Chaque élément est
 * **déduit d'un assemblage que le modèle connaît déjà** (platine percée, support vissé, poteau,
 * main courante murale) ; aucune visserie n'est produite là où le modèle ne connaît pas
 * d'assemblage. Ce que le modèle ne déduit pas (type selon le support, classe, longueur,
 * cheville selon le mur, quantité par point de fixation, diamètre sans perçage dimensionné) vient
 * du profil d'atelier (`workshop/fasteners.ts`), valeurs par défaut **« à valider »**.
 */
import { msg, type Message, type MessageKey } from "@blondel/i18n";
import type { Mm } from "./primitives.js";

/** Natures d'éléments de visserie. */
export const FASTENER_KINDS = [
  "bolt",
  "machine-screw",
  "wood-screw",
  "lag-screw",
  "anchor",
  "chemical-anchor",
  "hollow-wall-anchor",
] as const;
export type FastenerKind = (typeof FASTENER_KINDS)[number];

/** Classes de qualité ou matières (classe des boulons ISO 898-1, inox ISO 3506, revêtement). */
export const FASTENER_GRADES = [
  "4.6",
  "8.8",
  "10.9",
  "A2-70",
  "A4-70",
  "zinc-plated",
  "hot-dip-galvanized",
] as const;
export type FastenerGrade = (typeof FASTENER_GRADES)[number];

/**
 * Assemblages d'origine de la visserie (un réglage du profil d'atelier par assemblage) :
 *
 * - `plateFloor` : platine (pied de limon, pied de poteau) fixée au sol ;
 * - `plateTrimmer` : platine de tête fixée au chevêtre (rive du plancher haut) ;
 * - `plateBolted` : platine d'about boulonnée entre deux pièces (limon ↔ poteau) ;
 * - `supportBolted` : support de marche vissé sur la joue du limon ou la face du poteau ;
 * - `treadScrewed` : marche bois vissée sur son support (perçages de l'aile horizontale) ;
 * - `treadBolted` : marche en tôle pliée vissée sur son support (QUESTIONS A31 : perçages de
 *   l'aile horizontale et du développé de la marche) ;
 * - `riserTrimmer` : contremarche d'arrivée en tôle pliée fixée au chevêtre ;
 * - `guardPostFloor` : poteau de garde-corps fixé au plancher (trémie) ;
 * - `guardPostStair` / `guardPostStairMetal` : poteau de garde-corps fixé sur l'escalier (rampant),
 *   selon le support : bois (limons, à défaut marches en bois) ou métal (QUESTIONS A27, « type
 *   de fixation selon le support ») ;
 * - `handrailWall` / `handrailPartition` : supports d'une main courante murale fixés à un mur
 *   porteur ou à une cloison (`Wall.loadBearing`).
 */
export const FASTENER_JOINTS = [
  "plateFloor",
  "plateTrimmer",
  "plateBolted",
  "supportBolted",
  "treadScrewed",
  "treadBolted",
  "riserTrimmer",
  "guardPostFloor",
  "guardPostStair",
  "guardPostStairMetal",
  "handrailWall",
  "handrailPartition",
] as const;
export type FastenerJointKind = (typeof FASTENER_JOINTS)[number];

/** Grandeurs d'un élément de visserie que le modèle déduit (les autres viennent du profil). */
export type FastenerDeducedField = "diameter" | "quantity";

/**
 * Élément de visserie d'un assemblage (`Model.fasteners`) : une entrée par assemblage d'origine
 * (une platine, un support, un poteau, une main courante), avec sa quantité.
 */
export interface Fastener {
  /** Identifiant stable dans le modèle (ex. `fastener-plateFloor-plate-foot-stringer-inner-1`). */
  readonly id: string;
  /**
   * Repère de nomenclature, identique pour des éléments identiques (même nature, classe,
   * diamètre et longueur), ex. `VS1`. Non traduit.
   */
  readonly mark: string;
  readonly kind: FastenerKind;
  readonly grade: FastenerGrade;
  /** Diamètre nominal (mm) : M12 → 12. */
  readonly diameter: Mm;
  /** Longueur (mm). */
  readonly length: Mm;
  /** Nombre d'éléments pour cet assemblage (entier > 0). */
  readonly quantity: number;
  /** Assemblage d'origine (réglage du profil d'atelier qui s'applique). */
  readonly joint: FastenerJointKind;
  /** Désignation complète (ex. « Boulon M12 × 100, classe 8.8 »), traduite à l'affichage. */
  readonly name: Message;
  /**
   * Assemblage d'origine décrit avec les repères des pièces (ex. « Platine de pied PF1 → sol »,
   * « Main courante MC2 : 4 supports → mur porteur »), traduit à l'affichage.
   */
  readonly origin: Message;
  /** Pièces de l'assemblage (identifiants de `Model.parts`, dans l'ordre du modèle). */
  readonly partIds: readonly string[];
  /**
   * Grandeurs déduites du modèle (diamètre lu sur le perçage, quantité = nombre de perçages) ;
   * toutes les autres viennent du profil d'atelier, valeurs « à valider ».
   */
  readonly deduced: readonly FastenerDeducedField[];
  /**
   * Main courante murale le long d'un mur que le site ne décrit pas (mur imposé par le projet,
   * sans mur du site) : porteur ou cloison selon le profil d'atelier
   * (`unknownWallLoadBearing`, « à valider »).
   */
  readonly unknownWall?: true;
}

const KIND_KEYS: Readonly<Record<FastenerKind, MessageKey>> = {
  bolt: "fastener.kind.bolt",
  "machine-screw": "fastener.kind.machineScrew",
  "wood-screw": "fastener.kind.woodScrew",
  "lag-screw": "fastener.kind.lagScrew",
  anchor: "fastener.kind.anchor",
  "chemical-anchor": "fastener.kind.chemicalAnchor",
  "hollow-wall-anchor": "fastener.kind.hollowWallAnchor",
};

const GRADE_KEYS: Readonly<Record<FastenerGrade, MessageKey>> = {
  "4.6": "fastener.grade.class46",
  "8.8": "fastener.grade.class88",
  "10.9": "fastener.grade.class109",
  "A2-70": "fastener.grade.a270",
  "A4-70": "fastener.grade.a470",
  "zinc-plated": "fastener.grade.zincPlated",
  "hot-dip-galvanized": "fastener.grade.hotDipGalvanized",
};

const JOINT_KEYS: Readonly<Record<FastenerJointKind, MessageKey>> = {
  plateFloor: "fastener.joint.plateFloor",
  plateTrimmer: "fastener.joint.plateTrimmer",
  plateBolted: "fastener.joint.plateBolted",
  supportBolted: "fastener.joint.supportBolted",
  treadScrewed: "fastener.joint.treadScrewed",
  treadBolted: "fastener.joint.treadBolted",
  riserTrimmer: "fastener.joint.riserTrimmer",
  guardPostFloor: "fastener.joint.guardPostFloor",
  guardPostStair: "fastener.joint.guardPostStair",
  guardPostStairMetal: "fastener.joint.guardPostStairMetal",
  handrailWall: "fastener.joint.handrailWall",
  handrailPartition: "fastener.joint.handrailPartition",
};

/** Nature d'un élément de visserie (« Boulon », « Cheville mécanique »). */
export function fastenerKindLabel(kind: FastenerKind): Message {
  return msg(KIND_KEYS[kind]);
}

/** Classe ou matière (« classe 8.8 », « acier zingué »). */
export function fastenerGradeLabel(grade: FastenerGrade): Message {
  return msg(GRADE_KEYS[grade]);
}

/** Assemblage d'origine (« Platine sur sol »), aussi titre du réglage du profil d'atelier. */
export function fastenerJointLabel(joint: FastenerJointKind): Message {
  return msg(JOINT_KEYS[joint]);
}

/**
 * Ligne de nomenclature de visserie : éléments de même repère (même nature, classe, diamètre et
 * longueur) réunis, quantités additionnées. Lue telle quelle par la nomenclature, la liste de
 * visserie CSV, le dossier PDF et le groupe « Visserie » du mode Fabrication (aucun calcul dans
 * l'interface).
 */
export interface FastenerLine {
  readonly mark: string;
  readonly kind: FastenerKind;
  readonly grade: FastenerGrade;
  readonly diameter: Mm;
  readonly length: Mm;
  /** Désignation (celle du premier élément du repère). */
  readonly name: Message;
  /** Quantité totale du repère. */
  readonly quantity: number;
  /** Assemblages d'origine distincts, dans l'ordre d'apparition. */
  readonly joints: readonly FastenerJointKind[];
  /** Éléments réunis (identifiants `Fastener.id`), dans l'ordre du modèle. */
  readonly fastenerIds: readonly string[];
  /** Pièces assemblées, distinctes, dans l'ordre d'apparition. */
  readonly partIds: readonly string[];
}

interface LineAccumulator {
  readonly first: Fastener;
  quantity: number;
  readonly joints: Set<FastenerJointKind>;
  readonly ids: string[];
  readonly parts: Set<string>;
}

/** Lignes de nomenclature de la visserie, par repère, dans l'ordre de première apparition. */
export function fastenerLines(fasteners: readonly Fastener[]): FastenerLine[] {
  const byMark = new Map<string, LineAccumulator>();
  for (const f of fasteners) {
    let g = byMark.get(f.mark);
    if (g === undefined) {
      g = { first: f, quantity: 0, joints: new Set(), ids: [], parts: new Set() };
      byMark.set(f.mark, g);
    }
    g.quantity += f.quantity;
    g.joints.add(f.joint);
    g.ids.push(f.id);
    for (const id of f.partIds) g.parts.add(id);
  }
  return [...byMark.values()].map(({ first, quantity, joints, ids, parts }) => ({
    mark: first.mark,
    kind: first.kind,
    grade: first.grade,
    diameter: first.diameter,
    length: first.length,
    name: first.name,
    quantity,
    joints: [...joints],
    fastenerIds: ids,
    partIds: [...parts],
  }));
}
