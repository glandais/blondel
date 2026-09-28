/**
 * Instance applicative du store (navigateur) et crochets React. Le `Model` est dérivé du
 * projet par `buildModel` (via `model/buildModel`), mémoïsé sur l'identité du projet.
 */
import { useStore } from "zustand";
import { createModelCache, type ModelResult } from "../model/buildModel.js";
import { browserStorage } from "./persistence.js";
import { createProjectStore, type AppState } from "./projectStore.js";

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

const modelOf = createModelCache();

/** Modèle dérivé du projet courant (recalculé seulement quand le projet change). */
export function useModel(): ModelResult {
  const project = useApp((s) => s.project);
  return modelOf(project);
}
