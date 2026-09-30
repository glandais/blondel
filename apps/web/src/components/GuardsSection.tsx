/**
 * Panneau « Garde-corps » (jalon 4) : activation, côtés (jour, extérieur : automatique selon
 * les murs du site, vide ou mur), garde-corps de volée et de trémie, remplissage et ses
 * paramètres, poteaux, main courante, matériau. Édite `Project.guards` ; les valeurs par défaut
 * sont celles du schéma du cœur (`lib/guardsForm.ts`), la validation celle du store.
 */
import type { GuardInfill, GuardSection, GuardsSpec } from "@blondel/core";
import { useRef } from "react";
import {
  GUARD_MATERIAL_OPTIONS,
  INFILL_KINDS,
  INFILL_LABELS,
  SECTION_KIND_LABELS,
  SIDE_MODE_LABELS,
  WALL_SIDES_LABELS,
  defaultGuards,
  infillHasSection,
  infillIsPanel,
  switchInfill,
  switchSection,
} from "../lib/guardsForm.js";
import { formatDecimal, parseDecimal } from "../lib/units.js";
import { useT } from "../i18n/useT.js";
import type { MessageKey, Translator } from "@blondel/i18n";
import { appStore, useApp, useModel } from "../store/appStore.js";
import type { Path } from "../store/setIn.js";
import { AutoIntField, CheckField, IntField, NumberField, SelectField } from "./fields.js";

const set = (path: Path) => (value: unknown) => appStore.getState().setField(path, value);
const G: Path = ["guards"];

const options = <K extends string>(labels: Readonly<Record<K, MessageKey>>, t: Translator) =>
  (Object.entries(labels) as [K, MessageKey][]).map(([value, label]) => ({
    value,
    label: t.t(label),
  }));

function SectionEditor({
  legend,
  section,
  path,
}: {
  legend: string;
  section: GuardSection;
  path: Path;
}) {
  const t = useT();
  return (
    <fieldset className="grid-2">
      <legend>{legend}</legend>
      <SelectField
        label={t.t("ui.guards.section.shape")}
        value={section.kind}
        options={options(SECTION_KIND_LABELS, t)}
        onCommit={(kind) => set(path)(switchSection(section, kind))}
      />
      {section.kind === "round" ? (
        <IntField
          label={t.t("ui.guards.section.diameter")}
          value={section.diameter}
          min={1}
          onCommit={set([...path, "diameter"])}
        />
      ) : (
        <>
          <IntField
            label={t.t("ui.guards.section.width")}
            value={section.width}
            min={1}
            onCommit={set([...path, "width"])}
          />
          <IntField
            label={t.t("ui.guards.section.height")}
            value={section.height}
            min={1}
            onCommit={set([...path, "height"])}
          />
        </>
      )}
    </fieldset>
  );
}

