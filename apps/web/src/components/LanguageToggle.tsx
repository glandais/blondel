/**
 * Choix de la langue de l'interface et des exports (ADR-0007) : liste accessible (libellé
 * « Langue » / « Language »), à côté du thème. La langue est gardée dans le store
 * (`AppState.locale`) ; `<html lang>` et la mémorisation (`blondel.lang`) suivent
 * (`store/appStore.ts`). Changer de langue ne relance aucun calcul : seul l'affichage est
 * retraduit.
 */
import { LOCALES, isLocale, type Locale, type MessageKey } from "@blondel/i18n";
import { useId } from "react";
import { useT } from "../i18n/useT.js";
import { appStore } from "../store/appStore.js";

/** Nom de chaque langue, écrit dans cette langue (« Français », « English »). */
const LANGUAGE_NAMES: Readonly<Record<Locale, MessageKey>> = {
  fr: "common.language.fr",
  en: "common.language.en",
};

export function LanguageToggle() {
  const t = useT();
  const id = useId();
  return (
    <>
      <label htmlFor={id}>{t.t("common.language.label")}</label>
      <select
        id={id}
        value={t.locale}
        title={t.t("common.language.title")}
        onChange={(e) => {
          const v = e.target.value;
          if (isLocale(v)) appStore.getState().setLocale(v);
        }}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {t.t(LANGUAGE_NAMES[l])}
          </option>
        ))}
      </select>
    </>
  );
}
