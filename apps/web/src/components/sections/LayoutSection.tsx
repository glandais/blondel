/**
 * Section « Tracé » : type de tracé (volées ou hélicoïdal), emmarchement, ligne de foulée,
 * typologie, volées et tournants, recalage ; formulaire hélicoïdal (`HelicalEditor`). Aucune
 * valeur n'est calculée ici : les valeurs proposées au sortir d'un mode automatique sont lues
 * dans le modèle rendu par le cœur. Répartition par niveau : `Tiered`.
 */
import {
  DEFAULT_NEWEL_SIZE,
  type InnerCorner,
  type Leg,
  type Project,
  type Turn,
} from "@blondel/core";
import { msg, textMessage, type Locale, type Message, type MessageKey } from "@blondel/i18n";
import { useMemo } from "react";
import { formatNumber } from "../../i18n/locale.js";
import { listMessages } from "../../i18n/text.js";
import { useT } from "../../i18n/useT.js";
import { addLeg, legAutoAllowed, removeLastLeg } from "../../lib/layoutEdit.js";
import {
  LAYOUT_KIND_LABELS,
  flightsTypologyLabel,
  hasOppositeTurns,
  layoutKindOf,
  switchLayoutKind,
  withTurnSequence,
  type LayoutKind,
  type TurnSequence,
} from "../../lib/layoutKind.js";
import type { Display } from "../../lib/paramTiers.js";
import {
  realign,
  realignDisabledReason,
  REALIGN_HINT_KEY,
  WALKLINE_SIDE_HINT_KEY,
  walklineSideApplies,
  walklineSideChoice,
  withWalklineSide,
  type WalklineSideChoice,
} from "../../lib/realign.js";
import { appStore, useApp, useModel } from "../../store/appStore.js";
import type { Path } from "../../store/setIn.js";
import { AutoIntField, IntField, SelectField } from "../fields.js";
import { useHelicalItems } from "../HelicalEditor.js";
import { Tiered, type SectionProps, type TieredGroup, type TieredItem } from "./Tiered.js";

const set = (path: Path) => (value: unknown) => appStore.getState().setField(path, value);
const update = (recipe: (p: Project) => Project, groupKey?: string) =>
  appStore.getState().update(recipe, groupKey);

const INNER_KINDS = [
  { value: "sharp", key: "ui.params.turn.inner.sharp" },
  { value: "arc", key: "ui.params.turn.inner.arc" },
  { value: "newel", key: "ui.params.turn.inner.newel" },
] as const satisfies readonly { value: InnerCorner["kind"]; key: MessageKey }[];

