/**
 * Grandeurs de nomenclature normalisées des pièces bois (`Part.quantities`).
 *
 * Clés normalisées (unité dans le nom) : `volume_m3`, `surface_m2`, `length_mm`, `mass_kg`,
 * `stock_volume_m3` (volume du débit brut L × l × e). Les clés historiques `volume` (m³) et
 * `surface` (m²), lues par `@blondel/exports`, sont conservées avec les mêmes valeurs
 * (rétrocompatibilité). La masse (`mass_kg`) utilise la masse volumique du matériau lue dans le
 * profil d'atelier (`materialDensity` : essence de bois, acier, inox, verre), **valeur à
 * valider**. QUESTIONS A6 (appliqué par défaut le 2026-09-30) : `mass_kg` est renseignée pour
 * **toutes** les pièces qui ont un volume (`ensureMass`, appliqué par le pipeline), pour que la
 * nomenclature, la liste de débit et la fiche de débit l'affichent ; la clé historique `mass`
 * n'est plus utilisée.
 */
import type { Part } from "../model/derived.js";
import type { Mm } from "../model/primitives.js";
import { QUANTITY_SURFACE, QUANTITY_VOLUME } from "../parts/basic.js";
import { isWoodMaterial, materialDensity, type WorkshopProfile } from "../workshop/profile.js";

export const QUANTITY_VOLUME_M3 = "volume_m3";
export const QUANTITY_SURFACE_M2 = "surface_m2";
export const QUANTITY_LENGTH_MM = "length_mm";
export const QUANTITY_MASS_KG = "mass_kg";
export const QUANTITY_STOCK_VOLUME_M3 = "stock_volume_m3";

const MM3_PER_M3 = 1e9;
const MM2_PER_M2 = 1e6;

export interface WoodMeasures {
  /** Volume de matière fini (mm³). */
  readonly volumeMm3: number;
  /** Surface de référence (mm²) : face développée, dessus de marche… */
  readonly surfaceMm2: number;
  /** Longueur de la pièce (mm). */
  readonly length: Mm;
}

/**
 * Grandeurs normalisées (et historiques) d'une pièce bois — ou de tout matériau mesuré de la
 * même façon (pièces de garde-corps en acier, inox ou verre) : la masse utilise la masse
 * volumique du matériau (`materialDensity`).
 */
export function woodQuantities(
  m: WoodMeasures,
  material: Part["material"],
  profile: WorkshopProfile,
  stock?: Part["stock"],
): Record<string, number> {
  const volume = m.volumeMm3 / MM3_PER_M3;
  const surface = m.surfaceMm2 / MM2_PER_M2;
  const q: Record<string, number> = {
    [QUANTITY_VOLUME]: volume,
    [QUANTITY_SURFACE]: surface,
    [QUANTITY_VOLUME_M3]: volume,
    [QUANTITY_SURFACE_M2]: surface,
    [QUANTITY_LENGTH_MM]: m.length,
  };
  const density = materialDensity(material, profile);
  if (Number.isFinite(density)) q[QUANTITY_MASS_KG] = volume * density;
  if (stock)
    q[QUANTITY_STOCK_VOLUME_M3] = (stock.length * stock.width * stock.thickness) / MM3_PER_M3;
  return q;
}

/**
 * Complète les grandeurs d'une pièce bois existante (pièces de base) avec les clés
 * normalisées : volume et surface repris des clés historiques, longueur = longueur de débit.
 * Pièce non bois ou sans volume : rendue telle quelle.
 */
export function normalizeWoodQuantities(part: Part, profile: WorkshopProfile): Part {
  if (!isWoodMaterial(part.material)) return part;
  if (part.quantities[QUANTITY_VOLUME_M3] !== undefined) return part;
  const volume = part.quantities[QUANTITY_VOLUME];
  if (volume === undefined) return part;
  const surface = part.quantities[QUANTITY_SURFACE] ?? 0;
  const q = woodQuantities(
    {
      volumeMm3: volume * MM3_PER_M3,
      surfaceMm2: surface * MM2_PER_M2,
      length: part.stock?.length ?? 0,
    },
    part.material,
    profile,
    part.stock,
  );
  return { ...part, quantities: { ...part.quantities, ...q } };
}

/**
 * Complète `mass_kg` d'une pièce qui a un volume (`volume_m3`, à défaut clé historique
 * `volume`) mais pas de masse : volume × masse volumique du matériau (`materialDensity`, profil
 * d'atelier, valeurs à valider). Pièce déjà massée, ou sans volume : rendue telle quelle.
 */
export function ensureMass(part: Part, profile: WorkshopProfile): Part {
  if (part.quantities[QUANTITY_MASS_KG] !== undefined) return part;
  const volume = part.quantities[QUANTITY_VOLUME_M3] ?? part.quantities[QUANTITY_VOLUME];
  if (volume === undefined || !Number.isFinite(volume)) return part;
  const density = materialDensity(part.material, profile);
  if (!Number.isFinite(density)) return part;
  return { ...part, quantities: { ...part.quantities, [QUANTITY_MASS_KG]: volume * density } };
}
