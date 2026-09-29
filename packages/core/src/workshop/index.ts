/**
 * Profil d'atelier : capacités de débit et d'usinage, seuils de fabrication (valeurs à valider).
 */
export {
  DEFAULT_WORKSHOP_PROFILE,
  WOOD_MATERIALS,
  WORKSHOP_PROVENANCE,
  WorkshopProfileSchema,
  isWoodMaterial,
  resolveWorkshopProfile,
  smallestAvailable,
  type SettingProvenance,
  type WoodMaterialId,
  type WoodSettingKey,
  type WorkshopProfile,
  type WorkshopProfileInput,
} from "./profile.js";
