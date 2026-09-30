/**
 * Clés construites dynamiquement par le code, donc invisibles pour le scan statique des clés
 * orphelines (`keys.test.ts`).
 *
 * Le scan cherche chaque clé de `fr.json` écrite en littéral dans les sources (hors tests). Une
 * clé que le code construit par gabarit (`` `rules.${id}.description` ``,
 * `` `common.language.${locale}` ``) n'y figure pas : son préfixe doit être déclaré ici, avec le
 * fichier qui la construit. Garder la liste courte et précise : un préfixe trop large masque de
 * vraies clés orphelines.
 */
export const DYNAMIC_KEY_PREFIXES: readonly string[] = [
  // Nom de chaque langue, construit par `common.language.${locale}` (sélecteur de langue, UI).
  "common.language.",
  // Descriptions et messages des règles, indexés par l'identifiant de la règle (rules.yaml).
  "rules.",
];

/**
 * Clés ajoutées avant le code qui les emploie, pendant la migration par vagues (ADR-0007).
 * Doit être vide à la fin de la migration (vague 5).
 */
export const PENDING_KEYS: readonly string[] = ["common.notAvailable"];

/** La clé est-elle couverte par un préfixe dynamique ou en attente d'emploi ? */
export function isDynamicOrPending(key: string): boolean {
  return PENDING_KEYS.includes(key) || DYNAMIC_KEY_PREFIXES.some((p) => key.startsWith(p));
}
