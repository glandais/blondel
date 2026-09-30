/**
 * Lecture d'un projet sérialisé : migrations chaînées puis validation zod.
 */
import { msg } from "@blondel/i18n";
import { ProjectSchema, type Project } from "../model/project.js";
import { issuesFromZod, ProjectParseError, projectErrorMap } from "./errors.js";
import { migrateProjectJson, PROJECT_MIGRATIONS, type Migration } from "./migrations.js";

export interface ParseProjectOptions {
  /** Registre de migrations (défaut : `PROJECT_MIGRATIONS`) — surchargé dans les tests. */
  readonly migrations?: readonly Migration[];
}

/**
 * Valide un JSON (déjà désérialisé) et retourne un `Project` complet (valeurs par défaut
 * appliquées, champs inconnus retirés).
 *
 * @throws ProjectParseError avec des messages structurés localisés par chemin.
 */
export function parseProject(json: unknown, options: ParseProjectOptions = {}): Project {
  const migrated = migrateProjectJson(json, options.migrations ?? PROJECT_MIGRATIONS);
  // `reportInput` : valeurs reçues conservées dans les issues (messages de type, `issuesFromZod`).
  const result = ProjectSchema.safeParse(migrated, { error: projectErrorMap, reportInput: true });
  if (!result.success) {
    throw new ProjectParseError(msg("project.parse.invalid"), issuesFromZod(result.error));
  }
  // Copie profonde : zod 4 partage entre les analyses les objets imbriqués des valeurs par
  // défaut (ex. `stair.structure.params`) ; un projet ne doit jamais aliaser un autre projet.
  return structuredClone(result.data);
}

/** Comme `parseProject`, à partir du texte d'un fichier `.blondel.json`. */
export function parseProjectText(text: string, options: ParseProjectOptions = {}): Project {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new ProjectParseError(msg("project.parse.malformedJson", { detail }));
  }
  return parseProject(json, options);
}
