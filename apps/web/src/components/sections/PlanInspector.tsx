/**
 * Inspecteur de l'éditeur de plan (ADR-0010, sous-lot 4d), contextuel à la sélection
 * (`uiStore.planSelection`) :
 *
 * - escalier : origine (x, y) et rotation (`withPlacement`) ; « Convertir en tracé libre »
 *   (`convertToCage`) sur un tracé à volées ; « Reconvertir en volées » sur une cage quand le
 *   cœur la propose (`suggestFixes`, `cage-to-flights`) ;
 * - tronçon : axe (droit : partie droite ou « auto » ; en arc : rayon, balayage), largeurs de
 *   départ et d'arrivée, bord d'ancrage ; actions couper, insérer un palier, insérer un tronçon
 *   après, supprimer (`splitSection`, `insertLanding`, `insertSection`, `removeSection`) ;
 * - jonction : angle signé, mode, profondeur d'un palier droit, raccords côté jour et côté mur ;
 * - mur (sous-lot 5a) : épaisseur, caractère porteur, extrémités (x, y en mm entiers,
 *   `moveWallEnd`) ; actions couper au milieu (`splitWall`) et supprimer (`removeWall`) ;
 * - trémie : sommets (x, y, `moveOpeningVertex` ; résumé pour une trémie ronde ou dense) ;
 *   sommet : ses coordonnées, actions insérer un sommet après (`insertOpeningVertex`) et
 *   supprimer (`removeOpeningVertex`) ;
 * - contour de pièce (sous-lot 5b) : sommets (x, y, `moveRoomVertex`), action supprimer le
 *   contour (`withRoom`) ; sommet du contour : ses coordonnées, actions insérer un sommet après
 *   (`insertRoomVertex`) et supprimer (`removeRoomVertex`, refus sous 3 sommets) ;
 * - obstacle : champs propres à son type (`updateObstacle`) : poteau (centre, côtés, rotation),
 *   poteau rond (centre, rayon), porte (extrémités de la baie, gonds, sens d'ouverture), fenêtre
 *   (extrémités, allège, linteau), zone interdite (sommets, `moveZoneVertex`) ; action supprimer
 *   (`withoutObstacle`).
 *
 * Aucun calcul : chaque champ appelle un mutateur pur du cœur par `commitEdit`
 * (`lib/planInspector.ts`), une validation = une entrée d'historique ; un refus s'affiche sous le
 * champ sans modifier le projet. Valeurs lues dans la cage éditée (`editableCage` : tracé libre,
 * ou équivalent d'un tracé à volées) : sur un tracé à volées, une modification qui ne s'écrit
 * plus en volées le convertit en tracé libre, remarque annoncée (`aria-live`).
 */
import {
  axisSeed,
  convertToCage,
  insertLanding,
  insertSection,
  moveRoomVertex,
  moveWallEnd,
  moveZoneVertex,
  openingVertices,
  setJunctionAngle,
  setJunctionDepth,
  setJunctionMode,
  setSectionAxis,
  setSectionLength,
  setSectionWidth,
  setWallJoint,
  setWallLoadBearing,
  setWallThickness,
  setWellJoint,
  splitSection,
  withPlacement,
  type CageAxis,
  type CageJunction,
  type CageSection,
  type EditResult,
  type Obstacle,
  type Project,
  type WallJoint,
  type WellJoint,
} from "@blondel/core";
import { msg, type Message, type MessageKey } from "@blondel/i18n";
import { useMemo, useState } from "react";
import { useT } from "../../i18n/useT.js";
import { autoValueOf } from "../../lib/autoValues.js";
import { openingVerticesEditable } from "../../lib/planDrag.js";
import { applyFixInStore, fixesFor } from "../../lib/fixes.js";
import {
  commitEdit,
  inspectedJunction,
  inspectedSection,
  insertOpeningVertexInStore,
  isFlightsLayout,
  newSectionAfter,
  removeOpeningVertexInStore,
  removeSectionInStore,
  removeWallInStore,
  insertRoomVertexInStore,
  obstaclePatch,
  removeObstacleInStore,
  removeRoomInStore,
  removeRoomVertexInStore,
  splitWallInStore,
  trackedVertexMove,
  type SiteActionOutcome,
  wallJointOfKind,
  type PlanNote,
  wellJointOfKind,
} from "../../lib/planInspector.js";
import { appStore, useApp, useModel } from "../../store/appStore.js";
import type { PlanSelection } from "../../store/planEditor.js";
import type { UpdateResult } from "../../store/projectStore.js";
import { clearPlanSelection, selectPlanElement } from "../../store/uiStore.js";
import { AutoIntField, CheckField, IntField, SelectField } from "../fields.js";
import "./sections.css";

