/**
 * Clés construites dynamiquement par le code, donc invisibles pour le scan statique des clés
 * orphelines (`keys.test.ts`).
 *
 * Le scan cherche chaque clé de `fr.json` écrite en littéral dans les sources (hors tests). Une
 * clé que le code construit par gabarit (`` `rules.${id}.description` ``) n'y figure pas : sa
 * forme doit être déclarée ici, avec le fichier qui la construit. Garder la liste courte et
 * précise : une forme trop large masque de vraies clés orphelines.
 */
export interface DynamicKeyFamily {
  /** Forme exacte des clés construites (ancrée). */
  readonly pattern: RegExp;
  /** Code qui construit la clé. */
  readonly builtBy: string;
}

export const DYNAMIC_KEYS: readonly DynamicKeyFamily[] = [
  {
    // Description de chaque règle de rules.yaml, indexée par son identifiant.
    pattern: /^rules\.[A-Z][A-Z0-9_]*\.description$/,
    builtBy: "packages/core/src/model/messages.ts (ruleDescription)",
  },
  {
    // Titre court de chaque règle (rules.yaml et contrôles de plugins), indexé par son
    // identifiant : inspecteur Règle et cartes du contrôle (ADR-0009).
    pattern: /^rules\.[A-Z][A-Z0-9_]*\.title$/,
    builtBy: "packages/core/src/model/messages.ts (ruleTitle)",
  },
];

/** La clé est-elle construite dynamiquement (famille déclarée) ? */
export function isDynamic(key: string): boolean {
  return DYNAMIC_KEYS.some((f) => f.pattern.test(key));
}
