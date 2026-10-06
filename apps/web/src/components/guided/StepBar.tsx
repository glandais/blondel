/**
 * Barre d'étapes du parcours guidé (maquette 1a, ADR-0009), 68 px : 7 cellules égales séparées
 * par des filets. Chaque étape est un onglet qui porte une pastille 24 × 24 (✓ si l'étape est
 * faite, son numéro sinon), son titre et son résumé d'une ligne (ocre s'il reste des ◆).
 *
 * Modèle ARIA des onglets à activation **manuelle**, comme le rail du parcours libre : les
 * flèches gauche / droite, Début et Fin déplacent le focus sans changer d'étape ; Entrée,
 * Espace ou un clic vont à l'étape (`goToGuidedStep`, qui propose la vue conseillée). Un seul
 * arrêt de tabulation : l'étape courante. Toutes les étapes sont atteignables, dans n'importe
 * quel ordre.
 *
 * Aucun calcul : résumés (`stepSummary`), ◆ restantes (`toValidateCountByStep`) et étapes
 * cochées (`checkedSteps` : vues et sans règle bloquante rattachée) viennent de fonctions pures.
 */
import { Check } from "lucide-react";
import { useMemo, useRef, type KeyboardEvent } from "react";
import { useT } from "../../i18n/useT.js";
import { STEP_TITLE_KEYS, stepSummary, type StepSummary } from "../../lib/guidedSteps.js";
import { toValidateCountByStep } from "../../lib/paramTiers.js";
import { checkedSteps } from "../../lib/ruleSteps.js";
import { GUIDED_STEPS, type GuidedStep } from "../../lib/sectionIds.js";
import { useApp, useJourney, useModel } from "../../store/appStore.js";
import { goToGuidedStep } from "../../store/uiStore.js";
import { Icon } from "../ui/Icon.js";
import { nextIndex } from "../ui/Segmented.js";
import "./guided.css";

/** Identifiant de l'onglet d'une étape (nomme le formulaire de l'étape, `aria-labelledby`). */
export function stepTabId(step: GuidedStep): string {
  return `step-tab-${step}`;
}

/** Identifiant du panneau d'onglet du formulaire d'étape (rendu par `App`). */
export const STEP_PANEL_ID = "guided-step-panel";

/** Étape atteinte depuis l'index `current` par une touche (flèches, Début, Fin), `null` sinon. */
export function stepKeyTarget(current: number, key: string): number | null {
  return nextIndex(
    current,
    key,
    GUIDED_STEPS.map(() => false),
  );
}

/**
 * Résumé d'une étape : seul le texte de base se tronque (…) ; la partie « · ◆ n … », rendue à
 * part, reste toujours visible. Elle est masquée aux lecteurs d'écran (glyphe décoratif) et
 * remplacée par un texte accessible (« n valeurs à valider »).
 */
function SummaryText({ summary, t }: { summary: StepSummary; t: ReturnType<typeof useT> }) {
  return (
    <>
      <span className="step-bar__summary-base">{summary.base}</span>
      {summary.toValidateText === null ? null : (
        <>
          <span className="step-bar__summary-tv" aria-hidden="true">
            {summary.toValidateText}
          </span>
          <span className="visually-hidden">
            {t.t("ui.sections.toValidateCount", { count: summary.toValidate })}
          </span>
        </>
      )}
    </>
  );
}

export function StepBar() {
  const t = useT();
  const project = useApp((s) => s.project);
  const unit = useApp((s) => s.displayUnit);
  const { model } = useModel();
  const current = useJourney((s) => s.guidedStep);
  const visited = useJourney((s) => s.visitedSteps);
  const toValidateByStep = useMemo(() => toValidateCountByStep(project, model), [project, model]);
  const summaries = useMemo(
    () =>
      GUIDED_STEPS.map((step) => stepSummary(step, { project, model, unit, toValidateByStep }, t)),
    [project, model, unit, toValidateByStep, t],
  );
  const report = model?.compliance;
  const checked = useMemo(() => checkedSteps(visited, report), [visited, report]);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const next = stepKeyTarget(index, e.key);
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
  };

  return (
    // Pas de repère `nav` : la liste d'onglets porte seule le nom « Étapes du parcours » (un
    // lecteur d'écran ne l'annonce qu'une fois).
    <div className="step-bar">
      <div className="step-bar__list" role="tablist" aria-label={t.t("ui.guided.stepbar.label")}>
        {GUIDED_STEPS.map((step, i) => {
          const selected = step === current;
          const done = checked.has(step);
          const summary = summaries[i]!;
          return (
            <button
              key={step}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={stepTabId(step)}
              className="step-bar__tab"
              aria-selected={selected}
              aria-controls={STEP_PANEL_ID}
              data-done={done ? "true" : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => goToGuidedStep(step)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              <span className="step-bar__badge" aria-hidden="true">
                {done ? <Icon icon={Check} size={15} /> : step}
              </span>
              <span className="step-bar__text">
                <span className="step-bar__title">{t.t(STEP_TITLE_KEYS[step])}</span>
                {done ? (
                  <span className="visually-hidden">{t.t("ui.guided.stepbar.done")}</span>
                ) : null}
                <span
                  className="step-bar__summary"
                  data-to-validate={summary.toValidate > 0 ? "true" : undefined}
                >
                  <SummaryText summary={summary} t={t} />
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
