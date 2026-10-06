/**
 * Onglet « Comparer » du mode Fabrication : variantes de structure sur la même épure (bois à la
 * française, bois à l'anglaise si l'escalier est droit, plat découpé laser, limon de jour débillardé soudé s'il y
 * a un tournant, profilés UPN et IPE ; hélicoïdal : fût avec marches bois ou en tôle), calculées
 * par `compareEpure` du cœur dans un Web Worker dédié, en tableau côte à côte. Le raccord de jour
 * est adapté à chaque structure (poteau, arc roulable) et les écarts d'épure sont listés. Les
 * euros ne sont affichés que si le profil d'atelier porte un barème complet (« profil d'atelier
 * requis » sinon). Une variante peut être appliquée au projet, jour adapté compris (annulable).
 */
import { numberFormat } from "../i18n/locale.js";
import { useT } from "../i18n/useT.js";
import { applyVariant, compareLines, type VariantRow } from "../lib/variants.js";
import { appStore, useComparison } from "../store/appStore.js";

const TIME: Intl.NumberFormatOptions = { maximumFractionDigits: 0 };

function apply(row: VariantRow): void {
  appStore.getState().update((p) => applyVariant(p, row));
  appStore.getState().endGroup();
}

export function CompareView() {
  const t = useT();
  const { outcome, pending, project: computedFor, requested } = useComparison();
  // Résultats d'un projet antérieur (calcul en cours) : affichés, mais non applicables (les
  // paramètres de la variante reprennent ceux de l'ancien projet). `requested` : projet courant
  // augmenté du barème d'atelier (QUESTIONS A14).
  const stale = computedFor !== requested || pending;
  if (!outcome) {
    return (
      <div className="empty-view" role="status">
        <p>{t.t(pending ? "ui.compare.pending" : "ui.compare.none")}</p>
      </div>
    );
  }
  const rows = outcome.rows;
  if (rows.length === 0) {
    return (
      <div className="empty-view" role="status">
        <p>{outcome.error ? t.t(outcome.error) : t.t("ui.compare.noStructure")}</p>
      </div>
    );
  }
  const lines = compareLines(rows, t);
  return (
    <div className="compare" aria-busy={stale}>
      <table className="table">
        <caption>
          {t.t("ui.compare.caption")}
          {stale
            ? t.t("ui.compare.updating")
            : t.t("ui.compare.time", {
                time: numberFormat(t.locale, TIME).format(outcome.timeMs),
              })}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t.t("ui.compare.quantity")}</th>
            {rows.map((r) => (
              <th key={r.id} scope="col" className={r.current ? "is-current" : undefined}>
                {t.t(r.label)}
                {r.current ? (
                  <small className="compare__badge">{t.t("ui.compare.projectBadge")}</small>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.key}>
              <th scope="row">{l.label}</th>
              {l.cells.map((c, i) => (
                <td
                  key={rows[i]?.id ?? i}
                  className={`num${c.tone ? ` tone-${c.tone}` : ""}`}
                  title={c.title}
                >
                  {c.text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">{t.t("ui.compare.notes")}</th>
            {rows.map((r) => {
              const notes = [...r.signals, ...r.deviations];
              return (
                <td key={r.id} className="compare__notes">
                  {notes.length > 0 ? (
                    <ul>
                      {notes.map((n, i) => (
                        <li key={i}>{t.t(n)}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="muted">–</span>
                  )}
                </td>
              );
            })}
          </tr>
          <tr>
            <th scope="row">{t.t("ui.compare.structure")}</th>
            {rows.map((r) => (
              <td key={r.id}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={r.current || stale}
                  onClick={() => apply(r)}
                  title={t.t(
                    r.current
                      ? "ui.compare.apply.current.title"
                      : stale
                        ? "ui.compare.apply.stale.title"
                        : r.adaptations.length > 0
                          ? "ui.compare.apply.adapt.title"
                          : "ui.compare.apply.title",
                  )}
                >
                  {t.t(r.current ? "ui.compare.apply.current" : "ui.compare.apply")}
                </button>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
      <p className="muted">{t.t("ui.compare.footnote")}</p>
    </div>
  );
}