/** Remarque de l'inspecteur : annonce (passage en tracé libre) ou refus d'une action. */
type Remark = PlanNote | null;
type SetRemark = (r: Remark) => void;

/**
 * Champ : mutateur appliqué au projet du store ; une validation acceptée remplace la remarque
 * (passage en tracé libre, ou rien), un refus reste sous le champ.
 */
function fieldCommit(setRemark: SetRemark, edit: (p: Project) => EditResult): UpdateResult {
  const o = commitEdit(edit);
  if (o.result.ok) setRemark(o.remark ? { kind: "info", text: o.remark } : null);
  return o.result;
}

/** Action (bouton) : refus affiché sous les actions, remarque sinon. */
function actionCommit(
  setRemark: SetRemark,
  edit: (p: Project) => EditResult,
  converted?: Message,
): boolean {
  const o = commitEdit(edit, converted);
  if (!o.result.ok) {
    const error = o.result.issues[0] ?? msg("ui.plan.site.refused");
    setRemark({ kind: "error", text: msg("ui.plan.inspector.refused", { error }) });
    return false;
  }
  setRemark(o.remark ? { kind: "info", text: o.remark } : null);
  return true;
}

/**
 * « Convertir en tracé libre » (tracé à volées seulement) : une entrée d'historique, remarque
 * annoncée ; aussi dans la section Tracé. Dans l'inspecteur, la remarque rejoint la sienne (une
 * seule zone annoncée) ; dans la section Tracé, le bouton disparaît avec la conversion (le
 * résumé de la cage le remplace) : la remarque passe par la notification du store, qui survit.
 */
export function ConvertToCageButton({ onRemark }: { readonly onRemark?: SetRemark }) {
  const t = useT();
  const flights = useApp((s) => isFlightsLayout(s.project));
  const report: SetRemark =
    onRemark ??
    ((r) => {
      if (r !== null) appStore.setState({ notice: { kind: r.kind, msg: r.text } });
    });
  if (!flights) return null;
  return (
    <div className="plan-inspector__convert button-row">
      <button
        type="button"
        title={t.t("ui.plan.inspector.convertToCage.hint")}
        onClick={() => actionCommit(report, convertToCage, msg("ui.plan.inspector.converted"))}
      >
        {t.t("ui.plan.inspector.convertToCage")}
      </button>
    </div>
  );
}

function RemarkLine({ remark }: { remark: Remark }) {
  const t = useT();
  return (
    <>
      <p
        className="muted plan-inspector__remark"
        aria-live="polite"
        data-testid="plan-inspector-remark"
      >
        {remark?.kind === "info" ? t.t(remark.text) : ""}
      </p>
      {remark?.kind === "error" ? (
        <p className="notice notice--error" role="alert">
          {t.t(remark.text)}
        </p>
      ) : null}
    </>
  );
}

/** « Reconvertir en volées » quand le cœur la propose (cage à structure non générée). */
function ReconvertFix() {
  const t = useT();
  const project = useApp((s) => s.project);
  const { model, project: modelProject } = useModel();
  const fix = useMemo(
    () =>
      modelProject === project
        ? (fixesFor(project, model).find((f) => f.id === "cage-to-flights") ?? null)
        : null,
    [project, model, modelProject],
  );
  if (fix === null) return null;
  return (
    <div className="button-row">
      <button type="button" onClick={() => applyFixInStore(fix)}>
        {t.t(fix.label)}
      </button>
      <p className="muted">{t.t("ui.params.cage.reconvert.reason", { reason: fix.reason })}</p>
    </div>
  );
}

function StairInspector({ setRemark }: { setRemark: SetRemark }) {
  const t = useT();
  const placement = useApp((s) => s.project.stair.placement);
  const cage = useApp((s) => s.project.stair.layout.kind === "cage");
  const commit = (edit: (p: Project) => EditResult) => fieldCommit(setRemark, edit);
  return (
    <fieldset className="plan-inspector__group">
      <legend>{t.t("ui.plan.editor.select.stair")}</legend>
      <IntField
        label={t.t("ui.plan.inspector.stair.x")}
        value={placement.origin.x}
        onCommit={(x) =>
          commit((p) => withPlacement(p, { origin: { ...p.stair.placement.origin, x } }))
        }
      />
      <IntField
        label={t.t("ui.plan.inspector.stair.y")}
        value={placement.origin.y}
        onCommit={(y) =>
          commit((p) => withPlacement(p, { origin: { ...p.stair.placement.origin, y } }))
        }
      />
      <IntField
        label={t.t("ui.plan.inspector.stair.rotation")}
        value={placement.rotation}
        unit="°"
        hint={t.t("ui.plan.inspector.stair.hint")}
        onCommit={(rotation) => commit((p) => withPlacement(p, { rotation }))}
      />
      <ConvertToCageButton onRemark={setRemark} />
      {cage ? <ReconvertFix /> : null}
    </fieldset>
  );
}

