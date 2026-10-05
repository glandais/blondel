/**
 * Outils de la vue 3D (jalon 6) : contrôles sur les pièces (légende en haut à droite) et **barre
 * d'outils 3D** (en bas) : cotes principales, vue éclatée, plan de coupe, mesure point à point,
 * isolation de la pièce sélectionnée, apparence par famille de pièces (essence, finition ; aperçu
 * de rendu). Composant contrôlé : l'état vit dans `Viewer3D` et, pour l'apparence, les cotes
 * principales et les contrôles sur les pièces (`AppState.overlays`), dans le store.
 */
import {
  RULE_FAMILIES,
  RULE_FAMILY_LABELS,
  type MaterialId,
  type RuleFamily,
  type Severity,
} from "@blondel/core";
import type { MessageKey } from "@blondel/i18n";
import { useId } from "react";
import { useT } from "../i18n/useT.js";
import {
  APPEARANCE_MATERIALS,
  FAMILY_LABELS,
  type AppearanceOverrides,
  type PartFamily,
} from "../lib/appearance.js";
import { SEVERITY_LABELS } from "../lib/compliance.js";
import { MATERIAL_LABELS } from "../three/materials.js";
import type { SectionAxis } from "../three/section.js";

export interface ToolsState {
  readonly showControls: boolean;
  readonly showDimensions: boolean;
  /** Éclatement, 0 à 1. */
  readonly explode: number;
  readonly section: SectionAxis | "none";
  /** Position du plan de coupe, fraction 0 à 1 de la boîte de l'escalier. */
  readonly sectionAt: number;
  readonly sectionFlip: boolean;
  readonly measuring: boolean;
  /** Familles de règles dont les marqueurs sont masqués (QUESTIONS A23). */
  readonly hiddenFamilies: readonly RuleFamily[];
}

export const INITIAL_TOOLS: ToolsState = {
  showControls: true,
  showDimensions: true,
  explode: 0,
  section: "none",
  sectionAt: 0.5,
  sectionFlip: false,
  measuring: false,
  hiddenFamilies: [],
};

const SECTION_LABELS: Readonly<Record<SectionAxis | "none", MessageKey>> = {
  none: "ui.viewer3d.section.none",
  x: "ui.viewer3d.section.x",
  y: "ui.viewer3d.section.y",
  z: "ui.viewer3d.section.z",
};

export interface Viewer3DToolsProps {
  readonly tools: ToolsState;
  readonly onChange: (patch: Partial<ToolsState>) => void;
  /** Violations localisées (légende des contrôles), familles masquées exclues. */
  readonly flaggedCount: number;
  /** Violations localisées par famille de règles, avant filtrage. */
  readonly familyCounts: Readonly<Record<RuleFamily, number>>;
  /** Longueur mesurée affichée (ou consigne). */
  readonly measureText: string | null;
  readonly onClearMeasure: () => void;
  /** Pièce sélectionnée isolable, pièce isolée. */
  readonly canIsolate: boolean;
  readonly isolated: boolean;
  readonly onIsolate: () => void;
  readonly onShowAll: () => void;
  /** Familles de pièces présentes et matériaux du modèle de chacune. */
  readonly families: readonly {
    readonly family: PartFamily;
    readonly materials: readonly MaterialId[];
  }[];
  readonly appearance: AppearanceOverrides;
  /** Apparence d'une famille ; `null` : matériau du projet. */
  readonly onAppearance: (family: PartFamily, material: MaterialId | null) => void;
}

