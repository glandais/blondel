/**
 * Panneau unique du parcours libre (ADR-0009, maquette 1b) : la section choisie dans le rail,
 * en mode d'affichage « libre » (niveau Atelier replié sous « Réglages d'atelier » par
 * `Tiered`), suivie de sa bande de chiffres clés. Un seul panneau ouvert ; épinglé, il reste
 * ouvert au clic dans la vue et suit la section choisie ; la croix le ferme, Échap aussi (chaîne
 * d'Échap globale, `components/escapeChain.ts` : non épinglé avant la sélection, épinglé après).
 *
 * Nommé par l'onglet du rail (`aria-labelledby`), il rend `null` sans section ouverte.
 */
import { Pin, PinOff, X } from "lucide-react";
import { useT } from "../../i18n/useT.js";
import type { SectionId } from "../../lib/sectionIds.js";
import { journeyStore, useApp, useJourney } from "../../store/appStore.js";
import { SECTION_COMPONENTS, SECTION_TITLE_KEYS } from "../sections/index.js";
import { Icon } from "../ui/Icon.js";
import { railTabId } from "./Rail.js";
import { SectionFigures } from "./SectionFigures.js";
import "./free.css";

const FREE_DISPLAY = { kind: "free" } as const;

/**
 * Rend le focus à l'entrée du rail d'une section (après la fermeture du panneau par la croix,
 * ou par Échap : `useEscapeChain`, App.tsx).
 */
export function focusRailTab(section: SectionId): void {
  if (typeof document === "undefined") return;
  document.getElementById(railTabId(section))?.focus();
}

export function FreePanel() {
  const t = useT();
  const section = useJourney((s) => s.freePanel);
  const pinned = useJourney((s) => s.freePanelPinned);
  const fromGuided = useJourney((s) => s.freePanelFromGuided);
  const layout = useApp((s) => s.project.stair.layout);

  if (section === null) return null;
  const Content = SECTION_COMPONENTS[section];
  const notApplicable = section === "balancing" && layout.turns.length === 0;
  const pinLabel = t.t("ui.freePanel.pin");
  const closeLabel = t.t("ui.freePanel.close");

  return (
    <aside
      id="free-panel"
      className="free-panel"
      role="tabpanel"
      aria-labelledby={railTabId(section)}
    >
      <div className="free-panel__head">
        <h3 className="free-panel__title">{t.t(SECTION_TITLE_KEYS[section])}</h3>
        <button
          type="button"
          className="btn btn-ghost btn-icon free-panel__tool"
          aria-pressed={pinned}
          aria-label={pinLabel}
          title={pinLabel}
          onClick={() => journeyStore.getState().panelEvent({ type: "pin", pinned: !pinned })}
        >
          <Icon icon={pinned ? PinOff : Pin} size={16} />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon free-panel__tool"
          aria-label={closeLabel}
          title={closeLabel}
          onClick={() => {
            journeyStore.getState().panelEvent({ type: "close" });
            focusRailTab(section);
          }}
        >
          <Icon icon={X} size={16} />
        </button>
      </div>
      <div className="free-panel__body">
        {notApplicable ? (
          <p className="muted">
            {t.t(
              layout.kind === "helical"
                ? "ui.params.balancing.notApplicableHelical"
                : "ui.params.balancing.notApplicable",
            )}
          </p>
        ) : (
          <Content display={FREE_DISPLAY} />
        )}
      </div>
      {notApplicable ? null : <SectionFigures section={section} />}
      {fromGuided ? <p className="free-panel__note">{t.t("ui.freePanel.fromGuided")}</p> : null}
    </aside>
  );
}
