/**
 * Réglages d'atelier d'une pièce, partagés par l'inspecteur Pièce (maquette 2b) et la colonne de
 * droite du mode Fabrication (wireframe « Parcours libre · Fabrication ») :
 *
 * - pièce de la structure : champs du plugin de structure courant repris pour la famille de
 *   pièces (`partSettingsFor`), rendus comme dans la section Structure (`ParamInput`, même
 *   chemin du projet, même validation par le schéma du plugin, Auto | valeur retenue) ;
 * - pièce de garde-corps : champs de la section Garde-corps qui concernent la catégorie de la
 *   pièce (poteau, main courante, balustre ou remplissage selon le type ; `guardParams`), mêmes
 *   chemins sous `guards`, même validation par le schéma du projet.
 *
 * Chaque modification passe par le projectStore : elle est annulable (Annuler, Ctrl+Z).
 *
 * - `inspector` : bloc « Réglages d'atelier » de la 2b (champs Conception et Atelier repris,
 *   lien « Tous les réglages dans … ») ;
 * - `fabrication` : surtitre « Réglages d'atelier de la pièce », champs de niveau Atelier
 *   seulement, mention « ◆ valeur par défaut à valider » sous un champ ◆ non validé, note de
 *   portée. Rien n'est rendu si aucun champ Atelier n'est repris.
 *
 * Dans les deux cas, la marque ◆ ne s'affiche que pour une valeur non encore validée
 * (`validatedValues` du projet, lu par `useValidatedKeys`) ; le glyphe n'entre jamais dans un
 * nom accessible (`TvMark`).
 */
import type { GuardSection, GuardsSpec, Part } from "@blondel/core";
import { msg } from "@blondel/i18n";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "../../i18n/useT.js";
import { SECTION_KIND_LABELS, infillIsPanel, switchSection } from "../../lib/guardsForm.js";
import {
  isToValidate,
  paramKey,
  structureParamEntry,
  tierEntry,
  type Tier,
} from "../../lib/paramTiers.js";
import { matchesSettings, type PartSettings } from "../../lib/partSettings.js";
import type { PresentedField } from "../../lib/paramLabels.js";
import { getParam } from "../../lib/structureForm.js";
import { formatDecimal, parseDecimal } from "../../lib/units.js";
import { appStore, useApp, useModel } from "../../store/appStore.js";
import type { Path } from "../../store/setIn.js";
import { openSection } from "../../store/uiStore.js";
import { useValidatedKeys } from "../fabrication/useToValidate.js";
import { AutoIntField, IntField, NumberField } from "../fields.js";
import {
  NO_STRUCTURE,
  ParamInput,
  StructureParamError,
  useStructureParamForm,
  type StructureParamForm,
} from "../StructureSection.js";
import { SECTION_TITLE_KEYS } from "../sections/index.js";
import { Segmented } from "../ui/Segmented.js";
import { TvMark } from "../ui/TvMark.js";
import "./frame.css";
import "./part.css";

export interface PartWorkshopSettingsProps {
  readonly part: Part;
  readonly settings: PartSettings;
  readonly variant: "inspector" | "fabrication";
}

/** Nombre maximal de choix d'une liste rendue en segmenté dans les réglages d'atelier. */
const SEGMENTED_MAX_OPTIONS = 3;

/** Clé du dictionnaire des niveaux (et de `validatedValues`) d'un paramètre de plugin. */
function fieldKey(field: PresentedField): string {
  return paramKey(["stair", "structure", "params", ...field.path]);
}

/** Champ compact : liste courte en segmenté (maquette 2b), sinon `ParamInput`. */
function FieldInput({ form, field }: { form: StructureParamForm; field: PresentedField }) {
  const value = getParam(form.params, field.path);
  if (field.kind === "enum" && field.options.length <= SEGMENTED_MAX_OPTIONS) {
    return (
      <div className="part-insp__seg-row">
        <span className="part-insp__seg-label" aria-hidden="true">
          {field.label}
        </span>
        <Segmented
          label={field.label}
          size="sm"
          value={String(value)}
          options={field.options.map((o) => ({ value: o, label: field.optionLabels?.[o] ?? o }))}
          onChange={(v) => form.onParam(field)(v)}
        />
      </div>
    );
  }
  return <ParamInput field={field} value={value} onCommit={form.onParam(field)} />;
}

// ------------------------------------------------------------------ Garde-corps

const setGuard = (path: Path) => (value: unknown) => appStore.getState().setField(path, value);