const ANCHORS = [
  { value: "left", key: "ui.plan.inspector.section.anchor.left" },
  { value: "center", key: "ui.plan.inspector.section.anchor.center" },
  { value: "right", key: "ui.plan.inspector.section.anchor.right" },
] as const satisfies readonly { value: NonNullable<CageSection["anchor"]>; key: MessageKey }[];

function SectionInspector({
  index,
  setRemark,
  onNote,
}: {
  index: number;
  setRemark: SetRemark;
  onNote: (note: PlanNote | null) => void;
}) {
  const t = useT();
  const project = useApp((s) => s.project);
  const { model } = useModel();
  const found = useMemo(() => inspectedSection(project, index), [project, index]);
  if (found === null) return <p className="muted">{t.t("ui.plan.inspector.none")}</p>;
  const { section, count } = found;
  const axis = section.axis;
  const commit = (edit: (p: Project) => EditResult) => fieldCommit(setRemark, edit);
  const act = (edit: (p: Project) => EditResult) => actionCommit(setRemark, edit);
  const autoPath =
    project.stair.layout.kind === "cage"
      ? ["stair", "layout", "sections", index, "axis", "length"]
      : ["stair", "layout", "legs", index, "length"];
  return (
    <fieldset className="plan-inspector__group">
      <legend>{t.t("ui.plan.inspector.section.legend", { index: index + 1 })}</legend>
      <SelectField<CageAxis["kind"]>
        label={t.t("ui.plan.inspector.section.axis")}
        value={axis.kind}
        options={[
          { value: "straight", label: t.t("ui.plan.inspector.section.axis.straight") },
          { value: "arc", label: t.t("ui.plan.inspector.section.axis.arc") },
        ]}
        onCommit={(kind) => commit((p) => setSectionAxis(p, index, axisSeed(kind, section)))}
      />
      {axis.kind === "straight" ? (
        axis.length === "auto" || count === 1 ? (
          <AutoIntField
            label={t.t("ui.plan.inspector.section.length")}
            value={axis.length}
            computed={autoValueOf(model, autoPath)}
            fallback={section.width}
            autoAllowed={count === 1}
            autoHint={t.t("ui.plan.inspector.section.length.autoHint")}
            hint={t.t("ui.plan.inspector.section.length.hint")}
            min={0}
            onCommit={(length) => commit((p) => setSectionLength(p, index, length))}
          />
        ) : (
          <IntField
            label={t.t("ui.plan.inspector.section.length")}
            value={axis.length}
            min={0}
            hint={t.t("ui.plan.inspector.section.length.hint")}
            onCommit={(length) => commit((p) => setSectionLength(p, index, length))}
          />
        )
      ) : (
        <>
          <IntField
            label={t.t("ui.plan.inspector.section.radius")}
            value={axis.radius}
            min={1}
            onCommit={(radius) =>
              commit((p) => setSectionAxis(p, index, { kind: "arc", radius, sweep: axis.sweep }))
            }
          />
          <IntField
            label={t.t("ui.plan.inspector.section.sweep")}
            value={axis.sweep}
            unit="°"
            hint={t.t("ui.plan.inspector.section.sweep.hint")}
            onCommit={(sweep) =>
              commit((p) => setSectionAxis(p, index, { kind: "arc", radius: axis.radius, sweep }))
            }
          />
        </>
      )}
      <IntField
        label={t.t("ui.plan.inspector.section.width")}
        value={section.width}
        min={1}
        onCommit={(width) => commit((p) => setSectionWidth(p, index, { width }))}
      />
      {axis.kind === "straight" ? (
        <IntField
          label={t.t("ui.plan.inspector.section.widthEnd")}
          value={section.widthEnd ?? section.width}
          min={1}
          hint={t.t("ui.plan.inspector.section.widthEnd.hint")}
          onCommit={(widthEnd) => commit((p) => setSectionWidth(p, index, { widthEnd }))}
        />
      ) : null}
      <SelectField<NonNullable<CageSection["anchor"]>>
        label={t.t("ui.plan.inspector.section.anchor")}
        value={section.anchor ?? "center"}
        options={ANCHORS.map((a) => ({ value: a.value, label: t.t(a.key) }))}
        hint={t.t("ui.plan.inspector.section.anchor.hint")}
        onCommit={(anchor) =>
          commit((p) => setSectionWidth(p, index, { anchor: anchor === "center" ? null : anchor }))
        }
      />
      <div
        className="button-row plan-inspector__actions"
        role="group"
        aria-label={t.t("ui.plan.inspector.section.actions", { index: index + 1 })}
      >
        <button
          type="button"
          title={t.t("ui.plan.inspector.section.split.title")}
          onClick={() => act((p) => splitSection(p, index))}
        >
          {t.t("ui.plan.inspector.section.split")}
        </button>
        <button
          type="button"
          title={t.t("ui.plan.inspector.section.insertLanding.title")}
          onClick={() => act((p) => insertLanding(p, index))}
        >
          {t.t("ui.plan.inspector.section.insertLanding")}
        </button>
        <button
          type="button"
          title={t.t("ui.plan.inspector.section.insertAfter.title")}
          onClick={() => act((p) => insertSection(p, index + 1, newSectionAfter(section)))}
        >
          {t.t("ui.plan.inspector.section.insertAfter")}
        </button>
        <button
          type="button"
          title={t.t("ui.plan.inspector.section.remove.title")}
          onClick={() => {
            // Même chemin que Suppr : l'inspecteur se démonte, la note passe par l'éditeur.
            const o = removeSectionInStore(index);
            if (!o.removed) {
              setRemark(o.note);
              return;
            }
            clearPlanSelection();
            onNote(o.note);
          }}
        >
          {t.t("ui.plan.inspector.section.remove")}
        </button>
      </div>
    </fieldset>
  );
}

