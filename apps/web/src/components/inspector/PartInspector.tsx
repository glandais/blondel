/**
 * Inspecteur « Pièce » (maquette 2b, ADR-0009, vague 3) : pièce sélectionnée en 3D, dans les
 * développés ou la nomenclature. En-tête (famille, repère, nombre de pièces de même repère,
 * désignation), valeurs lues dans le modèle (matériau, section, longueur, masse, soudures),
 * actions (Isoler en 3D, Développé →, DXF R12), règles sur la pièce, réglages d'atelier communs
 * à la famille de pièces (`PartWorkshopSettings`, partagé avec le mode Fabrication : mêmes
 * chemins du projet et même validation que la section Structure, ou que la section Garde-corps
 * pour une pièce de garde-corps),
 * pièces assemblées et mention indicative.
 *
 * Aucune grandeur n'est calculée : une valeur absente du modèle n'a pas de ligne. Une pièce
 * absente du modèle (recalcul) ne rend rien : l'inspecteur retombe sur l'état sans sélection.
 */
import {
  QUANTITY_LENGTH_MM,
  QUANTITY_MASS_KG,
  QUANTITY_WELD_MM,
  type PartFamilyId,
} from "@blondel/core";
import { flatTermKeys, materialLabel } from "@blondel/exports";
import { msg, type MessageKey } from "@blondel/i18n";
import { ArrowRight, Download } from "lucide-react";
import { formatNumber } from "../../i18n/locale.js";
import { useT } from "../../i18n/useT.js";
import { downloadFile } from "../../lib/download.js";
import { fileStem, partDxfFile } from "../../lib/exportFiles.js";
import { assembledParts, partFastenerLines } from "../../lib/partLinks.js";
import { partSettingsFor } from "../../lib/partSettings.js";
import { formatFigureLength } from "../../lib/units.js";
import { appStore, journeyStore, useApp, useModel } from "../../store/appStore.js";
import { isolatePart, showAllParts, switchWorkspace, useUi } from "../../store/uiStore.js";
import { ElementRules } from "./ElementRules.js";
import { PartLinkList } from "./PartLinkList.js";
import { PartWorkshopSettings } from "./PartWorkshopSettings.js";
import "./part.css";

export interface PartInspectorProps {
  /** Identifiant de la pièce sélectionnée (`Part.id`, présente dans le modèle affiché). */
  readonly partId: string;
}

const FAMILY_KEYS: Readonly<Record<PartFamilyId, MessageKey>> = {
  treads: "ui.partInspector.family.treads",
  structure: "ui.partInspector.family.structure",
  guards: "ui.partInspector.family.guards",
};

/** Ligne du tableau des valeurs. */
interface ValueRow {
  readonly id: string;
  readonly label: MessageKey;
  readonly value: string;
}

/** Affiche la vue d'un espace de travail (bascule d'espace d'abord, puis la vue). */
function showView(workspace: "design" | "fabrication", view: "3d" | "flat"): void {
  if (journeyStore.getState().workspace !== workspace) switchWorkspace(workspace);
  appStore.getState().setView(view);
}