function TurnEditor({ turn, index, display }: { turn: Turn; index: number; display: Display }) {
  const base: Path = ["stair", "layout", "turns", index];
  const inner = turn.inner;
  const t = useT();
  const g: TieredGroup = {
    id: "turn",
    render: (children) => (
      <fieldset className="turn">
        <legend>{t.t("ui.params.turn.legend", { index: index + 1 })}</legend>
        {children}
      </fieldset>
    ),
  };
  return (
    <Tiered
      display={display}
      items={[
        {
          key: "stair.layout.turns.*.direction",
          group: g,
          node: (
            <SelectField
              label={t.t("ui.params.turn.direction")}
              value={turn.direction}
              options={[
                { value: "left", label: t.t("ui.params.turn.left") },
                { value: "right", label: t.t("ui.params.turn.right") },
              ]}
              onCommit={set([...base, "direction"])}
            />
          ),
        },
        {
          key: "stair.layout.turns.*.mode",
          group: g,
          node: (
            <SelectField
              label={t.t("ui.params.turn.mode")}
              value={turn.mode}
              options={[
                { value: "winders", label: t.t("ui.params.turn.winders") },
                { value: "landing", label: t.t("ui.params.turn.landing") },
              ]}
              onCommit={set([...base, "mode"])}
            />
          ),
        },
        {
          key: "stair.layout.turns.*.inner.kind",
          group: g,
          node: (
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
          ),
        },
        inner.kind === "arc" && {
          key: "stair.layout.turns.*.inner.radius",
          group: g,
          node: (
            <IntField
              label={t.t("ui.params.turn.arcRadius")}
              value={inner.radius}
              min={1}
              onCommit={set([...base, "inner", "radius"])}
            />
          ),
        },
        ...(inner.kind === "newel"
          ? [
              {
                key: "stair.layout.turns.*.inner.size",
                group: g,
                node: (
                  <IntField
                    label={t.t("ui.params.turn.newelSize")}
                    value={inner.size}
                    min={1}
                    onCommit={set([...base, "inner", "size"])}
                  />
                ),
              },
              {
                key: "stair.layout.turns.*.inner.offset",
                group: g,
                node: (
                  <IntField
                    label={t.t("ui.params.turn.newelOffset.label")}
                    value={inner.offset ?? 0}
                    min={0}
                    hint={t.t("ui.params.turn.newelOffset.hint")}
                    onCommit={set([...base, "inner", "offset"])}
                  />
                ),
              },
            ]
          : []),
      ]}
    />
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
            msg: msg("ui.params.realign.failed", {
              issues: listMessages(r.issues) ?? msg("ui.common.input.refused"),
            }),
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

export function LayoutSection({ display }: SectionProps) {
  const layout = useApp((s) => s.project.stair.layout);
  const walkline = useApp((s) => s.project.stair.walkline);
  const { model } = useModel();
  const legs = layout.legs;
  const kind = useApp((s) => layoutKindOf(s.project));
  const sideChoice = useApp((s) => walklineSideChoice(s.project));
  const sideApplies = useApp((s) => walklineSideApplies(s.project));
  const side = walkline.side !== undefined ? { side: walkline.side } : {};
  const helicalItems = useHelicalItems(layout);
  const t = useT();

  const flightsItems = (): readonly (TieredItem | false)[] => {
    if (layout.kind === "helical") return [];
    const turns = layout.turns;
    const opposite = hasOppositeTurns(turns);
    const transitions = transitionsOf(model);
    const run = model?.stepping.run;
    // Typologie (déduite des tournants) et enchaînement des deux premiers tournants : même
    // sens (U) ou sens opposés (S / Z).
    const typology: TieredGroup = {
      id: "typology",
      render: (children) => <div className="typology">{children}</div>,
    };
    return [
      {
        key: "ui:layout.typology",
        group: typology,
        node: (
          <p className="typology__label">
            {t.t("ui.params.typology.label")} <strong>{t.t(flightsTypologyLabel(turns))}</strong>
          </p>
        ),
      },
      turns.length >= 2 && {
        key: "ui:layout.turnSequence",
        group: typology,
        node: (
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
        ),
      },
      opposite && {
        key: "ui:layout.typology",
        id: "typology-note",
        group: typology,
        node: (
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
        ),
      },
      ...legs.flatMap((leg: Leg, i: number): (TieredItem | false)[] => {
        const g: TieredGroup = {
          id: `leg-${i}`,
          render: (children) => <div className="leg">{children}</div>,
        };
        return [
          {
            key: "stair.layout.legs.*.length",
            id: `leg-${i}-length`,
            group: g,
            node: (
              <AutoIntField
                label={t.t("ui.params.flights.leg", { index: i + 1 })}
                value={leg.length}
                // Longueur calculée de la volée non exposée par le modèle : libellé neutre en
                // mode Auto ; « Imposer » part de `legFallback` (simple proposition de saisie).
                fallback={legFallback(legs, i, run)}
                autoAllowed={legAutoAllowed(legs.length)}
                autoHint={t.t("ui.params.flights.autoHint")}
                min={1}
                onCommit={set(["stair", "layout", "legs", i, "length"])}
              />
            ),
          },
          i < turns.length && {
            // Le tournant (fieldset) répartit lui-même ses champs ; il suit le niveau de son
            // type (balancées / palier).
            key: "stair.layout.turns.*.mode",
            id: `turn-${i}`,
            group: g,
            node: <TurnEditor turn={turns[i] as Turn} index={i} display={display} />,
          },
        ];
      }),
      {
        key: "ui:layout.addRemoveLeg",
        node: (
          <div className="button-row">
            <button type="button" onClick={() => update(addLeg)}>
              {t.t("ui.params.flights.add")}
            </button>
            <button type="button" disabled={legs.length <= 1} onClick={() => update(removeLastLeg)}>
              {t.t("ui.params.flights.remove")}
            </button>
          </div>
        ),
      },
    ];
  };

  return (
    <Tiered
      display={display}
      items={[
        {
          key: "stair.layout.kind",
          node: (
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
          ),
        },
        // Ordre de la spécification de contenu (§ 3, tableau Tracé) : type, E, typologie,
        // volées et tournants, ligne de foulée, recalage, puis le bloc hélicoïdal.
        layout.kind !== "helical" && {
          key: "stair.layout.width",
          node: (
            <IntField
              label={t.t("compliance.stair.width")}
              value={layout.width}
              min={1}
              onCommit={set(["stair", "layout", "width"])}
            />
          ),
        },
        ...flightsItems(),
        {
          key: "stair.walkline.mode",
          node: (
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
          ),
        },
        walkline.mode === "fromInner" && {
          key: "stair.walkline.distance",
          node: (
            <IntField
              label={t.t("ui.params.walkline.distance")}
              value={walkline.distance}
              min={1}
              {...(layout.kind !== "helical" && hasOppositeTurns(layout.turns)
                ? { hint: t.t("ui.params.walkline.distanceHint") }
                : {})}
              onCommit={set(["stair", "walkline", "distance"])}
            />
          ),
        },
        sideApplies && {
          key: "stair.walkline.side",
          node: (
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
          ),
        },
        layout.kind !== "helical" && { key: "ui:layout.realign", node: <RealignButton /> },
        ...helicalItems,
      ]}
    />
  );
}
