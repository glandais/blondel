/**
 * Calque des conflits d'adéquation au site (`Model.siteFit`, `site/fit.ts`, ou l'aperçu du
 * worker pendant un glisser, sous-lot 4c) : une zone par conflit, colorée selon la sévérité
 * (erreur, avertissement, conseil), dessinée au-dessus de l'escalier et du site, sans
 * interaction (`ConflictLayer`).
 *
 * Interaction (outil Sélectionner, sous-lot 4c), **règle d'empilement** : les zones cliquables
 * (`ConflictHitLayer`) sont placées **sous** les calques de l'escalier et du site. Un clic sur un
 * tronçon, une jonction, le contour de l'escalier, un mur ou la trémie sélectionne donc toujours
 * cet élément, conflit ou non ; un clic dans la partie d'une zone de conflit qui ne recouvre aucun
 * de ces éléments sélectionne l'élément visé par le conflit (`conflictSelection` : mur ou
 * obstacle de `targetId`, tronçon d'un recouvrement, sinon l'escalier), par la même délégation
 * que les autres éléments (attribut `data-plan-target`, distinct de `data-plan-select` : la zone
 * n'est pas l'élément, n'en porte pas la surbrillance, et un glisser commencé dans la zone
 * déplace la vue, jamais l'escalier). Au clavier, chaque zone est un bouton (Tab, puis Entrée ou
 * Espace). La bulle (texte de `conflictText`) s'affiche au survol de toute la zone, y compris
 * au-dessus de l'escalier (test géométrique de l'éditeur, `conflictAt`), et au focus clavier
 * (`onFocusConflict`). Pendant un déplacement ou une rotation de l'escalier (report d'affichage,
 * `transform`), seuls les conflits propres à l'escalier restent dessinés et suivent le report ;
 * ceux liés au site sont masqués jusqu'au modèle suivant (`planDisplay`).
 */
import type { Site, SiteConflict } from "@blondel/core";
import { memo } from "react";
import { useT } from "../../i18n/useT.js";
import { pointsAttr } from "../planSiteGeometry.js";
import { planSelectionKey } from "./planEditorGeometry.js";
import { conflictSelection, conflictText, drawnConflicts } from "./planPreview.js";
import "./conflicts.css";

export interface ConflictLayerProps {
  readonly conflicts: readonly SiteConflict[] | undefined;
  /** Report d'affichage (déplacement en cours), ou `null`. */
  readonly transform: string | null;
}

export const ConflictLayer = memo(function ConflictLayer({
  conflicts,
  transform,
}: ConflictLayerProps) {
  const tr = useT();
  const zones = drawnConflicts(conflicts);
  if (zones.length === 0) return null;
  return (
    <g
      className="plan-editor__layer plan-editor__layer--conflicts"
      data-count={zones.length}
      aria-label={tr.t("ui.plan.editor.layer.conflicts", { count: zones.length })}
      role="group"
      {...(transform ? { transform } : {})}
    >
      {zones.map(({ index, conflict: c }) => (
        <polygon
          key={`zone-${index}`}
          className={`plan-editor__conflict plan-editor__conflict--${c.severity}`}
          data-severity={c.severity}
          data-kind={c.kind}
          points={pointsAttr(c.zone)}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
});

export interface ConflictHitLayerProps extends ConflictLayerProps {
  readonly site: Site;
  /** Focus clavier d'une zone (rang dans `conflicts`), ou perte du focus (`null`). */
  readonly onFocusConflict?: (index: number | null, el: SVGElement | null) => void;
}

/**
 * Zones cliquables des conflits (outil Sélectionner), sous l'escalier et le site : voir la règle
 * d'empilement en tête du module.
 */
export const ConflictHitLayer = memo(function ConflictHitLayer({
  conflicts,
  transform,
  site,
  onFocusConflict,
}: ConflictHitLayerProps) {
  const tr = useT();
  const zones = drawnConflicts(conflicts);
  if (zones.length === 0) return null;
  return (
    <g
      className="plan-editor__layer plan-editor__layer--conflict-hits"
      {...(transform ? { transform } : {})}
    >
      {zones.map(({ index, conflict: c }) => (
        <polygon
          key={index}
          className="plan-editor__conflict-hit"
          points={pointsAttr(c.zone)}
          vectorEffect="non-scaling-stroke"
          data-plan-target={planSelectionKey(conflictSelection(c, site))}
          data-conflict={index}
          data-kind={c.kind}
          role="button"
          tabIndex={0}
          aria-label={tr.t(conflictText(c))}
          onFocus={(e) => onFocusConflict?.(index, e.currentTarget)}
          onBlur={() => onFocusConflict?.(null, null)}
        />
      ))}
    </g>
  );
});
