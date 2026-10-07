/**
 * Visserie du profil d'atelier (QUESTIONS A27, décision du 2026-10-06) : ce que le modèle ne
 * déduit pas des assemblages (type d'élément selon le support, classe ou matière, longueur,
 * cheville selon le mur, quantité par point de fixation, diamètre quand aucun perçage n'est
 * dimensionné), un réglage par assemblage d'origine (`FastenerJointKind`).
 *
 * **Aucune de ces valeurs n'est sourcée** (docs/research : « aucune règle chiffrée de cheville
 * trouvée », C §2.7 ; renvoi à l'ETE du fabricant) : toutes les valeurs par défaut sont des
 * hypothèses d'atelier **« à valider »** (◆ dans l'interface). Le projet peut porter un réglage
 * partiel (`Project.workshop.fasteners`, chemins `workshop.fasteners.joints.<assemblage>.<champ>`,
 * `workshop.fasteners.holeClearance`, `workshop.fasteners.nominalDiameters`,
 * `workshop.fasteners.bracketSpacing`, `workshop.fasteners.unknownWallLoadBearing`) : ses champs
 * remplacent ceux des défauts (`resolveFastenerProfile`).
 */
import { msg } from "@blondel/i18n";
import { z } from "zod";
import type { SettingProvenance } from "./profile.js";
import {
  FASTENER_GRADES,
  FASTENER_JOINTS,
  FASTENER_KINDS,
  type FastenerGrade,
  type FastenerJointKind,
  type FastenerKind,
} from "../model/fasteners.js";
import type { Mm } from "../model/primitives.js";

const mmPos = z.number().positive();
const mmNonNeg = z.number().nonnegative();

/** Réglage partiel d'un assemblage (tous les champs facultatifs). */
export const FastenerSettingInputSchema = z.object({
  /** Nature de l'élément (boulon, cheville…). */
  kind: z.enum(FASTENER_KINDS).optional(),
  /** Classe ou matière. */
  grade: z.enum(FASTENER_GRADES).optional(),
  /** Diamètre nominal (mm), quand l'assemblage n'a pas de perçage dimensionné. */
  diameter: mmPos.optional(),
  /** Longueur (mm). */
  length: mmPos.optional(),
  /**
   * Quantité par point de fixation : par perçage (platines, supports), par poteau de
   * garde-corps, par support de main courante murale.
   */
  perPoint: z.number().int().positive().optional(),
});
export type FastenerSettingInput = z.infer<typeof FastenerSettingInputSchema>;

/** Visserie partielle portée par un projet (`WorkshopProfileInput.fasteners`). */
export const FastenerProfileInputSchema = z.object({
  /**
   * Jeu de perçage minimal (mm) : diamètre nominal = plus grand diamètre de la série
   * (`nominalDiameters`) qui passe dans le perçage avec ce jeu (M12 dans 13 ou 14 mm).
   */
  holeClearance: mmNonNeg.optional(),
  /** Série des diamètres nominaux de la visserie (mm, M6 → 6), dans un ordre quelconque. */
  nominalDiameters: z.array(mmPos).min(1).optional(),
  /** Entraxe maximal des supports d'une main courante murale (mm). */
  bracketSpacing: mmPos.optional(),
  /**
   * Mur d'une main courante murale que le site ne décrit pas (mur imposé par le projet, sans mur
   * du site) : porteur (cheville `handrailWall`) ou cloison (`handrailPartition`).
   */
  unknownWallLoadBearing: z.boolean().optional(),
  /** Réglages par assemblage d'origine. */
  joints: z.partialRecord(z.enum(FASTENER_JOINTS), FastenerSettingInputSchema).optional(),
});
export type FastenerProfileInput = z.infer<typeof FastenerProfileInputSchema>;

/** Réglage complet d'un assemblage. */
export interface FastenerSetting {
  readonly kind: FastenerKind;
  readonly grade: FastenerGrade;
  readonly diameter: Mm;
  readonly length: Mm;
  readonly perPoint: number;
}

/** Champs d'un réglage d'assemblage (ordre d'affichage). */
export const FASTENER_SETTING_FIELDS = [
  "kind",
  "grade",
  "diameter",
  "length",
  "perPoint",
] as const satisfies readonly (keyof FastenerSetting)[];
export type FastenerSettingField = (typeof FASTENER_SETTING_FIELDS)[number];

/** Visserie complète du profil d'atelier (après fusion avec les défauts). */
export interface FastenerProfile {
  readonly holeClearance: Mm;
  /** Série des diamètres nominaux, croissante. */
  readonly nominalDiameters: readonly Mm[];
  readonly bracketSpacing: Mm;
  readonly unknownWallLoadBearing: boolean;
  readonly joints: Readonly<Record<FastenerJointKind, FastenerSetting>>;
}

/**
 * Défauts **« à valider »** (aucune source) : chevilles mécaniques zinguées au sol, au chevêtre
 * et au plancher ; boulons 8.8 entre pièces métal ; vis à bois sous les marches bois ; vis à
 * métaux M8 × 20 classe 8.8 sous les marches en tôle vissées (A31) ; tire-fonds
 * pour les poteaux de garde-corps posés sur un escalier bois, boulons 8.8 sur un escalier
 * métal ; chevilles pour cloison creuse sur une cloison, mur non décrit supposé porteur. Jeu de
 * perçage minimal 1 mm (perçages du cœur : 11 mm pour M10, 13 mm pour M12) ; série des
 * diamètres nominaux : premier choix des filetages métriques (M3 à M30), à valider faute de
 * source dans docs/research.
 */
