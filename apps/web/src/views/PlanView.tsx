/**
 * Onglet Plan. Deux modes (état d'interface du store, `planMode`), en segmenté en haut du cadre :
 * - « Plan coté » : SVG de `renderPlanSvg` (@blondel/exports), avec surlignage et sélection de
 *   la marche par ses attributs `data-tread`, zoom − / + / Recadrer (`ZoomableSvg`) ; un clic
 *   hors d'une marche efface la sélection (retour à l'inspecteur « sans sélection ») ; le nez
 *   d'arrivée, qu'aucune marche ne porte, se sélectionne par sa ligne (QUESTIONS A28) ;
 * - « Site et saisie » (jalon 7) : calque de fond (DXF, image calibrée), murs, trémie
 *   polygonale, tracé assisté avec accroches et relevé de trémie (`PlanSiteEditor`).
 *
 * L'ancien « Mode expert » (retouches des lignes de nez) est remplacé par le bloc « Ligne de
 * nez » de l'inspecteur Marche (ADR-0009 point 4).
 */
import type { Model } from "@blondel/core";
import { useMemo } from "react";
import { useResolvedTheme } from "../components/ThemeToggle.js";
import { ZoomableSvg } from "../components/view/ZoomableSvg.js";
import {
  isExactNosingSelection,
  isExactTreadSelection,
  selectedNosingIndex,
  selectedTreadNumber,
} from "../lib/compliance.js";
import { arrivalNosingIndex } from "../lib/nosingOverrides.js";
import { useT } from "../i18n/useT.js";
import { renderPlanForScreen, withNosingTarget } from "../model/planSvg.js";
import { appStore, useApp } from "../store/appStore.js";
import { PlanSiteEditor } from "./PlanSiteEditor.js";
import "./planSite.css";

/**
 * Clic sur la marche `n` d'un dessin : un second clic sur la marche déjà inspectée efface la
 * sélection ; sinon (autre marche, pièce, nez ou règle liés à cette marche) la marche est
 * sélectionnée (inspecteur Marche).
 */
export function selectTreadOrClear(n: number): void {
  const app = appStore.getState();
  app.select(
    isExactTreadSelection(app.selection, n) ? null : { location: { kind: "tread", number: n } },
  );
}

/**
 * Clic sur le nez d'arrivée `k` d'un dessin (QUESTIONS A28) : un second clic sur le nez déjà
 * inspecté efface la sélection ; sinon le nez est sélectionné (bloc « Ligne de nez » seul).
 */
export function selectNosingOrClear(k: number): void {
  const app = appStore.getState();
  app.select(
    isExactNosingSelection(app.selection, k) ? null : { location: { kind: "nosing", index: k } },
  );
}

/** Clic dans le vide du dessin : sélection effacée (inspecteur « sans sélection »). */
export function clearSelection(): void {
  if (appStore.getState().selection !== null) appStore.getState().select(null);
}

function DimensionedPlan({ model }: { model: Model }) {
  const project = useApp((s) => s.project);
  const selection = useApp((s) => s.selection);
  const theme = useResolvedTheme();
  const selectedTread = selectedTreadNumber(selection?.location, model.parts);
  const t = useT();
  const locale = t.locale;
  const arrival = arrivalNosingIndex(model.stepping);
  const arrivalLabel = t.t("ui.lib.location.arrivalNosing");
  const rendered = useMemo(
    () =>
      withNosingTarget(
        renderPlanForScreen(model, { project, theme, locale }),
        arrival,
        arrivalLabel,
      ),
    [model, project, theme, locale, arrival, arrivalLabel],
  );
  const onSelectTread = selectTreadOrClear;
  if ("error" in rendered) {
    return (
      <p className="notice notice--error" role="alert">
        {t.t("ui.plan.drawing.unavailable", { error: rendered.error })}
      </p>
    );
  }
  return (
    <ZoomableSvg
      svg={rendered.svg}
      label={t.t("ui.plan.drawing.label")}
      selectedTread={selectedTread}
      onSelectTread={onSelectTread}
      selectedNosing={selectedNosingIndex(selection?.location)}
      onSelectNosing={selectNosingOrClear}
      onClickEmpty={clearSelection}
    />
  );
}

export function PlanView({ model }: { model: Model }) {
  const mode = useApp((s) => s.planMode);
  const setMode = appStore.getState().setPlanMode;
  const t = useT();
  return (
    <div className="plan-view">
      <div
        className="plan-view__mode seg seg--sm"
        role="group"
        aria-label={t.t("ui.plan.mode.label")}
      >
        <button
          type="button"
          className="seg-opt"
          aria-pressed={mode === "drawing"}
          onClick={() => setMode("drawing")}
        >
          {t.t("ui.plan.mode.drawing")}
        </button>
        <button
          type="button"
          className="seg-opt"
          aria-pressed={mode === "site"}
          onClick={() => setMode("site")}
        >
          {t.t("ui.plan.mode.site")}
        </button>
      </div>
      <div className="plan-view__body">
        {mode === "site" ? <PlanSiteEditor model={model} /> : <DimensionedPlan model={model} />}
      </div>
    </div>
  );
}
