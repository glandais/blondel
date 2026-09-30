import { translatorFor } from "@blondel/i18n";
import { PRESET_IDS, createProject, type Model } from "@blondel/core";
import { describe, expect, it } from "vitest";
import { computeModel, createModelCache } from "./buildModel.js";

const fakeModel = { errors: ["e1"] } as unknown as Model;

const FR = translatorFor("fr");

describe("accès au pipeline buildModel", () => {
  it("utilise le buildModel réel du cœur sur chaque préréglage", () => {
    for (const id of PRESET_IDS) {
      const r = computeModel(createProject(id));
      expect(r.model, id).not.toBeNull();
      expect(r.errors, id).toEqual([]);
      expect(r.model?.stepping.nosings.length, id).toBeGreaterThan(0);
      expect(r.model?.parts.length, id).toBeGreaterThan(0);
    }
  });

  it("capture une exception du pipeline", () => {
    const r = computeModel(createProject("straight"), () => {
      throw new Error("boum");
    });
    expect(r.model).toBeNull();
    expect(FR.t(r.errors[0]!)).toContain("boum");
  });

  it("rend le modèle, ses erreurs et la durée ; mémoïse par identité du projet", () => {
    let calls = 0;
    const cached = createModelCache(() => {
      calls++;
      return fakeModel;
    }, 2);
    const a = createProject("straight");
    const b = createProject("quarter-left");
    const c = createProject("half-turn");
    const r = cached(a);
    expect(r.model).toBe(fakeModel);
    expect(r.errors).toEqual(["e1"]);
    expect(r.timeMs).toBeGreaterThanOrEqual(0);
    expect(cached(a)).toBe(r);
    cached(b);
    cached(a);
    cached(c); // évince b (le moins récemment utilisé)
    expect(calls).toBe(3);
    cached(a);
    expect(calls).toBe(3);
    cached(b);
    expect(calls).toBe(4);
  });
});
