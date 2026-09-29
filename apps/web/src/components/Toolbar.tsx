/**
 * Barre d'outils : nom du projet, préréglages, annuler/rétablir, import, menu « Exporter », unité
 * d'affichage et thème.
 */
import { ALL_PRESET_IDS, PRESET_LABELS, type PresetId } from "@blondel/core";
import { useId, useRef, useState } from "react";
import { appStore, useApp } from "../store/appStore.js";
import { ExportMenu } from "./ExportMenu.js";
import { TextField } from "./fields.js";
import { ThemeToggle } from "./ThemeToggle.js";

export function Toolbar() {
  const name = useApp((s) => s.project.name);
  const canUndo = useApp((s) => s.history.past.length > 0);
  const canRedo = useApp((s) => s.history.future.length > 0);
  const unit = useApp((s) => s.displayUnit);
  const notice = useApp((s) => s.notice);
  const autosaveFailed = useApp((s) => s.autosaveFailed);
  const [preset, setPreset] = useState<PresetId>("straight");
  const fileInput = useRef<HTMLInputElement>(null);
  const presetId = useId();
  const unitId = useId();
  const st = appStore.getState;

  return (
    <header className="toolbar" role="toolbar" aria-label="Barre d'outils">
      <strong className="brand">Blondel</strong>
      <div className="toolbar__name">
        <TextField label="Projet" value={name} onCommit={(v) => st().setField(["name"], v)} />
      </div>

      <div className="toolbar__group">
        <label htmlFor={presetId}>Préréglage</label>
        <select
          id={presetId}
          value={preset}
          onChange={(e) => setPreset(e.target.value as PresetId)}
        >
          {ALL_PRESET_IDS.map((id) => (
            <option key={id} value={id}>
              {PRESET_LABELS[id]}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => st().loadPreset(preset)}>
          Appliquer
        </button>
      </div>

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
        <button type="button" onClick={() => fileInput.current?.click()}>
          Importer…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,.blondel.json,application/json"
          hidden
          aria-label="Fichier de projet à importer"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            st().importText(await file.text());
          }}
        />
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
    </header>
  );
}
