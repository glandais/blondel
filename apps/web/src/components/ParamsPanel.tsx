/**
 * Panneau de paramètres : édite le `Project` (site, tracé, découpage, balancement, marches,
 * structure, garde-corps, contexte de contrôle). Aucune valeur n'est calculée ici : les valeurs proposées au sortir
 * d'un mode automatique sont lues dans le modèle rendu par le cœur.
 */
import {
  contextLabel,
  DEDUCED_ONLY_CONTEXTS,
  DEFAULT_NEWEL_SIZE,
  defaultOpening,
  RULE_TABLE,
  type InnerCorner,
  type Leg,
  type Opening,
  type Project,
  type Turn,
} from "@blondel/core";
import { msg, textMessage, type Locale, type Message, type MessageKey } from "@blondel/i18n";
import { useMemo, useRef, type ReactNode } from "react";
import { formatNumber } from "../i18n/locale.js";
import { useT } from "../i18n/useT.js";
import { appStore, useApp, useModel } from "../store/appStore.js";
import type { Path } from "../store/setIn.js";
import { addLeg, legAutoAllowed, removeLastLeg } from "../lib/layoutEdit.js";
import {
  LAYOUT_KIND_LABELS,
  flightsTypologyLabel,
  hasOppositeTurns,
  layoutKindOf,
  switchLayoutKind,
  withTurnSequence,
  type LayoutKind,
  type TurnSequence,
} from "../lib/layoutKind.js";
import { balancingMethodOptions, herseAngleRange, rotationRanges } from "../lib/balancingForm.js";
import {
  realign,
  realignDisabledReason,
  REALIGN_HINT_KEY,
  WALKLINE_SIDE_HINT_KEY,
  walklineSideApplies,
  walklineSideChoice,
  withWalklineSide,
  type WalklineSideChoice,
} from "../lib/realign.js";
import {
  AutoIntField,
  CheckField,
  IntField,
  RangeField,
  SelectField,
  TextField,
} from "./fields.js";
import { GuardsSection } from "./GuardsSection.js";
import { HelicalEditor } from "./HelicalEditor.js";
import { StructureSection } from "./StructureSection.js";

const set = (path: Path) => (value: unknown) => appStore.getState().setField(path, value);
const update = (recipe: (p: Project) => Project, groupKey?: string) =>
  appStore.getState().update(recipe, groupKey);

function Section({
  title,
  children,
  open = true,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="section" open={open}>
      <summary>
        <h2>{title}</h2>
      </summary>
      <div className="section__body">{children}</div>
    </details>
  );
}

// ------------------------------------------------------------------ Site

