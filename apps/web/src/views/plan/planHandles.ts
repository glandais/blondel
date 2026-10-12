/**
 * Positions des poignées de l'éditeur de plan (ADR-0010, sous-lot 4b), lues dans le `Model`
 * (`layout.sections`, `layout.turns`, `junctionFrame`, `wellRadiusFrame`, `stairPivot` du cœur) :
 * fonctions pures d'affichage, sans calcul de tracé. Coordonnées du site (mm, y vers le haut).
 *
 * - Escalier : déplacement au centre de l'emprise, rotation à distance fixe à l'écran du centre
 *   dans la direction « avant » de l'escalier (axe y local), reliée au centre par un trait.
 * - Tronçon : fin (milieu de la ligne d'arrivée : longueur, ou balayage d'un arc) et quatre
 *   poignées de bord (largeur au départ et à l'arrivée, bords gauche et droit).
 * - Jonction : angle (sur la direction sortante, à une largeur du pivot), et rayon du raccord du
 *   jour s'il est en arc (sur le bord du jour, à R du coin).
 */
import {
  junctionFrame,
  stairPivot,
  toLocal,
  toWorld,
  wellRadiusFrame,
  type Model,
  type Project,
  type StairPlacement,
  type Vec2,
} from "@blondel/core";
import type { PlanHandle } from "../../lib/planDrag.js";
import { ANGLE_HANDLE_MIN_PX, ROTATE_HANDLE_OFFSET_PX } from "../../lib/planErgonomics.js";
import type { PlanSelection } from "../../store/planEditor.js";

/** Poignée placée : position, et origine du trait de rappel éventuel. */
export interface HandleSpot {
  readonly handle: PlanHandle;
  readonly at: Vec2;
  readonly from?: Vec2;
}

const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const along = (p: Vec2, d: Vec2, k: number): Vec2 => ({ x: p.x + d.x * k, y: p.y + d.y * k });

/**
 * Poignées de la sélection `selection` : `model` et `layoutProject` (projet dont le modèle est
 * issu), `mmPerPx` (échelle de la vue). Aucune pour une sélection du site (lot 5) ou un élément
 * absent du modèle.
 */
export function selectionHandles(
  selection: PlanSelection | null,
  model: Pick<Model, "layout">,
  layoutProject: Project,
  mmPerPx: number,
): HandleSpot[] {
  if (!selection) return [];
  const layout = model.layout;
  switch (selection.kind) {
    case "stair": {
      if (layout.footprint.length === 0) return [];
      const pivot = stairPivot(layoutProject, layout);
      const forward = forwardOf(layoutProject.stair.placement);
      return [
        { handle: { kind: "move" }, at: pivot },
        {
          handle: { kind: "rotate" },
          at: along(pivot, forward, ROTATE_HANDLE_OFFSET_PX * mmPerPx),
          from: pivot,
        },
      ];
    }
    case "section": {
      const s = layout.sections?.[selection.index];
      if (!s) return [];
      const i = selection.index;
      const out: HandleSpot[] = [
        { handle: { kind: "sectionEnd", section: i }, at: mid(s.end.left, s.end.right) },
      ];
      for (const end of ["start", "end"] as const) {
        for (const edge of ["left", "right"] as const) {
          out.push({ handle: { kind: "width", section: i, end, edge }, at: s[end][edge] });
        }
      }
      return out;
    }
    case "junction": {
      const j = selection.index;
      const frame = junctionFrame(layout, j);
      const next = layout.sections?.[j + 1];
      if (!frame || !next) return [];
      const r = Math.max(next.widthStart, ANGLE_HANDLE_MIN_PX * mmPerPx);
      const out: HandleSpot[] = [
        {
          handle: { kind: "junctionAngle", junction: j },
          at: along(frame.pivot, frame.outgoing, r),
          from: frame.pivot,
        },
      ];
      const zone = layout.turns.find((t) => t.index === j) ?? layout.turns[j];
      const well = wellRadiusFrame(layout, j);
      if (zone?.well?.kind === "arc" && well) {
        out.push({
          handle: { kind: "wellRadius", junction: j },
          at: along(well.base, well.incoming, -zone.well.radius),
          from: well.base,
        });
      }
      return out;
    }
    default:
      return [];
  }
}

/** Direction « avant » (axe y local) d'un placement, repère du site. */
function forwardOf(placement: StairPlacement): Vec2 {
  const a = (placement.rotation * Math.PI) / 180;
  return { x: -Math.sin(a), y: Math.cos(a) };
}

/**
 * Emprise affichée à un placement accroché (repère visuel de la cible pendant un déplacement) :
 * emprise du modèle, calculée au placement `from`, reportée au placement `to` (déplacement
 * rigide, `toLocal` / `toWorld` du cœur). Repère d'affichage seul, jamais une cote.
 */
export function placedFootprint(
  footprint: readonly Vec2[],
  from: StairPlacement,
  to: StairPlacement,
): Vec2[] {
  return footprint.map((p) => toWorld(toLocal(p, from), to));
}
