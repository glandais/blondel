/**
 * Formulaire générique des paramètres d'un plugin de structure (`StructureKind`) : les champs
 * sont déduits des valeurs par défaut du plugin (`defaults(ctx)`) et, quand il est lisible, du
 * schéma `paramsSchema` (zod 4 : listes de choix, bornes numériques, entiers). Un nombre est
 * saisi en **entier seulement si le schéma le déclare** (`.int()`), jamais d'après son défaut ;
 * un champ numérique facultatif sans défaut (ex. `steel-curved.curved.maxSlopeBreak`) est
 * proposé vide (QUESTIONS D6). Aucune valeur métier ici : les défauts et la validation sont
 * ceux du plugin.
 */
import {
  structureUnsupportedOptions,
  type Model,
  type Project,
  type StructureContext,
  type StructureKind,
  type StructureLayoutTraits,
  type UnsupportedParamOption,
} from "@blondel/core";
import { msg, type Message } from "@blondel/i18n";
import { SCHEMA_PARSE_OPTIONS, schemaIssues } from "./schemaIssues.js";

export type ParamPath = readonly string[];

export type ParamField =
  | {
      readonly kind: "number";
      readonly path: ParamPath;
      readonly label: string;
      /** Entier déclaré par le schéma du plugin (`.int()`) : saisie en mm entiers. */
      readonly integer: boolean;
      readonly min?: number;
      readonly max?: number;
      /**
       * Champ facultatif sans défaut (`z.number().optional()`) : vide = paramètre absent (le
       * plugin applique son comportement par défaut).
       */
      readonly optional?: boolean;
    }
  | {
      readonly kind: "enum";
      readonly path: ParamPath;
      readonly label: string;
      readonly options: readonly string[];
    }
  /** Nombre ou `auto` (union `z.union([z.number(), z.literal("auto")])` du plugin). */
  | {
      readonly kind: "auto-number";
      readonly path: ParamPath;
      readonly label: string;
      readonly integer: boolean;
      readonly min?: number;
      readonly max?: number;
    }
  | { readonly kind: "boolean"; readonly path: ParamPath; readonly label: string }
  | { readonly kind: "text"; readonly path: ParamPath; readonly label: string }
  /** Valeur non éditable dans le formulaire générique (tableau, objet vide…). */
  | { readonly kind: "readonly"; readonly path: ParamPath; readonly label: string };

// ------------------------------------------------------------------ Lecture du schéma zod 4

interface ZodDefLike {
  readonly type?: string;
  readonly shape?: Readonly<Record<string, unknown>>;
  readonly innerType?: unknown;
  readonly entries?: Readonly<Record<string, string | number>>;
  readonly values?: readonly unknown[];
  readonly checks?: readonly unknown[];
  readonly format?: string;
}

function defOf(schema: unknown): ZodDefLike | undefined {
  if (typeof schema !== "object" || schema === null) return undefined;
  const z = (schema as { _zod?: { def?: unknown } })._zod;
  const def = z?.def;
  return typeof def === "object" && def !== null ? (def as ZodDefLike) : undefined;
}

const WRAPPERS = new Set(["default", "prefault", "optional", "nullable", "readonly", "catch"]);

/** Schéma débarrassé des enveloppes (défaut, facultatif…). */
export function unwrapSchema(schema: unknown): unknown {
  let s = schema;
  for (let i = 0; i < 16; i++) {
    const def = defOf(s);
    if (!def || !WRAPPERS.has(def.type ?? "") || def.innerType === undefined) return s;
    s = def.innerType;
  }
  return s;
}

/** Le schéma accepte-t-il l'absence de valeur (`optional` parmi ses enveloppes) ? */
export function isOptionalSchema(schema: unknown): boolean {
  let s = schema;
  for (let i = 0; i < 16; i++) {
    const def = defOf(s);
    if (!def || !WRAPPERS.has(def.type ?? "") || def.innerType === undefined) return false;
    if (def.type === "optional") return true;
    s = def.innerType;
  }
  return false;
}

/** Clés d'un schéma d'objet (ordre de déclaration), vide si ce n'est pas un objet. */
function schemaKeys(schema: unknown): readonly string[] {
  const def = defOf(unwrapSchema(schema));
  return def?.type === "object" && def.shape ? Object.keys(def.shape) : [];
}

/** Sous-schéma d'un champ d'objet (ou `undefined`). */
export function fieldSchema(schema: unknown, key: string): unknown {
  const def = defOf(unwrapSchema(schema));
  return def?.type === "object" ? def.shape?.[key] : undefined;
}

