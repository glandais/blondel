/**
 * Crochets React de la langue (ADR-0007) : langue courante du store (`AppState.locale`) et
 * traducteur mémoïsé de cette langue. Un changement de langue ne rend que l'affichage : le
 * `Model` (neutre) n'est pas recalculé.
 */
import { createTranslator, type Locale, type Translator } from "@blondel/i18n";
import { useApp } from "../store/appStore.js";

/** Langue d'affichage courante. */
export function useLocale(): Locale {
  return useApp((s) => s.locale);
}

/**
 * Traducteur de la langue courante (même objet tant que la langue ne change pas :
 * `createTranslator` est mémoïsé par langue) : `t(clé | message, params?)`, `num`, `date`,
 * `compare`, `locale`.
 */
export function useT(): Translator {
  return createTranslator(useLocale());
}
