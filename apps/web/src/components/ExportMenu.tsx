/**
 * Menu « Exporter » de la barre d'outils : projet JSON, plan SVG / DXF, élévation SVG, liste de
 * débit CSV, PDF (si `@blondel/exports` le fournit), DXF des pièces et DXF de la pièce
 * sélectionnée. Menu déroulant non modal ; téléchargement direct (Blob + lien).
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { downloadFile, downloadFiles } from "../lib/download.js";
import {
  EXPORT_ENTRIES,
  buildExport,
  exportAvailability,
  fileStem,
  partDxfFile,
  type ExportId,
} from "../lib/exportFiles.js";
import { selectedPart } from "../lib/parts.js";
import { appStore, useApp, useModel } from "../store/appStore.js";

function notify(kind: "info" | "error", text: string): void {
  appStore.setState({ notice: { kind, text } });
}

export function ExportMenu() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const project = useApp((s) => s.project);
  const selection = useApp((s) => s.selection);
  const view = useModel();
  // Modèle d'un projet antérieur pendant un calcul : les exports du modèle attendent le résultat.
  const model = view.project === project ? view.model : null;
  const computing = view.project !== project;
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const part = model ? selectedPart(model, selection?.location) : undefined;

  // Fermeture au clic en dehors du menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && e.target instanceof Node && !root.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const run = async (id: ExportId) => {
    setOpen(false);
    setBusy(true);
    try {
      const files = await buildExport(id, project, model);
      if (files.length === 0) notify("info", "Aucun fichier à exporter.");
      else {
        downloadFiles(files);
        if (files.length > 1) notify("info", `${files.length} fichiers téléchargés.`);
      }
    } catch (e) {
      notify("error", `Export impossible : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const exportSelectedPart = () => {
    setOpen(false);
    if (!part) return;
    try {
      downloadFile(partDxfFile(part, fileStem(project.name)));
    } catch (e) {
      notify("error", `Export impossible : ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>("button")?.focus();
      return;
    }
    if (!open || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    const items = [
      ...(root.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ??
        []),
    ];
    const i = items.findIndex((b) => b === document.activeElement);
    const next = items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
    next?.focus();
  };

  return (
    <div className="menu" ref={root} onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
      >
        {busy ? "Export…" : "Exporter ▾"}
      </button>
      {open ? (
        <div id={menuId} role="menu" className="menu__list" aria-label="Exporter">
          {EXPORT_ENTRIES.map((entry) => {
            const a =
              computing && entry.id !== "project-json"
                ? ({ ok: false, reason: "Calcul du modèle en cours…" } as const)
                : exportAvailability(entry.id, model);
            return (
              <button
                key={entry.id}
                type="button"
                role="menuitem"
                disabled={!a.ok}
                title={a.ok ? undefined : a.reason}
                onClick={() => void run(entry.id)}
              >
                {entry.label}
              </button>
            );
          })}
          <button
            type="button"
            role="menuitem"
            disabled={!part?.flat}
            title={
              part?.flat
                ? undefined
                : "Sélectionner une pièce à développé (vue 3D, Développés ou Nomenclature)."
            }
            onClick={exportSelectedPart}
          >
            DXF de la pièce sélectionnée{part?.flat ? ` (${part.mark})` : ""}
          </button>
        </div>
      ) : null}
    </div>
  );
}
