/**
 * Interface d'écriture DXF commune à deux implémentations :
 * - `R12` (AC1009) : écrivain ASCII maison, sans dépendance, lu par toutes les FAO/découpes
 *   (défaut des développés de pièces) ;
 * - `AC1021` (AutoCAD 2007) : via `@tarikjabiri/dxf` (défaut des plans cotés).
 *
 * Unités : millimètres ($INSUNITS = 4). Coordonnées écrites avec 6 décimales.
 * Seules les entités simples sont utilisées (ligne, polyligne à renflements, arc, cercle,
 * texte) : les cotes sont dessinées en lignes et textes (pas d'entité DIMENSION), pour un
 * rendu identique dans toutes les versions et tous les lecteurs.
 */
import type { Mm, Vec2 } from "@blondel/core";
import type { PathVertex } from "../path.js";

export type DxfVersion = "R12" | "AC1021";

/** Types de ligne disponibles (définis dans chaque document). */
export type DxfLineType = "CONTINUOUS" | "DASHED" | "CENTER";

export interface DxfLayerDef {
  readonly name: string;
  /** Couleur AutoCAD (ACI 1 … 255). */
  readonly color: number;
  readonly lineType?: DxfLineType;
}

export type DxfTextAlign = "left" | "center" | "right";

export interface DxfTextOptions {
  /** Rotation en degrés (sens trigonométrique). */
  readonly rotationDeg?: number;
  readonly align?: DxfTextAlign;
  /** Centrage vertical (sinon ligne de base). */
  readonly middle?: boolean;
}

export interface DxfWriter {
  readonly version: DxfVersion;
  addLayer(layer: DxfLayerDef): void;
  line(a: Vec2, b: Vec2, layer: string): void;
  /** Polyligne 2D à renflements (arcs exacts) ; fermée si `closed`. */
  polyline(vertices: readonly PathVertex[], closed: boolean, layer: string): void;
  /** Arc de cercle parcouru dans le sens trigonométrique de `startDeg` à `endDeg`. */
  arc(center: Vec2, radius: Mm, startDeg: number, endDeg: number, layer: string): void;
  circle(center: Vec2, radius: Mm, layer: string): void;
  text(at: Vec2, height: Mm, value: string, layer: string, options?: DxfTextOptions): void;
  /** Texte complet du fichier DXF. */
  toString(): string;
}

export interface DxfWriterOptions {
  /** Motif du type DASHED (mm) : trait, espace. Défaut [10, 5]. */
  readonly dashPattern?: readonly [Mm, Mm];
}

/** Calques d'un document : l'appelant les déclare tous avant d'écrire des entités. */
export function declareLayers(w: DxfWriter, layers: readonly DxfLayerDef[]): void {
  for (const l of layers) w.addLayer(l);
}
