/**
 * Constantes d'ergonomie de l'éditeur de plan (ADR-0010, sous-lot 4b) : pas d'accroche, pas du
 * clavier, tailles des poignées. Réglages d'interface **sans valeur métier** (aucune règle de
 * l'art, aucune cote de fabrication) : ils ne sortent jamais du navigateur et ne changent aucun
 * calcul du cœur, qui reçoit les valeurs déjà accrochées (`snapAngle`, `snapPlacement`,
 * `snapSectionLength` de `site/stairSnap.ts` prennent ces pas et rayons en paramètres).
 */

/** Pas de l'accroche angulaire (rotation de l'escalier, angle d'une jonction), en degrés. */
export const ANGLE_SNAP_DEG = 15;

/** Pas du clavier d'une poignée de longueur ou de position (mm) ; avec Maj. */
export const KEY_STEP_MM = 10;
export const KEY_STEP_MM_LARGE = 100;

/** Pas du clavier d'une poignée d'angle (degrés) ; avec Maj. */
export const KEY_STEP_DEG = 1;
export const KEY_STEP_DEG_LARGE = 15;

/** Pas des touches R / Maj+R (rotation de l'escalier sélectionné), en degrés. */
export const ROTATE_KEY_STEP_DEG = 15;

/** Rayon d'accroche des poignées (placement, longueur par girons entiers), en pixels d'écran. */
export const HANDLE_SNAP_RADIUS_PX = 12;

/** Rayon d'affichage d'une poignée, en pixels d'écran. */
export const HANDLE_RADIUS_PX = 7;

/**
 * Distance de la poignée de rotation à la poignée centrale (pixels d'écran) : à l'écran près du
 * centre, elle reste visible quel que soit le cadrage (une poignée au-delà de l'emprise sortirait
 * du cadrage automatique).
 */
export const ROTATE_HANDLE_OFFSET_PX = 64;

/** Distance minimale (pixels d'écran) de la poignée d'angle d'une jonction à son pivot. */
export const ANGLE_HANDLE_MIN_PX = 48;

/**
 * Bornes d'affichage des curseurs ARIA de longueur (mm) : étendue de l'éditeur, non métier (le
 * schéma et les règles bornent les valeurs réelles).
 */
export const SLIDER_MAX_MM = 100_000;

/**
 * Nombre de sommets au-delà duquel la trémie n'est plus éditée sommet par sommet depuis la
 * trémie entière (pas de poignée ni de champs x, y par sommet ; sous-lot 5a) : contour dense,
 * comme le polygone inscrit d'une trémie ronde. Ergonomie (navigation au clavier), non métier.
 */
export const OPENING_VERTEX_EDIT_MAX = 24;
