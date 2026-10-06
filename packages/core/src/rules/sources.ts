/**
 * Sources citées du contrôle de conception dans la langue d'affichage (QUESTIONS A26 (b),
 * décision de l'utilisateur du 2026-10-06).
 *
 * - Règle de rules.yaml : `source` en français, `source_en` en anglais (champ de la table).
 * - Contrôle hors table (plugins de structure, garde-corps, prédimensionnement, catalogue de
 *   profilés, profil d'atelier) : `RuleResult.sourceMessage`, dont la traduction française est
 *   exactement `RuleResult.source` (garanti par `sourceSpec`, qui dérive la chaîne française du
 *   message).
 *
 * Les titres et références de normes restent dans leur langue (NF DTU 36.3, NF P01-012,
 * « arrêté du … ») ; voir `docs/research/glossaire-en.md` (Conventions). Toute sortie (PDF,
 * fiche de pose, interface) passe par `ruleSourceText` / `ruleDefSourceText`, jamais par
 * `source` seul : le français reste strictement identique, l'anglais n'affiche plus de source
 * française.
 */
import { msg, translatorFor, type Message, type MessageKey, type Translator } from "@blondel/i18n";
import type { ComplianceReport, RuleResult } from "../model/derived.js";
import { findRule, type RuleDef } from "./table.js";

const FR = translatorFor("fr");
const EN = translatorFor("en");

/** Source par défaut du profil d'atelier (valeurs « à valider », LEDGER §2). */
export const WORKSHOP_DEFAULT_SOURCE: Message = msg("compliance.source.workshopDefault");

/**
 * Source d'un contrôle hors table à partir de son message : chaîne française dérivée du
 * message (identité garantie avec la traduction française) et message conservé pour les autres
 * langues.
 */
export function sourceSpec(m: Message): {
  readonly source: string;
  readonly sourceMessage: Message;
} {
  return { source: FR.t(m), sourceMessage: m };
}

/** RuleDef d'un contrôle hors table, porteuse de sa source traduisible. */
export type SourcedRuleDef = RuleDef & { readonly sourceMessage?: Message };

/**
 * Champs `source`, `source_en` et `sourceMessage` d'une RuleDef hors table, dérivés du message
 * (anglais : traduction du message, pour `ruleDefSourceText`).
 */
export function ruleDefSource(
  m: Message,
): Pick<SourcedRuleDef, "source" | "source_en" | "sourceMessage"> {
  return { source: FR.t(m), source_en: EN.t(m), sourceMessage: m };
}

/**
 * Source citée d'un résultat dans la langue de `t`. Français : `source`, telle quelle. Autres
 * langues : message traduisible du contrôle hors table, sinon `source_en` de la règle de la
 * table quand la source du résultat est celle de la table, sinon `source` (repli).
 */
export function ruleSourceText(
  r: Pick<RuleResult, "ruleId" | "source" | "sourceMessage">,
  t: Translator,
): string {
  if (t.locale === "fr") return r.source;
  if (r.sourceMessage !== undefined) return t.t(r.sourceMessage);
  const def = findRule(r.ruleId);
  if (def !== undefined && def.source === r.source) return def.source_en;
  return r.source;
}

/** Source citée d'une règle (table ou hors table) dans la langue de `t`. */
export function ruleDefSourceText(
  def: Pick<SourcedRuleDef, "source" | "source_en" | "sourceMessage">,
  t: Translator,
): string {
  if (t.locale === "fr") return def.source;
  if (def.sourceMessage !== undefined) return t.t(def.sourceMessage);
  return def.source_en;
}

/**
 * Libellé du profil du contrôle (`strict`, `souple`) dans une phrase (QUESTIONS A26 (b)) :
 * français identique à l'identifiant (« Profil souple »), anglais « Strict » / « Lenient »
 * (glossaire). Les listes de choix de l'interface ont leurs propres libellés
 * (`ui.params.compliance.profile.*`).
 */
export const PROFILE_LABEL_KEYS: Readonly<Record<ComplianceReport["profile"], MessageKey>> = {
  strict: "compliance.profileName.strict",
  souple: "compliance.profileName.souple",
};

/** Libellé traduisible du profil ; identifiant inconnu : texte brut. */
export function profileLabel(profile: string): Message {
  const key = (PROFILE_LABEL_KEYS as Readonly<Record<string, MessageKey>>)[profile];
  return key !== undefined ? msg(key) : msg("common.text", { text: profile });
}
