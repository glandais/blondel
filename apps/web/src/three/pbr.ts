/**
 * Fabrique des matériaux PBR des pièces (jalon 6) à partir de leur apparence (`materials.ts`),
 * de la qualité de rendu (`quality.ts`) et des textures procédurales (`textures.ts`).
 *
 * - GPU matériel : `MeshPhysicalMaterial` (transmission du verre, vernis des bois et de l'acier
 *   peint, anisotropie de l'inox brossé le long de u = sens du brossage) ;
 * - rendu logiciel : `MeshLambertMaterial` (diffus seul, veinage en couleur, verre translucide
 *   simple) — chaque pixel est ombré par le processeur, et l'ombrage PBR y coûte deux fois plus
 *   (mesure e2e, tâches longues).
 */
import type { MaterialId, Severity } from "@blondel/core";
import {
  Color,
  DoubleSide,
  MeshLambertMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type MeshStandardMaterialParameters,
} from "three";
import { SEVERITY_COLORS, materialLook } from "./materials.js";
import type { RenderQuality } from "./quality.js";
import { proceduralTextures } from "./textures.js";

/** Épaisseur de verre par défaut (mm, unités locales des maillages ; présentation). */
export const GLASS_THICKNESS_MM = 10;

export type PartMaterial = MeshStandardMaterial | MeshPhysicalMaterial | MeshLambertMaterial;

/**
 * Matériau d'aperçu sans texture (surlignage, dalle, repères) : `MeshStandardMaterial` sur GPU
 * matériel, `MeshLambertMaterial` en rendu logiciel (rugosité et métallicité ignorées).
 */
export function simpleMaterial(
  params: MeshStandardMaterialParameters,
  quality: Pick<RenderQuality, "physical">,
): MeshStandardMaterial | MeshLambertMaterial {
  if (quality.physical) return new MeshStandardMaterial(params);
  const { roughness: _r, metalness: _m, ...rest } = params;
  return new MeshLambertMaterial(rest);
}

export interface PartMaterialOptions {
  /** Teinte d'une pièce en violation (contrôle de conception). */
  readonly severity?: Severity;
}

/** Le matériau est-il translucide (sans ombre portée) ? */
export function isTranslucent(id: MaterialId): boolean {
  const look = materialLook(id);
  return look.opacity !== undefined || look.transmission !== undefined;
}

/** Matériau three.js d'un matériau du cœur. */
export function createPartMaterial(
  id: MaterialId,
  quality: Pick<RenderQuality, "physical" | "textureSize" | "mipmaps">,
  options: PartMaterialOptions = {},
): PartMaterial {
  const look = materialLook(id);
  const textures = look.texture
    ? proceduralTextures(look.texture, quality.textureSize, {
        mipmaps: quality.mipmaps,
        anisotropy: quality.physical ? 4 : 1,
      })
    : undefined;
  // Rendu logiciel : carte de couleur seule (chaque échantillonnage coûte sur le processeur).
  const roughnessMap = textures && quality.physical ? textures.roughnessMap : undefined;
  const common = {
    color: textures ? new Color("#ffffff") : new Color(look.color),
    ...(textures ? { map: textures.map } : {}),
    ...(options.severity
      ? { emissive: new Color(SEVERITY_COLORS[options.severity]), emissiveIntensity: 0.55 }
      : {}),
  };
  const base = {
    ...common,
    roughness: roughnessMap ? 1 : look.roughness,
    metalness: look.metalness,
    ...(roughnessMap ? { roughnessMap } : {}),
  };
  let m: PartMaterial;
  if (quality.physical) {
    const glass = look.transmission !== undefined;
    m = new MeshPhysicalMaterial({
      ...base,
      ...(glass
        ? {
            transmission: look.transmission,
            ior: look.ior ?? 1.5,
            thickness: look.thickness ?? GLASS_THICKNESS_MM,
            side: DoubleSide,
          }
        : {}),
      ...(look.clearcoat ? { clearcoat: look.clearcoat, clearcoatRoughness: 0.35 } : {}),
      ...(look.anisotropy ? { anisotropy: look.anisotropy, anisotropyRotation: 0 } : {}),
    });
  } else {
    const transparent = look.opacity !== undefined;
    // Métaux sans environnement ni reflet spéculaire : teinte assombrie selon la métallicité.
    const color = common.color.clone().multiplyScalar(1 - 0.35 * look.metalness);
    m = new MeshLambertMaterial({
      ...common,
      color,
      transparent,
      opacity: look.opacity ?? 1,
      // Verre : visible des deux côtés, sans masquer les pièces situées derrière.
      ...(transparent ? { depthWrite: false, side: DoubleSide } : {}),
    });
  }
  m.name = options.severity ? `${id}|${options.severity}` : id;
  return m;
}
