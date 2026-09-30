/**
 * Barre d'outils : nom du projet, assistant d'initialisation, profil d'atelier (barème hors
 * projet, `WorkshopDialog`), préréglages (deux groupes :
 * « Basiques », formes nues du cœur, et « Démo », escaliers complets et habillés, avec une ligne
 * de description ; `lib/presetChoice.ts`), annuler/rétablir,
 * menus « Importer » (projet, plan DXF, image de plan) et « Exporter », unité d'affichage et
 * thème.
 */
import { msg } from "@blondel/i18n";
import { useId, useState } from "react";
import { useT } from "../i18n/useT.js";
import { downloadFile } from "../lib/download.js";
import {
  PRESET_GROUPS,
  applyPresetChoice,
  presetDescription,
  type PresetChoice,
} from "../lib/presetChoice.js";
import { appStore, useApp } from "../store/appStore.js";
import { rejectedAutosaveFile } from "../store/persistence.js";
import { ExportMenu } from "./ExportMenu.js";
import { TextField } from "./fields.js";
import { ImportMenu } from "./ImportMenu.js";
import { LanguageToggle } from "./LanguageToggle.js";
import { ThemeToggle } from "./ThemeToggle.js";
import { WorkshopDialog } from "./WorkshopDialog.js";

export function Toolbar() {
  const t = useT();
  const name = useApp((s) => s.project.name);
  const canUndo = useApp((s) => s.history.past.length > 0);
  const canRedo = useApp((s) => s.history.future.length > 0);
  const unit = useApp((s) => s.displayUnit);
  const notice = useApp((s) => s.notice);
  const autosaveFailed = useApp((s) => s.autosaveFailed);
  const rejected = useApp((s) => s.rejectedAutosave);
  const [preset, setPreset] = useState<PresetChoice>("straight");
  const presetId = useId();
  const presetDescId = useId();
  const description = presetDescription(preset);
  const unitId = useId();
  const st = appStore.getState;

  return (
    <header className="toolbar" role="toolbar" aria-label={t.t("ui.toolbar.label")}>
      <strong className="brand">Blondel</strong>
      <div className="toolbar__name">
        <TextField
          label={t.t("ui.toolbar.project")}
          value={name}
          onCommit={(v) => st().setField(["name"], v)}
        />
      </div>

      <div className="toolbar__group">
        <button
          type="button"
          onClick={() => st().setAssistantOpen(true)}
          title={t.t("ui.toolbar.assistant.title")}
        >
          {t.t("ui.toolbar.assistant.label")}
        </button>
        <WorkshopDialog />
      </div>

      <div className="toolbar__group">
        <label htmlFor={presetId}>{t.t("ui.toolbar.preset")}</label>
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
        <button type="button" onClick={() => applyPresetChoice(st(), preset)}>
          {t.t("ui.toolbar.applyPreset")}
        </button>
      </div>
      {description ? (
        <span id={presetDescId} className="toolbar__hint muted">
          {t.t(description)}
        </span>
      ) : null}

      <div className="toolbar__group">
        <button
          type="button"
          onClick={() => st().undo()}
          disabled={!canUndo}
          title={t.t("ui.toolbar.undo.title")}
        >
          {t.t("ui.toolbar.undo.label")}
        </button>
        <button
          type="button"
          onClick={() => st().redo()}
          disabled={!canRedo}
          title={t.t("ui.toolbar.redo.title")}
        >
          {t.t("ui.toolbar.redo.label")}
        </button>
      </div>

      <div className="toolbar__group">
        <ImportMenu />
        <ExportMenu />
      </div>

      <div className="toolbar__group">
        <label htmlFor={unitId}>{t.t("ui.toolbar.display")}</label>
        <select
          id={unitId}
          value={unit}
          onChange={(e) => st().setDisplayUnit(e.target.value === "cm" ? "cm" : "mm")}
        >
          <option value="mm">mm</option>
          <option value="cm">cm</option>
        </select>
        <ThemeToggle />
        <LanguageToggle />
      </div>

      {rejected && !rejected.preserved ? (
        <span className="badge badge--warn" role="status">
          {t.t("ui.toolbar.autosave.suspended")}
        </span>
      ) : null}

      {autosaveFailed ? (
        <span className="badge badge--warn" role="status">
          {t.t("ui.toolbar.autosave.unavailable")}
        </span>
      ) : null}

      {notice ? (
        <div
          className={`notice notice--${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          <span>{t.t(notice.msg)}</span>
          {notice.details && notice.details.length > 0 ? (
            <ul>
              {notice.details.slice(0, 8).map((d, i) => (
                <li key={i}>{t.t(d)}</li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="link" onClick={() => st().clearNotice()}>
            {t.t("ui.toolbar.notice.close")}
          </button>
        </div>
      ) : null}

      {rejected ? (
        <div
          className="notice notice--error"
          role="group"
          aria-label={
            rejected.since === "earlier"
              ? t.t("ui.toolbar.rejected.earlier.label")
              : t.t("ui.toolbar.rejected.startup.label")
          }
        >
          <span>
            {rejected.since === "earlier"
              ? t.t("ui.toolbar.rejected.earlier.text")
              : t.t("ui.toolbar.rejected.startup.text")}
          </span>
          {rejected.since === "earlier" ? (
            <button
              type="button"
              className="link"
              disabled={rejected.restorable !== true}
              title={
                rejected.restorable === true
                  ? t.t("ui.toolbar.rejected.restore.title")
                  : t.t("ui.toolbar.rejected.unreadable", {
                      reason: rejected.reason ?? msg("ui.toolbar.rejected.unknownFormat"),
                    })
              }
              onClick={() => st().restoreRejectedAutosave()}
            >
              {t.t("ui.toolbar.rejected.restore.label")}
            </button>
          ) : null}
          <button
            type="button"
            className="link"
            onClick={() => {
              const f = rejectedAutosaveFile(rejected.text, t);
              downloadFile({ filename: f.filename, mime: "application/json", content: f.text });
            }}
          >
            {rejected.since === "earlier"
              ? t.t("ui.toolbar.rejected.export")
              : t.t("ui.toolbar.rejected.download")}
          </button>
          <button
            type="button"
            className="link"
            onClick={() => {
              st().dismissRejectedAutosave();
              st().clearNotice();
            }}
          >
            {rejected.since === "earlier"
              ? t.t("ui.toolbar.rejected.delete")
              : rejected.preserved
                ? t.t("ui.toolbar.rejected.forget")
                : t.t("ui.toolbar.rejected.resume")}
          </button>
        </div>
      ) : null}
    </header>
  );
}
