/**
 * Langue de l'interface (ADR-0007), hors React : détection au premier lancement, mémorisation
 * dans le navigateur (`blondel.lang`), attribut `lang` du document et formats `Intl` de la
 * langue. Le `Model` est neutre : changer de langue ne relance aucun calcul.
 */
import { detectLocale, isLocale, type Locale } from "@blondel/i18n";

/** Clé de stockage du choix de langue. */
export const LANG_KEY = "blondel.lang";

/** Accès minimal au stockage (localStorage, ou double de test). */
export interface LangStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Langue mémorisée, `null` si absente, invalide ou stockage inaccessible. */
export function readStoredLocale(storage: LangStorage | undefined): Locale | null {
  try {
    const v = storage?.getItem(LANG_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

/** Mémorise la langue ; sans effet si le stockage est indisponible (choix valable pour la session). */
export function storeLocale(storage: LangStorage | undefined, locale: Locale): void {
  try {
    storage?.setItem(LANG_KEY, locale);
  } catch {
    // Stockage indisponible ou plein.
  }
}

/**
 * Langue au démarrage : celle mémorisée, sinon celle du navigateur (`en*` → anglais, tout le
 * reste → français).
 */
export function initialLocale(
  storage: LangStorage | undefined,
  navigatorLanguage: string | undefined,
): Locale {
  return readStoredLocale(storage) ?? detectLocale(navigatorLanguage);
}

/** Langue du navigateur, si elle est connue. */
export function navigatorLanguage(): string | undefined {
  return typeof navigator !== "undefined" ? navigator.language : undefined;
}

/** Reporte la langue sur `<html lang>` (lecteurs d'écran, césure, correcteur). */
export function applyDocumentLang(locale: Locale): void {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

/** Étiquette BCP 47 des formats `Intl` d'une langue (anglais : conventions britanniques). */
export function intlLocale(locale: Locale): string {
  return locale === "fr" ? "fr-FR" : "en-GB";
}

const FORMATS = new Map<string, Intl.NumberFormat>();

/**
 * `Intl.NumberFormat` de la langue, mémoïsé par langue et options (remplace les
 * `new Intl.NumberFormat("fr-FR", …)` et `toLocaleString("fr-FR", …)`).
 */
export function numberFormat(
  locale: Locale,
  options: Intl.NumberFormatOptions = {},
): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = FORMATS.get(key);
  if (f === undefined) {
    f = new Intl.NumberFormat(intlLocale(locale), options);
    FORMATS.set(key, f);
  }
  return f;
}

/** Raccourci : `numberFormat(locale, options).format(value)`. */
export function formatNumber(
  locale: Locale,
  value: number,
  options: Intl.NumberFormatOptions = {},
): string {
  return numberFormat(locale, options).format(value);
}