function FamilySelect({
  family,
  materials,
  value,
  onChange,
}: {
  readonly family: PartFamily;
  readonly materials: readonly MaterialId[];
  readonly value: MaterialId | undefined;
  readonly onChange: (m: MaterialId | null) => void;
}) {
  const id = useId();
  const t = useT();
  const own = materials.map((m) => t.t(MATERIAL_LABELS[m])).join(", ");
  return (
    <div className="viewer3d__family">
      <label htmlFor={id}>{t.t(FAMILY_LABELS[family])}</label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : (e.target.value as MaterialId))}
      >
        <option value="">{t.t("ui.viewer3d.material.project", { own })}</option>
        {APPEARANCE_MATERIALS.map((m) => (
          <option key={m} value={m}>
            {t.t(MATERIAL_LABELS[m])}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Viewer3DTools({
  tools,
  onChange,
  flaggedCount,
  familyCounts,
  measureText,
  onClearMeasure,
  canIsolate,
  isolated,
  onIsolate,
  onShowAll,
  families,
  appearance,
  onAppearance,
}: Viewer3DToolsProps) {
  const t = useT();
  const overridden = Object.keys(appearance).length;
  return (
    <>
      <div className="viewer3d__controls">
        <label>
          <input
            type="checkbox"
            checked={tools.showControls}
            onChange={(e) => onChange({ showControls: e.target.checked })}
          />{" "}
          {t.t("ui.viewer3d.controls")}
        </label>
        {tools.showControls ? (
          <fieldset className="viewer3d__families">
            <legend>{t.t("ui.viewer3d.families")}</legend>
            {RULE_FAMILIES.map((f) => (
              <label key={f} className="viewer3d__check">
                <input
                  type="checkbox"
                  checked={!tools.hiddenFamilies.includes(f)}
                  onChange={(e) =>
                    onChange({
                      hiddenFamilies: e.target.checked
                        ? tools.hiddenFamilies.filter((h) => h !== f)
                        : [...tools.hiddenFamilies, f],
                    })
                  }
                />{" "}
                {t.t(RULE_FAMILY_LABELS[f])} ({familyCounts[f]})
              </label>
            ))}
          </fieldset>
        ) : null}
        {tools.showControls && flaggedCount > 0 ? (
          <ul className="viewer3d__legend" aria-label={t.t("ui.viewer3d.legend.label")}>
            {(["bloquant", "avertissement", "conseil"] as const satisfies readonly Severity[]).map(
              (sev) => (
                <li key={sev}>
                  <span
                    className="viewer3d__swatch"
                    // Pastille : variable CSS de la sévérité (palette fonctionnelle du thème,
                    // la même que la scène).
                    style={{ background: `var(--sev-${sev})` }}
                    aria-hidden="true"
                  />
                  {t.t(SEVERITY_LABELS[sev])}
                </li>
              ),
            )}
          </ul>
        ) : null}
        {tools.showControls && flaggedCount === 0 ? (
          <span className="muted">
            {tools.hiddenFamilies.length > 0 &&
            tools.hiddenFamilies.some((f) => familyCounts[f] > 0)
              ? t.t("ui.viewer3d.noViolation.shown")
              : t.t("ui.viewer3d.noViolation")}
          </span>
        ) : null}
        {tools.measuring && measureText !== null ? (
          <output className="viewer3d__measure" aria-live="polite">
            {measureText}
          </output>
        ) : null}
      </div>
      <div
        className="viewer3d__toolbar"
        role="toolbar"
        aria-label={t.t("ui.viewer3d.toolbar.label")}
      >
        <label className="viewer3d__check">
          <input
            type="checkbox"
            checked={tools.showDimensions}
            onChange={(e) => onChange({ showDimensions: e.target.checked })}
          />{" "}
          {t.t("ui.viewer3d.dimensions")}
        </label>
        <label className="viewer3d__range">
          {t.t("ui.viewer3d.explode")}
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(tools.explode * 100)}
            onChange={(e) => onChange({ explode: Number(e.target.value) / 100 })}
          />
        </label>
        <label className="viewer3d__range">
          {t.t("ui.viewer3d.section")}
          <select
            value={tools.section}
            onChange={(e) => onChange({ section: e.target.value as ToolsState["section"] })}
          >
            {(Object.keys(SECTION_LABELS) as (keyof typeof SECTION_LABELS)[]).map((k) => (
              <option key={k} value={k}>
                {t.t(SECTION_LABELS[k])}
              </option>
            ))}
          </select>
        </label>
        {tools.section !== "none" ? (
          <>
            <label className="viewer3d__range">
              {t.t("ui.viewer3d.sectionAt")}
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(tools.sectionAt * 100)}
                onChange={(e) => onChange({ sectionAt: Number(e.target.value) / 100 })}
              />
            </label>
            <label className="viewer3d__check">
              <input
                type="checkbox"
                checked={tools.sectionFlip}
                onChange={(e) => onChange({ sectionFlip: e.target.checked })}
              />{" "}
              {t.t("ui.viewer3d.sectionFlip")}
            </label>
          </>
        ) : null}
        <div className="viewer3d__buttons">
          <button
            type="button"
            aria-pressed={tools.measuring}
            onClick={() => onChange({ measuring: !tools.measuring })}
          >
            {t.t("ui.viewer3d.measure")}
          </button>
          {tools.measuring ? (
            <button type="button" onClick={onClearMeasure}>
              {t.t("ui.viewer3d.measure.clear")}
            </button>
          ) : null}
          {isolated ? (
            <button type="button" onClick={onShowAll}>
              {t.t("ui.viewer3d.showAll")}
            </button>
          ) : (
            <button type="button" disabled={!canIsolate} onClick={onIsolate}>
              {t.t("ui.viewer3d.isolate")}
            </button>
          )}
        </div>
        <details className="viewer3d__materials">
          <summary>
            {t.t("ui.viewer3d.materials")}
            {overridden > 0 ? ` (${t.num(overridden, { digits: 0 })})` : ""}
          </summary>
          <div className="viewer3d__materials-panel">
            {families.map((f) => (
              <FamilySelect
                key={f.family}
                family={f.family}
                materials={f.materials}
                value={appearance[f.family]}
                onChange={(m) => onAppearance(f.family, m)}
              />
            ))}
            <small className="field__hint">{t.t("ui.viewer3d.materials.hint")}</small>
          </div>
        </details>
      </div>
    </>
  );
}
