/**
 * Calque des poignées de l'éditeur de plan (ADR-0010, sous-lot 4b), au-dessus des autres
 * calques, pour la sélection courante de l'outil Sélectionner (positions lues dans le `Model`,
 * `planHandles.ts`) :
 *
 * - escalier : déplacement (poignée centrale ; l'emprise se glisse aussi, `PlanEditor`) et
 *   rotation (poignée décalée, accroche de 15°) ;
 * - tronçon : fin (longueur, accroche par girons entiers ; balayage d'un arc) et bords (largeurs
 *   de départ et d'arrivée) ;
 * - jonction : angle (accroche de 15°) et rayon du raccord du jour en arc.
 *
 * Maj pendant un glisser désactive les accroches. Chaque poignée est un curseur ARIA
 * (`role="slider"`, valeur en mm ou en degrés) : flèches = 10 mm ou 1°, avec Maj 100 mm ou 15° ;
 * la poignée de déplacement prend les quatre flèches (x, y). Un refus est annoncé par la zone
 * `aria-live` de l'éditeur ; la poignée reste au dernier état valide.
 */
import type { Model, Project, Vec2 } from "@blondel/core";
import { msg, type Message, type MessageKey } from "@blondel/i18n";
import { memo, type KeyboardEvent, type PointerEvent } from "react";
import { formatNumber } from "../../i18n/locale.js";
import { useT } from "../../i18n/useT.js";
import {
  handleKey,
  handleValue,
  nudgeHandle,
  type DragSnap,
  type HandleValue,
  type PlanHandle,
} from "../../lib/planDrag.js";
import { HANDLE_RADIUS_PX, SLIDER_MAX_MM } from "../../lib/planErgonomics.js";
import { appStore } from "../../store/appStore.js";
import type { PlanSelection } from "../../store/planEditor.js";
import { pointsAttr } from "../planSiteGeometry.js";
import "./handles.css";
import { placedFootprint, selectionHandles } from "./planHandles.js";
import type { PlanDrag } from "./usePlanDrag.js";

/** Libellé accessible d'une poignée. */
function handleLabel(h: PlanHandle, project: Project): Message {
  switch (h.kind) {
    case "move":
      return msg("ui.plan.editor.handle.move");
    case "rotate":
      return msg("ui.plan.editor.handle.rotate");
    case "sectionEnd": {
      const v = handleValue(project, h, SLIDER_MAX_MM);
      return msg(
        v?.unit === "deg"
          ? "ui.plan.editor.handle.sectionSweep"
          : "ui.plan.editor.handle.sectionEnd",
        { index: h.section + 1 },
      );
    }
    case "width":
      return msg(
        h.end === "start" ? "ui.plan.editor.handle.widthStart" : "ui.plan.editor.handle.widthEnd",
        {
          index: h.section + 1,
          side: msg(
            h.edge === "left"
              ? "ui.plan.editor.handle.side.left"
              : "ui.plan.editor.handle.side.right",
          ),
        },
      );
    case "junctionAngle":
      return msg("ui.plan.editor.handle.junctionAngle", { index: h.junction + 1 });
    case "wellRadius":
      return msg("ui.plan.editor.handle.wellRadius", { index: h.junction + 1 });
  }
}

const SNAP_TEXT: Readonly<Record<DragSnap["kind"], MessageKey>> = {
  placement: "ui.plan.editor.handle.snap.arrival",
  length: "ui.plan.editor.handle.snap.length",
  angle: "ui.plan.editor.handle.snap.angle",
};

/** Annonce d'une accroche (zone `aria-live` de l'éditeur). */
export function snapMessage(snap: DragSnap, format: (v: number) => string): Message {
  switch (snap.kind) {
    case "placement":
      return snap.target.kind === "wallFlank"
        ? msg("ui.plan.editor.handle.snap.wallFlank", { id: snap.target.wallId })
        : msg(SNAP_TEXT.placement);
    case "length":
      return msg(SNAP_TEXT.length, { count: snap.goings, length: format(snap.length) });
    case "angle":
      return msg(SNAP_TEXT.angle, { angle: format(snap.angle) });
  }
}

function valueText(v: HandleValue, format: (n: number) => string): Message {
  if (v.unit === "position" && v.position) {
    return msg("ui.plan.editor.handle.value.position", {
      x: format(v.position.x),
      y: format(v.position.y),
    });
  }
  if (v.now === null) return msg("ui.plan.editor.handle.value.auto");
  return msg(
    v.unit === "deg" ? "ui.plan.editor.handle.value.deg" : "ui.plan.editor.handle.value.mm",
    {
      value: format(v.now),
    },
  );
}

