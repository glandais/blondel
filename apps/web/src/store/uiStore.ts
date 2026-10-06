/**
 * État d'interface éphémère partagé par la barre du haut, la vue centrale et l'inspecteur des
 * deux parcours (ADR-0009, vagues 2 et 5) : ni projet, ni préférence mémorisée.
 *
 * - `workshopOpen` : fenêtre « Profil d'atelier » ouverte (menu ⋯ de la barre du haut, lien
 *   « Compléter le profil d'atelier » de l'inspecteur) ;
 * - `controlRevealSeq` : incrémenté par le badge « Contrôle » ; l'inspecteur montre alors son
 *   bloc de contrôle (défilement et focus) ;
 * - `viewCommand` : commande − / + / Recadrer de la vue centrale, consommée par la vue affichée
 *   (zoom des SVG exportés, caméra 3D) ;
 * - `lastViewByWorkspace` : dernière vue de chaque espace (Conception : Plan, 3D, Élévation ;
 *   Fabrication : Pièces, Nomenclature, Comparer, À valider) ;
 * - `isolatedPartId` : pièce isolée dans la vue 3D (outil « Isoler » de la vue, action « Isoler
 *   en 3D » de l'inspecteur Pièce), `null` : toutes les pièces ;
 * - `overridesRevealSeq` : incrémenté par le lien du compteur de surcharges (panneau Contexte) ;
 *   l'inspecteur « sans sélection » déplie alors la liste des surcharges et la montre ;
 * - `guidedControlOpen` : liste du contrôle superposée à la vue du parcours guidé (boutons des
 *   sévérités du pied de page) ; `guidedControlContext` : repli « Contexte de contrôle » déplié
 *   en tête de cette liste (le Contexte n'a pas d'étape).
 *
 * Navigation consciente du parcours : `goToGuidedStep` (étape, vue conseillée), `openSection`,
 * `openParam`, `switchWorkspace`, `revealControl` et `revealOverrides` mènent, en libre, au
 * panneau ou à l'espace demandé et, en guidé, à l'étape correspondante (ou à la liste du
 * contrôle). Ni le projet, ni l'historique, ni la sélection (sauf « révéler » le contrôle, qui
 * l'efface) ne changent.
 *
 * Espace de travail et vue restent cohérents (`linkWorkspaceAndView`) : passer en Fabrication
 * affiche la dernière vue de Fabrication, revenir en Conception rend la vue quittée ; une vue
 * choisie ailleurs (démo en 3D, import de calque sur le plan) ramène l'espace qui la contient.
 * Ni le projet, ni l'historique, ni la sélection ne changent.
 */
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { guidedStepOfRow } from "../lib/guidedSteps.js";
import { recommendedView, stepForPanel, type Workspace } from "../lib/journey.js";
import type { GuidedStep, SectionId } from "../lib/sectionIds.js";
import type { ToValidateRow } from "../lib/toValidate.js";
import { appStore, journeyStore } from "./appStore.js";
import type { JourneyState } from "./journeyStore.js";
import type { ProjectStore, ViewTab } from "./projectStore.js";

/** Vues de chaque espace de travail, dans l'ordre des onglets. */
export const DESIGN_VIEWS: readonly ViewTab[] = ["plan", "3d", "elevation"];
export const FABRICATION_VIEWS: readonly ViewTab[] = ["flat", "bom", "compare", "validate"];

/** Espace de travail qui contient une vue. */
export function workspaceOfView(view: ViewTab): Workspace {
  return (FABRICATION_VIEWS as readonly string[]).includes(view) ? "fabrication" : "design";
}

export type ViewCommandKind = "zoomIn" | "zoomOut" | "fit";

export interface ViewCommand {
  readonly kind: ViewCommandKind;
  /** Incrémenté à chaque commande : deux commandes identiques restent distinctes. */
  readonly seq: number;
}

export interface UiState {
  readonly workshopOpen: boolean;
  readonly controlRevealSeq: number;
  readonly viewCommand: ViewCommand | null;
  readonly lastViewByWorkspace: Readonly<Record<Workspace, ViewTab>>;
  readonly isolatedPartId: string | null;
  readonly overridesRevealSeq: number;
  /** Liste du contrôle superposée à la vue du parcours guidé. */
  readonly guidedControlOpen: boolean;
  /** Repli « Contexte de contrôle » déplié en tête de la liste du contrôle du guidé. */
  readonly guidedControlContext: boolean;
  /**
   * Demandes de montrer le « Contexte de contrôle » (lien « Profil », `openSection`) : la liste
   * le ramène en tête et lui donne le focus, même s'il était déjà déplié.
   */
  readonly guidedControlContextSeq: number;
}

