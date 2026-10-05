/**
 * Éléments réutilisables du contrôle de conception (CHALLENGE P3), repris de l'ancien panneau
 * « Contrôle de conception » : résultat d'une règle (clic = sélection de l'élément concerné,
 * surligné en plan et en 3D), détail mesuré / attendu, nature et confiance, et surcharges de
 * règles (décision A18 (b)) : depuis chaque résultat, l'utilisateur change la sévérité de la
 * règle (ou l'ignore) avec une justification obligatoire (`withRuleOverride` du cœur), reprise
 * dans le dossier PDF. Toute surcharge passe par le store du projet : elle s'annule.
 */
import {
  CONFIDENCE_LABEL_KEYS,
  NATURE_LABEL_KEYS,
  RULE_OVERRIDE_SEVERITIES,
  ruleDescription,
  ruleOverrideOf,
  withRuleOverride,
  withoutRuleOverride,
  type RuleOverride,
  type RuleResult,
} from "@blondel/core";
import { msg, type Message, type MessageKey, type Translator } from "@blondel/i18n";
import { useId, useState } from "react";
import { listMessages } from "../../i18n/text.js";
import { useT } from "../../i18n/useT.js";
import { SEVERITY_LABELS, locationLabel, sameLocation } from "../../lib/compliance.js";
import { formatMeasure, type DisplayUnit } from "../../lib/units.js";
import { appStore, useApp } from "../../store/appStore.js";

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

/** Le résultat est-il celui de la sélection (même règle, même localisation) ? */
export function useIsSelected(r: RuleResult): boolean {
  return useApp(
    (s) =>
      s.selection !== null &&
      s.selection.ruleId === r.ruleId &&
      sameLocation(s.selection.location, r.location),
  );
}

/** Clic sur un résultat : sélectionne sa localisation et sa règle, ou désélectionne (bascule). */
export function toggleResultSelection(r: RuleResult, selected: boolean): void {
  appStore.getState().select(selected ? null : { location: r.location, ruleId: r.ruleId });
}

/** Mesuré / attendu (si la règle a mesuré une grandeur). */
export function ResultMeasure({ r }: { r: RuleResult }) {
  const t = useT();
  const unit = useApp((s) => s.displayUnit);
  if (r.measured === undefined) return null;
  const b = bounds(r, unit, t);
  return (
    <span className="result__measure">
      {b
        ? t.t("ui.compliance.measuredExpected", {
            value: formatMeasure(r.measured, r.unit, unit, t.locale),
            bounds: b,
          })
        : t.t("ui.compliance.measured", {
            value: formatMeasure(r.measured, r.unit, unit, t.locale),
          })}
    </span>
  );
}

/** Nature et confiance, source secondaire et motif de déclassement. */
export function ResultMeta({ r }: { r: RuleResult }) {
  const t = useT();
  return (
    <span className="result__meta">
      {t.t("ui.compliance.meta", {
        nature: labelOf(NATURE_LABEL_KEYS, r.nature, t),
        confidence: labelOf(CONFIDENCE_LABEL_KEYS, r.confidence, t),
      })}
      {r.secondarySource ? ` · ${t.t("ui.compliance.secondarySource")}` : ""}
      {r.downgradeReason ? ` · ${t.t(r.downgradeReason)}` : ""}
    </span>
  );
}

type OverrideSeverity = RuleOverride["severity"];

const OVERRIDE_LABELS: Readonly<Record<OverrideSeverity, MessageKey>> = {
  ...SEVERITY_LABELS,
  ignore: "ui.label.severity.ignore",
};

