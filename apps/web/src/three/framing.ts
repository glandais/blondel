/**
 * Cadrage « démo » de la vue 3D : l'escalier entier vu de trois quarts, en plongée, avec une
 * marge. Fonction pure (boîte en mm du repère du cœur → caméra en mètres du repère three.js,
 * y vers le haut : (x, y, z) du cœur ↦ (x, z, −y) / 1 000). Choix de présentation uniquement.
 */

/** Boîte englobante (mm, repère du cœur : z vers le haut). */
export interface Box3Like {
  readonly min: { readonly x: number; readonly y: number; readonly z: number };
  readonly max: { readonly x: number; readonly y: number; readonly z: number };
}

export interface CameraPose {
  /** Point visé (m, repère three.js). */
  readonly target: readonly [number, number, number];
  /** Position de la caméra (m, repère three.js). */
  readonly position: readonly [number, number, number];
}

export interface FlatteringViewOptions {
  /** Champ vertical de la caméra (degrés). */
  readonly fovDeg: number;
  /** Rapport largeur / hauteur de la vue. */
  readonly aspect: number;
  /** Azimut (degrés) autour de la verticale, depuis l'avant du départ (−y du cœur). */
  readonly azimuthDeg?: number;
  /** Plongée (degrés au-dessus de l'horizontale). */
  readonly elevationDeg?: number;
  /** Marge autour de la sphère englobante (facteur ≥ 1). */
  readonly margin?: number;
}

/** Azimut, plongée et marge par défaut du cadrage de démo (présentation, à valider à l'œil). */
export const DEMO_VIEW = { azimuthDeg: 35, elevationDeg: 28, margin: 1.02 } as const;
/**
 * Hauteur de visée (fraction de la hauteur de la boîte) : sous le milieu, pour que l'escalier
 * monte dans l'image et que ses premières marches restent au-dessus des outils de la vue.
 */
export const DEMO_TARGET_HEIGHT = 0.35;

const MM = 1e-3;
const DEG = Math.PI / 180;

/**
 * Pose de caméra qui montre toute la boîte : visée au centre en plan, à `DEMO_TARGET_HEIGHT` de
 * sa hauteur ; distance telle que la sphère centrée sur la visée qui contient la sphère
 * englobante tienne dans le plus petit des deux champs (vertical, horizontal).
 */
export function flatteringView(box: Box3Like, options: FlatteringViewOptions): CameraPose {
  const azimuth = (options.azimuthDeg ?? DEMO_VIEW.azimuthDeg) * DEG;
  const elevation = (options.elevationDeg ?? DEMO_VIEW.elevationDeg) * DEG;
  const margin = Math.max(1, options.margin ?? DEMO_VIEW.margin);
  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  const cz = box.min.z + DEMO_TARGET_HEIGHT * (box.max.z - box.min.z);
  const dx = box.max.x - box.min.x;
  const dy = box.max.y - box.min.y;
  const dz = box.max.z - box.min.z;
  // Sphère englobante (centre de la boîte), agrandie de l'écart entre son centre et la visée.
  const radius = (Math.max(0.5 * Math.hypot(dx, dy, dz), 1) + (0.5 - DEMO_TARGET_HEIGHT) * dz) * MM;
  const vHalf = (Math.max(1, Math.min(170, options.fovDeg)) * DEG) / 2;
  const aspect = options.aspect > 0 && Number.isFinite(options.aspect) ? options.aspect : 1;
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  const distance = (radius * margin) / Math.sin(Math.min(vHalf, hHalf));
  const target: [number, number, number] = [cx * MM, cz * MM, -cy * MM];
  // Direction caméra → cible vue de dessus : depuis l'avant du départ (−y du cœur, +z three.js),
  // tournée de `azimuth` autour de la verticale.
  const horizontal = Math.cos(elevation) * distance;
  const position: [number, number, number] = [
    target[0] + Math.sin(azimuth) * horizontal,
    target[1] + Math.sin(elevation) * distance,
    target[2] + Math.cos(azimuth) * horizontal,
  ];
  return { target, position };
}
