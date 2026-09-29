/**
 * Instance applicative du store (navigateur) et crochets React. Le `Model` est dérivé du
 * projet par `buildModel` dans le Web Worker de calcul (`model/model.worker.ts`), avec repli
 * sur le fil principal si le worker est indisponible ; les résultats sont mémoïsés sur
 * l'identité du projet (annuler / rétablir immédiats).
 */
import type { Project } from "@blondel/core";
import { useEffect } from "react";
import { useStore } from "zustand";
import { availableStructures } from "../lib/optionalApi.js";
import { variantsFor } from "../lib/variants.js";
import { browserWorker, createJobExec } from "../model/workerClient.js";
import { AUTOSAVE_KEY, browserStorage } from "./persistence.js";
import { createModelService, type CompareView, type ModelView } from "./modelStore.js";
import { createProjectStore, type AppState } from "./projectStore.js";

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

export const appStore = createProjectStore({ storage: browserStorage() });

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

/** Comparaison des variantes du projet courant, calculée tant que le composant est affiché. */
export function useComparison(): CompareView {
  const project = useApp((s) => s.project);
  useEffect(() => {
    modelService.requestCompare(project);
  }, [project]);
  return useStore(modelService.store, (s) => s.compare);
}
