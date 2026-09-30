/**
 * Mise en page : barre d'outils, paramètres à gauche, vue centrale à onglets (Plan 2D / 3D /
 * Élévation / Développés / Nomenclature / Comparateur), contrôle de conception et
 * prédimensionnement indicatif à droite, barre d'état ; accueil de la première visite et
 * assistant d'initialisation (fenêtre modale).
 */
import { Suspense, lazy, useEffect, type KeyboardEvent } from "react";
import { useStore } from "zustand";
import { AssistantDialog } from "./components/AssistantDialog.js";
import { CompliancePanel } from "./components/CompliancePanel.js";
import { ErrorsBar } from "./components/ErrorsBar.js";
import { ParamsPanel } from "./components/ParamsPanel.js";
import { PrecheckPanel } from "./components/PrecheckPanel.js";
import { StatusBar } from "./components/StatusBar.js";
import { Toolbar } from "./components/Toolbar.js";
import { Welcome } from "./components/Welcome.js";
import type { MessageKey } from "@blondel/i18n";
import { useT } from "./i18n/useT.js";
import { selectedTreadNumber } from "./lib/compliance.js";
import { appStore, useApp, useModel } from "./store/appStore.js";
import { cancelUnderlayImport, importQueue, queuedImportMessage } from "./store/importQueue.js";
import type { ViewTab } from "./store/projectStore.js";
import { BomView } from "./views/BomView.js";
import { CompareView } from "./views/CompareView.js";
import { ElevationView } from "./views/ElevationView.js";
import { FlatPatternView } from "./views/FlatPatternView.js";
import { PlanView } from "./views/PlanView.js";

// three.js et react-three-fiber chargés à la demande (bundle initial plus léger).
const Viewer3D = lazy(() => import("./views/Viewer3D.js"));

// « 3D » : sigle invariant, sans clé.
const TABS: readonly { id: ViewTab; label: MessageKey | null }[] = [
  { id: "plan", label: "ui.app.tab.plan" },
  { id: "3d", label: null },
  { id: "elevation", label: "ui.app.tab.elevation" },
  { id: "flat", label: "ui.app.tab.flat" },
  { id: "bom", label: "ui.app.tab.bom" },
  { id: "compare", label: "ui.app.tab.compare" },
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

function Tabs() {
  const view = useApp((s) => s.view);
  const tr = useT();
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
    <div role="tablist" aria-label={tr.t("ui.app.tabs.label")} className="tabs">
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
          {t.label === null ? "3D" : tr.t(t.label)}
        </button>
      ))}
    </div>
  );
}

/**
 * Import de calque demandé alors que le modèle est en calcul ou en échec : le plan « Site et
 * saisie » qui l'accueille n'est pas affiché, la demande attend ; message explicite et bouton
 * pour l'abandonner (QUESTIONS D1).
 */
function QueuedImportNotice({
  available,
  computing,
  hostShown,
}: {
  available: boolean;
  computing: boolean;
  hostShown: boolean;
}) {
  const pending = useStore(importQueue, (s) => s.pending);
  const t = useT();
  const message = queuedImportMessage(pending, { available, computing, hostShown });
  if (!message) return null;
  return (
    <div
      className={`notice notice--${message.kind}`}
      role={message.kind === "error" ? "alert" : "status"}
    >
      <span>{t.t(message.text)}</span>
      {message.openHost ? (
        <button
          type="button"
          className="link"
          onClick={() => {
            appStore.getState().setView("plan");
            appStore.getState().setPlanMode("site");
          }}
        >
          {t.t("ui.app.queued.openHost")}
        </button>
      ) : null}
      <button type="button" className="link" onClick={() => cancelUnderlayImport()}>
        {t.t("ui.app.queued.cancel")}
      </button>
    </div>
  );
}

function CentralView() {
  const view = useApp((s) => s.view);
  const project = useApp((s) => s.project);
  const selection = useApp((s) => s.selection);
  const planMode = useApp((s) => s.planMode);
  const t = useT();
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
        <p>{t.t("ui.app.computing")}</p>
      </div>
    );
  } else if (!model) {
    content = (
      <div className="empty-view" role="status">
        <p>{t.t("ui.app.noModel")}</p>
        <ul>
          {errors.map((e, i) => (
            <li key={i}>{t.t(e)}</li>
          ))}
        </ul>
      </div>
    );
  } else if (view === "plan") {
    content = <PlanView model={model} />;
  } else if (view === "3d") {
    content = (
      <Suspense fallback={<p className="muted">{t.t("ui.app.loading3d")}</p>}>
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
        selectedTread={selectedTreadNumber(selection?.location, model.parts)}
      />
    );
  }
  return (
    <section className="center" aria-label={t.t("ui.app.center.label")}>
      <Welcome />
      <ErrorsBar />
      <Tabs />
      <QueuedImportNotice
        available={model !== null}
        computing={pending}
        hostShown={model !== null && view === "plan" && planMode === "site"}
      />
      <div id="view-panel" role="tabpanel" aria-labelledby={`tab-${view}`} className="view">
        {content}
      </div>
    </section>
  );
}

export function App() {
  useUndoShortcuts();
  const t = useT();
  return (
    <div className="app">
      <Toolbar />
      <aside className="left" aria-label={t.t("ui.app.params.label")}>
        <ParamsPanel />
      </aside>
      <CentralView />
      <aside className="right" aria-label={t.t("ui.app.compliance.label")}>
        <CompliancePanel />
        <PrecheckPanel />
      </aside>
      <StatusBar />
      <AssistantDialog />
    </div>
  );
}
