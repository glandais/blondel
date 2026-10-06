/**
 * Classe de largeur de la fenêtre (`lib/viewport.ts`), suivie par deux requêtes média
 * (`matchMedia`) et `useSyncExternalStore` : le composant ne se réaffiche qu'au passage d'un
 * seuil (1 100 ou 760 px), pas à chaque redimensionnement. Sans fenêtre (rendu serveur, tests
 * sous Node) : « wide », la mise en page de la maquette.
 */
import { useSyncExternalStore } from "react";
import {
  DRAWER_QUERY,
  GUIDED_ONLY_QUERY,
  viewportClassOf,
  type ViewportClass,
} from "../lib/viewport.js";

function queries(): readonly [MediaQueryList, MediaQueryList] | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return [window.matchMedia(DRAWER_QUERY), window.matchMedia(GUIDED_ONLY_QUERY)];
}

function subscribe(onChange: () => void): () => void {
  const qs = queries();
  if (qs === null) return () => {};
  for (const q of qs) q.addEventListener("change", onChange);
  return () => {
    for (const q of qs) q.removeEventListener("change", onChange);
  };
}

/** Classe courante (« wide » sans fenêtre). */
export function currentViewportClass(): ViewportClass {
  const qs = queries();
  return qs === null ? "wide" : viewportClassOf(qs[0].matches, qs[1].matches);
}

const serverSnapshot = (): ViewportClass => "wide";

export function useViewportClass(): ViewportClass {
  return useSyncExternalStore(subscribe, currentViewportClass, serverSnapshot);
}
