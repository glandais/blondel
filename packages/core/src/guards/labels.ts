/**
 * Libellés des garde-corps (ADR-0007) : côtés, lignes, travées. Ce sont des `Message`, traduits
 * à l'affichage ; les contrôles et les remarques les reprennent en paramètre.
 */
import { dec, messageEquals, msg, type Message, type MessageKey } from "@blondel/i18n";
import type { Mm } from "../model/primitives.js";
import type { StairSide } from "./types.js";

/** Côté de l'escalier (« côté jour », « côté extérieur »). */
export function sideLabel(side: StairSide): Message {
  return msg(side === "inner" ? "guard.side.inner" : "guard.side.outer");
}

/** Libellé d'un garde-corps de volée ; `n` : numéro quand le côté en compte plusieurs. */
export function flightRunLabel(side: StairSide, n?: number): Message {
  return n === undefined
    ? msg("guard.run.flight", { side: sideLabel(side) })
    : msg("guard.run.flightNumbered", { side: sideLabel(side), n });
}

/** Libellé d'un garde-corps de trémie ; `n` : numéro quand la trémie en compte plusieurs. */
export function openingRunLabel(n?: number): Message {
  return n === undefined ? msg("guard.run.opening") : msg("guard.run.openingNumbered", { n });
}

/** Forme « début de phrase » de chaque libellé de ligne. */
const TITLE_KEYS: Readonly<Record<string, MessageKey>> = {
  "guard.run.flight": "guard.runTitle.flight",
  "guard.run.flightNumbered": "guard.runTitle.flightNumbered",
  "guard.run.opening": "guard.runTitle.opening",
  "guard.run.openingNumbered": "guard.runTitle.openingNumbered",
};

/**
 * Libellé d'une ligne en début de phrase (« Garde-corps de volée côté jour ») ; un libellé
 * inconnu est rendu tel quel.
 */
export function runTitle(label: Message): Message {
  const key = TITLE_KEYS[label.key];
  return key === undefined ? label : msg(key, label.params);
}

/** Liste de longueurs « 350 mm, 1200 mm » (au moins une longueur). */
export function lengthList(lengths: readonly Mm[]): Message {
  const items = lengths.map((l) => msg("guard.lengthList.item", { length: dec(l, 0) }));
  let out = items[items.length - 1]!;
  for (let i = items.length - 2; i >= 0; i--) {
    out = msg("guard.lengthList.join", { head: items[i]!, tail: out });
  }
  return out;
}

/** Messages sans doublon (égalité structurelle), dans l'ordre de première apparition. */
export function uniqueMessages(ms: readonly Message[]): Message[] {
  const out: Message[] = [];
  for (const m of ms) if (!out.some((o) => messageEquals(o, m))) out.push(m);
  return out;
}
