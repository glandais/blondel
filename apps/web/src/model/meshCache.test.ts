import { buildModel, clearModelCache, createProject, type Project } from "@blondel/core";
import { describe, expect, it } from "vitest";
import { createMeshCache } from "./meshCache.js";

/** Copie profonde (nouvelles identités, mêmes valeurs). */
const clone = <T>(v: T): T => structuredClone(v);

describe("maillage mémoïsé par pièce", () => {
  const model = buildModel(createProject("quarter-left"));

  it("premier appel : tout est maillé ; second : tout est réutilisé", () => {
    const cache = createMeshCache();
    const a = cache.mesh(model.parts);
    expect(a.misses).toBe(model.parts.length);
    expect(a.hits).toBe(0);
    const b = cache.mesh(model.parts);
    expect(b.hits).toBe(model.parts.length);
    expect(b.parts.map((p) => p.mesh.mesh)).toEqual(a.parts.map((p) => p.mesh.mesh));
  });

  it("solides recréés à l'identique (nouvelle identité) : réutilisés par empreinte", () => {
    const cache = createMeshCache();
    const first = cache.mesh(model.parts);
    const again = cache.mesh(clone(model.parts));
    expect(again.misses).toBe(0);
    again.parts.forEach((p, i) => expect(p.mesh.mesh).toBe(first.parts[i]!.mesh.mesh));
  });

  it("une modification qui ne touche que les contremarches ne remaille pas les marches", () => {
    clearModelCache();
    const p0 = createProject("quarter-left");
    const p1: Project = {
      ...p0,
      stair: {
        ...p0.stair,
        treads: { ...p0.stair.treads, riserThickness: p0.stair.treads.riserThickness + 5 },
      },
    };
    const m0 = buildModel(p0);
    const m1 = buildModel(p1);
    const cache = createMeshCache();
    cache.mesh(m0.parts);
    const run = cache.mesh(m1.parts);
    const risers = m1.parts.filter((p) => p.category === "riser").length;
    expect(risers).toBeGreaterThan(0);
    expect(run.misses).toBeLessThanOrEqual(risers);
    expect(run.hits).toBeGreaterThanOrEqual(m1.parts.length - risers);
  });

  it("métadonnées de la pièce courante même si le maillage est partagé", () => {
    const cache = createMeshCache();
    cache.mesh(model.parts);
    const renamed = model.parts.map((p) => ({ ...p, mark: `${p.mark}x` }));
    const run = cache.mesh(renamed);
    expect(run.hits).toBe(model.parts.length);
    run.parts.forEach((p, i) => expect(p.mesh.mark).toBe(renamed[i]!.mark));
  });

  it("capacité bornée, pièces courantes toujours conservées", () => {
    const cache = createMeshCache(4);
    cache.mesh(model.parts);
    expect(cache.size).toBe(new Set(model.parts.map((p) => JSON.stringify(p.solid))).size);
    cache.mesh(model.parts.slice(0, 2));
    expect(cache.size).toBeLessThanOrEqual(Math.max(4, 2));
  });
});
