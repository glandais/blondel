/**
 * Barème d'atelier de l'interface (QUESTIONS A14) : état séparé du projet, mémorisé dans le
 * stockage du navigateur (comme le thème), jamais dans l'autosauvegarde du projet ni dans
 * l'historique annuler / rétablir. Lecture et validation : `lib/workshopRates.ts`.
 */
import type { CostRates } from "@blondel/core";
import { createStore, type StoreApi } from "zustand/vanilla";
import { compactRates, parseRatesJson, ratesToJson } from "../lib/workshopRates.js";
import type { StorageLike } from "./persistence.js";

export const WORKSHOP_RATES_KEY = "blondel.workshop.costs";

export interface WorkshopState {
  /** Barème saisi (champs absents = non renseignés ; aucun défaut). */
  readonly rates: CostRates;
  /** Le stockage a refusé la dernière écriture (quota, accès bloqué). */
  readonly saveFailed: boolean;
  setRates(rates: CostRates): void;
}

/** Barème mémorisé (vide si absent, illisible ou stockage indisponible). */
export function loadRates(storage: StorageLike | undefined): CostRates {
  try {
    const text = storage?.getItem(WORKSHOP_RATES_KEY);
    if (!text) return {};
    const r = parseRatesJson(text);
    return r.ok ? r.rates : {};
  } catch {
    return {};
  }
}

export function createWorkshopStore(storage: StorageLike | undefined): StoreApi<WorkshopState> {
  return createStore<WorkshopState>()((set) => ({
    rates: loadRates(storage),
    saveFailed: false,
    setRates: (rates) => {
      const next = compactRates(rates);
      let saveFailed = false;
      try {
        if (Object.keys(next).length === 0) storage?.removeItem(WORKSHOP_RATES_KEY);
        else storage?.setItem(WORKSHOP_RATES_KEY, ratesToJson(next));
      } catch {
        saveFailed = true;
      }
      set({ rates: next, saveFailed });
    },
  }));
}
