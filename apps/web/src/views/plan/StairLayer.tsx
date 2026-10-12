/**
 * Calque de l'escalier de l'éditeur de plan, lu dans le `Model` (aucun calcul de tracé ici) :
 * emprise (`layout.footprint`), tronçons (`layout.sections`), jonctions (`layout.turns`, entre
 * deux tronçons), lignes de nez (`stepping.nosings`) et ligne de foulée Γ (`layout.walkline`),
 * ces deux dernières sans interaction. Tronçons et jonctions recouvrent toute l'emprise :
 * l'escalier se sélectionne par son contour (zone de clic élargie placée au-dessus d'eux).
 */
import type { Model } from "@blondel/core";
import { memo, useMemo } from "react";
import { pointsAttr, stairOverlay } from "../planSiteGeometry.js";
import { junctionPolygon, sectionPathData } from "./planEditorGeometry.js";
import { selectable, type SelectContext } from "./selectable.js";

export const StairLayer = memo(function StairLayer({
  model,
  ctx,
}: {
  model: Model;
  ctx: SelectContext;
}) {
  const stair = useMemo(() => stairOverlay(model), [model]);
  const sections = useMemo(
    () => (model.layout.sections ?? []).map((s) => ({ index: s.index, d: sectionPathData(s) })),
    [model.layout],
  );
  const junctions = useMemo(
    () =>
      model.layout.turns.flatMap((_, j) => {
        const pts = junctionPolygon(model.layout, j);
        return pts ? [{ index: j, points: pointsAttr(pts) }] : [];
      }),
    [model.layout],
  );
  return (
    <g className="plan-editor__layer plan-editor__layer--stair">
      {stair.footprint.length > 0 ? (
        <polygon
          className="plan-site__stair"
          points={pointsAttr(stair.footprint)}
          vectorEffect="non-scaling-stroke"
          {...(ctx.selectedKey === "stair" ? { "data-selected": "true" } : {})}
        />
      ) : null}
      {sections.map((s) => (
        <path
          key={s.index}
          className="plan-editor__section"
          d={s.d}
          vectorEffect="non-scaling-stroke"
          {...selectable({ kind: "section", index: s.index }, ctx)}
        />
      ))}
      {junctions.map((j) => (
        <polygon
          key={j.index}
          className="plan-editor__junction"
          points={j.points}
          vectorEffect="non-scaling-stroke"
          {...selectable({ kind: "junction", index: j.index }, ctx)}
        />
      ))}
      {stair.footprint.length > 0 ? (
        <polygon
          className="plan-editor__hit plan-editor__hit--stair"
          points={pointsAttr(stair.footprint)}
          vectorEffect="non-scaling-stroke"
          {...selectable({ kind: "stair" }, ctx)}
          data-selected={undefined}
        />
      ) : null}
      <g className="plan-editor__passive">
        {stair.nosings.map(([q, r], i) => (
          <line
            key={i}
            className="plan-site__nosing"
            x1={q.x}
            y1={q.y}
            x2={r.x}
            y2={r.y}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {stair.walkline.length > 1 ? (
          <polyline
            className="plan-site__walkline"
            points={pointsAttr(stair.walkline)}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </g>
    </g>
  );
});