function SiteSection() {
  const site = useApp((s) => s.project.site);
  const layout = useApp((s) => s.project.stair.layout);
  const origin = useApp((s) => s.project.stair.placement.origin);
  // Dernière trémie retirée : restaurée si l'on réactive la trémie.
  const lastOpening = useRef<Opening | null>(null);
  const o = site.opening;
  const t = useT();
  return (
    <Section title={t.t("ui.params.site.title")}>
      <IntField
        label={t.t("ui.params.site.floorToFloor.label")}
        hint={t.t("ui.params.site.floorToFloor.hint")}
        value={site.floorToFloor}
        min={1}
        onCommit={set(["site", "floorToFloor"])}
      />
      <IntField
        label={t.t("ui.params.site.slab.label")}
        hint={t.t("ui.params.site.slab.hint")}
        value={site.upperSlabThickness}
        min={1}
        onCommit={set(["site", "upperSlabThickness"])}
      />
      <IntField
        label={t.t("ui.params.site.lowerFinish")}
        value={site.lowerFinish}
        min={0}
        onCommit={set(["site", "lowerFinish"])}
      />
      <IntField
        label={t.t("ui.params.site.upperFinish")}
        value={site.upperFinish}
        min={0}
        onCommit={set(["site", "upperFinish"])}
      />
      <CheckField
        label={t.t("ui.params.site.opening.label")}
        checked={o !== undefined}
        onCommit={(checked) => {
          if (!checked) {
            lastOpening.current = o ?? null;
            return set(["site", "opening"])(undefined);
          }
          // Trémie précédente de la session, sinon celle que proposerait le préréglage
          // (`defaultOpening` du cœur : échappée et jeu latéral des préréglages). Si le cœur
          // n'en propose pas (dalle assez haute, tracé impossible), valeur provisoire à ajuster :
          // carré de côté E au départ, ou carré circonscrit au cercle R_e d'un hélicoïdal.
          const r = layout.kind === "helical" ? layout.outerRadius : 0;
          const restored: Opening = lastOpening.current ??
            defaultOpening(appStore.getState().project) ?? {
              kind: "rect",
              x: layout.kind === "helical" ? Math.round(origin.x) - r : 0,
              y: layout.kind === "helical" ? Math.round(origin.y) - r : 0,
              sizeX: layout.kind === "helical" ? 2 * r : layout.width,
              sizeY: layout.kind === "helical" ? 2 * r : layout.width,
            };
          return set(["site", "opening"])(restored);
        }}
      />
      {o?.kind === "rect" ? (
        <fieldset className="grid-2">
          <legend>{t.t("ui.params.site.opening.rect")}</legend>
          <IntField
            label={t.t("ui.params.site.opening.x")}
            value={o.x}
            onCommit={set(["site", "opening", "x"])}
          />
          <IntField
            label={t.t("ui.params.site.opening.y")}
            value={o.y}
            onCommit={set(["site", "opening", "y"])}
          />
          <IntField
            label={t.t("ui.params.site.opening.sizeX")}
            value={o.sizeX}
            min={1}
            onCommit={set(["site", "opening", "sizeX"])}
          />
          <IntField
            label={t.t("ui.params.site.opening.sizeY")}
            value={o.sizeY}
            min={1}
            onCommit={set(["site", "opening", "sizeY"])}
          />
        </fieldset>
      ) : null}
      {o?.kind === "polygon" ? (
        <p className="muted">{t.t("ui.params.site.opening.polygon", { count: o.points.length })}</p>
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------ Tracé

const INNER_KINDS = [
  { value: "sharp", key: "ui.params.turn.inner.sharp" },
  { value: "arc", key: "ui.params.turn.inner.arc" },
  { value: "newel", key: "ui.params.turn.inner.newel" },
] as const satisfies readonly { value: InnerCorner["kind"]; key: MessageKey }[];

function TurnEditor({ turn, index }: { turn: Turn; index: number }) {
  const base: Path = ["stair", "layout", "turns", index];
  const inner = turn.inner;
  const t = useT();
  return (
    <fieldset className="turn">
      <legend>{t.t("ui.params.turn.legend", { index: index + 1 })}</legend>
      <SelectField
        label={t.t("ui.params.turn.direction")}
        value={turn.direction}
        options={[
          { value: "left", label: t.t("ui.params.turn.left") },
          { value: "right", label: t.t("ui.params.turn.right") },
        ]}
        onCommit={set([...base, "direction"])}
      />
      <SelectField
        label={t.t("ui.params.turn.mode")}
        value={turn.mode}
        options={[
          { value: "winders", label: t.t("ui.params.turn.winders") },
          { value: "landing", label: t.t("ui.params.turn.landing") },
        ]}
        onCommit={set([...base, "mode"])}
      />
      <SelectField
        label={t.t("ui.params.turn.inner.label")}
        value={inner.kind}
        options={INNER_KINDS.map((k) => ({ value: k.value, label: t.t(k.key) }))}
        onCommit={(kind) => {
          if (kind === inner.kind) return { ok: true };
          const size =
            inner.kind === "arc"
              ? inner.radius
              : inner.kind === "newel"
                ? inner.size
                : DEFAULT_NEWEL_SIZE;
          const next: InnerCorner =
            kind === "sharp"
              ? { kind: "sharp" }
              : kind === "arc"
                ? { kind: "arc", radius: size }
                : { kind: "newel", size };
          return set([...base, "inner"])(next);
        }}
      />
      {inner.kind === "arc" ? (
        <IntField
          label={t.t("ui.params.turn.arcRadius")}
          value={inner.radius}
          min={1}
          onCommit={set([...base, "inner", "radius"])}
        />
      ) : null}
      {inner.kind === "newel" ? (
        <>
          <IntField
            label={t.t("ui.params.turn.newelSize")}
            value={inner.size}
            min={1}
            onCommit={set([...base, "inner", "size"])}
          />
          <IntField
            label={t.t("ui.params.turn.newelOffset.label")}
            value={inner.offset ?? 0}
            min={0}
            hint={t.t("ui.params.turn.newelOffset.hint")}
            onCommit={set([...base, "inner", "offset"])}
          />
        </>
      ) : null}
    </fieldset>
  );
}

/**
 * Longueur proposée quand une volée quitte le mode automatique : longueur d'une autre volée
 * saisie, sinon reculement du modèle (escalier droit), sinon 1 mm (à saisir).
 */
function legFallback(legs: readonly Leg[], i: number, run: number | undefined): number {
  const other = legs.find((l, j) => j !== i && l.length !== "auto");
  if (other && other.length !== "auto") return other.length;
  return Math.max(1, Math.round(run ?? 1));
}

function LayoutSection() {
  const layout = useApp((s) => s.project.stair.layout);
  const walkline = useApp((s) => s.project.stair.walkline);
  const { model } = useModel();
  const legs = layout.legs;
  const kind = useApp((s) => layoutKindOf(s.project));
  const sideChoice = useApp((s) => walklineSideChoice(s.project));
  const sideApplies = useApp((s) => walklineSideApplies(s.project));
  const side = walkline.side !== undefined ? { side: walkline.side } : {};
  const t = useT();
  return (
    <Section title={t.t("ui.params.layout.title")}>
      <SelectField<LayoutKind>
        label={t.t("ui.params.layout.kind.label")}
        value={kind}
        options={(["flights", "helical"] as const).map((k) => ({
          value: k,
          label: t.t(LAYOUT_KIND_LABELS[k]),
        }))}
        hint={t.t("ui.params.layout.kind.hint")}
        onCommit={(k) => {
          let note: Message | undefined;
          const r = update((p) => {
            const s = switchLayoutKind(p, k);
            note = s.note;
            return s.project;
          });
          if (r.ok && note !== undefined)
            appStore.setState({ notice: { kind: "info", msg: note } });
          return r;
        }}
      />
      {layout.kind === "helical" ? (
        <HelicalEditor layout={layout} />
      ) : (
        <IntField
          label={t.t("compliance.stair.width")}
          value={layout.width}
          min={1}
          onCommit={set(["stair", "layout", "width"])}
        />
      )}
      <SelectField
        label={t.t("ui.params.walkline.label")}
        value={walkline.mode}
        options={[
          { value: "dtu", label: t.t("ui.params.walkline.dtu") },
          { value: "fromInner", label: t.t("ui.params.walkline.fromInner") },
        ]}
        onCommit={(mode) =>
          set(["stair", "walkline"])(
            mode === "dtu"
              ? { mode: "dtu", ...side }
              : {
                  mode: "fromInner",
                  distance: Math.max(1, Math.round(model?.layout.walklineOffset ?? 1)),
                  ...side,
                },
          )
        }
      />
      {walkline.mode === "fromInner" ? (
        <IntField
          label={t.t("ui.params.walkline.distance")}
          value={walkline.distance}
          min={1}
          {...(layout.kind !== "helical" && hasOppositeTurns(layout.turns)
            ? { hint: t.t("ui.params.walkline.distanceHint") }
            : {})}
          onCommit={set(["stair", "walkline", "distance"])}
        />
      ) : null}
      {sideApplies ? (
        <SelectField<WalklineSideChoice>
          label={t.t("ui.params.walkline.side.label")}
          value={sideChoice}
          options={[
            {
              value: "auto",
              label: t.t(
                model?.layout.walklineSide === "right"
                  ? "ui.params.walkline.side.autoRight"
                  : model?.layout.walklineSide === "left"
                    ? "ui.params.walkline.side.autoLeft"
                    : "ui.params.walkline.side.auto",
              ),
            },
            { value: "left", label: t.t("ui.params.walkline.side.left") },
            { value: "right", label: t.t("ui.params.walkline.side.right") },
          ]}
          hint={t.t(WALKLINE_SIDE_HINT_KEY)}
          onCommit={(choice) => update((p) => withWalklineSide(p, choice))}
        />
      ) : null}
      {layout.kind === "helical" ? null : (
        <>
          <TypologyInfo turns={layout.turns} transitions={transitionsOf(model)} />
          <FlightsEditor legs={legs} turns={layout.turns} run={model?.stepping.run} />
          <RealignButton />
        </>
      )}
    </Section>
  );
}

/**
 * Recalage des volées et de la trémie sur H, E et la dalle (décision A18 (a), précisée le
 * 2026-09-30) : calcul du cœur (dernière volée seulement, position des tournants et trémie
 * polygonale conservées), une seule entrée d'annulation, message d'information. Recalage
 * impossible : bouton désactivé, raison rendue par le cœur affichée sous le bouton.
 */
function RealignButton() {
  const project = useApp((s) => s.project);
  const t = useT();
  const blocker = useMemo(() => realignDisabledReason(project), [project]);
  const reason = blocker === null ? null : t.t(blocker);
  const onClick = () => {
    let notice: Message | null = null;
    const r = update((p) => {
      const c = realign(p);
      notice = c.notice;
      return c.project;
    });
    appStore.setState({
      notice: r.ok
        ? { kind: "info", msg: notice ?? textMessage("") }
        : {
            kind: "error",
            msg: msg("ui.params.realign.failed", { issues: r.issues.join(" ; ") }),
          },
    });
  };
  return (
    <div className="button-row">
      <button
        type="button"
        onClick={onClick}
        disabled={reason !== null}
        title={reason ?? t.t(REALIGN_HINT_KEY)}
        aria-describedby={reason !== null ? "realign-reason" : undefined}
      >
        {t.t("ui.params.realign.button")}
      </button>
      {reason !== null ? (
        <p className="muted" id="realign-reason" data-testid="realign-reason">
          {reason}
        </p>
      ) : null}
    </div>
  );
}

interface TransitionInfo {
  readonly leg: number;
  readonly angle: number;
}

/** Transitions de la ligne de foulée d'un tracé S / Z (vides ailleurs), lues dans le modèle. */
function transitionsOf(
  model: { readonly layout: { readonly walklineTransitions?: readonly TransitionInfo[] } } | null,
): readonly TransitionInfo[] {
  return model?.layout.walklineTransitions ?? [];
}

const deg = (rad: number, locale: Locale): string =>
  formatNumber(locale, (rad * 180) / Math.PI, { maximumFractionDigits: 1 });

/**
 * Typologie du tracé à volées (déduite des tournants) et enchaînement des deux premiers
 * tournants : même sens (U) ou sens opposés (S / Z).
 */
function TypologyInfo({
  turns,
  transitions,
}: {
  turns: readonly Turn[];
  transitions: readonly TransitionInfo[];
}) {
  const opposite = hasOppositeTurns(turns);
  const t = useT();
  return (
    <div className="typology">
      <p className="typology__label">
        {t.t("ui.params.typology.label")} <strong>{t.t(flightsTypologyLabel(turns))}</strong>
      </p>
      {turns.length >= 2 ? (
        <SelectField<TurnSequence>
          label={t.t("ui.params.typology.sequence.label")}
          value={turns[0]!.direction === turns[1]!.direction ? "same" : "opposite"}
          options={[
            { value: "same", label: t.t("ui.params.typology.sequence.same") },
            { value: "opposite", label: t.t("ui.params.typology.sequence.opposite") },
          ]}
          hint={t.t("ui.params.typology.sequence.hint")}
          onCommit={(seq) => update((p) => withTurnSequence(p, seq))}
        />
      ) : null}
      {opposite ? (
        <p className="muted typology__note">
          {t.t("ui.params.typology.opposite")}
          {transitions.map((tr) => (
            <span key={tr.leg}>
              {" "}
              {t.t("ui.params.typology.transition", {
                flight: tr.leg + 1,
                angle: deg(tr.angle, t.locale),
              })}
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

function FlightsEditor({
  legs,
  turns,
  run,
}: {
  legs: readonly Leg[];
  turns: readonly Turn[];
  run: number | undefined;
}) {
  const t = useT();
  return (
    <>
      {legs.map((leg: Leg, i: number) => (
        <div key={i} className="leg">
          <AutoIntField
            label={t.t("ui.params.flights.leg", { index: i + 1 })}
            value={leg.length}
            fallback={legFallback(legs, i, run)}
            autoAllowed={legAutoAllowed(legs.length)}
            autoHint={t.t("ui.params.flights.autoHint")}
            min={1}
            onCommit={set(["stair", "layout", "legs", i, "length"])}
          />
          {i < turns.length ? <TurnEditor turn={turns[i] as Turn} index={i} /> : null}
        </div>
      ))}
      <div className="button-row">
        <button type="button" onClick={() => update(addLeg)}>
          {t.t("ui.params.flights.add")}
        </button>
        <button type="button" disabled={legs.length <= 1} onClick={() => update(removeLastLeg)}>
          {t.t("ui.params.flights.remove")}
        </button>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Découpage

function SteppingSection() {
  const st = useApp((s) => s.project.stair.stepping);
  const helical = useApp((s) => s.project.stair.layout.kind === "helical");
  const { model } = useModel();
  const t = useT();
  return (
    <Section title={t.t("ui.params.stepping.title")}>
      <AutoIntField
        label={t.t("ui.params.stepping.riserCount")}
        unit=""
        value={st.riserCount}
        fallback={model?.stepping.riserCount ?? 2}
        min={2}
        max={60}
        onCommit={set(["stair", "stepping", "riserCount"])}
      />
      <IntField
        label={t.t("ui.params.stepping.targetRise")}
        value={st.targetRise}
        min={1}
        onCommit={set(["stair", "stepping", "targetRise"])}
      />
      <AutoIntField
        label={t.t("ui.params.stepping.targetGoing.label")}
        value={st.targetGoing}
        fallback={Math.max(1, Math.round(model?.stepping.going ?? 1))}
        min={1}
        hint={
          helical
            ? t.t("ui.params.stepping.targetGoing.hintHelical")
            : t.t("ui.params.stepping.targetGoing.hint")
        }
        onCommit={set(["stair", "stepping", "targetGoing"])}
      />
      <IntField
        label={t.t("ui.params.stepping.firstRise.label")}
        hint={t.t("ui.params.stepping.firstRise.hint")}
        value={st.firstRiseOffset}
        onCommit={set(["stair", "stepping", "firstRiseOffset"])}
      />
    </Section>
  );
}

// ------------------------------------------------------------------ Balancement

function BalancingSection() {
  const b = useApp((s) => s.project.stair.balancing);
  const hasTurns = useApp((s) => s.project.stair.layout.turns.length > 0);
  const helical = useApp((s) => s.project.stair.layout.kind === "helical");
  const { model } = useModel();
  const t = useT();
  return (
    <Section title={t.t("ui.params.balancing.title")} open={hasTurns}>
      {!hasTurns ? (
        <p className="muted">
          {t.t(
            helical
              ? "ui.params.balancing.notApplicableHelical"
              : "ui.params.balancing.notApplicable",
          )}
        </p>
      ) : null}
      <SelectField
        label={t.t("ui.params.balancing.method")}
        value={b.method}
        options={balancingMethodOptions(t)}
        onCommit={set(["stair", "balancing", "method"])}
      />
      {b.method === "M3" ? (
        <SelectField
          label={t.t("ui.params.balancing.variant.label")}
          value={b.variant}
          options={[
            { value: "auto", label: t.t("ui.params.balancing.variant.auto") },
            { value: "cubic", label: t.t("ui.params.balancing.variant.cubic") },
            { value: "quintic", label: t.t("ui.params.balancing.variant.quintic") },
          ]}
          onCommit={set(["stair", "balancing", "variant"])}
        />
      ) : null}
      {b.method === "M2" ? <HerseControls model={model} /> : null}
      {b.method === "M6" ? <RotationControls /> : null}
      <AutoIntField
        label={t.t("ui.params.balancing.windersPerSide")}
        unit=""
        value={b.windersPerSide}
        fallback={1}
        min={1}
        max={8}
        onCommit={set(["stair", "balancing", "windersPerSide"])}
      />
      <IntField
        label={t.t("ui.params.balancing.targetCollet")}
        value={b.targetCollet}
        min={1}
        onCommit={set(["stair", "balancing", "targetCollet"])}
      />
    </Section>
  );
}

/** Valeur d'un curseur de balancement (geste continu : une entrée d'historique). */
const setBalancing =
  (key: "herseAngle" | "rotationReach" | "rotationSteepness") =>
  (value: number, groupKey: string) =>
    appStore
      .getState()
      .update(
        (p) => ({ ...p, stair: { ...p.stair, balancing: { ...p.stair.balancing, [key]: value } } }),
        groupKey,
        { sticky: true },
      );

/** Retire la valeur saisie : le cœur reprend sa valeur par défaut. */
const resetBalancing = (key: "herseAngle" | "rotationReach" | "rotationSteepness") => () =>
  update((p) => {
    const { [key]: _removed, ...balancing } = p.stair.balancing;
    return { ...p, stair: { ...p.stair, balancing } };
  });

function HerseControls({ model }: { model: ReturnType<typeof useModel>["model"] }) {
  const b = useApp((s) => s.project.stair.balancing);
  const r = herseAngleRange(b, model);
  const t = useT();
  return (
    <RangeField
      label={t.t("ui.params.herse.label")}
      unit="°"
      value={r.value}
      min={r.min}
      max={r.max}
      step={r.step}
      isDefault={r.isDefault}
      hint={
        r.modelBound !== null
          ? t.t("ui.params.herse.bounded", {
              bound: formatNumber(t.locale, r.modelBound, { maximumFractionDigits: 1 }),
            })
          : t.t("ui.params.herse.noBound")
      }
      onChange={setBalancing("herseAngle")}
      onReset={resetBalancing("herseAngle")}
    />
  );
}

function RotationControls() {
  const b = useApp((s) => s.project.stair.balancing);
  const { reach, steepness } = rotationRanges(b);
  const t = useT();
  return (
    <>
      <RangeField
        label={t.t("ui.params.rotation.reach")}
        unit={t.t("ui.params.rotation.goings")}
        value={reach.value}
        min={reach.min}
        max={reach.max}
        step={reach.step}
        isDefault={reach.isDefault}
        hint={t.t("ui.params.rotation.defaultHint")}
        onChange={setBalancing("rotationReach")}
        onReset={resetBalancing("rotationReach")}
      />
      <RangeField
        label={t.t("ui.params.rotation.steepness")}
        value={steepness.value}
        min={steepness.min}
        max={steepness.max}
        step={steepness.step}
        isDefault={steepness.isDefault}
        hint={t.t("ui.params.rotation.defaultHint")}
        onChange={setBalancing("rotationSteepness")}
        onReset={resetBalancing("rotationSteepness")}
      />
    </>
  );
}

// ------------------------------------------------------------------ Marches

function TreadsSection() {
  const treads = useApp((s) => s.project.stair.treads);
  const t = useT();
  return (
    <Section title={t.t("ui.params.treads.title")}>
      <IntField
        label={t.t("ui.params.treads.thickness")}
        value={treads.thickness}
        min={1}
        onCommit={set(["stair", "treads", "thickness"])}
      />
      <IntField
        label={t.t("ui.params.treads.nosing")}
        value={treads.nosing}
        min={0}
        onCommit={set(["stair", "treads", "nosing"])}
      />
      <SelectField
        label={t.t("ui.params.treads.risers.label")}
        value={treads.risers}
        options={[
          { value: "full", label: t.t("ui.params.treads.risers.full") },
          { value: "open", label: t.t("ui.params.treads.risers.open") },
          { value: "none", label: t.t("ui.params.treads.risers.none") },
        ]}
        onCommit={set(["stair", "treads", "risers"])}
      />
      {treads.risers !== "none" ? (
        <IntField
          label={t.t("ui.params.treads.riserThickness")}
          value={treads.riserThickness}
          min={1}
          onCommit={set(["stair", "treads", "riserThickness"])}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------ Contrôle

/** Contextes déduits automatiquement par le moteur de règles (non saisis). */
const DEDUCED_CONTEXTS = DEDUCED_ONLY_CONTEXTS;

function ComplianceSection() {
  const c = useApp((s) => s.project.compliance);
  const contexts = Object.keys(RULE_TABLE.contextes).filter((k) => !DEDUCED_CONTEXTS.has(k));
  const t = useT();
  return (
    <Section title={t.t("ui.params.compliance.title")} open={false}>
      <fieldset>
        <legend>{t.t("ui.params.compliance.contexts")}</legend>
        {contexts.map((key) => (
          <CheckField
            key={key}
            label={key.replace(/_/g, " ")}
            title={t.t(contextLabel(key))}
            checked={c.contexts.includes(key)}
            onCommit={(checked) =>
              set(["compliance", "contexts"])(
                checked ? [...c.contexts, key] : c.contexts.filter((x) => x !== key),
              )
            }
          />
        ))}
      </fieldset>
      <SelectField
        label={t.t("ui.params.compliance.profile.label")}
        value={c.profile}
        options={[
          { value: "strict", label: t.t("ui.params.compliance.profile.strict") },
          { value: "souple", label: t.t("ui.params.compliance.profile.souple") },
        ]}
        onCommit={set(["compliance", "profile"])}
      />
      <TextField
        label={t.t("ui.params.compliance.referenceDate.label")}
        type="date"
        value={c.referenceDate ?? ""}
        hint={t.t("ui.params.compliance.referenceDate.hint")}
        onCommit={(v) => set(["compliance", "referenceDate"])(v === "" ? undefined : v)}
      />
      {c.overrides.length > 0 ? (
        <p className="muted">
          {t.t("ui.params.compliance.overrides", { count: c.overrides.length })}
        </p>
      ) : null}
    </Section>
  );
}

export function ParamsPanel() {
  const t = useT();
  return (
    <div className="params">
      <SiteSection />
      <LayoutSection />
      <SteppingSection />
      <BalancingSection />
      <TreadsSection />
      <Section title={t.t("ui.structure.label")}>
        <StructureSection />
      </Section>
      <Section title={t.t("ui.params.guards.title")} open={false}>
        <GuardsSection />
      </Section>
      <ComplianceSection />
    </div>
  );
}
