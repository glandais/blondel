/**
 * Erreurs de lecture d'un projet, rédigées en français pour l'utilisateur.
 */
import { z } from "zod";

/** Un problème localisé dans le JSON du projet. */
export interface ProjectIssue {
  /** Chemin lisible, ex. `stair.layout.legs[0].length` (vide = racine). */
  readonly path: string;
  readonly message: string;
}

/** Erreur levée par `parseProject` / `parseProjectText`. */
export class ProjectParseError extends Error {
  override readonly name = "ProjectParseError";
  readonly issues: readonly ProjectIssue[];

  constructor(summary: string, issues: readonly ProjectIssue[] = []) {
    super(ProjectParseError.format(summary, issues));
    this.issues = issues;
  }

  private static format(summary: string, issues: readonly ProjectIssue[]): string {
    if (issues.length === 0) return summary;
    const lines = issues.map((i) => `- ${i.path === "" ? "(racine)" : i.path} : ${i.message}`);
    return `${summary}\n${lines.join("\n")}`;
  }
}

/** Libellés métier des champs principaux, ajoutés entre parenthèses au chemin. */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  schemaVersion: "version du format",
  floorToFloor: "hauteur à monter",
  upperSlabThickness: "épaisseur du plancher haut",
  lowerFinish: "revêtement du sol bas",
  upperFinish: "revêtement du sol haut",
  opening: "trémie",
  width: "emmarchement",
  legs: "volées",
  length: "longueur de volée",
  turns: "tournants",
  riserCount: "nombre de hauteurs",
  targetRise: "hauteur de marche cible",
  targetGoing: "giron cible",
  thickness: "épaisseur",
  nosing: "débord de nez",
};

/** Convertit un chemin zod en chemin lisible `a.b[0].c`. */
export function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const key of path) {
    if (typeof key === "number") out += `[${key}]`;
    else out += out === "" ? String(key) : `.${String(key)}`;
  }
  const last = [...path].reverse().find((k) => typeof k === "string");
  const label = typeof last === "string" ? FIELD_LABELS[last] : undefined;
  return label !== undefined ? `${out} (${label})` : out;
}

const frenchErrorMap = z.locales.fr().localeError;

/** Carte d'erreurs zod : locale française, précisée pour les unions discriminées. */
export const projectErrorMap: z.core.$ZodErrorMap = (issue) => {
  if (issue.code === "invalid_union" && "discriminator" in issue && typeof issue.discriminator === "string") {
    const options = Array.isArray(issue.options) ? issue.options.map((o) => JSON.stringify(o)).join(", ") : "";
    return `valeur de « ${issue.discriminator} » inconnue (attendu : ${options})`;
  }
  return frenchErrorMap(issue);
};

/** Convertit une erreur zod en liste de problèmes lisibles. */
export function issuesFromZod(error: z.ZodError): ProjectIssue[] {
  return error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message }));
}
