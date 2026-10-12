/**
 * Calque des conflits d'adéquation au site (`Model.siteFit`, `site/fit.ts`) : une zone par
 * conflit, colorée selon la sévérité (erreur, avertissement, conseil). Sans interaction au
 * sous-lot 4a (`pointer-events: none`, pour ne pas prendre les clics destinés aux tronçons) : le
 * message porté par `<title>` n'apparaît donc pas en bulle au survol ; sa présentation (liste,
 * sélection d'un conflit, annonce) vient avec le calque des conflits du sous-lot 4c.
 */
import type { SiteConflict } from "@blondel/core";
import { memo } from "react";
import { useT } from "../../i18n/useT.js";
import { pointsAttr } from "../planSiteGeometry.js";

export const ConflictLayer = memo(function ConflictLayer({
  conflicts,
}: {
  conflicts: readonly SiteConflict[] | undefined;
}) {
  const tr = useT();
  const zones = (conflicts ?? []).filter((c) => c.zone.length >= 3);
  if (zones.length === 0) return null;
  return (
    <g
      className="plan-editor__layer plan-editor__layer--conflicts"
      data-count={zones.length}
      aria-label={tr.t("ui.plan.editor.layer.conflicts", { count: zones.length })}
      role="group"
    >
      {zones.map((c, i) => (
        <polygon
          key={i}
          className={`plan-editor__conflict plan-editor__conflict--${c.severity}`}
          data-severity={c.severity}
          data-kind={c.kind}
          points={pointsAttr(c.zone)}
          vectorEffect="non-scaling-stroke"
        >
          <title>{tr.t(c.message)}</title>
        </polygon>
      ))}
    </g>
  );
});
