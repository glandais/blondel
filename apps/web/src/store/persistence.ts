/**
 * Persistance du projet : autosauvegarde `localStorage` et fichiers `.blondel.json`
 * (ADR-0005). La lecture et la validation sont celles du cœur (`parseProjectText`,
 * migrations comprises) ; ici, seulement la plomberie et les messages.
 */
import {
  ProjectParseError,
  errorMessageOf,
  parseProjectText,
  serializeProject,
  type Project,
} from "@blondel/core";
import { msg, type Message, type Translator } from "@blondel/i18n";

/** Sous-ensemble de l'API `Storage` utilisé (injectable dans les tests). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const AUTOSAVE_KEY = "blondel.autosave.project";
/**
 * Copie de secours d'une autosauvegarde refusée au démarrage (format plus récent, projet
 * invalide) : écrite avant que l'autosauvegarde ne l'écrase.
 */
export const AUTOSAVE_REJECTED_KEY = "blondel.autosave.rejected";
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

/**
 * Écrit l'autosauvegarde en JSON **compact** (le quota `localStorage` est d'environ 5 M
 * caractères ; l'indentation de l'export `.blondel.json` triplerait la taille d'un calque DXF) ;
 * renvoie `false` si le stockage refuse (quota, accès bloqué).
 */
export function saveAutosave(storage: StorageLike | undefined, project: Project): boolean {
  if (!storage) return false;
  try {
    storage.setItem(AUTOSAVE_KEY, autosaveText(project));
    return true;
  } catch {
    return false;
  }
}

/** Texte écrit par l'autosauvegarde (JSON compact, relu par `parseProjectText`). */
export function autosaveText(project: Project): string {
  return serializeProject(project, { compact: true });
}

/** Résultat de la lecture de l'autosauvegarde au démarrage. */
export type AutosaveLoad =
  | { readonly kind: "none" }
  | { readonly kind: "ok"; readonly project: Project }
  | {
      /** Autosauvegarde présente mais illisible (format plus récent, projet invalide…). */
      readonly kind: "rejected";
      /** Message du cœur (résumé) et détail des erreurs, traduits à l'affichage. */
      readonly message: Message;
      readonly issues: readonly Message[];
      /** Texte brut refusé (pour le télécharger). */
      readonly text: string;
      /**
       * Copie faite sous `AUTOSAVE_REJECTED_KEY` : l'autosauvegarde peut reprendre sans perdre
       * l'original. Faux si le stockage l'a refusée (quota) : l'autosauvegarde doit alors être
       * suspendue tant que l'utilisateur n'a pas choisi.
       */
      readonly preserved: boolean;
    };

/**
 * Relit l'autosauvegarde. Une autosauvegarde refusée n'est **jamais** écartée en silence : son
 * texte brut est copié sous `AUTOSAVE_REJECTED_KEY` avant tout nouvel enregistrement, et le
 * message du cœur est rendu.
 */
export function loadAutosave(storage: StorageLike | undefined): AutosaveLoad {
  if (!storage) return { kind: "none" };
  let text: string | null;
  try {
    text = storage.getItem(AUTOSAVE_KEY);
  } catch {
    return { kind: "none" };
  }
  if (text === null) return { kind: "none" };
  const r = importProjectText(text);
  if (r.ok) return { kind: "ok", project: r.project };
  let preserved: boolean;
  try {
    storage.setItem(AUTOSAVE_REJECTED_KEY, text);
    preserved = storage.getItem(AUTOSAVE_REJECTED_KEY) === text;
  } catch {
    preserved = false;
  }
  return { kind: "rejected", message: r.message, issues: r.issues, text, preserved };
}

/**
 * Copie de secours d'une autosauvegarde refusée lors d'un démarrage **antérieur**, encore dans
 * le stockage (ni restaurée ni supprimée) : son texte brut, sinon `null`. Signalée par un
 * bandeau à chaque démarrage tant qu'elle existe (QUESTIONS A22).
 */
export function loadRejectedCopy(storage: StorageLike | undefined): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(AUTOSAVE_REJECTED_KEY);
  } catch {
    return null;
  }
}

/**
 * Fichier proposé au téléchargement pour une autosauvegarde refusée (texte brut, intact), nommé
 * dans la langue d'affichage.
 */
export function rejectedAutosaveFile(
  text: string,
  t: Translator,
): { filename: string; text: string } {
  return { filename: `${t.t("ui.notice.rejectedAutosaveFile")}${PROJECT_FILE_SUFFIX}`, text };
}

export type ImportResult =
  | { readonly ok: true; readonly project: Project }
  | { readonly ok: false; readonly message: Message; readonly issues: readonly Message[] };

/** Lit le texte d'un fichier `.blondel.json` ; les erreurs sont rendues, jamais levées. */
export function importProjectText(text: string): ImportResult {
  try {
    return { ok: true, project: parseProjectText(text) };
  } catch (e) {
    if (e instanceof ProjectParseError) {
      return {
        ok: false,
        message: e.msg,
        issues: e.issues.map((i) =>
          msg("project.issue.line", {
            path: i.path === "" ? msg("project.issue.root") : i.path,
            message: i.message,
          }),
        ),
      };
    }
    return {
      ok: false,
      message: msg("ui.notice.projectFileUnreadable", { detail: errorMessageOf(e) }),
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
