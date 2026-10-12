/**
 * Calque des poignées de l'éditeur de plan (ADR-0010, sous-lot 4b), au-dessus des autres
 * calques, pour la sélection courante de l'outil Sélectionner (positions lues dans le `Model`,
 * `planHandles.ts`) :
 *
 * - escalier : déplacement (poignée centrale ; l'emprise se glisse aussi, `PlanEditor`) et
 *   rotation (poignée décalée, accroche de 15°) ;
 * - tronçon : fin (longueur, accroche par girons entiers ; balayage d'un arc) et bords (largeurs
 *   de départ et d'arrivée) ;
 * - jonction : angle (accroche de 15°) et rayon du raccord du jour en arc ;
 * - mur (sous-lot 5a) : extrémités (accroche aux autres murs, au calque, à l'équerre), mur entier,
 *   nus (épaisseur, nu opposé conservé) ; trémie : trémie entière et sommets. Positions lues dans
 *   le site du projet courant (jamais reportées) ; un clic sans glisser sur une extrémité ou un
 *   sommet le sélectionne.
 *
 * Maj pendant un glisser désactive les accroches. Chaque poignée est un curseur ARIA
 * (`role="slider"`, valeur en mm ou en degrés) : flèches = 10 mm ou 1°, avec Maj 100 mm ou 15° ;
 * la poignée de déplacement prend les quatre flèches (x, y). Un refus est annoncé par la zone
 * `aria-live` de l'éditeur ; la poignée reste au dernier état valide. Un appui qui ne dépasse pas
 * le seuil d'un clic ne fait aucun pas (ni accroche ni modification).
 */
import type { Model, Project, Vec2 } from "@blondel/core";
import { msg, type Message, type MessageKey } from "@blondel/i18n";
import { memo, type KeyboardEvent, type PointerEvent } from "react";
import { formatNumber } from "../../i18n/locale.js";
import { useT } from "../../i18n/useT.js";
import {
  handleKey,
  handleValue,
  isSiteHandle,
  nudgeHandle,
  siteHandleSelection,
  type DragSnap,
  type HandleValue,
  type PlanHandle,
} from "../../lib/planDrag.js";
import { HANDLE_RADIUS_PX, SLIDER_MAX_MM } from "../../lib/planErgonomics.js";
import { appStore } from "../../store/appStore.js";
import type { PlanSelection } from "../../store/planEditor.js";
import { selectPlanElement } from "../../store/uiStore.js";
import { pointsAttr, SNAP_LABELS } from "../planSiteGeometry.js";
import "./handles.css";
import { placedFootprint, selectionHandles, siteHandles, type HandleSpot } from "./planHandles.js";
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
    case "wallEnd":
      return msg("ui.plan.editor.handle.wallEnd", { id: h.id, end: h.end.toUpperCase() });
    case "wallMove":
      return msg("ui.plan.editor.handle.wallMove", { id: h.id });
    case "wallFace":
      return msg("ui.plan.editor.handle.wallFace", {
        id: h.id,
        side: msg(
          h.side === "left"
            ? "ui.plan.editor.handle.side.left"
            : "ui.plan.editor.handle.side.right",
        ),
      });
    case "openingMove":
      return msg("ui.plan.editor.handle.openingMove");
    case "openingVertex":
      return msg("ui.plan.editor.handle.openingVertex", { index: h.index + 1 });
  }
}

const SNAP_TEXT: Readonly<Record<DragSnap["kind"], MessageKey>> = {
  placement: "ui.plan.editor.handle.snap.arrival",
  length: "ui.plan.editor.handle.snap.length",
  angle: "ui.plan.editor.handle.snap.angle",
  point: "ui.plan.editor.handle.snap.point",
  square: "ui.plan.editor.handle.snap.square",
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
    case "point":
      return msg(SNAP_TEXT.point, { snap: msg(SNAP_LABELS[snap.snap]) });
    case "square":
      return msg(SNAP_TEXT.square);
  }
}

/** Déplacement (pixels) au-delà duquel un appui sur une poignée n'est plus un clic. */
const CLICK_SLOP_PX = 3;

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

