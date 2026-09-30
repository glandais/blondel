/**
 * Onglet « Développés » : liste des pièces à développé à plat et SVG 1:1 (mis à l'échelle de
 * l'écran) de la pièce sélectionnée, rendu par `renderFlatPatternSvg` de `@blondel/exports`
 * (une seule implémentation pour l'écran et les exports). La sélection est partagée avec la
 * vue 3D et la nomenclature. Pièces débitées en tronçons (limon de jour débillardé) : tableau des
 * tronçons et des joints soudés, repérés J1, J2… dans l'ordre de la montée.
 */
import type { Model } from "@blondel/core";
import { msg, type Translator } from "@blondel/i18n";
import { renderFlatPatternSvg } from "@blondel/exports";
import { useMemo } from "react";
import { useResolvedTheme } from "../components/ThemeToggle.js";
import { downloadFile } from "../lib/download.js";
import { fileStem, partDxfFile, partsWithFlat } from "../lib/exportFiles.js";
import { segmentedParts, type SegmentedPart } from "../lib/joints.js";
import { selectedPart } from "../lib/parts.js";
import { numberFormat } from "../i18n/locale.js";
import { useT } from "../i18n/useT.js";
import { formatLength } from "../lib/units.js";
import { renderWith } from "../model/planSvg.js";
import { appStore, useApp } from "../store/appStore.js";
import { ExportedSvg } from "./ExportedSvg.js";

const select = (partId: string) =>
  appStore.getState().select({ location: { kind: "part", partId } });

const KG: Intl.NumberFormatOptions = { maximumFractionDigits: 1 };

/**
 * Nom commun des tronçons d'une pièce : nom de la pièce entière pour le limon débillardé, sinon
 * nom du premier tronçon sans son suffixe « , tronçon i/n » (« , segment i/n » en anglais).
 */
function groupName(group: SegmentedPart, t: Translator): string {
  const first = group.segments[0]?.part.name;
  if (first === undefined) return group.base;
  if (first.key === "structure.steelCurved.part.segment") {
    return t.t("structure.steelCurved.part.outerString");
  }
  return t.t(first).replace(/,\s*(tronçon|segment)\b.*$/, "");
}

/** Tronçons d'une pièce et joints entre tronçons consécutifs. */
function SegmentsTable({ group, selected }: { group: SegmentedPart; selected?: string }) {
  const t = useT();
  const kg = numberFormat(t.locale, KG);
  const name = groupName(group, t);
  return (
    <section className="flat-view__joints" aria-label={t.t("ui.flat.segments.label", { name })}>
      <table>
        <caption>
          <strong>{name}</strong>
          {t.t("ui.flat.segments.caption", {
            segments: msg("ui.flat.segments.count", { count: group.segments.length }),
            joints: msg("ui.flat.joints.count", { count: group.joints.length }),
          })}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t.t("ui.flat.col.segment")}</th>
            <th scope="col">{t.t("ui.flat.col.developed")}</th>
            <th scope="col">{t.t("ui.flat.col.rolled")}</th>
            <th scope="col">{t.t("ui.flat.col.mass")}</th>
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
              <td className="num">{formatLength(s.developed, "mm", t.locale)}</td>
              <td className="num">{s.rolled > 0 ? formatLength(s.rolled, "mm", t.locale) : "–"}</td>
              <td className="num">
                {s.massKg === undefined
                  ? "–"
                  : t.t("ui.flat.massKg", { mass: kg.format(s.massKg) })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul>
        {group.joints.map((j) => (
          <li key={j.mark} data-joint={j.mark}>
            <strong>{j.mark}</strong>
            {t.t("ui.flat.joint", {
              from: j.from.mark,
              to: j.to.mark,
              weld:
                j.weldMm === null
                  ? msg("ui.flat.joint.assembly")
                  : msg("ui.flat.joint.weld", { length: formatLength(j.weldMm, "mm", t.locale) }),
              label: j.label,
            })}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FlatPatternView({ model }: { model: Model }) {
  const t = useT();
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
              title: t.t("ui.flat.drawing.title", { mark: part.mark, name: part.name }),
              locale: t.locale,
            }),
          )
        : undefined,
    [part, theme, t],
  );

  if (flats.length === 0) {
    return (
      <div className="empty-view" role="status">
        <p>{t.t("ui.flat.empty")}</p>
        <p className="muted">{t.t("ui.flat.empty.hint")}</p>
      </div>
    );
  }
  return (
    <div className="flat-view">
      <nav className="flat-view__list" aria-label={t.t("ui.flat.list.label")}>
        <ul>
          {flats.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                aria-pressed={p.id === part?.id}
                className={p.id === part?.id ? "is-selected" : undefined}
                onClick={() => select(p.id)}
              >
                <strong>{p.mark}</strong> <span className="muted">{t.t(p.name)}</span>
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
          <p className="muted">{t.t("ui.flat.choose")}</p>
        ) : (
          <>
            <div className="flat-view__head">
              <span>
                <strong>{part.mark}</strong>
                {t.t("ui.flat.head", {
                  name: part.name,
                  thickness: formatLength(part.flat?.thickness, "mm", t.locale),
                })}
              </span>
              <button
                type="button"
                onClick={() => downloadFile(partDxfFile(part, fileStem(projectName), t.locale))}
              >
                {t.t("ui.flat.dxf")}
              </button>
            </div>
            {!rendered ? null : "error" in rendered ? (
              <p className="notice notice--error" role="alert">
                {t.t("ui.flat.unavailable", { error: rendered.error })}
              </p>
            ) : (
              <ExportedSvg
                svg={rendered.svg}
                label={t.t("ui.flat.drawing.label", { mark: part.mark })}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
