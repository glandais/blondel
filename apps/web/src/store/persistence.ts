/**
 * Persistance du projet : autosauvegarde `localStorage` et fichiers `.blondel.json`
 * (ADR-0005). La lecture et la validation sont celles du cœur (`parseProjectText`,
 * migrations comprises) ; ici, seulement la plomberie et les messages.
 */
import { ProjectParseError, parseProjectText, serializeProject, type Project } from "@blondel/core";

/** Sous-ensemble de l'API `Storage` utilisé (injectable dans les tests). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const AUTOSAVE_KEY = "blondel.autosave.project";
export const PROJECT_FILE_SUFFIX = ".blondel.json";

/**
 * `localStorage` du navigateur s'il est accessible (il peut lever en navigation privée ou si
 * le stockage est bloqué), sinon `undefined`.
 */
export function browserStorage(): StorageLike | undefined {
  try {
    const s = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (!s) return undefined;
    const probe = "blondel.probe";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return undefined;
  }
}

/** Stockage en mémoire (tests, navigateur sans `localStorage`). */
export function memoryStorage(initial: Record<string, string> = {}): StorageLike & {
  readonly data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

/** Écrit l'autosauvegarde ; renvoie `false` si le stockage refuse (quota, accès bloqué). */
export function saveAutosave(storage: StorageLike | undefined, project: Project): boolean {
  if (!storage) return false;
  try {
    storage.setItem(AUTOSAVE_KEY, serializeProject(project));
    return true;
  } catch {
    return false;
  }
}

/** Relit l'autosauvegarde ; `undefined` si absente, illisible ou invalide. */
export function loadAutosave(storage: StorageLike | undefined): Project | undefined {
  if (!storage) return undefined;
  try {
    const text = storage.getItem(AUTOSAVE_KEY);
    if (text === null) return undefined;
    return parseProjectText(text);
  } catch {
    return undefined;
  }
}

export type ImportResult =
  | { readonly ok: true; readonly project: Project }
  | { readonly ok: false; readonly message: string; readonly issues: readonly string[] };

/** Lit le texte d'un fichier `.blondel.json` ; les erreurs sont rendues, jamais levées. */
export function importProjectText(text: string): ImportResult {
  try {
    return { ok: true, project: parseProjectText(text) };
  } catch (e) {
    if (e instanceof ProjectParseError) {
      const summary = e.message.split("\n")[0] ?? e.message;
      return {
        ok: false,
        message: summary,
        issues: e.issues.map((i) => `${i.path === "" ? "(racine)" : i.path} : ${i.message}`),
      };
    }
    return {
      ok: false,
      message: `Fichier de projet illisible : ${e instanceof Error ? e.message : String(e)}`,
      issues: [],
    };
  }
}

/** Nom de fichier sûr dérivé du nom du projet. */
export function projectFileName(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${base === "" ? "projet" : base}${PROJECT_FILE_SUFFIX}`;
}

/** Contenu et nom du fichier d'export. */
export function exportProjectFile(project: Project): { filename: string; text: string } {
  return { filename: projectFileName(project.name), text: serializeProject(project) };
}
