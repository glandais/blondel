/**
 * État d'interface éphémère partagé par la barre du haut, la vue centrale et l'inspecteur du
 * parcours libre (ADR-0009, vague 2) : ni projet, ni préférence mémorisée.
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
 *   l'inspecteur « sans sélection » déplie alors la liste des surcharges et la montre.
 *
 * Espace de travail et vue restent cohérents (`linkWorkspaceAndView`) : passer en Fabrication
 * affiche la dernière vue de Fabrication, revenir en Conception rend la vue quittée ; une vue
 * choisie ailleurs (démo en 3D, import de calque sur le plan) ramène l'espace qui la contient.
 * Ni le projet, ni l'historique, ni la sélection ne changent.
 */
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Workspace } from "../lib/journey.js";
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

/**
 * Badge « Contrôle » : sélection effacée (inspecteur « sans sélection ») et contrôle montré.
 * L'inspecteur n'est affiché qu'en Conception : appelé en Fabrication, on y repasse d'abord.
 */
export function revealControl(): void {
  showDesign();
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

/** Bascule Conception / Fabrication (la vue suit, voir `linkWorkspaceAndView`). */
export function switchWorkspace(target: Workspace): void {
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
 * des surcharges dépliée et montrée (en Conception, comme `revealControl`).
 */
export function revealOverrides(): void {
  showDesign();
  appStore.getState().select(null);
  uiStore.setState((s) => ({ overridesRevealSeq: s.overridesRevealSeq + 1 }));
}
