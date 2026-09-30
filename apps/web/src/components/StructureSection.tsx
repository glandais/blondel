/**
 * Choix de la structure (plugin `StructureKind` de `@blondel/core`, liste `listStructures()`)
 * et formulaire de ses paramètres, déduit des défauts et du schéma du plugin, présenté en
 * français (libellés, unités, groupes : `lib/paramLabels.ts`) ; section des profilés choisie
 * dans le catalogue du cœur. Sans plugin disponible, seule la structure « aucune » (marches,
 * contremarches, paliers) est proposée.
 */
import type { StructureContext, StructureKind } from "@blondel/core";
import { useMemo, useState } from "react";
import { msg, type Message, type MessageKey } from "@blondel/i18n";
import { useT } from "../i18n/useT.js";
import { layoutKindOf, structureFitsLayout } from "../lib/layoutKind.js";
import { availableStructures } from "../lib/optionalApi.js";
import { chooseStructure } from "../lib/structureChoice.js";
import {
  deriveParamFields,
  getParam,
  safeDefaults,
  setParam,
  structureContext,
  validateParams,
  withDefaults,
  type ParamField,
} from "../lib/structureForm.js";
import {
  afterParamChange,
  groupLabel,
  presentFields,
  type PresentedField,
} from "../lib/paramLabels.js";
import { formatDecimal, parseDecimal, parseIntMm } from "../lib/units.js";
import { appStore, useApp, useModel } from "../store/appStore.js";
import type { UpdateResult } from "../store/projectStore.js";
import { AutoIntField, CheckField, NumberField, SelectField, TextField } from "./fields.js";

export const NO_STRUCTURE = "none";

const FAMILY_LABELS: Readonly<Record<StructureKind["family"], MessageKey>> = {
  bois: "ui.structure.family.bois",
  metal: "ui.structure.family.metal",
  mixte: "ui.structure.family.mixte",
};

function setStructure(kind: string, params: Record<string, unknown>): UpdateResult {
  return appStore.getState().setField(["stair", "structure"], { kind, params });
}

function ParamInput({
  field,
  value,
  onCommit,
}: {
  field: PresentedField;
  value: unknown;
  onCommit: (v: unknown) => UpdateResult;
}) {
  const t = useT();
  const hint = field.hint === undefined ? {} : { hint: field.hint };
  switch (field.kind) {
    case "number": {
      const bounds = {
        ...(field.min === undefined ? {} : { min: field.min }),
        ...(field.max === undefined ? {} : { max: field.max }),
      };
      const n = typeof value === "number" ? value : Number.NaN;
      if (field.optional) {
        // Facultatif sans défaut : vide = paramètre absent (NaN dans le champ, `undefined` au
        // projet), sinon nombre lu comme le champ non facultatif.
        const read = field.integer ? parseIntMm : parseDecimal;
        return (
          <NumberField
            label={field.label}
            value={n}
            unit={field.unit}
            hint={field.hint ?? t.t("ui.structure.optionalHint")}
            {...bounds}
            parse={(text, b) =>
              text.trim() === "" ? { ok: true, value: Number.NaN } : read(text, b)
            }
            format={(v) =>
              Number.isNaN(v) ? "" : field.integer ? String(v) : formatDecimal(v, t.locale)
            }
            onCommit={(v) => onCommit(Number.isNaN(v) ? undefined : v)}
          />
        );
      }
      return field.integer ? (
        <NumberField
          label={field.label}
          value={n}
          unit={field.unit}
          {...hint}
          {...bounds}
          onCommit={onCommit}
        />
      ) : (
        <NumberField
          label={field.label}
          value={n}
          unit={field.unit}
          {...hint}
          {...bounds}
          parse={parseDecimal}
          format={(v) => formatDecimal(v, t.locale)}
          onCommit={onCommit}
        />
      );
    }
    case "auto-number": {
      // Sortie du mode automatique : borne minimale du plugin (valeur à saisir, aucune règle).
      const fallback = Math.max(1, Math.ceil(field.min ?? 1));
      return (
        <AutoIntField
          label={field.label}
          value={typeof value === "number" ? value : "auto"}
          fallback={fallback}
          unit={field.unit}
          {...hint}
          {...(field.min === undefined ? {} : { min: field.min })}
          {...(field.max === undefined ? {} : { max: field.max })}
          onCommit={onCommit}
        />
      );
    }
    case "enum":
      return (
        <SelectField
          label={field.label}
          value={String(value)}
          {...hint}
          options={field.options.map((o) => ({ value: o, label: field.optionLabels?.[o] ?? o }))}
          onCommit={onCommit}
        />
      );
    case "boolean":
      return <CheckField label={field.label} checked={value === true} onCommit={onCommit} />;
    case "text":
      return (
        <TextField label={field.label} value={String(value ?? "")} {...hint} onCommit={onCommit} />
      );
    case "readonly":
      return (
        <p className="muted">
          {t.t("ui.structure.readonly", { label: field.label, value: JSON.stringify(value) })}
        </p>
      );
  }
}

