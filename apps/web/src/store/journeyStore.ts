/**
 * État d'interface des parcours guidé / libre (ADR-0009) : séparé du projet, mémorisé dans le
 * stockage du navigateur (comme le thème ou le barème d'atelier), jamais dans l'autosauvegarde
 * ni dans l'historique annuler / rétablir. Règles : `lib/journey.ts`.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import {
  DEFAULT_JOURNEY_PREFS,
  goToStep,
  initialJourney,
  journeyAfterOpening,
  panelAfter,
  parsePrefs,
  serializePrefs,
  switchJourney,
  type Journey,
  type JourneyPrefs,
  type PanelEvent,
  type Workspace,
} from "../lib/journey.js";
import type { GuidedStep, SectionId } from "../lib/sectionIds.js";
import type { StorageLike } from "./persistence.js";
import type { ProjectOrigin, ProjectStore } from "./projectStore.js";

export const JOURNEY_KEY = "blondel.ui.journey";

export interface JourneyState extends JourneyPrefs {
  /**
   * Transitoire, jamais mémorisé : le panneau libre vient d'être ouvert par la bascule depuis le
   * guidé (note « Ouvert sur la section où vous étiez… »). Remis à faux par tout événement du
   * panneau.
   */
  readonly freePanelFromGuided: boolean;
  /** Change de parcours (panneau ou étape correspondants, `switchJourney`). */
  setJourney(journey: Journey): void;
  /** Va à une étape du guidé (marquée comme vue, espace de l'étape : `goToStep`). */
  setGuidedStep(step: GuidedStep): void;
  markStepVisited(step: GuidedStep): void;
  /** Rail, Échap, croix, clic dans la vue, épingle (`panelAfter`). */
  panelEvent(e: PanelEvent): void;
  openFreePanel(section: SectionId): void;
  closeFreePanel(): void;
  setFreePanelPinned(pinned: boolean): void;
  setWorkspace(workspace: Workspace): void;
  dismissFreeJourneyHint(): void;
  /** Applique la règle d'ouverture d'un projet chargé (`journeyAfterOpening`). */
  applyOpening(origin: ProjectOrigin): void;
}

export interface JourneyStoreOptions {
  /** Un projet est repris de l'autosauvegarde (sinon : première visite). */
  readonly hasAutosave: boolean;
  /**
   * Parcours guidé disponible (vrai par défaut ; l'application l'affiche depuis la vague 5 et
   * ne passe plus l'option). Faux : toute transition qui y mènerait (démarrage, préférence
   * mémorisée, démo, assistant, `setJourney("guided")`) donne le libre, sans ouvrir de panneau,
   * et ce repli n'est jamais mémorisé comme un choix.
   */
  readonly guidedAvailable?: boolean;
}

/** Préférences mémorisées (vides si absentes, illisibles ou stockage indisponible). */
function loadPrefs(storage: StorageLike | undefined): Partial<JourneyPrefs> {
  try {
    return parsePrefs(storage?.getItem(JOURNEY_KEY) ?? null);
  } catch {
    return {};
  }
}

function prefsOf(s: JourneyState): JourneyPrefs {
  return {
    journey: s.journey,
    guidedStep: s.guidedStep,
    visitedSteps: s.visitedSteps,
    freePanel: s.freePanel,
    freePanelPinned: s.freePanelPinned,
    workspace: s.workspace,
    hintFreeJourneyDismissed: s.hintFreeJourneyDismissed,
  };
}