/** Formulaire d'une surcharge : sévérité et justification obligatoire. */
export function OverrideEditor({
  ruleId,
  current,
  onClose,
}: {
  ruleId: string;
  current: RuleOverride | undefined;
  onClose: () => void;
}) {
  const id = useId();
  const t = useT();
  const [severity, setSeverity] = useState<OverrideSeverity>(current?.severity ?? "avertissement");
  const [justification, setJustification] = useState(current?.justification ?? "");
  // Motifs du refus (`Message`), traduits au rendu : ils suivent un changement de langue.
  const [error, setError] = useState<Message | null>(null);
  const empty = justification.trim() === "";
  const issuesText = (issues: readonly Message[]): Message =>
    listMessages(issues) ?? msg("ui.common.input.refused");
  const save = () => {
    const r = appStore
      .getState()
      .update((p) => withRuleOverride(p, { ruleId, severity, justification }));
    if (r.ok) onClose();
    else setError(issuesText(r.issues));
  };
  const remove = () => {
    const r = appStore.getState().update((p) => withoutRuleOverride(p, ruleId));
    if (r.ok) onClose();
    else setError(issuesText(r.issues));
  };
  return (
    <form
      className="override-editor"
      aria-label={t.t("ui.compliance.override.formLabel", { ruleId })}
      onSubmit={(e) => {
        e.preventDefault();
        if (!empty) save();
      }}
    >
      <div className="field">
        <label htmlFor={`${id}-sev`}>{t.t("ui.compliance.override.severity", { ruleId })}</label>
        <select
          id={`${id}-sev`}
          value={severity}
          onChange={(e) => setSeverity(e.target.value as OverrideSeverity)}
        >
          {RULE_OVERRIDE_SEVERITIES.map((v) => (
            <option key={v} value={v}>
              {t.t(OVERRIDE_LABELS[v])}
            </option>
          ))}
        </select>
      </div>
      <div className={`field${empty ? " field--invalid" : ""}`}>
        <label htmlFor={`${id}-just`}>{t.t("ui.compliance.override.justification")}</label>
        <textarea
          id={`${id}-just`}
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
      <div className="button-row">
        <button type="submit" disabled={empty}>
          {t.t("ui.compliance.override.save")}
        </button>
        {current ? (
          <button type="button" onClick={remove}>
            {t.t("ui.compliance.override.remove")}
          </button>
        ) : null}
        <button type="button" className="link" onClick={onClose}>
          {t.t("ui.compliance.override.cancel")}
        </button>
      </div>
    </form>
  );
}

/** Surcharge affichée sous un résultat, et bouton d'édition. */
export function OverrideControl({ ruleId }: { ruleId: string }) {
  const t = useT();
  const current = useApp((s) => ruleOverrideOf(s.project, ruleId));
  const [open, setOpen] = useState(false);
  return (
    <div className="override">
      {current ? (
        <p className="override__current">
          {t.t("ui.compliance.override.current", {
            severity: msg(OVERRIDE_LABELS[current.severity]),
            justification: current.justification,
          })}
        </p>
      ) : null}
      {open ? (
        <OverrideEditor ruleId={ruleId} current={current} onClose={() => setOpen(false)} />
      ) : (
        <button type="button" className="link" onClick={() => setOpen(true)}>
          {current ? t.t("ui.compliance.override.edit") : t.t("ui.compliance.override.add")}
        </button>
      )}
    </div>
  );
}

/** Toutes les surcharges du projet (y compris celles de règles hors des contextes actifs). */
export function OverrideList() {
  const overrides = useApp((s) => s.project.compliance.overrides);
  if (overrides.length === 0) return null;
  return (
    <ul className="results">
      {overrides.map((o, i) => (
        <li key={`${o.ruleId}-${i}`} className="override-item">
          <code>{o.ruleId}</code>
          <OverrideControl ruleId={o.ruleId} />
        </li>
      ))}
    </ul>
  );
}

/** Résultat d'une règle (listes repliées : non évaluées, respectées) et sa surcharge. */
export function ResultItem({ r }: { r: RuleResult }) {
  const t = useT();
  const selected = useIsSelected(r);
  return (
    <li>
      <button
        type="button"
        className={`result result--${r.status}${selected ? " result--selected" : ""}`}
        aria-pressed={selected}
        onClick={() => toggleResultSelection(r, selected)}
      >
        <span className="result__head">
          <code>{r.ruleId}</code>
          <span className="result__loc">{t.t(locationLabel(r.location))}</span>
        </span>
        <span className="result__msg">{resultMessage(r, t)}</span>
        <ResultMeasure r={r} />
        <ResultMeta r={r} />
      </button>
      <OverrideControl ruleId={r.ruleId} />
    </li>
  );
}

export function ResultList({ results }: { results: readonly RuleResult[] }) {
  return (
    <ul className="results">
      {results.map((r, i) => (
        <ResultItem key={`${r.ruleId}-${i}`} r={r} />
      ))}
    </ul>
  );
}
