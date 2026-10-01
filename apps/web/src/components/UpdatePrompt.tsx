/**
 * Application installable (ADR-0008) : enregistre le service worker et signale, dans un encart
 * flottant, que Blondel est prêt hors ligne (première installation) ou qu'une nouvelle version
 * est disponible. La mise à jour n'est appliquée que sur demande (« Recharger ») : jamais de
 * rechargement imposé pendant une saisie (le projet est de toute façon sauvegardé
 * automatiquement). Sans effet en `pnpm dev` (aucun service worker).
 */
import { useRegisterSW } from "virtual:pwa-register/react";
import { useT } from "../i18n/useT.js";

/** Intervalle de recherche d'une nouvelle version pour un onglet resté ouvert. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

export function UpdatePrompt() {
  const t = useT();
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

  if (!needRefresh && !offlineReady) return null;
  return (
    <div className="notice notice--info pwa-prompt" role="status" aria-label={t.t("ui.pwa.label")}>
      {needRefresh ? (
        <>
          <span>{t.t("ui.pwa.update.text")}</span>
          <button type="button" onClick={() => void updateServiceWorker(true)}>
            {t.t("ui.pwa.update.reload")}
          </button>
          <button type="button" className="link" onClick={() => setNeedRefresh(false)}>
            {t.t("ui.pwa.update.later")}
          </button>
        </>
      ) : (
        <>
          <span>{t.t("ui.pwa.offlineReady")}</span>
          <button type="button" className="link" onClick={() => setOfflineReady(false)}>
            {t.t("ui.pwa.close")}
          </button>
        </>
      )}
    </div>
  );
}
