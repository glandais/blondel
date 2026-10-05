/**
 * Carte d'une règle en défaut dans l'inspecteur « sans sélection » (maquette 2d) : cadre
 * blueprint, icône et libellé de la sévérité, localisation, identifiant de la règle et message.
 * Un clic sélectionne l'élément concerné et la règle (bascule) ; la carte sélectionnée se
 * déplie avec mesuré / attendu, nature et confiance, et la surcharge de la règle. L'inspecteur
 * « Règle » (maquette 2c, vague 3) prendra le relais pour la carte sélectionnée.
 */
import type { RuleResult, Severity } from "@blondel/core";
import { Info, OctagonX, TriangleAlert, type LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { useT } from "../../i18n/useT.js";
import { SEVERITY_LABELS, locationLabel } from "../../lib/compliance.js";
import { Corners } from "../ui/Blueprint.js";
import { Icon } from "../ui/Icon.js";
import {
  OverrideControl,
  ResultMeasure,
  ResultMeta,
  resultMessage,
  toggleResultSelection,
  useIsSelected,
} from "./RuleResults.js";

/** Icône Lucide de chaque sévérité. */
export const SEVERITY_ICONS: Readonly<Record<Severity, LucideIcon>> = {
  bloquant: OctagonX,
  avertissement: TriangleAlert,
  conseil: Info,
};

export function RuleCard({ r }: { r: RuleResult }) {
  const t = useT();
  const selected = useIsSelected(r);
  const ref = useRef<HTMLLIElement>(null);
  // Sélection venue d'ailleurs (plan, 3D, barre d'erreurs) : la carte vient dans le champ.
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  return (
    <li
      ref={ref}
      className={`blueprint rule-card${selected ? " rule-card--selected" : ""}`}
      data-severity={r.severity}
      data-rule={r.ruleId}
    >
      <Corners />
      <button
        type="button"
        className="result result--violation rule-card__button"
        aria-pressed={selected}
        onClick={() => toggleResultSelection(r, selected)}
      >
        <span className="rule-card__head">
          <span className="rule-card__severity">
            <Icon icon={SEVERITY_ICONS[r.severity]} size={15} />
            {t.t(SEVERITY_LABELS[r.severity])}
          </span>
          <span className="rule-card__loc">{t.t(locationLabel(r.location))}</span>
        </span>
        <code className="rule-card__id">{r.ruleId}</code>
        <span className="result__msg">{resultMessage(r, t)}</span>
      </button>
      {selected ? (
        <div className="rule-card__details">
          <ResultMeasure r={r} />
          <ResultMeta r={r} />
          <OverrideControl ruleId={r.ruleId} />
        </div>
      ) : null}
    </li>
  );
}
