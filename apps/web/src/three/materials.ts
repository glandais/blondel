/**
 * Apparence PBR par matériau (jalon 6) : essences de bois à veinage procédural orienté selon le
 * fil, acier brut (calamine), peint (gris anthracite) et galvanisé (fleurage), inox brossé
 * (anisotropie), verre (transmission), béton. Couleurs des marqueurs du contrôle de conception
 * par sévérité. Choix de présentation uniquement (aucune règle métier).
 *
 * `color` est la teinte unie (rendu sans texture, repli) ; avec une texture, la couleur du
 * matériau est blanche (la texture porte la teinte) et la rugosité vient de la carte de rugosité.
 */
import {
  GuardInfillSchema,
  type Appearance,
  type MaterialId,
  type Model,
  type Severity,
} from "@blondel/core";
import { MATERIAL_PBR, type PbrLook } from "@blondel/exports";
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
   * des mm ici, le groupe racine de la vue étant à l'échelle 1/1 000. Pour le verre, elle suit
   * celle du remplissage (`glassThicknessOf`, QUESTIONS A25) ; absente : `GLASS_THICKNESS_MM`.
   */
  readonly transmission?: number;
  readonly ior?: number;
  readonly thickness?: number;
  /** Vernis (bois) : couche transparente, 0–1 (matériau physique). */
  readonly clearcoat?: number;
  /**
   * Multiplicateur RVB de la texture (ton d'une finition bois, `Project.appearance.woodTone`) :
   * une composante > 1 éclaircit, < 1 assombrit. Absent : texture telle quelle.
   */
  readonly tint?: readonly [number, number, number];
}

/**
 * Compléments de la vue 3D (textures procédurales, anisotropie, transmission, vernis) : couleur,
 * rugosité, métal et opacité viennent de la table **unique** `MATERIAL_PBR` de
 * `@blondel/exports`, partagée avec le glTF (QUESTIONS D6).
 */
const VIEW_EXTRAS: Readonly<Record<MaterialId, Omit<MaterialLook, keyof PbrLook>>> = {
  "wood-oak": { texture: "oak", clearcoat: 0.15 },
  "wood-beech": { texture: "beech", clearcoat: 0.15 },
  "wood-ash": { texture: "ash", clearcoat: 0.15 },
  "wood-pine": { texture: "pine" },
  "wood-glulam": { texture: "glulam" },
  "steel-raw": { texture: "steel-raw" },
  "steel-painted": { clearcoat: 0.3 },
  "steel-galvanized": { texture: "galvanized" },
  "stainless-brushed": { texture: "brushed", anisotropy: 0.75 },
  // Épaisseur : celle du remplissage verre du modèle (`glassThicknessOf`), voir `thickness`.
  glass: { transmission: 1, ior: 1.5 },
  concrete: { texture: "concrete" },
};

export const MATERIAL_LOOKS: Readonly<Record<MaterialId, MaterialLook>> = Object.fromEntries(
  (Object.keys(VIEW_EXTRAS) as MaterialId[]).map((id) => [
    id,
    { ...MATERIAL_PBR[id], ...VIEW_EXTRAS[id] },
  ]),
) as Record<MaterialId, MaterialLook>;

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

/**
 * Épaisseur de verre par défaut (mm, unités locales des maillages) : défaut du remplissage verre
 * du cœur (`GuardInfillSchema`, `guards/spec.ts`), lu dans le schéma (aucune valeur recopiée).
 */
export const GLASS_THICKNESS_MM: number = (() => {
  const infill = GuardInfillSchema.parse({ kind: "glass" });
  // Branche inatteignable (le schéma rend un remplissage verre) : pas de valeur recopiée.
  return infill.kind === "glass" ? infill.thickness : Number.NaN;
})();

/**
 * Épaisseur du verre rendu en 3D (QUESTIONS A25, décision du 2026-09-29) : celle des panneaux
 * de verre du modèle (débit `stock.thickness`, épaisseur du remplissage `guards.infill`), sinon
 * `GLASS_THICKNESS_MM`. Lecture seule du modèle, aucun calcul.
 */
