/**
 * Réglages ◆ du repérage des pièces (lot « attribution des repères », décisions F10 (21) et
 * (30)), montés dans la section Structure à côté de la visserie (zone « Réglages d'atelier » du
 * parcours libre, à plat à l'étape 7 du guidé) :
 *
 * - tolérance d'identité des pièces repérées (`workshop.identicalPartTolerance` du profil
 *   d'atelier, **enregistrée dans le projet**) : saisie décimale en mm, au moins 0, sans borne
 *   haute (décision (22) : une remarque du contrôle plutôt qu'une borne) ; aide = provenance du
 *   cœur (`IDENTICAL_PART_TOLERANCE_PROVENANCE`) ;
 * - rappel, en lecture seule, du représentant d'un repère de cornières ou de supports (règle du
 *   cœur `MARK_REPRESENTATIVE_RULE` : « la plus courte », à confirmer par un atelier,
 *   `MARK_REPRESENTATIVE_PROVENANCE`).
 *
 * Rendus seulement quand le modèle a des pièces repérées par identité (`lib/partMarks.ts`). La
 * tolérance s'édite aussi dans le dialogue « Atelier… » (`IdenticalToleranceField`, même champ).
 * Modification : `setField` (une entrée d'historique, annulable, validée par le schéma du cœur).
 */
import { IDENTICAL_PART_TOLERANCE_PROVENANCE, MARK_REPRESENTATIVE_PROVENANCE } from "@blondel/core";
import { useT } from "../i18n/useT.js";
import { paramKey } from "../lib/paramTiers.js";
import {
  IDENTICAL_TOLERANCE_PATH,
  MARK_REPRESENTATIVE_KEY,
  MARK_REPRESENTATIVE_LABEL,
  MARK_REPRESENTATIVE_VALUE,
  identicalToleranceValue,
  partMarksInModel,
} from "../lib/partMarks.js";
import { formatDecimal, parseDecimal } from "../lib/units.js";
import { appStore, useApp, useModel } from "../store/appStore.js";
import { NumberField } from "./fields.js";
import { hasVisibleItems, Tiered, type SectionProps, type TieredItem } from "./sections/Tiered.js";
import "./fasteners.css";

/** Champ de la tolérance d'identité des pièces repérées (section Structure et « Atelier… »). */
export function IdenticalToleranceField() {
  const t = useT();
  const project = useApp((s) => s.project);
  return (
    <NumberField
      label={t.t("ui.partMarks.identicalTolerance")}
      value={identicalToleranceValue(project)}
      min={0}
      hint={t.t(IDENTICAL_PART_TOLERANCE_PROVENANCE.note)}
      parse={parseDecimal}
      format={(v) => formatDecimal(v, t.locale)}
      onCommit={(v) => appStore.getState().setField(IDENTICAL_TOLERANCE_PATH, v)}
    />
  );
}

/**
 * Rappel du représentant d'un repère de cornières ou de supports : texte en lecture seule,
 * focalisable (cible du lien « Ouvrir » de la liste ◆).
 */
export function MarkRepresentativeNote() {
  const t = useT();
  return (
    <div className="field part-marks__representative" tabIndex={-1}>
      <span className="part-marks__label">{t.t("ui.partMarks.representative")}</span>
      <strong className="part-marks__value">
        {t.t(MARK_REPRESENTATIVE_LABEL[MARK_REPRESENTATIVE_VALUE])}
      </strong>
      <small className="field__hint">{t.t(MARK_REPRESENTATIVE_PROVENANCE.note)}</small>
    </div>
  );
}

export function PartMarksFields({ display }: SectionProps) {
  const t = useT();
  const { model } = useModel();
  if (!partMarksInModel(model)) return null;
  const items: TieredItem[] = [
    { key: paramKey(IDENTICAL_TOLERANCE_PATH), node: <IdenticalToleranceField /> },
    { key: MARK_REPRESENTATIVE_KEY, node: <MarkRepresentativeNote /> },
  ];
  if (!hasVisibleItems(items, display)) return null;
  return (
    <fieldset className="part-marks" data-testid="part-marks-settings">
      <legend>{t.t("ui.partMarks.title")}</legend>
      <p className="muted part-marks__hint">{t.t("ui.partMarks.hint")}</p>
      <Tiered display={display} items={items} />
    </fieldset>
  );
}
