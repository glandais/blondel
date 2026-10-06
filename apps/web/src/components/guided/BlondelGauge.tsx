/**
 * Jauge du module 2h + g, sous les chiffres clés de l'étape « Découpage » du parcours guidé
 * (maquette 1a) : barre de l'échelle, zone de confort, repère à la valeur, graduations en cm et
 * phrase de statut. Les données viennent de `blondelGauge` (valeur du modèle, bornes de la règle
 * `BLONDEL_CONFORT` de la table, statut du rapport) : aucun seuil ni comparaison ici.
 *
 * Accessibilité : `role="meter"`, valeurs en mm (`aria-valuemin` / `max` / `now`), phrase de
 * statut en `aria-valuetext`. `data-value` (mm) et `data-status` servent aux tests de bout en bout.
 */
import type { CSSProperties } from "react";
import { formatNumber } from "../../i18n/locale.js";
import { useT } from "../../i18n/useT.js";
import { blondelGauge, type BlondelGauge as Gauge } from "../../lib/blondelGauge.js";
import type { Model } from "@blondel/core";
import type { Translator } from "@blondel/i18n";

/** Millimètres affichés en cm, au dixième au plus, dans la langue. */
function cm(mm: number, t: Translator): string {
  return formatNumber(t.locale, mm / 10, { maximumFractionDigits: 1 });
}

/** Phrase de statut de la jauge (aussi `aria-valuetext`). */
export function blondelGaugeText(g: Gauge, t: Translator): string {
  const params = { value: cm(g.value, t), min: cm(g.zone.min, t), max: cm(g.zone.max, t) };
  switch (g.status) {
    case "comfortable":
      return t.t("ui.guided.gauge.comfortable", params);
    case "outside":
      return t.t("ui.guided.gauge.outside", params);
    case "unknown":
      return t.t("ui.guided.gauge.unknown", params);
  }
}

const pct = (x: number): string => `${(x * 100).toFixed(3)}%`;

export function BlondelGauge({ model }: { model: Pick<Model, "stepping" | "compliance"> | null }) {
  const t = useT();
  const g = blondelGauge(model);
  if (g === null) return null;
  const text = blondelGaugeText(g, t);
  const zone = {
    left: pct(g.position.zoneStart),
    width: pct(g.position.zoneEnd - g.position.zoneStart),
  } as CSSProperties;
  const ticks = [
    { id: "scale-min", at: 0, label: cm(g.scale.min, t) },
    { id: "zone-min", at: g.position.zoneStart, label: cm(g.zone.min, t) },
    { id: "zone-max", at: g.position.zoneEnd, label: cm(g.zone.max, t) },
    {
      id: "scale-max",
      at: 1,
      label: t.t("ui.guided.gauge.tick", { value: cm(g.scale.max, t) }),
    },
  ];
  return (
    <div
      className={`blondel-gauge blondel-gauge--${g.status}`}
      role="meter"
      aria-label={t.t("ui.guided.gauge.label")}
      aria-valuemin={g.scale.min}
      aria-valuemax={g.scale.max}
      aria-valuenow={Math.min(g.scale.max, Math.max(g.scale.min, g.value))}
      aria-valuetext={text}
      data-value={g.value}
      data-status={g.status}
    >
      <div className="blondel-gauge__bar" aria-hidden="true">
        <span className="blondel-gauge__zone" style={zone} />
        <span
          className="blondel-gauge__mark"
          style={{ left: pct(g.position.value) } as CSSProperties}
        />
      </div>
      <div className="blondel-gauge__ticks num" aria-hidden="true">
        {ticks.map((k) => (
          <span
            key={k.id}
            className={`blondel-gauge__tick blondel-gauge__tick--${k.id}`}
            style={k.at > 0 && k.at < 1 ? ({ left: pct(k.at) } as CSSProperties) : undefined}
          >
            {k.label}
          </span>
        ))}
      </div>
      <p className="blondel-gauge__text" aria-hidden="true">
        {text}
      </p>
    </div>
  );
}
