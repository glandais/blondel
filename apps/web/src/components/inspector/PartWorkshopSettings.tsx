/**
 * Réglages d'atelier d'une pièce, partagés par l'inspecteur Pièce (maquette 2b) et la colonne de
 * droite du mode Fabrication (wireframe « Parcours libre · Fabrication ») : champs du plugin de
 * structure courant repris pour la famille de pièces (`partSettingsFor`), rendus comme dans la
 * section Structure (`ParamInput`, même chemin du projet, même validation par le schéma du
 * plugin, Auto | valeur retenue). Chaque modification passe par le projectStore : elle est
 * annulable (Annuler, Ctrl+Z).
 *
 * - `inspector` : bloc « Réglages d'atelier » de la 2b (tous les champs repris, lien « Tous les
 *   réglages dans … ») ;
 * - `fabrication` : surtitre « Réglages d'atelier de la pièce », champs de niveau Atelier
 *   seulement, mention « ◆ valeur par défaut à valider » sous un champ ◆ non validé, note de
 *   portée. Rien n'est rendu si aucun champ Atelier n'est repris.
 *
 * Dans les deux cas, la marque ◆ ne s'affiche que pour une valeur non encore validée
 * (`validatedValues` du projet, lu par `useValidatedKeys`).
 */
import type { Part } from "@blondel/core";
import { msg } from "@blondel/i18n";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "../../i18n/useT.js";
import { paramKey, structureParamEntry } from "../../lib/paramTiers.js";
import { matchesSettings, type PartSettings } from "../../lib/partSettings.js";
import type { PresentedField } from "../../lib/paramLabels.js";
import { getParam } from "../../lib/structureForm.js";
import { openSection } from "../../store/uiStore.js";
import { useValidatedKeys } from "../fabrication/useToValidate.js";
import {
  NO_STRUCTURE,
  ParamInput,
  StructureParamError,
  useStructureParamForm,
  type StructureParamForm,
} from "../StructureSection.js";
import { SECTION_TITLE_KEYS } from "../sections/index.js";
import { Segmented } from "../ui/Segmented.js";
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

export function PartWorkshopSettings({ part, settings, variant }: PartWorkshopSettingsProps) {
  const t = useT();
  const form = useStructureParamForm();
  const validated = useValidatedKeys();
  const kind = form.plugin?.kind ?? NO_STRUCTURE;
  const reprised = form.fields.filter((f) => matchesSettings(f.path, settings.structureParams));
  // ◆ non validé : marque (et mention en Fabrication) ; une valeur validée n'en porte plus.
  const pending = (f: PresentedField): boolean =>
    structureParamEntry(kind, f.path).toValidate === true && !validated.has(fieldKey(f));

  if (variant === "fabrication") {
    const fields = reprised.filter((f) => structureParamEntry(kind, f.path).tier === "workshop");
    if (fields.length === 0) return null;
    return (
      <section
        className="part-insp__settings part-insp__settings--fab"
        aria-label={t.t("ui.partInspector.workshop", { mark: part.mark })}
      >
        <span className="insp-eyebrow">{t.t("ui.fabAside.workshop.eyebrow")}</span>
        {fields.map((f) => (
          <div
            key={f.path.join(".")}
            className="part-insp__fab-field"
            data-to-validate={pending(f) ? "true" : undefined}
          >
            <FieldInput form={form} field={f} />
            {pending(f) ? (
              <small className="part-insp__tv-note">
                <span aria-hidden="true">◆ </span>
                {t.t("ui.fabAside.workshop.toValidate")}
              </small>
            ) : null}
          </div>
        ))}
        <StructureParamError error={form.error} />
        <p className="part-insp__note">{t.t("ui.fabAside.workshop.note")}</p>
      </section>
    );
  }

  const section = settings.section;
  const row = (f: PresentedField): ReactNode =>
    pending(f) ? (
      <div key={f.path.join(".")} className="tiered__item tiered__item--tv">
        <FieldInput form={form} field={f} />
        <span className="tv-mark tiered__mark" aria-hidden="true">
          ◆
        </span>
      </div>
    ) : (
      <div key={f.path.join(".")}>
        <FieldInput form={form} field={f} />
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
      {reprised.map(row)}
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