/** Appuis en cours sur les poignées (clic sans glisser), par élément. */
const pressed = new WeakMap<Element, { x: number; y: number; moved: boolean }>();

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
  // Poignées du site : projet courant, jamais reportées (le site ne suit pas l'escalier).
  const site = active ? siteHandles(selection, project) : [];
  const r = HANDLE_RADIUS_PX * mmPerPx;
  const ghost =
    drag.snap?.kind === "placement" && layoutProject
      ? placedFootprint(model.layout.footprint, layoutProject.stair.placement, drag.snap.placement)
      : null;

  /** Appui sur une poignée du site (clic sans glisser : sélection de l'élément). */
  const onPointerDown = (h: PlanHandle, at: Vec2) => (e: PointerEvent<SVGElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = toSite(e.clientX, e.clientY);
    if (!p || !drag.begin(h, at, p)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pressed.set(e.currentTarget, { x: e.clientX, y: e.clientY, moved: false });
  };
  const onPointerMove = (e: PointerEvent<SVGElement>): void => {
    if (!drag.isActive()) return;
    const down = pressed.get(e.currentTarget);
    if (down && !down.moved) {
      // Sous le seuil d'un clic, aucun pas : un tremblement ne doit pas accrocher (équerre,
      // point) ni modifier le projet quand on clique pour sélectionner.
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < CLICK_SLOP_PX) return;
      down.moved = true;
    }
    const p = toSite(e.clientX, e.clientY);
    if (p) drag.move(p, e.shiftKey);
  };
  const onPointerUp = (h: PlanHandle) => (e: PointerEvent<SVGElement>) => {
    const down = pressed.get(e.currentTarget);
    pressed.delete(e.currentTarget);
    if (!drag.end()) return;
    const sel = down && !down.moved ? siteHandleSelection(h) : null;
    if (sel) selectPlanElement(sel);
  };

  const onKeyDown = (h: PlanHandle) => (e: KeyboardEvent<SVGElement>) => {
    const dir =
      e.key === "ArrowUp" || e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowDown" || e.key === "ArrowLeft"
          ? -1
          : 0;
    if (dir === 0) return;
    const current = appStore.getState().project;
    // Poignée de l'escalier : repères du modèle requis ; poignée du site : le projet suffit.
    const source = layoutProject ?? (isSiteHandle(h) ? current : null);
    if (!source) return;
    e.preventDefault();
    e.stopPropagation();
    // Pendant un glisser, ignoré : l'entrée serait hors du groupe du geste.
    if (drag.isActive()) return;
    const axis = e.key === "ArrowUp" || e.key === "ArrowDown" ? "y" : "x";
    const r = nudgeHandle(current, model, source, h, dir, e.shiftKey, axis);
    if (r.error) {
      drag.setNotice({
        kind: "error",
        text: msg("ui.plan.editor.handle.refused", { error: r.error }),
      });
      return;
    }
    const next = r.project;
    const u = appStore.getState().update(() => next, `plan-key:${handleKey(h)}`);
    if (u.ok && r.selection) {
      // Sommet de trémie réindexé (contour retourné) : il reste sélectionné et garde le focus.
      const key =
        r.selection.kind === "openingVertex"
          ? handleKey({ kind: "openingVertex", index: r.selection.index })
          : null;
      const svg = e.currentTarget.ownerSVGElement;
      selectPlanElement(r.selection);
      if (key && svg) {
        svg.querySelector<SVGElement>(`[data-plan-handle="${key}"]`)?.focus();
      }
    }
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

  const renderSpots = (list: readonly HandleSpot[]) => (
    <>
      {list.map((s) =>
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
      {list.map((s) => {
        const key = handleKey(s.handle);
        const value = handleValue(project, s.handle, SLIDER_MAX_MM);
        const dragging = drag.activeKey === key;
        const big = s.handle.kind === "move" || s.handle.kind === "openingMove";
        return (
          <circle
            key={key}
            className={`plan-editor__handle plan-editor__handle--${s.handle.kind}`}
            data-plan-handle={key}
            {...(dragging ? { "data-dragging": "true" } : {})}
            {...(dragging && drag.snap ? { "data-snapped": drag.snap.kind } : {})}
            cx={s.at.x}
            cy={s.at.y}
            r={big || s.handle.kind === "wallMove" ? r * 1.3 : r}
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
            onPointerUp={onPointerUp(s.handle)}
            onPointerCancel={() => drag.cancel()}
            onKeyDown={onKeyDown(s.handle)}
          />
        );
      })}
    </>
  );

  if (spots.length === 0 && site.length === 0 && !ghost) {
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
      <g {...(transform ? { transform } : {})}>{renderSpots(spots)}</g>
      {site.length > 0 ? <g className="plan-editor__site-handles">{renderSpots(site)}</g> : null}
    </g>
  );
});
