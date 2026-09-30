/**
 * Contrôles de cohérence des dictionnaires (utilisés par les tests de ce paquet et réutilisables
 * pour les fragments `_wip` des vagues de migration). Fonctions pures : chacune rend la liste des
 * problèmes trouvés, vide si tout va bien.
 */
import { listPlaceholders, type Messages } from "./index";

/**
 * Format d'une clé : segments séparés par des points, premier segment en minuscules, segments
 * suivants en lettres, chiffres et `_` (camelCase, ou identifiants de règles en majuscules comme
 * `rules.H_MAX_DTU.description`). Au moins deux segments.
 */
export const KEY_PATTERN = /^[a-z][a-z0-9]*(\.[A-Za-z0-9_]+)+$/;

/** Ordre de tri des clés dans les fichiers : ordre des unités de code (tri JavaScript par défaut). */
export function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Copie du dictionnaire avec les clés triées (pour réécrire un fichier). */
export function sortMessages(messages: Messages): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(messages).sort(compareKeys)) out[key] = messages[key]!;
  return out;
}

/** Clés présentes dans l'un des dictionnaires et absentes de l'autre. */
export function parityProblems(reference: Messages, other: Messages, otherName: string): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(reference)) {
    if (!(key in other)) problems.push(`${key} : absente de ${otherName}`);
  }
  for (const key of Object.keys(other)) {
    if (!(key in reference)) problems.push(`${key} : présente dans ${otherName} seulement`);
  }
  return problems;
}

/** Clés dont les paramètres `{…}` diffèrent entre les deux dictionnaires. */
export function placeholderProblems(reference: Messages, other: Messages): string[] {
  const problems: string[] = [];
  for (const [key, text] of Object.entries(reference)) {
    const translated = other[key];
    if (translated === undefined) continue;
    const a = listPlaceholders(text).sort();
    const b = listPlaceholders(translated).sort();
    if (a.join(",") !== b.join(",")) {
      problems.push(`${key} : {${a.join("}, {")}} ≠ {${b.join("}, {")}}`);
    }
  }
  return problems;
}

/** Valeurs vides (ou blanches). */
export function emptyValueProblems(messages: Messages): string[] {
  return Object.entries(messages)
    .filter(([, text]) => typeof text !== "string" || text.trim() === "")
    .map(([key]) => `${key} : valeur vide`);
}

/** Clés mal formées (voir `KEY_PATTERN`). */
export function keyFormatProblems(messages: Messages): string[] {
  return Object.keys(messages)
    .filter((key) => !KEY_PATTERN.test(key))
    .map((key) => `${key} : format de clé invalide`);
}

/** Clés hors d'ordre dans le fichier (ordre d'insertion de l'objet lu). */
export function sortProblems(messages: Messages): string[] {
  const keys = Object.keys(messages);
  const problems: string[] = [];
  for (let i = 1; i < keys.length; i++) {
    if (compareKeys(keys[i - 1]!, keys[i]!) >= 0) {
      problems.push(`${keys[i]} : devrait précéder ${keys[i - 1]}`);
    }
  }
  return problems;
}

/**
 * Une clé existe-t-elle, directement ou comme base plurielle (`x` quand `x.one`/`x.other`
 * existent) ?
 */
export function hasKey(messages: Messages, key: string): boolean {
  return key in messages || `${key}.other` in messages;
}