export function createUiStore(initialView: ViewTab = "plan"): StoreApi<UiState> {
  return createStore<UiState>()(() => ({
    workshopOpen: false,
    controlRevealSeq: 0,
    viewCommand: null,
    lastViewByWorkspace: {
      design: workspaceOfView(initialView) === "design" ? initialView : "plan",
      fabrication: workspaceOfView(initialView) === "fabrication" ? initialView : "flat",
    },
    isolatedPartId: null,
    overridesRevealSeq: 0,
    guidedControlOpen: false,
    guidedControlContext: false,
    guidedControlContextSeq: 0,
  }));
}

/**
 * Lie l'espace de travail (store du parcours) et la vue active (store du projet) ; rend la
 * fonction de désabonnement. Au départ, la vue est ramenée dans l'espace mémorisé.
 */
export function linkWorkspaceAndView(
  app: ProjectStore,
  journey: StoreApi<JourneyState>,
  ui: StoreApi<UiState>,
): () => void {
  const remember = (view: ViewTab): void => {
    const ws = workspaceOfView(view);
    if (ui.getState().lastViewByWorkspace[ws] === view) return;
    ui.setState((s) => ({ lastViewByWorkspace: { ...s.lastViewByWorkspace, [ws]: view } }));
  };
  const showWorkspace = (ws: Workspace): void => {
    if (workspaceOfView(app.getState().view) !== ws) {
      app.getState().setView(ui.getState().lastViewByWorkspace[ws]);
    }
  };
  remember(app.getState().view);
  showWorkspace(journey.getState().workspace);
  const offApp = app.subscribe((s, prev) => {
    if (s.view === prev.view) return;
    remember(s.view);
    const ws = workspaceOfView(s.view);
    if (journey.getState().workspace !== ws) journey.getState().setWorkspace(ws);
  });
  const offJourney = journey.subscribe((s, prev) => {
    if (s.workspace !== prev.workspace) showWorkspace(s.workspace);
  });
  return () => {
    offApp();
    offJourney();
  };
}

/** Instance de l'application. */
export const uiStore = createUiStore(appStore.getState().view);

linkWorkspaceAndView(appStore, journeyStore, uiStore);

export function useUi<T>(selector: (s: UiState) => T): T {
  return useStore(uiStore, selector);
}

export function openWorkshopDialog(): void {
  uiStore.setState({ workshopOpen: true });
}

export function closeWorkshopDialog(): void {
  uiStore.setState({ workshopOpen: false });
}

/** Le parcours guidé est-il affiché ? */
function isGuided(): boolean {
  return journeyStore.getState().journey === "guided";
}

/**
 * Badge « Contrôle » : sélection effacée (inspecteur « sans sélection ») et contrôle montré.
 * Libre : l'inspecteur n'est affiché qu'en Conception ; appelé en Fabrication, on y repasse
 * d'abord. Guidé : la liste du contrôle s'ouvre par-dessus la vue (étape inchangée).
 */
export function revealControl(): void {
  if (isGuided()) openGuidedControl();
  else showDesign();
  appStore.getState().select(null);
  uiStore.setState((s) => ({ controlRevealSeq: s.controlRevealSeq + 1 }));
}

export function sendViewCommand(kind: ViewCommandKind): void {
  uiStore.setState((s) => ({ viewCommand: { kind, seq: (s.viewCommand?.seq ?? 0) + 1 } }));
}

/**
 * Abonnement d'une vue aux commandes − / + / Recadrer : `onCommand` est appelé une fois par
 * commande émise après le montage (la commande présente au montage, déjà consommée par la vue
 * précédente, est ignorée). Aucun calcul n'est relancé : seule la vue réagit.
 */
export function useViewCommand(onCommand: (kind: ViewCommandKind) => void): void {
  const command = useUi((s) => s.viewCommand);
  const seen = useRef(command?.seq ?? 0);
  const handler = useRef(onCommand);
  useEffect(() => {
    handler.current = onCommand;
  });
  useEffect(() => {
    if (!command || command.seq === seen.current) return;
    seen.current = command.seq;
    handler.current(command.kind);
  }, [command]);
}

/**
 * Bascule Conception / Fabrication (la vue suit, voir `linkWorkspaceAndView`). En guidé, la
 * Fabrication est l'étape 7 (`goToGuidedStep(7)`) ; « Conception » est sans effet : chaque
 * étape de 1 à 6 est déjà en Conception et le guidé n'a pas de bascule d'espace (l'appelant
 * qui veut une section précise passe par `openSection`).
 */
