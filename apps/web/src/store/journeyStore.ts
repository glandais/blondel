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
  /**
   * Transitoire, jamais mémorisé : fenêtre étroite (< 760 px, ADR-0009 point 3), le parcours
   * guidé est imposé (`setNarrowViewport`). Le libre y est indisponible ; le parcours mémorisé
   * reste le dernier choix de l'utilisateur.
   */
  readonly guidedImposed: boolean;
  /**
   * Change de parcours (panneau ou étape correspondants, `switchJourney`). Sans effet vers le
   * libre tant que le guidé est imposé.
   */
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
  /**
   * Applique la règle d'ouverture d'un projet chargé (`journeyAfterOpening`). Guidé imposé :
   * la règle fixe le parcours rétabli au retour d'une fenêtre large (import → libre), le guidé
   * reste affiché.
   */
  applyOpening(origin: ProjectOrigin): void;
  /**
   * Fenêtre étroite (< 760 px) ou non, appelé par `App` au passage du seuil. Étroite : le guidé
   * est imposé (étape du panneau ouvert, comme `switchJourney`). Large de nouveau : le parcours
   * d'avant est rétabli (libre : même panneau et même espace si l'étape n'a pas changé, sinon
   * panneau de l'étape courante).
   */
  setNarrowViewport(narrow: boolean): void;
}

/** Parcours à rétablir quand le guidé cesse d'être imposé. */
interface ImposedFrom {
  /** Dernier choix de l'utilisateur (ou de la règle d'ouverture), celui qu'on mémorise. */
  readonly journey: Journey;
  readonly freePanel: SectionId | null;
  readonly workspace: Workspace;
  /** Étape affichée par l'imposition : si elle n'a pas changé, panneau et espace rétablis. */
  readonly step: GuidedStep;
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
  // Guidé imposé (fenêtre étroite) : parcours à rétablir, `null` hors imposition.
  let imposed: ImposedFrom | null = null;
  const store = createStore<JourneyState>()((set, get) => {
    const prefs = (): JourneyPrefs => prefsOf(get());
    /** Impose le guidé sur `p` ; `journey` : parcours à rétablir ensuite. */
    const impose = (p: JourneyPrefs, journey: Journey): JourneyPrefs => {
      const next = switchJourney(p, "guided", true);
      imposed = { journey, freePanel: p.freePanel, workspace: p.workspace, step: next.guidedStep };
      return next;
    };
    return {
      ...start,
      freePanelFromGuided: false,
      guidedImposed: false,
      setJourney: (journey) => {
        if (get().guidedImposed && journey === "free") return;
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
      applyOpening: (origin) => {
        if (imposed === null) {
          set(journeyAfterOpening(origin, prefs(), guidedAvailable));
          return;
        }
        // Règle appliquée comme sans imposition (parcours de référence : celui à rétablir).
        const wouldBe = journeyAfterOpening(
          origin,
          { ...prefs(), journey: imposed.journey },
          guidedAvailable,
        );
        if (wouldBe.journey === "guided") {
          imposed = { ...imposed, journey: "guided" };
          set(wouldBe);
        } else {
          set({ ...impose(wouldBe, "free"), freePanelFromGuided: false });
        }
      },
      setNarrowViewport: (narrow) => {
        if (narrow) {
          if (get().guidedImposed || !guidedAvailable) return;
          const p = prefs();
          if (p.journey === "guided") {
            imposed = {
              journey: "guided",
              freePanel: p.freePanel,
              workspace: p.workspace,
              step: p.guidedStep,
            };
            set({ guidedImposed: true });
          } else {
            set({ ...impose(p, "free"), guidedImposed: true, freePanelFromGuided: false });
          }
          return;
        }
        const from = imposed;
        if (!get().guidedImposed || from === null) return;
        imposed = null;
        if (from.journey === "guided") {
          set({ guidedImposed: false });
          return;
        }
        const p = prefs();
        const next: JourneyPrefs =
          p.guidedStep === from.step
            ? { ...p, journey: "free", freePanel: from.freePanel, workspace: from.workspace }
            : switchJourney(p, "free", guidedAvailable);
        set({ ...next, guidedImposed: false, freePanelFromGuided: false });
      },
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
    // Guidé imposé : on mémorise le parcours à rétablir (dernier choix de l'utilisateur).
    const chosen = (s: JourneyState): JourneyPrefs => {
      const p = prefsOf(s);
      return imposed === null ? p : { ...p, journey: imposed.journey };
    };
    let last = persisted(start);
    // Parcours choisi par la règle de démarrage mémorisé tout de suite : au lancement suivant,
    // c'est lui le « dernier choix » (un nouveau venu guidé ne bascule pas en libre parce que
    // son projet est désormais repris de l'autosauvegarde). Jamais pour un repli.
    if (stored.journey === undefined && guidedAvailable) write(last);
    store.subscribe((s) => {
      const text = persisted(chosen(s));
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
