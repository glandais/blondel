/**
 * Capacités métal du profil d'atelier (C §2, §4.1, §4.3 ; CHALLENGE G5, SPEC §2.4 « tables de
 * capacités par atelier, pas des constantes »).
 *
 * - **Presse plieuse** : longueur de pli et épaisseur maximales (C-M-04 : 2 980 mm et 8 mm chez
 *   un sous-traitant en ligne [18], valeurs d'exemple).
 * - **Lois de pli** (CHALLENGE G5) : pour une nuance et une épaisseur, l'outillage (rayon
 *   intérieur r_int, aile mini L_int) et la méthode de calcul du développé :
 *   - `kFactor` : fibre neutre à k·t de la face intérieure, k saisi ;
 *   - `din6935` : **norme étrangère (DIN 6935, non lue)**, facteur de correction
 *     k_DIN = 0,65 + 0,5·log10(r/t) si r/t < 5, sinon 1, appliqué à t/2 : la fibre neutre est à
 *     k_DIN·t/2 de la face intérieure, soit un facteur K équivalent **k_DIN / 2** ;
 *   - `table` : déduction de pli mesurée à 90° (BD₉₀, table de l'atelier) ; on en déduit le
 *     facteur K équivalent : BA₉₀ = 2·(r + t) − BD₉₀, K = (BA₉₀ / (π/2) − r) / t, appliqué à
 *     tous les angles.
 *   Longueur de pli (bend allowance) d'un pli d'angle θ : BA = θ·(r + K·t) ; retrait extérieur
 *   (outside setback) : (r + t)·tan(θ/2).
 * - **Formats de tôle**, **longueurs de barres**, **découpe laser** (épaisseur maximale) et
 *   **masse volumique** de l'acier.
 *
 * Les valeurs par défaut sont des **valeurs d'exemple** tirées de docs/research quand elles y
 * figurent (confiance moyenne, machines d'un sous-traitant), sinon des hypothèses **à valider**
 * (LEDGER §2) ; voir `METAL_PROVENANCE`.
 */
import { MessageError, msg, type Message } from "@blondel/i18n";
import { z } from "zod";
import type { Mm } from "../model/primitives.js";

/** Nuances d'acier connues (EN 10025-2). */
export const STEEL_GRADES = ["S235", "S355"] as const;
export type SteelGrade = (typeof STEEL_GRADES)[number];

export const BEND_METHODS = ["kFactor", "din6935", "table"] as const;
export type BendMethod = (typeof BEND_METHODS)[number];

const pos = z.number().positive();
const nonNeg = z.number().nonnegative();

/** Loi de pli d'une épaisseur (outillage + méthode de calcul du développé). */
export const BendLawSchema = z.object({
  /** Nuance concernée ; `any` : toute nuance sans loi propre. */
  grade: z.enum([...STEEL_GRADES, "any"]).default("any"),
  /** Épaisseur de tôle t (mm). */
  thickness: pos,
  /** Rayon intérieur obtenu avec l'outillage (mm). */
  innerRadius: pos,
  /** Longueur intérieure d'aile minimale L_int (mm). */
  minFlange: nonNeg,
  method: z.enum(BEND_METHODS).default("kFactor"),
  /** Facteur K (méthode `kFactor`), 0 ≤ K ≤ 1. Absent : `defaultK` du profil. */
  k: z.number().min(0).max(1).optional(),
  /** Déduction de pli à 90° mesurée (méthode `table`), mm. */
  deduction90: z.number().optional(),
});
export type BendLaw = z.output<typeof BendLawSchema>;

export const SheetFormatSchema = z.object({ length: pos, width: pos });
export type SheetFormat = z.output<typeof SheetFormatSchema>;

/** Familles de profilés ouverts concernées par les capacités de cintrage (C §2.3 [15]). */
export const BENDING_FAMILIES = ["UPN", "IPN", "IPE", "HEA"] as const;
/**
 * Sens de cintrage d'un profilé (C §2.3 [15]) : `edge` = sur chant (dans le plan de l'âme),
 * `flangeIn` / `flangeOut` = U cintré ailes vers l'intérieur / l'extérieur de la courbe,
 * `flat` = I cintré à plat (autour de l'axe de l'âme).
 */
export const BENDING_DIRECTIONS = ["edge", "flangeIn", "flangeOut", "flat"] as const;

/** Capacité de cintrage : rayon minimal pour une famille, un sens et une hauteur maximale. */
export const ProfileBendingSchema = z.object({
  families: z.array(z.enum(BENDING_FAMILIES)).min(1),
  direction: z.enum(BENDING_DIRECTIONS),
  /** Hauteur maximale de section (mm) de la ligne de capacité. */
  maxHeight: pos,
  /** Rayon minimal (mm), donné pour la section maximale (C §2.3 : « indicatif »). */
  minRadius: pos,
});
export type ProfileBending = z.output<typeof ProfileBendingSchema>;

