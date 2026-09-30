/**
 * Traduction des `Message` du modèle dans les exports (ADR-0007). Adaptation minimale de la
 * vague 2 : tout est rendu en français (`DEFAULT_LOCALE`), sorties identiques aux instantanés.
 * La vague 3 remplacera ce module par une option `locale` des exports.
 */
import { translatorFor, type Message } from "@blondel/i18n";

const FR = translatorFor("fr");

/** Texte français d'un message du modèle. */
export function tr(m: Message): string {
  return FR.t(m);
}

/** Texte français d'un message optionnel (`undefined` s'il est absent). */
export function trOpt(m: Message | undefined): string | undefined {
  return m === undefined ? undefined : FR.t(m);
}
