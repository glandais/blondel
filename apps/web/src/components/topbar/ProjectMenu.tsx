/**
 * Menu du projet de la barre du haut (maquette 1b) : bouton « ghost » au nom du projet, qui ouvre
 * un popover non modal (`role="dialog"`, fermé par Échap ou un clic dehors, focus rendu au
 * bouton). Il regroupe ce que portait l'ancienne barre d'outils pour le projet :
 *
 * - le renommage (champ « Projet ») ;
 * - « Nouveau » (escalier droit de départ) et « Ouvrir… » (fichier `.blondel.json`), annulables ;
 * - les démos (un bouton par démo, description en infobulle) ;
 * - la liste « Préréglage » (groupes Basiques / Démo) + « Appliquer », avec la description de la
 *   démo choisie (`.toolbar__hint`) ;
 * - « Assistant… » : le menu se ferme et rend le focus à son bouton avant l'ouverture de
 *   l'assistant (qui rend le focus à l'élément actif à sa fermeture).
 */
import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useT } from "../../i18n/useT.js";
import {
  DEMO_GROUP_LABEL,
  PRESET_GROUPS,
  applyPresetChoice,
  presetDescription,
  type PresetChoice,
} from "../../lib/presetChoice.js";
import { appStore, useApp } from "../../store/appStore.js";
import { TextField } from "../fields.js";
import { Icon } from "../ui/Icon.js";
import { useMenuPlacement, useOutsideDismiss } from "../useMenuPlacement.js";

const DEMOS = PRESET_GROUPS.find((g) => g.label === DEMO_GROUP_LABEL)?.items ?? [];

export interface ProjectMenuProps {
  /** Ouvert au premier rendu (tests en rendu serveur). */
  readonly initialOpen?: boolean;
}

export function ProjectMenu({ initialOpen = false }: ProjectMenuProps) {
  const t = useT();
  const name = useApp((s) => s.project.name);
  const [open, setOpen] = useState(initialOpen);
  const [preset, setPreset] = useState<PresetChoice>("straight");
  const placement = useMenuPlacement(open, "topbar-popover");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const popoverId = useId();
  const presetId = useId();
  const presetDescId = useId();
  const description = presetDescription(preset);
  const st = appStore.getState;
  const close = useCallback(() => setOpen(false), []);
  useOutsideDismiss(open, root, close);

  // À l'ouverture, le focus entre dans le popover (premier élément actif).
  const popover = placement.ref;
  useEffect(() => {
    if (!open) return;
    popover.current?.querySelector<HTMLElement>("input, select, button:not(:disabled)")?.focus();
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
        className="btn btn-ghost topbar__project"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="topbar__project-name">
          {name.trim() === "" ? t.t("ui.topbar.project.untitled") : name}
        </span>
        <Icon icon={ChevronDown} size={16} />
      </button>
      {open ? (
        <div
          id={popoverId}
          role="dialog"
          aria-label={t.t("ui.topbar.project.menu")}
          ref={placement.ref}
          className={placement.className}
        >
          <div className="topbar-popover__name">
            <TextField
              label={t.t("ui.toolbar.project")}
              value={name}
              onCommit={(v) => st().setField(["name"], v)}
            />
          </div>

          <div className="topbar-popover__row">
            <button
              type="button"
              className="btn btn-secondary"
              title={t.t("ui.topbar.project.new.title")}
              onClick={() => {
                applyPresetChoice(st(), "straight");
                closeAndFocus();
              }}
            >
              {t.t("ui.topbar.project.new.label")}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              title={t.t("ui.topbar.project.open.title")}
              onClick={() => {
                closeAndFocus();
                fileInput.current?.click();
              }}
            >
              {t.t("ui.topbar.project.open.label")}
            </button>
          </div>

          {DEMOS.length > 0 ? (
            <section className="topbar-popover__section" aria-labelledby={`${popoverId}-demos`}>
              <h3 id={`${popoverId}-demos`} className="eyebrow">
                {t.t("ui.topbar.project.demos")}
              </h3>
              <ul className="topbar-popover__demos">
                {DEMOS.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      className="btn btn-ghost topbar-popover__demo"
                      title={d.description ? t.t(d.description) : undefined}
                      onClick={() => {
                        applyPresetChoice(st(), d.id);
                        closeAndFocus();
                      }}
                    >
                      {t.t(d.label)}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="topbar-popover__preset">
            <label htmlFor={presetId}>{t.t("ui.toolbar.preset")}</label>
            <div className="topbar-popover__row">
              <select
                id={presetId}
                value={preset}
                onChange={(e) => setPreset(e.target.value as PresetChoice)}
                aria-describedby={description ? presetDescId : undefined}
              >
                {PRESET_GROUPS.map((g) => (
                  <optgroup key={g.label} label={t.t(g.label)}>
                    {g.items.map((item) => (
                      <option
                        key={item.id}
                        value={item.id}
                        title={item.description ? t.t(item.description) : undefined}
                      >
                        {t.t(item.label)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => applyPresetChoice(st(), preset)}
              >
                {t.t("ui.toolbar.applyPreset")}
              </button>
            </div>
            {description ? (
              <span id={presetDescId} className="toolbar__hint muted">
                {t.t(description)}
              </span>
            ) : null}
          </div>

          <button
            type="button"
            className="btn btn-secondary btn-block"
            title={t.t("ui.toolbar.assistant.title")}
            onClick={() => {
              closeAndFocus();
              st().setAssistantOpen(true);
            }}
          >
            {t.t("ui.toolbar.assistant.label")}
          </button>
        </div>
      ) : null}
      <input
        ref={fileInput}
        type="file"
        accept=".json,.blondel.json,application/json"
        hidden
        aria-label={t.t("ui.topbar.project.openFile")}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          st().importText(await file.text());
        }}
      />
    </div>
  );
}
