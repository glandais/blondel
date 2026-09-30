/**
 * Fragments de dictionnaires en cours de migration (ADR-0007), vides hors des vagues.
 *
 * Pendant une vague parallèle, chaque agent écrit ses clés dans un fragment privé
 * `_wip/<domaine>.fr.json` / `_wip/<domaine>.en.json` au lieu de `fr.json` / `en.json` (pas de
 * conflit d'écriture). Pour que ces clés soient typées (`MessageKey`), traduites et contrôlées
 * par les tests dès leur ajout, chaque fragment est déclaré ici **avant** le lancement des
 * agents (par l'orchestrateur), par exemple :
 *
 * ```ts
 * import rulesFr from "./_wip/rules.fr.json" with { type: "json" };
 * import rulesEn from "./_wip/rules.en.json" with { type: "json" };
 * export const WIP_FRAGMENTS: readonly WipFragment[] = [{ name: "rules", fr: rulesFr, en: rulesEn }];
 * export const WIP_FR = { ...rulesFr };
 * export const WIP_EN = { ...rulesEn };
 * ```
 *
 * Un fragment peut commencer vide (`{}`). `pnpm i18n:merge` fusionne les fragments dans
 * `fr.json` / `en.json`, trie les clés, supprime `_wip/` et remet ce fichier à vide.
 */

export interface WipFragment {
  readonly name: string;
  readonly fr: Readonly<Record<string, string>>;
  readonly en: Readonly<Record<string, string>>;
}

export const WIP_FRAGMENTS: readonly WipFragment[] = [];

/** Union des fragments français (fournit les clés au type `MessageKey`). */
export const WIP_FR = {};

/** Union des fragments anglais. */
export const WIP_EN = {};
