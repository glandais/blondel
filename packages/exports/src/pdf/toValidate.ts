/**
 * Page « Valeurs à valider » du dossier PDF (ADR-0009 point 9) : valeurs par défaut non sourcées
 * (balancement par rotation, paramètres de structure et de garde-corps, marquées ◆ dans
 * l'interface) que l'atelier doit vérifier, validées ou restantes. La génération du dossier n'est jamais bloquée par des valeurs
 * restantes : la page en donne seulement le décompte.
 *
 * Les lignes sont préparées par l'application (libellé, valeur déjà formatée dans la langue du
 * dossier, section) : le dossier ne connaît pas le dictionnaire des niveaux de l'interface.
 * Le glyphe ◆ n'existe pas en WinAnsi : il n'est jamais écrit dans le PDF.
 */
import type { Message } from "@blondel/i18n";
import { tr, type Translator } from "../i18n.js";
import { pagedTitle, tablePages, type Frame, type PageDraft, type TableRow } from "./layout.js";

/** Une valeur à valider, telle que l'imprime le dossier. */
export interface PdfToValidateRow {
  /** Libellé du paramètre. */
  readonly label: Message;
  /** Valeur effective déjà formatée (unité comprise), dans la langue du dossier. */
  readonly value: string;
  /** Section de l'interface où se règle la valeur. */
  readonly section: Message;
  /** Vrai si l'atelier a validé cette valeur (validation encore valable). */
  readonly validated: boolean;
}

/**
 * Lignes du tableau : restantes d'abord, puis validées, ordre d'entrée conservé dans chaque
 * groupe.
 */
export function toValidateOrder(rows: readonly PdfToValidateRow[]): PdfToValidateRow[] {
  return [...rows.filter((r) => !r.validated), ...rows.filter((r) => r.validated)];
}

/** Décompte « n validées · m restantes » dans la langue du traducteur. */
export function toValidateSummary(t: Translator, rows: readonly PdfToValidateRow[]): string {
  const validated = rows.filter((r) => r.validated).length;
  return t.t("pdf.toValidate.summary", {
    validated: t.t("pdf.toValidate.validatedCount", { count: validated }),
    remaining: t.t("pdf.toValidate.remainingCount", { count: rows.length - validated }),
  });
}

/** Pages de la section : tableau paginé, chapeau et décompte sur la première page. */
export function toValidatePages<Info>(
  rows: readonly PdfToValidateRow[],
  frame: Frame,
  t: Translator,
  info: (title: string) => Info,
): PageDraft<Info>[] {
  const tableRows: TableRow[] = toValidateOrder(rows).map((r) => ({
    cells: [
      tr(t, r.label),
      r.value,
      tr(t, r.section),
      r.validated ? t.t("pdf.toValidate.state.validated") : t.t("pdf.toValidate.state.pending"),
    ],
  }));
  const draws = tablePages(
    {
      columns: [
        { title: t.t("pdf.toValidate.col.parameter"), weight: 50, align: "left" },
        { title: t.t("pdf.toValidate.col.value"), weight: 18, align: "right" },
        { title: t.t("pdf.toValidate.col.section"), weight: 22, align: "left" },
        { title: t.t("pdf.toValidate.col.state"), weight: 14, align: "left" },
      ],
      rows: tableRows,
      empty: t.t("pdf.toValidate.empty"),
      intro: [
        t.t("pdf.toValidate.intro.unsourced"),
        t.t("pdf.toValidate.intro.check"),
        toValidateSummary(t, rows),
      ],
    },
    frame,
  );
  const title = t.t("pdf.toValidate.title");
  return draws.map((draw, i) => ({
    info: info(pagedTitle(t, title, i + 1, draws.length)),
    tocTitle: title,
    draw,
  }));
}
