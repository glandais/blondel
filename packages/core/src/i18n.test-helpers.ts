/**
 * Aides de test pour les `Message` du modèle (ADR-0007) : assertions textuelles sur la
 * traduction française, qui reste identique aux anciens textes. Préférer une assertion sur
 * `key` / `params` quand le test porte sur la nature du message plutôt que sur sa rédaction.
 */
import { translatorFor, type Message } from "@blondel/i18n";

const FR = translatorFor("fr");

/** Traduction française d'un message (`""` s'il est absent). */
export function fr(m: Message | undefined): string {
  return m === undefined ? "" : FR.t(m);
}

/** Traductions françaises d'une liste de messages (`[]` si elle est absente). */
export function frList(ms: readonly Message[] | undefined): string[] {
  return (ms ?? []).map((m) => FR.t(m));
}
