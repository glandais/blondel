import {
  CostRatesSchema,
  createProject,
  summarizeVariant,
  type CostRates,
  type Project,
} from "@blondel/core";
import { describe, expect, it } from "vitest";
import { createWorkshopStore, loadRates, WORKSHOP_RATES_KEY } from "../store/workshopStore.js";
import { memoryStorage } from "../store/persistence.js";
import {
  COST_FIELDS,
  effectiveRates,
  isEmptyRates,
  missingRequiredRates,
  parseRateInput,
  parseRatesJson,
  ratesToJson,
  withRate,
  withWorkshopRates,
} from "./workshopRates.js";

const FULL: CostRates = {
  hourlyRate: 55,
  minutesPerCut: 2,
  minutesPerWeldMeter: 12,
  minutesPerBend: 1.5,
  minutesPerHole: 0.5,
  minutesPerUniquePart: 10,
  steelPricePerKg: 1.5,
  woodPricePerM3: 1800,
  finishPricePerM2: 25,
};

describe("barème d'atelier (QUESTIONS A14)", () => {
  it("un champ par champ du schéma du cœur ; aucun défaut", () => {
    expect(COST_FIELDS.map((f) => f.key).sort()).toEqual(Object.keys(CostRatesSchema.shape).sort());
    expect(isEmptyRates({})).toBe(true);
    // Taux horaire et temps exigés pour tout chiffrage ; prix selon les matériaux.
    expect(missingRequiredRates({}).map((f) => f.key)).toEqual([
      "hourlyRate",
      "minutesPerCut",
      "minutesPerWeldMeter",
      "minutesPerBend",
      "minutesPerHole",
      "minutesPerUniquePart",
    ]);
    expect(missingRequiredRates(FULL)).toEqual([]);
  });

  it("saisie : décimal ≥ 0, virgule acceptée, vide = non renseigné", () => {
    expect(parseRateInput("1,5")).toEqual({ ok: true, value: 1.5 });
    expect(parseRateInput(" 55 ")).toEqual({ ok: true, value: 55 });
    expect(parseRateInput("")).toEqual({ ok: true, value: undefined });
    expect(parseRateInput("-2").ok).toBe(false);
    expect(parseRateInput("abc").ok).toBe(false);
    expect(withRate({ hourlyRate: 50 }, "hourlyRate", undefined)).toEqual({});
    expect(withRate({}, "minutesPerCut", 3)).toEqual({ minutesPerCut: 3 });
  });

  it("export puis import JSON : barème identique ; profil d'atelier et projet acceptés", () => {
    const back = parseRatesJson(ratesToJson(FULL));
    expect(back).toEqual({ ok: true, rates: FULL });
    expect(parseRatesJson(JSON.stringify({ costs: { hourlyRate: 60 } }))).toEqual({
      ok: true,
      rates: { hourlyRate: 60 },
    });
    expect(parseRatesJson(JSON.stringify({ workshop: { costs: { minutesPerBend: 2 } } }))).toEqual({
      ok: true,
      rates: { minutesPerBend: 2 },
    });
    expect(parseRatesJson(JSON.stringify({ hourlyRate: 45 }))).toEqual({
      ok: true,
      rates: { hourlyRate: 45 },
    });
    expect(parseRatesJson("{").ok).toBe(false);
    expect(parseRatesJson("[]").ok).toBe(false);
    expect(parseRatesJson(JSON.stringify({ autre: 1 })).ok).toBe(false);
    expect(parseRatesJson(JSON.stringify({ costs: { hourlyRate: -1 } })).ok).toBe(false);
  });

  it("persistance hors du projet : stockage du navigateur, lecture au démarrage", () => {
    const storage = memoryStorage();
    const store = createWorkshopStore(storage);
    expect(store.getState().rates).toEqual({});
    store.getState().setRates({ hourlyRate: 50, minutesPerCut: 2 });
    expect(storage.data.has(WORKSHOP_RATES_KEY)).toBe(true);
    expect(loadRates(storage)).toEqual({ hourlyRate: 50, minutesPerCut: 2 });
    expect(createWorkshopStore(storage).getState().rates).toEqual({
      hourlyRate: 50,
      minutesPerCut: 2,
    });
    store.getState().setRates({});
    expect(storage.data.has(WORKSHOP_RATES_KEY)).toBe(false);
    // Stockage illisible ou absent : barème vide, sans erreur.
    expect(loadRates(memoryStorage({ [WORKSHOP_RATES_KEY]: "{" }))).toEqual({});
    expect(loadRates(undefined)).toEqual({});
    const failing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    };
    const s2 = createWorkshopStore(failing);
    s2.getState().setRates({ hourlyRate: 1 });
    expect(s2.getState().saveFailed).toBe(true);
    expect(s2.getState().rates).toEqual({ hourlyRate: 1 });
  });

  it("comparaison : barème fusionné dans une copie du projet, mémoïsée ; projet intact", () => {
    const project = createProject("straight");
    expect(withWorkshopRates(project, {})).toBe(project);
    const rates = { hourlyRate: 50 };
    const a = withWorkshopRates(project, rates);
    expect(a).not.toBe(project);
    expect(a.workshop?.costs).toEqual({ hourlyRate: 50 });
    expect(withWorkshopRates(project, rates)).toBe(a);
    expect(project.workshop?.costs).toBeUndefined();
    // Barème du projet (fichier importé) complété, champs du panneau prioritaires.
    const own: Project = { ...project, workshop: { costs: { hourlyRate: 40, minutesPerCut: 3 } } };
    expect(withWorkshopRates(own, rates).workshop?.costs).toEqual({
      hourlyRate: 50,
      minutesPerCut: 3,
    });
  });

  it("mémoïsation sur le contenu du barème : une copie de même contenu rend la même copie du projet", () => {
    const project = createProject("straight");
    const rates = { hourlyRate: 50, minutesPerCut: 2 };
    // `effectiveRates` passe une copie compactée : elle ne doit pas invalider la copie du projet
    // obtenue avec l'objet du store (sinon la comparaison n'est jamais reconnue comme courante).
    effectiveRates(project, rates);
    const a = withWorkshopRates(project, rates);
    effectiveRates(project, rates);
    expect(withWorkshopRates(project, { ...rates })).toBe(a);
    expect(withWorkshopRates(project, rates)).toBe(a);
    // Contenu différent : nouvelle copie.
    const b = withWorkshopRates(project, { ...rates, hourlyRate: 60 });
    expect(b).not.toBe(a);
    expect(b.workshop?.costs?.hourlyRate).toBe(60);
  });

  it("comparateur : euros masqués tant que le barème est incomplet, affichés sinon", () => {
    const project = createProject("straight", {
      patch: { stair: { structure: { kind: "steel-flat", params: {} } } },
    });
    const partial = summarizeVariant(withWorkshopRates(project, { hourlyRate: 50 }));
    expect(partial.cost).toBeNull();
    const full = summarizeVariant(withWorkshopRates(project, FULL));
    expect(full.cost).not.toBeNull();
    expect(full.cost!.total).toBeGreaterThan(0);
  });

  it("état du panneau : barème appliqué, champs du projet ouvert compris (fichier importé)", () => {
    const project = createProject("straight");
    const times = {
      hourlyRate: 40,
      minutesPerCut: 3,
      minutesPerWeldMeter: 10,
      minutesPerBend: 1,
      minutesPerHole: 1,
      minutesPerUniquePart: 5,
    };
    const own: Project = { ...project, workshop: { costs: times } };
    // Panneau vide, projet porteur d'un barème : les euros s'affichent, le panneau le dit.
    const e = effectiveRates(own, {});
    expect(missingRequiredRates(e.rates)).toEqual([]);
    expect(e.fromProject.map((f) => f.key)).toEqual(Object.keys(times));
    // Champ du panneau prioritaire : non compté comme repris du projet.
    const e2 = effectiveRates(own, { hourlyRate: 60 });
    expect(e2.rates.hourlyRate).toBe(60);
    expect(e2.fromProject.map((f) => f.key)).not.toContain("hourlyRate");
    // Projet sans barème : barème du panneau seul.
    expect(effectiveRates(project, { hourlyRate: 60 })).toEqual({
      rates: { hourlyRate: 60 },
      fromProject: [],
    });
  });
});
