/**
 * Parcours guidé / libre (ADR-0009) : état d'interface hors projet et ses règles, en fonctions
 * pures (sans DOM ni store). Le store `store/journeyStore.ts` les applique et mémorise les
 * préférences dans le stockage du navigateur ; l'affichage arrive en vagues 2 (libre) et 5
 * (guidé). Rien ici ne touche au projet, à l'historique, à la sélection ni à la vue.
 */
import type { PlanMode, ProjectOrigin, ViewTab } from "../store/projectStore.js";
import {
  GUIDED_STEPS,
  isGuidedStep,
  isSectionId,
  type GuidedStep,
  type SectionId,
} from "./sectionIds.js";

export type Journey = "guided" | "free";
/** Espace de travail : Conception (édition) ou Fabrication (pièces, développés, dossier). */
export type Workspace = "design" | "fabrication";

export interface JourneyPrefs {
  readonly journey: Journey;
  /** Étape courante du parcours guidé. */
  readonly guidedStep: GuidedStep;
  /** Étapes vues au moins une fois depuis l'ouverture du projet (coche ✓ des étapes). */
  readonly visitedSteps: ReadonlySet<GuidedStep>;
  /** Panneau ouvert du parcours libre (un seul à la fois), ou aucun. */
  readonly freePanel: SectionId | null;
  /** Le panneau reste ouvert au clic dans la vue. */
  readonly freePanelPinned: boolean;
  readonly workspace: Workspace;
  /** Encart « Vous connaissez le métier ? » refermé par l'utilisateur. */
  readonly hintFreeJourneyDismissed: boolean;
}

export const DEFAULT_JOURNEY_PREFS: JourneyPrefs = {
  journey: "guided",
  guidedStep: 1,
  visitedSteps: new Set(),
  freePanel: null,
  freePanelPinned: false,
  workspace: "design",
  hintFreeJourneyDismissed: false,
};

/**
 * Parcours au démarrage : le dernier choix mémorisé ; à défaut, libre si un projet est repris
 * (autosauvegarde), guidé à la première visite. On ne demande jamais « débutant ou expert ? ».
 */
export function initialJourney({
  remembered,
  hasAutosave,
}: {
  readonly remembered: Journey | null;
  readonly hasAutosave: boolean;
}): Journey {
  if (remembered !== null) return remembered;
  return hasAutosave ? "free" : "guided";
}

/**
 * Préférences après l'ouverture d'un projet : démo ou assistant → guidé à l'étape 1 ; import ou
 * reprise d'une copie → libre ; préréglage → parcours inchangé. Dans tous les cas, les étapes
 * vues repartent de zéro et l'espace revient en Conception ; le panneau libre et son épinglage
 * sont conservés.
 */
export function journeyAfterOpening(origin: ProjectOrigin, prefs: JourneyPrefs): JourneyPrefs {
  const base: JourneyPrefs = { ...prefs, visitedSteps: new Set(), workspace: "design" };
  switch (origin) {
    case "demo":
    case "assistant":
      return { ...base, journey: "guided", guidedStep: 1 };
    case "import":
    case "restore":
      return { ...base, journey: "free" };
    case "preset":
      return base;
  }
}

/**
 * Sections du parcours libre couvertes par chaque étape guidée. L'étape 7 ouvre le mode
 * Fabrication (aucune section) ; le Contexte de contrôle (`compliance`) n'a pas d'étape.
 */
export const STEP_SECTIONS: Readonly<Record<GuidedStep, readonly SectionId[]>> = {
  1: ["site"],
  2: ["layout", "balancing"],
  3: ["stepping"],
  4: ["treads"],
  5: ["structure"],
  6: ["guards"],
  7: [],
};

/** Espace de travail d'une étape : Fabrication pour la 7, Conception sinon. */
export function stepWorkspace(step: GuidedStep): Workspace {
  return step === 7 ? "fabrication" : "design";
}

/**
 * Préférences après le passage à une étape du guidé : étape courante, marquée comme vue, et
 * espace de travail de l'étape (`stepWorkspace` : Fabrication pour la 7, Conception sinon),
 * comme `switchJourney`.
 */
export function goToStep(prefs: JourneyPrefs, step: GuidedStep): JourneyPrefs {
  return {
    ...prefs,
    guidedStep: step,
    visitedSteps: new Set([...prefs.visitedSteps, step]),
    workspace: stepWorkspace(step),
  };
}

/** Panneau libre correspondant à une étape (première section), `null` pour la Fabrication. */
export function panelForStep(step: GuidedStep): SectionId | null {
  return STEP_SECTIONS[step][0] ?? null;
}

/** Étape guidée couvrant une section, `null` pour le Contexte de contrôle. */
export function stepForPanel(section: SectionId): GuidedStep | null {
  for (const step of GUIDED_STEPS) {
    if (STEP_SECTIONS[step].includes(section)) return step;
  }
  return null;
}

/** Vue proposée au changement d'étape (l'utilisateur reste libre d'en changer). */
export interface RecommendedView {
  readonly view: ViewTab;
  readonly planMode?: PlanMode;
}

