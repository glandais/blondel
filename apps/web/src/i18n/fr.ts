/**
 * Traduction française des `Message` du modèle (ADR-0007). **Temporaire** : adaptation minimale
 * de la vague 2, à remplacer en vague 4 par la langue choisie dans l'interface.
 */
import { translatorFor, type Message, type MessageKey } from "@blondel/i18n";

const FR = translatorFor("fr");

/** Texte français d'un message. */
export function tr(m: Message): string {
  return FR.t(m);
}

/** Texte français d'une clé sans paramètre (libellé de plugin : `labelKey`). */
export function trKey(key: MessageKey): string {
  return FR.t({ key });
}

/** Texte français d'un message optionnel (`undefined` s'il est absent). */
export function trOpt(m: Message | undefined): string | undefined {
  return m === undefined ? undefined : FR.t(m);
}

/** Textes français d'une liste de messages. */
export function trList(ms: readonly Message[]): string[] {
  return ms.map((m) => FR.t(m));
}
