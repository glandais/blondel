/**
 * Panneau « Contrôle de conception » (CHALLENGE P3) : résultats du cœur groupés par sévérité
 * effective ; un clic sélectionne l'élément concerné (surlignage en plan et en 3D).
 *
 * Surcharges de règles (décision A18 (b)) : depuis chaque résultat, l'utilisateur change la
 * sévérité de la règle (ou l'ignore) avec une justification obligatoire (`withRuleOverride` du
 * cœur), reprise dans le dossier PDF ; la liste « Surcharges » les reprend toutes.
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
import { useId, useState } from "react";
import {
  SEVERITY_LABELS,
  groupResults,
  locationLabel,
  modelNotes,
  sameLocation,
} from "../lib/compliance.js";
import { msg, type Message, type MessageKey, type Translator } from "@blondel/i18n";
import { listMessages } from "../i18n/text.js";
import { useT } from "../i18n/useT.js";
import { formatMeasure, type DisplayUnit } from "../lib/units.js";
import { appStore, useApp, useModel } from "../store/appStore.js";

function bounds(r: RuleResult, unit: DisplayUnit, t: Translator): string {
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
function labelOf(keys: Readonly<Record<string, MessageKey>>, value: string, t: Translator): string {
  const key = keys[value];
  return key === undefined ? value : t.t(key);
}

type OverrideSeverity = RuleOverride["severity"];

const OVERRIDE_LABELS: Readonly<Record<OverrideSeverity, MessageKey>> = {
  ...SEVERITY_LABELS,
  ignore: "ui.label.severity.ignore",
};

/** Formulaire d'une surcharge : sévérité et justification obligatoire. */
function OverrideEditor({
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
function OverrideControl({ ruleId }: { ruleId: string }) {
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
function OverrideList() {
  const t = useT();
  const overrides = useApp((s) => s.project.compliance.overrides);
  if (overrides.length === 0) return null;
  return (
    <details className="sev sev--overrides" open>
      <summary>
        {t.t("ui.compliance.overrides")} <span className="count">{overrides.length}</span>
      </summary>
      <ul className="results">
        {overrides.map((o, i) => (
          <li key={`${o.ruleId}-${i}`} className="override-item">
            <code>{o.ruleId}</code>
            <OverrideControl ruleId={o.ruleId} />
          </li>
        ))}
      </ul>
    </details>
  );
}

function ResultItem({ r }: { r: RuleResult }) {
  const t = useT();
  const unit = useApp((s) => s.displayUnit);
  const selection = useApp((s) => s.selection);
  const selected =
    selection !== null &&
    selection.ruleId === r.ruleId &&
    sameLocation(selection.location, r.location);
  const b = bounds(r, unit, t);
  return (
    <li>
      <button
        type="button"
        className={`result result--${r.status}${selected ? " result--selected" : ""}`}
        aria-pressed={selected}
        onClick={() =>
          appStore.getState().select(selected ? null : { location: r.location, ruleId: r.ruleId })
        }
      >
        <span className="result__head">
          <code>{r.ruleId}</code>
          <span className="result__loc">{t.t(locationLabel(r.location))}</span>
        </span>
        <span className="result__msg">
          {(r.message ? t.t(r.message) : "") || t.t(ruleDescription(r.ruleId))}
        </span>
        {r.measured !== undefined ? (
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
        ) : null}
        <span className="result__meta">
          {t.t("ui.compliance.meta", {
            nature: labelOf(NATURE_LABEL_KEYS, r.nature, t),
            confidence: labelOf(CONFIDENCE_LABEL_KEYS, r.confidence, t),
          })}
          {r.secondarySource ? ` · ${t.t("ui.compliance.secondarySource")}` : ""}
          {r.downgradeReason ? ` · ${t.t(r.downgradeReason)}` : ""}
        </span>
      </button>
      <OverrideControl ruleId={r.ruleId} />
    </li>
  );
}

function ResultList({ results }: { results: readonly RuleResult[] }) {
  return (
    <ul className="results">
      {results.map((r, i) => (
        <ResultItem key={`${r.ruleId}-${i}`} r={r} />
      ))}
    </ul>
  );
}

export function CompliancePanel() {
  const t = useT();
  const { model } = useModel();
  const report = model?.compliance;
  const groups = groupResults(report);
  const notes = modelNotes(model);
  return (
    <section className="compliance" aria-labelledby="compliance-title">
      <h2 id="compliance-title">{t.t("ui.compliance.title")}</h2>
      {report ? (
        <p className="muted">
          {t.t("ui.compliance.summary", {
            version: String(report.rulesVersion),
            profile: report.profile,
            contexts: report.contexts.join(", ") || "–",
          })}
        </p>
      ) : (
        <p className="muted">{t.t("ui.compliance.noModel")}</p>
      )}
      {groups.violations.map(({ severity, results }) => (
        <details key={severity} className={`sev sev--${severity}`} open={results.length > 0}>
          <summary>
            {t.t(SEVERITY_LABELS[severity])} <span className="count">{results.length}</span>
          </summary>
          {results.length > 0 ? (
            <ResultList results={results} />
          ) : (
            <p className="muted">{t.t("ui.compliance.none")}</p>
          )}
        </details>
      ))}
      <details className="sev sev--na">
        <summary>
          {t.t("ui.compliance.notEvaluated")}{" "}
          <span className="count">{groups.notEvaluated.length}</span>
        </summary>
        <ResultList results={groups.notEvaluated} />
      </details>
      <details className="sev sev--ok">
        <summary>
          {t.t("ui.compliance.passed")} <span className="count">{groups.passed.length}</span>
        </summary>
        <ResultList results={groups.passed} />
      </details>
      <OverrideList />
      {notes.length > 0 ? (
        <details className="sev sev--notes" open>
          <summary>
            {t.t("ui.compliance.notes")} <span className="count">{notes.length}</span>
          </summary>
          <ul className="notes">
            {notes.map((n, i) => (
              <li key={i}>{t.t(n)}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="disclaimer">{t.t("ui.compliance.disclaimer")}</p>
    </section>
  );
}
