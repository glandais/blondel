/**
 * Outils de la vue 3D (jalon 6) : contrôles sur les pièces (légende en haut à droite) et **barre
 * d'outils 3D** (en bas) : cotes principales, vue éclatée, plan de coupe, mesure point à point,
 * isolation de la pièce sélectionnée, apparence par famille de pièces (essence, finition ; aperçu
 * de rendu). Composant contrôlé : l'état vit dans `Viewer3D` et, pour l'apparence, les cotes
 * principales et les contrôles sur les pièces (`AppState.overlays`), dans le store.
 */
import type { MaterialId, Severity } from "@blondel/core";
import { useId } from "react";
import {
  APPEARANCE_MATERIALS,
  FAMILY_LABELS,
  type AppearanceOverrides,
  type PartFamily,
} from "../lib/appearance.js";
import { SEVERITY_LABELS } from "../lib/compliance.js";
import { MATERIAL_LABELS, SEVERITY_COLORS } from "../three/materials.js";
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
}

export const INITIAL_TOOLS: ToolsState = {
  showControls: true,
  showDimensions: true,
  explode: 0,
  section: "none",
  sectionAt: 0.5,
  sectionFlip: false,
  measuring: false,
};

const SECTION_LABELS: Readonly<Record<SectionAxis | "none", string>> = {
  none: "Aucun",
  x: "Selon X",
  y: "Selon Y",
  z: "En hauteur (Z)",
};

export interface Viewer3DToolsProps {
  readonly tools: ToolsState;
  readonly onChange: (patch: Partial<ToolsState>) => void;
  /** Violations localisées (légende des contrôles). */
  readonly flaggedCount: number;
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
  const own = materials.map((m) => MATERIAL_LABELS[m]).join(", ");
  return (
    <div className="viewer3d__family">
      <label htmlFor={id}>{FAMILY_LABELS[family]}</label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : (e.target.value as MaterialId))}
      >
        <option value="">Matériau du projet ({own})</option>
        {APPEARANCE_MATERIALS.map((m) => (
          <option key={m} value={m}>
            {MATERIAL_LABELS[m]}
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
          Contrôles sur les pièces
        </label>
        {tools.showControls && flaggedCount > 0 ? (
          <ul className="viewer3d__legend" aria-label="Légende des contrôles">
            {(["bloquant", "avertissement", "conseil"] as const satisfies readonly Severity[]).map(
              (sev) => (
                <li key={sev}>
                  <span
                    className="viewer3d__swatch"
                    style={{ background: SEVERITY_COLORS[sev] }}
                    aria-hidden="true"
                  />
                  {SEVERITY_LABELS[sev]}
                </li>
              ),
            )}
          </ul>
        ) : null}
        {tools.showControls && flaggedCount === 0 ? (
          <span className="muted">Aucune violation localisée.</span>
        ) : null}
        {tools.measuring && measureText !== null ? (
          <output className="viewer3d__measure" aria-live="polite">
            {measureText}
          </output>
        ) : null}
      </div>
      <div className="viewer3d__toolbar" role="toolbar" aria-label="Outils 3D">
        <label className="viewer3d__check">
          <input
            type="checkbox"
            checked={tools.showDimensions}
            onChange={(e) => onChange({ showDimensions: e.target.checked })}
          />{" "}
          Cotes principales
        </label>
        <label className="viewer3d__range">
          Vue éclatée
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
          Plan de coupe
          <select
            value={tools.section}
            onChange={(e) => onChange({ section: e.target.value as ToolsState["section"] })}
          >
            {(Object.keys(SECTION_LABELS) as (keyof typeof SECTION_LABELS)[]).map((k) => (
              <option key={k} value={k}>
                {SECTION_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        {tools.section !== "none" ? (
          <>
            <label className="viewer3d__range">
              Position de la coupe
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
              Inverser la coupe
            </label>
          </>
        ) : null}
        <div className="viewer3d__buttons">
          <button
            type="button"
            aria-pressed={tools.measuring}
            onClick={() => onChange({ measuring: !tools.measuring })}
          >
            Mesurer
          </button>
          {tools.measuring ? (
            <button type="button" onClick={onClearMeasure}>
              Effacer la mesure
            </button>
          ) : null}
          {isolated ? (
            <button type="button" onClick={onShowAll}>
              Tout afficher
            </button>
          ) : (
            <button type="button" disabled={!canIsolate} onClick={onIsolate}>
              Isoler la pièce
            </button>
          )}
        </div>
        <details className="viewer3d__materials">
          <summary>Matériaux{overridden > 0 ? ` (${overridden})` : ""}</summary>
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
            <small className="field__hint">
              Aperçu du rendu : ne modifie ni le projet, ni la nomenclature, ni les exports
              (matériau de fabrication : panneaux Structure et Garde-corps).
            </small>
          </div>
        </details>
      </div>
    </>
  );
}
