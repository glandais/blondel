/**
 * Store de l'application (zustand, ADR-0005) : le `Project` immuable et son historique,
 * l'état d'interface (sélection, vue, unité d'affichage) et l'autosauvegarde. Le `Model`
 * n'est **pas** stocké : il est dérivé du projet par `buildModel` (voir `model/`).
 */
import {
  DEMO_PRESET_DESCRIPTIONS,
  DEMO_PRESET_LABELS,
  PRESET_LABELS,
  ProjectSchema,
  createDemoProject,
  createProject,
  type DemoPresetId,
  stableStringify,
  type Location,
  type PresetId,
  type PresetOptions,
  type Project,
  errorMessageOf,
} from "@blondel/core";
import {
  DEFAULT_LOCALE,
  createTranslator,
  msg,
  textMessage,
  type Locale,
  type Message,
} from "@blondel/i18n";
import { createStore, type StoreApi } from "zustand/vanilla";
import { presetProject } from "../lib/layoutKind.js";
import type { AppearanceOverrides } from "../lib/appearance.js";
import { SCHEMA_PARSE_OPTIONS, schemaIssues } from "../lib/schemaIssues.js";
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
  AUTOSAVE_REJECTED_KEY,
  exportProjectFile,
  importProjectText,
  loadAutosave,
  loadRejectedCopy,
  saveAutosave,
  type AutosaveLoad,
  type ImportResult,
  type StorageLike,
} from "./persistence.js";
import { setIn, type Path } from "./setIn.js";

export type ViewTab = "plan" | "3d" | "elevation" | "flat" | "bom" | "compare";
/** Mode de l'onglet Plan 2D : plan coté, site et saisie (jalon 7), mode expert des nez. */
export type PlanMode = "drawing" | "site" | "expert";
export type ThemeChoice = "system" | "light" | "dark";

/** Élément surligné (clic sur un résultat du contrôle de conception, ou sur une pièce). */
export interface Selection {
  readonly location: Location;
  /** Règle à l'origine de la sélection, le cas échéant. */
  readonly ruleId?: string;
}

/**
 * Message de la barre d'outils (import refusé, sauvegarde, démo…) : `Message` neutre, traduit à
 * l'affichage dans la langue courante (un changement de langue le retraduit).
 */
export interface Notice {
  readonly kind: "info" | "error";
  readonly msg: Message;
  readonly details?: readonly Message[];
}

export type UpdateResult =
  { readonly ok: true } | { readonly ok: false; readonly issues: readonly string[] };

export interface AppState {
  readonly history: History<Project>;
  /** Raccourci : `history.present`. */
  readonly project: Project;
  readonly selection: Selection | null;
  readonly view: ViewTab;
  readonly planMode: PlanMode;
  /**
   * Apparence 3D choisie par famille de pièces (aperçu de rendu : ne modifie ni le projet ni la
   * nomenclature ; voir `lib/appearance.ts`).
   */
  readonly appearance: AppearanceOverrides;
  /**
   * Cadrage demandé à la vue 3D (choix d'une démo) : la vue le fait une fois, quand le modèle
   * affiché est celui de `project` (identité), puis retient `seq`.
   */
  readonly frameRequest: FrameRequest | null;
  /**
   * Surcouches de la vue 3D (cotes principales, contrôles sur les pièces) : masquées au choix
   * d'une démo (vitrine), rétablies par tout autre projet chargé (préréglage de base, import,
   * assistant, copie de secours). Options d'affichage que l'utilisateur réactive à volonté.
   */
  readonly overlays: ViewerOverlays;
  /** Fenêtre de l'assistant d'initialisation ouverte. */
  readonly assistantOpen: boolean;
  readonly displayUnit: DisplayUnit;
  readonly theme: ThemeChoice;
  /**
   * Langue de l'interface et des exports (ADR-0007). Affichage seulement : le `Model` est
   * neutre, un changement de langue ne relance aucun calcul.
   */
  readonly locale: Locale;
  /** Dernier message à afficher dans la barre d'outils (import refusé, sauvegarde…). */
  readonly notice: Notice | null;
  /** L'autosauvegarde a-t-elle échoué (stockage indisponible ou plein) ? */
  readonly autosaveFailed: boolean;
  /**
   * Autosauvegarde trouvée au démarrage mais refusée par le cœur (format plus récent, projet
   * invalide) : texte brut à proposer au téléchargement. `preserved` : copie faite sous
   * `AUTOSAVE_REJECTED_KEY` ; sinon l'autosauvegarde est **suspendue** (elle écraserait
   * l'original) jusqu'à `dismissRejectedAutosave`.
   */
  readonly rejectedAutosave: RejectedAutosave | null;