export function switchWorkspace(target: Workspace): void {
  if (isGuided()) {
    if (target === "fabrication") goToGuidedStep(7);
    return;
  }
  journeyStore.getState().setWorkspace(target);
}

/** Repasse en Conception si l'espace courant est la Fabrication (inspecteur affiché). */
function showDesign(): void {
  if (journeyStore.getState().workspace !== "design") switchWorkspace("design");
}

/** Isole une pièce dans la vue 3D (la vue réaffiche tout si la pièce disparaît du modèle). */
export function isolatePart(partId: string): void {
  uiStore.setState({ isolatedPartId: partId });
}

/** Réaffiche toutes les pièces de la vue 3D. */
export function showAllParts(): void {
  uiStore.setState({ isolatedPartId: null });
}

/**
 * Lien du compteur de surcharges : sélection effacée (inspecteur « sans sélection ») et liste
 * des surcharges dépliée et montrée (en Conception, comme `revealControl` ; en guidé, dans la
 * liste du contrôle superposée à la vue).
 */
export function revealOverrides(): void {
  if (isGuided()) openGuidedControl();
  else showDesign();
  appStore.getState().select(null);
  uiStore.setState((s) => ({ overridesRevealSeq: s.overridesRevealSeq + 1 }));
}

// ------------------------------------------------------------------ Parcours guidé

/**
 * Va à une étape du guidé : étape courante, marquée comme vue, espace de l'étape
 * (`setGuidedStep`, la liaison espace ↔ vue réagit aussitôt), puis vue conseillée de l'étape
 * (vue et mode du plan) : proposée au changement d'étape, l'utilisateur peut en changer
 * ensuite. La liste du contrôle se ferme. Sans effet sur l'étape courante.
 */
export function goToGuidedStep(step: GuidedStep): void {
  if (journeyStore.getState().guidedStep === step) return;
  journeyStore.getState().setGuidedStep(step);
  const rec = recommendedView(step);
  const app = appStore.getState();
  if (app.view !== rec.view) app.setView(rec.view);
  if (rec.planMode !== undefined && appStore.getState().planMode !== rec.planMode) {
    appStore.getState().setPlanMode(rec.planMode);
  }
  closeGuidedControl();
}

/**
 * Ouvre une section. Libre : en Conception, panneau de la section. Guidé : étape de la section
 * (`stepForPanel`) ; le Contexte de contrôle, sans étape, ouvre la liste du contrôle avec son
 * repli « Contexte » déplié.
 */
export function openSection(section: SectionId): void {
  if (!isGuided()) {
    showDesign();
    journeyStore.getState().openFreePanel(section);
    return;
  }
  const step = stepForPanel(section);
  if (step === null) openGuidedControl({ context: true });
  else goToGuidedStep(step);
}

/**
 * Mène à la section d'un paramètre (lien « Ouvrir » d'une valeur ◆, « Pour corriger »). Libre :
 * en Conception, panneau de la section. Guidé : étape du paramètre (`guidedStepOfRow`) ; un
 * paramètre absent du guidé (réglage de Conception) fait passer en libre, panneau de sa
 * section ouvert. Ne donne pas le focus : l'appelant appelle ensuite `focusParamField`.
 */
export function openParam(
  row: Pick<ToValidateRow, "key" | "section" | "steps" | "structureKind">,
): void {
  if (isGuided()) {
    const step = guidedStepOfRow(row);
    if (step !== null) {
      goToGuidedStep(step);
      closeGuidedControl();
      return;
    }
    journeyStore.getState().setJourney("free");
  }
  showDesign();
  journeyStore.getState().openFreePanel(row.section);
}

/**
 * Ouvre la liste du contrôle du guidé ; `context` : repli « Contexte de contrôle » déplié,
 * ramené en tête de la liste et focalisé (`guidedControlContextSeq`).
 */
export function openGuidedControl(options?: { readonly context?: boolean }): void {
  const context = options?.context === true;
  uiStore.setState((s) => ({
    guidedControlOpen: true,
    guidedControlContext: context ? true : s.guidedControlContext,
    guidedControlContextSeq: s.guidedControlContextSeq + (context ? 1 : 0),
  }));
}

/** Ferme la liste du contrôle du guidé (Échap, croix, changement d'étape). */
export function closeGuidedControl(): void {
  if (uiStore.getState().guidedControlOpen) uiStore.setState({ guidedControlOpen: false });
}

/** Déplie ou replie le « Contexte de contrôle » en tête de la liste du contrôle du guidé. */
export function setGuidedControlContext(open: boolean): void {
  uiStore.setState({ guidedControlContext: open });
}
