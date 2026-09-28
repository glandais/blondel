/**
 * Apparence d'aperçu par matériau (couleurs neutres, sans texture au MVP).
 */
import type { MaterialId } from "@blondel/core";

export interface MaterialLook {
  readonly color: string;
  readonly roughness: number;
  readonly metalness: number;
  readonly opacity?: number;
}

export const MATERIAL_LOOKS: Readonly<Record<MaterialId, MaterialLook>> = {
  "wood-oak": { color: "#b8895a", roughness: 0.7, metalness: 0 },
  "wood-beech": { color: "#d2a77c", roughness: 0.7, metalness: 0 },
  "wood-ash": { color: "#dcc8a4", roughness: 0.7, metalness: 0 },
  "wood-pine": { color: "#e2c28c", roughness: 0.75, metalness: 0 },
  "wood-glulam": { color: "#d6b27e", roughness: 0.7, metalness: 0 },
  "steel-raw": { color: "#5d6166", roughness: 0.55, metalness: 0.8 },
  "steel-painted": { color: "#2f3338", roughness: 0.5, metalness: 0.3 },
  "steel-galvanized": { color: "#a3a9ad", roughness: 0.45, metalness: 0.85 },
  "stainless-brushed": { color: "#c3c7ca", roughness: 0.3, metalness: 0.9 },
  glass: { color: "#bcd8e0", roughness: 0.05, metalness: 0, opacity: 0.35 },
  concrete: { color: "#a19d97", roughness: 0.9, metalness: 0 },
};

export const HIGHLIGHT_COLOR = "#ff7a1a";

export function materialLook(id: MaterialId): MaterialLook {
  return MATERIAL_LOOKS[id] ?? { color: "#999999", roughness: 0.7, metalness: 0 };
}
