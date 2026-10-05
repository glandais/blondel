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
import type { Appearance, MaterialId, Severity } from "@blondel/core";
import {
  Color,
  DoubleSide,
  MeshLambertMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type MeshStandardMaterialParameters,
} from "three";
import {
  GLASS_THICKNESS_MM,
  materialLook,
  materialLookFor,
  type MaterialLook,
  type PaintZone,
  severityColors3d,
  type Theme3d,
} from "./materials.js";
import type { RenderQuality } from "./quality.js";
import { proceduralTextures } from "./textures.js";

export { GLASS_THICKNESS_MM };

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
  /** Thème de la palette fonctionnelle de la teinte de violation (défaut : clair). */
  readonly theme?: Theme3d;
  /** Teintes enregistrées du projet (peinture, ton du bois, verre) : `materialLookFor`. */
  readonly appearance?: Appearance;
  /** Zone de peinture de la pièce (acier peint : ossature, marches, garde-corps). */
  readonly zone?: PaintZone;
  /**
   * Épaisseur du verre (mm, transmission du matériau physique) : celle du remplissage du modèle
   * (`glassThicknessOf`, QUESTIONS A25). Absente : `GLASS_THICKNESS_MM`.
   */
  readonly glassThickness?: number;
}

/** Le matériau est-il translucide (sans ombre portée) ? */
export function isTranslucent(id: MaterialId): boolean {
  const look = materialLook(id);
  return look.opacity !== undefined || look.transmission !== undefined;
}

/**
 * Couleur du matériau : blanche sous une texture (qui porte la teinte), sinon la teinte unie ;
 * multipliée par le ton `tint` éventuel (finition bois du projet).
 */
function baseColor(look: MaterialLook, textured: boolean): Color {
  const c = textured ? new Color("#ffffff") : new Color(look.color);
  return look.tint ? c.multiply(new Color(...look.tint)) : c;
}

/**
 * Applique **sur place** les teintes du projet (`Project.appearance`) à un matériau créé par
 * `createPartMaterial` pour le même `id` (et la même zone de peinture) : couleur et opacité seulement (uniformes). Aucun
 * nouveau programme de shader : recréer les matériaux libérerait leurs programmes, recompilés
 * ensuite de façon synchrone (tâche longue de 150 ms et plus, `e2e/demos.spec.ts`).
 */
export function tintPartMaterial(
  m: PartMaterial,
  id: MaterialId,
  quality: Pick<RenderQuality, "physical">,
  appearance?: Appearance,
  zone?: PaintZone,
): void {
  const look = materialLookFor(id, appearance, zone);
  const color = baseColor(look, m.map !== null);
  // Rendu logiciel : même assombrissement des métaux qu'à la création.
  if (!quality.physical) color.multiplyScalar(1 - 0.35 * look.metalness);
  m.color.copy(color);
  if (!quality.physical && look.opacity !== undefined) m.opacity = look.opacity;
}

/** Matériau three.js d'un matériau du cœur. */
export function createPartMaterial(
  id: MaterialId,
  quality: Pick<RenderQuality, "physical" | "textureSize" | "mipmaps">,
  options: PartMaterialOptions = {},
): PartMaterial {
  const look = materialLookFor(id, options.appearance, options.zone);
  const textures = look.texture
    ? proceduralTextures(look.texture, quality.textureSize, {
        mipmaps: quality.mipmaps,
        anisotropy: quality.physical ? 4 : 1,
      })
    : undefined;
  // Rendu logiciel : carte de couleur seule (chaque échantillonnage coûte sur le processeur).
  const roughnessMap = textures && quality.physical ? textures.roughnessMap : undefined;
  const common = {
    color: baseColor(look, textures !== undefined),
    ...(textures ? { map: textures.map } : {}),
    ...(options.severity
      ? {
          emissive: new Color(severityColors3d(options.theme ?? "light")[options.severity]),
          emissiveIntensity: 0.55,
        }
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
            thickness: options.glassThickness ?? look.thickness ?? GLASS_THICKNESS_MM,
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

/**
 * Applique **sur place** l'épaisseur du verre (transmission, uniforme du matériau physique) :
 * sans effet sur un matériau sans transmission (rendu logiciel, matériau non vitré).
 */
export function setGlassThickness(m: PartMaterial, thickness: number): void {
  if (m instanceof MeshPhysicalMaterial && m.transmission > 0) m.thickness = thickness;
}
