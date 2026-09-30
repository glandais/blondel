/**
 * Problèmes de validation des schémas du cœur (projet, site, paramètres d'un plugin) en
 * `Message` (ADR-0007) : chemin, libellé métier du champ et motif, traduits à l'affichage.
 *
 * Sans carte d'erreurs, zod rend ses propres textes (anglais) que le cœur ne sait pas traduire :
 * les analyses de l'interface passent donc `SCHEMA_PARSE_OPTIONS` (carte d'erreurs du cœur,
 * valeurs reçues conservées pour les messages de type), puis `schemaIssues` convertit l'erreur.
 */
import { issuesFromZod, projectIssueMessage, zodIssueMessage } from "@blondel/core";
import { DEFAULT_LOCALE, translatorFor, type Message } from "@blondel/i18n";

type ZodErrorLike = Parameters<typeof issuesFromZod>[0];
type ZodIssueLike = Parameters<typeof zodIssueMessage>[0];

const FR = translatorFor(DEFAULT_LOCALE);

/**
 * Options de `safeParse` : carte d'erreurs du cœur (texte français de référence, reconnu par
 * `zodIssueMessage` qui en reprend le `Message`) et valeurs reçues conservées.
 */
export const SCHEMA_PARSE_OPTIONS = {
  error: (issue: ZodIssueLike): string => FR.t(zodIssueMessage(issue)),
  reportInput: true,
} as const;

/** Une ligne par problème : « chemin (libellé) : motif », « (racine) : motif » à la racine. */
export function schemaIssues(error: ZodErrorLike): Message[] {
  return issuesFromZod(error).map(projectIssueMessage);
}
