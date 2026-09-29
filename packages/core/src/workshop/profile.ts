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
import { z } from "zod";
import type { MaterialId } from "../model/derived.js";
import type { Mm } from "../model/primitives.js";

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
});
export type WorkshopProfileInput = z.infer<typeof WorkshopProfileSchema>;

/** Profil d'atelier complet (après fusion avec le profil par défaut). */
export interface WorkshopProfile {
  readonly name: string;
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
}

export type WoodSettingKey = keyof WorkshopProfile["wood"];

/**
 * Profil par défaut. Toutes les valeurs sont **à valider** par un atelier pilote (LEDGER §2),
 * voir `WORKSHOP_PROVENANCE`.
 */
export const DEFAULT_WORKSHOP_PROFILE: WorkshopProfile = {
  name: "Profil par défaut (valeurs à valider)",
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
};

export interface SettingProvenance {
  /** `a-valider` : hypothèse d'atelier sans source ; `source` : valeur tirée de la recherche. */
  readonly status: "a-valider" | "source";
  readonly note: string;
}

/**
 * Provenance des valeurs du profil par défaut. Aucune valeur du profil n'est sourcée dans
 * docs/research (C-structures.md ne donne ni formats de débit, ni masses volumiques, ni jeux :
 * RC 10 du DTU 36.3 non lu) ; seule la borne basse de la profondeur d'encastrement l'est.
 */
export const WORKSHOP_PROVENANCE: Readonly<Record<WoodSettingKey, SettingProvenance>> = {
  thicknesses: { status: "a-valider", note: "Plateaux usuels du négoce, non sourcés." },
  widths: { status: "a-valider", note: "Largeurs de débit usuelles, non sourcées." },
  maxBoardLength: { status: "a-valider", note: "Longueur de plateau, non sourcée." },
  postSections: {
    status: "a-valider",
    note: "Sections de poteau non sourcées (C §1.9 cite un poteau fini de 90 à 100 mm, confiance faible).",
  },
  planingAllowance: { status: "a-valider", note: "Surcote de corroyage, non sourcée." },
  lengthAllowance: {
    status: "a-valider",
    note: "Surlongueur de débit (C §1.6 la cite comme paramètre, sans valeur).",
  },
  housingDepth: {
    status: "a-valider",
    note: "15 mm à valider ; borne basse sourcée : entaille ≥ 14 mm (NF EN 16481 § 5.4.2, C §1.4).",
  },
  clearance: {
    status: "a-valider",
    note: "Jeux d'assemblage du DTU 36.3 (RC 10) non trouvés en accès libre (C §1.1).",
  },
  minCheek: { status: "a-valider", note: "Joue mini d'atelier, non sourcée." },
  minPerpendicularWidth: {
    status: "a-valider",
    note: "Largeur perpendiculaire mini (CHALLENGE G6), sans valeur sourcée.",
  },
  minWoodBetweenHousings: {
    status: "a-valider",
    note: "Bois entre mortaises (CHALLENGE G6), sans valeur sourcée.",
  },
  minUpperOffset: {
    status: "a-valider",
    note: "Dépassement d_h (B §4.1 : « paramètre d'atelier »), sans valeur sourcée.",
  },
  densities: {
    status: "a-valider",
    note: "Aucune masse volumique dans docs/research : ordres de grandeur à valider.",
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
    name: input.name ?? d.name,
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
  };
}

/** Plus petite valeur disponible ≥ `need`, ou `null` (liste vide : `need` lui-même). */
export function smallestAvailable(available: readonly Mm[], need: Mm): Mm | null {
  if (available.length === 0) return need;
  let best: Mm | null = null;
  for (const v of available) if (v >= need - 1e-9 && (best === null || v < best)) best = v;
  return best;
}
