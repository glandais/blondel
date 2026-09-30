/**
 * Internationalisation de Blondel (ADR-0007) : messages structurés, dictionnaires plats par
 * langue et mise en forme des nombres et des dates.
 *
 * - Le `Model` et les erreurs ne contiennent que des `Message` neutres (`{ key, params }`) ; la
 *   traduction a lieu à l'affichage et dans les exports, par un `Translator`.
 * - `locales/fr.json` fait foi : `MessageKey` en est dérivé, une clé inconnue ne compile pas.
 * - Aucune dépendance, aucun DOM : utilisable par core, geometry, exports, le worker et l'UI.
 */
import fr from "./locales/fr.json" with { type: "json" };
import en from "./locales/en.json" with { type: "json" };
import { WIP_EN, WIP_FR } from "./locales/wip";

/** Langues disponibles. */
export type Locale = "fr" | "en";

export const LOCALES: readonly Locale[] = ["fr", "en"];

/**
 * Langue par défaut de core et des exports (stabilité des exemples et des instantanés) ; l'UI
 * part de la langue du navigateur (`detectLocale`).
 */
export const DEFAULT_LOCALE: Locale = "fr";

/**
 * Clés présentes dans `fr.json` (dictionnaire de référence), plus celles des fragments de
 * migration déclarés dans `locales/wip.ts` (vides hors des vagues).
 */
export type LocaleKey = keyof typeof fr | keyof typeof WIP_FR;

/** Base d'une clé plurielle : `x` pour `x.one` / `x.other`. */
type PluralBase<K extends string> = K extends `${infer B}.one`
  ? B
  : K extends `${infer B}.other`
    ? B
    : never;

/**
 * Clé de message : une clé de `fr.json`, ou la base d'une clé plurielle (`x` quand `x.one` et
 * `x.other` existent ; la variante est choisie par le paramètre `count`).
 */
export type MessageKey = LocaleKey | PluralBase<LocaleKey>;

/** Nombre à mettre en forme dans la langue d'affichage (arrondi à l'affichage seulement, ADR-0003). */
export interface NumberParam {
  readonly num: number;
  /** Décimales affichées (défaut 1). */
  readonly digits?: number;
  /** Unité ajoutée après une espace (insécable en français), par exemple « mm ». */
  readonly unit?: string;
  /** Supprime les zéros décimaux inutiles. */
  readonly trimZeros?: boolean;
  /**
   * `false` : aucun séparateur de milliers (« 1900 » au lieu de « 1 900 » / « 1,900 »). Défaut :
   * séparateur de la langue.
   */
  readonly grouping?: boolean;
}

/**
 * Paramètre d'un message :
 * - `string` : texte brut, jamais traduit (repère, nom de projet…) ;
 * - `number` : nombre brut, affiché avec au plus 3 décimales, zéros inutiles supprimés
 *   (typiquement `count`) ;
 * - `NumberParam` : nombre mis en forme selon la langue ;
 * - `Message` : message imbriqué, traduit dans la même langue.
 */
export type MessageParam = string | number | NumberParam | Message;

export interface Message {
  readonly key: MessageKey;
  readonly params?: Readonly<Record<string, MessageParam>>;
}

/** Construit un `Message`. */
export function msg(key: MessageKey, params?: Readonly<Record<string, MessageParam>>): Message {
  return params === undefined ? { key } : { key, params };
}

/** Paramètre numérique : `num(180.667, 1, "mm")`. */
export function num(x: number, digits?: number, unit?: string): NumberParam {
  const p: { num: number; digits?: number; unit?: string } = { num: x };
  if (digits !== undefined) p.digits = digits;
  if (unit !== undefined) p.unit = unit;
  return p;
}

/**
 * Nombre « décimal court », rendu exactement comme l'ancien `fmt(x, digits)` de core : arrondi à
 * `digits` décimales (défaut 1) par `Math.round`, zéros inutiles supprimés, sans séparateur de
 * milliers (fr : « 1900,5 », en : « 1900.5 »). L'unité éventuelle suit les règles de `num`
 * (espace insécable en français) : pour garder une espace simple, la mettre dans le texte.
 */
