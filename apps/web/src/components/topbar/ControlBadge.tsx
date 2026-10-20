/**
 * Badge « Contrôle » de la barre du haut (maquette 1b) : bordure et couleur de la sévérité la plus
 * haute du contrôle de conception, compteurs des bloquants, avertissements et conseils (affichés
 * seulement s'ils sont non nuls), puis le mot « Contrôle ». Un clic efface la sélection et montre
 * le bloc de contrôle de l'inspecteur (`revealControl`). La pastille enveloppe les compteurs et le
 * bouton, qui ne contient que le mot : le nom accessible est le texte affiché (WCAG 2.5.3), les
 * comptes en toutes lettres en sont la description ; le bouton couvre toute la pastille. Aucune
 * règle n'est évaluée ici : les résultats viennent du modèle calculé par le worker (comptes de
 * `lib/compliance.ts`).
 */
import type { ComplianceReport, Severity } from "@blondel/core";
import { msg } from "@blondel/i18n";
import { Info, OctagonX, TriangleAlert, type LucideIcon } from "lucide-react";
import { useId, useMemo } from "react";
import { useT } from "../../i18n/useT.js";
import {
  controlCounts,
  groupResults,
  highestSeverity,
  type ControlCounts,
} from "../../lib/compliance.js";
import { useModel } from "../../store/appStore.js";
import { revealControl } from "../../store/uiStore.js";
import { Icon } from "../ui/Icon.js";

/** Tonalité du badge : sévérité la plus haute, `ok` sans violation, `none` sans modèle. */
export type ControlTone = Severity | "ok" | "none";

/** Comptes du badge (`null` sans rapport) : un seul regroupement des résultats. */
export function badgeCounts(report: ComplianceReport | undefined): {
  readonly counts: ControlCounts;
  readonly tone: ControlTone;
} | null {
  if (!report) return null;
  const groups = groupResults(report);
  return { counts: controlCounts(groups), tone: highestSeverity(groups) ?? "ok" };
}

const COUNT_ICONS: readonly { readonly severity: Severity; readonly icon: LucideIcon }[] = [
  { severity: "bloquant", icon: OctagonX },
  { severity: "avertissement", icon: TriangleAlert },
  { severity: "conseil", icon: Info },
];

export function ControlBadge() {
  const t = useT();
  const view = useModel();
  const report = view.model?.compliance;
  const summaryId = useId();
  const badge = useMemo(() => badgeCounts(report), [report]);
  const counts = badge?.counts ?? null;
  const tone: ControlTone = badge?.tone ?? "none";
  const label = counts
    ? t.t("ui.topbar.control.summary", {
        blocking: msg("ui.topbar.control.blocking", { count: counts.bloquant }),
        warnings: msg("ui.topbar.control.warnings", { count: counts.avertissement }),
        advice: msg("ui.topbar.control.advice", { count: counts.conseil }),
      })
    : // Sans modèle : calcul en cours, ou modèle indisponible (erreur de génération).
      t.t(view.pending ? "ui.topbar.control.pending" : "ui.topbar.control.unavailable");

  return (
    <div className="btn btn-secondary control-badge" data-severity={tone}>
      {counts
        ? COUNT_ICONS.filter((c) => counts[c.severity] > 0).map((c) => (
            <span
              key={c.severity}
              className={`control-badge__count control-badge__count--${c.severity}`}
              aria-hidden="true"
            >
              <Icon icon={c.icon} size={15} />
              {counts[c.severity]}
            </span>
          ))
        : null}
      <button
        type="button"
        className="control-badge__button"
        aria-describedby={summaryId}
        title={t.t("ui.topbar.control.title")}
        onClick={revealControl}
      >
        <span className="control-badge__word">{t.t("ui.topbar.control.label")}</span>
      </button>
      <span id={summaryId} hidden>
        {label}
      </span>
    </div>
  );
}
