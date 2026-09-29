/**
 * Primitives de mise en page du dossier PDF : cadre utile, en-tête, cartouche, tableaux
 * paginés, règle de contrôle. Tout est en mm papier sur l'abstraction `PdfCanvas`.
 *
 * Choix de mise en page (non sourcés, à valider avec un atelier pilote, LEDGER §2) : marges de
 * 10 mm, cartouche de 150 × 20 mm en bas à droite, corps des textes de 2,2 à 4,2 mm.
 */
import { formatFr } from "../format.js";
import type { PdfCanvas, Rgb } from "./canvas.js";

export const MARGIN = 10;
export const HEADER = 9;
export const TITLE_BLOCK_H = 20;
export const TITLE_BLOCK_W = 150;
/** Blanc entre le cadre utile et le cartouche. */
export const FRAME_GAP = 3;

export const INK: Rgb = [31, 35, 40];
export const MUTED: Rgb = [87, 96, 106];
export const RULE: Rgb = [175, 184, 193];
export const BAND: Rgb = [246, 248, 250];
export const ACCENT: Rgb = [209, 36, 47];
export const GUIDE: Rgb = [9, 105, 218];

export const fr = (v: number, d = 0): string => formatFr(v, { decimals: d, trimZeros: true });

export function dateText(d: string | Date | undefined): string {
  if (d === undefined) return "—";
  if (typeof d === "string") return d;
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export interface Frame {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Informations de pièce imprimées dans le cartouche (planches de développé, gabarits). */
export interface TitlePart {
  readonly mark: string;
  readonly material: string;
  readonly thickness?: number;
}

/** Page à produire : description publique et dessin différé. */
export interface PageDraft<Info> {
  readonly info: Info;
  readonly part?: TitlePart;
  draw(c: PdfCanvas, frame: Frame): void;
  /** Dessin à droite de l'en-tête ; renvoie la largeur occupée (mm). */
  readonly headerRight?: (c: PdfCanvas) => number;
}

export function rect(
  c: PdfCanvas,
  x: number,
  y: number,
  w: number,
  h: number,
  fill?: Rgb,
  stroke?: Rgb,
  lineWidth = 0.2,
): void {
  c.path(
    [
      { op: "M", x, y },
      { op: "L", x: x + w, y },
      { op: "L", x: x + w, y: y + h },
      { op: "L", x, y: y + h },
      { op: "Z" },
    ],
    { ...(fill ? { fill } : {}), ...(stroke ? { stroke, lineWidth } : {}) },
  );
}

export function line(
  c: PdfCanvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: Rgb = RULE,
  lineWidth = 0.2,
  dash?: readonly number[],
): void {
  c.path(
    [
      { op: "M", x: x0, y: y0 },
      { op: "L", x: x1, y: y1 },
    ],
    { stroke: color, lineWidth, ...(dash ? { dash } : {}) },
  );
}

export function hline(c: PdfCanvas, x0: number, x1: number, y: number, color: Rgb = RULE): void {
  line(c, x0, y, x1, y, color);
}

/** Tronque un texte à une largeur (points de suspension). */
export function fit(c: PdfCanvas, s: string, size: number, width: number, bold = false): string {
  if (c.textWidth(s, size, bold) <= width) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (c.textWidth(`${s.slice(0, mid)}…`, size, bold) <= width) lo = mid;
    else hi = mid - 1;
  }
  return `${s.slice(0, lo)}…`;
}

/** Coupe un texte en lignes d'au plus `width` mm (mots entiers, mots trop longs coupés). */
export function wrapText(
  c: Pick<PdfCanvas, "textWidth">,
  s: string,
  size: number,
  width: number,
  bold = false,
): string[] {
  const out: string[] = [];
  for (const para of s.split(/\n/)) {
    let cur = "";
    for (const word of para.split(/\s+/).filter((w) => w !== "")) {
      const tryLine = cur === "" ? word : `${cur} ${word}`;
      if (c.textWidth(tryLine, size, bold) <= width) {
        cur = tryLine;
        continue;
      }
      if (cur !== "") out.push(cur);
      // Mot plus long que la ligne : coupé en morceaux.
      let rest = word;
      while (c.textWidth(rest, size, bold) > width && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && c.textWidth(rest.slice(0, n), size, bold) > width) n--;
        out.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      cur = rest;
    }
    out.push(cur);
  }
  return out;
}

/** Cadre utile d'une page (sous l'en-tête, au-dessus du cartouche). */
export function contentFrame(c: Pick<PdfCanvas, "pageWidth" | "pageHeight">): Frame {
  const top = MARGIN + HEADER;
  return {
    x: MARGIN,
    y: top,
    w: c.pageWidth - 2 * MARGIN,
    h: c.pageHeight - MARGIN - TITLE_BLOCK_H - FRAME_GAP - top,
  };
}

/** Bande libre en bas à gauche, à côté du cartouche (règle de contrôle, remarques). */
export function footerBand(c: Pick<PdfCanvas, "pageWidth" | "pageHeight">): Frame {
  const y = c.pageHeight - MARGIN - TITLE_BLOCK_H;
  return { x: MARGIN, y, w: c.pageWidth - 2 * MARGIN - TITLE_BLOCK_W - 4, h: TITLE_BLOCK_H };
}

export function drawHeader(c: PdfCanvas, title: string, reserveRight = 0): void {
  c.text(
    fit(c, title, 4.2, c.pageWidth - 2 * MARGIN - reserveRight - 2, true),
    MARGIN,
    MARGIN + 5,
    {
      size: 4.2,
      bold: true,
      color: INK,
    },
  );
  hline(c, MARGIN, c.pageWidth - MARGIN, MARGIN + HEADER - 2, INK);
}

export interface TitleBlockInfo {
  readonly project: string;
  readonly page: string;
  readonly scale: string;
  readonly date: string;
  readonly index: number;
  readonly total: number;
  readonly part?: TitlePart;
}

/**
 * Cartouche en deux colonnes : projet, document, échelle, date | repère, matériau,
 * épaisseur, pagination.
 */
export function drawTitleBlock(c: PdfCanvas, info: TitleBlockInfo): void {
  const w = TITLE_BLOCK_W;
  const h = TITLE_BLOCK_H;
  const x = c.pageWidth - MARGIN - w;
  const y = c.pageHeight - MARGIN - h;
  rect(c, x, y, w, h, undefined, INK);
  const rowH = h / 4;
  for (let i = 1; i < 4; i++) hline(c, x, x + w, y + i * rowH, RULE);
  const split = x + 96;
  line(c, split, y, split, y + h, RULE);
  const cell = (
    label: string,
    value: string,
    cx: number,
    cw: number,
    row: number,
    bold = false,
  ): void => {
    const by = y + row * rowH + rowH * 0.68;
    c.text(label, cx + 2, by, { size: 2.4, color: MUTED });
    const vx = cx + 19;
    c.text(fit(c, value, 3, cx + cw - vx - 1.5, bold), vx, by, { size: 3, color: INK, bold });
  };
  const leftW = split - x;
  const rightW = x + w - split;
  cell("Projet", info.project, x, leftW, 0, true);
  cell("Document", info.page, x, leftW, 1);
  cell("Échelle", info.scale, x, leftW, 2);
  cell("Date", info.date, x, leftW, 3);
  const p = info.part;
  cell("Repère", p?.mark ?? "—", split, rightW, 0, p !== undefined);
  cell("Matériau", p?.material ?? "—", split, rightW, 1);
  cell(
    "Épaisseur",
    p?.thickness !== undefined && Number.isFinite(p.thickness) ? `${fr(p.thickness, 1)} mm` : "—",
    split,
    rightW,
    2,
  );
  cell("Folio", `Page ${info.index} / ${info.total}`, split, rightW, 3);
  c.text("Blondel", x + 2, y - 1.5, { size: 2.2, color: MUTED });
}

// ------------------------------------------------------------------ règle de contrôle

/** Longueur de la règle de contrôle imprimée sur les pages à l'échelle 1:1, mm papier. */
export const CONTROL_RULER_MM = 100;

/**
 * Règle de contrôle de 100 mm (graduations tous les 10 mm, demi-graduation à 5 mm) posée en
 * (x, y) = origine à gauche, sur la ligne des graduations.
 */
export function drawControlRuler(c: PdfCanvas, x: number, y: number): void {
  const L = CONTROL_RULER_MM;
  line(c, x, y, x + L, y, INK, 0.3);
  for (let i = 0; i <= 20; i++) {
    const tx = x + i * 5;
    const len = i % 10 === 0 ? 3.5 : i % 2 === 0 ? 2.2 : 1.2;
    line(c, tx, y, tx, y - len, INK, 0.2);
  }
  c.text("0", x - 0.6, y + 3, { size: 2.4, color: INK });
  c.text("50", x + 50 - 1.2, y + 3, { size: 2.4, color: INK });
  c.text(`${L} mm`, x + L - 2, y + 3, { size: 2.4, color: INK, bold: true });
}

// ------------------------------------------------------------------ tableaux

export interface TableColumn {
  readonly title: string;
  readonly weight: number;
  readonly align: "left" | "right";
}

export interface TableRow {
  readonly cells: readonly string[];
  readonly bold?: boolean;
  /** Ligne d'intertitre (fond grisé, première cellule sur toute la largeur). */
  readonly heading?: boolean;
}

export interface TableSpec {
  readonly columns: readonly TableColumn[];
  readonly rows: readonly TableRow[];
  /** Lignes finales (totaux) sur la dernière page. */
  readonly footer?: readonly TableRow[];
  /** Texte si aucune ligne. */
  readonly empty: string;
  /** Lignes de texte avant le tableau (première page seulement). */
  readonly intro?: readonly string[];
  readonly rowHeight?: number;
  readonly textSize?: number;
}

/** Nombre de lignes du tableau par page (en-tête compris). */
function rowsPerPage(frameH: number, rowH: number, introH: number): number {
  return Math.max(1, Math.floor((frameH - introH - rowH * 2) / rowH));
}

/**
 * Découpe un tableau en pages : renvoie une fonction de dessin par page. L'en-tête des colonnes
 * est répété sur chaque page ; les totaux vont sur la dernière.
 */
export function tablePages(spec: TableSpec, frame: Frame): ((c: PdfCanvas, f: Frame) => void)[] {
  const rowH = spec.rowHeight ?? 5.2;
  const size = spec.textSize ?? 3;
  const introLineH = 4.2;
  const introH = (spec.intro?.length ?? 0) * introLineH + (spec.intro?.length ? 2 : 0);
  const footer = spec.footer ?? [];
  const chunks: TableRow[][] = [];
  let i = 0;
  let first = true;
  while (i < spec.rows.length || chunks.length === 0) {
    const cap = rowsPerPage(frame.h, rowH, first ? introH : 0);
    chunks.push(spec.rows.slice(i, i + cap));
    i += cap;
    first = false;
    if (i >= spec.rows.length) break;
  }
  // Totaux : sur une page de plus s'ils ne tiennent pas sous la dernière ligne.
  const lastCap = rowsPerPage(frame.h, rowH, chunks.length === 1 ? introH : 0);
  if (chunks[chunks.length - 1]!.length + footer.length > lastCap + 1) chunks.push([]);
  const weights = spec.columns.reduce((s, col) => s + col.weight, 0);
  return chunks.map((chunk, pi) => (cv: PdfCanvas, f: Frame) => {
    const widths = spec.columns.map((col) => (col.weight / weights) * f.w);
    const xs = widths.map((_, k) => f.x + widths.slice(0, k).reduce((s, w) => s + w, 0));
    const cell = (text: string, k: number, y: number, bold: boolean): void => {
      const col = spec.columns[k]!;
      const t = fit(cv, text, size, widths[k]! - 3, bold);
      const x =
        col.align === "right"
          ? xs[k]! + widths[k]! - 1.5 - cv.textWidth(t, size, bold)
          : xs[k]! + 1.5;
      cv.text(t, x, y, { size, bold, color: INK });
    };
    let y = f.y;
    if (pi === 0 && spec.intro) {
      for (const l of spec.intro) {
        y += introLineH;
        cv.text(fit(cv, l, 3, f.w), f.x, y - 1, { size: 3, color: INK });
      }
      y += 2;
    }
    rect(cv, f.x, y, f.w, rowH, BAND);
    spec.columns.forEach((col, k) => cell(col.title, k, y + rowH * 0.7, true));
    y += rowH;
    hline(cv, f.x, f.x + f.w, y, INK);
    if (spec.rows.length === 0 && pi === 0) {
      cv.text(spec.empty, f.x + 1.5, y + rowH * 0.7, { size, color: MUTED });
      y += rowH;
    }
    for (const r of chunk) {
      if (r.heading) {
        rect(cv, f.x, y, f.w, rowH, BAND);
        cv.text(fit(cv, r.cells[0] ?? "", size, f.w - 3, true), f.x + 1.5, y + rowH * 0.7, {
          size,
          bold: true,
          color: INK,
        });
      } else r.cells.forEach((v, k) => cell(v, k, y + rowH * 0.7, r.bold === true));
      y += rowH;
      hline(cv, f.x, f.x + f.w, y);
    }
    if (pi === chunks.length - 1) {
      for (const r of footer) {
        r.cells.forEach((v, k) => cell(v, k, y + rowH * 0.7, true));
        y += rowH;
      }
    }
  });
}
