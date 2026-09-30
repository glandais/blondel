/**
 * Langue des exports (ADR-0007). Chaque export reçoit `locale?: Locale` dans ses options
 * (français par défaut : sorties identiques aux instantanés) et en tire un `Translator` par
 * `translatorOf(options)`. Les `Message` du modèle (`Part.name`, `Part.section`, constats…) et
 * les libellés propres aux exports passent par ce traducteur, les nombres affichés par
 * `formatIn` (`format.ts`), les tris de textes par `compareText` / `compareMarks`.
 */
import {
  DEFAULT_LOCALE,
  translatorFor,
  type Locale,
  type Message,
  type MessageKey,
  type Translator,
} from "@blondel/i18n";
import type { MaterialId } from "@blondel/core";

export type { Locale, Translator } from "@blondel/i18n";

/** Option commune à tous les exports : langue des textes produits (défaut « fr »). */
export interface LocaleOption {
  /** Langue des textes, nombres affichés, dates et tris (défaut « fr »). */
  readonly locale?: Locale;
}

/** Traducteur d'un export à partir de ses options (français sans option `locale`). */
export function translatorOf(options?: LocaleOption): Translator {
  return translatorFor(options?.locale ?? DEFAULT_LOCALE);
}

/**
 * Option `locale` à transmettre à un export appelé par un autre : `{ locale }`, ou `{}` pour
 * le français par défaut (compatible `exactOptionalPropertyTypes`).
 */
export function localeOption(t: Translator): { readonly locale?: Locale } {
  return { locale: t.locale };
}

/** Texte d'un message du modèle dans la langue du traducteur. */
export function tr(t: Translator, m: Message): string {
  return t.t(m);
}

/** Texte d'un message optionnel (`undefined` s'il est absent). */
export function trOpt(t: Translator, m: Message | undefined): string | undefined {
  return m === undefined ? undefined : t.t(m);
}

/** Comparaison de textes dans la langue du traducteur (remplace `localeCompare(…, "fr")`). */
export function compareText(t: Translator, a: string, b: string): number {
  return a.localeCompare(b, t.locale);
}

/** Comparaison « naturelle » des repères (M2 < M10), insensible à la casse et aux accents. */
export function compareMarks(t: Translator, a: string, b: string): number {
  return a.localeCompare(b, t.locale, { numeric: true, sensitivity: "base" });
}

/** Clé du libellé de chaque matériau (`material.*`, partagées avec l'UI). */
export const MATERIAL_KEYS: Readonly<Record<MaterialId, MessageKey>> = {
  "wood-oak": "material.woodOak",
  "wood-beech": "material.woodBeech",
  "wood-ash": "material.woodAsh",
  "wood-pine": "material.woodPine",
  "wood-glulam": "material.woodGlulam",
  "steel-raw": "material.steelRaw",
  "steel-painted": "material.steelPainted",
  "steel-galvanized": "material.steelGalvanized",
  "stainless-brushed": "material.stainlessBrushed",
  glass: "material.glass",
  concrete: "material.concrete",
};

/** Libellé d'un matériau dans la langue du traducteur (identifiant brut s'il est inconnu). */
export function materialLabel(t: Translator, material: MaterialId | string): string {
  const key = (MATERIAL_KEYS as Readonly<Record<string, MessageKey>>)[material];
  return key === undefined ? material : t.t(key);
}
