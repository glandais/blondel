/**
 * Sol de la vue 3D : grille (cellules de 10 cm, sections de 1 m) et plan d'ombre, et plage de
 * profondeur de la caméra. Présentation seulement, aucune règle métier.
 *
 * Scintillement de la grille quand la caméra bouge (signalement utilisateur, mesure e2e
 * `apps/web/e2e/grid-flicker.spec.ts` : pixels qui basculent pour une rotation de 0,05°). Deux
 * causes mesurées, avec la grille de drei (`<Grid infiniteGrid>`) :
 *
 * 1. **Conflit de profondeur** entre la grille (y = 0) et le plan d'ombre (y = −1 mm) qui
 *    écrivait sa profondeur : avec near = 0,01 m, 1 mm n'est plus séparable au-delà de quelques
 *    mètres, et la grille entière disparaissait ou réapparaissait d'une pose à l'autre (jusqu'à
 *    1,7 % des pixels du canevas basculaient pour 0,05°). Correction : ni la grille ni le plan
 *    d'ombre n'écrivent la profondeur, ils sont dessinés en premier parmi les objets
 *    transparents (`renderOrder` négatif : sous la dalle translucide et le verre), la grille est
 *    repoussée derrière les faces posées au sol (`polygonOffset`), et le plan proche de la
 *    caméra suit la taille de la scène (`cameraClipRange`).
 * 2. **Aliasing** des lignes : cellules de 10 cm plus serrées que quelques pixels au loin ou en
 *    vue rasante (moiré qui glisse avec la caméra) et lignes plus fines que le pixel. Correction
 *    (shader ci-dessous) : largeur de ligne constante en pixels avec bord antialiasé, lignes
 *    d'une famille atténuées dès que leur pas à l'écran descend sous `FADE_PX` pixels (dérivées
 *    `fwidth`), puis estompe avec la distance horizontale à la caméra.
 */
import { Color, DoubleSide, ShaderMaterial, Vector2 } from "three";

/** Pas des cellules (m). */
export const GRID_CELL = 0.1;
/** Pas des sections (m). */
export const GRID_SECTION = 1;
/**
 * Pas à l'écran (pixels) en dessous duquel une famille de lignes s'efface : pleinement visible
 * à `FADE_PX[1]` pixels et plus, invisible à `FADE_PX[0]` pixels et moins.
 */
export const FADE_PX: readonly [number, number] = [4, 10];

/** Plage de profondeur de la caméra (m), selon la diagonale de la scène (m). */
export function cameraClipRange(sceneSize: number): { near: number; far: number } {
  const size = Number.isFinite(sceneSize) && sceneSize > 0 ? sceneSize : 5;
  // Plan proche : 1/200 de la diagonale, entre 5 cm et 50 cm (la précision de profondeur
  // varie comme near / distance²) ; plan lointain : de quoi reculer de 20 diagonales.
  const near = Math.min(0.5, Math.max(0.05, size / 200));
  const far = Math.max(100, size * 40);
  return { near, far };
}

/** Distance horizontale (m) à la caméra où la grille s'est entièrement estompée. */
export function gridFadeDistance(sceneSize: number): number {
  const size = Number.isFinite(sceneSize) && sceneSize > 0 ? sceneSize : 5;
  return Math.max(15, size * 4);
}

export interface GroundGridOptions {
  readonly cellColor: string;
  readonly sectionColor: string;
  /** Distance horizontale d'estompe complète (m). */
  readonly fadeDistance: number;
}

const VERTEX = /* glsl */ `
  uniform float extent;
  varying vec3 worldPos;
  void main() {
    // Plan unitaire (XY, [-0,5 ; 0,5]²) couché dans XZ, agrandi et centré sous la caméra au
    // mètre près : le motif, calculé en coordonnées du monde, ne glisse pas.
    vec3 p = vec3(position.x, 0.0, -position.y) * extent;
    vec4 world = modelMatrix * vec4(p, 1.0);
    world.xz += floor(cameraPosition.xz);
    worldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 cellColor;
  uniform vec3 sectionColor;
  uniform float cellSize;
  uniform float sectionSize;
  uniform float fadeDistance;
  uniform vec2 fadePx;
  varying vec3 worldPos;

  // Couverture (0 à 1) d'une famille de lignes de largeur widthPx pixels, effacée quand son
  // pas à l'écran devient trop petit pour être dessiné sans moiré.
  float lines(float size, float widthPx) {
    vec2 r = worldPos.xz / size;
    vec2 fw = max(fwidth(r), vec2(1e-6));
    vec2 distPx = abs(fract(r - 0.5) - 0.5) / fw;
    vec2 cover = 1.0 - smoothstep(vec2(widthPx * 0.5 - 0.5), vec2(widthPx * 0.5 + 0.5), distPx);
    // Pas à l'écran (pixels) = 1 / fw, par direction.
    vec2 keep = smoothstep(vec2(fadePx.x), vec2(fadePx.y), 1.0 / fw);
    cover *= keep;
    return max(cover.x, cover.y);
  }

  void main() {
    float cell = lines(cellSize, 1.0);
    float section = lines(sectionSize, 1.5);
    float dist = distance(worldPos.xz, cameraPosition.xz);
    float fade = 1.0 - smoothstep(0.35 * fadeDistance, fadeDistance, dist);
    float alpha = max(cell * 0.45, section * 0.8) * fade;
    if (alpha <= 0.004) discard;
    vec3 color = mix(cellColor, sectionColor, step(cell * 0.45, section * 0.8));
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Matériau de la grille au sol, à poser sur un `PlaneGeometry(1, 1)` sans élimination hors
 * champ (`frustumCulled = false`) et avec `GROUND_GRID_RENDER_ORDER`.
 */
export function createGroundGridMaterial(options: GroundGridOptions): ShaderMaterial {
  return new ShaderMaterial({
    name: "blondel-ground-grid",
    uniforms: {
      cellColor: { value: new Color(options.cellColor) },
      sectionColor: { value: new Color(options.sectionColor) },
      cellSize: { value: GRID_CELL },
      sectionSize: { value: GRID_SECTION },
      fadeDistance: { value: options.fadeDistance },
      fadePx: { value: new Vector2(FADE_PX[0], FADE_PX[1]) },
      extent: { value: 2 * options.fadeDistance + 2 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    // Derrière les faces posées au sol (dessous des limons, des marches de départ).
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    side: DoubleSide,
  });
}

/** Ordre de rendu : plan d'ombre, puis grille, puis les autres objets transparents. */
export const SHADOW_PLANE_RENDER_ORDER = -2;
export const GROUND_GRID_RENDER_ORDER = -1;
