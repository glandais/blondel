/**
 * Carte d'une règle en défaut (maquette 2d) : cadre blueprint, un bouton plein cadre ; en tête,
 * icône et libellé de la sévérité à gauche, localisation courte à droite (« LE1 · M6 ») ; en
 * corps, le titre court de la règle. Un clic ouvre l'inspecteur Règle (2c) : sélection de la
 * localisation et de la règle. L'identifiant de la règle n'apparaît que dans la 2c (Référence) ;
 * `data-rule` le garde pour les tests.
 *
 * Variante `compact` (blocs « Règles sur cette marche / cette pièce » des inspecteurs 2a et 2b) :
 * sans localisation (l'élément est celui de l'inspecteur) ; en corps, le titre de la règle et
 * « Mesuré … · attendu … » formatés par l'interface comme dans l'inspecteur Règle (mm entiers,
 * maquette 2a), ou le constat du cœur si la règle n'a pas de mesure.
 */
import { ruleTitle, type RuleResult, type Severity } from "@blondel/core";
import { Info, OctagonX, TriangleAlert, type LucideIcon } from "lucide-react";
import { useT } from "../../i18n/useT.js";
import { SEVERITY_LABELS, locationShort } from "../../lib/compliance.js";
import { formatFigureLengthWithUnit, formatMeasure } from "../../lib/units.js";
import { Corners } from "../ui/Blueprint.js";
import { Icon } from "../ui/Icon.js";
import { useApp } from "../../store/appStore.js";
import { bounds, resultMessage, selectResult, useModelParts } from "./RuleResults.js";

/** Icône Lucide de chaque sévérité. */
export const SEVERITY_ICONS: Readonly<Record<Severity, LucideIcon>> = {
  bloquant: OctagonX,
  avertissement: TriangleAlert,
  conseil: Info,
};

export interface RuleCardProps {
  readonly r: RuleResult;
  /** Carte d'un inspecteur d'élément : constat en corps, sans localisation. */
  readonly compact?: boolean;
}

export function RuleCard({ r, compact = false }: RuleCardProps) {
  const t = useT();
  const parts = useModelParts();
  return (
    <li
      className={`blueprint rule-card${compact ? " rule-card--compact" : ""}`}
      data-severity={r.severity}
      data-rule={r.ruleId}
    >
      <Corners />
      <button
        type="button"
        className="result result--violation rule-card__button"
        onClick={() => selectResult(r)}
      >
        <span className="rule-card__head">
          <span className="rule-card__severity">
            <Icon icon={SEVERITY_ICONS[r.severity]} size={15} />
            {t.t(SEVERITY_LABELS[r.severity])}
          </span>
          {compact ? null : (
            <span className="rule-card__loc">{t.t(locationShort(r.location, parts))}</span>
          )}
        </span>
        <span className="rule-card__body">
          {compact ? <CompactBody r={r} /> : t.t(ruleTitle(r.ruleId))}
        </span>
      </button>
    </li>
  );
}

/** Corps d'une carte compacte : titre et mesure formatée, ou constat sans mesure. */
function CompactBody({ r }: { readonly r: RuleResult }) {
  const t = useT();
  const unit = useApp((s) => s.displayUnit);
  if (r.measured === undefined) return <>{resultMessage(r, t)}</>;
  const expected = bounds(r, unit, t);
  // Longueur mesurée en mm entiers (cm au dixième), comme les chiffres clés ; arrondi à
  // l'affichage seulement (ADR-0003).
  const value =
    r.unit === "mm"
      ? formatFigureLengthWithUnit(r.measured, unit, t.locale)
      : formatMeasure(r.measured, r.unit, unit, t.locale);
  const measured = `${t.t("ui.ruleInspector.gauge.measured")} ${value}`;
  return (
    <>
      <span className="rule-card__title">{t.t(ruleTitle(r.ruleId))}</span>
      <span className="rule-card__measure">
        {expected === ""
          ? measured
          : `${measured} · ${t.t("ui.ruleInspector.gauge.expected", { bounds: expected })}`}
      </span>
    </>
  );
}
