import { describe, expect, it } from "vitest";
import { clearMeshTiming, perfStore, publishMeshTiming } from "./perfStore.js";

describe("temps de maillage affiché", () => {
  it("publié par la vue 3D, effacé à son démontage (pas de valeur périmée)", () => {
    publishMeshTiming({ timeMs: 3, hits: 10, misses: 2 });
    expect(perfStore.getState().mesh).toEqual({ timeMs: 3, hits: 10, misses: 2 });
    const same = perfStore.getState().mesh;
    publishMeshTiming({ timeMs: 3, hits: 10, misses: 2 });
    expect(perfStore.getState().mesh).toBe(same);
    clearMeshTiming();
    expect(perfStore.getState().mesh).toBeNull();
  });
});
