/**
 * Saisie et affichage des longueurs (ADR-0003) : saisies en mm **entiers**, affichage en mm
 * ou en cm, arrondi au 0,1 mm (cotes de fabrication). Présentation uniquement : aucune règle
 * métier ici.
 */

export type DisplayUnit = "mm" | "cm";

export interface IntFieldBounds {
  readonly min?: number;
  readonly max?: number;
}

export type ParseIntResult =
  { readonly ok: true; readonly value: number } | { readonly ok: false; readonly error: string };

const INT_RE = /^[-+]?\d+$/;

/**
 * Lit un entier de millimètres saisi au clavier (espaces et espaces insécables ignorés,
 * pas de décimale). Le message d'erreur est destiné à l'utilisateur.
 */
export function parseIntMm(text: string, bounds: IntFieldBounds = {}): ParseIntResult {
  const t = text.replace(/[\s  ]/g, "");
  if (t === "") return { ok: false, error: "Valeur requise." };
  if (!INT_RE.test(t)) return { ok: false, error: "Entrer un nombre entier de millimètres." };
  const value = Number(t);
  if (!Number.isSafeInteger(value)) return { ok: false, error: "Nombre trop grand." };
  if (bounds.min !== undefined && value < bounds.min) {
    return { ok: false, error: `Minimum : ${formatInt(bounds.min)}.` };
  }
  if (bounds.max !== undefined && value > bounds.max) {
    return { ok: false, error: `Maximum : ${formatInt(bounds.max)}.` };
  }
  return { ok: true, value };
}

const intFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});
const twoDecimals = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** Entier formaté à la française (séparateur de milliers). */
export function formatInt(value: number): string {
  return intFmt.format(value);
}

/**
 * Longueur (mm, float64) formatée dans l'unité d'affichage : 0,1 mm en mm, 0,01 cm en cm.
 * Valeur non finie : tiret.
 */
export function formatLength(mm: number | undefined | null, unit: DisplayUnit): string {
  if (mm === undefined || mm === null || !Number.isFinite(mm)) return "–";
  return unit === "mm" ? `${oneDecimal.format(mm)} mm` : `${twoDecimals.format(mm / 10)} cm`;
}

/** Durée en millisecondes pour la barre d'état. */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "–";
  return `${oneDecimal.format(ms)} ms`;
}

/** Valeur mesurée d'un résultat de règle, avec son unité telle que déclarée par la règle. */
export function formatMeasure(
  value: number | undefined | null,
  unit: string | undefined,
  display: DisplayUnit,
): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "–";
  if (unit === "mm") return formatLength(value, display);
  const txt = twoDecimals.format(value);
  return unit ? `${txt} ${unit}` : txt;
}
