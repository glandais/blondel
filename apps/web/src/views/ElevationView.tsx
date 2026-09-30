/**
 * Onglet Élévation : SVG de `renderElevationSvg` (@blondel/exports), développé le long de la
 * ligne de foulée, avec surlignage et sélection de la marche par ses attributs `data-tread`.
 */
import type { Model, Project } from "@blondel/core";
import { useMemo } from "react";
import { useResolvedTheme } from "../components/ThemeToggle.js";
import { useT } from "../i18n/useT.js";
import { renderElevationForScreen } from "../model/planSvg.js";
import { appStore } from "../store/appStore.js";
import { ExportedSvg } from "./ExportedSvg.js";

interface ElevationProps {
  readonly model: Model;
  readonly project: Project;
  readonly selectedTread: number | undefined;
}

export function ElevationView({ model, project, selectedTread }: ElevationProps) {
  const theme = useResolvedTheme();
  const t = useT();
  const locale = t.locale;
  const rendered = useMemo(
    () => renderElevationForScreen(model, { project, theme, locale }),
    [model, project, theme, locale],
  );
  const onSelectTread = (n: number) =>
    appStore
      .getState()
      .select(selectedTread === n ? null : { location: { kind: "tread", number: n } });
  if ("error" in rendered) {
    return (
      <p className="notice notice--error" role="alert">
        {t.t("ui.view.elevation.unavailable", { error: rendered.error })}
      </p>
    );
  }
  return (
    <ExportedSvg
      svg={rendered.svg}
      label={t.t("ui.view.elevation.label")}
      selectedTread={selectedTread}
      onSelectTread={onSelectTread}
    />
  );
}
