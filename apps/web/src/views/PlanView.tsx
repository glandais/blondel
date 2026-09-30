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
import { useT } from "../i18n/useT.js";
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
  const t = useT();
  const locale = t.locale;
  const rendered = useMemo(
    () => renderPlanForScreen(model, { project, theme, locale }),
    [model, project, theme, locale],
  );
  const onSelectTread = (n: number) =>
    appStore
      .getState()
      .select(selectedTread === n ? null : { location: { kind: "tread", number: n } });
  if ("error" in rendered) {
    return (
      <p className="notice notice--error" role="alert">
        {t.t("ui.plan.drawing.unavailable", { error: rendered.error })}
      </p>
    );
  }
  return (
    <ExportedSvg
      svg={rendered.svg}
      label={t.t("ui.plan.drawing.label")}
      selectedTread={selectedTread}
      onSelectTread={onSelectTread}
    />
  );
}

export function PlanView({ model }: { model: Model }) {
  const mode = useApp((s) => s.planMode);
  const setMode = appStore.getState().setPlanMode;
  const t = useT();
  return (
    <div className="plan-view">
      <div className="plan-view__mode" role="group" aria-label={t.t("ui.plan.mode.label")}>
        <button type="button" aria-pressed={mode === "drawing"} onClick={() => setMode("drawing")}>
          {t.t("ui.plan.mode.drawing")}
        </button>
        <button type="button" aria-pressed={mode === "site"} onClick={() => setMode("site")}>
          {t.t("ui.plan.mode.site")}
        </button>
        <button type="button" aria-pressed={mode === "expert"} onClick={() => setMode("expert")}>
          {t.t("ui.plan.mode.expert")}
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
