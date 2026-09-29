/**
 * Onglet « Développés » : liste des pièces à développé à plat et SVG 1:1 (mis à l'échelle de
 * l'écran) de la pièce sélectionnée, rendu par `renderFlatPatternSvg` de `@blondel/exports`
 * (une seule implémentation pour l'écran et les exports). La sélection est partagée avec la
 * vue 3D et la nomenclature.
 */
import type { Model } from "@blondel/core";
import { renderFlatPatternSvg } from "@blondel/exports";
import { useMemo } from "react";
import { useResolvedTheme } from "../components/ThemeToggle.js";
import { downloadFile } from "../lib/download.js";
import { fileStem, partDxfFile, partsWithFlat } from "../lib/exportFiles.js";
import { selectedPart } from "../lib/parts.js";
import { formatLength } from "../lib/units.js";
import { renderWith } from "../model/planSvg.js";
import { appStore, useApp } from "../store/appStore.js";
import { ExportedSvg } from "./ExportedSvg.js";

export function FlatPatternView({ model }: { model: Model }) {
  const selection = useApp((s) => s.selection);
  const projectName = useApp((s) => s.project.name);
  const theme = useResolvedTheme();
  const flats = partsWithFlat(model);
  const current = selectedPart(model, selection?.location);
  const part = current?.flat ? current : undefined;
  const rendered = useMemo(
    () =>
      part
        ? renderWith(() =>
            renderFlatPatternSvg(part, {
              theme,
              background: false,
              title: `${part.mark} — ${part.name}`,
            }),
          )
        : undefined,
    [part, theme],
  );

  if (flats.length === 0) {
    return (
      <div className="empty-view" role="status">
        <p>Aucune pièce n'a de développé à plat.</p>
        <p className="muted">
          Les développés (limons, tôles pliées…) sont produits par les plugins de structure :
          choisir une structure dans le panneau de paramètres.
        </p>
      </div>
    );
  }
  return (
    <div className="flat-view">
      <nav className="flat-view__list" aria-label="Pièces à développé">
        <ul>
          {flats.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                aria-pressed={p.id === part?.id}
                className={p.id === part?.id ? "is-selected" : undefined}
                onClick={() =>
                  appStore.getState().select({ location: { kind: "part", partId: p.id } })
                }
              >
                <strong>{p.mark}</strong> <span className="muted">{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flat-view__drawing">
        {!part ? (
          <p className="muted">Choisir une pièce dans la liste (ou la cliquer dans la vue 3D).</p>
        ) : (
          <>
            <div className="flat-view__head">
              <span>
                <strong>{part.mark}</strong> — {part.name} · ép.{" "}
                {formatLength(part.flat?.thickness, "mm")}
              </span>
              <button
                type="button"
                onClick={() => downloadFile(partDxfFile(part, fileStem(projectName)))}
              >
                DXF de la pièce (R12)
              </button>
            </div>
            {!rendered ? null : "error" in rendered ? (
              <p className="notice notice--error" role="alert">
                Développé indisponible : {rendered.error}
              </p>
            ) : (
              <ExportedSvg svg={rendered.svg} label={`Développé de la pièce ${part.mark}`} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