/** Partie métal (partielle) du profil d'atelier d'un projet. */
export const MetalProfileInputSchema = z.object({
  /** Masse volumique de l'acier, kg/m³. */
  density: pos.optional(),
  pressBrake: z.object({ maxLength: pos.optional(), maxThickness: pos.optional() }).optional(),
  laser: z.object({ maxThickness: pos.optional() }).optional(),
  /** Formats de tôle disponibles (L × l, mm). */
  sheetFormats: z.array(SheetFormatSchema).optional(),
  /** Longueurs de barres du commerce (profilés, cornières, tubes), mm. */
  barLengths: z.array(pos).optional(),
  /** Lois de pli par nuance et épaisseur (remplacent la liste par défaut). */
  bendLaws: z.array(BendLawSchema).optional(),
  /** Facteur K des lois `kFactor` sans k propre. */
  defaultK: z.number().min(0).max(1).optional(),
  /** Capacités de cintrage des profilés (remplacent la liste par défaut). */
  profileBending: z.array(ProfileBendingSchema).optional(),
  /** Trait de scie (débit des barres), mm. */
  sawKerf: nonNeg.optional(),
  /**
   * Rouleuse à tôle (limon débillardé soudé, jalon 5b, C §2.4) : rayon intérieur minimal de
   * roulage, longueur utile des rouleaux, épaisseur maximale roulée.
   */
  plateRolling: z
    .object({
      minInnerRadius: pos.optional(),
      rollLength: pos.optional(),
      maxThickness: pos.optional(),
    })
    .optional(),
});
export type MetalProfileInput = z.input<typeof MetalProfileInputSchema>;

export interface MetalProfile {
  readonly density: number;
  readonly pressBrake: { readonly maxLength: Mm; readonly maxThickness: Mm };
  readonly laser: { readonly maxThickness: Mm };
  readonly sheetFormats: readonly SheetFormat[];
  readonly barLengths: readonly Mm[];
  readonly bendLaws: readonly BendLaw[];
  readonly defaultK: number;
  /** Capacités de cintrage des profilés (jalon 3c). */
  readonly profileBending: readonly ProfileBending[];
  /** Trait de scie pour le débit des barres (jalon 3c), mm. */
  readonly sawKerf: Mm;
  /** Rouleuse à tôle (jalon 5b) : voir `DEFAULT_PLATE_ROLLING`. */
  readonly plateRolling: PlateRolling;
}

/**
 * Capacités de la rouleuse à tôle (C §2.4, [16]) : la capacité d'une rouleuse se définit pour
 * une largeur de tôle égale à la longueur des rouleaux et un diamètre de cintrage ≥ 1,3 × D du
 * rouleau supérieur (r_min ≈ 0,65 D). Blondel contrôle le **rayon intérieur** de la tôle roulée
 * (face concave), l'étendue du développé le long des génératrices (≤ longueur des rouleaux) et
 * l'épaisseur.
 */
export interface PlateRolling {
  /** Rayon intérieur minimal de roulage (face concave), mm. */
  readonly minInnerRadius: Mm;
  /** Longueur utile des rouleaux : étendue maximale de la tôle le long des génératrices, mm. */
  readonly rollLength: Mm;
  /** Épaisseur maximale roulée, mm. */
  readonly maxThickness: Mm;
}

/**
 * Rouleuse par défaut : **valeurs non sourcées, à valider** (C §2.4 ne donne que des rapports :
 * r_min ≈ 0,65 × Ø du rouleau supérieur ; aucun diamètre ni longueur de rouleaux). 150 mm de
 * rayon intérieur (rouleau supérieur ≈ Ø 230), 2 000 mm de rouleaux, 12 mm d'épaisseur.
 */
export const DEFAULT_PLATE_ROLLING: PlateRolling = {
  minInnerRadius: 150,
  rollLength: 2000,
  maxThickness: 12,
};

/**
 * Capacités de cintrage relevées chez un cintreur français (C §2.3 [15], confiance moyenne,
 * « indicatives et propres aux machines », rayons donnés pour la section maximale de chaque
 * ligne). Aucune donnée pour les HEA : pas de ligne (cintrage « à valider chez le cintreur »).
 */
const DEFAULT_PROFILE_BENDING: readonly ProfileBending[] = [
  { families: ["UPN"], direction: "edge", maxHeight: 160, minRadius: 200 },
  { families: ["UPN"], direction: "flangeIn", maxHeight: 260, minRadius: 650 },
  { families: ["UPN"], direction: "flangeOut", maxHeight: 260, minRadius: 500 },
  { families: ["IPN", "IPE"], direction: "edge", maxHeight: 180, minRadius: 1400 },
  { families: ["IPN", "IPE"], direction: "flat", maxHeight: 260, minRadius: 650 },
];

