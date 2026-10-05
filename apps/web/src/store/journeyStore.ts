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
  const start: JourneyPrefs = {
    ...DEFAULT_JOURNEY_PREFS,
    ...stored,
    journey: initialJourney({
      remembered: stored.journey ?? null,
      hasAutosave: options.hasAutosave,
    }),
  };
  const store = createStore<JourneyState>()((set, get) => {
    const prefs = (): JourneyPrefs => prefsOf(get());
    return {
      ...start,
      setJourney: (journey) => set(switchJourney(prefs(), journey)),
      setGuidedStep: (step) => set(goToStep(prefs(), step)),
      markStepVisited: (step) => {
        if (get().visitedSteps.has(step)) return;
        set((s) => ({ visitedSteps: new Set([...s.visitedSteps, step]) }));
      },
      panelEvent: (e) => {
        const { freePanel, freePanelPinned } = get();
        set(panelAfter({ freePanel, freePanelPinned }, e));
      },
      openFreePanel: (section) => set({ freePanel: section }),
      closeFreePanel: () => set({ freePanel: null }),
      setFreePanelPinned: (freePanelPinned) => set({ freePanelPinned }),
      setWorkspace: (workspace) => set({ workspace }),
      dismissFreeJourneyHint: () => set({ hintFreeJourneyDismissed: true }),
      applyOpening: (origin) => set(journeyAfterOpening(origin, prefs())),
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
    let last = serializePrefs(start);
    // Parcours choisi par la règle de démarrage mémorisé tout de suite : au lancement suivant,
    // c'est lui le « dernier choix » (un nouveau venu guidé ne bascule pas en libre parce que
    // son projet est désormais repris de l'autosauvegarde).
    if (stored.journey === undefined) write(last);
    store.subscribe((s) => {
      const text = serializePrefs(prefsOf(s));
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
