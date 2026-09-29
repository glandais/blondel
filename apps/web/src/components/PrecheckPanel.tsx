/**
 * Panneau « Prédimensionnement indicatif » (CHALLENGE P5) : classe d'exécution EN 1090-2 des
 * structures métal et vérification indicative des limons (flèche L/200 et L/300, contrainte,
 * fréquence propre) rendues par le cœur. Un clic sur un limon le sélectionne (surligné en 3D).
 * Ne remplace pas une note de calcul.
 */
import { PRECHECK_LABEL } from "@blondel/core";
import { useMemo } from "react";
import { executionClassInfo, precheckSummary, type PrecheckRow } from "../lib/precheck.js";
import { appStore, useApp, useModel } from "../store/appStore.js";

const dec = (digits: number) =>
  new Intl.NumberFormat("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const d0 = dec(0);
const d1 = dec(1);
const d2 = dec(2);

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={ok ? "pc-ok" : "pc-bad"} title={label}>
      {ok ? "✓" : "✗"}
      <span className="visually-hidden">{ok ? " respecté" : " non respecté"}</span>
    </span>
  );
}

function BeamRow({ row, selected }: { row: PrecheckRow; selected: boolean }) {
  return (
    <tr
      className={selected ? "is-selected" : undefined}
      onClick={() =>
        appStore
          .getState()
          .select(selected ? null : { location: { kind: "part", partId: row.partId } })
      }
    >
      <th scope="row" title={row.label}>
        {row.label}
      </th>
      <td className="num">{d2.format(row.lengthM)}</td>
      <td className="num">
        {d1.format(row.deflection)} <Status ok={row.ok.deflection} label="L/200 (bloquant)" />
        {row.ok.deflection && !row.ok.advice ? (
          <span className="pc-warn" title="L/300 (conseil, usage résidentiel)">
            {" "}
            L/300
          </span>
        ) : null}
        <br />
        <small className="muted">
          L/{d0.format(row.spanRatio)} · max {d1.format(row.limit)}
        </small>
      </td>
      <td className="num">
        {d0.format(row.ratio)} % <Status ok={row.ok.stress} label="σ_Ed ≤ f_d (bloquant)" />
        <br />
        <small className="muted">
          {d0.format(row.stress)} / {d0.format(row.design)} MPa
        </small>
      </td>
      <td className="num">
        {d1.format(row.frequency)} <Status ok={row.ok.frequency} label="f₁ ≥ 5 Hz" />
      </td>
    </tr>
  );
}

export function PrecheckPanel() {
  const { model } = useModel();
  const selection = useApp((s) => s.selection);
  // Lecture du prédimensionnement calculé dans le worker (`Model.precheck`) : aucun calcul ici.
  const summary = useMemo(() => precheckSummary(model), [model]);
  const exc = executionClassInfo(model);
  const selectedPart = selection?.location.kind === "part" ? selection.location.partId : null;

  if (!model) return null;
  const hasBeams = summary !== null && summary.rows.length > 0;
  if (!hasBeams && !exc) return null;

  return (
    <section className="precheck" aria-labelledby="precheck-title">
      <h2 id="precheck-title">Prédimensionnement indicatif</h2>
      {exc ? (
        <p className="precheck__exc">
          Classe d'exécution EN 1090-2 :{" "}
          <strong className={exc.value === "EXC2" ? "pc-warn" : undefined}>{exc.value}</strong>
          {exc.detail ? (
            <>
              <br />
              <small className="muted">{exc.detail}</small>
            </>
          ) : null}
        </p>
      ) : null}
      {hasBeams && summary ? (
        <>
          <p className="muted">
            Charges : q<sub>k</sub> {d1.format(summary.loads.qk)} kN/m², Q<sub>k</sub>{" "}
            {d1.format(summary.loads.Qk)} kN (catégorie {summary.loads.category}) ; permanentes{" "}
            {d2.format(summary.permanentArea)} kN/m².
          </p>
          <div className="precheck__table">
            <table>
              <caption className="visually-hidden">Limons prédimensionnés</caption>
              <thead>
                <tr>
                  <th scope="col">Limon</th>
                  <th scope="col" className="num">
                    L (m)
                  </th>
                  <th scope="col" className="num">
                    Flèche (mm)
                  </th>
                  <th scope="col" className="num">
                    Contrainte
                  </th>
                  <th scope="col" className="num">
                    f₁ (Hz)
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((r) => (
                  <BeamRow key={r.partId} row={r} selected={selectedPart === r.partId} />
                ))}
              </tbody>
            </table>
          </div>
          {summary.notes.length > 0 ? (
            <ul className="notes">
              {summary.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      <p className="disclaimer">{PRECHECK_LABEL}.</p>
    </section>
  );
}