export function dec(x: number, digits = 1, unit?: string): NumberParam {
  const f = 10 ** digits;
  const rounded = Number.isFinite(x) ? Math.round(x * f) / f : x;
  const p: {
    num: number;
    digits: number;
    trimZeros: true;
    grouping: false;
    unit?: string;
  } = { num: rounded, digits, trimZeros: true, grouping: false };
  if (unit !== undefined) p.unit = unit;
  return p;
}

export function isMessage(value: unknown): value is Message {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { key?: unknown }).key === "string" &&
    !("num" in value)
  );
}

function isNumberParam(value: unknown): value is NumberParam {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { num?: unknown }).num === "number"
  );
}

export function isLocale(value: unknown): value is Locale {
  return value === "fr" || value === "en";
}

/** Langue à partir de `navigator.language` : `en*` → anglais, tout le reste → français. */
export function detectLocale(navigatorLanguage?: string): Locale {
  return navigatorLanguage !== undefined && /^en\b/i.test(navigatorLanguage.trim()) ? "en" : "fr";
}

/** Dictionnaire d'une langue (clé → texte). */
export type Messages = Readonly<Record<string, string>>;

const DICTIONARIES: Readonly<Record<Locale, Messages>> = {
  fr: { ...WIP_FR, ...fr },
  en: { ...WIP_EN, ...en },
};

/** Dictionnaire brut d'une langue (tests, outils). */
export function messagesFor(locale: Locale): Messages {
  return DICTIONARIES[locale];
}

/** Espace insécable fine (séparateur de milliers typographique français). */
export const NARROW_NBSP = " ";
/** Espace insécable (entre une valeur et son unité en français). */
export const NBSP = " ";

export interface NumOptions {
  /** Décimales affichées (défaut 1). */
  readonly digits?: number;
  /** Séparateur de milliers ; défaut : espace fine insécable (fr), virgule (en) ; "" pour aucun. */
  readonly thousands?: string;
  /** Supprime les zéros décimaux inutiles (« 250 » au lieu de « 250,0 »). Défaut : false. */
  readonly trimZeros?: boolean;
  /** Unité ajoutée après la valeur (espace insécable en français, espace simple en anglais). */
  readonly unit?: string;
}

export interface Translator {
  readonly locale: Locale;
  /** Traduit un message ou une clé ; une clé absente donne la clé elle-même (jamais d'exception). */
  t(message: Message | MessageKey, params?: Readonly<Record<string, MessageParam>>): string;
  /** Nombre dans la langue ; « — » pour une valeur non finie, « -0 » affiché « 0 ». */
  num(x: number, options?: NumOptions): string;
  /** Date : JJ/MM/AAAA (fr), AAAA-MM-JJ (en) ; « — » pour une date invalide. */
  date(d: Date): string;
  /** Comparaison de textes selon la langue (tri des nomenclatures, des listes). */
  compare(a: string, b: string): number;
}

interface LocaleFormat {
  readonly decimal: string;
  readonly thousands: string;
  /**
   * Séparateur valeur / unité. Français : espace insécable (règle typographique, pas de coupure
   * entre « 180,7 » et « mm ») ; anglais : espace simple, usage courant des documents techniques.
   */
  readonly unitSpace: string;
}

const FORMATS: Readonly<Record<Locale, LocaleFormat>> = {
  fr: { decimal: ",", thousands: NARROW_NBSP, unitSpace: NBSP },
  en: { decimal: ".", thousands: ",", unitSpace: " " },
};

/** Unités accolées à la valeur, sans espace. */
const UNITS_WITHOUT_SPACE: ReadonlySet<string> = new Set(["°", "′", "″"]);

/**
 * Décimales utilisables par `toFixed` (entier de 0 à 100) : une valeur hors plage ne doit pas
 * lever d'exception à l'affichage. Défaut 1.
 */
function safeDigits(digits: number | undefined): number {
  if (digits === undefined || !Number.isFinite(digits)) return 1;
  return Math.min(100, Math.max(0, Math.trunc(digits)));
}

/**
 * Mise en forme d'un nombre. Rend exactement l'ancien `formatFr` de `@blondel/exports` pour le
 * français (virgule, espace fine insécable, `-0` → `0`, non fini → « — »).
 */
