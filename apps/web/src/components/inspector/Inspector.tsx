/**
 * Inspecteur contextuel du parcours libre (ADR-0009, maquettes 2a à 2d), colonne de droite de
 * 340 px, visible en Conception comme en Fabrication. Le gabarit suit la sélection : marche
 * (2a), pièce (2b), règle (2c), rien (2d). En vague 2, seul le gabarit « projet » (2d) existe :
 * une sélection le garde, la carte de la règle sélectionnée y étant mise en évidence.
 */
import { useT } from "../../i18n/useT.js";
import { useApp } from "../../store/appStore.js";
import type { Selection } from "../../store/projectStore.js";
import { ProjectInspector } from "./ProjectInspector.js";
import "./inspector.css";

/** Gabarits de l'inspecteur : marche (2a), pièce (2b), règle (2c), sans sélection (2d). */
export type InspectorTemplate = "tread" | "part" | "rule" | "project";

/**
 * Gabarit d'une sélection. Vague 2 : « project » pour toute sélection ; la vague 3 ajoutera
 * marche, pièce et règle.
 */
export function inspectorTemplate(_selection: Selection | null): InspectorTemplate {
  return "project";
}

export function Inspector() {
  const t = useT();
  const selection = useApp((s) => s.selection);
  const template = inspectorTemplate(selection);
  return (
    <aside className="inspector" aria-label={t.t("ui.inspector.label")} data-template={template}>
      <ProjectInspector />
    </aside>
  );
}