/** Choix d'une énumération (`z.enum`) ou d'une union de littéraux chaîne. */
export function enumOptions(schema: unknown): readonly string[] | undefined {
  const s = unwrapSchema(schema);
  const def = defOf(s);
  if (!def) return undefined;
  if (def.type === "enum" && def.entries) {
    const vals = Object.values(def.entries).filter((v): v is string => typeof v === "string");
    return vals.length > 0 ? vals : undefined;
  }
  if (def.type === "literal" && def.values?.every((v) => typeof v === "string")) {
    return def.values as string[];
  }
  if (def.type === "union") {
    const opts = (def as { options?: readonly unknown[] }).options ?? [];
    const out: string[] = [];
    for (const o of opts) {
      const inner = enumOptions(o);
      if (!inner) return undefined;
      out.push(...inner);
    }
    return out.length > 0 ? out : undefined;
  }
  return undefined;
}

/** Bornes et intégralité lues sur un `z.number()` (propriétés publiques de zod 4). */
export function numberConstraints(schema: unknown): {
  min?: number;
  max?: number;
  integer?: boolean;
} {
  const s = unwrapSchema(schema) as {
    minValue?: unknown;
    maxValue?: unknown;
    isInt?: unknown;
    format?: unknown;
  } | null;
  if (!s || typeof s !== "object" || defOf(s)?.type !== "number") return {};
  const out: { min?: number; max?: number; integer?: boolean } = {};
  // `.int()` de zod 4 pose des bornes implicites ±Number.MAX_SAFE_INTEGER : ce ne sont pas des
  // bornes du plugin (elles s'afficheraient en « Minimum : -9 007 199… »).
  const bound = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && Math.abs(v) < Number.MAX_SAFE_INTEGER;
  if (bound(s.minValue)) out.min = s.minValue;
  if (bound(s.maxValue)) out.max = s.maxValue;
  if (s.isInt === true || (typeof s.format === "string" && /int/.test(s.format))) {
    out.integer = true;
  }
  return out;
}

/**
 * Union « nombre ou `auto` » : contraintes du membre numérique, ou `undefined` si le schéma
 * n'est pas une telle union.
 */
export function autoNumberConstraints(
  schema: unknown,
): { min?: number; max?: number; integer?: boolean } | undefined {
  const def = defOf(unwrapSchema(schema));
  if (def?.type !== "union") return undefined;
  const opts = (def as { options?: readonly unknown[] }).options ?? [];
  let auto = false;
  let num: unknown;
  for (const o of opts) {
    const d = defOf(unwrapSchema(o));
    if (d?.type === "literal" && d.values?.length === 1 && d.values[0] === "auto") auto = true;
    else if (d?.type === "number") num = o;
    else return undefined;
  }
  return auto && num !== undefined ? numberConstraints(num) : undefined;
}

// ------------------------------------------------------------------ Champs

/** Libellé lisible d'une clé (`stringerWidth` → « Stringer width »). */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Champs du formulaire, dans l'ordre des clés des valeurs par défaut ; les objets imbriqués sont
 * aplatis (chemin), les libellés composés « Parent › enfant ».
 */
export function deriveParamFields(
  defaults: unknown,
  schema: unknown,
  prefix: ParamPath = [],
  labelPrefix = "",
): ParamField[] {
  if (!isPlainObject(defaults)) return [];
  const fields: ParamField[] = [];
  for (const [key, value] of Object.entries(defaults)) {
    const path = [...prefix, key];
    const label = labelPrefix
      ? `${labelPrefix} › ${humanizeKey(key).toLowerCase()}`
      : humanizeKey(key);
    const sub = fieldSchema(schema, key);
    const options = enumOptions(sub);
    const autoNum =
      typeof value === "number" || value === "auto" ? autoNumberConstraints(sub) : undefined;
    if (autoNum) {
      fields.push({
        kind: "auto-number",
        path,
        label,
        integer: autoNum.integer === true,
        ...(autoNum.min === undefined ? {} : { min: autoNum.min }),
        ...(autoNum.max === undefined ? {} : { max: autoNum.max }),
      });
    } else if (typeof value === "number") {
      const c = numberConstraints(sub);
      fields.push({
        kind: "number",
        path,
        label,
        integer: c.integer === true,
        ...(c.min === undefined ? {} : { min: c.min }),
        ...(c.max === undefined ? {} : { max: c.max }),
      });
    } else if (typeof value === "boolean") {
      fields.push({ kind: "boolean", path, label });
    } else if (typeof value === "string") {
      fields.push(options ? { kind: "enum", path, label, options } : { kind: "text", path, label });
    } else if (isPlainObject(value) && Object.keys(value).length > 0) {
      fields.push(...deriveParamFields(value, sub, path, label));
    } else {
      fields.push({ kind: "readonly", path, label });
    }
  }
  // Champs numériques facultatifs sans défaut : absents des défauts, lus dans le schéma.
  for (const key of schemaKeys(schema)) {
    if (Object.hasOwn(defaults, key)) continue;
    const sub = fieldSchema(schema, key);
    if (!isOptionalSchema(sub) || defOf(unwrapSchema(sub))?.type !== "number") continue;
    const c = numberConstraints(sub);
    fields.push({
      kind: "number",
      path: [...prefix, key],
      label: labelPrefix ? `${labelPrefix} › ${humanizeKey(key).toLowerCase()}` : humanizeKey(key),
      integer: c.integer === true,
      optional: true,
      ...(c.min === undefined ? {} : { min: c.min }),
      ...(c.max === undefined ? {} : { max: c.max }),
    });
  }
  return fields;
}

