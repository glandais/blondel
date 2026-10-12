/**
 * Calque du site de l'éditeur de plan : murs, trémie, contour de la pièce, obstacles, lus dans
 * le site du `Project` (courant : pendant un glisser du site, le dessin suit chaque pas). Murs,
 * trémie et contour de la pièce (par leur contour) et obstacles sont sélectionnables (outil de
 * sélection) ; les extrémités d'un mur, les sommets de la trémie et ceux du contour de la pièce
 * apparaissent quand cet élément (ou l'un de ses sommets) est sélectionné. Une porte montre son
 * débattement (`doorSwingSector` du cœur, réglage d'atelier `siteFit` du projet, décision F7).
 */
import {
  openingPolygon,
  openingVertices,
  type Site,
  type SiteFitProfileInput,
  type Vec2,
} from "@blondel/core";
import { memo, useMemo } from "react";
import { pointsAttr, wallOutline } from "../planSiteGeometry.js";
import { obstacleShape } from "./planEditorGeometry.js";
import { selectable, type SelectContext } from "./selectable.js";

function Vertex({
  p,
  r,
  className,
  props,
}: {
  p: Vec2;
  r: number;
  className: string;
  props: ReturnType<typeof selectable>;
}) {
  return (
    <circle
      className={`plan-editor__vertex ${className}`}
      cx={p.x}
      cy={p.y}
      r={r}
      vectorEffect="non-scaling-stroke"
      {...props}
    />
  );
}

export const SiteLayer = memo(function SiteLayer({
  site,
  siteFit,
  ctx,
  markerR,
}: {
  site: Site;
  /** Réglage d'atelier de l'adéquation au site (rayon du débattement des portes). */
  siteFit?: SiteFitProfileInput | undefined;
  ctx: SelectContext;
  /** Rayon des repères de sommet (mm du site, ≈ 6 px à l'écran). */
  markerR: number;
}) {
  const { tr } = ctx;
  const opening = useMemo(() => openingPolygon(site.opening), [site.opening]);
  // Sommets dans l'ordre des mutateurs (`openingVertices`) : l'indice sélectionné est celui que
  // `moveOpeningVertex` et `removeOpeningVertex` attendent.
  const vertices = useMemo(
    () => (site.opening ? openingVertices(site.opening) : []),
    [site.opening],
  );
  const sel = ctx.selectedKey;
  const openingActive =
    ctx.interactive && (sel === "opening" || (sel?.startsWith("openingVertex:") ?? false));
  const room = site.room?.points ?? [];
  const roomActive =
    ctx.interactive && (sel === "room" || (sel?.startsWith("roomVertex:") ?? false));
  return (
    <g className="plan-editor__layer plan-editor__layer--site">
      {room.length >= 3 ? (
        <polygon
          className="plan-editor__room"
          points={pointsAttr(room)}
          vectorEffect="non-scaling-stroke"
          {...(sel === "room" ? { "data-selected": "true" } : {})}
        />
      ) : null}
      {room.length >= 3 ? (
        // Le contour de la pièce entoure tout le plan : il se sélectionne par son trait (zone de
        // clic élargie), l'intérieur laissant passer les clics.
        <polygon
          className="plan-editor__hit plan-editor__hit--room"
          points={pointsAttr(room)}
          vectorEffect="non-scaling-stroke"
          {...selectable({ kind: "room" }, ctx)}
          data-selected={undefined}
        />
      ) : null}
      {(site.obstacles ?? []).map((o) => {
        const shape = obstacleShape(o, siteFit);
        const props = selectable({ kind: "obstacle", id: o.id }, ctx);
        const cls = `plan-editor__obstacle plan-editor__obstacle--${o.kind}`;
        if (shape.kind === "circle") {
          return (
            <circle
              key={o.id}
              className={cls}
              cx={shape.center.x}
              cy={shape.center.y}
              r={shape.radius}
              vectorEffect="non-scaling-stroke"
              {...props}
            />
          );
        }
        if (shape.kind === "polygon") {
          return (
            <polygon
              key={o.id}
              className={cls}
              points={pointsAttr(shape.points)}
              vectorEffect="non-scaling-stroke"
              {...props}
            />
          );
        }
        return (
          <g key={o.id} className={cls} {...props}>
            {shape.swing ? (
              <polygon
                className="plan-editor__swing"
                points={pointsAttr(shape.swing)}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            <line
              className="plan-editor__bay"
              x1={shape.a.x}
              y1={shape.a.y}
              x2={shape.b.x}
              y2={shape.b.y}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
      {site.walls.map((w) => (
        <polygon
          key={w.id}
          className="plan-site__wall"
          points={pointsAttr(wallOutline(w))}
          vectorEffect="non-scaling-stroke"
          {...selectable({ kind: "wall", id: w.id }, ctx)}
        >
          <title>
            {tr.t("ui.plan.site.wall.title", { id: w.id, thickness: String(w.thickness) })}
          </title>
        </polygon>
      ))}
      {opening ? (
        <polygon
          className="plan-site__opening"
          points={pointsAttr(opening)}
          vectorEffect="non-scaling-stroke"
          {...(sel === "opening" ? { "data-selected": "true" } : {})}
        >
          <title>{tr.t("ui.label.opening")}</title>
        </polygon>
      ) : null}
      {opening ? (
        // La trémie recouvre le haut de l'escalier : elle se sélectionne par son contour (zone
        // de clic élargie), l'intérieur laissant passer les clics vers les tronçons.
        <polygon
          className="plan-editor__hit"
          points={pointsAttr(opening)}
          vectorEffect="non-scaling-stroke"
          {...selectable({ kind: "opening" }, ctx)}
          data-selected={undefined}
        />
      ) : null}
      {ctx.interactive
        ? site.walls.flatMap((w) => {
            const active =
              sel === `wall:${w.id}` || sel === `wallEnd:a:${w.id}` || sel === `wallEnd:b:${w.id}`;
            if (!active) return [];
            return (["a", "b"] as const).map((end) => (
              <Vertex
                key={`${w.id}-${end}`}
                p={w[end]}
                r={markerR}
                className="plan-editor__vertex--wall"
                props={selectable({ kind: "wallEnd", id: w.id, end }, ctx)}
              />
            ));
          })
        : null}
      {openingActive
        ? vertices.map((p, i) => (
            <Vertex
              key={`o${i}`}
              p={p}
              r={markerR}
              className="plan-editor__vertex--opening"
              props={selectable({ kind: "openingVertex", index: i }, ctx)}
            />
          ))
        : null}
      {roomActive
        ? room.map((p, i) => (
            <Vertex
              key={`r${i}`}
              p={p}
              r={markerR * 0.8}
              className="plan-editor__vertex--room"
              props={selectable({ kind: "roomVertex", index: i }, ctx)}
            />
          ))
        : null}
    </g>
  );
});
