/**
 * Textes de l'interface (ADR-0007), hors React : type `Text` (clé ou message) et assemblage de
 * messages. Le code hors composants (`lib/`, `store/`, `model/`) rend des `Message` / clés, ou
 * reçoit un `Translator` en paramètre ; il ne lit jamais la langue courante dans un global.
 */
import { msg, type Message, type MessageKey } from "@blondel/i18n";

/** Texte à traduire : une clé sans paramètre, ou un message complet. */
export type Text = Message | MessageKey;

/** `Message` d'un `Text` (une clé seule devient `{ key }`). */
export function toMessage(text: Text): Message {
  return typeof text === "string" ? msg(text) : text;
}

/**
 * Messages mis bout à bout, séparés par une espace (remarques du cœur réunies en une
 * notification) : un seul `Message`, traduit dans la langue d'affichage. Liste vide : `null`.
 */
export function joinMessages(messages: readonly Message[]): Message | null {
  return chain(messages, "ui.common.join");
}

/**
 * Énumération de messages séparés par « ; » (motifs d'un refus) : un seul `Message`, traduit
 * dans la langue d'affichage. Liste vide : `null`.
 */
export function listMessages(messages: readonly Message[]): Message | null {
  return chain(messages, "ui.common.joinList");
}

/**
 * Énumération courte séparée par des virgules (titres de règles d'une ligne de l'inspecteur) :
 * un seul `Message`, traduit dans la langue d'affichage. Liste vide : `null`.
 */
export function commaMessages(messages: readonly Message[]): Message | null {
  return chain(messages, "ui.common.joinComma");
}

function chain(messages: readonly Message[], key: MessageKey): Message | null {
  if (messages.length === 0) return null;
  let out = messages[messages.length - 1]!;
  for (let i = messages.length - 2; i >= 0; i--) {
    out = msg(key, { first: messages[i]!, rest: out });
  }
  return out;
}