/** Champs regroupés : principaux d'abord, puis un groupe par sous-objet (ordre d'apparition). */
function groupFields(
  fields: readonly PresentedField[],
): { group: string | undefined; fields: PresentedField[] }[] {
  const out: { group: string | undefined; fields: PresentedField[] }[] = [];
  for (const f of fields) {
    let g = out.find((x) => x.group === f.group);
    if (!g) {
      g = { group: f.group, fields: [] };
      if (f.group === undefined) out.unshift(g);
      else out.push(g);
    }
    g.fields.push(f);
  }
  return out;
}

export function StructureSection() {
  const t = useT();
  const structure = useApp((s) => s.project.stair.structure);
  const project = useApp((s) => s.project);
  const { model } = useModel();
  const [error, setError] = useState<Message | null>(null);
  const kinds = useMemo(() => availableStructures(), []);
  const plugin = kinds.find((k) => k.kind === structure.kind);
  const ctx: StructureContext | undefined = useMemo(
    () => structureContext(project, model),
    [model, project],
  );
  const defaults = useMemo(() => (plugin ? safeDefaults(plugin, ctx) : undefined), [plugin, ctx]);
  const params = useMemo(
    () => withDefaults(defaults, structure.params),
    [defaults, structure.params],
  );
  const fields = useMemo(
    () =>
      plugin && defaults !== undefined
        ? presentFields(plugin.kind, deriveParamFields(defaults, plugin.paramsSchema), params, t)
        : [],
    [plugin, defaults, params, t],
  );

  const layoutKind = layoutKindOf(project);
  const options = [
    { value: NO_STRUCTURE, label: t.t("ui.structure.none") },
    ...kinds.map((k) => ({
      value: k.kind,
      label: t.t(
        structureFitsLayout(k.kind, layoutKind)
          ? "ui.structure.option"
          : layoutKind === "helical"
            ? "ui.structure.optionFlightsOnly"
            : "ui.structure.optionHelicalOnly",
        { label: msg(k.labelKey), family: msg(FAMILY_LABELS[k.family]) },
      ),
    })),
    ...(structure.kind !== NO_STRUCTURE && !plugin
      ? [
          {
            value: structure.kind,
            label: t.t("ui.structure.pluginMissing", { kind: structure.kind }),
          },
        ]
      : []),
  ];

  const onKind = (kind: string): UpdateResult => {
    setError(null);
    if (kind === structure.kind) return { ok: true };
    const k = kinds.find((x) => x.kind === kind);
    // Paramètres complets du plugin enregistrés au choix (valeurs par défaut du plugin) : le
    // projet reste lisible même si les défauts changent avec le tracé.
    const d = kind === NO_STRUCTURE || !k ? undefined : safeDefaults(k, ctx);
    const params = kind === NO_STRUCTURE ? {} : withDefaults(d, {});
    // Structure et jour adapté (poteau d'angle, poteau des profilés) en une seule modification.
    let notice: Message | null = null;
    const r = appStore.getState().update((p) => {
      const c = chooseStructure(p, kind, params);
      notice = c.notice;
      return c.project;
    });
    if (r.ok && notice !== null) appStore.setState({ notice: { kind: "info", msg: notice } });
    return r;
  };

  const onParam =
    (field: ParamField) =>
    (value: unknown): UpdateResult => {
      if (!plugin) return { ok: false, issues: [t.t("ui.structure.pluginUnavailable")] };
      const next = afterParamChange(
        plugin.kind,
        field.path,
        setParam(withDefaults(defaults, structure.params), field.path, value),
      );
      const invalid = validateParams(plugin, next);
      if (invalid) {
        setError(invalid);
        return { ok: false, issues: [t.t(invalid)] };
      }
      setError(null);
      return setStructure(structure.kind, next);
    };

  return (
    <>
      <SelectField
        label={t.t("ui.structure.label")}
        value={structure.kind}
        options={options}
        onCommit={onKind}
      />
      {kinds.length === 0 ? <p className="muted">{t.t("ui.structure.noPlugin")}</p> : null}
      {plugin && defaults === undefined ? (
        <p className="muted">{t.t("ui.structure.paramsUnavailable")}</p>
      ) : null}
      {fields.length > 0 ? (
        <fieldset className="structure-params">
          <legend>
            {t.t("ui.structure.paramsLegend", { name: plugin ? msg(plugin.labelKey) : "" })}
          </legend>
          {groupFields(fields).map(({ group, fields: gf }) => {
            const inputs = gf.map((f) => (
              <ParamInput
                key={f.path.join(".")}
                field={f}
                value={getParam(params, f.path)}
                onCommit={onParam(f)}
              />
            ));
            return group === undefined ? (
              inputs
            ) : (
              <details key={group} className="structure-params__group">
                <summary>{groupLabel(group, t)}</summary>
                {inputs}
              </details>
            );
          })}
        </fieldset>
      ) : null}
      {error ? (
        <small className="field__error" role="alert">
          {t.t(error)}
        </small>
      ) : null}
    </>
  );
}
