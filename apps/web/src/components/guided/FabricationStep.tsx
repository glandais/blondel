/**
 * Champs de l'étape 7 « Fabrication » du parcours guidé (spécification de contenu § 2, étape 7 ;
 * ADR-0009 point 9), dans l'ordre :
 *
 * - liste des valeurs ◆ à valider, à cocher (`ToValidateList` compacte ; son lien « Ouvrir »
 *   mène à l'étape du champ) ;
 * - « Pièces » : liste par famille (`PartsList`) ; un clic sélectionne la pièce, dont le
 *   développé s'affiche dans la vue ;
 * - sorties (`OutputsBlock`) : dossier PDF, fiche de pose, liste de débit, autres exports, coût
 *   estimé ou « Compléter le profil d'atelier » ;
 * - repli « Plus de réglages » : comparateur de structures (onglet « Comparer » de la vue) et
 *   réglages d'atelier des sections Structure et Garde-corps (affichage guidé de l'étape 7 :
 *   seuls les champs d'atelier y figurent, cibles du lien « Ouvrir » de la liste ◆).
 */
import { useId } from "react";
import { useT } from "../../i18n/useT.js";
import { SECTION_TITLE_KEYS } from "../../lib/sectionIds.js";
import { appStore, useModel } from "../../store/appStore.js";
import { OutputsBlock } from "../fabrication/OutputsBlock.js";
import { PartsList } from "../fabrication/PartsList.js";
import { ToValidateList } from "../fabrication/ToValidateList.js";
import { GuardsSection } from "../GuardsSection.js";
import { StructureSection } from "../StructureSection.js";
import "../fabrication/aside.css";
import "../fabrication/fabrication.css";

const DISPLAY = { kind: "guided", step: 7 } as const;

/** Bloc « Pièces » : liste par famille, ou état du calcul. */
function PartsBlock() {
  const t = useT();
  const titleId = useId();
  const { model, pending } = useModel();
  return (
    <section className="step-fab__parts" aria-labelledby={titleId}>
      <h3 id={titleId} className="step-form__subtitle">
        {t.t("ui.guided.fab.parts")}
      </h3>
      {model ? (
        <PartsList model={model} />
      ) : (
        <p className="muted" role="status">
          {t.t(pending ? "ui.app.computing" : "ui.app.noModel")}
        </p>
      )}
    </section>
  );
}

export function FabricationStep() {
  const t = useT();
  const uid = useId();
  return (
    <div className="step-fab">
      <ToValidateList variant="compact" />
      <PartsBlock />
      <div className="step-fab__outputs">
        <OutputsBlock />
      </div>
      <details className="tiered__fold tiered__fold--more step-fab__more">
        <summary>
          <span className="tiered__fold-title">{t.t("ui.sections.more")}</span>
        </summary>
        <div className="tiered__fold-body step-fab__more-body">
          <button
            type="button"
            className="btn btn-secondary step-fab__compare"
            onClick={() => appStore.getState().setView("compare")}
          >
            {t.t("ui.guided.fab.compare")}
          </button>
          <section className="step-fab__workshop" aria-labelledby={`${uid}-structure`}>
            <h3 id={`${uid}-structure`} className="step-form__subtitle">
              {t.t(SECTION_TITLE_KEYS.structure)}
            </h3>
            <StructureSection display={DISPLAY} />
          </section>
          <section className="step-fab__workshop" aria-labelledby={`${uid}-guards`}>
            <h3 id={`${uid}-guards`} className="step-form__subtitle">
              {t.t(SECTION_TITLE_KEYS.guards)}
            </h3>
            <GuardsSection display={DISPLAY} />
          </section>
        </div>
      </details>
    </div>
  );
}