/** Section d'une main courante, d'un balustre ou d'une lisse : forme en segmenté, dimensions. */
function GuardSectionInput({
  label,
  section,
  path,
}: {
  label: string;
  section: GuardSection;
  path: Path;
}) {
  const t = useT();
  return (
    <>
      <div className="part-insp__seg-row">
        <span className="part-insp__seg-label" aria-hidden="true">
          {label}
        </span>
        <Segmented<GuardSection["kind"]>
          label={label}
          size="sm"
          value={section.kind}
          options={(Object.keys(SECTION_KIND_LABELS) as GuardSection["kind"][]).map((k) => ({
            value: k,
            label: t.t(SECTION_KIND_LABELS[k]),
          }))}
          onChange={(kind) => setGuard(path)(switchSection(section, kind))}
        />
      </div>
      {section.kind === "round" ? (
        <IntField
          label={t.t("ui.guards.section.diameter")}
          value={section.diameter}
          min={1}
          onCommit={setGuard([...path, "diameter"])}
        />
      ) : (
        <>
          <IntField
            label={t.t("ui.guards.section.width")}
            value={section.width}
            min={1}
            onCommit={setGuard([...path, "width"])}
          />
          <IntField
            label={t.t("ui.guards.section.height")}
            value={section.height}
            min={1}
            onCommit={setGuard([...path, "height"])}
          />
        </>
      )}
    </>
  );
}

/**
 * Champ d'un paramètre de garde-corps (chemin complet sous `guards`), mêmes libellés, bornes et
 * chemins que la section Garde-corps. `null` si le chemin ne s'applique pas au remplissage
 * courant (le projet a changé depuis le calcul des chemins).
 */
function GuardField({
  path,
  guards,
  going,
}: {
  path: readonly string[];
  guards: GuardsSpec;
  going: number | undefined;
}): ReactNode {
  const t = useT();
  const p = path as Path;
  const int = (
    label: string,
    value: number,
    min: number,
    extra: { max?: number; unit?: string } = {},
  ) => <IntField label={label} value={value} min={min} {...extra} onCommit={setGuard(p)} />;
  const { posts, flight, opening, handrail, infill } = guards;
  switch (paramKey(path)) {
    case "guards.posts.size":
      return int(t.t("ui.guards.posts.size"), posts.size, 1);
    case "guards.posts.maxSpacing":
      return int(t.t("ui.guards.posts.maxSpacing"), posts.maxSpacing, 1);
    case "guards.posts.cornerAngle":
      return (
        <NumberField
          label={t.t("ui.guards.posts.cornerAngle")}
          unit="°"
          value={posts.cornerAngle}
          min={0}
          max={180}
          parse={parseDecimal}
          format={(v) => formatDecimal(v, t.locale)}
          onCommit={setGuard(p)}
        />
      );
    case "guards.flight.edgeOffset":
      return int(t.t("ui.guards.flight.edgeOffset"), flight.edgeOffset, 0);
    case "guards.opening.setback":
      return int(t.t("ui.guards.opening.setback"), opening.setback, 0);
    case "guards.handrail.section":
      return (
        <GuardSectionInput
          label={t.t("ui.guards.handrail.section")}
          section={handrail.section}
          path={p}
        />
      );
    case "guards.handrail.height":
      return int(t.t("ui.guards.handrail.height.label"), handrail.height, 1);
    case "guards.handrail.extensions.bottom":
    case "guards.handrail.extensions.top": {
      const bottom = path[path.length - 1] === "bottom";
      return (
        <AutoIntField
          label={t.t(
            bottom ? "ui.guards.handrail.extensionBottom" : "ui.guards.handrail.extensionTop",
          )}
          value={bottom ? handrail.extensions.bottom : handrail.extensions.top}
          computed={going}
          fallback={going ?? 0}
          min={0}
          onCommit={setGuard(p)}
        />
      );
    }
    case "guards.handrail.wallClearance":
      return int(t.t("ui.guards.handrail.wallClearance"), handrail.wallClearance, 0);
    case "guards.infill.bottomGap":
      return int(t.t("ui.guards.infill.bottomGap.label"), infill.bottomGap, 0);
    case "guards.infill.spacing":
      return infill.kind === "balusters"
        ? int(t.t("ui.guards.infill.balusterSpacing"), infill.spacing, 1)
        : null;
    case "guards.infill.count":
      return infill.kind === "rails"
        ? int(t.t("ui.guards.infill.railCount"), infill.count, 1, { max: 30, unit: "" })
        : infill.kind === "cables"
          ? int(t.t("ui.guards.infill.cableCount"), infill.count, 1, { max: 40, unit: "" })
          : null;
    case "guards.infill.diameter":
      return infill.kind === "cables"
        ? int(t.t("ui.guards.infill.cableDiameter"), infill.diameter, 1)
        : null;
    case "guards.infill.section":
      return infill.kind === "balusters" || infill.kind === "rails" ? (
        <GuardSectionInput
          label={t.t(
            infill.kind === "balusters"
              ? "ui.guards.infill.balusterSection"
              : "ui.guards.infill.railSection",
          )}
          section={infill.section}
          path={p}
        />
      ) : null;
    case "guards.infill.thickness":
      return infillIsPanel(infill)
        ? int(
            t.t(
              infill.kind === "glass"
                ? "ui.guards.infill.glassThickness"
                : "ui.guards.infill.panelThickness",
            ),
            infill.thickness,
            1,
          )
        : null;
    case "guards.infill.panelGap":
      return infillIsPanel(infill)
        ? int(t.t("ui.guards.infill.panelGap"), infill.panelGap, 0)
        : null;
    case "guards.infill.holeDiameter":
      return infill.kind === "perforated"
        ? int(t.t("ui.guards.infill.holeDiameter"), infill.holeDiameter, 1)
        : null;
    default:
      return null;
  }
}

