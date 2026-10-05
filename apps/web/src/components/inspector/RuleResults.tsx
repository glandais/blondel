/**
 * Éléments réutilisables du contrôle de conception (CHALLENGE P3) : résultat d'une règle dans les
 * listes repliées (titre court et localisation, clic = inspecteur Règle), bornes attendues,
 * libellés de la table, liste des surcharges et formulaire de surcharge (décision A18 (b),
 * maquette 2c) : l'utilisateur change la sévérité de la règle (ou l'ignore) avec une
 * justification obligatoire (`withRuleOverride` du cœur), reprise dans le dossier PDF. Toute
 * surcharge passe par le store du projet : elle s'annule.
 */
import {
  RULE_OVERRIDE_SEVERITIES,
  ruleDescription,
  ruleOverrideOf,
  ruleTitle,
  withRuleOverride,
  withoutRuleOverride,
  type Part,
  type RuleOverride,
  type RuleResult,
} from "@blondel/core";
import { msg, type Message, type MessageKey, type Translator } from "@blondel/i18n";
import { useId, useState } from "react";
import { listMessages } from "../../i18n/text.js";
import { useT } from "../../i18n/useT.js";
import { locationShort } from "../../lib/compliance.js";
import { formatMeasure, type DisplayUnit } from "../../lib/units.js";
import { appStore, useApp, useModel } from "../../store/appStore.js";
import { Corners } from "../ui/Blueprint.js";
import { Segmented } from "../ui/Segmented.js";

/** Bornes attendues d'un résultat (« a à b », « ≥ a », « ≤ b »), vide sans borne. */
export function bounds(r: RuleResult, unit: DisplayUnit, t: Translator): string {
  const locale = t.locale;
  const min = r.min ?? null;
  const max = r.max ?? null;
  if (min !== null && max !== null)
    return t.t("ui.compliance.bounds", {
      min: formatMeasure(min, r.unit, unit, locale),
      max: formatMeasure(max, r.unit, unit, locale),
    });
  if (min !== null) return `≥ ${formatMeasure(min, r.unit, unit, locale)}`;
  if (max !== null) return `≤ ${formatMeasure(max, r.unit, unit, locale)}`;
  return "";
}

/**
 * Libellé traduit d'une valeur du tableau des règles (nature, confiance) ; valeur brute si elle
 * est inconnue de la table.
 */
export function labelOf(
  keys: Readonly<Record<string, MessageKey>>,
  value: string,
  t: Translator,
): string {
  const key = keys[value];
  return key === undefined ? value : t.t(key);
}

/** Message d'un résultat, ou description de la règle à défaut. */
export function resultMessage(r: RuleResult, t: Translator): string {
  return (r.message ? t.t(r.message) : "") || t.t(ruleDescription(r.ruleId));
}

/** Ouvre l'inspecteur Règle (2c) sur un résultat : sa localisation et sa règle. */
export function selectResult(r: Pick<RuleResult, "location" | "ruleId">): void {
  appStore.getState().select({ location: r.location, ruleId: r.ruleId });
}

/** Pièces du modèle affiché (localisations courtes), liste vide sans modèle. */
export function useModelParts(): readonly Part[] {
  const { model } = useModel();
  return model?.parts ?? EMPTY_PARTS;
}

const EMPTY_PARTS: readonly Part[] = [];

type OverrideSeverity = RuleOverride["severity"];

/** Libellés complets des sévérités de surcharge (rappel de la surcharge en cours). */
export const OVERRIDE_LABELS: Readonly<Record<OverrideSeverity, MessageKey>> = {
  bloquant: "ui.label.severity.bloquant",
  avertissement: "ui.label.severity.avertissement",
  conseil: "ui.label.severity.conseil",
  ignore: "ui.label.severity.ignore",
};

/** Libellés courts du segmenté « Nouvelle sévérité » (maquette 2c : « Ignorer », verbe). */
const OVERRIDE_SHORT_LABELS: Readonly<Record<OverrideSeverity, MessageKey>> = {
  bloquant: "ui.control.count.bloquant.short",
  avertissement: "ui.control.count.avertissement.short",
  conseil: "ui.control.count.conseil.short",
  ignore: "ui.ruleInspector.override.ignore",
};

/** Rappel d'une surcharge : « Surcharge : Ignorée — justification ». */
export function overrideRecall(o: RuleOverride): Message {
  return msg("ui.compliance.override.current", {
    severity: msg(OVERRIDE_LABELS[o.severity]),
    justification: o.justification,
  });
}

/** Lève la surcharge d'une règle (une entrée d'historique) ; motif d'un refus, sinon `null`. */
export function liftOverride(ruleId: string): Message | null {
  const r = appStore.getState().update((p) => withoutRuleOverride(p, ruleId));
  return r.ok ? null : (listMessages(r.issues) ?? msg("ui.common.input.refused"));
}

/**
 * Formulaire de surcharge de l'inspecteur Règle (maquette 2c) : cadre blueprint « Surcharger la
 * règle », nouvelle sévérité en segmenté, justification obligatoire (« Surcharger » désactivé
 * tant qu'elle est vide), Annuler / Surcharger. Une surcharge existante est rappelée et peut être
 * levée. Échap sur une saisie en cours (sévérité ou justification modifiée) la rétablit et
 * s'arrête là (`preventDefault`) : il n'efface pas la sélection, ce qui démonterait le formulaire.
 */