const MODES = [
  { value: "winders", key: "ui.plan.inspector.junction.mode.winders" },
  { value: "landing", key: "ui.plan.inspector.junction.mode.landing" },
  { value: "radiating", key: "ui.plan.inspector.junction.mode.radiating" },
] as const satisfies readonly { value: CageJunction["mode"]; key: MessageKey }[];

const WELLS = [
  { value: "sharp", key: "ui.plan.inspector.junction.well.sharp" },
  { value: "arc", key: "ui.plan.inspector.junction.well.arc" },
  { value: "newel", key: "ui.plan.inspector.junction.well.newel" },
  { value: "chamfer", key: "ui.plan.inspector.junction.well.chamfer" },
] as const satisfies readonly { value: WellJoint["kind"]; key: MessageKey }[];

const WALLS = [
  { value: "sharp", key: "ui.plan.inspector.junction.wall.sharp" },
  { value: "arc", key: "ui.plan.inspector.junction.wall.arc" },
] as const satisfies readonly { value: WallJoint["kind"]; key: MessageKey }[];

function JunctionInspector({ index, setRemark }: { index: number; setRemark: SetRemark }) {
  const t = useT();
  const project = useApp((s) => s.project);
  const found = useMemo(() => inspectedJunction(project, index), [project, index]);
  if (found === null) return <p className="muted">{t.t("ui.plan.inspector.none")}</p>;
  const { junction: jn, before } = found;
  const well = jn.well;
  const wall = jn.wall;
  const commit = (edit: (p: Project) => EditResult) => fieldCommit(setRemark, edit);
  const setWell = (next: WellJoint) => commit((p) => setWellJoint(p, index, next));
  const setWall = (next: WallJoint) => commit((p) => setWallJoint(p, index, next));
  return (
    <fieldset className="plan-inspector__group">
      <legend>{t.t("ui.plan.inspector.junction.legend", { index: index + 1 })}</legend>
      <IntField
        label={t.t("ui.plan.inspector.junction.angle")}
        value={jn.angle}
        unit="°"
        hint={t.t("ui.plan.inspector.junction.angle.hint")}
        onCommit={(angle) => commit((p) => setJunctionAngle(p, index, angle))}
      />
      <SelectField<CageJunction["mode"]>
        label={t.t("ui.plan.inspector.junction.mode")}
        value={jn.mode}
        options={MODES.map((m) => ({ value: m.value, label: t.t(m.key) }))}
        onCommit={(mode) => commit((p) => setJunctionMode(p, index, mode))}
      />
      {jn.angle === 0 ? (
        <AutoIntField
          label={t.t("ui.plan.inspector.junction.depth")}
          value={jn.depth ?? "auto"}
          fallback={before.widthEnd ?? before.width}
          hint={t.t("ui.plan.inspector.junction.depth.hint")}
          min={1}
          onCommit={(depth) =>
            commit((p) => setJunctionDepth(p, index, depth === "auto" ? null : depth))
          }
        />
      ) : (
        <>
          <SelectField<WellJoint["kind"]>
            label={t.t("ui.plan.inspector.junction.well")}
            value={well.kind}
            options={WELLS.map((w) => ({ value: w.value, label: t.t(w.key) }))}
            hint={t.t("ui.plan.inspector.joint.seed")}
            onCommit={(kind) => setWell(wellJointOfKind(kind, well))}
          />
          {well.kind === "arc" ? (
            <IntField
              label={t.t("ui.plan.inspector.junction.wellRadius")}
              value={well.radius}
              min={1}
              onCommit={(radius) => setWell({ kind: "arc", radius })}
            />
          ) : null}
          {well.kind === "newel" ? (
            <>
              <IntField
                label={t.t("ui.plan.inspector.junction.newelSize")}
                value={well.size}
                min={1}
                onCommit={(size) => setWell({ ...well, size })}
              />
              <IntField
                label={t.t("ui.plan.inspector.junction.newelOffset")}
                value={well.offset ?? 0}
                min={0}
                onCommit={(offset) => setWell({ ...well, offset })}
              />
            </>
          ) : null}
          {well.kind === "chamfer" ? (
            <>
              <IntField
                label={t.t("ui.plan.inspector.junction.setbackIn")}
                value={well.setbackIn}
                min={1}
                onCommit={(setbackIn) => setWell({ ...well, setbackIn })}
              />
              <IntField
                label={t.t("ui.plan.inspector.junction.setbackOut")}
                value={well.setbackOut}
                min={1}
                onCommit={(setbackOut) => setWell({ ...well, setbackOut })}
              />
            </>
          ) : null}
          <SelectField<WallJoint["kind"]>
            label={t.t("ui.plan.inspector.junction.wall")}
            value={wall.kind}
            options={WALLS.map((w) => ({ value: w.value, label: t.t(w.key) }))}
            onCommit={(kind) => setWall(wallJointOfKind(kind, wall, well))}
          />
          {wall.kind === "arc" ? (
            <IntField
              label={t.t("ui.plan.inspector.junction.wallRadius")}
              value={wall.radius}
              min={1}
              onCommit={(radius) => setWall({ kind: "arc", radius })}
            />
          ) : null}
        </>
      )}
    </fieldset>
  );
}

