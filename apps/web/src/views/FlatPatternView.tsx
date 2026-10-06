/**
 * Développé à plat d'une pièce (mode Fabrication, fiche de la pièce choisie) : SVG 1:1 (mis à
 * l'échelle de l'écran) rendu par `renderFlatPatternSvg` de `@blondel/exports` (une seule
 * implémentation pour l'écran et les exports). Pièces débitées en tronçons (limon de jour
 * débillardé) : tableau des tronçons et des joints soudés, repérés J1, J2… dans l'ordre de la
 * montée. La liste des pièces est celle du mode Fabrication (`components/fabrication/PartsList`).
 */
import type { Model, Part } from "@blondel/core";
import { msg, type Translator } from "@blondel/i18n";
import { flatTermKeys, renderFlatPatternSvg } from "@blondel/exports";
import { useMemo } from "react";
import { useResolvedTheme } from "../components/ThemeToggle.js";
import { segmentedPartName, segmentedParts, type SegmentedPart } from "../lib/joints.js";
import { numberFormat } from "../i18n/locale.js";
import { useT } from "../i18n/useT.js";
import { formatLength } from "../lib/units.js";
import { renderWith } from "../model/planSvg.js";
import { appStore } from "../store/appStore.js";
import { ExportedSvg } from "./ExportedSvg.js";

const select = (partId: string) =>
  appStore.getState().select({ location: { kind: "part", partId } });

const KG: Intl.NumberFormatOptions = { maximumFractionDigits: 1 };

const groupName = (group: SegmentedPart, t: Translator): string => t.t(segmentedPartName(group));

/** Tronçons d'une pièce et joints entre tronçons consécutifs. */
export function SegmentsTable({ group, selected }: { group: SegmentedPart; selected?: string }) {
  const t = useT();
  const kg = numberFormat(t.locale, KG);
  const name = groupName(group, t);
  return (
    <section className="flat-view__joints" aria-label={t.t("ui.flat.segments.label", { name })}>
      <table className="table">
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
            <th scope="col" className="num">
              {t.t("ui.flat.col.developed")}
            </th>
            <th scope="col" className="num">
              {t.t("ui.flat.col.rolled")}
            </th>
            <th scope="col" className="num">
              {t.t("ui.flat.col.mass")}
            </th>
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

/** Groupes de tronçons qui contiennent la pièce (aucun pour une pièce d'un seul tenant). */
export function segmentGroupsOf(
  model: Pick<Model, "parts">,
  partId: string,
): readonly SegmentedPart[] {
  return segmentedParts(model).filter((g) => g.segments.some((s) => s.part.id === partId));
}

/** Tronçons et joints de la pièce `part` (tableaux), s'il y a lieu. */
export function PartSegments({ model, part }: { model: Pick<Model, "parts">; part: Part }) {
  const groups = useMemo(() => segmentGroupsOf(model, part.id), [model, part.id]);
  return (
    <>
      {groups.map((g) => (
        <SegmentsTable key={g.base} group={g} selected={part.id} />
      ))}
    </>
  );
}

/**
 * Vue d'ensemble sans pièce choisie : tronçons et joints de toutes les pièces débitées en
 * plusieurs morceaux (J1, J2… d'un limon débillardé) ; rien s'il n'y en a pas.
 */
export function AllSegments({ model }: { model: Pick<Model, "parts"> }) {
  const groups = useMemo(() => segmentedParts(model), [model]);
  return (
    <>
      {groups.map((g) => (
        <SegmentsTable key={g.base} group={g} />
      ))}
    </>
  );
}

/**
 * Gabarit coté du développé de `part` : SVG exporté (`renderFlatPatternSvg`), inséré tel quel.
 * Rien sans développé ; erreur de rendu : message explicite.
 */
export function FlatPatternDrawing({ part }: { part: Part }) {
  const t = useT();
  const theme = useResolvedTheme();
  const rendered = useMemo(
    () =>
      part.flat
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
  if (!rendered) return null;
  // « Development » pour un limon bois, « flat pattern » sinon (anglais, QUESTIONS A26 (a)).
  const keys = flatTermKeys(part);
  if ("error" in rendered) {
    return (
      <p className="notice notice--error" role="alert">
        {t.t(keys.unavailable, { error: rendered.error })}
      </p>
    );
  }
  return <ExportedSvg svg={rendered.svg} label={t.t(keys.viewLabel, { mark: part.mark })} />;
}
