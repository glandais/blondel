/**
 * Panneau « Contrôle de conception » (CHALLENGE P3) : résultats du cœur groupés par sévérité
 * effective ; un clic sélectionne l'élément concerné (surlignage en plan et en 3D).
 */
import type { RuleResult } from "@blondel/core";
import {
  SEVERITY_LABELS,
  groupResults,
  locationLabel,
  modelNotes,
  sameLocation,
} from "../lib/compliance.js";
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
        <span className="result__msg">{r.message || r.description}</span>
        {r.measured !== undefined ? (
          <span className="result__measure">
            Mesuré : {formatMeasure(r.measured, r.unit, unit)}
            {b ? ` (attendu ${b})` : ""}
          </span>
        ) : null}
        <span className="result__meta">
          {r.nature} · confiance {r.confidence}
          {r.secondarySource ? " · source secondaire" : ""}
          {r.downgradeReason ? ` · ${r.downgradeReason}` : ""}
        </span>
      </button>
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