/**
 * Action du site depuis l'inspecteur (même chemin que Suppr et le double-clic) : refus sous les
 * actions ; sinon sélection suivante et remarque rendue à l'éditeur (l'inspecteur se démonte
 * quand la sélection change).
 */
function siteAction(
  o: SiteActionOutcome,
  setRemark: SetRemark,
  onNote: (note: PlanNote | null) => void,
): void {
  if (!o.done) {
    setRemark(o.note);
    return;
  }
  if (o.selection === null) clearPlanSelection();
  else if (o.selection) selectPlanElement(o.selection);
  onNote(o.note);
}

function WallInspector({
  id,
  setRemark,
  onNote,
}: {
  id: string;
  setRemark: SetRemark;
  onNote: (note: PlanNote | null) => void;
}) {
  const t = useT();
  const wall = useApp((s) => s.project.site.walls.find((w) => w.id === id));
  if (!wall) return null;
  const commit = (edit: (p: Project) => EditResult) => fieldCommit(setRemark, edit);
  const ends = ["a", "b"] as const;
  return (
    <fieldset className="plan-inspector__group">
      <legend>{t.t("ui.plan.inspector.wall.legend", { id })}</legend>
      <IntField
        label={t.t("ui.plan.inspector.wall.thickness")}
        value={wall.thickness}
        min={1}
        hint={t.t("ui.plan.inspector.wall.thickness.hint")}
        onCommit={(thickness) => commit((p) => setWallThickness(p, id, thickness))}
      />
      <CheckField
        label={t.t("ui.plan.inspector.wall.loadBearing")}
        checked={wall.loadBearing}
        onCommit={(loadBearing) => commit((p) => setWallLoadBearing(p, id, loadBearing))}
      />
      {ends.map((end) => {
        const at = wall[end];
        const label = end.toUpperCase();
        return (
          <div key={end} className="plan-inspector__pair">
            <IntField
              label={t.t("ui.plan.inspector.wall.endX", { end: label })}
              value={Math.round(at.x)}
              onCommit={(x) => commit((p) => moveWallEnd(p, id, end, { x, y: at.y }))}
            />
            <IntField
              label={t.t("ui.plan.inspector.wall.endY", { end: label })}
              value={Math.round(at.y)}
              onCommit={(y) => commit((p) => moveWallEnd(p, id, end, { x: at.x, y }))}
            />
          </div>
        );
      })}
      <div
        className="button-row plan-inspector__actions"
        role="group"
        aria-label={t.t("ui.plan.inspector.wall.actions", { id })}
      >
        <button
          type="button"
          title={t.t("ui.plan.inspector.wall.split.title")}
          onClick={() =>
            siteAction(
              splitWallInStore(id, {
                x: (wall.a.x + wall.b.x) / 2,
                y: (wall.a.y + wall.b.y) / 2,
              }),
              setRemark,
              onNote,
            )
          }
        >
          {t.t("ui.plan.inspector.wall.split")}
        </button>
        <button
          type="button"
          title={t.t("ui.plan.inspector.wall.remove.title")}
          onClick={() => siteAction(removeWallInStore(id), setRemark, onNote)}
        >
          {t.t("ui.plan.inspector.wall.remove")}
        </button>
      </div>
    </fieldset>
  );
}

