/**
 * Migrations du format de projet (ADR-0002) : chaque migration fait passer le JSON brut de la
 * version `from` à `from + 1`. Elles sont chaînées jusqu'à la version courante
 * `PROJECT_SCHEMA_VERSION`, puis le résultat est validé par zod.
 *
 * Les migrations travaillent sur du JSON **non validé** : elles doivent être tolérantes
 * (champ absent, type inattendu) et laisser la validation finale à zod.
 */
import { errorMessage, msg, type Message } from "@blondel/i18n";
import { PROJECT_SCHEMA_VERSION } from "../model/project.js";
import { ProjectParseError } from "./errors.js";

export type JsonObject = Record<string, unknown>;

export interface Migration {
  /** Version d'entrée ; la sortie est en version `from + 1`. */
  readonly from: number;
  /** Description affichée dans l'erreur d'une migration qui échoue (message traduisible). */
  readonly description: Message | string;
  /** Reçoit une copie profonde (mutation autorisée) et retourne le JSON migré. */
  migrate(json: JsonObject): JsonObject;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Chemin de l'ancrage saisi des tire-fonds du limon central bois (valeurs validées ◆). */
const LAG_MIN_ANCHORAGE_PATH = "stair.structure.params.lagScrews.minAnchorage";
const LAG_MIN_TOTAL_ANCHORAGE_PATH = "stair.structure.params.lagScrews.minTotalAnchorage";
const TENSION_ZONE_PATH = "stair.structure.params.section.tensionZone";
const MIN_BOARD_LENGTH_PATH = "stair.structure.params.section.minBoardLength";

/**
 * Défauts du format 1 (`woodCentralParams.ts` avant A38) que l'interface enregistre avec le
 * projet dès le choix de la structure (`withDefaults` de `apps/web`) : une valeur égale à l'un
 * d'eux, sans validation ◆ sur son chemin, est lue comme un défaut enregistré, non comme une
 * saisie (relecture finale A38). Constantes historiques du format, pas des valeurs métier.
 */
const V1_TENSION_ZONE_DEFAULT = 0.5;
const V1_MIN_BOARD_LENGTH_DEFAULT = 150;

/** Une validation ◆ du limon central bois est posée sur ce chemin. */
function isValidated(json: JsonObject, path: string): boolean {
  const validated = json["validatedValues"];
  return (
    Array.isArray(validated) &&
    validated.some(
      (v) => isJsonObject(v) && v["path"] === path && v["structureKind"] === "wood-central",
    )
  );
}

/**
 * Format 1 → 2 (QUESTIONS A38, décisions du 2026-10-11), limon central bois (`wood-central`)
 * seulement ; les autres projets ne changent que de `schemaVersion`.
 *
 * - (14) Une valeur saisie de `lagScrews.minAnchorage` portait sur l'**ancrage total** sous la
 *   marche (L − épaisseur de marche) ; elle porte désormais sur la pénétration de la partie
 *   filetée. L'ancienne valeur est reportée sur `lagScrews.minTotalAnchorage` (si celui-ci est
 *   absent) et `minAnchorage` est supprimé : il repasse en `auto` (6·d sur la partie filetée), qui
 *   n'est qu'un constat en mode « ancrage total », exactement le comportement d'avant A38. Une
 *   valeur validée ◆ de ce chemin suit le report (seulement quand la valeur était saisie : la
 *   validation d'un ancrage `auto` garde son sens et reste en place).
 * - (3) Une valeur saisie de `section.tensionZone` désignait une part de h_res sur toute la
 *   longueur, sans couche en plus : `tensionZoneLayers` = 0 et `tensionZoneLength` = 1 s'ils sont
 *   absents (sens d'avant A38).
 * - (3), (4) et (9) Défauts enregistrés par l'interface : `section.tensionZone` = 0,5 et
 *   `section.minBoardLength` = 150, anciens défauts, sont supprimés sauf validation ◆ sur leur
 *   chemin (la valeur a alors été vue et confirmée) : le projet prend les défauts de la version 2
 *   (bande de [85], longueur minimale `auto`), comme un projet qui ne les enregistrait pas.
 *
 * Tolérante : JSON non validé, tout champ absent ou d'un type inattendu est laissé tel quel (la
 * validation zod qui suit signale ce qui doit l'être).
 */
export const MIGRATION_V1_WOOD_CENTRAL: Migration = {
  from: 1,
  description: msg("project.migration.v1.woodCentral"),
  migrate(json) {
    const stair = json["stair"];
    const structure = isJsonObject(stair) ? stair["structure"] : undefined;
    if (!isJsonObject(structure) || structure["kind"] !== "wood-central") return json;
    const params = structure["params"];
    let anchorageMoved = false;
    if (isJsonObject(params)) {
      const lag = params["lagScrews"];
      if (isJsonObject(lag) && typeof lag["minAnchorage"] === "number") {
        if (lag["minTotalAnchorage"] === undefined) lag["minTotalAnchorage"] = lag["minAnchorage"];
        delete lag["minAnchorage"];
        anchorageMoved = true;
      }
      const section = params["section"];
      if (isJsonObject(section)) {
        if (
          section["tensionZone"] === V1_TENSION_ZONE_DEFAULT &&
          !isValidated(json, TENSION_ZONE_PATH)
        )
          delete section["tensionZone"];
        if (
          section["minBoardLength"] === V1_MIN_BOARD_LENGTH_DEFAULT &&
          !isValidated(json, MIN_BOARD_LENGTH_PATH)
        )
          delete section["minBoardLength"];
      }
      if (isJsonObject(section) && typeof section["tensionZone"] === "number") {
        if (section["tensionZoneLayers"] === undefined) section["tensionZoneLayers"] = 0;
        if (section["tensionZoneLength"] === undefined) section["tensionZoneLength"] = 1;
      }
    }
    // Validation ◆ de l'ancrage saisi : reportée avec la valeur. Un ancrage `auto` (6·d) garde
    // son sens en version 2 : sa validation reste sur `minAnchorage`.
    const validated = json["validatedValues"];
    if (anchorageMoved && Array.isArray(validated)) {
      const hasTotal = validated.some(
        (v) =>
          isJsonObject(v) &&
          v["path"] === LAG_MIN_TOTAL_ANCHORAGE_PATH &&
          v["structureKind"] === "wood-central",
      );
      json["validatedValues"] = validated.flatMap((v: unknown) => {
        if (
          !isJsonObject(v) ||
          v["path"] !== LAG_MIN_ANCHORAGE_PATH ||
          v["structureKind"] !== "wood-central"
        )
          return [v];
        // Une validation déjà posée sur l'ancrage total l'emporte : l'ancienne est retirée.
        return hasTotal ? [] : [{ ...v, path: LAG_MIN_TOTAL_ANCHORAGE_PATH }];
      });
    }
    return json;
  },
};

/**
 * Registre des migrations du format, chaînées depuis la version lue jusqu'à
 * `PROJECT_SCHEMA_VERSION` (`model/project.ts`). Pour un nouveau format : ajouter ici
 * `{ from: <version précédente>, … }` et incrémenter `PROJECT_SCHEMA_VERSION`.
 *
 * - 1 → 2 : limon central bois, ancrage total des tire-fonds et zone tendue des aboutages
 *   (QUESTIONS A38 (14) et (3), `MIGRATION_V1_WOOD_CENTRAL`).
 */
export const PROJECT_MIGRATIONS: readonly Migration[] = [MIGRATION_V1_WOOD_CENTRAL];

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
    throw new ProjectParseError(msg("project.parse.rootNotObject"));
  }
  const version = json["schemaVersion"];
  if (version === undefined) {
    throw new ProjectParseError(msg("project.parse.missingVersion"));
  }
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
    throw new ProjectParseError(
      msg("project.parse.invalidVersion", { received: String(JSON.stringify(version)) }),
    );
  }
  if (version > targetVersion) {
    throw new ProjectParseError(
      msg("project.parse.newerVersion", {
        version: String(version),
        target: String(targetVersion),
      }),
    );
  }
  let current: JsonObject;
  try {
    current = structuredClone(json);
  } catch {
    // Valeur non sérialisable (fonction, symbole…) : ce n'est pas un JSON de projet.
    throw new ProjectParseError(msg("project.parse.notSerializable"));
  }
  let v = version;
  while (v < targetVersion) {
    const step = migrations.find((m) => m.from === v);
    if (step === undefined) {
      throw new ProjectParseError(
        msg("project.parse.missingMigration", { from: String(v), to: String(v + 1) }),
      );
    }
    let next: unknown;
    try {
      next = step.migrate(current);
    } catch (cause) {
      throw new ProjectParseError(
        msg("project.parse.migrationFailed", {
          from: String(v),
          to: String(v + 1),
          description: step.description,
          detail: errorMessage(cause),
        }),
      );
    }
    if (!isJsonObject(next)) {
      throw new ProjectParseError(
        msg("project.parse.migrationNotObject", { from: String(v), to: String(v + 1) }),
      );
    }
    v += 1;
    current = { ...next, schemaVersion: v };
  }
  return current;
}
