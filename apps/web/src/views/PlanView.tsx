/**
 * Onglet Plan 2D : SVG coté de `renderPlanSvg` (@blondel/exports), avec surlignage et sélection
 * de la marche par ses attributs `data-tread`.
 */
import type { Model } from "@blondel/core";
import { useMemo } from "react";
import { useResolvedTheme } from "../components/ThemeToggle.js";
import { selectedTreadNumber } from "../lib/compliance.js";
import { renderPlanForScreen } from "../model/planSvg.js";
import { appStore, useApp } from "../store/appStore.js";
import { ExportedSvg } from "./ExportedSvg.js";

export function PlanView({ model }: { model: Model }) {
  const project = useApp((s) => s.project);
  const selection = useApp((s) => s.selection);
  const theme = useResolvedTheme();
  const selectedTread = selectedTreadNumber(selection?.location);
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
