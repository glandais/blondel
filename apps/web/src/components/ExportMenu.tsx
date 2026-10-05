/**
 * Menu « Exporter » de la barre du haut (bouton primaire « blueprint ») : projet JSON, plan SVG / DXF, élévation SVG, liste de
 * débit CSV, dossiers PDF (complet A4 / A3, sans gabarits), fiche de pose PDF, DXF des pièces,
 * modèle 3D glTF (.glb, calculé dans le worker) et DXF de la pièce sélectionnée. Menu déroulant non modal ; téléchargement direct (Blob + lien).
 */
import { errorMessage, msg, type Message } from "@blondel/i18n";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Download } from "lucide-react";
import { useMenuPlacement } from "./useMenuPlacement.js";
import { Corners } from "./ui/Blueprint.js";
import { Icon } from "./ui/Icon.js";
import { useT } from "../i18n/useT.js";
import { downloadFile, downloadFiles } from "../lib/download.js";
import {
  DEFAULT_EXPORT_DEPS,
  EXPORT_ENTRIES,
  buildExport,
  exportAvailability,
  fileStem,
  partDxfFile,
  type ExportDeps,
  type ExportId,
} from "../lib/exportFiles.js";
import { selectedPart } from "../lib/parts.js";
import { appStore, modelService, useApp, useModel } from "../store/appStore.js";

/** Dossier PDF mis en page dans le worker de calcul (le fil principal reste disponible). */
const EXPORT_DEPS: ExportDeps = {
  ...DEFAULT_EXPORT_DEPS,
  renderPdf: (project, _model, options, locale) => modelService.exportPdf(project, options, locale),
  renderGlb: (project, _model, locale) => modelService.exportGlb(project, locale),
};

function notify(kind: "info" | "error", message: Message): void {
  appStore.setState({ notice: { kind, msg: message } });
}

export function ExportMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const placement = useMenuPlacement(open);
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
      const files = await buildExport(id, project, model, EXPORT_DEPS, t.locale);
      if (files.length === 0) notify("info", msg("ui.export.noFiles"));
      else {
        downloadFiles(files);
        if (files.length > 1) {
          notify("info", msg("ui.export.downloaded", { count: files.length }));
        }
      }
    } catch (e) {
      notify("error", msg("ui.export.failed", { error: errorMessage(e) }));
    } finally {
      setBusy(false);
    }
  };

  const exportSelectedPart = () => {
    setOpen(false);
    if (!part) return;
    try {
      downloadFile(partDxfFile(part, fileStem(project.name), t.locale));
    } catch (e) {
      notify("error", msg("ui.export.failed", { error: errorMessage(e) }));
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && open) {
      // Échap consommé ici : ni le panneau libre ni la vue ne le reçoivent.
      e.preventDefault();
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
        className="btn btn-primary blueprint topbar__btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
      >
        <Corners />
        <Icon icon={Download} size={16} />
        {busy ? t.t("ui.export.busy") : t.t("ui.topbar.export")}
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          ref={placement.ref}
          className={placement.className}
          aria-label={t.t("ui.export.label")}
        >
          {EXPORT_ENTRIES.map((entry) => {
            const a = exportAvailability(entry.id, model);
            const reason =
              computing && entry.id !== "project-json"
                ? t.t("ui.export.computing")
                : a.ok
                  ? undefined
                  : t.t(a.reason);
            return (
              <button
                key={entry.id}
                type="button"
                role="menuitem"
                disabled={reason !== undefined}
                title={reason}
                onClick={() => void run(entry.id)}
              >
                {t.t(entry.label)}
              </button>
            );
          })}
          <button
            type="button"
            role="menuitem"
            disabled={!part?.flat}
            title={part?.flat ? undefined : t.t("ui.export.selectPart")}
            onClick={exportSelectedPart}
          >
            {part?.flat
              ? t.t("ui.export.selectedPartMark", { mark: part.mark })
              : t.t("ui.export.selectedPart")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
