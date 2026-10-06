/**
 * Vue centrale du parcours libre (maquette 1b, ADR-0009) :
 *
 * - en tête : accueil de la première visite, messages de l'application, barre d'erreurs et de
 *   corrections, import de calque en attente ;
 * - barre de vue : onglets Plan | 3D | Élévation et − + Recadrer (`uiStore.sendViewCommand`,
 *   consommé par la vue affichée) ;
 * - la vue dans un cadre blueprint ; un clic dans le cadre ferme le panneau libre non épinglé ;
 *   le cadre prend le focus (`tabIndex`) : les flèches y règlent l'angle de la ligne de nez de
 *   la marche sélectionnée (inspecteur Marche) ;
 * - en pied, la ligne de chiffres (`FigureLine`).
 *
 * Conception seulement : le mode Fabrication a sa propre zone (`fabrication/FabricationArea`).
 * La vue du parcours guidé (`guided/GuidedView`) réutilise `ViewContent`, `ZoomControls`,
 * `QueuedImportNotice` et `designViewLabel`.
 * Les SVG affichés sont ceux des exports ; aucune grandeur n'est calculée ici.
 */
import { Suspense, lazy } from "react";
import { useStore } from "zustand";
import type { MessageKey, Translator } from "@blondel/i18n";
import { useT } from "../../i18n/useT.js";
import { partSelection, selectedTreadNumber } from "../../lib/compliance.js";
import { appStore, journeyStore, useApp, useModel } from "../../store/appStore.js";
import { cancelUnderlayImport, importQueue, queuedImportMessage } from "../../store/importQueue.js";
import type { ViewTab } from "../../store/projectStore.js";
import { DESIGN_VIEWS, sendViewCommand, type ViewCommandKind } from "../../store/uiStore.js";
import { ElevationView } from "../../views/ElevationView.js";
import { PlanView } from "../../views/PlanView.js";
import { ErrorsBar } from "../ErrorsBar.js";
import { Notices } from "../topbar/Notices.js";
import { Corners } from "../ui/Blueprint.js";
import { Segmented } from "../ui/Segmented.js";
import { Welcome } from "../Welcome.js";
import { FigureLine } from "./FigureLine.js";
import "./view.css";

// three.js et react-three-fiber chargés à la demande (bundle initial plus léger).
const Viewer3D = lazy(() => import("../../views/Viewer3D.js"));

/** Vue de Conception (onglets de `DESIGN_VIEWS`). */
type DesignView = "plan" | "3d" | "elevation";

/** Libellés des onglets ; « 3D » : sigle invariant, sans clé. */
const VIEW_LABELS: Readonly<Record<DesignView, MessageKey | null>> = {
  plan: "ui.view.tab.plan",
  "3d": null,
  elevation: "ui.app.tab.elevation",
};

/** Libellé d'un onglet de Conception (`null` : sigle « 3D »). */
const labelKey = (view: ViewTab): MessageKey | null =>
  (VIEW_LABELS as Readonly<Partial<Record<ViewTab, MessageKey | null>>>)[view] ?? null;

const THREE_D = "3D";

/** Libellé d'un onglet de Conception (Plan, 3D, Élévation), partagé avec la vue du guidé. */
export function designViewLabel(view: ViewTab, t: Pick<Translator, "t">): string {
  const key = labelKey(view);
  return key === null ? THREE_D : t.t(key);
}

/**
 * Vue qui gère les commandes − / + / Recadrer : plan (coté et « Site et saisie »), 3D,
 * élévation. Les onglets de Fabrication n'en ont pas.
 */
export function viewHandlesZoom(view: ViewTab): boolean {
  return view === "plan" || view === "3d" || view === "elevation";
}

/** Commandes de la vue : les manipuler ne ferme pas le panneau libre. */
const VIEW_CONTROLS = "button, input, select, textarea, label, a, summary, [role='toolbar']";

/**
 * Un clic dans la vue ferme-t-il le panneau libre non épinglé ? Oui dans le dessin (SVG, canevas
 * 3D, fond), non sur une commande de la vue (case, liste, bouton, barre d'outils 3D).
 *
 * Le panneau se ferme au `click` (et non au `pointerdown`) : la colonne qui disparaît décale la
 * vue ; fermé à l'appui, le relâchement tomberait ailleurs et le clic serait perdu.
 */
export function closesFreePanel(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return true;
  return target.closest(VIEW_CONTROLS) === null;
}

