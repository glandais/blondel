import { describe, expect, it } from "vitest";
import { isSoftwareRenderer, qualityFor } from "./quality.js";

describe("qualité du rendu 3D", () => {
  it("rendus logiciels reconnus (Chrome sans GPU, Mesa, Windows)", () => {
    for (const name of [
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
      "llvmpipe (LLVM 15.0.7, 256 bits)",
      "softpipe",
      "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)",
    ]) {
      expect(isSoftwareRenderer(name), name).toBe(true);
      expect(qualityFor(name)).toEqual({ software: true, shadows: false, dpr: 1 });
    }
  });

  it("GPU matériels et nom inconnu : ombres portées conservées", () => {
    for (const name of [
      "ANGLE (AMD, AMD Radeon Graphics (radeonsi renoir ACO), OpenGL ES 3.2)",
      "ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "Apple M2",
      "WebKit WebGL",
      null,
      undefined,
    ]) {
      expect(isSoftwareRenderer(name), String(name)).toBe(false);
      expect(qualityFor(name).shadows).toBe(true);
    }
  });
});
