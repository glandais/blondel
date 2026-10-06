/**
 * Mise en page du parcours libre (maquette 1b, ADR-0009) : barre du haut ; en Conception, rail
 * des 8 sections et panneau unique ; vue centrale (onglets, cadre, ligne de chiffres) ;
 * inspecteur à droite ; assistant d'initialisation (fenêtre modale) et invite de mise à jour.
 * En Fabrication (vague 4), ni rail, ni panneau, ni inspecteur : la zone de Fabrication (onglets
 * Pièces | Nomenclature | Comparer | À valider, bande de chiffres, liste des pièces par famille et
 * pièce choisie) et, à droite, la colonne de Fabrication (réglages d'atelier de la pièce, retour
 * en Conception, sorties et coût). La sélection est la même dans les deux espaces.
 *
 * L'import de `uiStore` installe la liaison espace de travail ↔ vue active.
 */
import { useEffect } from "react";
import { AssistantDialog } from "./components/AssistantDialog.js";
import { escapeAction, type EscapeTarget } from "./components/escapeChain.js";
import { FabricationArea } from "./components/fabrication/FabricationArea.js";
import { FabricationAside } from "./components/fabrication/FabricationAside.js";
import { FreePanel, focusRailTab } from "./components/free/FreePanel.js";
import { Rail } from "./components/free/Rail.js";
import { Inspector } from "./components/inspector/Inspector.js";
import { TopBar } from "./components/topbar/TopBar.js";
import { UpdatePrompt } from "./components/UpdatePrompt.js";
import { ViewArea } from "./components/view/ViewArea.js";
import { appStore, journeyStore, useJourney } from "./store/appStore.js";
import "./store/uiStore.js";

/** Champs sans annulation propre au navigateur : Ctrl+Z y annule le projet (cases ◆, radios…). */
const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "color"]);

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  return (
    target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/** Cible dans une fenêtre modale (l'arrière-plan est alors inerte). */
function inModal(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[aria-modal="true"]') !== null;
}

/**
 * Raccourcis globaux : Ctrl/Cmd+Z annuler, Ctrl/Cmd+Maj+Z ou Ctrl+Y rétablir (hors champs). Sans
 * effet tant qu'une fenêtre modale est ouverte : le projet ne change pas derrière elle.
 */
function useUndoShortcuts(): void {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isEditable(e.target)) return;
      if (appStore.getState().assistantOpen || inModal(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        appStore.getState().undo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        appStore.getState().redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/**
 * Écouteur global unique d'Échap (`escapeAction`) : un menu ou une saisie l'ont déjà traité,
 * sinon panneau libre non épinglé, puis sélection (retour à l'inspecteur « sans sélection »),
 * puis panneau épinglé. Fermé par Échap, le panneau rend le focus à l'onglet de sa section.
 */
function useEscapeChain(): void {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const journey = journeyStore.getState();
      const section = journey.workspace === "design" ? journey.freePanel : null;
      const app = appStore.getState();
      const action = escapeAction({
        key: e.key,
        defaultPrevented: e.defaultPrevented,
        target: e.target instanceof Element ? (e.target as EscapeTarget) : null,
        assistantOpen: app.assistantOpen,
        panelOpen: section !== null,
        panelPinned: journey.freePanelPinned,
        hasSelection: app.selection !== null,
      });
      if (action === "clearSelection") {
        app.select(null);
      } else if (action === "closePanel" && section !== null) {
        journey.panelEvent({ type: "escape" });
        focusRailTab(section);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function App() {
  useUndoShortcuts();
  useEscapeChain();
  const workspace = useJourney((s) => s.workspace);
  const panelOpen = useJourney((s) => s.freePanel !== null);
  const design = workspace === "design";
  return (
    <div
      className="app"
      data-workspace={workspace}
      data-panel={design && panelOpen ? "open" : "closed"}
    >
      <TopBar />
      {design ? (
        <>
          <Rail />
          <FreePanel />
          <ViewArea />
          <Inspector />
        </>
      ) : (
        <>
          <FabricationArea />
          <FabricationAside />
        </>
      )}
      <AssistantDialog />
      <UpdatePrompt />
    </div>
  );
}
