/**
 * Choix de la structure (plugin `StructureKind` de `@blondel/core`, liste `listStructures()`)
 * et formulaire de ses paramètres, déduit des défauts et du schéma du plugin, présenté en
 * français (libellés, unités, groupes : `lib/paramLabels.ts`) ; section des profilés choisie
 * dans le catalogue du cœur. Sans plugin disponible, seule la structure « aucune » (marches,
 * contremarches, paliers) est proposée. Dans le parcours guidé, la liste devient des cartes par
 * famille (`StructureCards`), structures incompatibles avec le tracé grisées.
 *
 * Les paramètres sont répartis par niveau (`Tiered`, `structureParamEntry`) ; le crochet
 * `useStructureParamForm` et `structureParamItem` servent aussi à la section « Marches », qui
 * reprend l'essence, le matériau des marches et le rayon de nez (même chemin du projet, même
 * validation, ADR-0009 point 5).
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
import {
  paramKey,
  placementOf,
  structureParamApplies,
  structureParamEntry,
  tierEntry,
  type ParamTierEntry,
} from "../lib/paramTiers.js";
import { autoValueOf } from "../lib/autoValues.js";
import { formatDecimal, parseDecimal, parseIntMm } from "../lib/units.js";
import { appStore, useApp, useModel } from "../store/appStore.js";
import type { UpdateResult } from "../store/projectStore.js";
import { AutoIntField, CheckField, NumberField, SelectField, TextField } from "./fields.js";
import { ChoiceCards, type ChoiceCard } from "./ui/ChoiceCards.js";
import { useValidatedKeys } from "./fabrication/useToValidate.js";
import {
  DISPLAY_ALL,
  hasVisibleItems,
  Tiered,
  type SectionProps,
  type TieredGroup,
  type TieredItem,
} from "./sections/Tiered.js";

export const NO_STRUCTURE = "none";

const FAMILY_LABELS: Readonly<Record<StructureKind["family"], MessageKey>> = {
  bois: "ui.structure.family.bois",
  metal: "ui.structure.family.metal",
  mixte: "ui.structure.family.mixte",
};

/** Entrée de repli du choix de structure (le dictionnaire la définit toujours). */
const KIND_FALLBACK: ParamTierEntry = { tier: "essential", section: "structure", guided: [] };

function setStructure(kind: string, params: Record<string, unknown>): UpdateResult {
  return appStore.getState().setField(["stair", "structure"], { kind, params });
}

/**
 * Valeur retenue par le calcul pour un paramètre en « auto » (`Model.autoValues` du modèle
 * affiché), `undefined` si le modèle ne l'expose pas. Lecture seule.
 */
export function useAutoValue(path: readonly (string | number)[]): number | undefined {
  const { model } = useModel();
  return autoValueOf(model, path);
}

