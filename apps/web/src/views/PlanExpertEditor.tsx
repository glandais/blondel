/**
 * Plan 2D, « Mode expert » (SPEC §2.3, CHALLENGE A4) : surcharges typées des lignes de nez.
 *
 * - clic sur une ligne de nez : sélection (aussi par la liste du panneau) ;
 * - poignée (disque au bout de la ligne, côté mur) : la faire glisser fait pivoter la ligne
 *   autour de son point P_k sur la ligne de foulée → surcharge `angle` persistée ; tout le
 *   glissement est **une** entrée d'historique (regroupement collant jusqu'au relâchement) ;
 * - clic droit sur une ligne, bouton « Nez fixe » ou touche F : nez fixe (bascule) ;
 * - flèches ← → : ± 1° (Maj : ± 0,1°) ; Suppr : retire les surcharges du nez ; Échap :
 *   désélectionne ;
 * - surcharges orphelines (nez disparu après régénération) listées et supprimables.
 *
 * L'effet des surcharges (zones balancées, collets, K3 / K5) est celui du cœur, lu dans le
 * modèle recalculé ; seule la ligne en cours de glissement est un aperçu local.
 */
import { openingPolygon, type Model, type NosingLine, type Vec2 } from "@blondel/core";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  angleFromPointer,
  directionForAngle,
  expertAvailability,
  nosingAngleDeg,
  orphanOverrides,
  overrideLabel,
  overrideNotes,
  overridesAt,
  roundAngle,
  withAngleOverride,
  withFixedOverride,
  withoutNosingOverrides,
} from "../lib/expert.js";
import { appStore, useApp } from "../store/appStore.js";
import {
  fitView,
  pointsAttr,
  screenToSite,
  siteBounds,
  stairOverlay,
  viewBoxAttr,
  wallOutline,
  zoomAt,
  type ViewBox,
} from "./planSiteGeometry.js";
import { msg, type Locale, type Message } from "@blondel/i18n";
import { formatNumber } from "../i18n/locale.js";
import { useT } from "../i18n/useT.js";
import "./planExpert.css";

