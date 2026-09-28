/**
 * Mise en forme des nombres et échappements communs aux exports.
 *
 * Arrondi (ADR-0003) : les grandeurs restent en float64 jusqu'ici ; l'arrondi n'a lieu qu'à
 * l'affichage (0,1 mm pour les cotes de fabrication, 1 mm pour l'implantation).
 */

/** Espace insécable fine (séparateur de milliers typographique français). */
export const NARROW_NBSP = " ";

export interface FrNumberOptions {
  /** Nombre de décimales affichées (défaut 1). */
  readonly decimals?: number;
  /** Séparateur de milliers (défaut : espace insécable fine ; "" pour aucun). */
  readonly thousands?: string;
  /** Supprime les zéros décimaux inutiles (« 250 » au lieu de « 250,0 »). Défaut : false. */
  readonly trimZeros?: boolean;
}

/**
 * Nombre au format français : virgule décimale, séparateur de milliers paramétrable.
 * `-0` est affiché « 0 ». Les valeurs non finies donnent « — ».
 */
export function formatFr(value: number, options: FrNumberOptions = {}): string {
  if (!Number.isFinite(value)) return "—";
  const decimals = options.decimals ?? 1;
  const thousands = options.thousands ?? NARROW_NBSP;
  let text = value.toFixed(decimals);
  if (/^-0(\.0*)?$/.test(text)) text = text.slice(1);
  let [int = "0", frac = ""] = text.split(".");
  if (options.trimZeros === true) frac = frac.replace(/0+$/, "");
  const negative = int.startsWith("-");
  const digits = negative ? int.slice(1) : int;
  const grouped = thousands === "" ? digits : digits.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  return `${negative ? "-" : ""}${grouped}${frac !== "" ? `,${frac}` : ""}`;
}

/**
 * Nombre « machine » pour les fichiers (SVG, DXF) : point décimal, au plus `decimals`
 * décimales, zéros finaux supprimés, jamais de notation exponentielle ni de `-0`.
 * Lève une erreur sur une valeur non finie ou démesurée (un fichier corrompu est pire qu'une erreur).
 */
export function formatNum(value: number, decimals = 6): string {
  if (!Number.isFinite(value)) throw new RangeError(`Valeur non finie dans un export : ${value}`);
  // Garde-fou : toFixed passe en notation exponentielle à partir de 1e21 ; aucune cote réaliste
  // n'approche 1e15 mm.
  if (Math.abs(value) >= 1e15) throw new RangeError(`Valeur hors plage dans un export : ${value}`);
  let text = value.toFixed(decimals);
  if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "");
  if (text === "-0") text = "0";
  return text;
}

/** Échappement XML (contenu texte et valeurs d'attributs entre guillemets doubles). */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