/** Trait de scie par défaut : 3 mm, **non sourcé, à valider**. */
export const DEFAULT_SAW_KERF: Mm = 3;

/**
 * Tableau « valeurs classiques » des plieurs pour un acier Rm 40–45 daN/mm² (C §2.6 [17],
 * confiance moyenne, relu) : épaisseur → rayon intérieur / longueur intérieure d'aile mini.
 */
const CLASSIC_BEND_TABLE: readonly (readonly [Mm, Mm, Mm])[] = [
  [1, 1.3, 4.5],
  [2, 2.6, 9],
  [3, 4.0, 14.5],
  [4, 5.0, 18],
  [5, 6.5, 23],
  [6, 8, 29],
  [8, 10, 37],
  [10, 13, 45],
];

/**
 * Facteur K par défaut : **0,33, valeur non sourcée, à valider** par un plieur pilote
 * (CHALLENGE G5, LEDGER §2 « loi de pli »). À titre de comparaison, DIN 6935 donne pour
 * r/t = 1,3 un K équivalent de 0,35.
 */
export const DEFAULT_K_FACTOR = 0.33;

export const DEFAULT_METAL_PROFILE: MetalProfile = {
  density: 7850,
  pressBrake: { maxLength: 2980, maxThickness: 8 },
  laser: { maxThickness: 20 },
  sheetFormats: [
    { length: 3000, width: 1500 },
    { length: 4000, width: 2000 },
    { length: 6000, width: 2000 },
  ],
  barLengths: [6000, 12000],
  bendLaws: CLASSIC_BEND_TABLE.map(([thickness, innerRadius, minFlange]) => ({
    grade: "any" as const,
    thickness,
    innerRadius,
    minFlange,
    method: "kFactor" as const,
  })),
  defaultK: DEFAULT_K_FACTOR,
  profileBending: DEFAULT_PROFILE_BENDING,
  sawKerf: DEFAULT_SAW_KERF,
  plateRolling: DEFAULT_PLATE_ROLLING,
};

export type MetalSettingKey = keyof MetalProfile;

export interface MetalProvenance {
  readonly status: "a-valider" | "source";
  readonly note: Message;
}

export const METAL_PROVENANCE: Readonly<Record<MetalSettingKey, MetalProvenance>> = {
  density: {
    status: "a-valider",
    note: msg("workshop.provenance.metal.density"),
  },
  pressBrake: {
    status: "source",
    note: msg("workshop.provenance.metal.pressBrake"),
  },
  laser: {
    status: "a-valider",
    note: msg("workshop.provenance.metal.laser"),
  },
  sheetFormats: {
    status: "a-valider",
    note: msg("workshop.provenance.metal.sheetFormats"),
  },
  barLengths: {
    status: "source",
    note: msg("workshop.provenance.metal.barLengths"),
  },
  bendLaws: {
    status: "source",
    note: msg("workshop.provenance.metal.bendLaws"),
  },
  defaultK: {
    status: "a-valider",
    note: msg("workshop.provenance.metal.defaultK"),
  },
  profileBending: {
    status: "source",
    note: msg("workshop.provenance.metal.profileBending"),
  },
  sawKerf: {
    status: "a-valider",
    note: msg("workshop.provenance.metal.sawKerf"),
  },
  plateRolling: {
    status: "a-valider",
    note: msg("workshop.provenance.metal.plateRolling"),
  },
};

/** Profil métal effectif : défauts surchargés champ par champ (listes remplacées en bloc). */
export function resolveMetalProfile(
  input?: z.output<typeof MetalProfileInputSchema>,
): MetalProfile {
  const d = DEFAULT_METAL_PROFILE;
  if (!input) return d;
  return {
    density: input.density ?? d.density,
    pressBrake: {
      maxLength: input.pressBrake?.maxLength ?? d.pressBrake.maxLength,
      maxThickness: input.pressBrake?.maxThickness ?? d.pressBrake.maxThickness,
    },
    laser: { maxThickness: input.laser?.maxThickness ?? d.laser.maxThickness },
    sheetFormats: input.sheetFormats ?? d.sheetFormats,
    barLengths: input.barLengths ?? d.barLengths,
    bendLaws: input.bendLaws ?? d.bendLaws,
    defaultK: input.defaultK ?? d.defaultK,
    profileBending: input.profileBending ?? d.profileBending,
    sawKerf: input.sawKerf ?? d.sawKerf,
    plateRolling: {
      minInnerRadius: input.plateRolling?.minInnerRadius ?? d.plateRolling.minInnerRadius,
      rollLength: input.plateRolling?.rollLength ?? d.plateRolling.rollLength,
      maxThickness: input.plateRolling?.maxThickness ?? d.plateRolling.maxThickness,
    },
  };
}

