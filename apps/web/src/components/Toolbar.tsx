/**
 * Barre d'outils : nom du projet, assistant d'initialisation, préréglages (deux groupes :
 * « Basiques », formes nues du cœur, et « Démo », escaliers complets et habillés, avec une ligne
 * de description ; `lib/presetChoice.ts`), annuler/rétablir,
 * menus « Importer » (projet, plan DXF, image de plan) et « Exporter », unité d'affichage et
 * thème.
 */
import { useId, useState } from "react";
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
import { ThemeToggle } from "./ThemeToggle.js";

export function Toolbar() {
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
    <header className="toolbar" role="toolbar" aria-label="Barre d'outils">
      <strong className="brand">Blondel</strong>
      <div className="toolbar__name">
        <TextField label="Projet" value={name} onCommit={(v) => st().setField(["name"], v)} />
      </div>

      <div className="toolbar__group">
        <button
          type="button"
          onClick={() => st().setAssistantOpen(true)}
          title="Proposer des escaliers à partir du site (H, trémie, murs)"
        >
          Assistant…
        </button>
      </div>

      <div className="toolbar__group">
        <label htmlFor={presetId}>Préréglage</label>
        <select
          id={presetId}
          value={preset}
          onChange={(e) => setPreset(e.target.value as PresetChoice)}
          aria-describedby={description ? presetDescId : undefined}
        >
          {PRESET_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.items.map((item) => (
                <option key={item.id} value={item.id} title={item.description}>
                  {item.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button type="button" onClick={() => applyPresetChoice(st(), preset)}>
          Appliquer
        </button>
      </div>
      {description ? (
        <span id={presetDescId} className="toolbar__hint muted">
          {description}
        </span>
      ) : null}

      <div className="toolbar__group">
        <button
          type="button"
          onClick={() => st().undo()}
          disabled={!canUndo}
          title="Annuler (Ctrl+Z)"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={() => st().redo()}
          disabled={!canRedo}
          title="Rétablir (Ctrl+Maj+Z)"
        >
          Rétablir
        </button>
      </div>

      <div className="toolbar__group">
        <ImportMenu />
        <ExportMenu />
      </div>

      <div className="toolbar__group">
        <label htmlFor={unitId}>Affichage</label>
        <select
          id={unitId}
          value={unit}
          onChange={(e) => st().setDisplayUnit(e.target.value === "cm" ? "cm" : "mm")}
        >
          <option value="mm">mm</option>
          <option value="cm">cm</option>
        </select>
        <ThemeToggle />
      </div>

      {rejected && !rejected.preserved ? (
        <span className="badge badge--warn" role="status">
          Autosauvegarde suspendue
        </span>
      ) : null}

      {autosaveFailed ? (
        <span className="badge badge--warn" role="status">
          Autosauvegarde indisponible
        </span>
      ) : null}

      {notice ? (
        <div
          className={`notice notice--${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          <span>{notice.text}</span>
          {notice.details && notice.details.length > 0 ? (
            <ul>
              {notice.details.slice(0, 8).map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="link" onClick={() => st().clearNotice()}>
            Fermer
          </button>
        </div>
      ) : null}

      {rejected ? (
        <div
          className="notice notice--error"
          role="group"
          aria-label={
            rejected.since === "earlier"
              ? "Copie de secours d'autosauvegarde"
              : "Autosauvegarde refusée"
          }
        >
          <span>
            {rejected.since === "earlier"
              ? "Une copie de secours d'autosauvegarde refusée est conservée dans ce navigateur :"
              : "Autosauvegarde refusée au démarrage :"}
          </span>
          {rejected.since === "earlier" ? (
            <button
              type="button"
              className="link"
              disabled={rejected.restorable !== true}
              title={
                rejected.restorable === true
                  ? "Remplacer le projet courant par la copie (annulable)"
                  : `Copie illisible par cette version : ${rejected.reason ?? "format non reconnu"}`
              }
              onClick={() => st().restoreRejectedAutosave()}
            >
              Restaurer
            </button>
          ) : null}
          <button
            type="button"
            className="link"
            onClick={() => {
              const f = rejectedAutosaveFile(rejected.text);
              downloadFile({ filename: f.filename, mime: "application/json", content: f.text });
            }}
          >
            {rejected.since === "earlier" ? "Exporter" : "Télécharger le texte brut"}
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
              ? "Supprimer"
              : rejected.preserved
                ? "Oublier cette sauvegarde"
                : "Reprendre l'autosauvegarde"}
          </button>
        </div>
      ) : null}
    </header>
  );
}
