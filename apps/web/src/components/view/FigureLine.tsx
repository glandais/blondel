/**
 * Ligne de chiffres sous la vue (maquette 1b), qui remplace la barre d'état : grandeurs
 * principales lues dans le modèle et le projet (aucun calcul ici), « Calculé en N ms » qui déplie
 * les temps du cœur (`buildModel`) et du maillage d'aperçu (ADR-0006), mesurés dans le
 * Web Worker à chaque modèle ; « Calcul… » pendant un calcul ; erreurs de génération.
 */
import { msg } from "@blondel/i18n";
import { useT } from "../../i18n/useT.js";
import { formatDuration, formatLength } from "../../lib/units.js";
import { useApp, useModel } from "../../store/appStore.js";

interface Figure {
  readonly id: string;
  readonly symbol: string;
  readonly title: string;
  readonly value: string;
}

export function FigureLine() {
  const t = useT();
  const { model, errors, timeMs, mesh, meshError, pending, project: modelProject } = useModel();
  const project = useApp((s) => s.project);
  const unit = useApp((s) => s.displayUnit);
  const loc = t.locale;
  const st = model?.stepping;
  // Projet dont le modèle affiché est issu (cohérent pendant un calcul).
  const shown = modelProject ?? project;
  // Trémie couvrante : échappée non limitée par la dalle haute (lue dans le modèle, QUESTIONS A7).
  const unlimited = model?.headroomUnlimited;
  const UNLIMITED = t.t("ui.status.unlimited");
  const figures: readonly Figure[] = [
    {
      id: "n",
      symbol: t.t("ui.status.riserCount.symbol"),
      title: t.t("ui.status.riserCount.title"),
      value: st ? String(st.riserCount) : "–",
    },
    {
      id: "h",
      symbol: t.t("ui.status.rise.symbol"),
      title: t.t("ui.status.rise.title"),
      value: formatLength(st?.rise, unit, loc),
    },
    {
      id: "g",
      symbol: t.t("ui.status.going.symbol"),
      title: t.t("ui.status.going.title"),
      value: formatLength(st?.going, unit, loc),
    },
    {
      id: "blondel",
      symbol: t.t("ui.status.blondel.symbol"),
      title: t.t("ui.status.blondel.title"),
      value: formatLength(st?.blondel, unit, loc),
    },
    {
      id: "width",
      symbol: t.t("ui.figures.width.symbol"),
      title: t.t("ui.figures.width.title"),
      value: formatLength(shown.stair.layout.width, unit, loc),
    },
    {
      id: "headroom",
      symbol: t.t("ui.figures.headroom.symbol"),
      title: unlimited?.walkline
        ? t.t("ui.status.headroom.titleUnlimited")
        : t.t("ui.status.headroom.title"),
      value: unlimited?.walkline ? UNLIMITED : formatLength(model?.headroom?.min, unit, loc),
    },
    {
      id: "headroomWidth",
      symbol: t.t("ui.status.headroomWidth.symbol"),
      title: unlimited?.width
        ? t.t("ui.status.headroomWidth.titleUnlimited")
        : t.t("ui.status.headroomWidth.title"),
      value: unlimited?.width ? UNLIMITED : formatLength(model?.headroomWidth?.min, unit, loc),
    },
  ];
  const meshDetail = mesh
    ? t.t("ui.status.mesh.title", {
        meshed: msg("ui.status.mesh.meshed", { count: mesh.misses }),
        reused: msg("ui.status.mesh.reused", { count: mesh.hits }),
      })
    : meshError
      ? t.t(meshError)
      : t.t("ui.status.mesh.none");
  const timeDetails = [
    t.t("ui.figures.time.core", {
      time: formatDuration(model ? timeMs : undefined, loc),
      detail: t.t("ui.status.core.title"),
    }),
    t.t("ui.figures.time.mesh", { time: formatDuration(mesh?.timeMs, loc), detail: meshDetail }),
  ];
  return (
    <footer className="figure-line" aria-label={t.t("ui.figures.label")}>
      <dl className="figure-line__list">
        {figures.map((f) => (
          <div key={f.id} className="figure-line__item" data-figure={f.id} title={f.title}>
            <dt>{f.symbol}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      {errors.length > 0 ? (
        <span
          className="figure-line__errors"
          role="status"
          title={errors.map((e) => t.t(e)).join("\n")}
        >
          {errors.length === 1
            ? t.t(errors[0]!)
            : t.t("ui.status.errors", { count: errors.length })}
        </span>
      ) : null}
      {pending ? (
        <span className="figure-line__pending" role="status">
          {t.t("ui.status.pending")}
        </span>
      ) : model ? (
        // Détail cœur / maillage atteignable au clavier et au toucher (repli natif).
        <details className="figure-line__time">
          <summary>{t.t("ui.figures.computed", { time: formatDuration(timeMs, loc) })}</summary>
          <ul className="figure-line__time-details">
            {timeDetails.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </footer>
  );
}
