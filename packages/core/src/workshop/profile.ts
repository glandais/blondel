/**
 * Profil d'atelier (CHALLENGE A8 : barèmes et capacités séparés du projet).
 *
 * Le profil décrit ce que l'atelier sait débiter et usiner : épaisseurs et largeurs de débit
 * disponibles, longueur maximale de plateau, surcotes de corroyage, profondeur d'encastrement,
 * jeu d'assemblage, seuils de fabrication (largeur perpendiculaire, bois entre mortaises,
 * joues) et masses volumiques par essence.
 *
 * **Aucune de ces valeurs n'est une règle métier sourcée**, sauf mention contraire dans
 * `WORKSHOP_PROVENANCE` : les valeurs par défaut sont des hypothèses d'atelier **« à valider »**
 * (LEDGER §2). Un projet peut porter un profil partiel (`Project.workshop`) : ses champs
 * remplacent ceux du profil par défaut (`resolveWorkshopProfile`).
 */
import { msg, textMessage, type Message } from "@blondel/i18n";
import { z } from "zod";
import type { MaterialId } from "../model/derived.js";
import type { Mm } from "../model/primitives.js";
import {
  DEFAULT_METAL_PROFILE,
  MetalProfileInputSchema,
  resolveMetalProfile,
  type MetalProfile,
} from "./metal.js";
import { CostRatesSchema, type CostRates } from "./costs.js";

/** Essences de bois connues du modèle (`MaterialId` commençant par `wood-`). */
export const WOOD_MATERIALS = [
  "wood-oak",
  "wood-beech",
  "wood-ash",
  "wood-pine",
  "wood-glulam",
] as const satisfies readonly MaterialId[];
export type WoodMaterialId = (typeof WOOD_MATERIALS)[number];

export function isWoodMaterial(m: MaterialId): m is WoodMaterialId {
  return (WOOD_MATERIALS as readonly string[]).includes(m);
}

/** Aciers au carbone (masse volumique `metal.density` du profil). */
export const CARBON_STEEL_MATERIALS = [
  "steel-raw",
  "steel-painted",
  "steel-galvanized",
] as const satisfies readonly MaterialId[];

/**
 * Matériaux ni bois ni acier au carbone, dont la masse volumique est portée par
 * `WorkshopProfile.densities` (QUESTIONS A6 : masse renseignée pour toutes les pièces).
 */
export const OTHER_MATERIALS = [
  "stainless-brushed",
  "glass",
  "concrete",
] as const satisfies readonly MaterialId[];
export type OtherMaterialId = (typeof OTHER_MATERIALS)[number];

const mmPos = z.number().positive();
const mmNonNeg = z.number().nonnegative();

/**
 * Profil d'atelier **partiel** porté par un projet (tous les champs facultatifs, aucune valeur
 * injectée à l'analyse : un projet sans profil reste identique après sérialisation).
 */
export const WorkshopProfileSchema = z.object({
  /** Nom du profil (affichage). */
  name: z.string().optional(),
  wood: z
    .object({
      /** Épaisseurs de débit brutes disponibles (plateaux), mm. */
      thicknesses: z.array(mmPos).optional(),
      /** Largeurs de débit brutes disponibles, mm ; liste vide = largeur quelconque. */
      widths: z.array(mmPos).optional(),
      /** Longueur maximale d'un plateau, mm. */
      maxBoardLength: mmPos.optional(),
      /** Sections carrées brutes disponibles pour les poteaux (côté), mm ; vide = quelconque. */
      postSections: z.array(mmPos).optional(),
      /** Surcote de corroyage (brut − fini) sur l'épaisseur et la largeur, mm. */
      planingAllowance: mmNonNeg.optional(),
      /** Surlongueur de débit (brut − fini), mm. */
      lengthAllowance: mmNonNeg.optional(),
      /** Profondeur d'encastrement des marches et contremarches dans les limons, mm. */
      housingDepth: mmPos.optional(),
      /** Jeu d'assemblage (mortaises, encastrements), mm. */
      clearance: mmNonNeg.optional(),
      /** Joue mini : bois entre un encastrement et la rive ou l'extrémité du limon, mm. */
      minCheek: mmNonNeg.optional(),
      /** Largeur mini d'un limon mesurée perpendiculairement à ses rives, mm. */
      minPerpendicularWidth: mmNonNeg.optional(),
      /** Bois mini entre deux encastrements de marche successifs, mm. */
      minWoodBetweenHousings: mmNonNeg.optional(),
      /** Dépassement mini de la rive haute au-dessus de la ligne des nez, mm. */
      minUpperOffset: mmNonNeg.optional(),
      /** Masses volumiques par essence, kg/m³. */
      densities: z.partialRecord(z.enum(WOOD_MATERIALS), mmPos).optional(),
    })
    .optional(),
  /** Capacités métal (presse plieuse, lois de pli, formats, laser, masse volumique) : `metal.ts`. */
  metal: MetalProfileInputSchema.optional(),
  /**
   * Masses volumiques (kg/m³) des matériaux ni bois ni acier au carbone : inox, verre, béton
   * (QUESTIONS A6). Ajout rétrocompatible ; absent : défauts « à valider ».
   */
  densities: z.partialRecord(z.enum(OTHER_MATERIALS), mmPos).optional(),
  /**
   * Barème de coût (taux horaire, temps unitaires, prix matière) : `costs.ts`, aucun défaut ;
   * absent ou incomplet : pas de chiffrage en euros (CHALLENGE P2).
   */
  costs: CostRatesSchema.optional(),
});
export type WorkshopProfileInput = z.infer<typeof WorkshopProfileSchema>;