export function OverrideEditor({
  ruleId,
  current,
  onClose,
}: {
  ruleId: string;
  current: RuleOverride | undefined;
  /** Annuler ou enregistrement réussi. */
  onClose: () => void;
}) {
  const id = useId();
  const t = useT();
  const [severity, setSeverity] = useState<OverrideSeverity>(current?.severity ?? "conseil");
  const [justification, setJustification] = useState(current?.justification ?? "");
  // Motifs du refus (`Message`), traduits au rendu : ils suivent un changement de langue.
  const [error, setError] = useState<Message | null>(null);
  const empty = justification.trim() === "";
  const dirty =
    severity !== (current?.severity ?? "conseil") ||
    justification !== (current?.justification ?? "");
  const save = () => {
    const r = appStore
      .getState()
      .update((p) => withRuleOverride(p, { ruleId, severity, justification }));
    if (r.ok) onClose();
    else setError(listMessages(r.issues) ?? msg("ui.common.input.refused"));
  };
  const lift = () => {
    const failure = liftOverride(ruleId);
    if (failure === null) onClose();
    else setError(failure);
  };
  return (
    <form
      className="blueprint override-editor"
      aria-label={t.t("ui.compliance.override.formLabel", { ruleId })}
      onSubmit={(e) => {
        e.preventDefault();
        if (!empty) save();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !dirty) return;
        e.preventDefault();
        setSeverity(current?.severity ?? "conseil");
        setJustification(current?.justification ?? "");
        setError(null);
      }}
    >
      <Corners />
      <span className="override-editor__title">{t.t("ui.ruleInspector.override.title")}</span>
      {current ? (
        <div className="override-editor__current">
          <p>{t.t(overrideRecall(current))}</p>
          <button type="button" className="btn btn-ghost" onClick={lift}>
            {t.t("ui.ruleInspector.override.lift")}
          </button>
        </div>
      ) : null}
      <div className="field">
        {/* Libellé visible ; le groupe porte le même nom accessible (`label`). */}
        <span className="field__label" aria-hidden="true">
          {t.t("ui.ruleInspector.override.severity")}
        </span>
        <Segmented<OverrideSeverity>
          label={t.t("ui.ruleInspector.override.severity")}
          value={severity}
          size="sm"
          className="override-editor__severity"
          options={RULE_OVERRIDE_SEVERITIES.map((v) => ({
            value: v,
            label: t.t(OVERRIDE_SHORT_LABELS[v]),
            title: t.t(OVERRIDE_LABELS[v]),
          }))}
          onChange={setSeverity}
        />
      </div>
      <div className={`field${empty ? " field--invalid" : ""}`}>
        <label htmlFor={`${id}-just`}>{t.t("ui.ruleInspector.override.justification")}</label>
        <textarea
          id={`${id}-just`}
          className="input"
          rows={3}
          value={justification}
          required
          onChange={(e) => setJustification(e.target.value)}
        />
        {empty ? (
          <span className="field__hint">{t.t("ui.compliance.override.justificationHint")}</span>
        ) : null}
        {error ? (
          <span className="field__error" role="alert">
            {t.t(error)}
          </span>
        ) : null}
      </div>
      <div className="override-editor__actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t.t("ui.compliance.override.cancel")}
        </button>
        <button type="submit" className="btn btn-primary" disabled={empty}>
          {t.t("ui.ruleInspector.override.submit")}
        </button>
      </div>
    </form>
  );
}

/**
 * Toutes les surcharges du projet (y compris celles de règles hors des contextes actifs) :
 * identifiant, titre court (lien vers l'inspecteur Règle, pour modifier la surcharge), rappel
 * (sévérité et justification) et « Lever la surcharge ».
 */
export function OverrideList() {
  const t = useT();
  const overrides = useApp((s) => s.project.compliance.overrides);
  const [error, setError] = useState<Message | null>(null);
  if (overrides.length === 0) return null;
  return (
    <>
      <ul className="results override-list">
        {overrides.map((o, i) => (
          <li key={`${o.ruleId}-${i}`} className="override-item" data-rule={o.ruleId}>
            <span className="override-item__head">
              {/* Ouvre l'inspecteur Règle (modifier la sévérité ou la justification). */}
              <button
                type="button"
                className="link override-item__open"
                onClick={() =>
                  appStore.getState().select({ location: { kind: "stair" }, ruleId: o.ruleId })
                }
              >
                <b>{t.t(ruleTitle(o.ruleId))}</b>
              </button>
              <code>{o.ruleId}</code>
            </span>
            <p className="override__current">{t.t(overrideRecall(o))}</p>
            <button
              type="button"
              className="btn btn-ghost override-item__lift"
              onClick={() => setError(liftOverride(o.ruleId))}
            >
              {t.t("ui.ruleInspector.override.lift")}
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p className="field__error" role="alert">
          {t.t(error)}
        </p>
      ) : null}
    </>
  );
}

/** Résultat d'une règle (listes repliées : non évaluées, respectées) : titre et localisation. */
export function ResultItem({ r, parts }: { r: RuleResult; parts: readonly Part[] }) {
  const t = useT();
  return (
    <li data-rule={r.ruleId}>
      <button
        type="button"
        className={`result result--${r.status}`}
        onClick={() => selectResult(r)}
      >
        <span className="result__head">
          <span className="result__title">{t.t(ruleTitle(r.ruleId))}</span>
          <span className="result__loc">{t.t(locationShort(r.location, parts))}</span>
        </span>
      </button>
    </li>
  );
}

export function ResultList({ results }: { results: readonly RuleResult[] }) {
  const parts = useModelParts();
  return (
    <ul className="results">
      {results.map((r, i) => (
        <ResultItem key={`${r.ruleId}-${i}`} r={r} parts={parts} />
      ))}
    </ul>
  );
}

/** Surcharge en cours d'une règle (lecture du projet). */
export function useRuleOverride(ruleId: string): RuleOverride | undefined {
  return useApp((s) => ruleOverrideOf(s.project, ruleId));
}
