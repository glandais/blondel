/**
 * Onglet « Comparateur » : variantes de structure sur le même tracé (bois à la française, bois
 * à l'anglaise si l'escalier est droit, plat découpé laser, profilés UPN et IPE), calculées par
 * `compareVariants` du cœur dans un Web Worker dédié, en tableau côte à côte. Les euros ne sont
 * affichés que si le profil d'atelier porte un barème complet (« profil d'atelier requis »
 * sinon). Une variante peut être appliquée au projet (annulable).
 */
import { compareLines, type VariantRow } from "../lib/variants.js";
import { appStore, useApp, useComparison } from "../store/appStore.js";

const time = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

function apply(row: VariantRow): void {
  appStore.getState().setField(["stair", "structure"], { kind: row.kind, params: row.params });
  appStore.getState().endGroup();
}

export function CompareView() {
  const project = useApp((s) => s.project);
  const { outcome, pending, project: computedFor } = useComparison();
  // Résultats d'un projet antérieur (calcul en cours) : affichés, mais non applicables (les
  // paramètres de la variante reprennent ceux de l'ancien projet).
  const stale = computedFor !== project || pending;
  if (!outcome) {
    return (
      <div className="empty-view" role="status">
        <p>{pending ? "Comparaison des variantes en cours…" : "Aucune variante à comparer."}</p>
      </div>
    );
  }
  const rows = outcome.rows;
  if (rows.length === 0) {
    return (
      <div className="empty-view" role="status">
        <p>{outcome.error ?? "Aucune structure disponible dans le cœur pour la comparaison."}</p>
      </div>
    );
  }
  const lines = compareLines(rows);
  return (
    <div className="compare" aria-busy={stale}>
      <table>
        <caption>
          Comparaison des structures sur le tracé courant
          {stale ? " — mise à jour…" : ` (${time.format(outcome.timeMs)} ms)`}
        </caption>
        <thead>
          <tr>
            <th scope="col">Grandeur</th>
            {rows.map((r) => (
              <th key={r.id} scope="col" className={r.current ? "is-current" : undefined}>
                {r.label}
                {r.current ? <small className="compare__badge"> (projet)</small> : null}
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
            <th scope="row">Structure</th>
            {rows.map((r) => (
              <td key={r.id}>
                <button
                  type="button"
                  disabled={r.current || stale}
                  onClick={() => apply(r)}
                  title={
                    r.current
                      ? "Structure actuelle du projet"
                      : stale
                        ? "Comparaison en cours de mise à jour"
                        : "Remplacer la structure du projet"
                  }
                >
                  {r.current ? "Actuelle" : "Appliquer"}
                </button>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
      <p className="muted">
        Grandeurs physiques calculées par le cœur, paramètres par défaut de chaque structure (ceux
        du projet pour la structure en cours). Coût : barème du profil d'atelier (taux horaire,
        temps unitaires, prix matière et finition) ; sans barème complet, aucun montant n'est
        affiché. Prédimensionnement indicatif : ne remplace pas une note de calcul.
      </p>
    </div>
  );
}
