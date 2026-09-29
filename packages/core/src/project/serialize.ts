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

/**
 * Projet tel qu'il est enregistré : les champs **dérivés** d'un tracé hélicoïdal (`width`,
 * `legs`, `turns`, recalculés à la lecture, voir `HelicalLayoutSpecSchema`) sont retirés. Les
 * autres projets sont rendus tels quels.
 */
function persistedForm(project: Project): unknown {
  const layout = project.stair.layout;
  if (layout.kind !== "helical") return project;
  const { width: _width, legs: _legs, turns: _turns, ...rest } = layout;
  return { ...project, stair: { ...project.stair, layout: rest } };
}

export interface SerializeOptions {
  /**
   * JSON compact (sans indentation ni fin de ligne finale), même contenu et même ordre de clés :
   * relu à l'identique par `parseProjectText`. Réservé au stockage interne (autosauvegarde
   * `localStorage`, dont le quota est d'environ 5 M caractères) ; le fichier `.blondel.json`
   * reste indenté.
   */
  readonly compact?: boolean;
}

/** Texte d'un fichier `.blondel.json` (ou forme compacte, voir `SerializeOptions`). */
export function serializeProject(project: Project, options: SerializeOptions = {}): string {
  if (options.compact === true) return stableStringify(persistedForm(project), 0);
  return `${stableStringify(persistedForm(project))}\n`;
}
