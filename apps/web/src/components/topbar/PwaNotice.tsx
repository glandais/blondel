/**
 * Avis de l'application installable (ADR-0008) : « Blondel est prêt à fonctionner hors ligne. »
 * ou « Une nouvelle version de Blondel est disponible. » (Recharger, Plus tard). Rendu **dans le
 * flux**, avec les autres messages au-dessus de la vue (`Notices`) : il ne recouvre ni la vue,
 * ni ses commandes, ni la ligne de chiffres, ni le pied du guidé, ni le formulaire, ni
 * l'inspecteur (vague 6 ; c'était un encart flottant).
 *
 * L'enregistrement du service worker reste monté une seule fois (`UpdatePrompt`, dans `App`) et
 * publie son état ici (`pwaStore`) : les vues qui affichent les messages peuvent être remontées
 * (bascule de parcours, d'espace) sans réenregistrer le service worker ni perdre l'avis.
 */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { useT } from "../../i18n/useT.js";

export interface PwaState {
  /** Nouvelle version disponible (rechargement sur demande seulement). */
  readonly needRefresh: boolean;
  /** Première installation terminée : prêt hors ligne. */
  readonly offlineReady: boolean;
  /** Recharge avec la nouvelle version. */
  readonly reload: () => void;
  /** « Plus tard » : masque l'avis de mise à jour. */
  readonly later: () => void;
  /** « Fermer » : masque l'avis « prêt hors ligne ». */
  readonly close: () => void;
}

const noop = (): void => {};

/** État publié par `UpdatePrompt` (rien sans service worker : `pnpm dev`, tests). */
export const pwaStore = createStore<PwaState>()(() => ({
  needRefresh: false,
  offlineReady: false,
  reload: noop,
  later: noop,
  close: noop,
}));

export function PwaNotice() {
  const t = useT();
  const { needRefresh, offlineReady, reload, later, close } = useStore(pwaStore);
  if (!needRefresh && !offlineReady) return null;
  return (
    <div className="notice notice--info pwa-prompt" role="status" aria-label={t.t("ui.pwa.label")}>
      {needRefresh ? (
        <>
          <span className="notice__text">{t.t("ui.pwa.update.text")}</span>
          <button type="button" onClick={reload}>
            {t.t("ui.pwa.update.reload")}
          </button>
          <button type="button" className="link" onClick={later}>
            {t.t("ui.pwa.update.later")}
          </button>
        </>
      ) : (
        <>
          <span className="notice__text">{t.t("ui.pwa.offlineReady")}</span>
          <button type="button" className="link" onClick={close}>
            {t.t("ui.pwa.close")}
          </button>
        </>
      )}
    </div>
  );
}