/**
 * Champs x, y d'un sommet de la trémie (`moveOpeningVertex`, mm entiers). `selected` : le sommet
 * est la sélection du plan ; si la forme canonique le réindexe (contour retourné), il reste
 * sélectionné sous son nouvel indice.
 */
function VertexFields({
  index,
  at,
  selected,
  commit,
}: {
  index: number;
  at: { x: number; y: number };
  selected: boolean;
  commit: (edit: (p: Project) => EditResult) => UpdateResult;
}) {
  const t = useT();
  const move = (point: { x: number; y: number }): UpdateResult => {
    const m = trackedVertexMove(index, point);
    const result = commit(m.edit);
    const next = result.ok && selected ? m.reselect() : null;
    if (next) selectPlanElement(next);
    return result;
  };
  return (
    <div className="plan-inspector__pair">
      <IntField
        label={t.t("ui.plan.inspector.opening.vertexX", { index: index + 1 })}
        value={Math.round(at.x)}
        onCommit={(x) => move({ x, y: at.y })}
      />
      <IntField
        label={t.t("ui.plan.inspector.opening.vertexY", { index: index + 1 })}
        value={Math.round(at.y)}
        onCommit={(y) => move({ x: at.x, y })}
      />
    </div>
  );
}

function OpeningInspector({
  vertex,
  setRemark,
  onNote,
}: {
  /** Sommet sélectionné ; `null` : la trémie entière. */
  vertex: number | null;
  setRemark: SetRemark;
  onNote: (note: PlanNote | null) => void;
}) {
  const t = useT();
  const opening = useApp((s) => s.project.site.opening);
  const points = useMemo(() => (opening ? openingVertices(opening) : []), [opening]);
  if (!opening) return null;
  const commit = (edit: (p: Project) => EditResult) => fieldCommit(setRemark, edit);
  if (vertex === null) {
    return (
      <fieldset className="plan-inspector__group">
        <legend>{t.t("ui.plan.inspector.opening.legend")}</legend>
        <p className="muted">{t.t("ui.plan.inspector.opening.hint")}</p>
        {openingVerticesEditable(opening, points.length) ? (
          points.map((at, i) => (
            <VertexFields key={i} index={i} at={at} selected={false} commit={commit} />
          ))
        ) : (
          <p className="muted">
            {t.t("ui.plan.inspector.opening.dense", { count: points.length })}
          </p>
        )}
      </fieldset>
    );
  }
  const at = points[vertex];
  if (!at) return <p className="muted">{t.t("ui.plan.inspector.none")}</p>;
  return (
    <fieldset className="plan-inspector__group">
      <legend>{t.t("ui.plan.inspector.openingVertex.legend", { index: vertex + 1 })}</legend>
      <VertexFields index={vertex} at={at} selected commit={commit} />
      <div
        className="button-row plan-inspector__actions"
        role="group"
        aria-label={t.t("ui.plan.inspector.openingVertex.actions", { index: vertex + 1 })}
      >
        <button
          type="button"
          title={t.t("ui.plan.inspector.openingVertex.insert.title")}
          onClick={() => siteAction(insertOpeningVertexInStore(vertex), setRemark, onNote)}
        >
          {t.t("ui.plan.inspector.openingVertex.insert")}
        </button>
        <button
          type="button"
          title={t.t("ui.plan.inspector.openingVertex.remove.title")}
          onClick={() => siteAction(removeOpeningVertexInStore(vertex), setRemark, onNote)}
        >
          {t.t("ui.plan.inspector.openingVertex.remove")}
        </button>
      </div>
    </fieldset>
  );
}

/** Champs x, y d'un point (mm entiers), libellés `labelX`, `labelY`. */
function PointFields({
  at,
  labelX,
  labelY,
  onCommit,
}: {
  at: { x: number; y: number };
  labelX: string;
  labelY: string;
  onCommit: (point: { x: number; y: number }) => UpdateResult;
}) {
  return (
    <div className="plan-inspector__pair">
      <IntField
        label={labelX}
        value={Math.round(at.x)}
        onCommit={(x) => onCommit({ x, y: at.y })}
      />
      <IntField
        label={labelY}
        value={Math.round(at.y)}
        onCommit={(y) => onCommit({ x: at.x, y })}
      />
    </div>
  );
}

