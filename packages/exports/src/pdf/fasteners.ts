/**
 * Section « Visserie » du dossier PDF (QUESTIONS A27, décision du 2026-10-06), après la
 * nomenclature : tableau paginé des repères de visserie (mêmes lignes que la liste de visserie
 * CSV, `fastenerScheduleRows`) avec repère, désignation, diamètre, longueur, quantité,
 * assemblages d'origine et repères des pièces assemblées, total des quantités en pied.
 *
 * Aucune page sans visserie (`Model.fasteners` absent ou vide). Le chapeau rappelle que la nature,
 * la classe, la longueur et la quantité par point de fixation viennent du profil d'atelier,
 * valeurs par défaut à valider.
 */
import type { Model } from "@blondel/core";
import { fastenerListSeparator, fastenerMm, fastenerScheduleRows } from "../csv/fasteners.js";
import { localeOption, type Translator } from "../i18n.js";
import { pagedTitle, tablePages, type Frame, type PageDraft } from "./layout.js";

/** Pages de la section (vide sans visserie) ; `info` décrit chaque page pour l'appelant. */
export function fastenerPages<Info>(
  model: Pick<Model, "parts" | "fasteners">,
  frame: Frame,
  t: Translator,
  info: (title: string) => Info,
): PageDraft<Info>[] {
  const rows = fastenerScheduleRows(model, localeOption(t));
  if (rows.length === 0) return [];
  const list = fastenerListSeparator(t);
  const total = rows.reduce((s, r) => s + r.quantity, 0);
  const draws = tablePages(
    {
      columns: [
        { title: t.t("pdf.bom.col.mark"), weight: 10, align: "left" },
        { title: t.t("pdf.bom.col.designation"), weight: 42, align: "left" },
        { title: t.t("pdf.fasteners.col.diameter"), weight: 15, align: "right" },
        { title: t.t("pdf.fasteners.col.length"), weight: 15, align: "right" },
        { title: t.t("pdf.bom.col.quantity"), weight: 8, align: "right" },
        { title: t.t("pdf.fasteners.col.joints"), weight: 38, align: "left" },
        { title: t.t("pdf.fasteners.col.parts"), weight: 22, align: "left" },
      ],
      rows: rows.map((r) => ({
        cells: [
          r.mark,
          r.name,
          fastenerMm(t, r.diameter),
          fastenerMm(t, r.length),
          String(r.quantity),
          r.joints.join(list),
          r.partMarks.join(list),
        ],
      })),
      footer: [{ cells: [t.t("pdf.common.total"), "", "", "", String(total), "", ""] }],
      empty: t.t("pdf.fasteners.empty"),
      intro: [t.t("pdf.fasteners.intro.deduced"), t.t("pdf.fasteners.intro.toValidate")],
    },
    frame,
  );
  const title = t.t("pdf.fasteners.title");
  return draws.map((draw, i) => ({
    info: info(pagedTitle(t, title, i + 1, draws.length)),
    tocTitle: title,
    draw,
  }));
}
