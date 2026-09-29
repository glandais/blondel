/**
 * Choix de la structure (plugin `StructureKind` de `@blondel/core`, liste `listStructures()`)
 * et formulaire générique de ses paramètres, déduit des défauts et du schéma du plugin. Sans
 * plugin disponible, seule la structure « aucune » (marches, contremarches, paliers) est
 * proposée.
 */
import type { StructureContext, StructureKind } from "@blondel/core";
import { useMemo, useState } from "react";
import { availableStructures } from "../lib/optionalApi.js";
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
import { formatDecimal, parseDecimal } from "../lib/units.js";
import { appStore, useApp, useModel } from "../store/appStore.js";
import type { UpdateResult } from "../store/projectStore.js";
import { CheckField, NumberField, SelectField, TextField } from "./fields.js";

export const NO_STRUCTURE = "none";

const FAMILY_LABELS: Readonly<Record<StructureKind["family"], string>> = {
  bois: "bois",
  metal: "métal",
  mixte: "mixte",
};

function setStructure(kind: string, params: Record<string, unknown>): UpdateResult {
  return appStore.getState().setField(["stair", "structure"], { kind, params });
}

function ParamInput({
  field,
  value,
  onCommit,
}: {
  field: ParamField;
  value: unknown;
  onCommit: (v: unknown) => UpdateResult;
}) {
  switch (field.kind) {
    case "number": {
      const bounds = {
        ...(field.min === undefined ? {} : { min: field.min }),
        ...(field.max === undefined ? {} : { max: field.max }),
      };
      const n = typeof value === "number" ? value : Number.NaN;
      return field.integer ? (
        <NumberField label={field.label} value={n} unit="" {...bounds} onCommit={onCommit} />
      ) : (
        <NumberField
          label={field.label}
          value={n}
          unit=""
          {...bounds}
          parse={parseDecimal}
          format={formatDecimal}
          onCommit={onCommit}
        />
      );
    }
    case "enum":
      return (
        <SelectField
          label={field.label}
          value={String(value)}
          options={field.options.map((o) => ({ value: o, label: o }))}
          onCommit={onCommit}
        />
      );
    case "boolean":
      return <CheckField label={field.label} checked={value === true} onCommit={onCommit} />;
    case "text":
      return <TextField label={field.label} value={String(value ?? "")} onCommit={onCommit} />;
    case "readonly":
      return (
        <p className="muted">
          {field.label} : {JSON.stringify(value)}
        </p>
      );
  }
}

export function StructureSection() {
  const structure = useApp((s) => s.project.stair.structure);
  const project = useApp((s) => s.project);
  const { model } = useModel();
  const [error, setError] = useState<string | null>(null);
  const kinds = useMemo(() => availableStructures(), []);
  const plugin = kinds.find((k) => k.kind === structure.kind);
  const ctx: StructureContext | undefined = useMemo(
    () => structureContext(project, model),
    [model, project],
  );
  const defaults = useMemo(() => (plugin ? safeDefaults(plugin, ctx) : undefined), [plugin, ctx]);
  const fields = useMemo(
    () =>
      plugin && defaults !== undefined ? deriveParamFields(defaults, plugin.paramsSchema) : [],
    [plugin, defaults],
  );

  const options = [
    { value: NO_STRUCTURE, label: "Aucune (marches, contremarches, paliers)" },
    ...kinds.map((k) => ({ value: k.kind, label: `${k.label} (${FAMILY_LABELS[k.family]})` })),
    ...(structure.kind !== NO_STRUCTURE && !plugin
      ? [{ value: structure.kind, label: `${structure.kind} (plugin indisponible)` }]
      : []),
  ];

  const onKind = (kind: string): UpdateResult => {
    setError(null);
    if (kind === structure.kind) return { ok: true };
    if (kind === NO_STRUCTURE) return setStructure(NO_STRUCTURE, {});
    const k = kinds.find((x) => x.kind === kind);
    // Paramètres complets du plugin enregistrés au choix (valeurs par défaut du plugin) : le
    // projet reste lisible même si les défauts changent avec le tracé.
    const d = k ? safeDefaults(k, ctx) : undefined;
    return setStructure(kind, withDefaults(d, {}));
  };

  const onParam =
    (field: ParamField) =>
    (value: unknown): UpdateResult => {
      if (!plugin) return { ok: false, issues: ["Plugin de structure indisponible."] };
      const next = setParam(withDefaults(defaults, structure.params), field.path, value);
      const invalid = validateParams(plugin, next);
      if (invalid) {
        setError(invalid);
        return { ok: false, issues: [invalid] };
      }
      setError(null);
      return setStructure(structure.kind, next);
    };

  return (
    <>
      <SelectField label="Structure" value={structure.kind} options={options} onCommit={onKind} />
      {kinds.length === 0 ? (
        <p className="muted">Aucun plugin de structure disponible dans le cœur.</p>
      ) : null}
      {plugin && defaults === undefined ? (
        <p className="muted">
          Paramètres indisponibles : le tracé et le découpage doivent être calculés sans erreur.
        </p>
      ) : null}
      {fields.length > 0 ? (
        <fieldset className="structure-params">
          <legend>Paramètres de {plugin?.label}</legend>
          {fields.map((f) => (
            <ParamInput
              key={f.path.join(".")}
              field={f}
              value={getParam(structure.params, f.path) ?? getParam(defaults, f.path)}
              onCommit={onParam(f)}
            />
          ))}
        </fieldset>
      ) : null}
      {error ? (
        <small className="field__error" role="alert">
          {error}
        </small>
      ) : null}
    </>
  );
}
