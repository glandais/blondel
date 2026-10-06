/**
 * Onglet Élévation : SVG de `renderElevationSvg` (@blondel/exports), développé le long de la
 * ligne de foulée, avec surlignage et sélection de la marche par ses attributs `data-tread` ;
 * un clic hors d'une marche efface la sélection ; le nez d'arrivée, qu'aucune marche ne porte,
 * se sélectionne par son point (QUESTIONS A28) ; zoom − / + / Recadrer de la vue centrale
 * (`ZoomableSvg`).
 */
import type { Model, Project } from "@blondel/core";
import { useMemo } from "react";
import { useResolvedTheme } from "../components/ThemeToggle.js";
import { useT } from "../i18n/useT.js";
import { selectedNosingIndex } from "../lib/compliance.js";
import { arrivalNosingIndex } from "../lib/nosingOverrides.js";
import { renderElevationForScreen, withNosingTarget } from "../model/planSvg.js";
import { useApp } from "../store/appStore.js";
import { ZoomableSvg } from "../components/view/ZoomableSvg.js";
import { clearSelection, selectNosingOrClear, selectTreadOrClear } from "./PlanView.js";

interface ElevationProps {
  readonly model: Model;
  readonly project: Project;
  readonly selectedTread: number | undefined;
}

export function ElevationView({ model, project, selectedTread }: ElevationProps) {
  const theme = useResolvedTheme();
  const t = useT();
  const locale = t.locale;
  const selection = useApp((s) => s.selection);
  const arrival = arrivalNosingIndex(model.stepping);
  const arrivalLabel = t.t("ui.lib.location.arrivalNosing");
  const rendered = useMemo(
    () =>
      withNosingTarget(
        renderElevationForScreen(model, { project, theme, locale }),
        arrival,
        arrivalLabel,
      ),
    [model, project, theme, locale, arrival, arrivalLabel],
  );
  const onSelectTread = selectTreadOrClear;
  if ("error" in rendered) {
    return (
      <p className="notice notice--error" role="alert">
        {t.t("ui.view.elevation.unavailable", { error: rendered.error })}
      </p>
    );
  }
  return (
    <ZoomableSvg
      svg={rendered.svg}
      label={t.t("ui.view.elevation.label")}
      selectedTread={selectedTread}
      onSelectTread={onSelectTread}
      selectedNosing={selectedNosingIndex(selection?.location)}
      onSelectNosing={selectNosingOrClear}
      onClickEmpty={clearSelection}
    />
  );
}
