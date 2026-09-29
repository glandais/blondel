/**
 * Store de l'application (zustand, ADR-0005) : le `Project` immuable et son historique,
 * l'état d'interface (sélection, vue, unité d'affichage) et l'autosauvegarde. Le `Model`
 * n'est **pas** stocké : il est dérivé du projet par `buildModel` (voir `model/`).
 */
import {
  ProjectSchema,
  createProject,
  stableStringify,
  type Location,
  type PresetId,
  type PresetOptions,
  type Project,
} from "@blondel/core";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { DisplayUnit } from "../lib/units.js";
import {
  DEFAULT_HISTORY_OPTIONS,
  canRedo,
  canUndo,
  commit,
  endGroup,
  initHistory,
  redo,
  reset,
  undo,
  type History,
  type HistoryOptions,
} from "./history.js";
import {
  exportProjectFile,
  importProjectText,
  loadAutosave,
  saveAutosave,
  type ImportResult,
  type StorageLike,
} from "./persistence.js";
import { setIn, type Path } from "./setIn.js";

export type ViewTab = "plan" | "3d" | "elevation" | "flat" | "bom";
export type ThemeChoice = "system" | "light" | "dark";

/** Élément surligné (clic sur un résultat du contrôle de conception, ou sur une pièce). */
export interface Selection {
  readonly location: Location;
  /** Règle à l'origine de la sélection, le cas échéant. */
  readonly ruleId?: string;
}

export type UpdateResult =
  { readonly ok: true } | { readonly ok: false; readonly issues: readonly string[] };

export interface AppState {
  readonly history: History<Project>;
  /** Raccourci : `history.present`. */
  readonly project: Project;
  readonly selection: Selection | null;
  readonly view: ViewTab;
  readonly displayUnit: DisplayUnit;
  readonly theme: ThemeChoice;
  /** Dernier message à afficher dans la barre d'outils (import refusé, sauvegarde…). */
  readonly notice: {
    readonly kind: "info" | "error";
    readonly text: string;
    readonly details?: readonly string[];
  } | null;
  /** L'autosauvegarde a-t-elle échoué (stockage indisponible ou plein) ? */
  readonly autosaveFailed: boolean;

  /**
   * Applique une modification du projet. Le résultat est validé par le schéma du cœur : un
   * projet invalide est refusé (l'état ne change pas). `groupKey` regroupe les modifications
   * continues d'un même champ en une seule entrée d'historique.
   */
  update(recipe: (p: Project) => Project, groupKey?: string): UpdateResult;
  /** Modifie une valeur par chemin (`["site", "floorToFloor"]`), regroupée par chemin. */
  setField(path: Path, value: unknown): UpdateResult;
  /** Clôt le groupe de modifications en cours (perte de focus). */
  endGroup(): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Remplace le projet par un préréglage (annulable). */
  loadPreset(id: PresetId, options?: PresetOptions): UpdateResult;
  /** Remplace le projet par le contenu d'un fichier `.blondel.json` (annulable). */
  importText(text: string): ImportResult;
  exportFile(): { filename: string; text: string };
  select(selection: Selection | null): void;
  setView(view: ViewTab): void;
  setDisplayUnit(unit: DisplayUnit): void;
  setTheme(theme: ThemeChoice): void;
  clearNotice(): void;
  /**
   * Écrit tout de suite l'autosauvegarde différée en attente (fermeture ou masquage de la
   * page) ; sans effet s'il n'y a rien en attente ou pas de stockage.
   */
  flushAutosave(): void;
}

export interface ProjectStoreOptions {
  /** Stockage de l'autosauvegarde ; `undefined` = pas d'autosauvegarde. */
  readonly storage?: StorageLike;
  /** Délai de l'autosauvegarde (ms) ; 0 = écriture immédiate (tests). */
  readonly autosaveDelayMs?: number;
  /** Projet initial ; défaut : autosauvegarde, sinon préréglage `straight`. */
  readonly initialProject?: Project;
  readonly history?: HistoryOptions;
  /** Horloge (ms) pour le regroupement ; injectable dans les tests. */
  readonly now?: () => number;
}

export const DEFAULT_PRESET: PresetId = "straight";

function describeZodIssues(error: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}): string[] {
  return error.issues.map((i) => `${i.path.map(String).join(".") || "(racine)"} : ${i.message}`);
}

/** Valide un projet candidat ; renvoie les messages d'erreur, ou `[]` s'il est valide. */
export function validateProject(p: Project): string[] {
  const r = ProjectSchema.safeParse(p);
  return r.success ? [] : describeZodIssues(r.error);
}

export type NormalizeResult =
  | { readonly ok: true; readonly project: Project }
  | { readonly ok: false; readonly issues: readonly string[] };