function InfillEditor({ infill }: { infill: GuardInfill }) {
  const base: Path = [...G, "infill"];
  const t = useT();
  const toValidate = t.t("ui.guards.toValidate");
  return (
    <fieldset>
      <legend>{t.t("ui.guards.infill.legend")}</legend>
      <SelectField
        label={t.t("ui.guards.infill.kind")}
        value={infill.kind}
        options={INFILL_KINDS.map((k) => ({ value: k, label: t.t(INFILL_LABELS[k]) }))}
        onCommit={(kind) => set(base)(switchInfill(infill, kind))}
      />
      {infill.kind === "balusters" ? (
        <IntField
          label={t.t("ui.guards.infill.balusterSpacing")}
          hint={toValidate}
          value={infill.spacing}
          min={1}
          onCommit={set([...base, "spacing"])}
        />
      ) : null}
      {infill.kind === "rails" || infill.kind === "cables" ? (
        <IntField
          label={
            infill.kind === "rails"
              ? t.t("ui.guards.infill.railCount")
              : t.t("ui.guards.infill.cableCount")
          }
          unit=""
          value={infill.count}
          min={1}
          max={infill.kind === "rails" ? 30 : 40}
          onCommit={set([...base, "count"])}
        />
      ) : null}
      {infill.kind === "cables" ? (
        <IntField
          label={t.t("ui.guards.infill.cableDiameter")}
          value={infill.diameter}
          min={1}
          onCommit={set([...base, "diameter"])}
        />
      ) : null}
      {infillHasSection(infill) ? (
        <SectionEditor
          legend={
            infill.kind === "balusters"
              ? t.t("ui.guards.infill.balusterSection")
              : t.t("ui.guards.infill.railSection")
          }
          section={infill.section}
          path={[...base, "section"]}
        />
      ) : null}
      {infillIsPanel(infill) ? (
        <>
          <IntField
            label={
              infill.kind === "glass"
                ? t.t("ui.guards.infill.glassThickness")
                : t.t("ui.guards.infill.panelThickness")
            }
            hint={toValidate}
            value={infill.thickness}
            min={1}
            onCommit={set([...base, "thickness"])}
          />
          <IntField
            label={t.t("ui.guards.infill.panelGap")}
            value={infill.panelGap}
            min={0}
            onCommit={set([...base, "panelGap"])}
          />
        </>
      ) : null}
      {infill.kind === "perforated" ? (
        <IntField
          label={t.t("ui.guards.infill.holeDiameter")}
          value={infill.holeDiameter}
          min={1}
          onCommit={set([...base, "holeDiameter"])}
        />
      ) : null}
      <IntField
        label={t.t("ui.guards.infill.bottomGap.label")}
        hint={t.t("ui.guards.infill.bottomGap.hint")}
        value={infill.bottomGap}
        min={0}
        onCommit={set([...base, "bottomGap"])}
      />
      {infill.kind === "glass" ? (
        <p className="muted">{t.t("ui.guards.infill.glassNote")}</p>
      ) : null}
    </fieldset>
  );
}

