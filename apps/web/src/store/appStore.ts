/**
 * Instance applicative du store (navigateur) et crochets React. Le `Model` est dérivé du
 * projet par `buildModel` dans le Web Worker de calcul (`model/model.worker.ts`), avec repli
 * sur le fil principal si le worker est indisponible ; les résultats sont mémoïsés sur
 * l'identité du projet (annuler / rétablir immédiats).
 */
import type { Project } from "@blondel/core";
import { useEffect } from "react";
import { useStore } from "zustand";
import {
  applyDocumentLang,
  initialLocale,
  navigatorLanguage,
  storeLocale,
} from "../i18n/locale.js";
import { availableStructures } from "../lib/optionalApi.js";
import { variantsFor } from "../lib/variants.js";
import { withWorkshopRates } from "../lib/workshopRates.js";
import { browserWorker, createJobExec } from "../model/workerClient.js";
import { AUTOSAVE_KEY, browserStorage } from "./persistence.js";
import { createModelService, type CompareView, type ModelView } from "./modelStore.js";
import { createProjectStore, type AppState } from "./projectStore.js";
import { createWorkshopStore, type WorkshopState } from "./workshopStore.js";

/**
 * Première visite : aucune autosauvegarde au chargement (lue avant la création du store, qui
 * ne l'écrit qu'au premier changement). L'accueil propose alors l'assistant.
 */
export const firstVisit: boolean = (() => {
  try {
    return browserStorage()?.getItem(AUTOSAVE_KEY) === null;
  } catch {
    return false;
  }
})();

/**
 * Langue au premier lancement : celle du navigateur (`en*` → anglais, sinon français), puis le
 * choix mémorisé (`blondel.lang`, ADR-0007).
 */
const startLocale = initialLocale(browserStorage(), navigatorLanguage());

export const appStore = createProjectStore({ storage: browserStorage(), locale: startLocale });

// Langue : `<html lang>` et mémorisation suivent le store. Le `Model` est neutre : aucun calcul
// n'est relancé (seul l'affichage est retraduit).
applyDocumentLang(startLocale);
appStore.subscribe((s, prev) => {
  if (s.locale === prev.locale) return;
  applyDocumentLang(s.locale);
  storeLocale(browserStorage(), s.locale);
});

// L'autosauvegarde est différée : l'écrire avant que la page soit masquée ou fermée, sinon la
// dernière saisie (moins de 500 ms avant la fermeture) serait perdue.
if (typeof window !== "undefined") {
  const flush = (): void => appStore.getState().flushAutosave();
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(appStore, selector);
}

/** Barème d'atelier (QUESTIONS A14) : hors du projet, mémorisé dans le navigateur. */
export const workshopStore = createWorkshopStore(browserStorage());

export function useWorkshop<T>(selector: (s: WorkshopState) => T): T {
  return useStore(workshopStore, selector);
}

/** Calculs du modèle et du comparateur : deux workers distincts (créés à la première demande). */
export const modelService = createModelService({
  exec: createJobExec(browserWorker),
  compareExec: createJobExec(browserWorker),
  variantsOf: (project: Project) => variantsFor(project, availableStructures()),
});

// Chaque nouveau projet (saisie, annuler, préréglage, import) est soumis au calcul.
modelService.request(appStore.getState().project);
appStore.subscribe((s, prev) => {
  if (s.project !== prev.project) modelService.request(s.project);
});

/**
 * Dernier modèle calculé. Pendant un calcul (`pending`), c'est celui du projet précédent :
 * `project` indique le projet dont il est issu.
 */
export function useModel(): ModelView {
  return useStore(modelService.store, (s) => s.model);
}

/**
 * Comparaison des variantes du projet courant, calculée tant que le composant est affiché, avec
 * le barème d'atelier (`withWorkshopRates` : copie du projet, le projet lui-même n'est pas
 * modifié). `requested` : projet effectivement comparé (à rapprocher de `project` du résultat).
 */
export function useComparison(): CompareView & { readonly requested: Project } {
  const project = useApp((s) => s.project);
  const rates = useWorkshop((s) => s.rates);
  const requested = withWorkshopRates(project, rates);
  useEffect(() => {
    modelService.requestCompare(requested);
  }, [requested]);
  const view = useStore(modelService.store, (s) => s.compare);
  return { ...view, requested };
}
