/**
 * Menu ⋯ « Plus d'options » de la barre du haut (maquette 1b) : popover non modal
 * (`role="dialog"`, fermé par Échap ou un clic dehors, focus rendu au bouton) avec les réglages
 * d'affichage de l'ancienne barre d'outils : unité (« Affichage »), thème, langue, et le bouton
 * « Atelier… » qui ouvre la fenêtre du profil d'atelier (`openWorkshopDialog`). Le focus est
 * rendu au bouton ⋯ avant l'ouverture de la fenêtre, qui le lui rendra à sa fermeture.
 */
import { Ellipsis } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useT } from "../../i18n/useT.js";
import { appStore, useApp } from "../../store/appStore.js";
import { openWorkshopDialog } from "../../store/uiStore.js";
import { LanguageToggle } from "../LanguageToggle.js";
import { ThemeToggle } from "../ThemeToggle.js";
import { Icon } from "../ui/Icon.js";
import { useMenuPlacement, useOutsideDismiss } from "../useMenuPlacement.js";

export interface MoreMenuProps {
  /** Ouvert au premier rendu (tests en rendu serveur). */
  readonly initialOpen?: boolean;
}

export function MoreMenu({ initialOpen = false }: MoreMenuProps) {
  const t = useT();
  const unit = useApp((s) => s.displayUnit);
  const [open, setOpen] = useState(initialOpen);
  const placement = useMenuPlacement(open, "topbar-popover");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const unitId = useId();
  const close = useCallback(() => setOpen(false), []);
  useOutsideDismiss(open, root, close);

  const popover = placement.ref;
  useEffect(() => {
    if (!open) return;
    popover.current?.querySelector<HTMLElement>("select, button:not(:disabled)")?.focus();
  }, [open, popover]);

  const closeAndFocus = (): void => {
    setOpen(false);
    trigger.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== "Escape" || !open) return;
    // Échap consommé ici : ni le panneau libre ni la vue ne le reçoivent.
    e.preventDefault();
    e.stopPropagation();
    closeAndFocus();
  };

  return (
    <div className="topbar__menu" ref={root} onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        className="btn btn-secondary btn-icon"
        aria-label={t.t("ui.topbar.more.label")}
        title={t.t("ui.topbar.more.label")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon icon={Ellipsis} size={18} />
      </button>
      {open ? (
        <div
          id={popoverId}
          role="dialog"
          aria-label={t.t("ui.topbar.more.label")}
          ref={placement.ref}
          className={`${placement.className} topbar-popover--settings`}
        >
          <div className="topbar-popover__grid">
            <label htmlFor={unitId}>{t.t("ui.toolbar.display")}</label>
            <select
              id={unitId}
              value={unit}
              onChange={(e) =>
                appStore.getState().setDisplayUnit(e.target.value === "cm" ? "cm" : "mm")
              }
            >
              <option value="mm">mm</option>
              <option value="cm">cm</option>
            </select>
            <ThemeToggle />
            <LanguageToggle />
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-block"
            title={t.t("ui.workshop.open.title")}
            onClick={() => {
              closeAndFocus();
              openWorkshopDialog();
            }}
          >
            {t.t("ui.workshop.open.label")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
