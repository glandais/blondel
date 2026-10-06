/**
 * Vue du parcours guidé (maquette 1a), à droite du formulaire d'étape, marge 16 × 20 px :
 *
 * - en tête : accueil de la première visite (intégré au guidé), messages de l'application,
 *   barre d'erreurs, import de calque en attente ;
 * - barre : onglets de l'étape (`guidedViewTabs` : Élévation | Plan | 3D, ou Pièces |
 *   Nomenclature | Comparer | 3D à l'étape 7), la mention « Vue conseillée pour cette étape »
 *   quand la vue active est la vue conseillée, puis − + Recadrer ;
 * - la vue dans un cadre blueprint (SVG exportés, sélection partagée en orange) ; à l'étape 7,
 *   « Pièces » montre le développé de la pièce choisie dans la liste du formulaire ;
 * - dans le cadre, en bas à gauche (en haut à gauche en 3D, la barre d'outils 3D occupe le bas) :
 *   la légende de la sélection (« ▪ Marche 3 sélectionnée ») ;
 * - par-dessus le cadre : l'encart « Vous connaissez le métier ? » (en haut à droite ; en 3D, en
 *   bas à gauche, pour laisser visibles les contrôles 3D du haut) et la liste du contrôle.
 *
 * La vue conseillée n'est appliquée qu'au changement d'étape (`goToGuidedStep`) : l'utilisateur
 * en change ensuite librement. Aucune grandeur n'est calculée ici.
 */
import type { Model } from "@blondel/core";
import type { Translator } from "@blondel/i18n";
import { useT } from "../../i18n/useT.js";
import { guidedShownView, guidedViewTabs, isRecommendedView } from "../../lib/guidedSteps.js";
import type { GuidedStep } from "../../lib/sectionIds.js";
import { appStore, useApp, useJourney, useModel } from "../../store/appStore.js";
import type { Selection, ViewTab } from "../../store/projectStore.js";
import { inspectedTread, inspectorTemplate } from "../inspector/Inspector.js";
import { BomView } from "../../views/BomView.js";
import { CompareView } from "../../views/CompareView.js";
import { ErrorsBar } from "../ErrorsBar.js";
import {
  FABRICATION_TAB_KEYS,
  fabricationContent,
  fabricationView,
} from "../fabrication/FabricationArea.js";
import { PartSheet } from "../fabrication/PartSheet.js";
import { Notices } from "../topbar/Notices.js";
import { Corners } from "../ui/Blueprint.js";
import { Segmented } from "../ui/Segmented.js";
import {
  QueuedImportNotice,
  ViewContent,
  ZoomControls,
  designViewLabel,
  viewHandlesZoom,
} from "../view/ViewArea.js";
import { Welcome } from "../Welcome.js";
import { ControlOverlay } from "./ControlOverlay.js";
import { FreeJourneyHint } from "./FreeJourneyHint.js";
import "../fabrication/fabrication.css";
import "../view/view.css";
import "./guided.css";

/** Onglets de Fabrication de l'étape 7 (les autres sont des vues de Conception). */
const FABRICATION_TABS: ReadonlySet<ViewTab> = new Set(["flat", "bom", "compare"]);

/** Contenu d'un onglet de Fabrication : développé, nomenclature, comparateur, ou attente. */
function FabricationTabContent({ view }: { view: ViewTab }) {
  const t = useT();
  const { model, errors, pending } = useModel();
  const content = fabricationContent(fabricationView(view), { hasModel: model !== null, pending });
  if (content === "compare") return <CompareView />;
  if (content === "computing") {
    return (
      <div className="empty-view" role="status">
        <p>{t.t("ui.app.computing")}</p>
      </div>
    );
  }
  if (content === "noModel") {
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
  if (!model) return null;
  if (content === "bom") return <BomView model={model} />;
  return (
    <div className="guided-view__sheet">
      <PartSheet model={model} />
    </div>
  );
}

/**
 * Légende de la sélection dans le cadre de la vue (maquette 1a : « ▪ Marche 3 sélectionnée »),
 * seul retour textuel de la sélection quand la liste du contrôle (et son inspecteur) est fermée.
 * Marche (ou nez), nez d'arrivée et pièce, d'après le gabarit de l'inspecteur ; rien sinon.
 */
export function selectionLegendText(
  selection: Selection | null,
  model: Model | null,
  t: Translator,
): string | null {
  const template = inspectorTemplate(selection, model);
  if (template === "tread") {
    const n = inspectedTread(selection, model);
    return n === null ? null : t.t("ui.guided.view.selected.tread", { number: String(n) });
  }
  if (template === "nosing") return t.t("ui.guided.view.selected.arrivalNosing");
  if (template === "part" && selection?.location.kind === "part" && model !== null) {
    const id = selection.location.partId;
    const part = model.parts.find((p) => p.id === id);
    return part === undefined ? null : t.t("ui.guided.view.selected.part", { mark: part.mark });
  }
  return null;
}

function SelectionLegend() {
  const t = useT();
  const selection = useApp((s) => s.selection);
  const { model } = useModel();
  const text = selectionLegendText(selection, model, t);
  if (text === null) return null;
  return (
    <span className="guided-view__selection">
      <span className="guided-view__selection-swatch" aria-hidden="true" />
      {text}
    </span>
  );
}

/** Libellés des onglets d'une étape. */
function tabOptions(
  step: GuidedStep,
  t: ReturnType<typeof useT>,
): { value: ViewTab; label: string }[] {
  return guidedViewTabs(step).map((v) => ({
    value: v,
    label: FABRICATION_TABS.has(v)
      ? t.t(FABRICATION_TAB_KEYS[fabricationView(v)])
      : designViewLabel(v, t),
  }));
}

export function GuidedView() {
  const t = useT();
  const step = useJourney((s) => s.guidedStep);
  const view = useApp((s) => s.view);
  const planMode = useApp((s) => s.planMode);
  const { model, pending } = useModel();
  const shown = guidedShownView(step, view);
  const recommended = isRecommendedView(step, view, planMode);
  return (
    <main className="guided-view" aria-label={t.t("ui.app.center.label")}>
      <Welcome />
      <Notices />
      <ErrorsBar />
      <QueuedImportNotice
        available={model !== null}
        computing={pending}
        hostShown={model !== null && shown === "plan" && planMode === "site"}
      />
      <div className="view-bar guided-view__bar">
        <Segmented
          semantics="tabs"
          label={t.t("ui.app.tabs.label")}
          idPrefix="tab"
          value={shown}
          options={tabOptions(step, t)}
          onChange={(v) => appStore.getState().setView(v)}
        />
        {recommended ? (
          <span className="guided-view__recommended">{t.t("ui.guided.view.recommended")}</span>
        ) : null}
        <ZoomControls enabled={viewHandlesZoom(shown)} />
      </div>
      <div className="guided-view__stage" data-view={shown}>
        <div
          id="view-panel"
          role="tabpanel"
          aria-labelledby={`tab-${shown}`}
          className="view blueprint guided-view__frame"
          data-view={shown}
          tabIndex={0}
        >
          <Corners />
          {FABRICATION_TABS.has(shown) ? (
            <FabricationTabContent view={shown} />
          ) : (
            <ViewContent view={shown} />
          )}
        </div>
        {/* Hors du cadre : posée sur le dessin en fenêtre large, dans le flux sous le cadre en
            fenêtre étroite (elle y masquerait le cartouche). */}
        {FABRICATION_TABS.has(shown) ? null : <SelectionLegend />}
        <FreeJourneyHint />
        <ControlOverlay />
      </div>
    </main>
  );
}
