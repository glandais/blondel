/**
 * Ombre partielle des matériaux translucides (verre) : la carte d'ombres de three.js est binaire
 * (un texel occulte ou non) ; le matériau de profondeur ci-dessous ne garde qu'une fraction
 * `opacité` des texels (tramage par bruit à gradient entrelacé, stable à l'écran), et le filtrage
 * PCF des ombres moyenne ces texels : l'ombre portée est d'autant plus dense que le matériau est
 * opaque. Opacité modifiée sur place (uniforme) : aucun nouveau programme de shader.
 */
import { MeshDepthMaterial } from "three";

/** Matériau de profondeur tramé, d'opacité d'ombre réglable sur place. */
export interface DitheredDepthMaterial extends MeshDepthMaterial {
  /** Fraction (0–1) de la lumière arrêtée. */
  setShadowOpacity(opacity: number): void;
  readonly shadowOpacity: number;
}

/** Ramène une opacité dans [0, 1] (valeur absente ou non finie : opaque). */
export function shadowOpacityOf(opacity: number | undefined): number {
  return opacity === undefined || !Number.isFinite(opacity) ? 1 : Math.min(1, Math.max(0, opacity));
}

/** Code inséré au début du `main` du fragment : rejet des texels au-delà de l'opacité. */
export const DITHER_DISCARD_GLSL = [
  "float blondelDither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));",
  "if (blondelDither >= blondelShadowOpacity) discard;",
].join("\n");

/** Matériau de profondeur (`Mesh.customDepthMaterial`) laissant passer `1 − opacity` de la lumière. */
export function createDitheredDepthMaterial(opacity: number): DitheredDepthMaterial {
  const uniform = { value: shadowOpacityOf(opacity) };
  const m = new MeshDepthMaterial() as DitheredDepthMaterial;
  m.name = "blondel-dithered-depth";
  m.onBeforeCompile = (shader) => {
    shader.uniforms.blondelShadowOpacity = uniform;
    shader.fragmentShader = shader.fragmentShader.replace(
      "void main() {",
      `uniform float blondelShadowOpacity;\nvoid main() {\n${DITHER_DISCARD_GLSL}`,
    );
  };
  m.customProgramCacheKey = () => "blondel-dithered-depth";
  Object.defineProperty(m, "shadowOpacity", { get: () => uniform.value });
  m.setShadowOpacity = (o: number) => {
    uniform.value = shadowOpacityOf(o);
  };
  return m;
}
