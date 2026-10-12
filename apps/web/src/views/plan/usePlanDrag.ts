/**
 * Glisser des poignées de l'éditeur de plan (ADR-0010, sous-lot 4b) : relie la session pure
 * (`lib/planDragSession.ts`) au store du projet (`update` collant, `endGroup`, `revertGroup`), à
 * `requestAnimationFrame` (au plus un pas par image) et à Échap (écouteur de fenêtre en capture
 * pendant le geste : le geste est annulé, Échap ne désélectionne pas et ne ferme rien d'autre).
 *
 * Un geste sur une poignée de l'escalier ne commence que si le `Model` affiché est celui du
 * projet courant (`modelProject`) : les mutateurs lisent leurs repères dans le tracé calculé, qui
 * doit être celui du projet du début du geste. Les poignées du site (sous-lot 5a) ne lisent que
 * le site du projet : elles se prennent même pendant un calcul.
 *
 * Retour en direct (sous-lot 4c, `modelService.beginGesture` / `endGesture`) : pendant un
 * déplacement ou une rotation (`transform`), aucun calcul, l'éditeur transforme l'affichage du
 * dernier modèle ; pendant les autres glissers (`preview`), chaque pas demande un aperçu au
 * worker (tracé, découpage léger, conflits géométriques). Le modèle complet n'est demandé qu'une
 * fois, au relâchement (ou à l'annulation).
 */
import type { Model, Project, Vec2 } from "@blondel/core";
import { msg, type Message } from "@blondel/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  beginDrag,
  handleKey,
  isSiteHandle,
  type DragSnap,
  type PlanHandle,
} from "../../lib/planDrag.js";
import { createDragSession, gestureMode } from "../../lib/planDragSession.js";
import { HANDLE_SNAP_RADIUS_PX } from "../../lib/planErgonomics.js";
import { appStore, modelService } from "../../store/appStore.js";
import type { PlanSelection } from "../../store/planEditor.js";
import { selectPlanElement } from "../../store/uiStore.js";

/** Annonce de l'éditeur pendant un geste (accroche, refus, annulation). */
export type DragNotice =
  | { readonly kind: "snap"; readonly snap: DragSnap }
  | { readonly kind: "error"; readonly text: Message }
  | { readonly kind: "info"; readonly text: Message };

export interface PlanDrag {
  /** Clé de la poignée en cours de glisser, ou `null`. */
  readonly activeKey: string | null;
  /** Accroche du dernier pas (repère visuel). */
  readonly snap: DragSnap | null;
  readonly notice: DragNotice | null;
  /** Geste en cours (lu sans attendre le rendu : événements du pointeur rapprochés). */
  isActive(): boolean;
  setNotice(n: DragNotice | null): void;
  /** Début d'un geste ; faux si le modèle n'est pas celui du projet courant. */
  begin(handle: PlanHandle, anchor: Vec2, pointer: Vec2): boolean;
  move(pointer: Vec2, free: boolean): void;
  end(): boolean;
  cancel(): boolean;
}

export function usePlanDrag(
  model: Model,
  modelProject: Project | null,
  mmPerPx: number,
  /** Appelé au début d'un geste (l'éditeur y fige son cadrage). */
  onBegin?: () => void,
): PlanDrag {
  const onBeginRef = useRef(onBegin);
  onBeginRef.current = onBegin;
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [snap, setSnap] = useState<DragSnap | null>(null);
  const [notice, setNotice] = useState<DragNotice | null>(null);
  const seq = useRef(0);
  /** Sélection à rétablir à la fin du geste (sommet de trémie réindexé). */
  const reselect = useRef<PlanSelection | null>(null);
  /** Clé de la poignée prise au début du geste (`null` hors geste). */
  const startKey = useRef<string | null>(null);
  const scale = useRef(mmPerPx);
  scale.current = mmPerPx;

  const session = useMemo(
    () =>
      createDragSession({
        update: (recipe, key, options) => appStore.getState().update(recipe, key, options),
        endGroup: () => appStore.getState().endGroup(),
        revertGroup: (key) => appStore.getState().revertGroup(key),
        current: () => appStore.getState().project,
        requestFrame: (cb) => requestAnimationFrame(cb),
        cancelFrame: (id) => cancelAnimationFrame(id),
        onStep: (step) => {
          if (step.selection !== undefined && startKey.current !== null) {
            reselect.current = step.selection;
            // Sommet de trémie réindexé pendant le geste : la poignée glissée est désormais
            // celle de son nouvel indice (repère `data-dragging`, accroche).
            setActiveKey(
              step.selection?.kind === "openingVertex"
                ? handleKey({ kind: "openingVertex", index: step.selection.index })
                : startKey.current,
            );
          }
          setSnap(step.snap);
          if (step.error) {
            setNotice({
              kind: "error",
              text: msg("ui.plan.editor.handle.refused", { error: step.error }),
            });
          } else {
            setNotice(step.snap ? { kind: "snap", snap: step.snap } : null);
          }
        },
      }),
    [],
  );

  const finish = useCallback((): void => {
    startKey.current = null;
    setActiveKey(null);
    setSnap(null);
  }, []);

  const cancel = useCallback((): boolean => {
    reselect.current = null;
    const cancelled = session.cancel();
    modelService.endGesture();
    if (!cancelled) return false;
    finish();
    setNotice({ kind: "info", text: msg("ui.plan.editor.handle.cancelled") });
    return true;
  }, [session, finish]);

  // Échap pendant un geste : écouteur de fenêtre en capture, avant ceux de l'application.
  useEffect(() => {
    if (activeKey === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      cancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [activeKey, cancel]);

  // Démontage pendant un geste (changement de vue) : le geste est clos tel quel.
  useEffect(
    () => () => {
      session.end();
      modelService.endGesture();
    },
    [session],
  );

  const begin = useCallback(
    (handle: PlanHandle, anchor: Vec2, pointer: Vec2): boolean => {
      const project = appStore.getState().project;
      if (modelProject !== project && !isSiteHandle(handle)) return false;
      reselect.current = null;
      seq.current += 1;
      onBeginRef.current?.();
      modelService.beginGesture(gestureMode(handle));
      session.begin(beginDrag(handle, project, model, pointer, anchor, seq.current));
      startKey.current = handleKey(handle);
      setActiveKey(startKey.current);
      setSnap(null);
      setNotice(null);
      return true;
    },
    [model, modelProject, session],
  );

  const move = useCallback(
    (pointer: Vec2, free: boolean): void => {
      session.move(pointer, { free, snapRadius: HANDLE_SNAP_RADIUS_PX * scale.current });
    },
    [session],
  );

  const end = useCallback((): boolean => {
    const ended = session.end();
    modelService.endGesture();
    if (!ended) return false;
    finish();
    const sel = reselect.current;
    reselect.current = null;
    if (sel) selectPlanElement(sel);
    return true;
  }, [session, finish]);

  const isActive = useCallback((): boolean => session.gesture() !== null, [session]);

  return { activeKey, snap, notice, isActive, setNotice, begin, move, end, cancel };
}