const fmtAngle = (a: number, locale: Locale): string =>
  formatNumber(locale, a, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Modification ponctuelle : une entrée d'historique ; message d'erreur ou `null`. */
function commit(recipe: Parameters<ReturnType<typeof appStore.getState>["update"]>[0]) {
  const s = appStore.getState();
  s.endGroup();
  const r = s.update(recipe);
  s.endGroup();
  return r.ok ? null : (r.issues[0] ?? msg("ui.plan.site.refused"));
}

/** Extrémité de la poignée : côté mur de la ligne de nez, à la longueur P → R. */
function handlePoint(n: NosingLine, dir: Vec2): Vec2 {
  const L = Math.max(Math.hypot(n.r.x - n.p.x, n.r.y - n.p.y), 100);
  return { x: n.p.x + dir.x * L, y: n.p.y + dir.y * L };
}

export function PlanExpertEditor({ model }: { model: Model }) {
  const t = useT();
  const project = useApp((s) => s.project);
  const selection = useApp((s) => s.selection);
  const selected = selection?.location.kind === "nosing" ? selection.location.index : null;
  const nosings = model.stepping.nosings;
  const current = selected !== null && selected < nosings.length ? selected : null;
  const availability = expertAvailability(model);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [view, setView] = useState<ViewBox | null>(null);
  /**
   * Glissement en cours : nez, angle affiché, clé de regroupement, et `moved` (la poignée a
   * réellement tourné). Un simple clic sur la poignée n'enregistre **aucune** surcharge.
   */
  const [drag, setDrag] = useState<{
    k: number;
    angle: number;
    key: string;
    moved: boolean;
  } | null>(null);
  // Erreur affichée : message traduit à l'affichage.
  const [message, setMessage] = useState<Message | null>(null);
  const [angleText, setAngleText] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; view: ViewBox } | null>(null);
  const dragSeq = useRef(0);
  const frame = useRef<number | null>(null);
  const selectId = useId();
  const angleId = useId();

  const aspect = size.w / Math.max(1, size.h);
  const fitted = useMemo(
    () => fitView(siteBounds(project, model, false), aspect),
    [project, model, aspect],
  );
  const v = view ?? fitted;
  const mmPerPx = v.width / Math.max(1, size.w);
  const stair = useMemo(() => stairOverlay(model), [model]);
  const opening = useMemo(() => openingPolygon(project.site.opening), [project.site.opening]);
  const orphans = orphanOverrides(project, model);
  const notes = overrideNotes(model);
  const overridden = useMemo(() => {
    const m = new Map<number, { fixed: boolean; angle: boolean }>();
    for (const o of project.stair.nosingOverrides) {
      const e = m.get(o.index) ?? { fixed: false, angle: false };
      if (o.kind === "fixed") e.fixed = true;
      else e.angle = true;
      m.set(o.index, e);
    }
    return m;
  }, [project.stair.nosingOverrides]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = (): void => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  const toSite = useCallback(
    (clientX: number, clientY: number): Vec2 | null => {
      const el = svgRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return null;
      return screenToSite(v, aspect, (clientX - r.left) / r.width, (clientY - r.top) / r.height);
    },
    [v, aspect],
  );

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      const p = toSite(e.clientX, e.clientY);
      if (!p) return;
      e.preventDefault();
      setView(zoomAt(v, p, e.deltaY < 0 ? 1.25 : 1 / 1.25));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [toSite, v]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const select = (k: number | null): void => {
    setMessage(null);
    setAngleText(null);
    appStore.getState().select(k === null ? null : { location: { kind: "nosing", index: k } });
  };

  const setAngle = (k: number, angle: number): void => {
    const error = commit((p) => withAngleOverride(p, k, roundAngle(angle)));
    setMessage(error ? msg("ui.plan.expert.angleRefused", { error }) : null);
  };

  const toggleFixed = (k: number): void => {
    const fixed = overridesAt(project, k).fixed;
    const error = commit((p) => withFixedOverride(p, k, !fixed));
    setMessage(error ? msg("ui.plan.expert.overrideRefused", { error }) : null);
  };

  // ------------------------------------------------------------------ glissement de la poignée
  const pushDrag = (k: number, angle: number, key: string): void => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    // Une modification du projet par image au plus ; le modèle suit (dernier calcul seulement).
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      appStore.getState().update((p) => withAngleOverride(p, k, angle), key, { sticky: true });
    });
  };

  const onHandleDown = (e: PointerEvent<SVGCircleElement>, k: number): void => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.ownerSVGElement?.setPointerCapture?.(e.pointerId);
    appStore.getState().endGroup();
    const key = `expert-angle-${k}-${++dragSeq.current}`;
    setDrag({ k, angle: roundAngle(nosingAngleDeg(model, k)), key, moved: false });
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>): void => {
    if (e.button === 1 || (e.button === 0 && !(e.target instanceof SVGLineElement))) {
      pan.current = { x: e.clientX, y: e.clientY, view: v };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>): void => {
    if (drag) {
      const p = toSite(e.clientX, e.clientY);
      const angle = p ? angleFromPointer(model, drag.k, p) : null;
      if (angle === null || angle === drag.angle) return;
      setDrag({ ...drag, angle, moved: true });
      pushDrag(drag.k, angle, drag.key);
      return;
    }
    const start = pan.current;
    if (start) {
      const k = start.view.width / Math.max(1, size.w);
      setView({
        ...start.view,
        cx: start.view.cx - (e.clientX - start.x) * k,
        cy: start.view.cy + (e.clientY - start.y) * k,
      });
    }
  };

  const onPointerUp = (): void => {
    pan.current = null;
    if (!drag) return;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    const { k, angle, key, moved } = drag;
    if (!moved) {
      // Clic sans glissement : ni surcharge ni entrée d'historique (un nez balancé ne doit pas
      // être figé à son angle courant par un simple clic).
      appStore.getState().endGroup();
      setDrag(null);
      return;
    }
    const r = appStore
      .getState()
      .update((p) => withAngleOverride(p, k, angle), key, { sticky: true });
    appStore.getState().endGroup();
    setDrag(null);
    setMessage(
      r.ok
        ? null
        : msg("ui.plan.expert.angleRefused", {
            error: r.issues[0] ?? msg("ui.common.input.refused"),
          }),
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLSelectElement ||
      e.target instanceof HTMLButtonElement
    ) {
      return;
    }
    if (current === null) return;
    if (e.key === "Escape") {
      select(null);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const step = (e.shiftKey ? 0.1 : 1) * (e.key === "ArrowRight" ? 1 : -1);
      const base = overridesAt(project, current).angle ?? nosingAngleDeg(model, current);
      setAngle(current, base + step);
    } else if (e.key === "f" || e.key === "F") {
      e.preventDefault();
      toggleFixed(current);
    } else if (e.key === "Delete") {
      e.preventDefault();
      commit((p) => withoutNosingOverrides(p, [current]));
    }
  };

  if (!availability.ok) {
    return (
      <div className="plan-expert">
        <p className="notice notice--info" role="status">
          {t.t("ui.plan.expert.unavailable", { reason: availability.reason })}
        </p>
      </div>
    );
  }

  const markerR = 7 * mmPerPx;
  const pR = 3.5 * mmPerPx;
  const selectedNosing = current !== null ? nosings[current] : undefined;
  const selectedOverrides = current !== null ? overridesAt(project, current) : null;
  const nosingName = (index: number, balanced: boolean): string =>
    t.t(balanced ? "ui.plan.expert.nosing.balanced" : "ui.plan.expert.nosing", { index });
  const shownAngle =
    drag && drag.k === current
      ? drag.angle
      : current !== null
        ? roundAngle(nosingAngleDeg(model, current))
        : 0;

  return (
    <div className="plan-site plan-expert" onKeyDown={onKeyDown}>
      <div className="plan-site__main">
        <div className="plan-site__canvas" ref={boxRef}>
          <svg
            ref={svgRef}
            className="plan-site__svg plan-expert__svg"
            viewBox={viewBoxAttr(v, aspect)}
            role="application"
            aria-label={t.t("ui.plan.expert.svg.label")}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <g transform="scale(1,-1)">
              {project.site.walls.map((w) => (
                <polygon
                  key={w.id}
                  className="plan-site__wall"
                  points={pointsAttr(wallOutline(w))}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {stair.footprint.length > 0 ? (
                <polygon
                  className="plan-site__stair"
                  points={pointsAttr(stair.footprint)}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {opening ? (
                <polygon
                  className="plan-site__opening"
                  points={pointsAttr(opening)}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {stair.walkline.length > 1 ? (
                <polyline
                  className="plan-site__walkline"
                  points={pointsAttr(stair.walkline)}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {nosings.map((n) => {
                const o = overridden.get(n.index);
                const isSel = n.index === current;
                const dragging = drag?.k === n.index;
                let q = n.q;
                let r = n.r;
                if (dragging) {
                  // Aperçu : ligne tournée autour de P_k, longueurs P→Q et P→R conservées.
                  const d = directionForAngle(model, n.index, drag.angle);
                  const lq = Math.hypot(n.q.x - n.p.x, n.q.y - n.p.y);
                  const lr = Math.hypot(n.r.x - n.p.x, n.r.y - n.p.y);
                  q = { x: n.p.x - d.x * lq, y: n.p.y - d.y * lq };
                  r = { x: n.p.x + d.x * lr, y: n.p.y + d.y * lr };
                }
                const cls = [
                  "plan-expert__nosing",
                  n.balanced ? "plan-expert__nosing--balanced" : "",
                  o?.angle ? "plan-expert__nosing--angle" : "",
                  o?.fixed ? "plan-expert__nosing--fixed" : "",
                  isSel ? "plan-expert__nosing--selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <g key={n.index} data-nosing={n.index}>
                    <line
                      className={cls}
                      x1={q.x}
                      y1={q.y}
                      x2={r.x}
                      y2={r.y}
                      vectorEffect="non-scaling-stroke"
                    />
                    <line
                      className="plan-expert__hit"
                      data-nosing={n.index}
                      x1={q.x}
                      y1={q.y}
                      x2={r.x}
                      y2={r.y}
                      vectorEffect="non-scaling-stroke"
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        select(n.index);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        select(n.index);
                        toggleFixed(n.index);
                      }}
                    >
                      <title>{nosingName(n.index, n.balanced)}</title>
                    </line>
                    <circle className="plan-expert__p" cx={n.p.x} cy={n.p.y} r={pR} />
                  </g>
                );
              })}
              {selectedNosing ? (
                <circle
                  className="plan-expert__handle"
                  data-handle={current ?? undefined}
                  {...(() => {
                    const h = handlePoint(
                      selectedNosing,
                      drag?.k === current
                        ? directionForAngle(model, current!, drag.angle)
                        : selectedNosing.dir,
                    );
                    return { cx: h.x, cy: h.y };
                  })()}
                  r={markerR}
                  vectorEffect="non-scaling-stroke"
                  onPointerDown={(e) => onHandleDown(e, current!)}
                >
                  <title>{t.t("ui.plan.expert.handle.title")}</title>
                </circle>
              ) : null}
            </g>
          </svg>
          <p className="plan-site__status" aria-live="polite">
            {current !== null
              ? t.t(drag ? "ui.plan.expert.status.dragging" : "ui.plan.expert.status", {
                  index: current,
                  angle: fmtAngle(shownAngle, t.locale),
                })
              : t.t("ui.plan.expert.status.none")}
          </p>
        </div>
        <aside className="plan-site__panel" aria-label={t.t("ui.plan.expert.overrides.label")}>
          <p className="muted">{t.t("ui.plan.expert.intro")}</p>
          {message ? (
            <p className="notice notice--error" role="alert">
              {t.t(message)}
            </p>
          ) : null}
          <div className="field">
            <label htmlFor={selectId}>{t.t("ui.plan.expert.selected")}</label>
            <select
              id={selectId}
              value={current === null ? "" : String(current)}
              onChange={(e) => select(e.target.value === "" ? null : Number(e.target.value))}
            >
              <option value="">{t.t("ui.plan.expert.selected.none")}</option>
              {nosings.map((n) => (
                <option key={n.index} value={String(n.index)}>
                  {overridden.has(n.index)
                    ? t.t("ui.plan.expert.nosing.overridden", {
                        name: nosingName(n.index, n.balanced),
                      })
                    : nosingName(n.index, n.balanced)}
                </option>
              ))}
            </select>
          </div>
          {current !== null && selectedOverrides ? (
            <div className="plan-site__group plan-expert__edit">
              <div className="field">
                <label htmlFor={angleId}>{t.t("ui.plan.expert.angle")}</label>
                <input
                  id={angleId}
                  type="text"
                  inputMode="decimal"
                  value={angleText ?? fmtAngle(shownAngle, t.locale)}
                  onChange={(e) => setAngleText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    const a = Number((angleText ?? "").replace(",", "."));
                    if (angleText !== null && Number.isFinite(a)) setAngle(current, a);
                    setAngleText(null);
                  }}
                  onBlur={() => setAngleText(null)}
                />
                <small className="field__hint">{t.t("ui.plan.expert.angle.hint")}</small>
              </div>
              <div className="button-row">
                <button
                  type="button"
                  aria-pressed={selectedOverrides.fixed}
                  onClick={() => toggleFixed(current)}
                  title={t.t("ui.plan.expert.fixed.title")}
                >
                  {t.t("ui.plan.expert.fixed")}
                </button>
                <button
                  type="button"
                  disabled={!selectedOverrides.fixed && selectedOverrides.angle === null}
                  onClick={() => commit((p) => withoutNosingOverrides(p, [current]))}
                >
                  {t.t("ui.plan.expert.removeNosing")}
                </button>
              </div>
            </div>
          ) : null}
          <details className="plan-site__group" open>
            <summary>
              {t.t("ui.plan.expert.overrides", { count: project.stair.nosingOverrides.length })}
            </summary>
            {project.stair.nosingOverrides.length === 0 ? (
              <p className="muted">{t.t("ui.plan.expert.overrides.none")}</p>
            ) : (
              <ul className="plan-expert__list" aria-label={t.t("ui.plan.expert.overrides.label")}>
                {project.stair.nosingOverrides.map((o, i) => {
                  const orphan = orphans.includes(o);
                  return (
                    <li key={i} className={orphan ? "plan-expert__orphan" : undefined}>
                      <span>
                        {overrideLabel(o, t.locale)}
                        {orphan ? t.t("ui.plan.expert.orphan") : ""}
                      </span>
                      <button
                        type="button"
                        aria-label={t.t("ui.plan.expert.remove.label", {
                          label: overrideLabel(o, t.locale),
                        })}
                        onClick={() =>
                          commit((p) => ({
                            ...p,
                            stair: {
                              ...p.stair,
                              nosingOverrides: p.stair.nosingOverrides.filter((_, j) => j !== i),
                            },
                          }))
                        }
                      >
                        {t.t("ui.plan.expert.remove")}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="button-row">
              {orphans.length > 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    commit((p) => withoutNosingOverrides(p, new Set(orphans.map((o) => o.index))))
                  }
                >
                  {t.t("ui.plan.expert.removeOrphans", { count: orphans.length })}
                </button>
              ) : null}
              {project.stair.nosingOverrides.length > 0 ? (
                <button type="button" onClick={() => commit((p) => withoutNosingOverrides(p))}>
                  {t.t("ui.plan.expert.removeAll")}
                </button>
              ) : null}
            </div>
          </details>
          {notes.length > 0 ? (
            <ul className="plan-expert__notes" aria-label={t.t("ui.plan.expert.notes.label")}>
              {notes.map((n, i) => (
                <li key={i}>{t.t(n)}</li>
              ))}
            </ul>
          ) : null}
          <p className="muted plan-expert__keys">{t.t("ui.plan.expert.keys")}</p>
          <button type="button" onClick={() => setView(null)}>
            {t.t("ui.plan.site.fit")}
          </button>
        </aside>
      </div>
    </div>
  );
}
