/**
 * Qualité du rendu 3D selon le moteur WebGL. Un rendu **logiciel** (SwiftShader de Chrome sans
 * accélération matérielle, llvmpipe / softpipe de Mesa, « Microsoft Basic Render Driver ») fait
 * dessiner chaque image par le processeur ; le compositeur relit ensuite le canevas
 * (`ReadPixels`) et le fil principal attend la fin de l'image. Mesuré (e2e, Chromium sans GPU) :
 * la première image avec ombres portées (carte 2048², filtrage PCF) bloquait la page près d'une
 * seconde, et chaque mouvement de caméra autant ; sans ombres, 60 à 130 ms.
 *
 * Choix de présentation (aucune règle métier) : en rendu logiciel, pas d'ombres portées,
 * densité de pixels 1, ni environnement d'éclairage (PMREM : une dizaine de passes de flou),
 * ni matériaux PBR (transmission du verre = seconde passe de la scène, vernis, anisotropie,
 * et même l'ombrage PBR standard : matériaux diffus `MeshLambertMaterial`), textures procédurales en 256² au lieu de 512², couleur seule (sans carte de
 * rugosité) et filtrage bilinéaire (ni mipmaps, ni filtrage anisotrope), plan de coupe par
 * pièces : chaque échantillonnage de texture coûte sur le
 * processeur à chaque pixel.
 */

export interface RenderQuality {
  /** Moteur WebGL logiciel détecté. */
  readonly software: boolean;
  readonly shadows: boolean;
  /** Densité de pixels du canevas (`dpr` de react-three-fiber). */
  readonly dpr: number | [number, number];
  /** Côté de la carte d'ombre (texels). */
  readonly shadowMapSize: number;
  /** Environnement d'éclairage procédural (`RoomEnvironment` préfiltré). */
  readonly environment: boolean;
  /**
   * Matériaux PBR (`MeshPhysicalMaterial` : transmission, vernis, anisotropie, carte de
   * rugosité) ; sinon matériaux diffus simplifiés (`MeshLambertMaterial`, voir `three/pbr.ts`).
   */
  readonly physical: boolean;
  /** Côté des textures procédurales (texels, puissance de 2). */
  readonly textureSize: number;
  /** Textures filtrées avec mipmaps (trilinéaire) ; sinon bilinéaire. */
  readonly mipmaps: boolean;
  /**
   * Plan de coupe exact (découpe par fragment, plan toujours attaché aux matériaux) ; sinon
   * coupe par pièces (pièces du côté retiré masquées) — la découpe par fragment interdit le test
   * de profondeur anticipé, coûteux en rendu logiciel.
   */
  readonly clipping: boolean;
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/** Le nom de moteur (`UNMASKED_RENDERER_WEBGL` ou `RENDERER`) désigne-t-il un rendu logiciel ? */
export function isSoftwareRenderer(name: string | null | undefined): boolean {
  return typeof name === "string" && SOFTWARE.test(name);
}

export function qualityFor(rendererName: string | null | undefined): RenderQuality {
  return isSoftwareRenderer(rendererName)
    ? {
        software: true,
        shadows: false,
        dpr: 1,
        shadowMapSize: 512,
        environment: false,
        physical: false,
        textureSize: 256,
        mipmaps: false,
        clipping: false,
      }
    : {
        software: false,
        shadows: true,
        dpr: [1, 2],
        shadowMapSize: 2048,
        environment: true,
        physical: true,
        textureSize: 512,
        mipmaps: true,
        clipping: true,
      };
}

let cached: RenderQuality | undefined;

/**
 * Qualité du rendu de ce navigateur, déterminée une fois (contexte WebGL éphémère, libéré
 * aussitôt). Sans WebGL ni DOM : qualité normale (la vue 3D affichera son propre échec).
 */
export function browserRenderQuality(): RenderQuality {
  if (cached) return cached;
  let name: string | null = null;
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as
      WebGLRenderingContext | WebGL2RenderingContext | null;
    if (gl) {
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    name = null;
  }
  cached = qualityFor(name);
  return cached;
}