/** Champ d'un paramètre de plugin (libellé, unité, aide et bornes présentés par `paramLabels`). */
export function ParamInput({
  field,
  value,
  onCommit,
}: {
  field: PresentedField;
  value: unknown;
  onCommit: (v: unknown) => UpdateResult;
}) {
  const t = useT();
  const computed = useAutoValue(["stair", "structure", "params", ...field.path]);
  // Aide « à valider » retirée quand la valeur ◆ est validée (`Project.validatedValues`).
  const validated = useValidatedKeys();
  const shownHint =
    field.toValidateHint === true &&
    validated.has(paramKey(["stair", "structure", "params", ...field.path]))
      ? undefined
      : field.hint;
  const hint = shownHint === undefined ? {} : { hint: shownHint };
  switch (field.kind) {
    case "number": {
      const bounds = {
        ...(field.min === undefined ? {} : { min: field.min }),
        ...(field.max === undefined ? {} : { max: field.max }),
      };
      const n = typeof value === "number" ? value : Number.NaN;
      if (field.optional) {
        // Facultatif sans défaut : vide = paramètre absent (NaN dans le champ, `undefined` au
        // projet), sinon nombre lu comme le champ non facultatif. Champ vide : « Auto » écrit
        // dans le champ (comportement du plugin sans valeur, expliqué par l'aide), avec la valeur
        // retenue si le modèle l'expose (`Model.autoValues`), jamais un champ blanc.
        const read = field.integer ? parseIntMm : parseDecimal;
        const auto =
          computed === undefined
            ? t.t("ui.common.input.auto")
            : t.t("ui.param.optionalAuto", { value: formatDecimal(computed, t.locale) });
        return (
          <NumberField
            label={field.label}
            value={n}
            unit={field.unit}
            placeholder={auto}
            hint={shownHint ?? t.t("ui.structure.optionalHint")}
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
      // Valeur retenue par le plugin en mode Auto (`Model.autoValues`) affichée à côté
      // d'« Auto » ; non exposée : libellé neutre (« calculé »), jamais la borne. « Imposer »
      // part alors de la borne minimale du plugin (simple point de départ de la saisie).
      const fallback = Math.max(1, Math.ceil(field.min ?? 1));
      return (
        <AutoIntField
          label={field.label}
          value={typeof value === "number" ? value : "auto"}
          computed={computed}
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

/** Formulaire des paramètres du plugin de structure courant. */
export interface StructureParamForm {
  /** Plugins disponibles. */
  readonly kinds: readonly StructureKind[];
  /** Plugin courant (`undefined` : structure « aucune » ou plugin absent). */
  readonly plugin: StructureKind | undefined;
  readonly ctx: StructureContext | undefined;
  /** Défauts du plugin (`undefined` : non calculables, modèle partiel). */
  readonly defaults: unknown;
  /** Paramètres du projet complétés par les défauts. */
  readonly params: Record<string, unknown>;
  /** Champs présentés dans la langue d'affichage. */
  readonly fields: readonly PresentedField[];
  /** Modification d'un champ, validée par le schéma du plugin. */
  readonly onParam: (field: ParamField) => (value: unknown) => UpdateResult;
  /** Dernier refus du schéma du plugin. */
  readonly error: Message | null;
  readonly setError: (error: Message | null) => void;
}

/**
 * Formulaire des paramètres du plugin courant : défauts et champs déduits du plugin, validation
 * par son schéma (`validateParams`), une modification = une entrée d'historique.
 */
export function useStructureParamForm(): StructureParamForm {
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
  // Champs qui s'appliquent au projet seulement (tôle pliée, poteau : `structureParamApplies`).
  const fields = useMemo(
    () =>
      plugin && defaults !== undefined
        ? presentFields(
            plugin.kind,
            deriveParamFields(defaults, plugin.paramsSchema).filter((f) =>
              structureParamApplies(project, params, f.path),
            ),
            params,
            t,
          )
        : [],
    [plugin, defaults, params, project, t],
  );

  const onParam =
    (field: ParamField) =>
    (value: unknown): UpdateResult => {
      if (!plugin) return { ok: false, issues: [msg("ui.structure.pluginUnavailable")] };
      const next = afterParamChange(
        plugin.kind,
        field.path,
        setParam(withDefaults(defaults, structure.params), field.path, value),
      );
      const invalid = validateParams(plugin, next);
      if (invalid) {
        setError(invalid);
        return { ok: false, issues: [invalid] };
      }
      setError(null);
      return setStructure(structure.kind, next);
    };

  return { kinds, plugin, ctx, defaults, params, fields, onParam, error, setError };
}

/**
 * Élément `Tiered` d'un paramètre de plugin : clé `stair.structure.params.<chemin>`, entrée
 * `structureParamEntry` (niveau, ◆ déduit de `paramLabels`).
 */
export function structureParamItem(
  form: StructureParamForm,
  field: PresentedField,
  group?: TieredGroup,
): TieredItem {
  const kind = form.plugin?.kind ?? NO_STRUCTURE;
  return {
    key: paramKey(["stair", "structure", "params", ...field.path]),
    entry: structureParamEntry(kind, field.path),
    ...(group === undefined ? {} : { group }),
    node: (
      <ParamInput
        field={field}
        value={getParam(form.params, field.path)}
        onCommit={form.onParam(field)}
      />
    ),
  };
}

/** Refus du schéma du plugin (sous le formulaire). */
export function StructureParamError({ error }: { error: Message | null }) {
  const t = useT();
  return error ? (
    <small className="field__error" role="alert">
      {t.t(error)}
    </small>
  ) : null;
}

/**
 * Choix de la structure `kind` (liste du parcours libre ou cartes du guidé) : paramètres complets
 * du plugin (ses valeurs par défaut) et jour adapté (poteau d'angle, poteau des profilés) en une
 * seule modification du projet, donc une seule entrée d'historique ; la remarque du cœur devient
 * une notice d'information. Sans effet si `kind` est la structure courante.
 */
export function selectStructureKind(
  kind: string,
  current: string,
  kinds: readonly StructureKind[],
  ctx: StructureContext | undefined,
): UpdateResult {
  if (kind === current) return { ok: true };
  const k = kinds.find((x) => x.kind === kind);
  // Paramètres complets du plugin enregistrés au choix (valeurs par défaut du plugin) : le
  // projet reste lisible même si les défauts changent avec le tracé.
  const d = kind === NO_STRUCTURE || !k ? undefined : safeDefaults(k, ctx);
  const params = kind === NO_STRUCTURE ? {} : withDefaults(d, {});
  let notice: Message | null = null;
  const r = appStore.getState().update((p) => {
    const c = chooseStructure(p, kind, params);
    notice = c.notice;
    return c.project;
  });
  if (r.ok && notice !== null) appStore.setState({ notice: { kind: "info", msg: notice } });
  return r;
}

const FAMILY_ORDER: readonly StructureKind["family"][] = ["bois", "metal", "mixte"];

/** Titres des groupes de cartes, par famille. */
const FAMILY_TITLES: Readonly<Record<StructureKind["family"], MessageKey>> = {
  bois: "ui.guided.cards.structure.family.bois",
  metal: "ui.guided.cards.structure.family.metal",
  mixte: "ui.guided.cards.structure.family.mixte",
};

/**
 * Cartes de structure du parcours guidé (spécification de contenu § 3) : « Aucune structure »
 * d'abord (et le plugin indisponible du projet, s'il y en a un), puis un groupe par famille. Une
 * structure incompatible avec le tracé est grisée, sa raison écrite.
 */
function StructureCards({
  kinds,
  current,
  missing,
  onKind,
}: {
  kinds: readonly StructureKind[];
  current: string;
  missing: boolean;
  onKind: (kind: string) => UpdateResult;
}) {
  const t = useT();
  const layoutKind = useApp((s) => layoutKindOf(s.project));
  const isPressed = (k: string): boolean => k === current;
  const choose = (k: string): void => {
    onKind(k);
  };
  const reason = t.t(
    layoutKind === "helical"
      ? "ui.guided.cards.structure.flightsOnly"
      : "ui.guided.cards.structure.helicalOnly",
  );
  const first: ChoiceCard<string>[] = [
    {
      value: NO_STRUCTURE,
      label: t.t("ui.guided.cards.structure.none"),
      caption: t.t("ui.guided.cards.structure.noneCaption"),
    },
    ...(missing
      ? [{ value: current, label: t.t("ui.structure.pluginMissing", { kind: current }) }]
      : []),
  ];
  return (
    <div className="structure-cards" role="group" aria-label={t.t("ui.structure.label")}>
      <ChoiceCards
        label={t.t("ui.guided.cards.structure.none")}
        cards={first}
        isPressed={isPressed}
        onChoose={choose}
      />
      {FAMILY_ORDER.map((family) => {
        const members = kinds.filter((k) => k.family === family);
        if (members.length === 0) return null;
        const title = t.t(FAMILY_TITLES[family]);
        return (
          <div key={family} className="structure-cards__family">
            <p className="eyebrow structure-cards__title" aria-hidden="true">
              {title}
            </p>
            <ChoiceCards
              label={title}
              cards={members.map((k) => {
                const fits = structureFitsLayout(k.kind, layoutKind);
                return {
                  value: k.kind,
                  label: t.t(k.labelKey),
                  caption: t.t(FAMILY_LABELS[k.family]),
                  ...(fits ? {} : { disabled: true, reason }),
                };
              })}
              isPressed={isPressed}
              onChoose={choose}
            />
          </div>
        );
      })}
    </div>
  );
}

export function StructureSection({ display = DISPLAY_ALL }: Partial<SectionProps> = {}) {
  const t = useT();
  const structure = useApp((s) => s.project.stair.structure);
  const project = useApp((s) => s.project);
  const form = useStructureParamForm();
  const { kinds, plugin, ctx, defaults, fields, setError } = form;

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
    return selectStructureKind(kind, structure.kind, kinds, ctx);
  };
  const guided = display.kind === "guided";

  // Paramètres : principaux d'abord, puis un sous-groupe repliable par sous-objet, dans chaque
  // zone (principale, « Plus de réglages », « Réglages d'atelier »).
  const items: TieredItem[] = groupFields(fields).flatMap(({ group, fields: gf }) => {
    const g: TieredGroup | undefined =
      group === undefined
        ? undefined
        : {
            id: group,
            render: (children) => (
              <details className="structure-params__group">
                <summary>{groupLabel(group, t)}</summary>
                {children}
              </details>
            ),
          };
    return gf.map((f) => structureParamItem(form, f, g));
  });
  const kindVisible =
    placementOf(tierEntry("stair.structure.kind") ?? KIND_FALLBACK, display) !== "hidden";

  return (
    <>
      {kindVisible ? (
        <>
          {guided ? (
            <StructureCards
              kinds={kinds}
              current={structure.kind}
              missing={structure.kind !== NO_STRUCTURE && !plugin}
              onKind={onKind}
            />
          ) : (
            <SelectField
              label={t.t("ui.structure.label")}
              value={structure.kind}
              options={options}
              onCommit={onKind}
            />
          )}
          {kinds.length === 0 ? <p className="muted">{t.t("ui.structure.noPlugin")}</p> : null}
          {plugin && defaults === undefined ? (
            <p className="muted">{t.t("ui.structure.paramsUnavailable")}</p>
          ) : null}
        </>
      ) : null}
      {hasVisibleItems(items, display) ? (
        <fieldset className="structure-params">
          <legend>
            {t.t("ui.structure.paramsLegend", { name: plugin ? msg(plugin.labelKey) : "" })}
          </legend>
          <Tiered display={display} items={items} />
        </fieldset>
      ) : null}
      <StructureParamError error={form.error} />
    </>
  );
}