export const DEFAULT_FASTENER_PROFILE: FastenerProfile = {
  holeClearance: 1,
  nominalDiameters: [3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 30],
  bracketSpacing: 1000,
  unknownWallLoadBearing: true,
  joints: {
    plateFloor: { kind: "anchor", grade: "zinc-plated", diameter: 12, length: 100, perPoint: 1 },
    plateTrimmer: { kind: "anchor", grade: "zinc-plated", diameter: 12, length: 100, perPoint: 1 },
    plateBolted: { kind: "bolt", grade: "8.8", diameter: 12, length: 100, perPoint: 1 },
    supportBolted: { kind: "bolt", grade: "8.8", diameter: 10, length: 30, perPoint: 1 },
    treadScrewed: {
      kind: "wood-screw",
      grade: "zinc-plated",
      diameter: 6,
      length: 30,
      perPoint: 1,
    },
    // Marche en tôle vissée sur son support (A31) : vis à métaux M8 × 20 classe 8.8 (diamètre
    // lu sur le perçage de 9 mm), une par perçage, écrou ou taraudage selon l'atelier.
    treadBolted: { kind: "machine-screw", grade: "8.8", diameter: 8, length: 20, perPoint: 1 },
    riserTrimmer: { kind: "anchor", grade: "zinc-plated", diameter: 10, length: 80, perPoint: 1 },
    guardPostFloor: { kind: "anchor", grade: "zinc-plated", diameter: 10, length: 80, perPoint: 4 },
    guardPostStair: {
      kind: "lag-screw",
      grade: "zinc-plated",
      diameter: 10,
      length: 80,
      perPoint: 4,
    },
    guardPostStairMetal: { kind: "bolt", grade: "8.8", diameter: 10, length: 40, perPoint: 4 },
    handrailWall: { kind: "anchor", grade: "zinc-plated", diameter: 8, length: 60, perPoint: 2 },
    handrailPartition: {
      kind: "hollow-wall-anchor",
      grade: "zinc-plated",
      diameter: 8,
      length: 60,
      perPoint: 2,
    },
  },
};

/** Visserie effective : défauts surchargés champ par champ par le réglage du projet. */
export function resolveFastenerProfile(input?: FastenerProfileInput): FastenerProfile {
  const d = DEFAULT_FASTENER_PROFILE;
  if (!input) return d;
  const joints = {} as Record<FastenerJointKind, FastenerSetting>;
  for (const j of FASTENER_JOINTS) {
    const over = input.joints?.[j];
    joints[j] = over ? { ...d.joints[j], ...stripUndefined(over) } : d.joints[j];
  }
  return {
    holeClearance: input.holeClearance ?? d.holeClearance,
    nominalDiameters: input.nominalDiameters
      ? [...new Set(input.nominalDiameters)].sort((a, b) => a - b)
      : d.nominalDiameters,
    bracketSpacing: input.bracketSpacing ?? d.bracketSpacing,
    unknownWallLoadBearing: input.unknownWallLoadBearing ?? d.unknownWallLoadBearing,
    joints,
  };
}

function stripUndefined(o: FastenerSettingInput): Partial<FastenerSetting> {
  const out: Partial<Record<keyof FastenerSetting, unknown>> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k as keyof FastenerSetting] = v;
  return out as Partial<FastenerSetting>;
}

/** Réglages de la visserie dont la provenance est déclarée (`FASTENER_PROVENANCE`). */
export type FastenerProvenanceKey =
  | "holeClearance"
  | "nominalDiameters"
  | "bracketSpacing"
  | "unknownWallLoadBearing"
  | FastenerSettingField;

/**
 * Provenance des réglages de visserie : **aucun n'est sourcé** (docs/research/C-structures.md
 * §2.7 et §3 : aucune règle chiffrée de cheville, renvoi à l'ETE du fabricant) ; toutes les
 * valeurs par défaut sont des hypothèses d'atelier « à valider » (◆ dans l'interface). Un
 * réglage d'assemblage (`joints.<assemblage>.<champ>`) a la provenance de son champ.
 */
export const FASTENER_PROVENANCE: Readonly<Record<FastenerProvenanceKey, SettingProvenance>> = {
  holeClearance: {
    status: "a-valider",
    note: msg("workshop.provenance.fasteners.holeClearance"),
  },
  nominalDiameters: {
    status: "a-valider",
    note: msg("workshop.provenance.fasteners.nominalDiameters"),
  },
  bracketSpacing: {
    status: "a-valider",
    note: msg("workshop.provenance.fasteners.bracketSpacing"),
  },
  unknownWallLoadBearing: {
    status: "a-valider",
    note: msg("workshop.provenance.fasteners.unknownWallLoadBearing"),
  },
  kind: { status: "a-valider", note: msg("workshop.provenance.fasteners.kind") },
  grade: { status: "a-valider", note: msg("workshop.provenance.fasteners.grade") },
  diameter: { status: "a-valider", note: msg("workshop.provenance.fasteners.diameter") },
  length: { status: "a-valider", note: msg("workshop.provenance.fasteners.length") },
  perPoint: { status: "a-valider", note: msg("workshop.provenance.fasteners.perPoint") },
};
