/**
 * Éditeur de plan (ADR-0010, sous-lot 4a ; ancien `PlanSiteEditor` du jalon 7), en calques :
 * fond calibré (`UnderlayLayer`), site (`SiteLayer` : murs, trémie, contour de pièce,
 * obstacles), escalier (`StairLayer` : emprise, tronçons, jonctions, nez, Γ, lus dans le
 * `Model`), conflits d'adéquation au site (`ConflictLayer`, `Model.siteFit`), poignées
 * (`HandleLayer`, sous-lot 4b : poignées de la sélection), puis le tracé en cours et l'accroche.
 *
 * Outils (`uiStore.planTool`) : Sélectionner (défaut : clic sur un élément pour le sélectionner,
 * clic dans le vide ou Échap pour désélectionner, glisser, sur un élément comme dans le vide,
 * pour déplacer la vue ; l'escalier se prend par son contour ;
 * Tab parcourt les éléments, Entrée ou Espace sélectionne), Déplacer (glisser pour déplacer la
 * vue, molette pour zoomer), Trémie (clic par sommet, clic sur le premier sommet ou Entrée pour
 * fermer), Mur (deux clics : axe du mur ; au nu, deux clics sur le nu puis un troisième du côté
 * du mur, QUESTIONS A24), Calibrer (deux points de l'image puis la distance réelle). Échap
 * abandonne le tracé, Retour arrière retire le dernier sommet. Chaque tracé terminé est une
 * entrée d'historique (annulable) ; la sélection, état d'interface seul, n'en crée pas.
 * Les commandes − / + / Recadrer de la vue centrale zooment autour du centre de la vue ou
 * reviennent au cadrage initial. Contour de pièce et obstacles se saisiront au lot 5.
 *
 * Poignées (sous-lot 4b, `HandleLayer`, `usePlanDrag`) : l'escalier sélectionné se déplace en
 * glissant son emprise (tronçon, jonction ou contour ; un clic sans glisser sélectionne toujours
 * l'élément) ou sa poignée centrale, et pivote par sa poignée décalée ou R / Maj+R (±15°, sens
 * trigonométrique vu de dessus) ; un tronçon ou une jonction sélectionnés montrent leurs
 * poignées. Un glisser = une entrée d'historique ; Échap pendant le glisser l'annule.
 */
import {
  buildSnapIndex,
  calibrateImage,
  imagePixelToSite,
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
import { errorMessage, msg, type Locale, type Message, type MessageKey } from "@blondel/i18n";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { UnderlayImport } from "../../components/UnderlayImport.js";
import { formatNumber } from "../../i18n/locale.js";
import { useT } from "../../i18n/useT.js";
import { rotateStairBy } from "../../lib/planDrag.js";
import { ROTATE_KEY_STEP_DEG } from "../../lib/planErgonomics.js";
import { appStore, useApp, useModel } from "../../store/appStore.js";
import {
  PLAN_TOOL_AVAILABLE,
  type PlanEditorTool,
  type PlanSelection,
} from "../../store/planEditor.js";
import {
  clearPlanSelection,
  prunePlanElement,
  selectPlanElement,
  setPlanTool,
  useUi,
  useViewCommand,
} from "../../store/uiStore.js";
import "../planSite.css";
import { PlanSurveyForm } from "../PlanSurveyForm.js";
import {
  DEFAULT_WALL_THICKNESS_MM,
  faceWallOutline,
  fitView,
  openingClick,
  pointsAttr,
  projectSnapPoints,
  projectSnapSegments,
  screenToSite,
  siteBounds,
  SNAP_LABELS,
  viewBoxAttr,
  wallClick,
  wallFaceSide,
  zoomAt,
  type ViewBox,
  type WallTraceMode,
} from "../planSiteGeometry.js";
import { ConflictLayer } from "./ConflictLayer.js";
import { HandleLayer, snapMessage } from "./HandleLayer.js";
import { parsePlanSelection, planSelectionKey } from "./planEditorGeometry.js";
import { selectionLabel, type SelectContext } from "./selectable.js";
import { SiteLayer } from "./SiteLayer.js";
import { StairLayer } from "./StairLayer.js";
import { UnderlayLayer } from "./UnderlayLayer.js";
import { usePlanDrag } from "./usePlanDrag.js";

/** Rayon d'accroche à l'écran (pixels). */
const SNAP_RADIUS_PX = 12;

/** Déplacement (pixels) au-delà duquel un appui est un glisser de la vue, pas un clic. */
const CLICK_SLOP_PX = 3;

const TOOLS: readonly { id: PlanEditorTool; label: MessageKey; title: MessageKey }[] = [
  { id: "select", label: "ui.plan.editor.tool.select", title: "ui.plan.editor.tool.select.title" },
  { id: "pan", label: "ui.plan.site.tool.pan", title: "ui.plan.site.tool.pan.title" },
  { id: "opening", label: "ui.plan.site.tool.opening", title: "ui.plan.site.tool.opening.title" },
  { id: "wall", label: "ui.plan.site.tool.wall", title: "ui.plan.site.tool.wall.title" },
  {
    id: "calibrate",
    label: "ui.plan.site.tool.calibrate",
    title: "ui.plan.site.tool.calibrate.title",
  },
];

/**
 * Texte d'une remarque : message traduit au rendu (motif de refus, exception rendue par
 * `errorMessage`), qui suit un changement de langue.
 */
type Note = Message;

const fmt = (v: number, locale: Locale): string => formatNumber(locale, Math.round(v));

function commit(recipe: (p: Project) => Project): Note | null {
  const r = appStore.getState().update(recipe);
  appStore.getState().endGroup();
  return r.ok ? null : (r.issues[0] ?? msg("ui.plan.site.refused"));
}

/** Élément sélectionnable sous la cible d'un événement (attribut `data-plan-select`). */
function selectionTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  return parsePlanSelection(target.closest("[data-plan-select]")?.getAttribute("data-plan-select"));
}

