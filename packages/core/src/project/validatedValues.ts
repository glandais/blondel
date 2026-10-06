/**
 * Validation des valeurs par défaut « à valider » (◆) (ADR-0009 point 9) : l'utilisateur
 * confirme une valeur non sourcée ; la validation est enregistrée dans le projet
 * (`Project.validatedValues`) avec la valeur effective du moment.
 *
 * Une entrée par chemin (et par plugin de structure pour les paramètres de plugin) : valider de
 * nouveau remplace l'entrée. Une validation dont la valeur ne correspond plus à la valeur
 * effective courante est caduque : elle reste dans le fichier mais `isValueValidated` l'ignore.
 * Retirer la dernière entrée retire le champ, pour que le fichier redevienne celui d'avant.
 *
 * Fonctions pures.
 */
import type { Project, ValidatedValue } from "../model/project.js";

type ValidatedKey = Pick<ValidatedValue, "path" | "structureKind">;

function sameKey(a: ValidatedKey, b: ValidatedKey): boolean {
  return a.path === b.path && a.structureKind === b.structureKind;
}

/**
 * La valeur `value` du chemin `path` (plugin `structureKind` pour un paramètre de plugin)
 * est-elle validée ? Vrai seulement si une entrée de même chemin et de même plugin porte
 * exactement cette valeur (`===`).
 */
export function isValueValidated(
  project: Project,
  path: string,
  value: unknown,
  structureKind?: string,
): boolean {
  const list = project.validatedValues;
  if (list === undefined) return false;
  return list.some(
    (v) => v.path === path && v.structureKind === structureKind && v.value === value,
  );
}

/** Copie normalisée d'une entrée (sans `structureKind` indéfini). */
function normalized(e: ValidatedValue): ValidatedValue {
  return e.structureKind === undefined
    ? { path: e.path, value: e.value }
    : { path: e.path, value: e.value, structureKind: e.structureKind };
}

/**
 * Projet avec ces validations : chaque entrée remplace celle de même chemin et de même plugin
 * (à sa place), sinon s'ajoute à la fin. Liste vide : projet inchangé.
 */
export function withValidatedValues(project: Project, entries: readonly ValidatedValue[]): Project {
  if (entries.length === 0) return project;
  const list: ValidatedValue[] = [...(project.validatedValues ?? [])];
  for (const e of entries) {
    const entry = normalized(e);
    const i = list.findIndex((v) => sameKey(v, entry));
    if (i < 0) list.push(entry);
    else list[i] = entry;
  }
  return { ...project, validatedValues: list };
}

/**
 * Projet sans les validations de ces chemins (et plugins). Projet inchangé si aucune n'est
 * présente ; liste devenue vide : le champ `validatedValues` est retiré.
 */
export function withoutValidatedValues(
  project: Project,
  entries: readonly ValidatedKey[],
): Project {
  const current = project.validatedValues;
  if (current === undefined) return project;
  const list = current.filter((v) => !entries.some((e) => sameKey(v, e)));
  if (list.length === current.length) return project;
  if (list.length > 0) return { ...project, validatedValues: list };
  const { validatedValues: _removed, ...rest } = project;
  return rest;
}