/** Profil d'atelier complet (après fusion avec le profil par défaut). */
export interface WorkshopProfile {
  /** Nom du profil : saisi (texte brut) ou nom du profil par défaut (traduit). */
  readonly name: Message;
  readonly wood: {
    readonly thicknesses: readonly Mm[];
    readonly widths: readonly Mm[];
    readonly maxBoardLength: Mm;
    readonly postSections: readonly Mm[];
    readonly planingAllowance: Mm;
    readonly lengthAllowance: Mm;
    readonly housingDepth: Mm;
    readonly clearance: Mm;
    readonly minCheek: Mm;
    readonly minPerpendicularWidth: Mm;
    readonly minWoodBetweenHousings: Mm;
    readonly minUpperOffset: Mm;
    readonly densities: Readonly<Record<WoodMaterialId, number>>;
  };
  /** Capacités métal (jalon 3b), voir `metal.ts` et `METAL_PROVENANCE`. */
  readonly metal: MetalProfile;
  /** Masses volumiques des autres matériaux (kg/m³), voir `OTHER_DENSITY_PROVENANCE`. */
  readonly densities: Readonly<Record<OtherMaterialId, number>>;
  /** Barème de coût (jalon 3c) : champs absents = non renseignés (aucun défaut). */
  readonly costs: CostRates;
}

export type WoodSettingKey = keyof WorkshopProfile["wood"];

/**
 * Profil par défaut. Toutes les valeurs sont **à valider** par un atelier pilote (LEDGER §2),
 * voir `WORKSHOP_PROVENANCE`.
 */
export const DEFAULT_WORKSHOP_PROFILE: WorkshopProfile = {
  name: msg("workshop.defaultProfileName"),
  wood: {
    thicknesses: [27, 34, 41, 54, 65, 80],
    widths: [150, 200, 250, 300, 350, 400, 450, 500],
    maxBoardLength: 4000,
    postSections: [80, 100, 120, 150],
    planingAllowance: 5,
    lengthAllowance: 20,
    housingDepth: 15,
    clearance: 1,
    minCheek: 20,
    minPerpendicularWidth: 150,
    minWoodBetweenHousings: 30,
    minUpperOffset: 50,
    densities: {
      "wood-oak": 700,
      "wood-beech": 700,
      "wood-ash": 700,
      "wood-pine": 500,
      "wood-glulam": 450,
    },
  },
  metal: DEFAULT_METAL_PROFILE,
  densities: {
    "stainless-brushed": 7900,
    glass: 2500,
    concrete: 2400,
  },
  costs: {},
};

/**
 * Provenance des masses volumiques hors bois et acier au carbone : aucune n'est sourcée dans
 * docs/research ; ordres de grandeur usuels **à valider** (QUESTIONS A6, LEDGER §2).
 */
export const OTHER_DENSITY_PROVENANCE: Readonly<Record<OtherMaterialId, SettingProvenance>> = {
  "stainless-brushed": {
    status: "a-valider",
    note: msg("workshop.provenance.density.stainlessBrushed"),
  },
  glass: {
    status: "a-valider",
    note: msg("workshop.provenance.density.glass"),
  },
  concrete: {
    status: "a-valider",
    note: msg("workshop.provenance.density.concrete"),
  },
};

