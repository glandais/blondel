/**
 * État d'interface de l'éditeur de plan (ADR-0010, sous-lot 4a) : outil courant et élément
 * sélectionné. Fonctions pures, appliquées par les actions de `uiStore` (`setPlanTool`,
 * `selectPlanElement`, `clearPlanSelection`). La sélection est un état d'interface seul : elle
 * ne modifie jamais le `Project` et n'entre pas dans l'historique.
 *
 * Outils : `select` (défaut : clic sur un élément pour le sélectionner, glisser dans le vide pour
 * déplacer la vue), `pan`, `opening` (trémie), `wall` (mur), `calibrate` (calibrage de l'image) ;
 * `room` (contour de la pièce) et `obstacle` sont déclarés mais masqués jusqu'au lot 5
 * (`PLAN_TOOL_AVAILABLE`).
 */
import { openingPolygon, type Model, type Project } from "@blondel/core";

export type PlanEditorTool =
  "select" | "pan" | "opening" | "wall" | "room" | "obstacle" | "calibrate";

/** Outils proposés dans la barre au sous-lot 4a ; `room` et `obstacle` arrivent au lot 5. */
export const PLAN_TOOL_AVAILABLE: Readonly<Record<PlanEditorTool, boolean>> = {
  select: true,
  pan: true,
  opening: true,
  wall: true,
  room: false,
  obstacle: false,
  calibrate: true,
};

/** Élément sélectionné dans l'éditeur de plan. Indices à partir de 0. */
export type PlanSelection =
  | { readonly kind: "stair" }
  | { readonly kind: "section"; readonly index: number }
  | { readonly kind: "junction"; readonly index: number }
  | { readonly kind: "wall"; readonly id: string }
  | { readonly kind: "wallEnd"; readonly id: string; readonly end: "a" | "b" }
  | { readonly kind: "opening" }
  | { readonly kind: "openingVertex"; readonly index: number }
  | { readonly kind: "roomVertex"; readonly index: number }
  | { readonly kind: "obstacle"; readonly id: string };

export interface PlanEditorState {
  readonly planTool: PlanEditorTool;
  readonly planSelection: PlanSelection | null;
}

export const INITIAL_PLAN_EDITOR: PlanEditorState = { planTool: "select", planSelection: null };

/** Deux sélections désignent-elles le même élément ? */
export function samePlanSelection(a: PlanSelection | null, b: PlanSelection | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "stair":
    case "opening":
      return true;
    case "section":
    case "junction":
    case "openingVertex":
    case "roomVertex":
      return a.index === (b as typeof a).index;
    case "wall":
    case "obstacle":
      return a.id === (b as typeof a).id;
    case "wallEnd":
      return a.id === (b as typeof a).id && a.end === (b as typeof a).end;
  }
}

/**
 * Changement d'outil : un outil indisponible est ignoré ; quitter l'outil de sélection efface
 * la sélection (un outil de tracé ne montre pas de surbrillance).
 */
export function withPlanTool(state: PlanEditorState, tool: PlanEditorTool): PlanEditorState {
  if (!PLAN_TOOL_AVAILABLE[tool] || state.planTool === tool) return state;
  return { planTool: tool, planSelection: tool === "select" ? state.planSelection : null };
}

/**
 * Sélection d'un élément (`null` : désélection). Sans effet hors de l'outil de sélection, ou si
 * l'élément est déjà sélectionné (même objet d'état rendu : aucun rendu inutile).
 */
export function withPlanSelection(
  state: PlanEditorState,
  selection: PlanSelection | null,
): PlanEditorState {
  if (selection !== null && state.planTool !== "select") return state;
  if (samePlanSelection(state.planSelection, selection)) return state;
  return { ...state, planSelection: selection };
}

/**
 * L'élément sélectionné existe-t-il encore (projet et modèle courants) ? Un tronçon, une
 * jonction ou l'escalier se lisent dans le `Model` ; murs, trémie, pièce et obstacles dans le
 * site du `Project`.
 */
export function planSelectionExists(
  selection: PlanSelection,
  project: Project,
  model: Model | null,
): boolean {
  const site = project.site;
  const inRange = (i: number, n: number): boolean => Number.isInteger(i) && i >= 0 && i < n;
  switch (selection.kind) {
    case "stair":
      return model !== null && model.layout.footprint.length > 0;
    case "section":
      return inRange(selection.index, model?.layout.sections?.length ?? 0);
    case "junction":
      return inRange(selection.index, model?.layout.turns.length ?? 0);
    case "wall":
    case "wallEnd":
      return site.walls.some((w) => w.id === selection.id);
    case "opening":
      return site.opening !== undefined;
    case "openingVertex":
      return inRange(selection.index, openingPolygon(site.opening)?.length ?? 0);
    case "roomVertex":
      return inRange(selection.index, site.room?.points.length ?? 0);
    case "obstacle":
      return (site.obstacles ?? []).some((o) => o.id === selection.id);
  }
}

/**
 * Sélection effacée si son élément a disparu (annulation, suppression). L'existence se teste par
 * indice ou par id : un autre projet chargé peut avoir un élément de même indice ou de même id,
 * d'où la remise à zéro au chargement (`withProjectOpened`).
 */
export function prunePlanSelection(
  state: PlanEditorState,
  project: Project,
  model: Model | null,
): PlanEditorState {
  const sel = state.planSelection;
  if (sel === null || planSelectionExists(sel, project, model)) return state;
  return { ...state, planSelection: null };
}

/**
 * Projet chargé (préréglage, démo, import, assistant, reprise ; `lastOpened`) : l'éditeur de plan
 * revient à son état initial. La sélection ne survit pas sur un élément de même indice ou de même
 * id d'un autre escalier, et un outil propre à l'ancien projet (Calibrer sans image) n'y reste pas.
 */
export function withProjectOpened(state: PlanEditorState): PlanEditorState {
  return state.planTool === INITIAL_PLAN_EDITOR.planTool && state.planSelection === null
    ? state
    : INITIAL_PLAN_EDITOR;
}