const RECOMMENDED_VIEWS: Readonly<Record<GuidedStep, RecommendedView>> = {
  1: { view: "plan", planMode: "site" },
  2: { view: "plan", planMode: "drawing" },
  3: { view: "elevation" },
  4: { view: "3d" },
  5: { view: "3d" },
  6: { view: "3d" },
  7: { view: "flat" },
};

/**
 * Vue conseillée par étape : Site → plan « Site et saisie » ; Forme → plan coté ; Découpage →
 * élévation ; Marches, Structure, Garde-corps → 3D ; Fabrication → développés.
 */
export function recommendedView(step: GuidedStep): RecommendedView {
  return RECOMMENDED_VIEWS[step];
}

/** Événements du panneau unique du parcours libre. */
export type PanelEvent =
  | { readonly type: "rail"; readonly section: SectionId }
  | { readonly type: "escape" }
  | { readonly type: "close" }
  | { readonly type: "outside" }
  | { readonly type: "pin"; readonly pinned: boolean };

export interface PanelState {
  readonly freePanel: SectionId | null;
  readonly freePanelPinned: boolean;
}

/**
 * Panneau après un événement (un seul ouvert à la fois) : un clic sur l'icône du rail de la
 * section ouverte la ferme, sur une autre l'ouvre à sa place (épinglé ou non) ; Échap et la
 * croix ferment ; un clic dans la vue ne ferme qu'un panneau non épinglé.
 */
export function panelAfter(state: PanelState, e: PanelEvent): PanelState {
  switch (e.type) {
    case "rail":
      return { ...state, freePanel: state.freePanel === e.section ? null : e.section };
    case "escape":
    case "close":
      return { ...state, freePanel: null };
    case "outside":
      return state.freePanelPinned ? state : { ...state, freePanel: null };
    case "pin":
      return { ...state, freePanelPinned: e.pinned };
  }
}

/**
 * Bascule de parcours. Guidé → libre : ouvert sur la section de l'étape en cours (étape 7 :
 * mode Fabrication, panneau inchangé). Libre → guidé : étape du panneau ouvert (Fabrication :
 * étape 7 ; Contexte ou aucun panneau : étape inchangée), marquée comme vue.
 */
export function switchJourney(prefs: JourneyPrefs, target: Journey): JourneyPrefs {
  if (prefs.journey === target) return prefs;
  if (target === "free") {
    const panel = panelForStep(prefs.guidedStep);
    return panel === null
      ? { ...prefs, journey: "free", workspace: "fabrication" }
      : { ...prefs, journey: "free", freePanel: panel, workspace: "design" };
  }
  const fromPanel = prefs.freePanel === null ? null : stepForPanel(prefs.freePanel);
  const step: GuidedStep = prefs.workspace === "fabrication" ? 7 : (fromPanel ?? prefs.guidedStep);
  return {
    ...prefs,
    journey: "guided",
    guidedStep: step,
    workspace: stepWorkspace(step),
    visitedSteps: new Set([...prefs.visitedSteps, step]),
  };
}

/**
 * Étape cochée ✓ : vue au moins une fois et aucune règle bloquante rattachée (le rattachement
 * des règles aux étapes est fait par l'appelant, vague 5).
 */
export function isStepChecked(
  step: GuidedStep,
  visited: ReadonlySet<GuidedStep>,
  blockingCount: number,
): boolean {
  return visited.has(step) && blockingCount === 0;
}

function isJourney(v: unknown): v is Journey {
  return v === "guided" || v === "free";
}

function isWorkspace(v: unknown): v is Workspace {
  return v === "design" || v === "fabrication";
}

/**
 * Préférences mémorisées ; robuste : texte absent, JSON invalide ou valeurs hors domaine →
 * champs ignorés (jamais d'exception).
 */
export function parsePrefs(text: string | null): Partial<JourneyPrefs> {
  if (text === null) return {};
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return {};
  const o = json as Record<string, unknown>;
  const out: { -readonly [K in keyof JourneyPrefs]?: JourneyPrefs[K] } = {};
  if (isJourney(o.journey)) out.journey = o.journey;
  if (isGuidedStep(o.guidedStep)) out.guidedStep = o.guidedStep;
  if (Array.isArray(o.visitedSteps)) {
    out.visitedSteps = new Set(o.visitedSteps.filter(isGuidedStep));
  }
  if (o.freePanel === null || isSectionId(o.freePanel)) out.freePanel = o.freePanel;
  if (typeof o.freePanelPinned === "boolean") out.freePanelPinned = o.freePanelPinned;
  if (isWorkspace(o.workspace)) out.workspace = o.workspace;
  if (typeof o.hintFreeJourneyDismissed === "boolean") {
    out.hintFreeJourneyDismissed = o.hintFreeJourneyDismissed;
  }
  return out;
}

/** Texte mémorisé (JSON compact ; étapes vues en tableau trié). */
export function serializePrefs(prefs: JourneyPrefs): string {
  return JSON.stringify({
    journey: prefs.journey,
    guidedStep: prefs.guidedStep,
    visitedSteps: [...prefs.visitedSteps].sort((a, b) => a - b),
    freePanel: prefs.freePanel,
    freePanelPinned: prefs.freePanelPinned,
    workspace: prefs.workspace,
    hintFreeJourneyDismissed: prefs.hintFreeJourneyDismissed,
  });
}
