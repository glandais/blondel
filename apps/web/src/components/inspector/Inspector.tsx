/**
 * Inspecteur contextuel du parcours libre (ADR-0009, maquettes 2a à 2d), colonne de droite de
 * 340 px, visible en Conception comme en Fabrication. Le gabarit suit la sélection partagée
 * (`appStore.selection`) : règle (2c), marche ou nez (2a), nez d'arrivée (bloc « Ligne de nez »
 * seul, QUESTIONS A28), pièce (2b), rien ou autre chose (2d).
 *
 * Chaque gabarit est monté avec une `key` dérivée de la sélection : changer d'élément
 * réinitialise son état local (saisie en cours, formulaire de surcharge). Les gabarits 2a à 2c
 * partagent l'ossature de `frame.css` (surtitre, pastille, titre, valeurs, blocs, liens).
 *
 * Fenêtre de 760 à 1 099 px (ADR-0009 point 3) : l'inspecteur du parcours libre passe en tiroir
 * à droite, par-dessus la vue (`drawer`, posé par `App`), avec une croix « Fermer l'inspecteur ».
 */
import type { Model } from "@blondel/core";
import { X } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { useT } from "../../i18n/useT.js";
import { useApp, useModel } from "../../store/appStore.js";
import type { Selection } from "../../store/projectStore.js";
import { closeInspectorDrawer } from "../../store/uiStore.js";
import { arrivalNosingIndex } from "../../lib/nosingOverrides.js";
import { Icon } from "../ui/Icon.js";
import { ArrivalNosingInspector } from "./ArrivalNosingInspector.js";
import { PartInspector } from "./PartInspector.js";
import { ProjectInspector } from "./ProjectInspector.js";
import { RuleInspector } from "./RuleInspector.js";
import { TreadInspector } from "./TreadInspector.js";
import "./frame.css";
import "./inspector.css";

/**
 * Gabarits de l'inspecteur : marche (2a), nez d'arrivée (bloc « Ligne de nez » seul, A28),
 * pièce (2b), règle (2c), sans sélection (2d).
 */
export type InspectorTemplate = "tread" | "nosing" | "part" | "rule" | "project";

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
 * Indice du nez d'arrivée inspecté (QUESTIONS A28) : sélection du nez `k` quand `k` est le
 * nez d'arrivée du découpage (`arrivalNosingIndex`, aucune marche ne le porte) ; `null` sinon
 * (nez d'une marche, indice hors découpage, autre élément).
 */
export function inspectedArrivalNosing(
  selection: Selection | null,
  model: Pick<Model, "stepping"> | null,
): number | null {
  if (selection === null || model === null) return null;
  const loc = selection.location;
  if (loc.kind !== "nosing") return null;
  return arrivalNosingIndex(model.stepping) === loc.index ? loc.index : null;
}

/**
 * Gabarit d'une sélection : aucune → projet ; règle (`ruleId`) → règle ; marche existante, ou
 * nez dont la marche suivante existe → marche ; nez d'arrivée → nez ; pièce présente dans le
 * modèle → pièce ; tout le reste (escalier, point, élément disparu, nez hors découpage, pas de
 * modèle) → projet.
 */
export function inspectorTemplate(
  selection: Selection | null,
  model: Pick<Model, "parts" | "stepping"> | null,
): InspectorTemplate {
  if (selection === null) return "project";
  if (selection.ruleId !== undefined) return "rule";
  if (model === null) return "project";
  if (inspectedTread(selection, model) !== null) return "tread";
  if (inspectedArrivalNosing(selection, model) !== null) return "nosing";
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

export interface InspectorProps {
  /**
   * Inspecteur en tiroir (fenêtre de 760 à 1 099 px, parcours libre en Conception) : ouvert ou
   * fermé (`uiStore.inspectorDrawerOpen`). Fermé, il est masqué et hors de l'arbre
   * d'accessibilité (`inert`) ; ouvert, il porte la croix « Fermer l'inspecteur ». Absent : colonne
   * (grand écran) ou liste du contrôle du guidé.
   */
  readonly drawer?: "open" | "closed";
}

export function Inspector({ drawer }: InspectorProps) {
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
  } else if (template === "nosing") {
    const k = inspectedArrivalNosing(selection, model);
    content =
      k === null ? <ProjectInspector /> : <ArrivalNosingInspector key={`nosing-${k}`} index={k} />;
  } else {
    content = <ProjectInspector />;
  }
  return (
    <aside
      ref={aside}
      className="inspector"
      aria-label={t.t("ui.inspector.label")}
      data-template={template}
      data-drawer={drawer}
      inert={drawer === "closed" ? true : undefined}
    >
      {drawer === "open" ? (
        // Barre collante de hauteur nulle : la croix reste en haut à droite pendant le défilement.
        <div className="inspector__drawer-bar">
          <button
            type="button"
            className="btn btn-ghost btn-icon inspector__drawer-close"
            aria-label={t.t("ui.inspector.drawer.close")}
            title={t.t("ui.inspector.drawer.close")}
            onClick={() => closeInspectorDrawer({ restoreFocus: true })}
          >
            <Icon icon={X} size={16} />
          </button>
        </div>
      ) : null}
      {content}
    </aside>
  );
}