function GuardsEditor({ guards, going }: { guards: GuardsSpec; going: number }) {
  const { flight, opening, posts, handrail } = guards;
  const walls = useApp((s) => s.project.site.walls.length);
  const t = useT();
  const toValidate = t.t("ui.guards.toValidate");
  return (
    <>
      <fieldset>
        <legend>{t.t("ui.guards.flight.legend")}</legend>
        <CheckField
          label={t.t("ui.guards.flight.enabled")}
          checked={flight.enabled}
          onCommit={set([...G, "flight", "enabled"])}
        />
        <SelectField
          label={t.t("ui.guards.flight.inner")}
          value={flight.inner}
          options={options(SIDE_MODE_LABELS, t)}
          onCommit={set([...G, "flight", "inner"])}
        />
        <SelectField
          label={t.t("ui.guards.flight.outer")}
          value={flight.outer}
          options={options(SIDE_MODE_LABELS, t)}
          onCommit={set([...G, "flight", "outer"])}
        />
        <p className="muted">
          {walls === 0
            ? t.t("ui.guards.flight.noWalls")
            : t.t("ui.guards.flight.walls", { count: walls })}
        </p>
        <IntField
          label={t.t("ui.guards.flight.height.label")}
          hint={t.t("ui.guards.flight.height.hint")}
          value={flight.height}
          min={1}
          onCommit={set([...G, "flight", "height"])}
        />
        <IntField
          label={t.t("ui.guards.flight.edgeOffset")}
          hint={toValidate}
          value={flight.edgeOffset}
          min={0}
          onCommit={set([...G, "flight", "edgeOffset"])}
        />
      </fieldset>
      <fieldset>
        <legend>{t.t("ui.guards.opening.legend")}</legend>
        <CheckField
          label={t.t("ui.guards.opening.enabled")}
          checked={opening.enabled}
          onCommit={set([...G, "opening", "enabled"])}
        />
        <IntField
          label={t.t("ui.guards.opening.height.label")}
          hint={t.t("ui.guards.opening.height.hint")}
          value={opening.height}
          min={1}
          onCommit={set([...G, "opening", "height"])}
        />
        <IntField
          label={t.t("ui.guards.opening.setback")}
          hint={toValidate}
          value={opening.setback}
          min={0}
          onCommit={set([...G, "opening", "setback"])}
        />
      </fieldset>
      <InfillEditor infill={guards.infill} />
      <fieldset>
        <legend>{t.t("ui.guards.posts.legend")}</legend>
        <IntField
          label={t.t("ui.guards.posts.size")}
          hint={toValidate}
          value={posts.size}
          min={1}
          onCommit={set([...G, "posts", "size"])}
        />
        <IntField
          label={t.t("ui.guards.posts.maxSpacing")}
          hint={toValidate}
          value={posts.maxSpacing}
          min={1}
          onCommit={set([...G, "posts", "maxSpacing"])}
        />
        <NumberField
          label={t.t("ui.guards.posts.cornerAngle")}
          unit="°"
          hint={toValidate}
          value={posts.cornerAngle}
          min={0}
          max={180}
          parse={parseDecimal}
          format={(v) => formatDecimal(v, t.locale)}
          onCommit={set([...G, "posts", "cornerAngle"])}
        />
      </fieldset>
      <fieldset>
        <legend>{t.t("ui.guards.handrail.legend")}</legend>
        <SectionEditor
          legend={t.t("ui.guards.handrail.section")}
          section={handrail.section}
          path={[...G, "handrail", "section"]}
        />
        <IntField
          label={t.t("ui.guards.handrail.height.label")}
          hint={t.t("ui.guards.handrail.height.hint")}
          value={handrail.height}
          min={1}
          onCommit={set([...G, "handrail", "height"])}
        />
        <SelectField
          label={t.t("ui.guards.handrail.wallSides")}
          value={handrail.wallSides}
          options={options(WALL_SIDES_LABELS, t)}
          onCommit={set([...G, "handrail", "wallSides"])}
        />
        <AutoIntField
          label={t.t("ui.guards.handrail.extensionBottom")}
          value={handrail.extensions.bottom}
          fallback={going}
          hint={t.t("ui.guards.handrail.extensionHint")}
          min={0}
          onCommit={set([...G, "handrail", "extensions", "bottom"])}
        />
        <AutoIntField
          label={t.t("ui.guards.handrail.extensionTop")}
          value={handrail.extensions.top}
          fallback={going}
          hint={t.t("ui.guards.handrail.extensionHint")}
          min={0}
          onCommit={set([...G, "handrail", "extensions", "top"])}
        />
        <IntField
          label={t.t("ui.guards.handrail.wallClearance")}
          value={handrail.wallClearance}
          min={0}
          onCommit={set([...G, "handrail", "wallClearance"])}
        />
      </fieldset>
      <SelectField
        label={t.t("ui.guards.material")}
        hint={toValidate}
        value={guards.material}
        options={GUARD_MATERIAL_OPTIONS.map((o) => ({ value: o.value, label: t.t(o.label) }))}
        onCommit={set([...G, "material"])}
      />
      <IntField
        label={t.t("ui.guards.wallTolerance")}
        hint={toValidate}
        value={guards.wallTolerance}
        min={0}
        onCommit={set([...G, "wallTolerance"])}
      />
    </>
  );
}

export function GuardsSection() {
  const t = useT();
  const guards = useApp((s) => s.project.guards);
  const { model } = useModel();
  // Derniers garde-corps retirés : restaurés si on les réactive.
  const last = useRef<GuardsSpec | null>(null);
  const going = Math.max(0, Math.round(model?.stepping.going ?? 0));
  return (
    <>
      <CheckField
        label={t.t("ui.guards.enabled")}
        checked={guards !== undefined}
        onCommit={(checked) => {
          if (!checked) {
            last.current = guards ?? null;
            return set(G)(undefined);
          }
          return set(G)(last.current ?? defaultGuards());
        }}
      />
      {guards ? (
        <GuardsEditor guards={guards} going={Number.isFinite(going) ? going : 0} />
      ) : (
        <p className="muted">{t.t("ui.guards.none")}</p>
      )}
    </>
  );
}
