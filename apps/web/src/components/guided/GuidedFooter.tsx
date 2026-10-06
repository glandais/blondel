/**
 * Pied du parcours guidé (maquette 1a), 60 px sur fond neutral-100 :
 *
 * - à gauche, les comptes du contrôle de conception en boutons ghost : bloquants (rouge),
 *   avertissements (ocre) et conseils (acier), chacun seulement s'il est non nul ; si les trois
 *   sont nuls, un seul bouton neutre « Aucun constat » ; un clic ouvre la liste du contrôle
 *   par-dessus la vue
 *   (`revealControl` : sélection effacée, `ControlOverlay`). Le bouton qui l'a ouverte reçoit à
 *   nouveau le focus quand Échap la referme (`focusControlOpener`) ;
 * - la mention indicative du contrôle, toujours visible ;
 * - à droite, « ← Étape précédente » (secondaire) et « Étape suivante → » (primaire blueprint),
 *   absents aux bornes du parcours (`goToGuidedStep`).
 *
 * Aucune règle n'est évaluée ici : comptes de `lib/compliance.ts` sur le rapport du modèle.
 */
import type { Severity } from "@blondel/core";
import {
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  Info,
  OctagonX,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { MessageKey } from "@blondel/i18n";
import { useMemo, type MouseEvent } from "react";
import { useT } from "../../i18n/useT.js";
import { controlCounts, groupResults } from "../../lib/compliance.js";
import { STEP_TITLE_KEYS, nextStep, previousStep } from "../../lib/guidedSteps.js";
import { useJourney, useModel } from "../../store/appStore.js";
import { goToGuidedStep, revealControl } from "../../store/uiStore.js";
import { Corners } from "../ui/Blueprint.js";
import { Icon } from "../ui/Icon.js";
import "./guided.css";

/** Bouton du pied qui a ouvert la liste du contrôle (focus rendu à sa fermeture). */
let controlOpener: HTMLElement | null = null;

/** Rend le focus au bouton du pied qui a ouvert la liste du contrôle, s'il est encore affiché. */
export function focusControlOpener(): void {
  const el = controlOpener;
  if (el !== null && el.isConnected) {
    el.focus();
    return;
  }
  // Repli : premier bouton de compte du pied (le précédent a pu disparaître).
  if (typeof document === "undefined") return;
  document.querySelector<HTMLElement>(".guided-footer__count")?.focus();
}

interface CountButton {
  readonly severity: Severity;
  readonly icon: LucideIcon;
  readonly key: MessageKey;
}

const COUNT_BUTTONS: readonly CountButton[] = [
  { severity: "bloquant", icon: OctagonX, key: "ui.topbar.control.blocking" },
  { severity: "avertissement", icon: TriangleAlert, key: "ui.topbar.control.warnings" },
  { severity: "conseil", icon: Info, key: "ui.topbar.control.advice" },
];

/**
 * Boutons de compte affichés : sévérités au compte non nul, dans l'ordre bloquants,
 * avertissements, conseils ; `"none"` si les trois sont nuls (un seul bouton « Aucun constat »).
 */
export function footerCountButtons(
  counts: Readonly<Record<Severity, number>>,
): readonly Severity[] | "none" {
  const shown = COUNT_BUTTONS.filter((b) => counts[b.severity] > 0).map((b) => b.severity);
  return shown.length === 0 ? "none" : shown;
}

export function GuidedFooter() {
  const t = useT();
  const step = useJourney((s) => s.guidedStep);
  const { model, pending } = useModel();
  const report = model?.compliance;
  const counts = useMemo(() => (report ? controlCounts(groupResults(report)) : null), [report]);
  const previous = previousStep(step);
  const next = nextStep(step);
  const shown = counts ? footerCountButtons(counts) : null;
  const open = (e: MouseEvent<HTMLButtonElement>): void => {
    controlOpener = e.currentTarget;
    revealControl();
  };

  return (
    <footer
      className="guided-footer"
      aria-label={t.t("ui.guided.footer.label")}
      // Calcul en cours : les comptes sont ceux du modèle précédent (attendu par les e2e).
      data-pending={pending ? "true" : undefined}
    >
      <div className="guided-footer__counts">
        {shown === "none" ? (
          // Aucun constat : un bouton neutre garde l'accès à la liste du contrôle (et au
          // Contexte de contrôle, qui n'a pas d'étape).
          <button
            type="button"
            className="btn btn-ghost guided-footer__count"
            data-severity="none"
            title={t.t("ui.guided.footer.openControl")}
            onClick={open}
          >
            <Icon icon={CircleCheck} size={16} />
            {t.t("ui.guided.footer.noFinding")}
          </button>
        ) : counts && shown ? (
          COUNT_BUTTONS.filter((b) => shown.includes(b.severity)).map((b) => (
            <button
              key={b.severity}
              type="button"
              className="btn btn-ghost guided-footer__count"
              data-severity={b.severity}
              title={t.t("ui.guided.footer.openControl")}
              onClick={open}
            >
              <Icon icon={b.icon} size={16} />
              {t.t(b.key, { count: counts[b.severity] })}
            </button>
          ))
        ) : null}
      </div>
      <span className="guided-footer__disclaimer">{t.t("ui.compliance.disclaimer")}</span>
      <span className="guided-footer__spacer" />
      {previous !== null ? (
        <button
          type="button"
          className="btn btn-secondary guided-footer__nav"
          aria-label={t.t("ui.guided.footer.previous", {
            step: t.t(STEP_TITLE_KEYS[previous]),
          })}
          onClick={() => goToGuidedStep(previous)}
        >
          <Icon icon={ArrowLeft} size={15} />
          {t.t(STEP_TITLE_KEYS[previous])}
        </button>
      ) : null}
      {next !== null ? (
        <button
          type="button"
          className="btn btn-primary blueprint guided-footer__nav guided-footer__next"
          aria-label={t.t("ui.guided.footer.next", { step: t.t(STEP_TITLE_KEYS[next]) })}
          onClick={() => goToGuidedStep(next)}
        >
          <Corners />
          {t.t(STEP_TITLE_KEYS[next])}
          <Icon icon={ArrowRight} size={15} />
        </button>
      ) : null}
    </footer>
  );
}