// ------------------------------------------------------------------ Lignes communes

/** Ligne de réglage : clé du dictionnaire, niveau, ◆ restante, champ. */
interface SettingRow {
  readonly key: string;
  readonly tier: Tier | undefined;
  readonly pending: boolean;
  readonly node: ReactNode;
}

/** Lignes des réglages repris pour la pièce (structure puis garde-corps). */
function useSettingRows(settings: PartSettings): {
  readonly rows: readonly SettingRow[];
  readonly form: StructureParamForm;
} {
  const form = useStructureParamForm();
  const validated = useValidatedKeys();
  const guards = useApp((s) => s.project.guards);
  const { model } = useModel();
  const kind = form.plugin?.kind ?? NO_STRUCTURE;
  const rows: SettingRow[] = [];
  for (const f of form.fields) {
    if (!matchesSettings(f.path, settings.structureParams)) continue;
    const entry = structureParamEntry(kind, f.path);
    const key = fieldKey(f);
    rows.push({
      key,
      tier: entry.tier,
      pending: entry.toValidate === true && !validated.has(key),
      node: <FieldInput form={form} field={f} />,
    });
  }
  if (guards !== undefined) {
    // Prolongements automatiques de la main courante : un giron nominal, lu dans le modèle
    // (comme la section Garde-corps) ; inconnu sans modèle.
    const modelGoing = model?.stepping.going;
    const going =
      modelGoing !== undefined && Number.isFinite(modelGoing)
        ? Math.max(0, Math.round(modelGoing))
        : undefined;
    for (const path of settings.guardParams ?? []) {
      const node = <GuardField path={path} guards={guards} going={going} />;
      const key = paramKey(path);
      rows.push({
        key,
        tier: tierEntry(key)?.tier,
        pending: isToValidate(key) && !validated.has(key),
        node,
      });
    }
  }
  return { rows, form };
}

export function PartWorkshopSettings({ part, settings, variant }: PartWorkshopSettingsProps) {
  const t = useT();
  const { rows: all, form } = useSettingRows(settings);
  const section = settings.section;

  if (variant === "fabrication") {
    const rows = all.filter((r) => r.tier === "workshop");
    if (rows.length === 0) return null;
    return (
      <section
        className="part-insp__settings part-insp__settings--fab"
        aria-label={t.t("ui.partInspector.workshop", { mark: part.mark })}
      >
        <span className="insp-eyebrow">{t.t("ui.fabAside.workshop.eyebrow")}</span>
        {rows.map((r) => (
          <div
            key={r.key}
            className="part-insp__fab-field"
            data-setting={r.key}
            data-to-validate={r.pending ? "true" : undefined}
          >
            {r.node}
            {r.pending ? (
              <small className="part-insp__tv-note">
                <TvMark silent tone="inherit" /> {t.t("ui.fabAside.workshop.toValidate")}
              </small>
            ) : null}
          </div>
        ))}
        <StructureParamError error={form.error} />
        <p className="part-insp__note">
          {t.t(
            section === "guards" ? "ui.fabAside.workshop.noteGuards" : "ui.fabAside.workshop.note",
          )}
        </p>
      </section>
    );
  }

  const row = (r: SettingRow): ReactNode =>
    r.pending ? (
      <div key={r.key} className="tiered__item tiered__item--tv" data-setting={r.key}>
        {r.node}
        <TvMark className="tiered__mark" />
      </div>
    ) : (
      <div key={r.key} data-setting={r.key}>
        {r.node}
      </div>
    );
  return (
    <section
      className="insp-block part-insp__settings"
      aria-label={t.t("ui.partInspector.workshop", { mark: part.mark })}
    >
      <div className="part-insp__settings-head">
        <span className="insp-block__title">{t.t("ui.sections.workshop")}</span>
        <span className="part-insp__scope">{t.t(settings.scopeLabel)}</span>
      </div>
      {all.map(row)}
      <StructureParamError error={form.error} />
      <button
        type="button"
        className="btn btn-ghost part-insp__all"
        onClick={() => openSection(section)}
      >
        {t.t("ui.partInspector.allSettings", { section: msg(SECTION_TITLE_KEYS[section]) })}
        <ArrowRight size={13} aria-hidden="true" />
      </button>
    </section>
  );
}
