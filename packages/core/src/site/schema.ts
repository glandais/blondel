/**
 * Calque de fond du site (jalon 7, import de plan) : `site.underlay`, champ **facultatif** et
 * rétrocompatible (un projet sans calque est lu et sérialisé à l'identique).
 *
 * Le calque sert seulement à la saisie (tracé de la trémie et des murs, accroches) et à
 * l'affichage : aucune étape du pipeline ne le lit.
 *
 * - `dxf` : entités 2D simplifiées d'un plan de masse DXF (lignes, polylignes à arcs, arcs,
 *   cercles), **en mm** dans le repère propre du dessin (unité `$INSUNITS` ou échelle saisie déjà
 *   appliquée), placées dans le repère du site par `placement` (translation + rotation), ce qui
 *   permet de recaler le calque sans réécrire les entités.
 * - `image` : image PNG ou JPEG **dans le projet** (data URL, taille bornée par
 *   `UNDERLAY_IMAGE_MAX_CHARS`), calibrée par deux points et une distance (`mmPerPx`).
 *
 * Bornes (choix Blondel, dimensionnées pour l'autosauvegarde `localStorage` d'environ 5 M
 * caractères et le clonage vers le worker de calcul, voir docs/LEDGER.md) : 5 000 entités et
 * 50 000 sommets au plus pour le DXF, data URL de 1 500 000 caractères au plus pour l'image
 * (environ 1,1 Mo d'image encodée ; l'interface réduit l'image avant de l'enregistrer).
 */
import { z } from "zod";

/** Nombre maximal d'entités DXF conservées dans le projet. */
export const UNDERLAY_MAX_ENTITIES = 5_000;
/** Nombre maximal de sommets (tous types d'entités) conservés dans le projet. */
export const UNDERLAY_MAX_VERTICES = 50_000;
/** Longueur maximale (caractères) de la data URL d'une image de fond. */
export const UNDERLAY_IMAGE_MAX_CHARS = 1_500_000;
/** Longueur maximale d'un nom de fichier ou de calque DXF enregistré. */
export const UNDERLAY_NAME_MAX = 200;

const finite = z.number().finite();
const Point = z.object({ x: finite, y: finite });

/** Placement d'un calque dans le repère du site : translation (mm) puis rotation (degrés). */
export const UnderlayPlacementSchema = z.object({
  /** Position, dans le repère du site, de l'origine du repère du calque. */
  origin: Point,
  /** Rotation du calque autour de son origine (degrés, sens trigonométrique). */
  rotation: finite.default(0),
});
export type UnderlayPlacement = z.infer<typeof UnderlayPlacementSchema>;

const layer = z.string().max(UNDERLAY_NAME_MAX).optional();

/**
 * Entité simplifiée du calque DXF, en mm dans le repère du dessin. Les angles d'arc sont en
 * degrés, dans le sens trigonométrique de `start` à `end` (convention DXF).
 */
export const UnderlayEntitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("line"), layer, a: Point, b: Point }),
  z.object({
    kind: z.literal("polyline"),
    layer,
    points: z.array(Point).min(2),
    closed: z.boolean().optional(),
    /**
     * Renflements DXF (tan(θ/4), θ = angle au centre signé) du segment qui part de chaque sommet ;
     * absent = polyligne droite. Même longueur que `points` quand présent.
     */
    bulges: z.array(finite).optional(),
  }),
  z.object({
    kind: z.literal("arc"),
    layer,
    center: Point,
    radius: finite.positive(),
    start: finite,
    end: finite,
  }),
  z.object({ kind: z.literal("circle"), layer, center: Point, radius: finite.positive() }),
]);
export type UnderlayEntity = z.infer<typeof UnderlayEntitySchema>;

/** Nombre de sommets d'une entité (pour la borne `UNDERLAY_MAX_VERTICES`). */
export function entityVertexCount(e: UnderlayEntity): number {
  switch (e.kind) {
    case "line":
      return 2;
    case "polyline":
      return e.points.length;
    case "arc":
      return 3;
    case "circle":
      return 1;
  }
}

export const DxfUnderlaySchema = z
  .object({
    /** Nom du fichier importé (information). */
    name: z.string().max(UNDERLAY_NAME_MAX).default(""),
    /** Millimètres par unité de dessin appliqués à l'import (information, déjà appliqué). */
    unitScale: finite.positive(),
    placement: UnderlayPlacementSchema,
    entities: z.array(UnderlayEntitySchema).max(UNDERLAY_MAX_ENTITIES),
  })
  .superRefine((v, ctx) => {
    let count = 0;
    for (const e of v.entities) count += entityVertexCount(e);
    if (count > UNDERLAY_MAX_VERTICES) {
      ctx.addIssue({
        code: "custom",
        path: ["entities"],
        message: `calque DXF trop lourd : ${count} sommets (au plus ${UNDERLAY_MAX_VERTICES})`,
      });
    }
    v.entities.forEach((e, i) => {
      if (e.kind === "polyline" && e.bulges && e.bulges.length !== e.points.length) {
        ctx.addIssue({
          code: "custom",
          path: ["entities", i, "bulges"],
          message: "un renflement par sommet attendu",
        });
      }
    });
  });
export type DxfUnderlay = z.infer<typeof DxfUnderlaySchema>;

/** Point en pixels de l'image (origine en haut à gauche, y vers le bas). */
export const PixelPointSchema = Point;

export const ImageUnderlaySchema = z.object({
  name: z.string().max(UNDERLAY_NAME_MAX).default(""),
  /** Image encodée (PNG ou JPEG en base64). */
  dataUrl: z
    .string()
    .max(UNDERLAY_IMAGE_MAX_CHARS)
    .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, "data URL PNG ou JPEG attendue"),
  /** Dimensions de l'image en pixels. */
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  /** Échelle : millimètres par pixel (calibration par deux points et une distance). */
  mmPerPx: finite.positive(),
  /** Position du coin haut gauche (pixel (0, 0)) et rotation de l'image dans le site. */
  placement: UnderlayPlacementSchema,
  /** Dernière calibration (deux points en pixels, distance réelle en mm), pour la reprendre. */
  calibration: z
    .object({ a: PixelPointSchema, b: PixelPointSchema, distance: finite.positive() })
    .optional(),
});
export type ImageUnderlay = z.infer<typeof ImageUnderlaySchema>;

export const UnderlaySchema = z.object({
  dxf: DxfUnderlaySchema.optional(),
  image: ImageUnderlaySchema.optional(),
  /** Opacité d'affichage du calque (0 à 1) ; absente : valeur de l'interface. */
  opacity: z.number().min(0).max(1).optional(),
});
export type Underlay = z.infer<typeof UnderlaySchema>;
