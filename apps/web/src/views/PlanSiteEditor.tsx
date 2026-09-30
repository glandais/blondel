/**
 * Plan « Site et saisie » (jalon 7) : calque de fond (plan DXF, image calibrée), murs, trémie
 * polygonale et contour de l'escalier ; saisie assistée par clic avec accroche aux entités du
 * calque (extrémités, milieux, intersections, centres) et aux sommets existants.
 *
 * Outils : Déplacer (glisser pour déplacer la vue, molette pour zoomer), Trémie (clic par sommet,
 * clic sur le premier sommet ou Entrée pour fermer), Mur (deux clics : axe du mur ; au nu, deux
 * clics sur le nu puis un troisième du côté du mur, QUESTIONS A24), Calibrer
 * (deux points de l'image puis la distance réelle). Échap abandonne le tracé, Retour arrière
 * retire le dernier sommet. Chaque tracé terminé est une entrée d'historique (annulable).
 */
import {
  buildSnapIndex,
  calibrateImage,
  imagePixelToSite,
  openingPolygon,
  siteToImagePixel,
  snapPoint,
  underlaySegments,
  withImageUnderlay,
  withOpeningPolygon,
  withWall,
  withoutWall,
  type Model,
  type Project,
  type SnapHit,
  type Vec2,
} from "@blondel/core";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { UnderlayImport } from "../components/UnderlayImport.js";
import { appStore, useApp } from "../store/appStore.js";
import { msg, type Locale, type Message, type MessageKey } from "@blondel/i18n";
import { formatNumber } from "../i18n/locale.js";
import { useT } from "../i18n/useT.js";
import "./planSite.css";
import { PlanSurveyForm } from "./PlanSurveyForm.js";
import {
  DEFAULT_WALL_THICKNESS_MM,
  dxfPathData,
  faceWallOutline,
  fitView,
  openingClick,
  pointsAttr,
  projectSnapPoints,
  projectSnapSegments,
  screenToSite,
  siteBounds,
  SNAP_LABELS,
  stairOverlay,
  viewBoxAttr,
  wallClick,
  wallFaceSide,
  wallOutline,
  zoomAt,
  type PlanTool,
  type ViewBox,
  type WallTraceMode,
} from "./planSiteGeometry.js";

/** Rayon d'accroche à l'écran (pixels). */
const SNAP_RADIUS_PX = 12;

const TOOLS: readonly { id: PlanTool; label: MessageKey; title: MessageKey }[] = [
  { id: "pan", label: "ui.plan.site.tool.pan", title: "ui.plan.site.tool.pan.title" },
  { id: "opening", label: "ui.plan.site.tool.opening", title: "ui.plan.site.tool.opening.title" },
  { id: "wall", label: "ui.plan.site.tool.wall", title: "ui.plan.site.tool.wall.title" },
  {
    id: "calibrate",
    label: "ui.plan.site.tool.calibrate",
    title: "ui.plan.site.tool.calibrate.title",
  },
];

/** Texte d'une remarque : message à traduire, ou texte brut (motif de refus, exception). */
type Note = Message | string;

const fmt = (v: number, locale: Locale): string => formatNumber(locale, Math.round(v));

function commit(recipe: (p: Project) => Project): Note | null {
  const r = appStore.getState().update(recipe);
  appStore.getState().endGroup();
  return r.ok ? null : (r.issues[0] ?? msg("ui.plan.site.refused"));
}

/** Couche du calque DXF (mémoïsée : un seul chemin, recalculé seulement si le calque change). */
const DxfLayer = memo(function DxfLayer({ d, opacity }: { d: string; opacity: number }) {
  return (
    <path className="plan-site__dxf" d={d} opacity={opacity} vectorEffect="non-scaling-stroke" />
  );
});

