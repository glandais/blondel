/**
 * Barre d'état : grandeurs principales lues dans le modèle (aucun calcul ici) et temps de
 * calcul du pipeline.
 */
import { formatDuration, formatLength } from "../lib/units.js";
import { useApp, useModel } from "../store/appStore.js";

export function StatusBar() {
  const { model, errors, timeMs } = useModel();
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
    ["Calcul", "Temps de calcul du modèle", formatDuration(model ? timeMs : undefined)],
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
      {errors.length > 0 ? (
        <span className="statusbar__errors" role="status" title={errors.join("\n")}>
          {errors.length === 1 ? errors[0] : `${errors.length} erreurs de génération`}
        </span>
      ) : null}
    </footer>
  );
}
