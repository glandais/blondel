/**
 * Sérialisation stable d'un projet : clés d'objets triées récursivement, indentation de
 * 2 espaces, fin de ligne finale. Deux projets égaux donnent exactement le même texte
 * (diffs lisibles, empreintes stables, tests de non-régression sur les exemples).
 */
import type { Project } from "../model/project.js";

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** JSON à clés triées (ordre UTF-16, identique à `Array.prototype.sort`). */
export function stableStringify(value: unknown, indent = 2): string {
  return JSON.stringify(sortKeys(value), null, indent);
}

/** Texte d'un fichier `.blondel.json`. */
export function serializeProject(project: Project): string {
  return `${stableStringify(project)}\n`;
}
