/**
 * Saisie et affichage des longueurs (ADR-0003) : saisies en mm **entiers**, affichage en mm
 * ou en cm, arrondi au 0,1 mm (cotes de fabrication). Présentation uniquement : aucune règle
 * métier ici.
 *
 * Langue (ADR-0007) : l'affichage suit la langue passée en paramètre (virgule décimale en
 * français, point en anglais) ; la saisie accepte la virgule **et** le point dans les deux
 * langues. Les messages d'erreur sont des `Message`, traduits à l'affichage.
 */
import { msg, type Locale, type Message } from "@blondel/i18n";
import { numberFormat } from "../i18n/locale.js";

export type DisplayUnit = "mm" | "cm";

export interface IntFieldBounds {
  readonly min?: number;
  readonly max?: number;
}

export type ParseIntResult =
  { readonly ok: true; readonly value: number } | { readonly ok: false; readonly error: Message };

const INT_RE = /^[-+]?\d+$/;

/** Borne entière d'un message d'erreur (séparateur de milliers de la langue). */
const intParam = (value: number) => ({ num: value, digits: 0 });

/** Borne décimale d'un message d'erreur (au plus 6 décimales, sans séparateur de milliers). */
const decimalParam = (value: number) => ({
  num: value,
  digits: 6,
  trimZeros: true,
  grouping: false,
});

/**
 * Lit un entier de millimètres saisi au clavier (espaces et espaces insécables ignorés,
 * pas de décimale). Le message d'erreur est destiné à l'utilisateur.
 */
export function parseIntMm(text: string, bounds: IntFieldBounds = {}): ParseIntResult {
  const t = text.replace(/[\s  ]/g, "");
  if (t === "") return { ok: false, error: msg("ui.common.input.required") };
  if (!INT_RE.test(t)) return { ok: false, error: msg("ui.common.input.integerMm") };
  const value = Number(t);
  if (!Number.isSafeInteger(value)) return { ok: false, error: msg("ui.common.input.tooLarge") };
  if (bounds.min !== undefined && value < bounds.min) {
    return { ok: false, error: msg("ui.common.input.min", { min: intParam(bounds.min) }) };
  }
  if (bounds.max !== undefined && value > bounds.max) {
    return { ok: false, error: msg("ui.common.input.max", { max: intParam(bounds.max) }) };
  }
  return { ok: true, value };
}

const INT: Intl.NumberFormatOptions = { maximumFractionDigits: 0 };
const ONE_DECIMAL: Intl.NumberFormatOptions = {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
};
const TWO_DECIMALS: Intl.NumberFormatOptions = {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
};

/** Entier formaté dans la langue (séparateur de milliers). */
export function formatInt(value: number, locale: Locale): string {
  return numberFormat(locale, INT).format(value);
}

/**
 * Longueur (mm, float64) formatée dans l'unité d'affichage et la langue : 0,1 mm en mm,
 * 0,01 cm en cm. Valeur non finie : tiret.
 */
export function formatLength(
  mm: number | undefined | null,
  unit: DisplayUnit,
  locale: Locale,
): string {
  if (mm === undefined || mm === null || !Number.isFinite(mm)) return "–";
  return unit === "mm"
    ? `${numberFormat(locale, ONE_DECIMAL).format(mm)} mm`
    : `${numberFormat(locale, TWO_DECIMALS).format(mm / 10)} cm`;
}

/**
 * Chiffre clé (mm, sans unité : l'unité est dans la légende) de l'inspecteur et des bandes du
 * panneau libre : mm entiers, cm à 0,1 près, séparateur de milliers. Valeur non finie : tiret.
 */
export function formatFigureLength(
  mm: number | undefined | null,
  unit: DisplayUnit,
  locale: Locale,
): string {
  if (mm === undefined || mm === null || !Number.isFinite(mm)) return "–";
  return unit === "mm"
    ? numberFormat(locale, INT).format(mm)
    : numberFormat(locale, { maximumFractionDigits: 1 }).format(mm / 10);
}

