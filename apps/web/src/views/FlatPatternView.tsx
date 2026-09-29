/**
 * Onglet « Développés » : liste des pièces à développé à plat et SVG 1:1 (mis à l'échelle de
 * l'écran) de la pièce sélectionnée, rendu par `renderFlatPatternSvg` de `@blondel/exports`
 * (une seule implémentation pour l'écran et les exports). La sélection est partagée avec la
 * vue 3D et la nomenclature. Pièces débitées en tronçons (limon de jour débillardé) : tableau des
 * tronçons et des joints soudés, repérés J1, J2… dans l'ordre de la montée.
 */
import type { Model } from "@blondel/core";
import { renderFlatPatternSvg } from "@blondel/exports";
import { useMemo } from "react";
import { useResolvedTheme } from "../components/ThemeToggle.js";
import { downloadFile } from "../lib/download.js";
import { fileStem, partDxfFile, partsWithFlat } from "../lib/exportFiles.js";
import { segmentedParts, type SegmentedPart } from "../lib/joints.js";
import { selectedPart } from "../lib/parts.js";
import { formatLength } from "../lib/units.js";
import { renderWith } from "../model/planSvg.js";
import { appStore, useApp } from "../store/appStore.js";
import { ExportedSvg } from "./ExportedSvg.js";

const select = (partId: string) =>
  appStore.getState().select({ location: { kind: "part", partId } });

const kg = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

/** Tronçons d'une pièce et joints entre tronçons consécutifs. */
function SegmentsTable({ group, selected }: { group: SegmentedPart; selected?: string }) {
  const name = group.segments[0]?.part.name.replace(/,\s*tronçon.*$/, "") ?? group.base;
  return (
    <section className="flat-view__joints" aria-label={`Tronçons et joints — ${name}`}>
      <table>
        <caption>
          <strong>{name}</strong> : {group.segments.length} tronçons, {group.joints.length} joint(s)
        </caption>
        <thead>
          <tr>
            <th scope="col">Tronçon</th>
            <th scope="col">Développé</th>
            <th scope="col">Roulé</th>
            <th scope="col">Masse</th>
          </tr>
        </thead>
        <tbody>
          {group.segments.map((s) => (
            <tr key={s.part.id} className={s.part.id === selected ? "is-selected" : undefined}>
              <th scope="row">
                <button
                  type="button"
                  className="link"
                  aria-pressed={s.part.id === selected}
                  onClick={() => select(s.part.id)}
                >
                  {s.part.mark}
                </button>
              </th>
              <td className="num">{formatLength(s.developed, "mm")}</td>
              <td className="num">{s.rolled > 0 ? formatLength(s.rolled, "mm") : "–"}</td>
              <td className="num">{s.massKg === undefined ? "–" : `${kg.format(s.massKg)} kg`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul>
        {group.joints.map((j) => (
          <li key={j.mark} data-joint={j.mark}>
            <strong>{j.mark}</strong> : {j.from.mark} ↔ {j.to.mark} —{" "}
            {j.weldMm === null ? "assemblage" : `cordon ${formatLength(j.weldMm, "mm")}`} ({j.label}
            )
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FlatPatternView({ model }: { model: Model }) {
  const selection = useApp((s) => s.selection);
  const projectName = useApp((s) => s.project.name);
  const theme = useResolvedTheme();
  const flats = partsWithFlat(model);
  const current = selectedPart(model, selection?.location);
  const part = current?.flat ? current : undefined;
  const groups = useMemo(() => segmentedParts(model), [model]);
  const shownGroups = part
    ? groups.filter((g) => g.segments.some((s) => s.part.id === part.id))
    : groups;
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
                onClick={() => select(p.id)}
              >
                <strong>{p.mark}</strong> <span className="muted">{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flat-view__drawing">
        {shownGroups.map((g) => (
          <SegmentsTable key={g.base} group={g} {...(part ? { selected: part.id } : {})} />
        ))}
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
