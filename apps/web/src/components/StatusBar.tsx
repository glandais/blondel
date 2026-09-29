/**
 * Barre d'état : grandeurs principales lues dans le modèle (aucun calcul ici) et temps de
 * calcul, séparés entre le cœur (`buildModel`) et le maillage d'aperçu, ADR-0006. Les deux sont
 * mesurés dans le Web Worker de calcul (ou sur le fil principal en repli) à chaque modèle,
 * que la vue 3D soit affichée ou non.
 */
import { formatDuration, formatLength } from "../lib/units.js";
import { useApp, useModel } from "../store/appStore.js";

export function StatusBar() {
  const { model, errors, timeMs, mesh, meshError, pending } = useModel();
  const unit = useApp((s) => s.displayUnit);
  const st = model?.stepping;
  const items: [string, string, string][] = [
    ["n", "Nombre de hauteurs", st ? String(st.riserCount) : "–"],
    ["h", "Hauteur de marche", formatLength(st?.rise, unit)],
    ["g", "Giron sur la ligne de foulée", formatLength(st?.going, unit)],
    ["2h + g", "Module de Blondel", formatLength(st?.blondel, unit)],
    [
      "Échappée min.",
      "Échappée minimale (verticale, ligne de foulée)",
      formatLength(model?.headroom?.min, unit),
    ],
    [
      "Cœur",
      "Temps de buildModel (tracé, découpage, pièces, échappée, contrôle) — budget 15 ms (ADR-0006)",
      formatDuration(model ? timeMs : undefined),
    ],
    [
      "Maillage",
      mesh
        ? `Maillage d'aperçu des pièces — budget 30 ms (ADR-0006) ; ${mesh.misses} pièce(s) maillée(s), ${mesh.hits} réutilisée(s)`
        : (meshError ?? "Maillage d'aperçu : aucun modèle"),
      formatDuration(mesh?.timeMs),
    ],
  ];
  return (
    <footer className="statusbar" aria-label="Barre d'état">
      <dl>
        {items.map(([k, title, v]) => (
          <div key={k} className="statusbar__item" title={title}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {pending ? (
        <span className="statusbar__pending" role="status">
          Calcul…
        </span>
      ) : null}
      {errors.length > 0 ? (
        <span className="statusbar__errors" role="status" title={errors.join("\n")}>
          {errors.length === 1 ? errors[0] : `${errors.length} erreurs de génération`}
        </span>
      ) : null}
    </footer>
  );
}
