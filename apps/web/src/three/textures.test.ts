import { afterEach, describe, expect, it } from "vitest";
import { SRGBColorSpace, NoColorSpace } from "three";
import { generateTexture } from "./proceduralTextures.js";
import {
  onTextureReady,
  proceduralTextures,
  resetTextureCache,
  setTextureScheduler,
  texturesIdle,
} from "./textures.js";

afterEach(() => {
  resetTextureCache();
  setTextureScheduler();
});

describe("textures en cache, générées par tranches", () => {
  it("une texture par motif et taille, utilisable tout de suite, générée par tranches planifiées", () => {
    const tasks: (() => void)[] = [];
    setTextureScheduler((run) => tasks.push(run));
    let ready = 0;
    const off = onTextureReady(() => ready++);
    const t = proceduralTextures("oak", 64);
    expect(proceduralTextures("oak", 64)).toBe(t);
    expect(proceduralTextures("oak", 32)).not.toBe(t);
    expect(t.ready).toBe(false);
    expect(t.map.colorSpace).toBe(SRGBColorSpace);
    expect(t.roughnessMap.colorSpace).toBe(NoColorSpace);
    expect(t.map.image.width).toBe(64);
    let guard = 0;
    while (tasks.length > 0 && guard++ < 10_000) tasks.shift()!();
    expect(t.ready).toBe(true);
    expect(texturesIdle()).toBe(true);
    expect(ready).toBe(2);
    expect(t.map.image.data).toEqual(generateTexture("oak", 64).color);
    off();
  });

  it("répétition : un carreau couvre ses dimensions physiques (UV en mètres)", () => {
    setTextureScheduler(() => {});
    const t = proceduralTextures("brushed", 16);
    expect(t.map.repeat.x).toBeCloseTo(1 / 0.4, 9);
    expect(t.map.repeat.y).toBeCloseTo(1 / 0.2, 9);
  });
});