export function PlanSiteEditor({ model }: { model: Model }) {
  const tr = useT();
  const project = useApp((s) => s.project);
  const site = project.site;
  const underlay = site.underlay;
  const [tool, setTool] = useState<PlanTool>("pan");
  const [draft, setDraft] = useState<Vec2[]>([]);
  const [cursor, setCursor] = useState<{ raw: Vec2; snap: SnapHit | null } | null>(null);
  const [snapOn, setSnapOn] = useState(true);
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: Note } | null>(null);
  const [wallThickness, setWallThickness] = useState(String(DEFAULT_WALL_THICKNESS_MM));
  const [wallMode, setWallMode] = useState<WallTraceMode>("axis");
  const [calib, setCalib] = useState<{ a: Vec2; b?: Vec2; distance: string } | null>(null);
  const [preview, setPreview] = useState<readonly Vec2[] | null>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [view, setView] = useState<ViewBox | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; view: ViewBox } | null>(null);

  const aspect = size.w / Math.max(1, size.h);
  const fitted = useMemo(
    () => fitView(siteBounds(project, model), aspect),
    [project, model, aspect],
  );
  const v = view ?? fitted;
  const mmPerPx = v.width / Math.max(1, size.w);

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

  const dxfD = useMemo(() => (underlay?.dxf ? dxfPathData(underlay.dxf) : ""), [underlay?.dxf]);
  const segments = useMemo(
    () => [
      ...(underlay?.dxf ? underlaySegments(underlay.dxf) : []),
      ...projectSnapSegments(project),
    ],
    // Seuls le calque, la trémie et les murs portent des accroches.
    [underlay?.dxf, site.opening, site.walls],
  );
  const index = useMemo(
    () => buildSnapIndex(segments, projectSnapPoints(project, draft)),
    [segments, draft, site.opening, site.walls],
  );
  const stair = useMemo(() => stairOverlay(model), [model]);
  const opening = useMemo(() => openingPolygon(site.opening), [site.opening]);

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

  // Molette : écouteur natif non passif (le défilement de la page est empêché).
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

  const reset = (): void => {
    setDraft([]);
    setCalib(null);
  };

  const chooseTool = (t: PlanTool): void => {
    reset();
    setMessage(null);
    setTool(t);
  };

  const closeOpening = (points: readonly Vec2[]): void => {
    const error = commit((p) => withOpeningPolygon(p, points));
    setMessage(
      error
        ? { kind: "error", text: msg("ui.plan.site.opening.refused", { error }) }
        : {
            kind: "info",
            text: msg("ui.plan.site.opening.saved", { count: points.length }),
          },
    );
    setDraft([]);
  };

  const act = (p: Vec2): void => {
    if (tool === "opening") {
      const r = openingClick(draft, p, SNAP_RADIUS_PX * mmPerPx);
      if (r.closed) closeOpening(r.draft);
      else setDraft(r.draft);
    } else if (tool === "wall") {
      const r = wallClick(draft, p, wallMode);
      if (r.kind === "draft") {
        setDraft(r.draft);
        if (r.draft.length === 2) {
          setMessage({ kind: "info", text: msg("ui.plan.site.wall.faceDrawn") });
        }
        return;
      }
      if (r.kind === "ignored") {
        setMessage({ kind: "info", text: msg(r.reason) });
        return;
      }
      const t = Number(wallThickness);
      const error = commit((prj) => withWall(prj, r.a, r.b, t, false, r.reference));
      setMessage(
        error
          ? { kind: "error", text: msg("ui.plan.site.wall.refused", { error }) }
          : { kind: "info", text: msg("ui.plan.site.wall.added") },
      );
      setDraft([]);
    } else if (tool === "calibrate") {
      const img = underlay?.image;
      if (!img) return;
      const px = siteToImagePixel(img, p);
      if (!calib || calib.b) setCalib({ a: px, distance: "" });
      else setCalib({ ...calib, b: px });
    }
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>): void => {
    if (tool === "pan" || e.button === 1) {
      pan.current = { x: e.clientX, y: e.clientY, view: v };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const raw = toSite(e.clientX, e.clientY);
    if (!raw) return;
    const hit = snapOn ? snapPoint(index, raw, SNAP_RADIUS_PX * mmPerPx) : null;
    act(hit?.point ?? raw);
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>): void => {
    const start = pan.current;
    if (start) {
      const k = start.view.width / Math.max(1, size.w);
      setView({
        ...start.view,
        cx: start.view.cx - (e.clientX - start.x) * k,
        cy: start.view.cy + (e.clientY - start.y) * k,
      });
      return;
    }
    const raw = toSite(e.clientX, e.clientY);
    if (!raw) return;
    const snap = snapOn && tool !== "pan" ? snapPoint(index, raw, SNAP_RADIUS_PX * mmPerPx) : null;
    setCursor({ raw, snap });
  };

  const onPointerUp = (): void => {
    pan.current = null;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === "Escape") {
      reset();
    } else if (e.key === "Enter" && tool === "opening" && draft.length >= 3) {
      e.preventDefault();
      closeOpening(draft);
    } else if (e.key === "Backspace" && draft.length > 0) {
      e.preventDefault();
      setDraft(draft.slice(0, -1));
    }
  };

  const applyCalibration = (): void => {
    const img = underlay?.image;
    if (!img || !calib?.b) return;
    const d = Number(calib.distance.replace(",", "."));
    try {
      const next = calibrateImage(img, calib.a, calib.b, d);
      const error = commit((p) => withImageUnderlay(p, next));
      setMessage(
        error
          ? { kind: "error", text: error }
          : { kind: "info", text: msg("ui.plan.site.calibrated") },
      );
      setCalib(null);
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    }
  };

  const target = cursor?.snap?.point ?? cursor?.raw ?? null;
  // Mur au nu, nu tracé : aperçu du mur du côté du pointeur (troisième clic).
  const faceDraft = tool === "wall" && wallMode === "face" && draft.length === 2;
  const faceSide = faceDraft && target ? wallFaceSide(draft[0]!, draft[1]!, target) : null;
  const facePreview =
    faceDraft && faceSide && Number(wallThickness) > 0
      ? faceWallOutline(draft[0]!, draft[1]!, Number(wallThickness), faceSide)
      : null;
  const markerR = 6 * mmPerPx;
  const img = underlay?.image;
  const opacity = underlay?.opacity ?? 1;
  const stairBounds = useMemo(() => siteBounds(project, model, false), [project, model]);

  return (
    <div className="plan-site" onKeyDown={onKeyDown}>
      <div
        className="plan-site__toolbar"
        role="toolbar"
        aria-label={tr.t("ui.plan.site.toolbar.label")}
      >
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tool === t.id}
            title={tr.t(t.title)}
            disabled={t.id === "calibrate" && !img}
            onClick={() => chooseTool(t.id)}
          >
            {tr.t(t.label)}
          </button>
        ))}
        <label className="check">
          <input type="checkbox" checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} />
          {tr.t("ui.plan.site.snap")}
        </label>
        <button type="button" onClick={() => setView(null)} title={tr.t("ui.plan.site.fit.title")}>
          {tr.t("ui.plan.site.fit")}
        </button>
        {tool === "opening" && draft.length >= 3 ? (
          <button type="button" onClick={() => closeOpening(draft)}>
            {tr.t("ui.plan.site.opening.close")}
          </button>
        ) : null}
        {draft.length > 0 || calib ? (
          <button type="button" onClick={reset}>
            {tr.t("ui.plan.site.cancelDraft")}
          </button>
        ) : null}
      </div>
      <div className="plan-site__main">
        <div className="plan-site__canvas" ref={boxRef}>
          <svg
            ref={svgRef}
            className={`plan-site__svg plan-site__svg--${tool}`}
            viewBox={viewBoxAttr(v, aspect)}
            role="img"
            aria-label={tr.t("ui.plan.site.svg.label")}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => setCursor(null)}
          >
            <g transform="scale(1,-1)">
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
              {dxfD ? <DxfLayer d={dxfD} opacity={opacity} /> : null}
              {site.walls.map((w) => (
                <polygon
                  key={w.id}
                  className="plan-site__wall"
                  points={pointsAttr(wallOutline(w))}
                  vectorEffect="non-scaling-stroke"
                >
                  <title>
                    {tr.t("ui.plan.site.wall.title", { id: w.id, thickness: String(w.thickness) })}
                  </title>
                </polygon>
              ))}
              {stair.footprint.length > 0 ? (
                <polygon
                  className="plan-site__stair"
                  points={pointsAttr(stair.footprint)}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
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
              {opening ? (
                <polygon
                  className="plan-site__opening"
                  points={pointsAttr(opening)}
                  vectorEffect="non-scaling-stroke"
                >
                  <title>{tr.t("ui.plan.site.opening")}</title>
                </polygon>
              ) : null}
              {preview ? (
                <polygon
                  className="plan-site__preview"
                  points={pointsAttr(preview)}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {facePreview ? (
                <polygon
                  className="plan-site__wall-preview"
                  points={pointsAttr(facePreview)}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {draft.length > 0 ? (
                <polyline
                  className="plan-site__draft"
                  points={pointsAttr(
                    target && tool !== "pan" && !faceDraft ? [...draft, target] : draft,
                  )}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {draft.map((p, i) => (
                <circle key={i} className="plan-site__vertex" cx={p.x} cy={p.y} r={markerR * 0.6} />
              ))}
              {calib && img
                ? [calib.a, calib.b]
                    .filter((q): q is Vec2 => q !== undefined)
                    .map((q, i) => {
                      const s = imagePixelToSite(img, q);
                      return (
                        <circle
                          key={i}
                          className="plan-site__calib"
                          cx={s.x}
                          cy={s.y}
                          r={markerR}
                          vectorEffect="non-scaling-stroke"
                        />
                      );
                    })
                : null}
              {cursor?.snap ? (
                <rect
                  className={`plan-site__snap plan-site__snap--${cursor.snap.kind}`}
                  x={cursor.snap.point.x - markerR}
                  y={cursor.snap.point.y - markerR}
                  width={2 * markerR}
                  height={2 * markerR}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </g>
          </svg>
          <p className="plan-site__status" aria-live="polite">
            {target
              ? `${cursor?.snap ? tr.t("ui.plan.site.status.snap", { snap: msg(SNAP_LABELS[cursor.snap.kind]) }) : ""}${tr.t("ui.plan.site.status.coords", { x: fmt(target.x, tr.locale), y: fmt(target.y, tr.locale) })}`
              : tr.t("ui.plan.site.status.hover")}
            {tool === "opening" && draft.length > 0
              ? tr.t("ui.plan.site.status.opening", { count: draft.length })
              : ""}
            {faceDraft ? tr.t("ui.plan.site.status.faceSide") : ""}
          </p>
        </div>
        <aside className="plan-site__panel" aria-label={tr.t("ui.plan.site.panel.label")}>
          {message ? (
            <p
              className={`notice ${message.kind === "error" ? "notice--error" : "notice--info"}`}
              role={message.kind === "error" ? "alert" : "status"}
            >
              {typeof message.text === "string" ? message.text : tr.t(message.text)}
            </p>
          ) : null}
          {tool === "calibrate" ? (
            <div className="plan-site__group">
              <p className="muted">
                {tr.t(
                  !calib
                    ? "ui.plan.site.calib.first"
                    : !calib.b
                      ? "ui.plan.site.calib.second"
                      : "ui.plan.site.calib.distance",
                )}
              </p>
              {calib?.b ? (
                <div className="field">
                  <label htmlFor="plan-site-calib">
                    {tr.t("ui.plan.site.calib.distance.label")}
                  </label>
                  <input
                    id="plan-site-calib"
                    type="text"
                    inputMode="decimal"
                    value={calib.distance}
                    onChange={(e) => setCalib({ ...calib, distance: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && applyCalibration()}
                  />
                  <div className="button-row">
                    <button type="button" onClick={applyCalibration}>
                      {tr.t("ui.plan.site.calib.apply")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {tool === "wall" ? (
            <div className="field">
              <label htmlFor="plan-site-wall">{tr.t("ui.plan.site.wall.thickness")}</label>
              <input
                id="plan-site-wall"
                type="text"
                inputMode="numeric"
                value={wallThickness}
                onChange={(e) => setWallThickness(e.target.value)}
              />
              <small className="field__hint">{tr.t("ui.plan.site.wall.thickness.hint")}</small>
              <label htmlFor="plan-site-wall-ref">{tr.t("ui.plan.site.wall.reference")}</label>
              <select
                id="plan-site-wall-ref"
                value={wallMode}
                onChange={(e) => {
                  setWallMode(e.target.value === "face" ? "face" : "axis");
                  setDraft([]);
                }}
              >
                <option value="axis">{tr.t("ui.plan.site.wall.reference.axis")}</option>
                <option value="face">{tr.t("ui.plan.site.wall.reference.face")}</option>
              </select>
              <small className="field__hint">
                {tr.t(
                  wallMode === "axis"
                    ? "ui.plan.site.wall.reference.axis.hint"
                    : "ui.plan.site.wall.reference.face.hint",
                )}
              </small>
            </div>
          ) : null}
          <UnderlayImport stairBounds={stairBounds} />
          <PlanSurveyForm onPreview={setPreview} />
          <details className="plan-site__group">
            <summary>{tr.t("ui.plan.site.walls", { count: site.walls.length })}</summary>
            {site.walls.length === 0 ? (
              <p className="muted">{tr.t("ui.plan.site.walls.none")}</p>
            ) : null}
            <ul className="plan-site__walls">
              {site.walls.map((w) => (
                <li key={w.id}>
                  <span>
                    {tr.t("ui.plan.site.walls.item", {
                      id: w.id,
                      length: fmt(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y), tr.locale),
                      thickness: String(w.thickness),
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={() => commit((p) => withoutWall(p, w.id))}
                    aria-label={tr.t("ui.plan.site.walls.delete.label", { id: w.id })}
                  >
                    {tr.t("ui.plan.site.walls.delete")}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </aside>
      </div>
    </div>
  );
}