/**
 * Valide un projet candidat et le ramène à la forme canonique du schéma du cœur. Si le candidat
 * est déjà canonique, il est rendu tel quel (même référence : partage structurel conservé) ;
 * sinon (clé à valeur par défaut retirée, clé inconnue), c'est la sortie de `ProjectSchema`
 * qui est rendue : le projet stocké ne peut jamais différer de ce que relirait l'import.
 */
export function normalizeProject(p: Project): NormalizeResult {
  const r = ProjectSchema.safeParse(p);
  if (!r.success) return { ok: false, issues: describeZodIssues(r.error) };
  return { ok: true, project: stableStringify(r.data) === stableStringify(p) ? p : r.data };
}

export type ProjectStore = StoreApi<AppState>;

export function createProjectStore(options: ProjectStoreOptions = {}): ProjectStore {
  const storage = options.storage;
  const historyOptions = options.history ?? DEFAULT_HISTORY_OPTIONS;
  const clock = options.now ?? (() => Date.now());
  const initial = options.initialProject ?? loadAutosave(storage) ?? createProject(DEFAULT_PRESET);

  // Remplacé par l'écriture différée réelle quand un stockage est fourni.
  let flush = (): void => {};
  const store = createStore<AppState>()((set, get) => {
    const apply = (next: Project, groupKey?: string): UpdateResult => {
      const cur = get().history;
      if (Object.is(next, cur.present)) return { ok: true };
      const normalized = normalizeProject(next);
      if (!normalized.ok) return normalized;
      // Forme canonique identique à l'état présent (ex. valeur par défaut rétablie) : rien à
      // enregistrer, pas d'entrée d'historique vide.
      if (
        normalized.project !== next &&
        stableStringify(normalized.project) === stableStringify(cur.present)
      ) {
        return { ok: true };
      }
      const opts = groupKey === undefined ? { now: clock() } : { groupKey, now: clock() };
      const history = commit(cur, normalized.project, opts, historyOptions);
      set({ history, project: history.present });
      return { ok: true };
    };
    const move = (h: History<Project>): void => {
      set({ history: h, project: h.present });
    };
    return {
      history: initHistory(initial),
      project: initial,
      selection: null,
      view: "plan",
      displayUnit: "mm",
      theme: "system",
      notice: null,
      autosaveFailed: false,

      update: (recipe, groupKey) => {
        let next: Project;
        try {
          next = recipe(get().project);
        } catch (e) {
          return { ok: false, issues: [e instanceof Error ? e.message : String(e)] };
        }
        return apply(next, groupKey);
      },
      setField: (path, value) => {
        const p = get().project;
        return apply(setIn(p, path, value), path.join("."));
      },
      endGroup: () => {
        const h = get().history;
        if (h.group !== null) set({ history: endGroup(h) });
      },
      undo: () => move(undo(get().history)),
      redo: () => move(redo(get().history)),
      canUndo: () => canUndo(get().history),
      canRedo: () => canRedo(get().history),
      loadPreset: (id, presetOptions) => {
        let p: Project;
        try {
          p = createProject(id, presetOptions);
        } catch (e) {
          const text = e instanceof Error ? e.message : String(e);
          set({ notice: { kind: "error", text } });
          return { ok: false, issues: [text] };
        }
        const r = apply(p);
        if (r.ok) set({ selection: null, notice: null });
        return r;
      },
      importText: (text) => {
        const r = importProjectText(text);
        if (r.ok) {
          apply(r.project);
          set({
            selection: null,
            notice: { kind: "info", text: `Projet « ${r.project.name} » importé.` },
          });
        } else {
          set({ notice: { kind: "error", text: r.message, details: r.issues } });
        }
        return r;
      },
      exportFile: () => exportProjectFile(get().project),
      select: (selection) => set({ selection }),
      setView: (view) => set({ view }),
      setDisplayUnit: (displayUnit) => set({ displayUnit }),
      setTheme: (theme) => set({ theme }),
      clearNotice: () => set({ notice: null }),
      flushAutosave: () => flush(),
    };
  });

  // Autosauvegarde à chaque changement de projet (différée pour ne pas écrire à chaque frappe).
  if (storage) {
    const delay = options.autosaveDelayMs ?? 500;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = (): void => {
      timer = undefined;
      const ok = saveAutosave(storage, store.getState().project);
      if (ok === store.getState().autosaveFailed) store.setState({ autosaveFailed: !ok });
    };
    flush = () => {
      if (timer === undefined) return;
      clearTimeout(timer);
      save();
    };
    store.subscribe((state, prev) => {
      if (Object.is(state.project, prev.project)) return;
      if (delay <= 0) {
        save();
        return;
      }
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(save, delay);
    });
  }
  return store;
}

/** Réinitialise l'historique (utilitaire de test et de « nouveau projet » sans annulation). */
export function resetHistory(store: ProjectStore, project: Project): void {
  const h = reset(project);
  store.setState({ history: h, project: h.present, selection: null });
}