/**
 * Masse volumique (kg/m³) d'un matériau selon le profil d'atelier : essences de bois
 * (`wood.densities`), aciers au carbone (`metal.density`), autres matériaux (`densities`).
 * Toutes ces valeurs sont « à valider » dans le profil par défaut.
 */
export function materialDensity(material: MaterialId, profile: WorkshopProfile): number {
  if (isWoodMaterial(material)) return profile.wood.densities[material];
  if ((CARBON_STEEL_MATERIALS as readonly string[]).includes(material))
    return profile.metal.density;
  return profile.densities[material as OtherMaterialId];
}

export interface SettingProvenance {
  /** `a-valider` : hypothèse d'atelier sans source ; `source` : valeur tirée de la recherche. */
  readonly status: "a-valider" | "source";
  readonly note: Message;
}

/**
 * Provenance des valeurs du profil par défaut. Aucune valeur du profil n'est sourcée dans
 * docs/research (C-structures.md ne donne ni formats de débit, ni masses volumiques, ni jeux :
 * RC 10 du DTU 36.3 non lu) ; seule la borne basse de la profondeur d'encastrement l'est.
 */
export const WORKSHOP_PROVENANCE: Readonly<Record<WoodSettingKey, SettingProvenance>> = {
  thicknesses: { status: "a-valider", note: msg("workshop.provenance.wood.thicknesses") },
  widths: { status: "a-valider", note: msg("workshop.provenance.wood.widths") },
  maxBoardLength: { status: "a-valider", note: msg("workshop.provenance.wood.maxBoardLength") },
  postSections: {
    status: "a-valider",
    note: msg("workshop.provenance.wood.postSections"),
  },
  planingAllowance: { status: "a-valider", note: msg("workshop.provenance.wood.planingAllowance") },
  lengthAllowance: {
    status: "a-valider",
    note: msg("workshop.provenance.wood.lengthAllowance"),
  },
  housingDepth: {
    status: "a-valider",
    note: msg("workshop.provenance.wood.housingDepth"),
  },
  clearance: {
    status: "a-valider",
    note: msg("workshop.provenance.wood.clearance"),
  },
  minCheek: { status: "a-valider", note: msg("workshop.provenance.wood.minCheek") },
  minPerpendicularWidth: {
    status: "a-valider",
    note: msg("workshop.provenance.wood.minPerpendicularWidth"),
  },
  minWoodBetweenHousings: {
    status: "a-valider",
    note: msg("workshop.provenance.wood.minWoodBetweenHousings"),
  },
  minUpperOffset: {
    status: "a-valider",
    note: msg("workshop.provenance.wood.minUpperOffset"),
  },
  densities: {
    status: "a-valider",
    note: msg("workshop.provenance.wood.densities"),
  },
};

/** Profil effectif d'un projet : profil par défaut surchargé champ par champ. */
export function resolveWorkshopProfile(input?: WorkshopProfileInput): WorkshopProfile {
  const d = DEFAULT_WORKSHOP_PROFILE;
  if (!input) return d;
  const w = input.wood ?? {};
  const pick = <K extends Exclude<WoodSettingKey, "densities">>(k: K): WorkshopProfile["wood"][K] =>
    (w[k] ?? d.wood[k]) as WorkshopProfile["wood"][K];
  return {
    name: input.name !== undefined ? textMessage(input.name) : d.name,
    wood: {
      thicknesses: pick("thicknesses"),
      widths: pick("widths"),
      maxBoardLength: pick("maxBoardLength"),
      postSections: pick("postSections"),
      planingAllowance: pick("planingAllowance"),
      lengthAllowance: pick("lengthAllowance"),
      housingDepth: pick("housingDepth"),
      clearance: pick("clearance"),
      minCheek: pick("minCheek"),
      minPerpendicularWidth: pick("minPerpendicularWidth"),
      minWoodBetweenHousings: pick("minWoodBetweenHousings"),
      minUpperOffset: pick("minUpperOffset"),
      densities: { ...d.wood.densities, ...(w.densities ?? {}) },
    },
    metal: resolveMetalProfile(input.metal),
    densities: { ...d.densities, ...(input.densities ?? {}) },
    costs: input.costs ?? d.costs,
  };
}

/** Plus petite valeur disponible ≥ `need`, ou `null` (liste vide : `need` lui-même). */
export function smallestAvailable(available: readonly Mm[], need: Mm): Mm | null {
  if (available.length === 0) return need;
  let best: Mm | null = null;
  for (const v of available) if (v >= need - 1e-9 && (best === null || v < best)) best = v;
  return best;
}