  /**
   * Applique une modification du projet. Le résultat est validé par le schéma du cœur : un
   * projet invalide est refusé (l'état ne change pas). `groupKey` regroupe les modifications
   * continues d'un même champ en une seule entrée d'historique.
   */
  update(
    recipe: (p: Project) => Project,
    groupKey?: string,
    options?: { readonly sticky?: boolean },
  ): UpdateResult;
  /** Modifie une valeur par chemin (`["site", "floorToFloor"]`), regroupée par chemin. */
  setField(path: Path, value: unknown): UpdateResult;
  /** Clôt le groupe de modifications en cours (perte de focus). */
  endGroup(): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /**
   * Remplace le projet par un préréglage (annulable) ; l'hélicoïdal reçoit la structure
   * `helical-core` (`presetProject`).
   */
  loadPreset(id: PresetId, options?: PresetOptions): UpdateResult;
  /**
   * Remplace le projet par une démo du cœur (`createDemoProject`) : une entrée d'historique,
   * essais d'apparence par famille effacés (les matériaux et teintes de la démo s'affichent),
   * onglet 3D et cadrage de trois quarts demandé (`frameRequest`).
   */
  loadDemo(id: DemoPresetId): UpdateResult;
  /** Affiche ou masque les cotes principales ou les contrôles sur les pièces de la vue 3D. */
  setOverlays(patch: Partial<ViewerOverlays>): void;
  /** Remplace le projet par le contenu d'un fichier `.blondel.json` (annulable). */
  importText(text: string): ImportResult;
  /**
   * Remplace le projet par un projet complet (proposition de l'assistant) : une entrée
   * d'historique (annulable), sélection effacée, message `notice` affiché.
   */
  replaceProject(project: Project, notice?: Message): UpdateResult;
  exportFile(): { filename: string; text: string };
  select(selection: Selection | null): void;
  setView(view: ViewTab): void;
  setPlanMode(mode: PlanMode): void;
  setAppearance(appearance: AppearanceOverrides): void;
  setAssistantOpen(open: boolean): void;
  setDisplayUnit(unit: DisplayUnit): void;
  setTheme(theme: ThemeChoice): void;
  /** Change la langue d'affichage (mémorisation et `<html lang>` : `store/appStore.ts`). */
  setLocale(locale: Locale): void;
  clearNotice(): void;
  /**
   * L'utilisateur a pris connaissance de l'autosauvegarde refusée (après l'avoir téléchargée ou
   * pour repartir du projet courant) : la copie de secours est effacée et l'autosauvegarde
   * reprend.
   */
  dismissRejectedAutosave(): void;
  /**
   * Restaure la copie de secours (remplace le projet courant, annulable) si le cœur sait la
   * relire (ex. application mise à jour depuis le refus) ; la copie est alors supprimée. Sinon,
   * rien ne change et le message du cœur est rendu.
   */
  restoreRejectedAutosave(): ImportResult;
  /**
   * Écrit tout de suite l'autosauvegarde différée en attente (fermeture ou masquage de la
   * page) ; sans effet s'il n'y a rien en attente ou pas de stockage.
   */
  flushAutosave(): void;
}

/** Surcouches de la vue 3D (voir `AppState.overlays`). */
export interface ViewerOverlays {
  readonly showControls: boolean;
  readonly showDimensions: boolean;
}

