/**
 * Onglet Plan 2D. Trois modes (état d'interface du store, `planMode`) :
 * - « Plan coté » : SVG de `renderPlanSvg` (@blondel/exports), avec surlignage et sélection de
 *   la marche par ses attributs `data-tread` ;
 * - « Site et saisie » (jalon 7) : calque de fond (DXF, image calibrée), murs, trémie
 *   polygonale, tracé assisté avec accroches et relevé de trémie (`PlanSiteEditor`) ;
 * - « Mode expert » : surcharges des lignes de nez, rotation autour de P_k et nez fixes
 *   (`PlanExpertEditor`, CHALLENGE A4).
 */
import type { Model } from "@blondel/core";
import { useMemo } from "react";
import { useResolvedTheme } from "../components/ThemeToggle.js";
import { selectedTreadNumber } from "../lib/compliance.js";
import { renderPlanForScreen } from "../model/planSvg.js";
import { appStore, useApp } from "../store/appStore.js";
import { ExportedSvg } from "./ExportedSvg.js";
import { PlanExpertEditor } from "./PlanExpertEditor.js";
import { PlanSiteEditor } from "./PlanSiteEditor.js";
import "./planSite.css";

function DimensionedPlan({ model }: { model: Model }) {
  const project = useApp((s) => s.project);
  const selection = useApp((s) => s.selection);
  const theme = useResolvedTheme();
  const selectedTread = selectedTreadNumber(selection?.location, model.parts);
  const rendered = useMemo(
    () => renderPlanForScreen(model, { project, theme }),
    [model, project, theme],
  );
  const onSelectTread = (n: number) =>
    appStore
      .getState()
      .select(selectedTread === n ? null : { location: { kind: "tread", number: n } });
  if ("error" in rendered) {
    return (
      <p className="notice notice--error" role="alert">
        Plan coté indisponible : {rendered.error}
      </p>
    );
  }
  return (
    <ExportedSvg
      svg={rendered.svg}
      label="Plan coté de l'escalier"
      selectedTread={selectedTread}
      onSelectTread={onSelectTread}
    />
  );
}

export function PlanView({ model }: { model: Model }) {
  const mode = useApp((s) => s.planMode);
  const setMode = appStore.getState().setPlanMode;
  return (
    <div className="plan-view">
      <div className="plan-view__mode" role="group" aria-label="Mode du plan">
        <button type="button" aria-pressed={mode === "drawing"} onClick={() => setMode("drawing")}>
          Plan coté
        </button>
        <button type="button" aria-pressed={mode === "site"} onClick={() => setMode("site")}>
          Site et saisie
        </button>
        <button type="button" aria-pressed={mode === "expert"} onClick={() => setMode("expert")}>
          Mode expert
        </button>
      </div>
      <div className="plan-view__body">
        {mode === "drawing" ? (
          <DimensionedPlan model={model} />
        ) : mode === "site" ? (
          <PlanSiteEditor model={model} />
        ) : (
          <PlanExpertEditor model={model} />
        )}
      </div>
    </div>
  );
}
