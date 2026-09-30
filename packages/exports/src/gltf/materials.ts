/**
 * Apparence PBR (metallicRoughness, glTF 2.0 §3.9.2) de base par matériau. Valeurs
 * **d'aperçu** (choix de présentation, pas des données métier), **table unique** : la vue 3D de
 * l'application (`apps/web/src/three/materials.ts`) la lit et n'y ajoute que ses textures et
 * effets propres (QUESTIONS D6).
 */
import type { MaterialId } from "@blondel/core";

export interface PbrLook {
  /** Couleur de base sRGB `#rrggbb` (convertie en linéaire dans le fichier). */
  readonly color: string;
  readonly roughness: number;
  readonly metalness: number;
  /** Opacité (< 1 : `alphaMode: BLEND`). */
  readonly opacity?: number;
}

export const MATERIAL_PBR: Readonly<Record<MaterialId, PbrLook>> = {
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

const FALLBACK: PbrLook = { color: "#999999", roughness: 0.7, metalness: 0 };

export function pbrLook(id: string): PbrLook {
  return (MATERIAL_PBR as Readonly<Record<string, PbrLook>>)[id] ?? FALLBACK;
}

/** Composante sRGB (0‒1) → linéaire (IEC 61966-2-1), attendu par `baseColorFactor`. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** `#rrggbb` → [r, g, b] linéaires dans [0, 1]. */
export function hexToLinear(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [0.6, 0.6, 0.6].map(srgbToLinear) as [number, number, number];
  const v = parseInt(m[1]!, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => srgbToLinear(x / 255)) as [
    number,
    number,
    number,
  ];
}