/** Affichage par défaut : cotes principales et contrôles sur les pièces visibles. */
export const DEFAULT_OVERLAYS: ViewerOverlays = { showControls: true, showDimensions: true };

/** Affichage d'une démo : escalier seul, sans cotes ni teinte des contrôles. */
export const DEMO_OVERLAYS: ViewerOverlays = { showControls: false, showDimensions: false };

/** Demande de cadrage de la vue 3D sur un projet (voir `AppState.frameRequest`). */
export interface FrameRequest {
  readonly project: Project;
  readonly seq: number;
}

/** Autosauvegarde refusée, ou copie de secours restante d'un refus antérieur (QUESTIONS A22). */
export interface RejectedAutosave {
  readonly text: string;
  readonly preserved: boolean;
  /**
   * `startup` : refusée à ce démarrage ; `earlier` : copie de secours laissée par un démarrage
   * antérieur (absent : `startup`).
   */
  readonly since?: "startup" | "earlier";
  /** Le cœur sait relire la copie : elle peut être restaurée. */
  readonly restorable?: boolean;
  /** Motif du refus (copie non restaurable). */
  readonly reason?: Message;
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
  /**
   * Signaler au démarrage une copie de secours d'autosauvegarde laissée par un démarrage
   * antérieur (bandeau restaurer / exporter / supprimer tant qu'elle existe). Défaut : vrai
   * (QUESTIONS A22, à confirmer).
   */
  readonly reportBackupCopy?: boolean;
  /** Langue initiale (défaut : français ; l'application passe la langue détectée). */
  readonly locale?: Locale;
}

export const DEFAULT_PRESET: PresetId = "straight";

/**
 * Valide un projet candidat ; renvoie les problèmes (« chemin (libellé) : motif », traduits à
 * l'affichage), ou `[]` s'il est valide.
 */
export function validateProject(p: Project): Message[] {
  const r = ProjectSchema.safeParse(p, SCHEMA_PARSE_OPTIONS);
  return r.success ? [] : schemaIssues(r.error);
}

export type NormalizeResult =
  | { readonly ok: true; readonly project: Project }
  | { readonly ok: false; readonly issues: readonly Message[] };

/**
 * Valide un projet candidat et le ramène à la forme canonique du schéma du cœur. Si le candidat
 * est déjà canonique, il est rendu tel quel (même référence : partage structurel conservé) ;
 * sinon (clé à valeur par défaut retirée, clé inconnue), c'est la sortie de `ProjectSchema`
 * qui est rendue : le projet stocké ne peut jamais différer de ce que relirait l'import.
 * Problèmes rendus en `Message` (le store les traduit dans la langue courante).
 */
export function normalizeProject(p: Project): NormalizeResult {
  const r = ProjectSchema.safeParse(p, SCHEMA_PARSE_OPTIONS);
  if (!r.success) return { ok: false, issues: schemaIssues(r.error) };
  return { ok: true, project: stableStringify(r.data) === stableStringify(p) ? p : r.data };
}

export type ProjectStore = StoreApi<AppState>;

