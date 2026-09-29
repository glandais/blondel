/**
 * Mise en page : barre d'outils, paramètres à gauche, vue centrale à onglets (Plan 2D / 3D /
 * Élévation / Développés / Nomenclature / Comparateur), contrôle de conception et
 * prédimensionnement indicatif à droite, barre d'état.
 */
import { Suspense, lazy, useEffect, type KeyboardEvent } from "react";
import { CompliancePanel } from "./components/CompliancePanel.js";
import { ParamsPanel } from "./components/ParamsPanel.js";
import { PrecheckPanel } from "./components/PrecheckPanel.js";
import { StatusBar } from "./components/StatusBar.js";
import { Toolbar } from "./components/Toolbar.js";
import { selectedTreadNumber } from "./lib/compliance.js";
import { appStore, useApp, useModel } from "./store/appStore.js";
import type { ViewTab } from "./store/projectStore.js";
import { BomView } from "./views/BomView.js";
import { CompareView } from "./views/CompareView.js";
import { ElevationView } from "./views/ElevationView.js";
import { FlatPatternView } from "./views/FlatPatternView.js";
import { PlanView } from "./views/PlanView.js";

// three.js et react-three-fiber chargés à la demande (bundle initial plus léger).
const Viewer3D = lazy(() => import("./views/Viewer3D.js"));

const TABS: readonly { id: ViewTab; label: string }[] = [
  { id: "plan", label: "Plan 2D" },
  { id: "3d", label: "3D" },
  { id: "elevation", label: "Élévation" },
  { id: "flat", label: "Développés" },
  { id: "bom", label: "Nomenclature" },
  { id: "compare", label: "Comparateur" },
];

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/** Raccourcis globaux : Ctrl/Cmd+Z annuler, Ctrl/Cmd+Maj+Z ou Ctrl+Y rétablir (hors champs). */
function useUndoShortcuts(): void {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isEditable(e.target)) return;
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

function Tabs() {
  const view = useApp((s) => s.view);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.findIndex((t) => t.id === view);
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0) return;
    const next = TABS[(i + delta + TABS.length) % TABS.length];
    if (next) {
      appStore.getState().setView(next.id);
      document.getElementById(`tab-${next.id}`)?.focus();
    }
  };
  return (
    <div role="tablist" aria-label="Vues" className="tabs">
      {TABS.map((t) => (
        <button
          key={t.id}
          id={`tab-${t.id}`}
          role="tab"
          type="button"
          aria-selected={view === t.id}
          aria-controls="view-panel"
          tabIndex={view === t.id ? 0 : -1}
          onClick={() => appStore.getState().setView(t.id)}
          onKeyDown={onKeyDown}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function CentralView() {
  const view = useApp((s) => s.view);
  const project = useApp((s) => s.project);
  const selection = useApp((s) => s.selection);
  const { model, errors, mesh, pending, project: modelProject } = useModel();
  // Vues qui croisent le modèle et le projet (dalle, trémie) : le projet dont le modèle est issu,
  // pour rester cohérentes pendant un calcul.
  const shown = modelProject ?? project;
  let content;
  if (view === "compare") {
    content = <CompareView />;
  } else if (!model && pending) {
    content = (
      <div className="empty-view" role="status">
        <p>Calcul du modèle…</p>
      </div>
    );
  } else if (!model) {
    content = (
      <div className="empty-view" role="status">
        <p>Aucun modèle à afficher.</p>
        <ul>
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </div>
    );
  } else if (view === "plan") {
    content = <PlanView model={model} />;
  } else if (view === "3d") {
    content = (
      <Suspense fallback={<p className="muted">Chargement de la vue 3D…</p>}>
        <Viewer3D
          model={model}
          mesh={mesh}
          project={shown}
          selection={selection}
          onSelectPoint={(m) =>
            appStore.getState().select({ location: m.location, ruleId: m.ruleId })
          }
          onSelectPart={(partId) =>
            appStore
              .getState()
              .select(partId === null ? null : { location: { kind: "part", partId } })
          }
        />
      </Suspense>
    );
  } else if (view === "flat") {
    content = <FlatPatternView model={model} />;
  } else if (view === "bom") {
    content = <BomView model={model} />;
  } else {
    content = (
      <ElevationView
        model={model}
        project={shown}
        selectedTread={selectedTreadNumber(selection?.location)}
      />
    );
  }
  return (
    <section className="center" aria-label="Vues de l'escalier">
      <Tabs />
      <div id="view-panel" role="tabpanel" aria-labelledby={`tab-${view}`} className="view">
        {content}
      </div>
    </section>
  );
}

export function App() {
  useUndoShortcuts();
  return (
    <div className="app">
      <Toolbar />
      <aside className="left" aria-label="Paramètres">
        <ParamsPanel />
      </aside>
      <CentralView />
      <aside className="right" aria-label="Contrôle de conception">
        <CompliancePanel />
        <PrecheckPanel />
      </aside>
      <StatusBar />
    </div>
  );
}