export function createJourneyStore(
  storage: StorageLike | undefined,
  options: JourneyStoreOptions,
): StoreApi<JourneyState> {
  const stored = loadPrefs(storage);
  const guidedAvailable = options.guidedAvailable ?? true;
  const journey0 = initialJourney({
    remembered: stored.journey ?? null,
    hasAutosave: options.hasAutosave,
    guidedAvailable,
  });
  const base: JourneyPrefs = { ...DEFAULT_JOURNEY_PREFS, ...stored, journey: journey0 };
  // Démarrage en guidé : l'étape affichée compte comme vue (coche ✓).
  const start: JourneyPrefs =
    journey0 === "guided" && !base.visitedSteps.has(base.guidedStep)
      ? { ...base, visitedSteps: new Set([...base.visitedSteps, base.guidedStep]) }
      : base;
  const store = createStore<JourneyState>()((set, get) => {
    const prefs = (): JourneyPrefs => prefsOf(get());
    return {
      ...start,
      freePanelFromGuided: false,
      setJourney: (journey) => {
        const before = prefs();
        const next = switchJourney(before, journey, guidedAvailable);
        if (next === before) return;
        set({
          ...next,
          // Guidé → libre ouvre le panneau de l'étape (sauf étape 7 : Fabrication).
          freePanelFromGuided:
            before.journey === "guided" && next.journey === "free" && next.workspace === "design",
        });
      },
      setGuidedStep: (step) => set(goToStep(prefs(), step)),
      markStepVisited: (step) => {
        if (get().visitedSteps.has(step)) return;
        set((s) => ({ visitedSteps: new Set([...s.visitedSteps, step]) }));
      },
      panelEvent: (e) => {
        const { freePanel, freePanelPinned } = get();
        set({ ...panelAfter({ freePanel, freePanelPinned }, e), freePanelFromGuided: false });
      },
      openFreePanel: (section) => set({ freePanel: section, freePanelFromGuided: false }),
      closeFreePanel: () => set({ freePanel: null, freePanelFromGuided: false }),
      setFreePanelPinned: (freePanelPinned) => set({ freePanelPinned }),
      setWorkspace: (workspace) => set({ workspace }),
      dismissFreeJourneyHint: () => set({ hintFreeJourneyDismissed: true }),
      applyOpening: (origin) => set(journeyAfterOpening(origin, prefs(), guidedAvailable)),
    };
  });

  // Mémorisation à chaque changement ; un stockage indisponible ou plein est sans effet.
  if (storage) {
    const write = (text: string): void => {
      try {
        storage.setItem(JOURNEY_KEY, text);
      } catch {
        // stockage inaccessible : préférences gardées en mémoire seulement
      }
    };
    // Sans parcours guidé, le « libre » affiché est un repli, pas un choix : on mémorise le
    // parcours enregistré tel quel (ou rien), pour que la règle d'ouverture (première visite →
    // guidé) et une préférence « guidé » survivent jusqu'à l'arrivée du guidé.
    const persisted = (p: JourneyPrefs): string => {
      const text = serializePrefs(p);
      if (guidedAvailable) return text;
      const { journey: _fallback, ...rest } = JSON.parse(text) as Record<string, unknown>;
      return JSON.stringify(
        stored.journey === undefined ? rest : { journey: stored.journey, ...rest },
      );
    };
    let last = persisted(start);
    // Parcours choisi par la règle de démarrage mémorisé tout de suite : au lancement suivant,
    // c'est lui le « dernier choix » (un nouveau venu guidé ne bascule pas en libre parce que
    // son projet est désormais repris de l'autosauvegarde). Jamais pour un repli.
    if (stored.journey === undefined && guidedAvailable) write(last);
    store.subscribe((s) => {
      const text = persisted(prefsOf(s));
      if (text === last) return;
      last = text;
      write(text);
    });
  }
  return store;
}

/**
 * Lie le parcours au projet : chaque projet chargé avec succès (`lastOpened`, nouveau numéro
 * d'ordre) applique sa règle d'ouverture (`applyOpening`). Rend la fonction de désabonnement.
 */
export function linkJourneyToProject(
  projects: ProjectStore,
  journey: StoreApi<JourneyState>,
): () => void {
  return projects.subscribe((s, prev) => {
    const opened = s.lastOpened;
    if (opened === null || opened.seq === prev.lastOpened?.seq) return;
    journey.getState().applyOpening(opened.origin);
  });
}
