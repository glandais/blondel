/**
 * Export JSON du projet : réutilise la sérialisation stable du cœur (`.blondel.json`).
 * Le `Model` n'est jamais exporté : il est dérivé du projet (ADR-0002).
 */
import { serializeProject, type Project } from "@blondel/core";

export const PROJECT_FILE_EXTENSION = ".blondel.json";

export function exportProjectJson(project: Project): string {
  return serializeProject(project);
}
