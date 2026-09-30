/**
 * Barre d'état : grandeurs principales lues dans le modèle (aucun calcul ici) et temps de
 * calcul, séparés entre le cœur (`buildModel`) et le maillage d'aperçu, ADR-0006. Les deux sont
 * mesurés dans le Web Worker de calcul (ou sur le fil principal en repli) à chaque modèle,
 * que la vue 3D soit affichée ou non.
 */
import { msg } from "@blondel/i18n";
import { useT } from "../i18n/useT.js";
import { formatDuration, formatLength } from "../lib/units.js";
import { useApp, useModel } from "../store/appStore.js";

export function StatusBar() {
  const t = useT();
  const { model, errors, timeMs, mesh, meshError, pending } = useModel();
  const unit = useApp((s) => s.displayUnit);
  const loc = t.locale;
  const st = model?.stepping;
  // Trémie couvrante : échappée non limitée par la dalle haute (lue dans le modèle, QUESTIONS A7).
  const unlimited = model?.headroomUnlimited;
  /** Libellé d'une échappée que la dalle haute ne limite pas (trémie couvrante). */
  const UNLIMITED = t.t("ui.status.unlimited");
  // [identifiant, grandeur affichée, info-bulle, valeur]
  const items: [string, string, string, string][] = [
    [
      "n",
      t.t("ui.status.riserCount.symbol"),
      t.t("ui.status.riserCount.title"),
      st ? String(st.riserCount) : "–",
    ],
    [
      "h",
      t.t("ui.status.rise.symbol"),
      t.t("ui.status.rise.title"),
      formatLength(st?.rise, unit, loc),
    ],
    [
      "g",
      t.t("ui.status.going.symbol"),
      t.t("ui.status.going.title"),
      formatLength(st?.going, unit, loc),
    ],
    [
      "blondel",
      t.t("ui.status.blondel.symbol"),
      t.t("ui.status.blondel.title"),
      formatLength(st?.blondel, unit, loc),
    ],
    [
      "headroom",
      t.t("ui.status.headroom.symbol"),
      unlimited?.walkline
        ? t.t("ui.status.headroom.titleUnlimited")
        : t.t("ui.status.headroom.title"),
      unlimited?.walkline ? UNLIMITED : formatLength(model?.headroom?.min, unit, loc),
    ],
    [
      "headroomWidth",
      t.t("ui.status.headroomWidth.symbol"),
      unlimited?.width
        ? t.t("ui.status.headroomWidth.titleUnlimited")
        : t.t("ui.status.headroomWidth.title"),
      unlimited?.width ? UNLIMITED : formatLength(model?.headroomWidth?.min, unit, loc),
    ],
    [
      "core",
      t.t("ui.status.core.symbol"),
      t.t("ui.status.core.title"),
      formatDuration(model ? timeMs : undefined, loc),
    ],
    [
      "mesh",
      t.t("ui.status.mesh.symbol"),
      mesh
        ? t.t("ui.status.mesh.title", {
            meshed: msg("ui.status.mesh.meshed", { count: mesh.misses }),
            reused: msg("ui.status.mesh.reused", { count: mesh.hits }),
          })
        : meshError
          ? t.t(meshError)
          : t.t("ui.status.mesh.none"),
      formatDuration(mesh?.timeMs, loc),
    ],
  ];
  return (
    <footer className="statusbar" aria-label={t.t("ui.status.label")}>
      <dl>
        {items.map(([id, k, title, v]) => (
          <div key={id} className="statusbar__item" title={title}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {pending ? (
        <span className="statusbar__pending" role="status">
          {t.t("ui.status.pending")}
        </span>
      ) : null}
      {errors.length > 0 ? (
        <span
          className="statusbar__errors"
          role="status"
          title={errors.map((e) => t.t(e)).join("\n")}
        >
          {errors.length === 1
            ? t.t(errors[0]!)
            : t.t("ui.status.errors", { count: errors.length })}
        </span>
      ) : null}
    </footer>
  );
}