function formatNumber(value: number, format: LocaleFormat, options: NumOptions = {}): string {
  if (!Number.isFinite(value)) return "—";
  const digits = safeDigits(options.digits);
  const thousands = options.thousands ?? format.thousands;
  let text = value.toFixed(digits);
  if (/^-0(\.0*)?$/.test(text)) text = text.slice(1);
  let [int = "0", frac = ""] = text.split(".");
  if (options.trimZeros === true) frac = frac.replace(/0+$/, "");
  const negative = int.startsWith("-");
  const intDigits = negative ? int.slice(1) : int;
  const grouped =
    thousands === "" ? intDigits : intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  const out = `${negative ? "-" : ""}${grouped}${frac !== "" ? `${format.decimal}${frac}` : ""}`;
  if (options.unit === undefined || options.unit === "") return out;
  // Symboles collés à la valeur dans les deux langues (« 42° »).
  const space = UNITS_WITHOUT_SPACE.has(options.unit) ? "" : format.unitSpace;
  return `${out}${space}${options.unit}`;
}

/** Nombre de décimales d'un nombre brut (`number`) passé en paramètre. */
const RAW_NUMBER_DIGITS = 3;

/** Noms des paramètres `{name}` d'un texte, dans l'ordre, sans doublon. */
export function listPlaceholders(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
    const name = m[1]!;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Traducteur sur un dictionnaire quelconque (tests, fragments en cours de migration). Les
 * applications passent par `createTranslator`.
 */
export function createTranslatorFrom(locale: Locale, messages: Messages): Translator {
  const format = FORMATS[locale];
  const plural = new Intl.PluralRules(locale);
  const pluralByDigits = new Map<number, Intl.PluralRules>();
  const collator = new Intl.Collator(locale);

  const numFn = (x: number, options?: NumOptions): string => formatNumber(x, format, options);

  const pluralCategory = (count: MessageParam): string | undefined => {
    if (typeof count === "number") {
      // Valeur telle qu'affichée (au plus RAW_NUMBER_DIGITS décimales) : 1,0004 s'affiche « 1 ».
      return Number.isFinite(count)
        ? plural.select(Number(count.toFixed(RAW_NUMBER_DIGITS)))
        : undefined;
    }
    if (isNumberParam(count)) {
      if (!Number.isFinite(count.num)) return undefined;
      const digits = safeDigits(count.digits);
      const rounded = Number(count.num.toFixed(digits));
      // Même rendu que l'affichage : « 1,0 » (zéros conservés) n'est pas singulier en anglais.
      const minimumFractionDigits = count.trimZeros === true ? 0 : digits;
      let rules = pluralByDigits.get(minimumFractionDigits);
      if (rules === undefined) {
        rules = new Intl.PluralRules(locale, { minimumFractionDigits });
        pluralByDigits.set(minimumFractionDigits, rules);
      }
      return rules.select(rounded);
    }
    return undefined;
  };

  const resolve = (key: string, params?: Readonly<Record<string, MessageParam>>): string => {
    const count = params?.["count"];
    if (count !== undefined) {
      const category = pluralCategory(count);
      if (category !== undefined) {
        const text = messages[`${key}.${category}`] ?? messages[`${key}.other`];
        if (text !== undefined) return text;
      }
    }
    return messages[key] ?? messages[`${key}.other`] ?? key;
  };

  const renderParam = (p: MessageParam): string => {
    if (typeof p === "string") return p;
    if (typeof p === "number") return numFn(p, { digits: RAW_NUMBER_DIGITS, trimZeros: true });
    if (isNumberParam(p)) {
      const options: { digits?: number; trimZeros?: boolean; unit?: string; thousands?: string } =
        {};
      if (p.digits !== undefined) options.digits = p.digits;
      if (p.trimZeros !== undefined) options.trimZeros = p.trimZeros;
      if (p.unit !== undefined) options.unit = p.unit;
      if (p.grouping === false) options.thousands = "";
      return numFn(p.num, options);
    }
    if (isMessage(p)) return t(p);
    return String(p);
  };

  function t(
    message: Message | MessageKey,
    params?: Readonly<Record<string, MessageParam>>,
  ): string {
    const key: string = typeof message === "string" ? message : message.key;
    const all =
      typeof message === "string" || message.params === undefined
        ? params
        : params === undefined
          ? message.params
          : { ...message.params, ...params };
    const text = resolve(key, all);
    if (all === undefined) return text;
    return text.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) => {
      const p = all[name];
      return p === undefined ? whole : renderParam(p);
    });
  }

  const date = (d: Date): string => {
    if (Number.isNaN(d.getTime())) return "—";
    const p = (n: number): string => String(n).padStart(2, "0");
    return locale === "fr"
      ? `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
      : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  return { locale, t, num: numFn, date, compare: (a, b) => collator.compare(a, b) };
}

const TRANSLATORS = new Map<Locale, Translator>();

/** Traducteur d'une langue, mémoïsé (un seul objet par langue). */
export function createTranslator(locale: Locale): Translator {
  let translator = TRANSLATORS.get(locale);
  if (translator === undefined) {
    translator = createTranslatorFrom(locale, DICTIONARIES[locale]);
    TRANSLATORS.set(locale, translator);
  }
  return translator;
}

/** Traducteur de la langue donnée, français par défaut (tests, exports sans option `locale`). */
export function translatorFor(locale: Locale = DEFAULT_LOCALE): Translator {
  return createTranslator(locale);
}

// ------------------------------------------------------------------ Messages et exceptions

/**
 * Texte brut sans traduction (repère de pièce, texte saisi, détail technique d'une erreur
 * interne) là où un `Message` est attendu : clé `common.text` = « {text} ».
 */
export function textMessage(text: string): Message {
  return msg("common.text", { text });
}

/** Égalité structurelle de deux paramètres de message (nombres, textes, messages imbriqués). */
function paramEquals(a: MessageParam, b: MessageParam): boolean {
  if (typeof a !== "object" || typeof b !== "object") return Object.is(a, b);
  if (isNumberParam(a) || isNumberParam(b)) {
    if (!isNumberParam(a) || !isNumberParam(b)) return false;
    return (
      Object.is(a.num, b.num) &&
      a.digits === b.digits &&
      a.unit === b.unit &&
      a.trimZeros === b.trimZeros &&
      a.grouping === b.grouping
    );
  }
  return messageEquals(a, b);
}

/**
 * Égalité structurelle de deux messages (même clé, mêmes paramètres, récursivement). Remplace la
 * comparaison des anciens messages en texte (`===`, `includes`, `Set<string>`).
 */
export function messageEquals(a: Message, b: Message): boolean {
  if (a === b) return true;
  if (a.key !== b.key) return false;
  const pa = a.params ?? {};
  const pb = b.params ?? {};
  const ka = Object.keys(pa);
  if (ka.length !== Object.keys(pb).length) return false;
  return ka.every((k) => k in pb && paramEquals(pa[k]!, pb[k]!));
}

/**
 * Exception métier portant un `Message` (ADR-0007). `msg` est la donnée, reprise telle quelle
 * dans `Model.errors` (le modèle ne contient jamais l'objet exception) ; `message` en est la
 * traduction **française** (journaux, débogage, assertions `toThrow(/texte/)` des tests). Les
 * erreurs métier des étapes (`LayoutError`, `SteppingError`, `StructureError`, `GuardError`…)
 * en héritent.
 */
export class MessageError extends Error {
  readonly msg: Message;

  constructor(message: Message, options?: { readonly cause?: unknown }) {
    super(
      translatorFor(DEFAULT_LOCALE).t(message),
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = "MessageError";
    this.msg = message;
  }
}

/** Vrai pour une `MessageError` (ou une sous-classe). */
export function isMessageError(value: unknown): value is MessageError {
  return value instanceof MessageError;
}

/**
 * `Message` d'une exception quelconque : `msg` d'une `MessageError`, sinon le texte brut de
 * l'erreur (`textMessage`, non traduit : erreur interne, bibliothèque tierce).
 */
export function errorMessage(error: unknown): Message {
  if (isMessageError(error)) return error.msg;
  return textMessage(error instanceof Error ? error.message : String(error));
}
