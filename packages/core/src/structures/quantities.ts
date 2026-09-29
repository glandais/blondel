/**
 * Grandeurs de nomenclature normalisées des pièces bois (`Part.quantities`).
 *
 * Clés normalisées (unité dans le nom) : `volume_m3`, `surface_m2`, `length_mm`, `mass_kg`,
 * `stock_volume_m3` (volume du débit brut L × l × e). Les clés historiques `volume` (m³) et
 * `surface` (m²), lues par `@blondel/exports`, sont conservées avec les mêmes valeurs
 * (rétrocompatibilité). La masse (`mass_kg`) utilise la masse volumique de l'essence du profil
 * d'atelier, **valeur à valider** : la clé historique `mass` (affichée par la liste de débit et
 * l'interface) n'est volontairement pas renseignée tant que ces masses volumiques ne sont pas
 * validées (voir LEDGER).
 */
import type { Part } from "../model/derived.js";
import type { Mm } from "../model/primitives.js";
import { QUANTITY_SURFACE, QUANTITY_VOLUME } from "../parts/basic.js";
import { isWoodMaterial, type WorkshopProfile } from "../workshop/profile.js";

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

/** Grandeurs normalisées (et historiques) d'une pièce bois. */
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
  if (isWoodMaterial(material)) {
    const mass = volume * profile.wood.densities[material];
    q[QUANTITY_MASS_KG] = mass;
  }
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
