/**
 * Inspecteur contextuel du parcours libre (ADR-0009, maquettes 2a à 2d), colonne de droite de
 * 340 px, visible en Conception comme en Fabrication. Le gabarit suit la sélection partagée
 * (`appStore.selection`) : règle (2c), marche ou nez (2a), pièce (2b), rien ou autre chose (2d).
 *
 * Chaque gabarit est monté avec une `key` dérivée de la sélection : changer d'élément
 * réinitialise son état local (saisie en cours, formulaire de surcharge). Les gabarits 2a à 2c
 * partagent l'ossature de `frame.css` (surtitre, pastille, titre, valeurs, blocs, liens).
 */
import type { Model } from "@blondel/core";
import { useLayoutEffect, useRef } from "react";
import { useT } from "../../i18n/useT.js";
import { useApp, useModel } from "../../store/appStore.js";
import type { Selection } from "../../store/projectStore.js";
import { PartInspector } from "./PartInspector.js";
import { ProjectInspector } from "./ProjectInspector.js";
import { RuleInspector } from "./RuleInspector.js";
import { TreadInspector } from "./TreadInspector.js";
import "./frame.css";
import "./inspector.css";

/** Gabarits de l'inspecteur : marche (2a), pièce (2b), règle (2c), sans sélection (2d). */
export type InspectorTemplate = "tread" | "part" | "rule" | "project";

/**
 * Numéro de la marche inspectée pour une sélection de marche ou de nez (nez k ↔ marche k + 1),
 * si elle existe dans le découpage ; `null` sinon.
 */
export function inspectedTread(
  selection: Selection | null,
  model: Pick<Model, "stepping"> | null,
): number | null {
  if (selection === null || model === null) return null;
  const loc = selection.location;
  const n = loc.kind === "tread" ? loc.number : loc.kind === "nosing" ? loc.index + 1 : null;
  if (n === null) return null;
  return model.stepping.treads.some((t) => t.number === n) ? n : null;
}

/**
 * Gabarit d'une sélection : aucune → projet ; règle (`ruleId`) → règle ; marche existante, ou
 * nez dont la marche suivante existe → marche ; pièce présente dans le modèle → pièce ; tout le
 * reste (escalier, point, élément disparu, pas de modèle) → projet.
 */
export function inspectorTemplate(
  selection: Selection | null,
  model: Pick<Model, "parts" | "stepping"> | null,
): InspectorTemplate {
  if (selection === null) return "project";
  if (selection.ruleId !== undefined) return "rule";
  if (model === null) return "project";
  if (inspectedTread(selection, model) !== null) return "tread";
  const loc = selection.location;
  if (loc.kind === "part" && model.parts.some((p) => p.id === loc.partId)) return "part";
  return "project";
}

/** Clé de montage d'un gabarit : change avec l'élément inspecté. */
export function selectionKey(selection: Selection | null): string {
  if (selection === null) return "none";
  const loc = selection.location;
  const where =
    loc.kind === "tread"
      ? `tread-${loc.number}`
      : loc.kind === "nosing"
        ? `nosing-${loc.index}`
        : loc.kind === "part"
          ? `part-${loc.partId}${loc.treadNumber === undefined ? "" : `-${loc.treadNumber}`}`
          : loc.kind === "point"
            ? `point-${loc.at.x}-${loc.at.y}-${loc.at.z}`
            : "stair";
  return selection.ruleId === undefined ? where : `rule-${selection.ruleId}-${where}`;
}

export function Inspector() {
  const t = useT();
  const selection = useApp((s) => s.selection);
  const { model } = useModel();
  const template = inspectorTemplate(selection, model);
  const key = selectionKey(selection);
  // Nouvel élément inspecté : l'inspecteur repart du haut (le conteneur défilant est conservé
  // d'un gabarit à l'autre). Effet de mise en page : avant les effets des gabarits qui
  // amènent une section à l'écran (liste des surcharges, contrôle).
  const aside = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (aside.current) aside.current.scrollTop = 0;
  }, [key]);
  let content;
  if (template === "rule" && selection !== null) {
    content = <RuleInspector key={key} selection={selection} />;
  } else if (template === "part" && selection?.location.kind === "part") {
    content = <PartInspector key={key} partId={selection.location.partId} />;
  } else if (template === "tread") {
    const n = inspectedTread(selection, model);
    content = n === null ? <ProjectInspector /> : <TreadInspector key={`tread-${n}`} number={n} />;
  } else {
    content = <ProjectInspector />;
  }
  return (
    <aside
      ref={aside}
      className="inspector"
      aria-label={t.t("ui.inspector.label")}
      data-template={template}
    >
      {content}
    </aside>
  );
}
