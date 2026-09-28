/**
 * Migrations du format de projet (ADR-0002) : chaque migration fait passer le JSON brut de la
 * version `from` à `from + 1`. Elles sont chaînées jusqu'à la version courante
 * `PROJECT_SCHEMA_VERSION`, puis le résultat est validé par zod.
 *
 * Les migrations travaillent sur du JSON **non validé** : elles doivent être tolérantes
 * (champ absent, type inattendu) et laisser la validation finale à zod.
 */
import { PROJECT_SCHEMA_VERSION } from "../model/project.js";
import { ProjectParseError } from "./errors.js";

export type JsonObject = Record<string, unknown>;

export interface Migration {
  /** Version d'entrée ; la sortie est en version `from + 1`. */
  readonly from: number;
  readonly description: string;
  /** Reçoit une copie profonde (mutation autorisée) et retourne le JSON migré. */
  migrate(json: JsonObject): JsonObject;
}

/**
 * Registre des migrations du format. Vide tant que le format est en version 1.
 * Ajouter ici `{ from: 1, … }` lors du passage en version 2, et incrémenter
 * `PROJECT_SCHEMA_VERSION` dans `model/project.ts`.
 */
export const PROJECT_MIGRATIONS: readonly Migration[] = [];

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Lit `schemaVersion` et applique les migrations nécessaires jusqu'à `targetVersion`.
 * Ne modifie jamais l'entrée.
 *
 * @throws ProjectParseError si la version est absente, invalide, plus récente que le logiciel,
 *   ou si une migration manque dans la chaîne.
 */
export function migrateProjectJson(
  json: unknown,
  migrations: readonly Migration[] = PROJECT_MIGRATIONS,
  targetVersion: number = PROJECT_SCHEMA_VERSION,
): JsonObject {
  if (!isJsonObject(json)) {
    throw new ProjectParseError("Projet invalide : un objet JSON est attendu à la racine.");
  }
  const version = json["schemaVersion"];
  if (version === undefined) {
    throw new ProjectParseError(
      "Projet invalide : le champ « schemaVersion » (version du format) est absent.",
    );
  }
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
    throw new ProjectParseError(
      `Projet invalide : « schemaVersion » doit être un entier positif ou nul (reçu : ${JSON.stringify(version)}).`,
    );
  }
  if (version > targetVersion) {
    throw new ProjectParseError(
      `Ce projet a été enregistré au format ${version}, plus récent que celui de cette version de Blondel ` +
        `(format ${targetVersion}). Mettez Blondel à jour pour l'ouvrir.`,
    );
  }
  let current: JsonObject;
  try {
    current = structuredClone(json);
  } catch {
    // Valeur non sérialisable (fonction, symbole…) : ce n'est pas un JSON de projet.
    throw new ProjectParseError(
      "Projet invalide : l'objet fourni n'est pas du JSON (valeur non sérialisable).",
    );
  }
  let v = version;
  while (v < targetVersion) {
    const step = migrations.find((m) => m.from === v);
    if (step === undefined) {
      throw new ProjectParseError(
        `Aucune migration disponible du format ${v} vers le format ${v + 1} : ce projet ne peut pas être ouvert.`,
      );
    }
    let next: unknown;
    try {
      next = step.migrate(current);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new ProjectParseError(
        `Échec de la migration du format ${v} vers ${v + 1} (${step.description}) : ${detail}`,
      );
    }
    if (!isJsonObject(next)) {
      throw new ProjectParseError(
        `La migration du format ${v} vers ${v + 1} n'a pas produit un objet JSON.`,
      );
    }
    v += 1;
    current = { ...next, schemaVersion: v };
  }
  return current;
}
