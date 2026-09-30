/**
 * Mise en forme des nombres et échappements communs aux exports.
 *
 * Arrondi (ADR-0003) : les grandeurs restent en float64 jusqu'ici ; l'arrondi n'a lieu qu'à
 * l'affichage (0,1 mm pour les cotes de fabrication, 1 mm pour l'implantation).
 */
import { translatorFor, type Translator } from "@blondel/i18n";

/** Espace insécable fine (séparateur de milliers typographique français). */
export const NARROW_NBSP = " ";

export interface FrNumberOptions {
  /** Nombre de décimales affichées (défaut 1). */
  readonly decimals?: number;
  /** Séparateur de milliers (défaut : celui de la langue, espace fine insécable en français ; "" pour aucun). */
  readonly thousands?: string;
  /** Supprime les zéros décimaux inutiles (« 250 » au lieu de « 250,0 »). Défaut : false. */
  readonly trimZeros?: boolean;
}

/**
 * Nombre affiché dans la langue du traducteur (`Translator.num`) : virgule et espace fine
 * insécable en français, point et virgule en anglais ; séparateur de milliers paramétrable.
 * `-0` est affiché « 0 ». Les valeurs non finies donnent « — ».
 */
export function formatIn(t: Translator, value: number, options: FrNumberOptions = {}): string {
  const o: { digits?: number; thousands?: string; trimZeros?: boolean } = {
    digits: options.decimals ?? 1,
  };
  if (options.thousands !== undefined) o.thousands = options.thousands;
  if (options.trimZeros !== undefined) o.trimZeros = options.trimZeros;
  return t.num(value, o);
}

/**
 * Nombre au format français : alias de `formatIn` en français (compatibilité). Les exports
 * passent par `formatIn` avec le traducteur de leur option `locale`.
 */
export function formatFr(value: number, options: FrNumberOptions = {}): string {
  return formatIn(translatorFor("fr"), value, options);
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
