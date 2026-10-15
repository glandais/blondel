/**
 * Réglages ◆ du repérage des pièces (lot « attribution des repères », décisions F10 (21) et
 * (30) ; chantier « repères de garde-corps », décisions G-Q7 et G-Q9), montés dans la section
 * Structure à côté de la visserie (zone « Réglages d'atelier » du parcours libre, à plat à
 * l'étape 7 du guidé) :
 *
 * - tolérance d'identité des pièces repérées (`workshop.identicalPartTolerance` du profil
 *   d'atelier, **enregistrée dans le projet**) : saisie décimale en mm, au moins 0, sans borne
 *   haute (décision (22) : une remarque du contrôle plutôt qu'une borne) ; aide = provenance du
 *   cœur (`IDENTICAL_PART_TOLERANCE_PROVENANCE`) suivie de l'avertissement des garde-corps
 *   cintrés comparés sur des facettes (`GUARD_FACETED_IDENTITY_NOTE`, G-Q9) ;
 * - rappels, en lecture seule, du représentant d'un repère, un par règle appliquée par le cœur
 *   dans le modèle affiché (`Part.markRepresentative`, lu par `markRepresentativeRulesInModel`) :
 *   barres (cornières, supports, garde-corps), « la plus courte » ; développés ou panneaux, « la
 *   plus petite par l'aire nette » ; à confirmer par un atelier (`MARK_REPRESENTATIVE_PROVENANCES`).
 *
 * Rendus seulement quand le modèle a des pièces repérées par identité (`lib/partMarks.ts`). La
 * tolérance s'édite aussi dans le dialogue « Atelier… » (`IdenticalToleranceField`, même champ).
 * Modification : `setField` (une entrée d'historique, annulable, validée par le schéma du cœur).
 */
import {
  GUARD_FACETED_IDENTITY_NOTE,
  IDENTICAL_PART_TOLERANCE_PROVENANCE,
  MARK_REPRESENTATIVE_PROVENANCES,
  type MarkRepresentativeRule,
} from "@blondel/core";
import { useT } from "../i18n/useT.js";
import { paramKey } from "../lib/paramTiers.js";
import {
  IDENTICAL_TOLERANCE_PATH,
  MARK_REPRESENTATIVE_AREA_KEY,
  MARK_REPRESENTATIVE_KEY,
  MARK_REPRESENTATIVE_LABEL,
  MARK_REPRESENTATIVE_TITLE,
  identicalToleranceValue,
  markRepresentativeRulesInModel,
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
      hint={`${t.t(IDENTICAL_PART_TOLERANCE_PROVENANCE.note)} ${t.t(GUARD_FACETED_IDENTITY_NOTE)}`}
      parse={parseDecimal}
      format={(v) => formatDecimal(v, t.locale)}
      onCommit={(v) => appStore.getState().setField(IDENTICAL_TOLERANCE_PATH, v)}
    />
  );
}

/**
 * Rappel du représentant d'un repère pour une règle : texte en lecture seule, focalisable (cible
 * du lien « Ouvrir » de la liste ◆).
 */
export function MarkRepresentativeNote({ rule }: { readonly rule: MarkRepresentativeRule }) {
  const t = useT();
  return (
    <div className="field part-marks__representative" tabIndex={-1}>
      <span className="part-marks__label">{t.t(MARK_REPRESENTATIVE_TITLE[rule])}</span>
      <strong className="part-marks__value">{t.t(MARK_REPRESENTATIVE_LABEL[rule])}</strong>
      <small className="field__hint">{t.t(MARK_REPRESENTATIVE_PROVENANCES[rule].note)}</small>
    </div>
  );
}

export function PartMarksFields({ display }: SectionProps) {
  const t = useT();
  const { model } = useModel();
  if (!partMarksInModel(model)) return null;
  const rules = markRepresentativeRulesInModel(model);
  // Une ligne par règle du représentant appliquée dans le modèle (G-Q7), clés en littéral.
  const items: TieredItem[] = [
    { key: paramKey(IDENTICAL_TOLERANCE_PATH), node: <IdenticalToleranceField /> },
    ...(rules.includes("shortest")
      ? [{ key: MARK_REPRESENTATIVE_KEY, node: <MarkRepresentativeNote rule="shortest" /> }]
      : []),
    ...(rules.includes("smallestNetArea")
      ? [
          {
            key: MARK_REPRESENTATIVE_AREA_KEY,
            node: <MarkRepresentativeNote rule="smallestNetArea" />,
          },
        ]
      : []),
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