/**
 * Import de calque demandé alors que le modèle est en calcul ou en échec : le plan « Site et
 * saisie » qui l'accueille n'est pas affiché, la demande attend ; message explicite et bouton
 * pour l'abandonner (QUESTIONS D1).
 */
export function QueuedImportNotice({
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

export function ViewContent({ view }: { view: ViewTab }) {
  const project = useApp((s) => s.project);
  const selection = useApp((s) => s.selection);
  const t = useT();
  const { model, errors, mesh, pending, project: modelProject } = useModel();
  // Vues qui croisent le modèle et le projet (dalle, trémie) : le projet dont le modèle est issu,
  // pour rester cohérentes pendant un calcul.
  const shown = modelProject ?? project;
  if (!model && pending) {
    return (
      <div className="empty-view" role="status">
        <p>{t.t("ui.app.computing")}</p>
      </div>
    );
  }
  if (!model) {
    return (
      <div className="empty-view" role="status">
        <p>{t.t("ui.app.noModel")}</p>
        <ul>
          {errors.map((e, i) => (
            <li key={i}>{t.t(e)}</li>
          ))}
        </ul>
      </div>
    );
  }
  switch (view) {
    case "plan":
      return <PlanView model={model} />;
    case "3d":
      return (
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
              appStore.getState().select(partSelection(partId, model.parts))
            }
          />
        </Suspense>
      );
    default:
      return (
        <ElevationView
          model={model}
          project={shown}
          selectedTread={selectedTreadNumber(selection?.location, model.parts)}
        />
      );
  }
}

export function ZoomControls({ enabled }: { enabled: boolean }) {
  const t = useT();
  const unavailable = enabled ? undefined : t.t("ui.view.zoom.unavailable");
  const send = (kind: ViewCommandKind) => () => sendViewCommand(kind);
  return (
    <div className="view-bar__zoom" role="group" aria-label={t.t("ui.view.zoom.label")}>
      <button
        type="button"
        className="btn btn-secondary btn-icon"
        aria-label={t.t("ui.view.zoomOut")}
        title={unavailable ?? t.t("ui.view.zoomOut")}
        disabled={!enabled}
        onClick={send("zoomOut")}
      >
        −
      </button>
      <button
        type="button"
        className="btn btn-secondary btn-icon"
        aria-label={t.t("ui.view.zoomIn")}
        title={unavailable ?? t.t("ui.view.zoomIn")}
        disabled={!enabled}
        onClick={send("zoomIn")}
      >
        +
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        title={unavailable ?? t.t("ui.view.fit.title")}
        disabled={!enabled}
        onClick={send("fit")}
      >
        {t.t("ui.view.fit.label")}
      </button>
    </div>
  );
}

/**
 * `disclaimer` : inspecteur en tiroir (fenêtre moyenne, ADR-0009 point 3) ; la mention « Contrôle
 * de conception indicatif… » de son pied, masquée tiroir fermé, est reprise sous la ligne de
 * chiffres pour rester toujours visible.
 */
export function ViewArea({ disclaimer = false }: { readonly disclaimer?: boolean } = {}) {
  const view = useApp((s) => s.view);
  const planMode = useApp((s) => s.planMode);
  const t = useT();
  const { model, pending } = useModel();
  const options = DESIGN_VIEWS.map((v) => ({ value: v, label: designViewLabel(v, t) }));
  return (
    <main className="workarea" aria-label={t.t("ui.app.center.label")}>
      <Welcome />
      <Notices />
      <ErrorsBar />
      <QueuedImportNotice
        available={model !== null}
        computing={pending}
        hostShown={model !== null && view === "plan" && planMode === "site"}
      />
      <div className="view-bar">
        <Segmented
          semantics="tabs"
          label={t.t("ui.app.tabs.label")}
          idPrefix="tab"
          value={view}
          options={options}
          onChange={(v) => appStore.getState().setView(v)}
        />
        <ZoomControls enabled={viewHandlesZoom(view)} />
      </div>
      <div
        id="view-panel"
        role="tabpanel"
        aria-labelledby={`tab-${view}`}
        className="view blueprint"
        data-view={view}
        tabIndex={0}
        onClick={(e) => {
          if (!closesFreePanel(e.target)) return;
          journeyStore.getState().panelEvent({ type: "outside" });
        }}
      >
        <Corners />
        <ViewContent view={view} />
      </div>
      <FigureLine />
      {disclaimer ? (
        <p className="workarea__disclaimer">{t.t("ui.compliance.disclaimer")}</p>
      ) : null}
    </main>
  );
}
