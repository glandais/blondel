/**
 * Panneau « Prédimensionnement indicatif » (CHALLENGE P5) : classe d'exécution EN 1090-2 des
 * structures métal et vérification indicative des limons (flèche L/200 et L/300, contrainte,
 * fréquence propre) rendues par le cœur. Un clic sur un limon le sélectionne (surligné en 3D).
 * Ne remplace pas une note de calcul.
 *
 * Déplié sous la ligne « Prédimensionnement » de l'inspecteur (ADR-0009 point 8), qui porte le
 * titre visible : le panneau n'a plus qu'un nom accessible.
 */
import { PRECHECK_LABEL } from "@blondel/core";
import type { Locale } from "@blondel/i18n";
import { useMemo } from "react";
import { numberFormat } from "../i18n/locale.js";
import { useT } from "../i18n/useT.js";
import { executionClassInfo, precheckSummary, type PrecheckRow } from "../lib/precheck.js";
import { appStore, useApp, useModel } from "../store/appStore.js";

/** Formats à 0, 1 et 2 décimales dans la langue d'affichage. */
function decimals(locale: Locale) {
  const dec = (digits: number) =>
    numberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return { d0: dec(0), d1: dec(1), d2: dec(2) };
}

function Status({ ok, label }: { ok: boolean; label: string }) {
  const t = useT();
  return (
    <span className={ok ? "pc-ok" : "pc-bad"} title={label}>
      {ok ? "✓" : "✗"}
      <span className="visually-hidden">
        {" "}
        {t.t(ok ? "ui.precheck.status.ok" : "ui.precheck.status.bad")}
      </span>
    </span>
  );
}

function BeamRow({ row, selected }: { row: PrecheckRow; selected: boolean }) {
  const t = useT();
  const { d0, d1, d2 } = decimals(t.locale);
  const label = t.t(row.label);
  return (
    <tr
      className={selected ? "is-selected" : undefined}
      onClick={() =>
        appStore
          .getState()
          .select(selected ? null : { location: { kind: "part", partId: row.partId } })
      }
    >
      <th scope="row" title={label}>
        {label}
      </th>
      <td className="num">{d2.format(row.lengthM)}</td>
      <td className="num">
        {d1.format(row.deflection)}{" "}
        <Status ok={row.ok.deflection} label={t.t("ui.precheck.deflection.blocking")} />
        {row.ok.deflection && !row.ok.advice ? (
          <span className="pc-warn" title={t.t("ui.precheck.deflection.advice")}>
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
        {t.t("ui.precheck.percent", { value: d0.format(row.ratio) })}{" "}
        <Status ok={row.ok.stress} label={t.t("ui.precheck.stress.blocking")} />
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

export function PrecheckPanel({ id }: { readonly id?: string } = {}) {
  const t = useT();
  const { d1, d2 } = decimals(t.locale);
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
    <section id={id} className="precheck" aria-label={t.t("ui.precheck.title")}>
      {exc ? (
        <p className="precheck__exc">
          {t.t("ui.precheck.executionClass")}{" "}
          <strong className={exc.value === "EXC2" ? "pc-warn" : undefined}>{exc.value}</strong>
          {exc.detail ? (
            <>
              <br />
              <small className="muted">{t.t(exc.detail)}</small>
            </>
          ) : null}
        </p>
      ) : null}
      {hasBeams && summary ? (
        <>
          <p className="muted">
            {t.t("ui.precheck.loads.label")} q<sub>k</sub> {d1.format(summary.loads.qk)} kN/m², Q
            <sub>k</sub> {d1.format(summary.loads.Qk)} kN{" "}
            {t.t("ui.precheck.loads.rest", {
              category: summary.loads.category,
              permanent: d2.format(summary.permanentArea),
            })}
          </p>
          <div className="precheck__table">
            <table>
              <caption className="visually-hidden">{t.t("ui.precheck.caption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.t("ui.precheck.column.beam")}</th>
                  <th scope="col" className="num">
                    L (m)
                  </th>
                  <th scope="col" className="num">
                    {t.t("ui.precheck.column.deflection")}
                  </th>
                  <th scope="col" className="num">
                    {t.t("ui.precheck.column.stress")}
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
              {summary.notes.map((n, i) => (
                <li key={i}>{t.t(n)}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      <p className="disclaimer">{t.t(PRECHECK_LABEL)}.</p>
    </section>
  );
}