/** Valeur d'un chemin dans un objet de paramètres. */
export function getParam(params: unknown, path: ParamPath): unknown {
  let cur: unknown = params;
  for (const k of path) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/**
 * Copie de `params` avec la valeur remplacée au chemin (objets intermédiaires créés) ;
 * `undefined` retire la clé (champ facultatif vidé).
 */
export function setParam(
  params: Readonly<Record<string, unknown>>,
  path: ParamPath,
  value: unknown,
): Record<string, unknown> {
  const [head, ...rest] = path;
  if (head === undefined) return { ...params };
  if (rest.length === 0) {
    if (value !== undefined) return { ...params, [head]: value };
    const { [head]: _removed, ...others } = params;
    return others;
  }
  const child = params[head];
  return { ...params, [head]: setParam(isPlainObject(child) ? child : {}, rest, value) };
}

/**
 * Contexte d'un plugin de structure : disponible dès que le tracé et le découpage sont calculés,
 * **même si le modèle porte d'autres erreurs** (échappée, contrôle, erreurs rapportées par le
 * plugin lui-même) — sinon le formulaire disparaîtrait précisément quand un paramètre de la
 * structure doit être corrigé. `undefined` sur un modèle partiel (tracé ou découpage en échec).
 */
export function structureContext(
  project: Project,
  model: Pick<Model, "layout" | "stepping"> | null | undefined,
): StructureContext | undefined {
  if (!model) return undefined;
  const { layout, stepping } = model;
  const layoutOk = layout.walkline.segments.length > 0;
  const steppingOk = stepping.treads.length > 0 && Number.isFinite(stepping.going);
  return layoutOk && steppingOk ? { project, layout, stepping } : undefined;
}

/** Paramètres par défaut d'un plugin ; `undefined` s'ils ne sont pas calculables (modèle partiel). */
export function safeDefaults(kind: StructureKind, ctx: StructureContext | undefined): unknown {
  if (!ctx) return undefined;
  try {
    return kind.defaults(ctx);
  } catch {
    return undefined;
  }
}

/**
 * Valide des paramètres par le schéma du plugin : `null` si valides, sinon le premier problème
 * (chemin compris), traduit à l'affichage.
 */
export function validateParams(kind: StructureKind, params: unknown): Message | null {
  const r = kind.paramsSchema.safeParse(params, SCHEMA_PARSE_OPTIONS);
  if (r.success) return null;
  return schemaIssues(r.error)[0] ?? msg("ui.lib.structure.refused");
}

/**
 * Paramètres complétés par les défauts du plugin (objets fusionnés récursivement, valeurs du
 * projet prioritaires) : un projet importé avec des paramètres partiels reste éditable champ
 * par champ.
 */
export function withDefaults(defaults: unknown, params: unknown): Record<string, unknown> {
  const base = isPlainObject(defaults) ? defaults : {};
  const own = isPlainObject(params) ? params : {};
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(own)) {
    if (k === "__proto__") continue;
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? withDefaults(base[k], v) : v;
  }
  return out;
}

// ------------------------------------------------------------------ Options non prises en charge

/**
 * Tracé du projet vu par les capacités des plugins : type (volées ou hélicoïdal) et nombre de
 * tournants (0 en hélicoïdal). Lecture du projet seulement.
 */
export function layoutTraitsOf(project: Project): StructureLayoutTraits {
  const layout = project.stair.layout;
  return layout.kind === "helical"
    ? { kind: "helical", turns: 0 }
    : { kind: "flights", turns: layout.turns.length };
}

/**
 * Choix de paramètres que le plugin `kind` déclare ne pas savoir construire sur le tracé du
 * projet (`capabilities.unsupportedOptions`, ex. section tube du limon central sur un tournant) :
 * l'interface les grise avec leur raison. Lecture d'une capacité, aucun calcul ; vide si le
 * plugin ne déclare rien ou lève.
 */
export function unsupportedOptionsOf(
  kind: string,
  project: Project,
): readonly UnsupportedParamOption[] {
  try {
    return structureUnsupportedOptions(kind, layoutTraitsOf(project));
  } catch {
    return [];
  }
}
