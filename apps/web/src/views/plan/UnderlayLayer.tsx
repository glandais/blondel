/**
 * Calque de fond de l'éditeur de plan : image calibrée et plan DXF (un seul chemin, mémoïsé).
 * Sans interaction : les accroches au calque sont gérées par `PlanEditor` (`site/snap.ts`).
 */
import type { Underlay } from "@blondel/core";
import { memo, useMemo } from "react";
import { dxfPathData } from "../planSiteGeometry.js";

/** Couche du calque DXF (mémoïsée : un seul chemin, recalculé seulement si le calque change). */
const DxfPath = memo(function DxfPath({ d, opacity }: { d: string; opacity: number }) {
  return (
    <path className="plan-site__dxf" d={d} opacity={opacity} vectorEffect="non-scaling-stroke" />
  );
});

export const UnderlayLayer = memo(function UnderlayLayer({
  underlay,
}: {
  underlay: Underlay | undefined;
}) {
  const dxf = underlay?.dxf;
  const d = useMemo(() => (dxf ? dxfPathData(dxf) : ""), [dxf]);
  const img = underlay?.image;
  const opacity = underlay?.opacity ?? 1;
  return (
    <g className="plan-editor__layer plan-editor__layer--underlay">
      {img ? (
        <image
          href={img.dataUrl}
          width={img.widthPx}
          height={img.heightPx}
          opacity={opacity}
          preserveAspectRatio="none"
          transform={`translate(${img.placement.origin.x} ${img.placement.origin.y}) rotate(${img.placement.rotation}) scale(${img.mmPerPx} ${-img.mmPerPx})`}
        />
      ) : null}
      {d ? <DxfPath d={d} opacity={opacity} /> : null}
    </g>
  );
});