function RoomInspector({
  vertex,
  setRemark,
  onNote,
}: {
  /** Sommet sélectionné ; `null` : le contour entier. */
  vertex: number | null;
  setRemark: SetRemark;
  onNote: (note: PlanNote | null) => void;
}) {
  const t = useT();
  const room = useApp((s) => s.project.site.room);
  if (!room) return null;
  const commit = (edit: (p: Project) => EditResult) => fieldCommit(setRemark, edit);
  const fields = (i: number) => (
    <PointFields
      key={i}
      at={room.points[i]!}
      labelX={t.t("ui.plan.inspector.room.vertexX", { index: i + 1 })}
      labelY={t.t("ui.plan.inspector.room.vertexY", { index: i + 1 })}
      onCommit={(point) => commit((p) => moveRoomVertex(p, i, point))}
    />
  );
  if (vertex === null) {
    return (
      <fieldset className="plan-inspector__group">
        <legend>{t.t("ui.plan.inspector.room.legend")}</legend>
        <p className="muted">{t.t("ui.plan.inspector.room.hint")}</p>
        {room.points.map((_, i) => fields(i))}
        <div
          className="button-row plan-inspector__actions"
          role="group"
          aria-label={t.t("ui.plan.inspector.room.actions")}
        >
          <button
            type="button"
            title={t.t("ui.plan.inspector.room.remove.title")}
            onClick={() => siteAction(removeRoomInStore(), setRemark, onNote)}
          >
            {t.t("ui.plan.inspector.room.remove")}
          </button>
        </div>
      </fieldset>
    );
  }
  if (!room.points[vertex]) return <p className="muted">{t.t("ui.plan.inspector.none")}</p>;
  return (
    <fieldset className="plan-inspector__group">
      <legend>{t.t("ui.plan.inspector.roomVertex.legend", { index: vertex + 1 })}</legend>
      {fields(vertex)}
      <div
        className="button-row plan-inspector__actions"
        role="group"
        aria-label={t.t("ui.plan.inspector.roomVertex.actions", { index: vertex + 1 })}
      >
        <button
          type="button"
          title={t.t("ui.plan.inspector.roomVertex.insert.title")}
          onClick={() => siteAction(insertRoomVertexInStore(vertex), setRemark, onNote)}
        >
          {t.t("ui.plan.inspector.openingVertex.insert")}
        </button>
        <button
          type="button"
          title={t.t("ui.plan.inspector.roomVertex.remove.title")}
          onClick={() => siteAction(removeRoomVertexInStore(vertex), setRemark, onNote)}
        >
          {t.t("ui.plan.inspector.openingVertex.remove")}
        </button>
      </div>
    </fieldset>
  );
}

const OBSTACLE_LEGENDS = {
  post: "ui.plan.inspector.obstacle.legend.post",
  circularPost: "ui.plan.inspector.obstacle.legend.circularPost",
  door: "ui.plan.inspector.obstacle.legend.door",
  window: "ui.plan.inspector.obstacle.legend.window",
  zone: "ui.plan.inspector.obstacle.legend.zone",
} as const satisfies Record<Obstacle["kind"], MessageKey>;

/** Champs propres au type de l'obstacle `o`. */
function ObstacleFields({
  o,
  commit,
}: {
  o: Obstacle;
  commit: (edit: (p: Project) => EditResult) => UpdateResult;
}) {
  const t = useT();
  const id = o.id;
  const patch = (fields: Parameters<typeof obstaclePatch>[1]) => commit(obstaclePatch(id, fields));
  const center = (at: { x: number; y: number }) => (
    <PointFields
      at={at}
      labelX={t.t("ui.plan.inspector.obstacle.centerX")}
      labelY={t.t("ui.plan.inspector.obstacle.centerY")}
      onCommit={(point) => patch({ center: point })}
    />
  );
  const bay = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    (["a", "b"] as const).map((end) => (
      <PointFields
        key={end}
        at={end === "a" ? a : b}
        labelX={t.t("ui.plan.inspector.obstacle.endX", { end: end.toUpperCase() })}
        labelY={t.t("ui.plan.inspector.obstacle.endY", { end: end.toUpperCase() })}
        onCommit={(point) => patch({ [end]: point })}
      />
    ));
  switch (o.kind) {
    case "post":
      return (
        <>
          {center(o.center)}
          <IntField
            label={t.t("ui.plan.inspector.obstacle.sizeX")}
            value={o.sizeX}
            min={1}
            onCommit={(sizeX) => patch({ sizeX })}
          />
          <IntField
            label={t.t("ui.plan.inspector.obstacle.sizeY")}
            value={o.sizeY}
            min={1}
            onCommit={(sizeY) => patch({ sizeY })}
          />
          <IntField
            label={t.t("ui.plan.inspector.obstacle.rotation")}
            value={o.rotation ?? 0}
            unit="°"
            hint={t.t("ui.plan.inspector.obstacle.rotation.hint")}
            onCommit={(rotation) => patch({ rotation })}
          />
        </>
      );
    case "circularPost":
      return (
        <>
          {center(o.center)}
          <IntField
            label={t.t("ui.plan.inspector.obstacle.radius")}
            value={o.radius}
            min={1}
            onCommit={(radius) => patch({ radius })}
          />
        </>
      );
    case "door":
      return (
        <>
          {bay(o.a, o.b)}
          <SelectField<"a" | "b">
            label={t.t("ui.plan.editor.obstacle.hinge")}
            value={o.hinge}
            options={[
              { value: "a", label: t.t("ui.plan.inspector.obstacle.hinge.a") },
              { value: "b", label: t.t("ui.plan.inspector.obstacle.hinge.b") },
            ]}
            onCommit={(hinge) => patch({ hinge })}
          />
          <SelectField<"left" | "right">
            label={t.t("ui.plan.editor.obstacle.swing")}
            value={o.swing}
            options={[
              { value: "left", label: t.t("ui.plan.editor.obstacle.swing.left") },
              { value: "right", label: t.t("ui.plan.editor.obstacle.swing.right") },
            ]}
            hint={t.t("ui.plan.inspector.obstacle.swing.hint")}
            onCommit={(swing) => patch({ swing })}
          />
        </>
      );
    case "window":
      return (
        <>
          {bay(o.a, o.b)}
          <IntField
            label={t.t("ui.plan.editor.obstacle.sill")}
            value={o.sill}
            min={0}
            onCommit={(sill) => patch({ sill })}
          />
          <IntField
            label={t.t("ui.plan.editor.obstacle.head")}
            value={o.head}
            min={1}
            hint={t.t("ui.plan.editor.obstacle.heights.hint")}
            onCommit={(head) => patch({ head })}
          />
        </>
      );
    case "zone":
      return (
        <>
          {o.points.map((at, i) => (
            <PointFields
              key={i}
              at={at}
              labelX={t.t("ui.plan.inspector.room.vertexX", { index: i + 1 })}
              labelY={t.t("ui.plan.inspector.room.vertexY", { index: i + 1 })}
              onCommit={(point) => commit((p) => moveZoneVertex(p, id, i, point))}
            />
          ))}
        </>
      );
  }
}

