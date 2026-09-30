/**
 * Formulaire du tracé hélicoïdal (`HelicalLayoutSpec`, jalon 5a) : sens de rotation, rayon
 * extérieur R_e, fût ou jour central et son rayon, rotation (marches par tour ou angle total),
 * angle de départ, palier d'arrivée en secteur. L'emmarchement E = R_e − r est dérivé par le
 * cœur (affiché, non saisi). Les valeurs proposées au changement de mode viennent du modèle
 * calculé ; la validation est celle du schéma du cœur.
 */
import {
  HELICAL_TREADS_PER_TURN_MAX,
  HELICAL_TREADS_PER_TURN_MIN,
  type HelicalLayoutSpec,
} from "@blondel/core";
import { useRef } from "react";
import { DEFAULT_LANDING_ANGLE, FALLBACK_TREADS_PER_TURN } from "../lib/layoutKind.js";
import { useT } from "../i18n/useT.js";
import { formatDecimal, formatLength, parseDecimal } from "../lib/units.js";
import { appStore, useApp, useModel } from "../store/appStore.js";
import type { UpdateResult } from "../store/projectStore.js";
import type { Path } from "../store/setIn.js";
import { CheckField, IntField, NumberField, SelectField } from "./fields.js";

const BASE: Path = ["stair", "layout"];
const set =
  (path: Path) =>
  (value: unknown): UpdateResult =>
    appStore.getState().setField([...BASE, ...path], value);

const DEG = 180 / Math.PI;

/** Champ d'angle en degrés (décimal, virgule acceptée). */
function AngleField(props: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  hint?: string;
  onCommit: (v: number) => UpdateResult;
}) {
  const t = useT();
  return (
    <NumberField
      label={props.label}
      value={props.value}
      unit="°"
      {...(props.hint === undefined ? {} : { hint: props.hint })}
      {...(props.min === undefined ? {} : { min: props.min })}
      {...(props.max === undefined ? {} : { max: props.max })}
      parse={parseDecimal}
      format={(v) => formatDecimal(v, t.locale)}
      onCommit={props.onCommit}
    />
  );
}

export function HelicalEditor({ layout }: { layout: HelicalLayoutSpec }) {
  const t = useT();
  const unit = useApp((s) => s.displayUnit);
  const { model } = useModel();
  const h = model?.layout.helical;
  // Dernier palier retiré : restauré si l'on réactive le palier.
  const lastLanding = useRef<number | null>(null);
  const core = layout.core;
  const sweep = layout.sweep;
  return (
    <fieldset className="helical">
      <legend>{t.t("ui.label.layoutKind.helical")}</legend>
      <SelectField
        label={t.t("ui.helical.direction.label")}
        value={layout.direction}
        options={[
          { value: "left", label: t.t("ui.helical.direction.left") },
          { value: "right", label: t.t("ui.helical.direction.right") },
        ]}
        onCommit={set(["direction"])}
      />
      <IntField
        label={t.t("ui.helical.outerRadius.label")}
        hint={t.t("ui.helical.outerRadius.hint")}
        value={layout.outerRadius}
        min={1}
        onCommit={set(["outerRadius"])}
      />
      <SelectField
        label={t.t("ui.helical.core.label")}
        value={core.kind}
        options={[
          { value: "column", label: t.t("ui.helical.core.column") },
          { value: "well", label: t.t("ui.helical.core.well") },
        ]}
        onCommit={(kind) => set(["core"])({ kind, radius: core.radius })}
      />
      <IntField
        label={t.t(
          core.kind === "column" ? "ui.helical.coreRadius.column" : "ui.helical.coreRadius.well",
        )}
        value={core.radius}
        min={1}
        onCommit={set(["core", "radius"])}
      />
      <p className="muted" aria-live="polite">
        {t.t("ui.helical.width", {
          value: formatLength(layout.outerRadius - core.radius, unit, t.locale),
        })}
      </p>
      <SelectField
        label={t.t("ui.helical.sweep.label")}
        value={sweep.mode}
        options={[
          { value: "treadsPerTurn", label: t.t("ui.helical.sweep.treadsPerTurn") },
          { value: "angle", label: t.t("ui.helical.sweep.angle") },
        ]}
        onCommit={(mode) => {
          if (mode === sweep.mode) return { ok: true };
          if (mode === "angle") {
            // Angle actuel du modèle (nez de départ → nez d'arrivée), arrondi au dixième de degré.
            const degrees = h ? Math.round(h.totalAngle * DEG * 10) / 10 : 360;
            return set(["sweep"])({ mode: "angle", degrees });
          }
          const count = h
            ? Math.min(
                HELICAL_TREADS_PER_TURN_MAX,
                Math.max(HELICAL_TREADS_PER_TURN_MIN, Math.round(h.treadsPerTurn)),
              )
            : FALLBACK_TREADS_PER_TURN;
          return set(["sweep"])({ mode: "treadsPerTurn", count });
        }}
      />
      {sweep.mode === "treadsPerTurn" ? (
        <IntField
          label={t.t("ui.helical.treadsPerTurn.label")}
          unit=""
          value={sweep.count}
          min={HELICAL_TREADS_PER_TURN_MIN}
          max={HELICAL_TREADS_PER_TURN_MAX}
          {...(h
            ? {
                hint: t.t("ui.helical.treadsPerTurn.hint", {
                  angle: formatDecimal(Math.round(h.stepAngle * DEG * 10) / 10, t.locale),
                }),
              }
            : {})}
          onCommit={set(["sweep", "count"])}
        />
      ) : (
        <AngleField
          label={t.t("ui.helical.totalAngle.label")}
          value={sweep.degrees}
          min={0}
          max={2160}
          {...(h
            ? {
                hint: t.t("ui.helical.totalAngle.hint", {
                  value: formatDecimal(Math.round(h.treadsPerTurn * 10) / 10, t.locale),
                }),
              }
            : {})}
          onCommit={set(["sweep", "degrees"])}
        />
      )}
      <AngleField
        label={t.t("ui.helical.startAngle.label")}
        hint={t.t("ui.helical.startAngle.hint")}
        value={layout.startAngle}
        onCommit={set(["startAngle"])}
      />
      <CheckField
        label={t.t("ui.helical.landing.label")}
        checked={layout.landing !== undefined}
        onCommit={(checked) => {
          if (!checked) {
            lastLanding.current = layout.landing?.angle ?? null;
            return set(["landing"])(undefined);
          }
          return set(["landing"])({ angle: lastLanding.current ?? DEFAULT_LANDING_ANGLE });
        }}
      />
      {layout.landing ? (
        <AngleField
          label={t.t("ui.helical.landing.angle")}
          value={layout.landing.angle}
          min={0}
          max={359.9}
          onCommit={set(["landing", "angle"])}
        />
      ) : null}
    </fieldset>
  );
}