// ------------------------------------------------------------------ Loi de pli

/** Loi de pli d'une nuance et d'une épaisseur (loi propre à la nuance, sinon `any`), ou `null`. */
export function findBendLaw(
  profile: MetalProfile,
  grade: SteelGrade,
  thickness: Mm,
): BendLaw | null {
  const same = (l: BendLaw): boolean => Math.abs(l.thickness - thickness) <= 1e-6;
  return (
    profile.bendLaws.find((l) => l.grade === grade && same(l)) ??
    profile.bendLaws.find((l) => l.grade === "any" && same(l)) ??
    null
  );
}

/**
 * Facteur de correction de la DIN 6935 (norme étrangère, non lue) : k = 0,65 + 0,5·log10(r/t)
 * si r/t < 5, sinon 1. Il s'applique à t/2 (fibre neutre à k·t/2 de la face intérieure).
 */
export function din6935Correction(innerRadius: Mm, thickness: Mm): number {
  const ratio = innerRadius / thickness;
  return ratio < 5 ? 0.65 + 0.5 * Math.log10(ratio) : 1;
}

/** Longueur de pli (bend allowance) d'un pli d'angle θ (rad) : θ·(r + K·t). */
export function bendAllowance(angle: number, innerRadius: Mm, k: number, thickness: Mm): Mm {
  return angle * (innerRadius + k * thickness);
}

/** Retrait extérieur (outside setback) d'un pli d'angle θ (rad) : (r + t)·tan(θ/2). */
export function outsideSetback(angle: number, innerRadius: Mm, thickness: Mm): Mm {
  return (innerRadius + thickness) * Math.tan(angle / 2);
}

/** Paramètres de pli résolus : rayon intérieur, facteur K équivalent, aile mini. */
export interface ResolvedBend {
  readonly thickness: Mm;
  readonly innerRadius: Mm;
  readonly k: number;
  readonly minFlange: Mm;
  readonly method: BendMethod;
}

/**
 * Facteur K équivalent d'une loi de pli (voir l'en-tête du module). Lève une `MessageError` si
 * la loi est incomplète ou si K sort de [0 ; 1].
 */
export function resolveBend(law: BendLaw, defaultK: number): ResolvedBend {
  const t = law.thickness;
  const r = law.innerRadius;
  let k: number;
  switch (law.method) {
    case "kFactor":
      k = law.k ?? defaultK;
      break;
    case "din6935":
      k = din6935Correction(r, t) / 2;
      break;
    case "table": {
      if (law.deduction90 === undefined) {
        throw new MessageError(msg("workshop.bend.missingDeduction", { thickness: String(t) }));
      }
      const ba90 = 2 * (r + t) - law.deduction90;
      k = (ba90 / (Math.PI / 2) - r) / t;
      break;
    }
  }
  if (!(k >= 0 && k <= 1)) {
    throw new MessageError(
      msg("workshop.bend.kOutOfRange", { thickness: String(t), method: law.method, k: String(k) }),
    );
  }
  return { thickness: t, innerRadius: r, k, minFlange: law.minFlange, method: law.method };
}

/**
 * Rayon intérieur minimal de la règle C-M-02 (C §2.6, §4.1 [17][19], USAGE) : r_int ≥ t en
 * S235, ≥ 1,5·t en S355 normalisé.
 */
export function minBendRadiusFactor(grade: SteelGrade): number {
  return grade === "S355" ? 1.5 : 1;
}

// ------------------------------------------------------------------ Cintrage des profilés

/**
 * Rayon de cintrage minimal d'une section (famille, hauteur) dans un sens (C-M-06 / C-M-07) :
 * `radius` de la première ligne de capacité de la famille et du sens dont la hauteur maximale
 * couvre la section ; `outOfRange` si la famille et le sens existent mais que la section est
 * plus haute ; `null` si aucune capacité n'est connue.
 */
export function minProfileBendRadius(
  profile: MetalProfile,
  family: (typeof BENDING_FAMILIES)[number],
  direction: (typeof BENDING_DIRECTIONS)[number],
  height: Mm,
): { readonly radius: Mm; readonly maxHeight: Mm } | { readonly outOfRange: Mm } | null {
  const rows = profile.profileBending.filter(
    (r) => r.families.includes(family) && r.direction === direction,
  );
  if (rows.length === 0) return null;
  const fit = rows
    .filter((r) => height <= r.maxHeight + 1e-9)
    .sort((a, b) => a.minRadius - b.minRadius)[0];
  if (fit) return { radius: fit.minRadius, maxHeight: fit.maxHeight };
  return { outOfRange: Math.max(...rows.map((r) => r.maxHeight)) };
}
