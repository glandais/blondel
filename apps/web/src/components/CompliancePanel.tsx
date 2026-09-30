/**
 * Panneau « Contrôle de conception » (CHALLENGE P3) : résultats du cœur groupés par sévérité
 * effective ; un clic sélectionne l'élément concerné (surlignage en plan et en 3D).
 *
 * Surcharges de règles (décision A18 (b)) : depuis chaque résultat, l'utilisateur change la
 * sévérité de la règle (ou l'ignore) avec une justification obligatoire (`withRuleOverride` du
 * cœur), reprise dans le dossier PDF ; la liste « Surcharges » les reprend toutes.
 */
import {
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
import { tr } from "../i18n/fr.js";
import { formatMeasure, type DisplayUnit } from "../lib/units.js";
import { appStore, useApp, useModel } from "../store/appStore.js";

function bounds(r: RuleResult, unit: DisplayUnit): string {
  const min = r.min ?? null;
  const max = r.max ?? null;
  if (min !== null && max !== null)
    return `${formatMeasure(min, r.unit, unit)} à ${formatMeasure(max, r.unit, unit)}`;
  if (min !== null) return `≥ ${formatMeasure(min, r.unit, unit)}`;
  if (max !== null) return `≤ ${formatMeasure(max, r.unit, unit)}`;
  return "";
}

type OverrideSeverity = RuleOverride["severity"];

const OVERRIDE_LABELS: Readonly<Record<OverrideSeverity, string>> = {
  ...SEVERITY_LABELS,
  ignore: "Ignorée",
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
  const [severity, setSeverity] = useState<OverrideSeverity>(current?.severity ?? "avertissement");
  const [justification, setJustification] = useState(current?.justification ?? "");
  const [error, setError] = useState<string | null>(null);
  const empty = justification.trim() === "";
  const save = () => {
    const r = appStore
      .getState()
      .update((p) => withRuleOverride(p, { ruleId, severity, justification }));
    if (r.ok) onClose();
    else setError(r.issues.join(" ; "));
  };
  const remove = () => {
    const r = appStore.getState().update((p) => withoutRuleOverride(p, ruleId));
    if (r.ok) onClose();
    else setError(r.issues.join(" ; "));
  };
  return (
    <form
      className="override-editor"
      aria-label={`Surcharge de ${ruleId}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!empty) save();
      }}
    >
      <div className="field">
        <label htmlFor={`${id}-sev`}>Sévérité retenue pour {ruleId}</label>
        <select
          id={`${id}-sev`}
          value={severity}
          onChange={(e) => setSeverity(e.target.value as OverrideSeverity)}
        >
          {RULE_OVERRIDE_SEVERITIES.map((v) => (
            <option key={v} value={v}>
              {OVERRIDE_LABELS[v]}
            </option>
          ))}
        </select>
      </div>
      <div className={`field${empty ? " field--invalid" : ""}`}>
        <label htmlFor={`${id}-just`}>Justification (obligatoire, reprise dans le dossier)</label>
        <textarea
          id={`${id}-just`}
          rows={3}
          value={justification}
          required
          onChange={(e) => setJustification(e.target.value)}
        />
        {empty ? (
          <span className="field__hint">Saisir la justification pour enregistrer.</span>
        ) : null}
        {error ? (
          <span className="field__error" role="alert">
            {error}
          </span>
        ) : null}
      </div>
      <div className="button-row">
        <button type="submit" disabled={empty}>
          Enregistrer la surcharge
        </button>
        {current ? (
          <button type="button" onClick={remove}>
            Retirer la surcharge
          </button>
        ) : null}
        <button type="button" className="link" onClick={onClose}>
          Annuler
        </button>
      </div>
    </form>
  );
}

/** Surcharge affichée sous un résultat, et bouton d'édition. */
function OverrideControl({ ruleId }: { ruleId: string }) {
  const current = useApp((s) => ruleOverrideOf(s.project, ruleId));
  const [open, setOpen] = useState(false);
  return (
    <div className="override">
      {current ? (
        <p className="override__current">
          Surcharge : {OVERRIDE_LABELS[current.severity]} — {current.justification}
        </p>
      ) : null}
      {open ? (
        <OverrideEditor ruleId={ruleId} current={current} onClose={() => setOpen(false)} />
      ) : (
        <button type="button" className="link" onClick={() => setOpen(true)}>
          {current ? "Modifier la surcharge" : "Surcharger la règle…"}
        </button>
      )}
    </div>
  );
}

/** Toutes les surcharges du projet (y compris celles de règles hors des contextes actifs). */
function OverrideList() {
  const overrides = useApp((s) => s.project.compliance.overrides);
  if (overrides.length === 0) return null;
  return (
    <details className="sev sev--overrides" open>
      <summary>
        Surcharges <span className="count">{overrides.length}</span>
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
  const unit = useApp((s) => s.displayUnit);
  const selection = useApp((s) => s.selection);
  const selected =
    selection !== null &&
    selection.ruleId === r.ruleId &&
    sameLocation(selection.location, r.location);
  const b = bounds(r, unit);
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
          <span className="result__loc">{locationLabel(r.location)}</span>
        </span>
        <span className="result__msg">{tr(r.message) || tr(ruleDescription(r.ruleId))}</span>
        {r.measured !== undefined ? (
          <span className="result__measure">
            Mesuré : {formatMeasure(r.measured, r.unit, unit)}
            {b ? ` (attendu ${b})` : ""}
          </span>
        ) : null}
        <span className="result__meta">
          {r.nature} · confiance {r.confidence}
          {r.secondarySource ? " · source secondaire" : ""}
          {r.downgradeReason ? ` · ${tr(r.downgradeReason)}` : ""}
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
  const { model } = useModel();
  const report = model?.compliance;
  const groups = groupResults(report);
  const notes = modelNotes(model);
  return (
    <section className="compliance" aria-labelledby="compliance-title">
      <h2 id="compliance-title">Contrôle de conception</h2>
      {report ? (
        <p className="muted">
          Règles v{report.rulesVersion} · profil {report.profile} · contextes :{" "}
          {report.contexts.join(", ") || "–"}
        </p>
      ) : (
        <p className="muted">Aucun modèle calculé.</p>
      )}
      {groups.violations.map(({ severity, results }) => (
        <details key={severity} className={`sev sev--${severity}`} open={results.length > 0}>
          <summary>
            {SEVERITY_LABELS[severity]} <span className="count">{results.length}</span>
          </summary>
          {results.length > 0 ? <ResultList results={results} /> : <p className="muted">Aucun.</p>}
        </details>
      ))}
      <details className="sev sev--na">
        <summary>
          Non évaluées <span className="count">{groups.notEvaluated.length}</span>
        </summary>
        <ResultList results={groups.notEvaluated} />
      </details>
      <details className="sev sev--ok">
        <summary>
          Respectées <span className="count">{groups.passed.length}</span>
        </summary>
        <ResultList results={groups.passed} />
      </details>
      <OverrideList />
      {notes.length > 0 ? (
        <details className="sev sev--notes" open>
          <summary>
            Remarques <span className="count">{notes.length}</span>
          </summary>
          <ul className="notes">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="disclaimer">
        Contrôle de conception indicatif : il ne vaut pas attestation de conformité.
      </p>
    </section>
  );
}
