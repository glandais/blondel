/**
 * Mise en page du parcours guidé (maquette 1a, ADR-0009), sous la barre du haut (montée par
 * `App`, commune aux deux parcours), dans la grille `.app.app--guided`
 * (52 / 68 / 1fr / 60 px) : barre du haut en variante guidée, barre d'étapes, corps (formulaire
 * de l'étape à gauche, 400 px ; vue à droite) et pied (contrôle, mention, étapes précédente /
 * suivante). L'assistant et l'invite de mise à jour sont montés par `App`.
 *
 * Le formulaire est le panneau d'onglet de l'étape courante (`role="tabpanel"`, nommé par son
 * onglet de la barre d'étapes) ; son contenu est `StepForm`, bâti sur les composants de section.
 * L'étape affichée est marquée comme vue (coche ✓ de la barre d'étapes) : une ouverture de
 * projet remet les étapes vues à zéro, l'étape courante l'est donc à nouveau ici.
 *
 * Petits écrans (ADR-0009 point 3) : de 760 à 1 099 px, formulaire resserré (340 px) ; sous
 * 760 px, la vue passe au-dessus du formulaire et le document défile verticalement.
 */
import { useEffect } from "react";
import { journeyStore, useJourney } from "../../store/appStore.js";
import { useViewportClass } from "../useViewport.js";
import { GuidedFooter } from "./GuidedFooter.js";
import { GuidedView } from "./GuidedView.js";
import { STEP_PANEL_ID, StepBar, stepTabId } from "./StepBar.js";
import { StepForm } from "./StepForm.js";
import "./guided.css";

/** Marque l'étape courante comme vue tant qu'elle ne l'est pas (après une ouverture de projet). */
function useMarkCurrentStepVisited(): void {
  const step = useJourney((s) => s.guidedStep);
  const seen = useJourney((s) => s.visitedSteps.has(s.guidedStep));
  useEffect(() => {
    if (!seen) journeyStore.getState().markStepVisited(step);
  }, [step, seen]);
}

export function GuidedLayout() {
  useMarkCurrentStepVisited();
  const step = useJourney((s) => s.guidedStep);
  // Fenêtre étroite : la vue passe au-dessus du formulaire, dans le DOM aussi (ordre de lecture
  // et de tabulation conforme à l'ordre affiché).
  const viewFirst = useViewportClass() === "narrow";
  const form = (
    <section
      id={STEP_PANEL_ID}
      className="guided-form"
      role="tabpanel"
      aria-labelledby={stepTabId(step)}
    >
      <StepForm step={step} />
    </section>
  );
  return (
    <>
      <StepBar />
      <div className="guided-body">
        {viewFirst ? null : form}
        <GuidedView />
        {viewFirst ? form : null}
      </div>
      <GuidedFooter />
    </>
  );
}