export interface HandleLayerProps {
  readonly model: Model;
  /** Projet dont `model` est issu (positions des poignées). */
  readonly layoutProject: Project | null;
  /** Projet courant (valeurs des curseurs). */
  readonly project: Project;
  readonly selection: PlanSelection | null;
  /** Outil de sélection actif : poignées affichées. */
  readonly active: boolean;
  readonly mmPerPx: number;
  readonly drag: PlanDrag;
  /** Point du site sous un pointeur (coordonnées d'écran). */
  readonly toSite: (clientX: number, clientY: number) => Vec2 | null;
  /**
   * Report d'affichage des poignées au placement courant (déplacement ou rotation en cours,
   * sous-lot 4c), ou `null` ; le repère d'accroche (emprise à la cible) n'est pas reporté.
   */
  readonly transform?: string | null;
}

export const HandleLayer = memo(function HandleLayer({
  model,
  layoutProject,
  project,
  selection,
  active,
  mmPerPx,
  drag,
  toSite,
  transform = null,
}: HandleLayerProps) {
  const tr = useT();
  const format = (v: number): string => formatNumber(tr.locale, Math.round(v));
  const spots =
    active && layoutProject ? selectionHandles(selection, model, layoutProject, mmPerPx) : [];
  const r = HANDLE_RADIUS_PX * mmPerPx;
  const ghost =
    drag.snap?.kind === "placement" && layoutProject
      ? placedFootprint(model.layout.footprint, layoutProject.stair.placement, drag.snap.placement)
      : null;

  const onPointerDown = (h: PlanHandle, at: Vec2) => (e: PointerEvent<SVGElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = toSite(e.clientX, e.clientY);
    if (!p || !drag.begin(h, at, p)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<SVGElement>): void => {
    if (!drag.isActive()) return;
    const p = toSite(e.clientX, e.clientY);
    if (p) drag.move(p, e.shiftKey);
  };
  const onPointerUp = (): void => {
    drag.end();
  };

  const onKeyDown = (h: PlanHandle) => (e: KeyboardEvent<SVGElement>) => {
    const dir =
      e.key === "ArrowUp" || e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowDown" || e.key === "ArrowLeft"
          ? -1
          : 0;
    if (dir === 0 || !layoutProject) return;
    e.preventDefault();
    e.stopPropagation();
    // Pendant un glisser, ignoré : l'entrée serait hors du groupe du geste.
    if (drag.isActive()) return;
    const axis = e.key === "ArrowUp" || e.key === "ArrowDown" ? "y" : "x";
    const current = appStore.getState().project;
    const r = nudgeHandle(current, model, layoutProject, h, dir, e.shiftKey, axis);
    if (r.error) {
      drag.setNotice({
        kind: "error",
        text: msg("ui.plan.editor.handle.refused", { error: r.error }),
      });
      return;
    }
    const next = r.project;
    const u = appStore.getState().update(() => next, `plan-key:${handleKey(h)}`);
    drag.setNotice(
      u.ok
        ? null
        : {
            kind: "error",
            text: msg("ui.plan.editor.handle.refused", {
              error: u.issues[0] ?? msg("ui.plan.site.refused"),
            }),
          },
    );
  };

  if (spots.length === 0 && !ghost) {
    return <g className="plan-editor__layer plan-editor__layer--handles" />;
  }
  return (
    <g
      className="plan-editor__layer plan-editor__layer--handles"
      role="group"
      aria-label={tr.t("ui.plan.editor.handle.layer")}
    >
      {ghost ? (
        <polygon
          className="plan-editor__snap-ghost"
          points={pointsAttr(ghost)}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      <g {...(transform ? { transform } : {})}>
        {spots.map((s) =>
          s.from ? (
            <line
              key={`guide-${handleKey(s.handle)}`}
              className="plan-editor__handle-guide"
              x1={s.from.x}
              y1={s.from.y}
              x2={s.at.x}
              y2={s.at.y}
              vectorEffect="non-scaling-stroke"
            />
          ) : null,
        )}
        {spots.map((s) => {
          const key = handleKey(s.handle);
          const value = handleValue(project, s.handle, SLIDER_MAX_MM);
          const dragging = drag.activeKey === key;
          return (
            <circle
              key={key}
              className={`plan-editor__handle plan-editor__handle--${s.handle.kind}`}
              data-plan-handle={key}
              {...(dragging ? { "data-dragging": "true" } : {})}
              {...(dragging && drag.snap ? { "data-snapped": drag.snap.kind } : {})}
              cx={s.at.x}
              cy={s.at.y}
              r={s.handle.kind === "move" ? r * 1.3 : r}
              vectorEffect="non-scaling-stroke"
              role="slider"
              tabIndex={0}
              aria-label={tr.t(handleLabel(s.handle, project))}
              {...(value
                ? {
                    "aria-valuemin": value.min,
                    "aria-valuemax": value.max,
                    ...(value.now !== null ? { "aria-valuenow": Math.round(value.now) } : {}),
                    "aria-valuetext": tr.t(valueText(value, format)),
                  }
                : {})}
              onPointerDown={onPointerDown(s.handle, s.at)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => drag.cancel()}
              onKeyDown={onKeyDown(s.handle)}
            />
          );
        })}
      </g>
    </g>
  );
});