function ObstacleInspector({
  id,
  setRemark,
  onNote,
}: {
  id: string;
  setRemark: SetRemark;
  onNote: (note: PlanNote | null) => void;
}) {
  const t = useT();
  const o = useApp((s) => (s.project.site.obstacles ?? []).find((x) => x.id === id));
  if (!o) return null;
  const commit = (edit: (p: Project) => EditResult) => fieldCommit(setRemark, edit);
  return (
    <fieldset className="plan-inspector__group">
      <legend>{t.t(OBSTACLE_LEGENDS[o.kind], { id })}</legend>
      <ObstacleFields o={o} commit={commit} />
      <div
        className="button-row plan-inspector__actions"
        role="group"
        aria-label={t.t("ui.plan.inspector.obstacle.actions", { id })}
      >
        <button
          type="button"
          title={t.t("ui.plan.inspector.obstacle.remove.title")}
          onClick={() => siteAction(removeObstacleInStore(id), setRemark, onNote)}
        >
          {t.t("ui.plan.inspector.obstacle.remove")}
        </button>
      </div>
    </fieldset>
  );
}

/** Inspecteur de la sélection du plan (voir l'en-tête). */
export function PlanInspector({
  selection,
  onNote,
}: {
  selection: PlanSelection | null;
  /** Note qui doit survivre au démontage de l'inspecteur (retrait du tronçon sélectionné). */
  onNote: (note: PlanNote | null) => void;
}) {
  const t = useT();
  const [remark, setRemark] = useState<Remark>(null);
  if (selection === null) return null;
  const body = (() => {
    switch (selection.kind) {
      case "stair":
        return <StairInspector setRemark={setRemark} />;
      case "section":
        return <SectionInspector index={selection.index} setRemark={setRemark} onNote={onNote} />;
      case "junction":
        return <JunctionInspector index={selection.index} setRemark={setRemark} />;
      case "wall":
      case "wallEnd":
        return <WallInspector id={selection.id} setRemark={setRemark} onNote={onNote} />;
      case "opening":
        return <OpeningInspector vertex={null} setRemark={setRemark} onNote={onNote} />;
      case "openingVertex":
        return <OpeningInspector vertex={selection.index} setRemark={setRemark} onNote={onNote} />;
      case "room":
        return <RoomInspector vertex={null} setRemark={setRemark} onNote={onNote} />;
      case "roomVertex":
        return <RoomInspector vertex={selection.index} setRemark={setRemark} onNote={onNote} />;
      case "obstacle":
        return <ObstacleInspector id={selection.id} setRemark={setRemark} onNote={onNote} />;
    }
  })();
  return (
    <section className="plan-inspector" aria-label={t.t("ui.plan.inspector.label")}>
      {body}
      <RemarkLine remark={remark} />
    </section>
  );
}
