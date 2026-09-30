/**
 * Erreurs de lecture d'un projet (ADR-0007) : messages structurés (`Message`), traduits à
 * l'affichage ; le texte français (`Error.message`) reste celui d'avant l'internationalisation.
 */
import {
  DEFAULT_LOCALE,
  MessageError,
  isMessage,
  isMessageError,
  msg,
  textMessage,
  translatorFor,
  type Message,
  type MessageKey,
} from "@blondel/i18n";
import { z } from "zod";

/** Un problème localisé dans le JSON du projet. */
export interface ProjectIssue {
  /** Chemin technique, ex. `stair.layout.legs[0].length` (vide = racine). */
  readonly path: string;
  /** Libellé métier du champ (dernière clé du chemin), s'il est connu : « hauteur à monter ». */
  readonly field?: Message;
  readonly message: Message;
}

/**
 * Ligne d'un problème : « chemin (libellé) : message », « (racine) : message » à la racine.
 * Même texte français qu'avant l'internationalisation.
 */
export function projectIssueMessage(issue: ProjectIssue): Message {
  const path: Message =
    issue.path === ""
      ? msg("project.issue.root")
      : issue.field !== undefined
        ? msg("project.issue.pathWithField", { path: issue.path, field: issue.field })
        : textMessage(issue.path);
  return msg("project.issue.line", { path, message: issue.message });
}

const FR = translatorFor(DEFAULT_LOCALE);

/**
 * Erreur levée par `parseProject` / `parseProjectText`. `msg` : résumé ; `issues` : problèmes
 * localisés ; `message` (français) : résumé suivi d'une ligne « - chemin : problème » par
 * problème, comme avant l'internationalisation.
 */
export class ProjectParseError extends MessageError {
  override readonly name = "ProjectParseError";
  readonly issues: readonly ProjectIssue[];

  constructor(summary: Message, issues: readonly ProjectIssue[] = []) {
    super(summary);
    this.issues = issues;
    if (issues.length > 0) {
      const lines = issues.map((i) => `- ${FR.t(projectIssueMessage(i))}`);
      this.message = `${this.message}\n${lines.join("\n")}`;
    }
  }
}

/**
 * `RangeError` portant un `Message` (options incohérentes d'un préréglage, d'un recalage, d'une
 * saisie) : `msg` est la donnée, `message` sa traduction française. Garde la classe
 * `RangeError` sur laquelle s'appuient les appelants (`instanceof RangeError`).
 */
export class MessageRangeError extends RangeError {
  readonly msg: Message;

  constructor(message: Message, options?: { readonly cause?: unknown }) {
    super(FR.t(message), options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "RangeError";
    this.msg = message;
  }
}

/**
 * `Message` d'une exception : `msg` d'une `MessageError` ou d'une `MessageRangeError`, sinon le
 * texte brut de l'erreur (non traduit).
 */
export function errorMessageOf(error: unknown): Message {
  if (isMessageError(error) || error instanceof MessageRangeError) return error.msg;
  return textMessage(error instanceof Error ? error.message : String(error));
}

/** Libellés métier des champs principaux, ajoutés entre parenthèses au chemin. */
const FIELD_LABELS: Readonly<Record<string, MessageKey>> = {
  schemaVersion: "project.field.schemaVersion",
  floorToFloor: "project.field.floorToFloor",
  upperSlabThickness: "project.field.upperSlabThickness",
  lowerFinish: "project.field.lowerFinish",
  upperFinish: "project.field.upperFinish",
  opening: "project.field.opening",
  width: "project.field.width",
  legs: "project.field.legs",
  length: "project.field.length",
  turns: "project.field.turns",
  riserCount: "project.field.riserCount",
  targetRise: "project.field.targetRise",
  targetGoing: "project.field.targetGoing",
  thickness: "project.field.thickness",
  nosing: "project.field.nosing",
  outerRadius: "project.field.outerRadius",
  core: "project.field.core",
  sweep: "project.field.sweep",
  startAngle: "project.field.startAngle",
  landing: "project.field.landing",
};

/** Convertit un chemin zod en chemin technique `a.b[0].c`. */
export function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const key of path) {
    if (typeof key === "number") out += `[${key}]`;
    else out += out === "" ? String(key) : `.${String(key)}`;
  }
  return out;
}

