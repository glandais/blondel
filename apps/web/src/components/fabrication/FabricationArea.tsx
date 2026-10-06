/**
 * Zone centrale du mode Fabrication (ADR-0009, vague 4 ; wireframe « Parcours libre ·
 * Fabrication, avec retour vers la Conception ») :
 *
 * - en tête : messages de l'application et barre d'erreurs (comme la vue de Conception) ;
 * - barre : onglets Pièces | Nomenclature | Comparer | À valider (même liste d'onglets « Vues »
 *   que la Conception, `appStore.setView`) et bande de chiffres (`FabricationFigures`) ;
 * - panneau de l'onglet : Pièces = liste des pièces par famille (`PartsList`) et pièce choisie
 *   (`PartSheet`) ; Nomenclature (`BomView`) ; Comparer (`CompareView`, sans modèle requis) ;
 *   À valider (`ToValidateList`, liste à cocher des valeurs ◆).
 *
 * La colonne de droite (réglages d'atelier, retour en Conception, sorties) est
 * `FabricationAside`, rendue à côté par `App`. Aucune grandeur n'est calculée ici.
 */
import type { MessageKey } from "@blondel/i18n";
import { useT } from "../../i18n/useT.js";
import { appStore, useApp, useModel } from "../../store/appStore.js";
import type { ViewTab } from "../../store/projectStore.js";
import { FABRICATION_VIEWS } from "../../store/uiStore.js";
import { BomView } from "../../views/BomView.js";
import { CompareView } from "../../views/CompareView.js";
import { ErrorsBar } from "../ErrorsBar.js";
import { Notices } from "../topbar/Notices.js";
import { Segmented } from "../ui/Segmented.js";
import { FabricationFigures } from "./FabricationFigures.js";
import { PartSheet } from "./PartSheet.js";
import { PartsList } from "./PartsList.js";
import { ToValidateList } from "./ToValidateList.js";
// Zone de travail et barre de vue communes aux deux espaces (`.workarea`, `.view-bar`).
import "../view/view.css";
import "./fabrication.css";

/** Onglet de Fabrication. */
export type FabricationView = "flat" | "bom" | "compare" | "validate";

/** Libellés des onglets de Fabrication. */
export const FABRICATION_TAB_KEYS: Readonly<Record<FabricationView, MessageKey>> = {
  flat: "ui.fab.tab.flat",
  bom: "ui.fab.tab.bom",
  compare: "ui.fab.tab.compare",
  validate: "ui.fab.tab.validate",
};

/** Vue courante ramenée à un onglet de Fabrication (Pièces par défaut). */
export function fabricationView(view: ViewTab): FabricationView {
  return (FABRICATION_VIEWS as readonly string[]).includes(view)
    ? (view as FabricationView)
    : "flat";
}

/** Contenu du panneau : onglet, ou état d'attente / d'échec du calcul. */
export type FabricationContent = FabricationView | "computing" | "noModel";

/**
 * Contenu du panneau de l'onglet `view`. Comparer et À valider ne demandent pas de modèle
 * calculé (le comparateur a son propre calcul, la liste ◆ lit le projet) ; Pièces et
 * Nomenclature attendent le modèle (« Calcul du modèle… », sinon « Aucun modèle à afficher. »).
 */
export function fabricationContent(
  view: FabricationView,
  state: { readonly hasModel: boolean; readonly pending: boolean },
): FabricationContent {
  if (view === "compare" || view === "validate") return view;
  if (state.hasModel) return view;
  return state.pending ? "computing" : "noModel";
}

function PanelContent({ view }: { view: FabricationView }) {
  const t = useT();
  const { model, errors, pending } = useModel();
  const content = fabricationContent(view, { hasModel: model !== null, pending });
  switch (content) {
    case "compare":
      return <CompareView />;
    case "validate":
      return (
        <div className="fab-validate">
          <ToValidateList />
        </div>
      );
    case "computing":
      return (
        <div className="empty-view" role="status">
          <p>{t.t("ui.app.computing")}</p>
        </div>
      );
    case "noModel":
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
    <div className="fab-parts">
      <PartsList model={model} />
      <PartSheet model={model} />
    </div>
  );
}

export function FabricationArea() {
  const t = useT();
  const view = fabricationView(useApp((s) => s.view));
  const options = FABRICATION_VIEWS.map((v) => ({
    value: v,
    label: t.t(FABRICATION_TAB_KEYS[fabricationView(v)]),
  }));
  return (
    <main className="workarea fab" aria-label={t.t("ui.fab.area.label")}>
      <Notices />
      <ErrorsBar />
      <div className="view-bar fab-bar">
        <Segmented
          semantics="tabs"
          label={t.t("ui.app.tabs.label")}
          idPrefix="tab"
          value={view}
          options={options}
          onChange={(v) => appStore.getState().setView(v)}
        />
        <FabricationFigures />
      </div>
      <div
        id="view-panel"
        role="tabpanel"
        aria-labelledby={`tab-${view}`}
        className="fab-panel"
        data-view={view}
      >
        <PanelContent view={view} />
      </div>
    </main>
  );
}
