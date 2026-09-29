/**
 * Apparence PBR par matériau (jalon 6) : essences de bois à veinage procédural orienté selon le
 * fil, acier brut (calamine), peint (gris anthracite) et galvanisé (fleurage), inox brossé
 * (anisotropie), verre (transmission), béton. Couleurs des marqueurs du contrôle de conception
 * par sévérité. Choix de présentation uniquement (aucune règle métier).
 *
 * `color` est la teinte unie (rendu sans texture, repli) ; avec une texture, la couleur du
 * matériau est blanche (la texture porte la teinte) et la rugosité vient de la carte de rugosité.
 */
import type { MaterialId, Severity } from "@blondel/core";
import type { TextureKind } from "./proceduralTextures.js";

export interface MaterialLook {
  readonly color: string;
  readonly roughness: number;
  readonly metalness: number;
  /** Opacité (< 1 : matériau translucide, rendu sans ombre portée). */
  readonly opacity?: number;
  /** Motif procédural (`three/proceduralTextures.ts`). */
  readonly texture?: TextureKind;
  /** Anisotropie de la réflexion le long du fil / du brossage (0–1, matériau physique). */
  readonly anisotropy?: number;
  /**
   * Transmission (verre, matériau physique) : 0–1, indice de réfraction, épaisseur. L'épaisseur
   * est en unités **locales** du maillage (three.js la multiplie par l'échelle de l'objet) :
   * des mm ici, le groupe racine de la vue étant à l'échelle 1/1 000.
   */
  readonly transmission?: number;
  readonly ior?: number;
  readonly thickness?: number;
  /** Vernis (bois) : couche transparente, 0–1 (matériau physique). */
  readonly clearcoat?: number;
}

export const MATERIAL_LOOKS: Readonly<Record<MaterialId, MaterialLook>> = {
  "wood-oak": {
    color: "#b8895a",
    roughness: 0.7,
    metalness: 0,
    texture: "oak",
    clearcoat: 0.15,
  },
  "wood-beech": {
    color: "#d2a77c",
    roughness: 0.7,
    metalness: 0,
    texture: "beech",
    clearcoat: 0.15,
  },
  "wood-ash": { color: "#dcc8a4", roughness: 0.7, metalness: 0, texture: "ash", clearcoat: 0.15 },
  "wood-pine": { color: "#e2c28c", roughness: 0.75, metalness: 0, texture: "pine" },
  "wood-glulam": { color: "#d6b27e", roughness: 0.7, metalness: 0, texture: "glulam" },
  "steel-raw": { color: "#5d6166", roughness: 0.55, metalness: 0.8, texture: "steel-raw" },
  "steel-painted": { color: "#3a3f45", roughness: 0.6, metalness: 0.25, clearcoat: 0.3 },
  "steel-galvanized": {
    color: "#a3a9ad",
    roughness: 0.45,
    metalness: 0.85,
    texture: "galvanized",
  },
  "stainless-brushed": {
    color: "#c3c7ca",
    roughness: 0.3,
    metalness: 0.9,
    texture: "brushed",
    anisotropy: 0.75,
  },
  glass: {
    color: "#bcd8e0",
    roughness: 0.05,
    metalness: 0,
    opacity: 0.3,
    transmission: 1,
    ior: 1.5,
    // 10 mm (présentation, à valider) — unités locales, voir `thickness`.
    thickness: 10,
  },
  concrete: { color: "#a19d97", roughness: 0.9, metalness: 0, texture: "concrete" },
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