export function PlanEditor({ model }: { model: Model }) {
  const tr = useT();
  const project = useApp((s) => s.project);
  const site = project.site;
  const underlay = site.underlay;
  const tool = useUi((s) => s.planTool);
  const selection = useUi((s) => s.planSelection);
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
  /**
   * Glisser de la vue. `pick` : appui de l'outil de sélection, résolu au relâché s'il n'a pas
   * bougé (clic) : l'élément sous l'appui est sélectionné, ou la sélection effacée (`null`, vide).
   */
  const pan = useRef<{
    x: number;
    y: number;
    view: ViewBox;
    pick: { readonly hit: PlanSelection | null } | null;
    moved: boolean;
    /** Appui sur l'emprise de l'escalier sélectionné : un glisser le déplace (sinon la vue). */
    moveStair?: Vec2;
    /** Le glisser est devenu un geste de l'escalier : plus de déplacement de la vue. */
    gesture?: boolean;
  } | null>(null);
  const modelProject = useModel().project;

  const aspect = size.w / Math.max(1, size.h);
  const fitted = useMemo(
    () => fitView(siteBounds(project, model), aspect),
    [project, model, aspect],
  );
  const v = view ?? fitted;
  const mmPerPx = v.width / Math.max(1, size.w);
  // Cadrage figé pendant un geste : le cadrage automatique suit l'emprise de l'escalier, il
  // déplacerait le repère de l'écran sous le pointeur à chaque pas.
  const drag = usePlanDrag(model, modelProject, mmPerPx, () => setView((cur) => cur ?? v));

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

  // Sélection effacée si son élément disparaît (annulation, suppression ; un projet chargé remet
  // l'éditeur à zéro, `linkPlanEditorToProject`).
  useEffect(() => {
    prunePlanElement(project, model);
  }, [project, model]);

  // Calibrer sans image (image retirée, annulation) : retour à l'outil de sélection, plutôt
  // qu'un bouton enfoncé mais désactivé et des clics sans effet.
  useEffect(() => {
    if (tool === "calibrate" && !underlay?.image) setPlanTool("select");
  }, [tool, underlay?.image]);

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

  // − / + : zoom au centre de la vue ; Recadrer : retour au cadrage sur le site et l'escalier.
  useViewCommand((kind) => {
    if (kind === "fit") setView(null);
    else setView(zoomAt(v, { x: v.cx, y: v.cy }, kind === "zoomIn" ? 1.25 : 1 / 1.25));
  });

  const reset = (): void => {
    setDraft([]);
    setCalib(null);
  };

  const chooseTool = (t: PlanEditorTool): void => {
    reset();
    setMessage(null);
    setPlanTool(t);
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

  const startPan = (
    e: PointerEvent<SVGSVGElement>,
    pick: { readonly hit: PlanSelection | null } | null,
  ): void => {
    pan.current = { x: e.clientX, y: e.clientY, view: v, pick, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>): void => {
    if (tool === "pan" || e.button === 1) {
      startPan(e, null);
      return;
    }
    if (e.button !== 0) return;
    if (tool === "select") {
      // Sélection au relâché (clic) ; un glisser déplace la vue, même commencé sur un élément,
      // sauf sur l'emprise de l'escalier sélectionné, qui se déplace alors.
      const hit = selectionTarget(e.target);
      startPan(e, { hit });
      const onStair =
        selection?.kind === "stair" &&
        (hit?.kind === "stair" || hit?.kind === "section" || hit?.kind === "junction");
      const at = onStair ? toSite(e.clientX, e.clientY) : null;
      if (pan.current && at) pan.current.moveStair = at;
      return;
    }
    const raw = toSite(e.clientX, e.clientY);
    if (!raw) return;
    const hit = snapOn ? snapPoint(index, raw, SNAP_RADIUS_PX * mmPerPx) : null;
    act(hit?.point ?? raw);
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>): void => {
    if (drag.isActive()) {
      const p = toSite(e.clientX, e.clientY);
      if (p) drag.move(p, e.shiftKey);
      return;
    }
    const start = pan.current;
    if (start) {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!start.moved && Math.hypot(dx, dy) < CLICK_SLOP_PX) return;
      start.moved = true;
      if (start.moveStair) {
        // Glisser de l'emprise de l'escalier sélectionné : geste de déplacement (modèle à jour
        // requis ; sinon, déplacement de la vue).
        const grab = start.moveStair;
        start.moveStair = undefined;
        const p = toSite(e.clientX, e.clientY);
        if (p && drag.begin({ kind: "move" }, grab, grab)) {
          start.gesture = true;
          drag.move(p, e.shiftKey);
          return;
        }
      }
      // Geste de l'escalier annulé (Échap) avant le relâchement : la vue ne bouge pas.
      if (start.gesture) return;
      const k = start.view.width / Math.max(1, size.w);
      setView({ ...start.view, cx: start.view.cx - dx * k, cy: start.view.cy + dy * k });
      return;
    }
    const raw = toSite(e.clientX, e.clientY);
    if (!raw) return;
    const snap =
      snapOn && tool !== "pan" && tool !== "select"
        ? snapPoint(index, raw, SNAP_RADIUS_PX * mmPerPx)
        : null;
    setCursor({ raw, snap });
  };

  const onPointerUp = (): void => {
    const start = pan.current;
    pan.current = null;
    if (drag.end()) return;
    // Clic (sans glisser) de l'outil de sélection : l'élément, ou désélection dans le vide.
    if (!start?.pick || start.moved) return;
    if (start.pick.hit) selectPlanElement(start.pick.hit);
    else clearPlanSelection();
  };

  // Pointeur perdu (geste système, capture retirée) : le geste en cours est annulé.
  const onPointerCancel = (): void => {
    pan.current = null;
    drag.cancel();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === "Escape") {
      // Échap consommé (tracé abandonné, sélection effacée) : il ne ferme pas aussi le panneau
      // libre ; sans rien à abandonner, il suit la chaîne d'Échap de l'application.
      if (draft.length > 0 || calib !== null) {
        e.preventDefault();
        reset();
      } else if (clearPlanSelection()) {
        e.preventDefault();
      }
    } else if (
      (e.key === "r" || e.key === "R") &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      tool === "select" &&
      selection?.kind === "stair" &&
      modelProject
    ) {
      // R / Maj+R : rotation de ±15° (sens trigonométrique vu de dessus) autour du centre.
      e.preventDefault();
      // Pendant un glisser, ignoré : l'entrée serait hors du groupe du geste, que chaque pas
      // reprend depuis le projet de son début.
      if (drag.isActive()) return;
      const delta = e.shiftKey ? -ROTATE_KEY_STEP_DEG : ROTATE_KEY_STEP_DEG;
      const r = rotateStairBy(appStore.getState().project, model, modelProject, delta);
      const next = r.project;
      const error = r.error ?? (next ? commit(() => next) : null);
      drag.setNotice(
        error ? { kind: "error", text: msg("ui.plan.editor.handle.refused", { error }) } : null,
      );
    } else if ((e.key === "Enter" || e.key === " ") && tool === "select") {
      const hit = selectionTarget(e.target);
      if (hit) {
        e.preventDefault();
        selectPlanElement(hit);
      }
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
      setMessage({ kind: "error", text: errorMessage(err) });
    }
  };

  const drawing = tool !== "pan" && tool !== "select";
  const target = drawing ? (cursor?.snap?.point ?? cursor?.raw ?? null) : (cursor?.raw ?? null);
  // Mur au nu, nu tracé : aperçu du mur du côté du pointeur (troisième clic).
  const faceDraft = tool === "wall" && wallMode === "face" && draft.length === 2;
  const faceSide = faceDraft && target ? wallFaceSide(draft[0]!, draft[1]!, target) : null;
  const facePreview =
    faceDraft && faceSide && Number(wallThickness) > 0
      ? faceWallOutline(draft[0]!, draft[1]!, Number(wallThickness), faceSide)
      : null;
  const markerR = 6 * mmPerPx;
  const img = underlay?.image;
  const stairBounds = useMemo(() => siteBounds(project, model, false), [project, model]);
  const ctx: SelectContext = useMemo(
    () => ({
      interactive: tool === "select",
      selectedKey: selection ? planSelectionKey(selection) : null,
      tr,
    }),
    [tool, selection, tr],
  );

  return (
    <div className="plan-site plan-editor" onKeyDown={onKeyDown}>
      <div
        className="plan-site__toolbar"
        role="toolbar"
        aria-label={tr.t("ui.plan.site.toolbar.label")}
      >
        {TOOLS.filter((t) => PLAN_TOOL_AVAILABLE[t.id]).map((t) => (
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
            role="group"
            aria-label={tr.t("ui.plan.site.svg.label")}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onLostPointerCapture={onPointerCancel}
            onPointerLeave={() => setCursor(null)}
          >
            <g transform="scale(1,-1)">
              <UnderlayLayer underlay={underlay} />
              <StairLayer model={model} ctx={ctx} />
              <SiteLayer site={site} ctx={ctx} markerR={markerR} />
              <ConflictLayer conflicts={model.siteFit} />
              <HandleLayer
                model={model}
                layoutProject={modelProject}
                project={project}
                selection={selection}
                active={tool === "select"}
                mmPerPx={mmPerPx}
                drag={drag}
                toSite={toSite}
              />
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
                  points={pointsAttr(target && drawing && !faceDraft ? [...draft, target] : draft)}
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
          {tool === "select" ? (
            <p className="plan-editor__selection muted" data-testid="plan-selection">
              {selection
                ? tr.t("ui.plan.editor.selection", { label: selectionLabel(selection, tr) })
                : tr.t("ui.plan.editor.selection.none")}
            </p>
          ) : null}
          <p className="plan-editor__drag-status" aria-live="polite" data-testid="plan-drag-status">
            {drag.notice?.kind === "snap"
              ? tr.t(snapMessage(drag.notice.snap, (n) => fmt(n, tr.locale)))
              : drag.notice?.kind === "info"
                ? tr.t(drag.notice.text)
                : ""}
          </p>
          {drag.notice?.kind === "error" ? (
            <p className="notice notice--error" role="alert">
              {tr.t(drag.notice.text)}
            </p>
          ) : null}
          {tool === "select" &&
          (selection?.kind === "stair" ||
            selection?.kind === "section" ||
            selection?.kind === "junction") ? (
            <p className="muted plan-editor__handle-hint">{tr.t("ui.plan.editor.handle.hint")}</p>
          ) : null}
          {message ? (
            <p
              className={`notice ${message.kind === "error" ? "notice--error" : "notice--info"}`}
              role={message.kind === "error" ? "alert" : "status"}
            >
              {tr.t(message.text)}
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
                  {/* Unité à droite du champ, jamais dans le libellé (libellés unifiés). */}
                  <span className="input-unit">
                    <input
                      id="plan-site-calib"
                      type="text"
                      inputMode="decimal"
                      value={calib.distance}
                      onChange={(e) => setCalib({ ...calib, distance: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && applyCalibration()}
                    />
                    <span className="input-unit__unit" aria-hidden="true">
                      mm
                    </span>
                  </span>
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
              <span className="input-unit">
                <input
                  id="plan-site-wall"
                  type="text"
                  inputMode="numeric"
                  value={wallThickness}
                  onChange={(e) => setWallThickness(e.target.value)}
                />
                <span className="input-unit__unit" aria-hidden="true">
                  mm
                </span>
              </span>
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
