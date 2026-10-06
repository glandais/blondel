/**
 * Application installable (ADR-0008) : enregistre le service worker (monté une seule fois, par
 * `App`) et publie son état dans `pwaStore` : « prêt hors ligne » (première installation) ou
 * « nouvelle version disponible ». L'avis lui-même est rendu dans le flux, au-dessus de la vue,
 * avec les autres messages (`topbar/PwaNotice`, via `Notices`) : il ne recouvre plus aucune
 * commande. La mise à jour n'est appliquée que sur demande (« Recharger ») : jamais de
 * rechargement imposé pendant une saisie (le projet est de toute façon sauvegardé
 * automatiquement). Sans effet en `pnpm dev` (aucun service worker).
 */
import { useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { pwaStore } from "./topbar/PwaNotice.js";

/** Intervalle de recherche d'une nouvelle version pour un onglet resté ouvert. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      setInterval(() => {
        if (navigator.onLine) void registration.update();
      }, UPDATE_CHECK_MS);
    },
  });

  useEffect(() => {
    pwaStore.setState({
      needRefresh,
      offlineReady,
      reload: () => void updateServiceWorker(true),
      later: () => setNeedRefresh(false),
      close: () => setOfflineReady(false),
    });
  }, [needRefresh, offlineReady, updateServiceWorker, setNeedRefresh, setOfflineReady]);

  return null;
}
