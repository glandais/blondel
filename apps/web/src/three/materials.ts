/**
 * Apparence d'aperçu par matériau (couleurs sobres, sans texture) : essences de bois, acier
 * brut, peint (gris anthracite) et galvanisé, inox brossé, verre translucide, béton. Couleurs
 * des marqueurs du contrôle de conception par sévérité.
 */
import type { MaterialId, Severity } from "@blondel/core";

export interface MaterialLook {
  readonly color: string;
  readonly roughness: number;
  readonly metalness: number;
  /** Opacité (< 1 : matériau translucide, rendu sans ombre portée). */
  readonly opacity?: number;
}

export const MATERIAL_LOOKS: Readonly<Record<MaterialId, MaterialLook>> = {
  "wood-oak": { color: "#b8895a", roughness: 0.7, metalness: 0 },
  "wood-beech": { color: "#d2a77c", roughness: 0.7, metalness: 0 },
  "wood-ash": { color: "#dcc8a4", roughness: 0.7, metalness: 0 },
  "wood-pine": { color: "#e2c28c", roughness: 0.75, metalness: 0 },
  "wood-glulam": { color: "#d6b27e", roughness: 0.7, metalness: 0 },
  "steel-raw": { color: "#5d6166", roughness: 0.55, metalness: 0.8 },
  "steel-painted": { color: "#3a3f45", roughness: 0.6, metalness: 0.25 },
  "steel-galvanized": { color: "#a3a9ad", roughness: 0.45, metalness: 0.85 },
  "stainless-brushed": { color: "#c3c7ca", roughness: 0.3, metalness: 0.9 },
  glass: { color: "#bcd8e0", roughness: 0.05, metalness: 0, opacity: 0.3 },
  concrete: { color: "#a19d97", roughness: 0.9, metalness: 0 },
};

/** Libellés français des matériaux. */
export const MATERIAL_LABELS: Readonly<Record<MaterialId, string>> = {
  "wood-oak": "Chêne",
  "wood-beech": "Hêtre",
  "wood-ash": "Frêne",
  "wood-pine": "Pin",
  "wood-glulam": "Lamellé-collé",
  "steel-raw": "Acier brut",
  "steel-painted": "Acier peint",
  "steel-galvanized": "Acier galvanisé",
  "stainless-brushed": "Inox brossé",
  glass: "Verre",
  concrete: "Béton",
};

export const HIGHLIGHT_COLOR = "#ff7a1a";

/** Teinte des pièces et repères en violation (mêmes tons que le panneau de contrôle). */
export const SEVERITY_COLORS: Readonly<Record<Severity, string>> = {
  bloquant: "#c62828",
  avertissement: "#c07a00",
  conseil: "#2f6fb3",
};

export function materialLook(id: MaterialId): MaterialLook {
  return MATERIAL_LOOKS[id] ?? { color: "#999999", roughness: 0.7, metalness: 0 };
}
