/**
 * Onglet « Nomenclature » du mode Fabrication : pièces groupées par repère (mêmes lignes que la
 * liste de débit CSV), dimensions de débit, quantités, masses (`mass_kg` du cœur ; renvoi « * »
 * pour une masse calculée avec une masse volumique à valider, QUESTIONS A6) et totaux, en tableau
 * Industry (`.table`). Un clic sur un repère sélectionne la pièce (surlignée en 3D, ouverte dans
 * l'onglet « Pièces »).
 */
import type { Model } from "@blondel/core";
import { massNoteFor } from "@blondel/exports";
import { useMemo } from "react";
import { numberFormat } from "../i18n/locale.js";
import { msg } from "@blondel/i18n";
import { useT } from "../i18n/useT.js";
import { bomSummary, selectedPart } from "../lib/parts.js";
import { appStore, useApp, useModel } from "../store/appStore.js";

const dec = (digits: number): Intl.NumberFormatOptions => ({
  minimumFractionDigits: 0,
  maximumFractionDigits: digits,
});

const fmt = (f: Intl.NumberFormat, v: number | undefined): string =>
  v === undefined || !Number.isFinite(v) ? "–" : f.format(v);

export function BomView({ model }: { model: Model }) {
  const selection = useApp((s) => s.selection);
  // Profil d'atelier du projet dont le modèle est issu : une masse volumique renseignée par
  // l'atelier n'est plus « à valider ».
  const { project } = useModel();
  const workshop = project?.workshop;
  const t = useT();
  const locale = t.locale;
  const mm = numberFormat(locale, dec(1));
  const m3 = numberFormat(locale, dec(4));
  const kg = numberFormat(locale, dec(1));
  const bom = useMemo(
    () => bomSummary(model.parts, locale, massNoteFor(workshop)),
    [model.parts, locale, workshop],
  );
  const noteMark = (note: string | undefined): string =>
    note === undefined ? "" : ` ${"*".repeat(bom.massNotes.indexOf(note) + 1)}`;
  const current = selectedPart(model, selection?.location);
  if (bom.lines.length === 0) {
    return (
      <div className="empty-view" role="status">
        <p>{t.t("ui.bom.empty")}</p>
      </div>
    );
  }
  return (
    <div className="bom">
      <table className="table">
        <caption>
          {t.t("ui.bom.caption", {
            parts: msg("ui.bom.parts", { count: bom.count }),
            marks: msg("ui.bom.marks", { count: bom.lines.length }),
            flat: bom.withFlat > 0 ? msg("ui.bom.withFlat", { count: bom.withFlat }) : "",
          })}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t.t("pdf.bom.col.mark")}</th>
            <th scope="col">{t.t("pdf.bom.col.designation")}</th>
            <th scope="col">{t.t("pdf.bom.col.material")}</th>
            <th scope="col">{t.t("pdf.bom.col.section")}</th>
            <th scope="col" className="num">
              {t.t("ui.bom.col.length")}
            </th>
            <th scope="col" className="num">
              {t.t("ui.bom.col.width")}
            </th>
            <th scope="col" className="num">
              {t.t("ui.bom.col.thickness")}
            </th>
            <th scope="col" className="num">
              {t.t("pdf.bom.col.quantity")}
            </th>
            <th scope="col" className="num">
              {t.t("ui.bom.col.volume")}
            </th>
            <th scope="col" className="num">
              {t.t("pdf.bom.col.mass")}
            </th>
          </tr>
        </thead>
        <tbody>
          {bom.lines.map((l, i) => {
            const selected = current !== undefined && l.partIds.includes(current.id);
            const first = l.partIds[0];
            return (
              <tr
                key={`${l.mark}-${i}`}
                className={selected ? "is-selected" : undefined}
                aria-selected={selected}
              >
                <th scope="row">
                  <button
                    type="button"
                    className="link"
                    disabled={first === undefined}
                    onClick={() =>
                      first !== undefined &&
                      appStore.getState().select({ location: { kind: "part", partId: first } })
                    }
                  >
                    {l.mark}
                  </button>
                </th>
                <td>{l.name}</td>
                <td>{l.material}</td>
                <td>{l.section || "–"}</td>
                <td className="num">{fmt(mm, l.length)}</td>
                <td className="num">{fmt(mm, l.width)}</td>
                <td className="num">{fmt(mm, l.thickness)}</td>
                <td className="num">{l.quantity}</td>
                <td className="num">{fmt(m3, l.totalVolume)}</td>
                <td className="num" title={l.massNote}>
                  {fmt(kg, l.totalMass)}
                  {l.totalMass === undefined ? "" : noteMark(l.massNote)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={7}>
              {t.t("pdf.common.total")}
            </th>
            <td className="num">{bom.count}</td>
            <td className="num">{fmt(m3, bom.volume)}</td>
            <td
              className="num"
              title={bom.mass === undefined ? t.t("ui.bom.massMissing.title") : undefined}
            >
              {bom.mass === undefined ? t.t("ui.bom.massMissing") : fmt(kg, bom.mass)}
            </td>
          </tr>
        </tfoot>
      </table>
      {bom.massNotes.length > 0 ? (
        <p className="muted bom__notes">
          {bom.massNotes.map((n, i) => `${"*".repeat(i + 1)} ${n}.`).join(" ")}
        </p>
      ) : null}
    </div>
  );
}