export function glassThicknessOf(model: Pick<Model, "parts"> | null | undefined): number {
  for (const p of model?.parts ?? []) {
    if (p.material !== "glass") continue;
    const t = p.stock?.thickness;
    if (t !== undefined && Number.isFinite(t) && t > 0) return t;
  }
  return GLASS_THICKNESS_MM;
}

export function materialLook(id: MaterialId): MaterialLook {
  return MATERIAL_LOOKS[id] ?? { color: "#999999", roughness: 0.7, metalness: 0 };
}

/**
 * Tons des finitions bois (`Appearance.woodTone`) : multiplicateurs RVB de la texture.
 * Présentation seulement (à valider à l'œil, QUESTIONS A25).
 */
export const WOOD_TONE_TINTS: Readonly<
  Record<NonNullable<Appearance["woodTone"]>, readonly [number, number, number] | undefined>
> = {
  natural: undefined,
  light: [1.14, 1.12, 1.08],
  dark: [0.52, 0.42, 0.36],
};

/** Teintes du verre (`Appearance.glassTint`) : couleur et opacité du rendu. Présentation. */
export const GLASS_TINTS: Readonly<
  Record<NonNullable<Appearance["glassTint"]>, Pick<MaterialLook, "color" | "opacity">>
> = {
  clear: { color: MATERIAL_LOOKS.glass.color, opacity: MATERIAL_LOOKS.glass.opacity },
  "extra-clear": { color: "#eef6f7", opacity: 0.2 },
  smoked: { color: "#5f686d", opacity: 0.5 },
};

/**
 * Zone de peinture d'une pièce : ossature (défaut), marches (`Appearance.treadPaintColor`) ou
 * garde-corps et mains courantes (`Appearance.guardPaintColor`).
 */
export type PaintZone = "structure" | "treads" | "guards";

/** Couleur de peinture d'une zone : sa couleur propre, sinon `paintColor`. */
function paintColorFor(appearance: Appearance, zone: PaintZone): string | undefined {
  const own =
    zone === "treads"
      ? appearance.treadPaintColor
      : zone === "guards"
        ? appearance.guardPaintColor
        : undefined;
  return own ?? appearance.paintColor;
}

/**
 * Apparence d'un matériau selon les teintes enregistrées du projet (`Project.appearance`) :
 * couleur de l'acier peint (par zone : ossature, marches, garde-corps), ton du bois, teinte du
 * verre. Le matériau (et donc la masse, le débit) ne change pas : seule sa présentation. Sans
 * `appearance`, `materialLook(id)`.
 */
export function materialLookFor(
  id: MaterialId,
  appearance?: Appearance,
  zone: PaintZone = "structure",
): MaterialLook {
  const look = materialLook(id);
  if (!appearance) return look;
  const paint = id === "steel-painted" ? paintColorFor(appearance, zone) : undefined;
  if (paint) return { ...look, color: paint.toLowerCase() };
  if (id.startsWith("wood-") && appearance.woodTone) {
    const tint = WOOD_TONE_TINTS[appearance.woodTone];
    return tint ? { ...look, tint } : look;
  }
  if (id === "glass" && appearance.glassTint) {
    return { ...look, ...GLASS_TINTS[appearance.glassTint] };
  }
  return look;
}

/** Clé de cache des matériaux pour des teintes données (chaîne vide : rendu par défaut). */
export function appearanceKey(appearance?: Appearance): string {
  if (!appearance) return "";
  return [
    appearance.paintColor ?? "",
    appearance.treadPaintColor ?? "",
    appearance.guardPaintColor ?? "",
    appearance.woodTone ?? "",
    appearance.glassTint ?? "",
  ]
    .join("|")
    .toLowerCase();
}

/**
 * Zone de peinture distincte pour ce matériau (seul l'acier peint en a), `structure` sinon :
 * les matériaux partagés de la vue 3D n'en font une variante que pour l'acier peint.
 */
export function paintZoneFor(id: MaterialId, zone: PaintZone): PaintZone {
  return id === "steel-painted" ? zone : "structure";
}