/** Libellé métier du champ désigné par un chemin zod (dernière clé textuelle), s'il est connu. */
export function fieldLabel(path: readonly PropertyKey[]): Message | undefined {
  const last = [...path].reverse().find((k) => typeof k === "string");
  const key =
    typeof last === "string" && Object.hasOwn(FIELD_LABELS, last) ? FIELD_LABELS[last] : undefined;
  return key !== undefined ? msg(key) : undefined;
}

// ------------------------------------------------------------------ messages des issues zod

/**
 * Types nommés dans les messages de zod (reprise du dictionnaire de la locale française de
 * zod 4, `z.locales.fr`) ; type absent : nom brut.
 */
const TYPE_LABELS: Readonly<Record<string, MessageKey>> = {
  string: "project.issue.type.string",
  number: "project.issue.type.number",
  int: "project.issue.type.int",
  boolean: "project.issue.type.boolean",
  bigint: "project.issue.type.bigint",
  symbol: "project.issue.type.symbol",
  undefined: "project.issue.type.undefined",
  null: "project.issue.type.null",
  never: "project.issue.type.never",
  void: "project.issue.type.void",
  date: "project.issue.type.date",
  array: "project.issue.type.array",
  object: "project.issue.type.object",
  tuple: "project.issue.type.tuple",
  record: "project.issue.type.record",
  map: "project.issue.type.map",
  set: "project.issue.type.set",
  file: "project.issue.type.file",
  nonoptional: "project.issue.type.nonoptional",
  nan: "project.issue.type.nan",
  function: "project.issue.type.function",
};

/** Unités des grandeurs « de taille » (longueur d'une chaîne, d'un tableau…). */
const SIZE_UNITS: Readonly<Record<string, MessageKey>> = {
  string: "project.issue.unit.characters",
  file: "project.issue.unit.bytes",
  array: "project.issue.unit.elements",
  set: "project.issue.unit.elements",
};

/**
 * Messages personnalisés des schémas (`.regex(…, "texte")`) : zod ne garde que le texte ; la
 * clé est retrouvée par son texte français. `site.underlay.imageDataUrl` : `site/schema.ts` ;
 * `project.issue.hexColor` : `model/project.ts` (couleurs de l'apparence).
 */
const CUSTOM_MESSAGE_KEYS: readonly MessageKey[] = [
  "site.underlay.imageDataUrl",
  "project.issue.hexColor",
];

function typeLabel(name: string): Message {
  const key = Object.hasOwn(TYPE_LABELS, name) ? TYPE_LABELS[name] : undefined;
  return key !== undefined ? msg(key) : textMessage(name);
}

/** Issue brute (carte d'erreurs) ou finale (`ZodError.issues`) : champs lus par `zodIssueMessage`. */
type AnyIssue = z.core.$ZodRawIssue | z.core.$ZodIssue;

/** Champ quelconque d'une issue (les champs dépendent du code). */
function field<T>(issue: AnyIssue, name: string): T | undefined {
  return (issue as unknown as Readonly<Record<string, T>>)[name];
}

/**
 * Message structuré d'une issue zod, calculé à partir de ses champs (code, types, bornes) : le
 * texte français est celui de la locale française de zod 4 (plus le message des unions
 * discriminées de Blondel). `invalid_type` a besoin de la valeur reçue (`input`, conservé par
 * `reportInput: true` dans une issue finale) ; sans elle, le texte de l'issue est repris tel
 * quel. Messages propres aux schémas : `params.message` (issue `custom` de Blondel), sinon texte
 * reconnu (`CUSTOM_MESSAGE_KEYS`) ou repris tel quel.
 */
