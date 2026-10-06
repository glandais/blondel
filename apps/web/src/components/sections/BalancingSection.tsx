/**
 * Section « Balancement » : méthode (M0 à M6) et ses réglages (variante M3, angle de herse M2,
 * portée et raideur M6), marches balancées par côté, collet cible. Les bornes des curseurs
 * viennent de `lib/balancingForm.ts` (lues dans le modèle). Répartition par niveau : `Tiered`.
 */
import { formatNumber } from "../../i18n/locale.js";
import { useT } from "../../i18n/useT.js";
import {
  balancingMethodOptions,
  herseAngleRange,
  rotationRanges,
} from "../../lib/balancingForm.js";
import { appStore, useApp, useModel } from "../../store/appStore.js";
import type { Path } from "../../store/setIn.js";
import { AutoIntField, IntField, RangeField, SelectField } from "../fields.js";
import { Tiered, type SectionProps } from "./Tiered.js";

const set = (path: Path) => (value: unknown) => appStore.getState().setField(path, value);

type SliderKey = "herseAngle" | "rotationReach" | "rotationSteepness";

/** Valeur d'un curseur de balancement (geste continu : une entrée d'historique). */
const setBalancing = (key: SliderKey) => (value: number, groupKey: string) =>
  appStore
    .getState()
    .update(
      (p) => ({ ...p, stair: { ...p.stair, balancing: { ...p.stair.balancing, [key]: value } } }),
      groupKey,
      { sticky: true },
    );

/** Retire la valeur saisie : le cœur reprend sa valeur par défaut. */
const resetBalancing = (key: SliderKey) => () =>
  appStore.getState().update((p) => {
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

/** Curseurs de la rotation paramétrée M6 : portée λ ou raideur p. */
function RotationControl({ which }: { which: "reach" | "steepness" }) {
  const b = useApp((s) => s.project.stair.balancing);
  const ranges = rotationRanges(b);
  const t = useT();
  if (which === "reach") {
    const { reach } = ranges;
    return (
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
    );
  }
  const { steepness } = ranges;
  return (
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
  );
}

export function BalancingSection({ display }: SectionProps) {
  const b = useApp((s) => s.project.stair.balancing);
  const hasTurns = useApp((s) => s.project.stair.layout.turns.length > 0);
  const helical = useApp((s) => s.project.stair.layout.kind === "helical");
  const { model } = useModel();
  const t = useT();
  return (
    <Tiered
      display={display}
      items={[
        !hasTurns && {
          // Remarque « sans tournant » : au niveau de la méthode.
          key: "stair.balancing.method",
          id: "balancing-not-applicable",
          node: (
            <p className="muted">
              {t.t(
                helical
                  ? "ui.params.balancing.notApplicableHelical"
                  : "ui.params.balancing.notApplicable",
              )}
            </p>
          ),
        },
        {
          key: "stair.balancing.method",
          node: (
            <SelectField
              label={t.t("ui.params.balancing.method")}
              value={b.method}
              options={balancingMethodOptions(t)}
              onCommit={set(["stair", "balancing", "method"])}
            />
          ),
        },
        b.method === "M3" && {
          key: "stair.balancing.variant",
          node: (
            // Segmenté « Auto | Cubique | Quintique » (spécification de contenu § 3).
            <SelectField
              label={t.t("ui.params.balancing.variant.label")}
              segmented
              hint={t.t("ui.params.balancing.variant.hint")}
              value={b.variant}
              options={[
                { value: "auto", label: t.t("ui.params.balancing.variant.auto") },
                { value: "cubic", label: t.t("ui.params.balancing.variant.cubic") },
                { value: "quintic", label: t.t("ui.params.balancing.variant.quintic") },
              ]}
              onCommit={set(["stair", "balancing", "variant"])}
            />
          ),
        },
        b.method === "M2" && {
          key: "stair.balancing.herseAngle",
          node: <HerseControls model={model} />,
        },
        b.method === "M6" && {
          key: "stair.balancing.rotationReach",
          node: <RotationControl which="reach" />,
        },
        b.method === "M6" && {
          key: "stair.balancing.rotationSteepness",
          node: <RotationControl which="steepness" />,
        },
        {
          key: "stair.balancing.windersPerSide",
          node: (
            <AutoIntField
              label={t.t("ui.params.balancing.windersPerSide")}
              unit=""
              value={b.windersPerSide}
              // Nombre retenu par le découpage non exposé par le modèle : libellé neutre en
              // mode Auto ; « Imposer » part du minimum.
              fallback={1}
              min={1}
              max={8}
              onCommit={set(["stair", "balancing", "windersPerSide"])}
            />
          ),
        },
        {
          key: "stair.balancing.targetCollet",
          node: (
            <IntField
              label={t.t("ui.params.balancing.targetCollet")}
              value={b.targetCollet}
              min={1}
              onCommit={set(["stair", "balancing", "targetCollet"])}
            />
          ),
        },
      ]}
    />
  );
}
