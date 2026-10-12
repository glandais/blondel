/**
 * Résumé en lecture seule d'un tracé libre (cage, ADR-0010, sous-lot 4a), affiché par la section
 * Tracé : messages neutres, traduits à l'affichage.
 */
import type { CageLayoutSpec } from "@blondel/core";
import { msg, type Locale, type Message, type MessageKey } from "@blondel/i18n";
import { formatNumber } from "../i18n/locale.js";

const CAGE_MODE_KEYS = {
  winders: "ui.params.cage.mode.winders",
  landing: "ui.params.cage.mode.landing",
  radiating: "ui.params.cage.mode.radiating",
} as const satisfies Record<CageLayoutSpec["junctions"][number]["mode"], MessageKey>;

/**
 * Lignes du résumé d'un tracé libre : tronçons et jonctions alternés, valeurs saisies
 * (balayage d'un arc en degrés signés, largeur variable « w → wEnd », mode de jonction).
 */
export function cageSummaryLines(layout: CageLayoutSpec, locale: Locale): Message[] {
  const n = (v: number): string => formatNumber(locale, v, { maximumFractionDigits: 1 });
  const lines: Message[] = [];
  layout.sections.forEach((s, i) => {
    const width =
      s.widthEnd !== undefined && s.widthEnd !== s.width
        ? `${n(s.width)} → ${n(s.widthEnd)}`
        : n(s.width);
    const index = i + 1;
    const axis = s.axis;
    lines.push(
      axis.kind === "arc"
        ? msg("ui.params.cage.section.arc", {
            index,
            radius: n(axis.radius),
            sweep: n(axis.sweep),
            width,
          })
        : axis.length === "auto"
          ? msg("ui.params.cage.section.straightAuto", { index, width })
          : msg("ui.params.cage.section.straight", { index, length: n(axis.length), width }),
    );
    const j = layout.junctions[i];
    if (j !== undefined) {
      lines.push(
        msg("ui.params.cage.junction", {
          index,
          angle: n(j.angle),
          mode: msg(CAGE_MODE_KEYS[j.mode]),
        }),
      );
    }
  });
  return lines;
}
