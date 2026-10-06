import { buildModel, clearModelCache, createProject, type Project } from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createJobRunner } from "./handler.js";
import { shareUnchanged } from "./structuralShare.js";

describe("partage structurel du projet reçu par le worker", () => {
  it("propriété : résultat égal à `next`, sous-arbres égaux partagés avec `prev`", () => {
    const json = fc.jsonValue({ maxDepth: 4 });
    fc.assert(
      fc.property(json, json, (a, b) => {
        const prev = { a, b, c: { a } };
        const next = structuredClone({ a, b: structuredClone(b), c: { a: b } });
        const out = shareUnchanged(prev, next);
        expect(out).toEqual(next);
        // `a` inchangé : l'objet de `prev` est repris.
        expect(out.a).toBe(prev.a);
        if (JSON.stringify(a) === JSON.stringify(b)) {
          expect(out.c).toBe(prev.c);
        }
      }),
    );
  });

  it("clés ajoutées, retirées ou réordonnées : jamais l'ancien objet", () => {
    const prev: unknown = { x: 1, y: 2 };
    expect(shareUnchanged(prev, { x: 1 })).toEqual({ x: 1 });
    expect(shareUnchanged(prev, { x: 1 })).not.toBe(prev);
    expect(shareUnchanged(prev, { x: 1, y: 2, z: undefined })).not.toBe(prev);
    expect(shareUnchanged<unknown>([1, 2], [1])).toEqual([1]);
    expect(shareUnchanged<unknown>([1], [1, 2])).toEqual([1, 2]);
    expect(shareUnchanged<unknown>({ a: [1] }, { a: { 0: 1 } })).toEqual({ a: { 0: 1 } });
  });

  it("projets clonés (postMessage) : les étapes inchangées du cœur sont réutilisées", () => {
    clearModelCache();
    const base = createProject("quarter-left");
    const changed: Project = { ...base, name: `${base.name} bis` };
    const runner = createJobRunner();
    const a = runner.build({ type: "build", project: structuredClone(base) });
    const b = runner.build({ type: "build", project: structuredClone(changed) });
    // Tracé et balancement inchangés : mêmes objets (cache par étape de `buildModel`).
    expect(b.model?.layout).toBe(a.model?.layout);
    expect(b.model?.stepping).toBe(a.model?.stepping);
    // Chiffres clés (`Model.figures`) : même objet, leurs entrées étant inchangées.
    expect(b.model?.figures).toBeDefined();
    expect(b.model?.figures).toBe(a.model?.figures);
    // Même projet renvoyé : modèle entier réutilisé.
    const c = runner.build({ type: "build", project: structuredClone(changed) });
    expect(c.model).toBe(b.model);
    // Sans partage, deux clones du même projet recalculent tout (constat du défaut).
    clearModelCache();
    const m1 = buildModel(structuredClone(base));
    const m2 = buildModel(structuredClone(base));
    expect(m2.layout).not.toBe(m1.layout);
  });
});