export function zodIssueMessage(issue: AnyIssue): Message {
  const u = z.core.util;
  const custom = field<Record<string, unknown>>(issue, "params")?.["message"];
  if (isMessage(custom)) return custom;
  const computed = computedIssueMessage(issue);
  const text = issue.message;
  if (typeof text === "string" && text !== "" && (computed === null || FR.t(computed) !== text)) {
    const known = CUSTOM_MESSAGE_KEYS.find((k) => FR.t(k) === text);
    return known !== undefined ? msg(known) : textMessage(text);
  }
  return computed ?? msg("project.issue.invalid");

  function computedIssueMessage(iss: AnyIssue): Message | null {
    switch (iss.code) {
      case "invalid_type": {
        if (!("input" in iss)) return null;
        const expected = String(field<string>(iss, "expected"));
        const received = typeLabel(u.parsedType(iss.input));
        return /^[A-Z]/.test(expected)
          ? msg("project.issue.invalidTypeInstance", { expected, received })
          : msg("project.issue.invalidType", { expected: typeLabel(expected), received });
      }
      case "invalid_value": {
        const values = field<readonly z.core.util.Primitive[]>(iss, "values") ?? [];
        return values.length === 1
          ? msg("project.issue.invalidValue", { expected: u.stringifyPrimitive(values[0]) })
          : msg("project.issue.invalidOption", { values: u.joinValues([...values], "|") });
      }
      case "too_big":
      case "too_small": {
        const big = iss.code === "too_big";
        const origin = String(field<string>(iss, "origin"));
        const subject = Object.hasOwn(TYPE_LABELS, origin)
          ? msg(TYPE_LABELS[origin]!)
          : msg("project.issue.value");
        const inclusive = field<boolean>(iss, "inclusive") === true;
        const relation = big ? (inclusive ? "<=" : "<") : inclusive ? ">=" : ">";
        const limit = String(field<unknown>(iss, big ? "maximum" : "minimum"));
        const unitKey = Object.hasOwn(SIZE_UNITS, origin) ? SIZE_UNITS[origin] : undefined;
        if (unitKey !== undefined) {
          return msg(big ? "project.issue.tooBigSize" : "project.issue.tooSmallSize", {
            subject,
            relation,
            limit,
            unit: msg(unitKey),
          });
        }
        return msg(big ? "project.issue.tooBig" : "project.issue.tooSmall", {
          subject,
          relation,
          limit,
        });
      }
      case "invalid_format": {
        const format = String(field<string>(iss, "format"));
        if (format === "starts_with")
          return msg("project.issue.format.startsWith", {
            prefix: String(field<string>(iss, "prefix")),
          });
        if (format === "ends_with")
          return msg("project.issue.format.endsWith", {
            suffix: String(field<string>(iss, "suffix")),
          });
        if (format === "includes")
          return msg("project.issue.format.includes", {
            includes: String(field<string>(iss, "includes")),
          });
        if (format === "regex")
          return msg("project.issue.format.regex", {
            pattern: String(field<unknown>(iss, "pattern")),
          });
        return msg("project.issue.format.other", { format });
      }
      case "not_multiple_of":
        return msg("project.issue.notMultipleOf", {
          divisor: String(field<unknown>(iss, "divisor")),
        });
      case "unrecognized_keys": {
        const keys = field<readonly string[]>(iss, "keys") ?? [];
        return msg("project.issue.unrecognizedKeys", {
          count: keys.length > 1 ? 2 : 1,
          keys: u.joinValues([...keys], ", "),
        });
      }
      case "invalid_key":
        return msg("project.issue.invalidKey", { origin: String(field<string>(iss, "origin")) });
      case "invalid_element":
        return msg("project.issue.invalidElement", {
          origin: String(field<string>(iss, "origin")),
        });
      case "invalid_union": {
        const discriminator = field<unknown>(iss, "discriminator");
        if (typeof discriminator === "string") {
          const options = field<unknown>(iss, "options");
          const list = Array.isArray(options)
            ? options
                // Discriminant facultatif (tracé à volées sans `kind`) : valeur absente non listée.
                .filter((o) => o !== undefined && o !== null)
                .map((o) => JSON.stringify(o))
                .join(", ")
            : "";
          return msg("project.issue.unknownDiscriminator", { discriminator, options: list });
        }
        return msg("project.issue.invalid");
      }
      default:
        return msg("project.issue.invalid");
    }
  }
}

/**
 * Carte d'erreurs zod de la lecture d'un projet : texte français de `zodIssueMessage` (locale
 * française de zod, précisée pour les unions discriminées).
 */
export const projectErrorMap: z.core.$ZodErrorMap = (issue) => FR.t(zodIssueMessage(issue));

/**
 * Convertit une erreur zod en liste de problèmes. Pour les messages de type, l'analyse doit
 * conserver les valeurs reçues (`reportInput: true`, comme `parseProject`).
 */
export function issuesFromZod(error: z.ZodError): ProjectIssue[] {
  return error.issues.map((issue) => {
    const label = fieldLabel(issue.path);
    return {
      path: formatPath(issue.path),
      ...(label !== undefined ? { field: label } : {}),
      message: zodIssueMessage(issue),
    };
  });
}
