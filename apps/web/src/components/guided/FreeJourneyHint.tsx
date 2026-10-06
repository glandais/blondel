/**
 * Encart flottant « Vous connaissez le métier ? » du parcours guidé (maquette 1a), en haut à
 * droite du cadre de la vue : il propose de passer en parcours libre (même projet, même
 * historique, `journeyStore.setJourney`) et se ferme par sa croix. La fermeture est mémorisée
 * (`hintFreeJourneyDismissed`, préférences du parcours) : l'encart ne revient plus.
 */
import { ArrowRight, X } from "lucide-react";
import { useId } from "react";
import { useT } from "../../i18n/useT.js";
import { journeyStore, useJourney } from "../../store/appStore.js";
import { Icon } from "../ui/Icon.js";
import "./guided.css";

export function FreeJourneyHint() {
  const t = useT();
  const dismissed = useJourney((s) => s.hintFreeJourneyDismissed);
  const titleId = useId();
  if (dismissed) return null;
  return (
    <aside className="free-hint" aria-labelledby={titleId}>
      <div className="free-hint__head">
        <h2 id={titleId} className="free-hint__title">
          {t.t("ui.guided.hint.title")}
        </h2>
        <button
          type="button"
          className="btn btn-ghost btn-icon free-hint__close"
          aria-label={t.t("ui.guided.hint.close")}
          title={t.t("ui.guided.hint.close")}
          onClick={() => journeyStore.getState().dismissFreeJourneyHint()}
        >
          <Icon icon={X} size={16} />
        </button>
      </div>
      <p className="free-hint__text">{t.t("ui.guided.hint.text")}</p>
      <button
        type="button"
        className="btn btn-secondary free-hint__switch"
        onClick={() => journeyStore.getState().setJourney("free")}
      >
        {t.t("ui.guided.hint.switch")}
        <Icon icon={ArrowRight} size={15} />
      </button>
    </aside>
  );
}