export function PartInspector({ partId }: PartInspectorProps) {
  const t = useT();
  const { model } = useModel();
  const projectName = useApp((s) => s.project.name);
  const displayUnit = useApp((s) => s.displayUnit);
  const guards = useApp((s) => s.project.guards);
  const isolated = useUi((s) => s.isolatedPartId) === partId;
  const part = model?.parts.find((p) => p.id === partId);
  if (!model || !part) return null;

  const sameMark = model.parts.filter((p) => p.mark === part.mark).length;
  const lengthText = (mm: number): string =>
    `${formatFigureLength(mm, displayUnit, t.locale)} ${displayUnit}`;

  // Valeurs lues dans le modèle ; une valeur absente n'a pas de ligne.
  const rows: ValueRow[] = [];
  rows.push({
    id: "material",
    label: "ui.partInspector.value.material",
    value: materialLabel(t, part.material),
  });
  if (part.section !== undefined) {
    rows.push({ id: "section", label: "ui.partInspector.value.section", value: t.t(part.section) });
  }
  const length = part.stock?.length ?? part.quantities[QUANTITY_LENGTH_MM];
  if (length !== undefined && Number.isFinite(length)) {
    rows.push({
      id: "length",
      label:
        part.flat !== undefined
          ? "ui.partInspector.value.developed"
          : "ui.partInspector.value.length",
      value: lengthText(length),
    });
  }
  const mass = part.quantities[QUANTITY_MASS_KG];
  if (mass !== undefined && Number.isFinite(mass)) {
    rows.push({
      id: "mass",
      label: "ui.partInspector.value.mass",
      value: t.t("ui.partInspector.value.massKg", {
        mass: formatNumber(t.locale, mass, { maximumFractionDigits: 1 }),
      }),
    });
  }
  const weld = part.quantities[QUANTITY_WELD_MM];
  if (weld !== undefined && Number.isFinite(weld) && weld > 0) {
    rows.push({
      id: "welds",
      label: "ui.partInspector.value.welds",
      value: t.t("ui.partInspector.value.weldsM", {
        length: formatNumber(t.locale, weld / 1000, { maximumFractionDigits: 1 }),
      }),
    });
  }

  const hasFlat = part.flat !== undefined;
  // « Development » pour un limon bois, « flat pattern » sinon (anglais, QUESTIONS A26 (a)).
  const flatKeys = flatTermKeys(part);
  const noFlat = t.t("ui.partInspector.noFlat");
  const settings = partSettingsFor(part, guards);
  const family = part.family;

  return (
    <div className="insp-template insp-template--part" data-part={part.id}>
      <div className="insp-head">
        <span className="insp-eyebrow">
          {family === undefined
            ? t.t("ui.partInspector.eyebrow.plain")
            : t.t("ui.partInspector.eyebrow", { family: msg(FAMILY_KEYS[family]) })}
        </span>
        <div className="insp-title-row">
          <span className="insp-swatch" aria-hidden="true" />
          <h3 className="insp-title">{part.mark}</h3>
          <span
            className="tag tag-neutral part-insp__count num"
            title={t.t("ui.partInspector.count.title", { mark: part.mark, count: sameMark })}
          >
            {t.t("ui.partInspector.count", { count: sameMark })}
          </span>
        </div>
        <span className="insp-subtitle">{t.t(part.name)}</span>
        {part.treadNumber !== undefined ? (
          <button
            type="button"
            className="btn btn-ghost part-insp__tread"
            onClick={() =>
              appStore.getState().select({ location: { kind: "tread", number: part.treadNumber! } })
            }
          >
            {t.t("ui.partInspector.treadLink", { number: String(part.treadNumber) })}
            <ArrowRight size={13} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <table
        className="table insp-values"
        aria-label={t.t("ui.partInspector.values", { mark: part.mark })}
      >
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-value={r.id}>
              <td>{t.t(r.label)}</td>
              <td>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="insp-actions">
        <button
          type="button"
          className="btn btn-secondary"
          aria-pressed={isolated}
          onClick={() => {
            if (isolated) {
              showAllParts();
              return;
            }
            showView("design", "3d");
            isolatePart(part.id);
          }}
        >
          {isolated
            ? t.t("ui.partInspector.action.showAll")
            : t.t("ui.partInspector.action.isolate")}
        </button>
        <button
          type="button"
          className="btn btn-secondary part-insp__action"
          disabled={!hasFlat}
          title={hasFlat ? t.t(flatKeys.actionTitle, { mark: part.mark }) : noFlat}
          onClick={() => showView("fabrication", "flat")}
        >
          {t.t(flatKeys.action)}
          <ArrowRight size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="btn btn-secondary part-insp__action"
          disabled={!hasFlat}
          title={hasFlat ? t.t(flatKeys.dxfTitle, { mark: part.mark }) : noFlat}
          onClick={() => downloadFile(partDxfFile(part, fileStem(projectName), t.locale))}
        >
          <Download size={14} aria-hidden="true" />
          {t.t("ui.partInspector.action.dxf")}
        </button>
      </div>

      <ElementRules target={{ kind: "part", partId: part.id }} />

      {settings ? (
        <PartWorkshopSettings part={part} settings={settings} variant="inspector" />
      ) : null}

      <PartLinkList
        title={t.t("ui.partInspector.assembledWith")}
        parts={assembledParts(model, part.id)}
        fasteners={partFastenerLines(model, part.id)}
      />

      <span className="insp-spacer" />
      <p className="inspector-disclaimer">{t.t("ui.compliance.disclaimer")}</p>
    </div>
  );
}
