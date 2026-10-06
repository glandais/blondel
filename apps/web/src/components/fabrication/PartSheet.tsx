/**
 * Pièce choisie au centre du mode Fabrication (wireframe « Parcours libre · Fabrication ») :
 * pièce désignée par la sélection partagée (`selectedPart`, la même que l'inspecteur Pièce 2b).
 *
 * - en-tête : repère en accent, puis « désignation · section (ou matériau) · masse » et le bouton
 *   « DXF R12 » (désactivé sans développé) ;
 * - gabarit coté du développé : SVG exporté (`FlatPatternDrawing`, `renderFlatPatternSvg`),
 *   inséré tel quel ;
 * - tronçons et joints des pièces débitées en plusieurs morceaux.
 *
 * Sans pièce : invitation à en choisir une, puis tronçons et joints de toutes les pièces débitées
 * en plusieurs morceaux (vue d'ensemble) ; pièce sans développé (débitée) : renvoi vers la
 * nomenclature. Aucune grandeur n'est calculée ici.
 */
import { QUANTITY_MASS_KG, type Model, type Part } from "@blondel/core";
import { flatTermKeys, materialLabel } from "@blondel/exports";
import { Download } from "lucide-react";
import { numberFormat } from "../../i18n/locale.js";
import { useT } from "../../i18n/useT.js";
import { downloadFile } from "../../lib/download.js";
import { fileStem, partDxfFile } from "../../lib/exportFiles.js";
import { selectedPart } from "../../lib/parts.js";
import { appStore, useApp } from "../../store/appStore.js";
import { AllSegments, FlatPatternDrawing, PartSegments } from "../../views/FlatPatternView.js";
import { Corners } from "../ui/Blueprint.js";
import { Icon } from "../ui/Icon.js";

const KG: Intl.NumberFormatOptions = { maximumFractionDigits: 1 };

/** Ce qu'affiche la fiche : invitation, pièce sans développé, ou développé. */
export type PartSheetState = "choose" | "noFlat" | "flat";

export function partSheetState(part: Pick<Part, "flat"> | undefined): PartSheetState {
  if (!part) return "choose";
  return part.flat ? "flat" : "noFlat";
}

/** Désignation · section ou matériau · masse (les éléments absents sont omis). */
function PartTitle({ part }: { part: Part }) {
  const t = useT();
  const mass = part.quantities[QUANTITY_MASS_KG];
  const details = [
    t.t(part.name),
    part.section ? t.t(part.section) : materialLabel(t, part.material),
    mass === undefined || !Number.isFinite(mass)
      ? undefined
      : t.t("ui.flat.massKg", { mass: numberFormat(t.locale, KG).format(mass) }),
  ].filter((s): s is string => s !== undefined && s !== "");
  return (
    <h2 className="fab-sheet__title">
      <span className="fab-sheet__mark">{part.mark}</span>
      <span className="fab-sheet__details">{details.join(" · ")}</span>
    </h2>
  );
}

export function PartSheet({ model }: { model: Pick<Model, "parts"> }) {
  const t = useT();
  const selection = useApp((s) => s.selection);
  const projectName = useApp((s) => s.project.name);
  const part = selectedPart(model, selection?.location);
  const state = partSheetState(part);

  if (!part) {
    return (
      <section className="fab-sheet" aria-label={t.t("ui.fab.sheet.label")}>
        <p className="empty-view" role="status">
          {t.t("ui.fab.sheet.choose")}
        </p>
        <AllSegments model={model} />
      </section>
    );
  }
  return (
    <section className="fab-sheet" aria-label={t.t("ui.fab.sheet.label")} data-part={part.id}>
      <header className="fab-sheet__head">
        <PartTitle part={part} />
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!part.flat}
          title={part.flat ? undefined : t.t("ui.fab.sheet.dxf.none")}
          onClick={() => downloadFile(partDxfFile(part, fileStem(projectName), t.locale))}
        >
          <Icon icon={Download} size={16} />
          {t.t("ui.partInspector.action.dxf")}
        </button>
      </header>
      {state === "flat" ? (
        <>
          <p className="eyebrow fab-sheet__eyebrow">{t.t(flatTermKeys(part).template)}</p>
          <div className="fab-sheet__drawing blueprint">
            <Corners />
            <FlatPatternDrawing part={part} />
          </div>
        </>
      ) : (
        <div className="fab-sheet__noflat" role="status">
          <p>{t.t("ui.fab.sheet.noFlat")}</p>
          <button type="button" className="link" onClick={() => appStore.getState().setView("bom")}>
            {t.t("ui.fab.sheet.openBom")}
          </button>
        </div>
      )}
      <PartSegments model={model} part={part} />
    </section>
  );
}
