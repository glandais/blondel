import { describe, expect, it } from "vitest";
import { createDitheredDepthMaterial, shadowOpacityOf } from "./shadowDepth.js";

describe("ombre partielle des matériaux translucides", () => {
  it("opacité bornée à [0, 1], absente ou non finie : opaque", () => {
    expect(shadowOpacityOf(undefined)).toBe(1);
    expect(shadowOpacityOf(Number.NaN)).toBe(1);
    expect(shadowOpacityOf(-0.2)).toBe(0);
    expect(shadowOpacityOf(1.5)).toBe(1);
    expect(shadowOpacityOf(0.3)).toBe(0.3);
  });

  it("le shader reçoit l'uniforme et rejette les texels au-delà de l'opacité", () => {
    const m = createDitheredDepthMaterial(0.25);
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      fragmentShader: "void main() {\n  gl_FragColor = vec4(1.0);\n}",
      vertexShader: "",
    };
    m.onBeforeCompile(shader as never, null as never);
    expect(shader.uniforms.blondelShadowOpacity?.value).toBe(0.25);
    expect(shader.fragmentShader).toContain("uniform float blondelShadowOpacity;");
    expect(shader.fragmentShader).toContain("discard");
    // Réglage sur place : même uniforme, même programme.
    m.setShadowOpacity(0.6);
    expect(shader.uniforms.blondelShadowOpacity?.value).toBe(0.6);
    expect(m.shadowOpacity).toBe(0.6);
    expect(m.customProgramCacheKey()).toBe("blondel-dithered-depth");
    m.dispose();
  });
});
