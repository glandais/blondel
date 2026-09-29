/**
 * Menu « Importer » de la barre d'outils : projet Blondel (.blondel.json, remplace le projet,
 * annulable), plan DXF ou image de plan (calque de fond du plan « Site et saisie », jalon 7 :
 * l'onglet Plan 2D s'ouvre dans ce mode, où l'échelle, le placement, la calibration et les
 * outils de tracé de la trémie et des murs sont disponibles).
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { appStore } from "../store/appStore.js";
import { requestUnderlayImport, type UnderlayImportKind } from "../store/importQueue.js";

export function ImportMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const dxfInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const st = appStore.getState;

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

  const pick = (input: HTMLInputElement | null): void => {
    setOpen(false);
    input?.click();
  };

  const underlay = (kind: UnderlayImportKind, file: File | undefined): void => {
    if (!file) return;
    st().setView("plan");
    st().setPlanMode("site");
    requestUnderlayImport(kind, file);
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
    const items = [...(root.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
    const i = items.findIndex((b) => b === document.activeElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <div className="menu" ref={root} onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
      >
        Importer ▾
      </button>
      {open ? (
        <div id={menuId} role="menu" className="menu__list" aria-label="Importer">
          <button type="button" role="menuitem" onClick={() => pick(projectInput.current)}>
            Projet (.blondel.json)…
          </button>
          <button type="button" role="menuitem" onClick={() => pick(dxfInput.current)}>
            Plan DXF (calque de fond)…
          </button>
          <button type="button" role="menuitem" onClick={() => pick(imageInput.current)}>
            Image de plan à calibrer (PNG, JPEG)…
          </button>
        </div>
      ) : null}
      <input
        ref={projectInput}
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
      <input
        ref={dxfInput}
        type="file"
        accept=".dxf,application/dxf,image/vnd.dxf"
        hidden
        aria-label="Plan DXF à importer"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          underlay("dxf", file);
        }}
      />
      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg"
        hidden
        aria-label="Image de plan à importer"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          underlay("image", file);
        }}
      />
    </div>
  );
}