export function createProjectStore(options: ProjectStoreOptions = {}): ProjectStore {
  const storage = options.storage;
  const historyOptions = options.history ?? DEFAULT_HISTORY_OPTIONS;
  const clock = options.now ?? (() => Date.now());
  const initialLocale = options.locale ?? DEFAULT_LOCALE;
  const loaded: AutosaveLoad =
    options.initialProject === undefined ? loadAutosave(storage) : { kind: "none" };
  // Projet neuf nommé dans la langue de l'interface (le cœur le nomme en français).
  const initial =
    options.initialProject ??
    (loaded.kind === "ok"
      ? loaded.project
      : createProject(DEFAULT_PRESET, {
          name: createTranslator(initialLocale).t(PRESET_LABELS[DEFAULT_PRESET]),
        }));
  const rejectedNotice: AppState["notice"] =
    loaded.kind === "rejected"
      ? {
          kind: "error",
          msg: msg(
            loaded.preserved
              ? "ui.notice.autosaveRejected.preserved"
              : "ui.notice.autosaveRejected.suspended",
            { reason: loaded.message },
          ),
          details: loaded.issues,
        }
      : null;

  // Copie de secours d'un refus antérieur, restée dans le stockage : signalée à chaque démarrage
  // tant qu'elle n'est ni restaurée ni supprimée.
  const earlierCopy: RejectedAutosave | null = (() => {
    if (
      loaded.kind === "rejected" ||
      options.initialProject !== undefined ||
      options.reportBackupCopy === false
    ) {
      return null;
    }
    const text = loadRejectedCopy(storage);
    if (text === null) return null;
    const r = importProjectText(text);
    return r.ok
      ? { text, preserved: true, since: "earlier", restorable: true }
      : { text, preserved: true, since: "earlier", restorable: false, reason: r.message };
  })();

  // Remplacé par l'écriture différée réelle quand un stockage est fourni.
  let flush = (): void => {};
  let resume = (): void => {};
  const store = createStore<AppState>()((set, get) => {
    const apply = (next: Project, groupKey?: string, sticky = false): UpdateResult => {
      const cur = get().history;
      if (Object.is(next, cur.present)) return { ok: true };
      const normalized = normalizeProject(next);
      if (!normalized.ok) {
        // Motifs traduits dans la langue du moment (message transitoire du champ refusé).
        const t = createTranslator(get().locale);
        return { ok: false, issues: normalized.issues.map((m) => t.t(m)) };
      }
      // Forme canonique identique à l'état présent (ex. valeur par défaut rétablie) : rien à
      // enregistrer, pas d'entrée d'historique vide.
      if (
        normalized.project !== next &&
        stableStringify(normalized.project) === stableStringify(cur.present)
      ) {
        return { ok: true };
      }
      const opts = groupKey === undefined ? { now: clock() } : { groupKey, now: clock(), sticky };
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
      planMode: "drawing",
      appearance: {},
      frameRequest: null,
      overlays: DEFAULT_OVERLAYS,
      assistantOpen: false,
      displayUnit: "mm",
      theme: "system",
      locale: initialLocale,
      notice: rejectedNotice,
      autosaveFailed: false,
      rejectedAutosave:
        loaded.kind === "rejected"
          ? { text: loaded.text, preserved: loaded.preserved, reason: loaded.message }
          : earlierCopy,

      update: (recipe, groupKey, updateOptions) => {
        let next: Project;
        try {
          next = recipe(get().project);
        } catch (e) {
          return { ok: false, issues: [createTranslator(get().locale).t(errorMessageOf(e))] };
        }
        return apply(next, groupKey, updateOptions?.sticky === true);
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
        const t = createTranslator(get().locale);
        try {
          // Projet neuf nommé dans la langue de l'interface (le cœur le nomme en français).
          p = presetProject(id, {
            ...presetOptions,
            name: presetOptions?.name ?? t.t(PRESET_LABELS[id]),
          });
        } catch (e) {
          const message = errorMessageOf(e);
          set({ notice: { kind: "error", msg: message } });
          return { ok: false, issues: [t.t(message)] };
        }
        const r = apply(p);
        if (r.ok) set({ selection: null, notice: null, overlays: DEFAULT_OVERLAYS });
        return r;
      },
      loadDemo: (id) => {
        let p: Project;
        const t = createTranslator(get().locale);
        try {
          p = createDemoProject(id, { name: t.t(DEMO_PRESET_LABELS[id]) });
        } catch (e) {
          const message = errorMessageOf(e);
          set({ notice: { kind: "error", msg: message } });
          return { ok: false, issues: [t.t(message)] };
        }
        // Entrée d'historique distincte : un groupe ouvert (saisie en cours) est d'abord clos.
        const h = get().history;
        if (h.group !== null) set({ history: endGroup(h) });
        const r = apply(p);
        if (r.ok) {
          set((s) => ({
            selection: null,
            appearance: {},
            view: "3d",
            overlays: DEMO_OVERLAYS,
            frameRequest: { project: s.project, seq: (s.frameRequest?.seq ?? 0) + 1 },
            notice: {
              kind: "info",
              msg: msg("ui.notice.demo", {
                label: msg(DEMO_PRESET_LABELS[id]),
                description: msg(DEMO_PRESET_DESCRIPTIONS[id]),
              }),
            },
          }));
        }
        return r;
      },
      importText: (text) => {
        const r = importProjectText(text);
        if (r.ok) {
          apply(r.project);
          set({
            selection: null,
            overlays: DEFAULT_OVERLAYS,
            notice: { kind: "info", msg: msg("ui.notice.imported", { name: r.project.name }) },
          });
        } else {
          set({ notice: { kind: "error", msg: r.message, details: r.issues } });
        }
        return r;
      },
      replaceProject: (project, text) => {
        // Entrée d'historique distincte : un groupe ouvert (saisie en cours) est d'abord clos.
        const h = get().history;
        if (h.group !== null) set({ history: endGroup(h) });
        const r = apply(project);
        if (r.ok) {
          set({
            selection: null,
            overlays: DEFAULT_OVERLAYS,
            notice: text ? { kind: "info", msg: text } : null,
          });
        }
        return r;
      },
      exportFile: () => exportProjectFile(get().project),
      select: (selection) => set({ selection }),
      setView: (view) => set({ view }),
      setPlanMode: (planMode) => set({ planMode }),
      setAppearance: (appearance) => set({ appearance }),
      setOverlays: (patch) => set((s) => ({ overlays: { ...s.overlays, ...patch } })),
      setAssistantOpen: (assistantOpen) => set({ assistantOpen }),
      setDisplayUnit: (displayUnit) => set({ displayUnit }),
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
      clearNotice: () => set({ notice: null }),
      dismissRejectedAutosave: () => {
        if (get().rejectedAutosave === null) return;
        set({ rejectedAutosave: null });
        // Copie de secours libérée (elle occupe le quota du stockage).
        try {
          storage?.removeItem(AUTOSAVE_REJECTED_KEY);
        } catch {
          // stockage inaccessible : rien à libérer
        }
        resume();
      },
      restoreRejectedAutosave: () => {
        const copy = get().rejectedAutosave;
        if (copy === null) {
          return {
            ok: false,
            message: msg("ui.notice.backup.none"),
            issues: [],
          };
        }
        const r = importProjectText(copy.text);
        if (!r.ok) {
          set({
            notice: {
              kind: "error",
              msg: msg("ui.notice.backup.unreadable", { reason: r.message }),
              details: r.issues,
            },
          });
          return r;
        }
        const h = get().history;
        if (h.group !== null) set({ history: endGroup(h) });
        const applied = apply(r.project);
        if (!applied.ok) {
          const message = msg("ui.notice.backup.refused");
          // Motifs déjà traduits par `apply` dans la langue du moment.
          const issues = applied.issues.map(textMessage);
          set({ notice: { kind: "error", msg: message, details: issues } });
          return { ok: false, message, issues };
        }
        set({
          selection: null,
          overlays: DEFAULT_OVERLAYS,
          notice: {
            kind: "info",
            msg: msg("ui.notice.backup.restored", { name: r.project.name }),
          },
        });
        get().dismissRejectedAutosave();
        return r;
      },
      flushAutosave: () => flush(),
    };
  });

  // Autosauvegarde à chaque changement de projet (différée pour ne pas écrire à chaque frappe).
  if (storage) {
    const delay = options.autosaveDelayMs ?? 500;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Écriture différée faute d'accord (autosauvegarde refusée non copiée) : faite à la reprise.
    let skipped = false;
    const save = (): void => {
      timer = undefined;
      if (store.getState().rejectedAutosave?.preserved === false) {
        skipped = true;
        return;
      }
      skipped = false;
      const ok = saveAutosave(storage, store.getState().project);
      if (ok === store.getState().autosaveFailed) store.setState({ autosaveFailed: !ok });
    };
    resume = () => {
      if (skipped) save();
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