/**
 * Chiffre clé avec son unité (ligne de chiffres sous la vue, maquette 1b : « h 180 mm ») : mm
 * entiers, cm à 0,1 près, comme `formatFigureLength`. Arrondi à l'affichage seulement
 * (ADR-0003). Valeur non finie : tiret.
 */
export function formatFigureLengthWithUnit(
  mm: number | undefined | null,
  unit: DisplayUnit,
  locale: Locale,
): string {
  const value = formatFigureLength(mm, unit, locale);
  return value === "–" ? value : `${value} ${unit}`;
}

/** Durée en millisecondes pour la barre d'état. */
export function formatDuration(ms: number | undefined, locale: Locale): string {
  if (ms === undefined || !Number.isFinite(ms)) return "–";
  return `${numberFormat(locale, ONE_DECIMAL).format(ms)} ms`;
}

/** Valeur mesurée d'un résultat de règle, avec son unité telle que déclarée par la règle. */
export function formatMeasure(
  value: number | undefined | null,
  unit: string | undefined,
  display: DisplayUnit,
  locale: Locale,
): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "–";
  if (unit === "mm") return formatLength(value, display, locale);
  const txt = numberFormat(locale, TWO_DECIMALS).format(value);
  return unit ? `${txt} ${unit}` : txt;
}

export type ParseNumberResult = ParseIntResult;

const DECIMAL_RE = /^[-+]?(\d+([.,]\d*)?|[.,]\d+)$/;

/**
 * Lit un nombre décimal saisi au clavier (virgule ou point, dans les deux langues ; espaces
 * ignorés) : paramètres de plugin non entiers (coefficients, angles). Les longueurs restent en
 * mm entiers (`parseIntMm`).
 */
export function parseDecimal(text: string, bounds: IntFieldBounds = {}): ParseNumberResult {
  const t = text.replace(/[\s  ]/g, "");
  if (t === "") return { ok: false, error: msg("ui.common.input.required") };
  if (!DECIMAL_RE.test(t)) return { ok: false, error: msg("ui.common.input.number") };
  const value = Number(t.replace(",", "."));
  if (!Number.isFinite(value)) return { ok: false, error: msg("ui.common.input.invalid") };
  if (bounds.min !== undefined && value < bounds.min) {
    return { ok: false, error: msg("ui.common.input.min", { min: decimalParam(bounds.min) }) };
  }
  if (bounds.max !== undefined && value > bounds.max) {
    return { ok: false, error: msg("ui.common.input.max", { max: decimalParam(bounds.max) }) };
  }
  return { ok: true, value };
}

const DECIMAL: Intl.NumberFormatOptions = { maximumFractionDigits: 6, useGrouping: false };

/**
 * Nombre décimal pour un champ de saisie, dans la langue (virgule décimale en français, point
 * en anglais ; sans séparateur de milliers). Relu par `parseDecimal` dans les deux langues.
 */
export function formatDecimal(value: number, locale: Locale): string {
  return numberFormat(locale, DECIMAL).format(value);
}

/** Décision de validation d'un champ numérique (Entrée ou perte de focus). */
export type DraftDecision =
  | { readonly kind: "unchanged" }
  | { readonly kind: "invalid"; readonly error: Message }
  | { readonly kind: "commit"; readonly value: number };

/**
 * Saisie appliquée à la validation seulement (pas à chaque frappe) : la valeur n'est appliquée
 * au projet que si elle est valide **et** différente de la valeur courante ; une saisie invalide
 * n'est jamais appliquée (le projet garde sa valeur).
 */
export function decideDraft(
  text: string,
  current: number,
  parse: (text: string) => ParseNumberResult,
): DraftDecision {
  const r = parse(text);
  if (!r.ok) return { kind: "invalid", error: r.error };
  return Object.is(r.value, current) ? { kind: "unchanged" } : { kind: "commit", value: r.value };
}
