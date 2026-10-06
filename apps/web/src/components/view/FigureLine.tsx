/**
 * Ligne de chiffres sous la vue (maquette 1b), qui remplace la barre d'état : grandeurs
 * principales lues dans le modèle et le projet (aucun calcul ici), « Calculé en N ms » qui déplie
 * les temps du cœur (`buildModel`) et du maillage d'aperçu (ADR-0006), mesurés dans le
 * Web Worker à chaque modèle ; « Calcul… » pendant un calcul ; erreurs de génération.
 *
 * Format de la maquette : longueurs en mm entiers avec l'unité (« h 180 mm »), arrondies à
 * l'affichage seulement (ADR-0003, `formatFigureLengthWithUnit`). Toujours sur **une** ligne :
 * quand la place manque (panneau ouvert, fenêtre moyenne), les chiffres secondaires
 * (`data-tier="2"` : emmarchement, échappée sur la largeur, puis `data-tier="3"` : échappée)
 * quittent la ligne (requêtes de conteneur de view.css) et restent lisibles dans le détail
 * repliable « Calculé en N ms », qui les reprend tous ; chaque chiffre garde son intitulé complet
 * en info-bulle.
 */
import { msg } from "@blondel/i18n";
import { useT } from "../../i18n/useT.js";
import { formatDuration, formatFigureLengthWithUnit } from "../../lib/units.js";
import { useApp, useModel } from "../../store/appStore.js";

/** Priorité d'un chiffre : 1 toujours sur la ligne, 2 puis 3 retirés quand la place manque. */
export type FigureTier = 1 | 2 | 3;

interface Figure {
  readonly id: string;
  readonly symbol: string;
  readonly title: string;
  readonly value: string;
  readonly tier: FigureTier;
}

/** Priorité de chaque chiffre de la ligne (maquette 1b : secondaires retirés d'abord). */
export const FIGURE_TIERS: Readonly<Record<string, FigureTier>> = {
  n: 1,
  h: 1,
  g: 1,
  blondel: 1,
  width: 2,
  headroom: 3,
  headroomWidth: 2,
};

export function FigureLine() {
  const t = useT();
  const { model, errors, timeMs, mesh, meshError, pending, project: modelProject } = useModel();
  const project = useApp((s) => s.project);
  const unit = useApp((s) => s.displayUnit);
  const loc = t.locale;
  const st = model?.stepping;
  const len = (mm: number | undefined | null): string => formatFigureLengthWithUnit(mm, unit, loc);
  // Projet dont le modèle affiché est issu (cohérent pendant un calcul).
  const shown = modelProject ?? project;
  // Trémie couvrante : échappée non limitée par la dalle haute (lue dans le modèle, QUESTIONS A7).
  const unlimited = model?.headroomUnlimited;
  const UNLIMITED = t.t("ui.status.unlimited");
  const base: readonly Omit<Figure, "tier">[] = [
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
      value: len(st?.rise),
    },
    {
      id: "g",
      symbol: t.t("ui.status.going.symbol"),
      title: t.t("ui.status.going.title"),
      value: len(st?.going),
    },
    {
      id: "blondel",
      symbol: t.t("ui.status.blondel.symbol"),
      title: t.t("ui.status.blondel.title"),
      value: len(st?.blondel),
    },
    {
      id: "width",
      symbol: t.t("ui.figures.width.symbol"),
      title: t.t("ui.figures.width.title"),
      value: len(shown.stair.layout.width),
    },
    {
      id: "headroom",
      symbol: t.t("ui.figures.headroom.symbol"),
      title: unlimited?.walkline
        ? t.t("ui.status.headroom.titleUnlimited")
        : t.t("ui.status.headroom.title"),
      value: unlimited?.walkline ? UNLIMITED : len(model?.headroom?.min),
    },
    {
      id: "headroomWidth",
      symbol: t.t("ui.status.headroomWidth.symbol"),
      title: unlimited?.width
        ? t.t("ui.status.headroomWidth.titleUnlimited")
        : t.t("ui.status.headroomWidth.title"),
      value: unlimited?.width ? UNLIMITED : len(model?.headroomWidth?.min),
    },
  ];
  const figures: readonly Figure[] = base.map((f) => ({ ...f, tier: FIGURE_TIERS[f.id] ?? 1 }));
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
  const computed = t.t("ui.figures.computed", { time: formatDuration(timeMs, loc) });
  const secondary = figures.filter((f) => f.tier > 1);
  return (
    <footer className="figure-line" aria-label={t.t("ui.figures.label")}>
      <dl className="figure-line__list">
        {figures.map((f) => (
          <div
            key={f.id}
            className="figure-line__item"
            data-figure={f.id}
            data-tier={f.tier > 1 ? String(f.tier) : undefined}
            title={f.title}
          >
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
        // Détail cœur / maillage atteignable au clavier et au toucher (repli natif) ; il reprend
        // les chiffres secondaires retirés de la ligne faute de place.
        <details className="figure-line__time">
          <summary title={computed}>
            <span className="figure-line__time-long">{computed}</span>
            <span className="figure-line__time-short">{formatDuration(timeMs, loc)}</span>
          </summary>
          <div className="figure-line__time-details">
            <dl className="figure-line__extra">
              {secondary.map((f) => (
                <div key={f.id} data-figure={f.id} data-tier={String(f.tier)}>
                  <dt>{f.title}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
            <ul>
              {timeDetails.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </details>
      ) : null}
    </footer>
  );
}
