/**
 * Gabarits 1:1 en multi-pages (SPEC §3 « PDF coté complet, 1:1 multi-pages », D §3.4) : la
 * planche du développé est rendue à l'échelle 1:1 puis découpée en cases de la taille du cadre
 * utile de la page (A4 ou A3), avec un recouvrement entre cases voisines.
 *
 * Chaque case porte : son repère de grille (ligne A, B… de haut en bas, colonne 1, 2… de gauche
 * à droite), un plan d'assemblage miniature dans l'en-tête, les bords de recouvrement en
 * pointillés avec le repère de la case voisine, des mires d'assemblage (cercle et croix) au
 * milieu des bandes de recouvrement — la même mire est imprimée sur les deux cases voisines,
 * on les superpose — et une règle de contrôle de 100 mm.
 *
 * Les cases sans aucun tracé (planche en biais d'un limon, par exemple) ne sont pas imprimées ;
 * le plan d'assemblage les laisse vides.
 */
import type { Part } from "@blondel/core";
import {
  localeOption,
  materialLabel,
  translatorOf,
  tr,
  type LocaleOption,
  type Translator,
} from "../i18n.js";
import { renderFlatPatternSvg } from "../svg/flat.js";
import { RecordingCanvas, type PathOp, type PdfCanvas, type RecordedOp } from "./canvas.js";
import { clipPath, rectsIntersect, translateOps, type Rect } from "./clip.js";
import {
  ACCENT,
  GUIDE,
  HEADER,
  INK,
  MARGIN,
  MUTED,
  RULE,
  drawControlRuler,
  fit,
  footerBand,
  fr,
  line,
  rect,
  type Frame,
  type PageDraft,
} from "./layout.js";
import { drawSvg, parseSvg, svgSize } from "./svg-draw.js";

/** Recouvrement par défaut entre cases voisines, mm (choix de mise en page, à valider). */
export const DEFAULT_TILE_OVERLAP = 10;

export interface TileGrid {
  readonly cols: number;
  readonly rows: number;
  /** Pas entre cases (cadre − recouvrement), mm. */
  readonly stepX: number;
  readonly stepY: number;
  readonly overlap: number;
  readonly tileW: number;
  readonly tileH: number;
  readonly sheetW: number;
  readonly sheetH: number;
}

/**
 * Grille de cases couvrant une planche de `sheetW × sheetH` mm avec des cases de
 * `tileW × tileH` mm se recouvrant de `overlap` mm : n = 1 si la planche tient, sinon
 * n = ⌈(L − cadre) / (cadre − recouvrement)⌉ + 1.
 */
export function tileGrid(
  sheetW: number,
  sheetH: number,
  tileW: number,
  tileH: number,
  overlap = DEFAULT_TILE_OVERLAP,
  t: Translator = translatorOf(),
): TileGrid {
  if (!(overlap >= 0) || !(overlap < tileW / 2) || !(overlap < tileH / 2)) {
    throw new RangeError(t.t("pdf.template.overlapInvalid", { overlap: String(overlap) }));
  }
  const stepX = tileW - overlap;
  const stepY = tileH - overlap;
  const count = (sheet: number, tile: number, step: number): number =>
    sheet <= tile + 1e-6 ? 1 : Math.ceil((sheet - tile - 1e-6) / step) + 1;
  return {
    cols: count(sheetW, tileW, stepX),
    rows: count(sheetH, tileH, stepY),
    stepX,
    stepY,
    overlap,
    tileW,
    tileH,
    sheetW,
    sheetH,
  };
}

/** Lettres de ligne : A…Z, AA, AB… */
function rowLetters(r: number): string {
  let s = "";
  let n = r + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Repère de case : ligne en lettres (depuis le haut), colonne en chiffres (depuis la gauche). */
export function tileLabel(row: number, col: number): string {
  return `${rowLetters(row)}${col + 1}`;
}

/** Zone de la planche couverte par la case (repère de la planche, mm). */
export function tileRect(g: TileGrid, row: number, col: number): Rect {
  return { x: col * g.stepX, y: row * g.stepY, w: g.tileW, h: g.tileH };
}

export interface TileInfo {
  readonly row: number;
  readonly col: number;
  readonly label: string;
  readonly rows: number;
  readonly cols: number;
  /** Rang de la case parmi les cases imprimées (1…count). */
  readonly index: number;
  readonly count: number;
}

type DrawnOp = Extract<RecordedOp, { type: "path" } | { type: "text" }>;

/** Planche 1:1 enregistrée : opérations en mm, origine en haut à gauche. */
export interface TemplateSheet {
  readonly width: number;
  readonly height: number;
  readonly ops: readonly DrawnOp[];
}

export interface TemplateSheetOptions extends LocaleOption {
  /** Corps des textes du dessin, px SVG (voir `renderFlatPatternSvg`). */
  readonly fontPx: number;
  readonly decimals?: number;
}

/** Rend le développé de la pièce à l'échelle 1:1 et enregistre ses tracés. */
export function templateSheet(
  measure: Pick<PdfCanvas, "textWidth">,
  part: Part,
  options: TemplateSheetOptions,
): TemplateSheet {
  const tx = translatorOf(options);
  const svg = parseSvg(
    renderFlatPatternSvg(part, {
      ...localeOption(tx),
      theme: "light",
      fontSize: options.fontPx,
      margin: 8,
      scale: 1,
      background: false,
      info: false,
      ...(options.decimals !== undefined ? { decimals: options.decimals } : {}),
    }),
  );
  const size = svgSize(svg);
  const width = size.widthMm ?? 0;
  const height = size.heightMm ?? 0;
  const rec = new RecordingCanvas(width, height, (v, s, b) => measure.textWidth(v, s, b));
  drawSvg(rec, svg, { x: 0, y: 0 });
  const ops = rec.ops.filter((o): o is DrawnOp => o.type === "path" || o.type === "text");
  return { width, height, ops };
}

/** Emprise approchée d'un texte (disque de rayon largeur + corps autour du point d'ancrage). */
function textBounds(op: Extract<RecordedOp, { type: "text" }>, width: number): Rect {
  const r = width + op.style.size;
  return { x: op.x - r, y: op.y - r, w: 2 * r, h: 2 * r };
}

const polylineLength = (ops: readonly PathOp[]): number => {
  let s = 0;
  let last: { x: number; y: number } | undefined;
  for (const o of ops) {
    if (o.op === "M") last = { x: o.x, y: o.y };
    else if (o.op === "L" && last) {
      s += Math.hypot(o.x - last.x, o.y - last.y);
      last = { x: o.x, y: o.y };
    }
  }
  return s;
};

/** Seuils de « case non vide » : 1 mm de trait ou 1 mm² de surface, ou un texte ancré. */
const MIN_STROKE_MM = 1;
const MIN_FILL_MM2 = 1;

const fillArea = (ops: readonly PathOp[]): number => {
  let total = 0;
  let ring: { x: number; y: number }[] = [];
  const flush = (): void => {
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]!;
      const q = ring[(i + 1) % ring.length]!;
      s += p.x * q.y - q.x * p.y;
    }
    total += Math.abs(s) / 2;
    ring = [];
  };
  for (const o of ops) {
    if (o.op === "M") {
      flush();
      ring.push({ x: o.x, y: o.y });
    } else if (o.op === "L") ring.push({ x: o.x, y: o.y });
    else if (o.op === "Z") flush();
  }
  flush();
  return total;
};

/** La case contient-elle un tracé de la planche ? */
export function tileHasContent(sheet: TemplateSheet, r: Rect): boolean {
  for (const op of sheet.ops) {
    if (op.type === "text") {
      if (op.x >= r.x && op.x <= r.x + r.w && op.y >= r.y && op.y <= r.y + r.h) return true;
      continue;
    }
    for (const piece of clipPath(op.ops, op.style, r)) {
      if (piece.style.fill !== undefined && fillArea(piece.ops) >= MIN_FILL_MM2) return true;
      if (piece.style.stroke !== undefined && polylineLength(piece.ops) >= MIN_STROKE_MM)
        return true;
    }
  }
  return false;
}

/** Cases imprimées (non vides), dans l'ordre de lecture (lignes puis colonnes). */
export function templateTiles(sheet: TemplateSheet, grid: TileGrid): TileInfo[] {
  const kept: { row: number; col: number }[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (tileHasContent(sheet, tileRect(grid, row, col))) kept.push({ row, col });
    }
  }
  return kept.map((t, i) => ({
    ...t,
    label: tileLabel(t.row, t.col),
    rows: grid.rows,
    cols: grid.cols,
    index: i + 1,
    count: kept.length,
  }));
}

// ------------------------------------------------------------------ dessin d'une case

function circle(c: PdfCanvas, cx: number, cy: number, r: number, color = GUIDE): void {
  const k = 0.5522847498 * r;
  c.path(
    [
      { op: "M", x: cx + r, y: cy },
      { op: "C", x1: cx + r, y1: cy + k, x2: cx + k, y2: cy + r, x: cx, y: cy + r },
      { op: "C", x1: cx - k, y1: cy + r, x2: cx - r, y2: cy + k, x: cx - r, y: cy },
      { op: "C", x1: cx - r, y1: cy - k, x2: cx - k, y2: cy - r, x: cx, y: cy - r },
      { op: "C", x1: cx + k, y1: cy - r, x2: cx + r, y2: cy - k, x: cx + r, y: cy },
      { op: "Z" },
    ],
    { stroke: color, lineWidth: 0.2 },
  );
}

/** Mire d'assemblage : cercle de 5 mm et croix de 8 mm. */
function registrationMark(c: PdfCanvas, x: number, y: number): void {
  circle(c, x, y, 2.5);
  line(c, x - 4, y, x + 4, y, GUIDE, 0.15);
  line(c, x, y - 4, x, y + 4, GUIDE, 0.15);
}

/** Centres des mires (repère de la planche) : milieux des bandes de recouvrement. */
export function registrationPoints(g: TileGrid): { x: number; y: number }[] {
  const xs: number[] = [];
  const ys: number[] = [];
  const midX: number[] = [];
  const midY: number[] = [];
  for (let c = 0; c + 1 < g.cols; c++) xs.push((c + 1) * g.stepX + g.overlap / 2);
  for (let r = 0; r + 1 < g.rows; r++) ys.push((r + 1) * g.stepY + g.overlap / 2);
  for (let c = 0; c < g.cols; c++) midX.push(c * g.stepX + g.tileW / 2);
  for (let r = 0; r < g.rows; r++) midY.push(r * g.stepY + g.tileH / 2);
  const out: { x: number; y: number }[] = [];
  for (const x of xs) for (const y of [...midY, ...ys]) out.push({ x, y });
  for (const y of ys) for (const x of midX) out.push({ x, y });
  return out;
}

/** Emprise maximale du plan d'assemblage dans l'en-tête (au-dessus du filet), mm. */
const MAP_MAX_W = 70;
const MAP_MAX_H = HEADER - 2 - 0.6;

/**
 * Plan d'assemblage miniature (en-tête, à droite) ; renvoie sa largeur. Les cases gardent les
 * proportions du cadre et le plan tient toujours dans l'en-tête (grandes grilles comprises :
 * il ne déborde jamais sur le gabarit).
 */
function drawAssemblyMap(
  c: PdfCanvas,
  tile: TileInfo,
  present: ReadonlySet<string>,
  aspect: number,
  t: Translator,
): number {
  const ch = Math.min(3.2, MAP_MAX_H / tile.rows, MAP_MAX_W / tile.cols / aspect);
  const cw = ch * aspect;
  const w = tile.cols * cw;
  const x0 = c.pageWidth - MARGIN - w;
  const y0 = MARGIN + 0.2;
  for (let r = 0; r < tile.rows; r++) {
    for (let col = 0; col < tile.cols; col++) {
      const key = tileLabel(r, col);
      const current = r === tile.row && col === tile.col;
      if (!present.has(key)) continue;
      rect(
        c,
        x0 + col * cw,
        y0 + r * ch,
        cw,
        ch,
        current ? ACCENT : undefined,
        current ? ACCENT : MUTED,
        0.1,
      );
    }
  }
  const label = t.t("pdf.template.assembly");
  c.text(label, x0 - 1.5 - c.textWidth(label, 2.2), y0 + 2.4, { size: 2.2, color: MUTED });
  return w + 2 + c.textWidth(label, 2.2);
}

export interface TemplatePageInfo {
  readonly kind: "template";
  readonly title: string;
  readonly scale: 1;
  readonly partIds: readonly string[];
  readonly tile: TileInfo;
}

/**
 * Pages de gabarit 1:1 d'une pièce : une page par case non vide. `frame` est le cadre utile
 * de la page (taille des cases).
 */
export function templatePages(
  measure: Pick<PdfCanvas, "textWidth">,
  part: Part,
  ids: readonly string[],
  frame: Frame,
  options: TemplateSheetOptions & { readonly overlap?: number },
): PageDraft<TemplatePageInfo>[] {
  const tx = translatorOf(options);
  const sheet = templateSheet(measure, part, options);
  const grid = tileGrid(
    sheet.width,
    sheet.height,
    frame.w,
    frame.h,
    options.overlap ?? DEFAULT_TILE_OVERLAP,
    tx,
  );
  const tiles = templateTiles(sheet, grid);
  const present = new Set(tiles.map((t) => t.label));
  const marks = registrationPoints(grid);
  const withQty = (title: string): string =>
    ids.length > 1
      ? tx.t("pdf.template.withQuantity", { title, count: String(ids.length) })
      : title;
  const single = grid.cols === 1 && grid.rows === 1;
  const thickness = part.flat?.thickness;
  const singleTitle = tx.t("pdf.template.title", { mark: part.mark, name: tr(tx, part.name) });
  // Entrée du sommaire : gabarit d'une page, ou toutes les cases d'une grille regroupées.
  const tocTitle = single
    ? singleTitle
    : tx.t("pdf.toc.templateTiles", {
        title: tx.t("pdf.template.titleBase", { mark: part.mark }),
        count: String(tiles.length),
        rows: String(grid.rows),
        cols: String(grid.cols),
      });
  return tiles.map((tile) => ({
    info: {
      kind: "template",
      title: withQty(
        single
          ? singleTitle
          : tx.t("pdf.template.titleTile", {
              mark: part.mark,
              label: tile.label,
              index: String(tile.index),
              count: String(tile.count),
            }),
      ),
      scale: 1,
      partIds: ids,
      tile,
    },
    tocTitle,
    part: {
      mark: part.mark,
      material: materialLabel(tx, part.material),
      ...(thickness !== undefined ? { thickness } : {}),
    },
    draw(c, f) {
      const r = tileRect(grid, tile.row, tile.col);
      const dx = f.x - r.x;
      const dy = f.y - r.y;
      const body = (): void => {
        for (const op of sheet.ops) {
          if (op.type === "text") {
            if (
              !rectsIntersect(
                textBounds(op, c.textWidth(op.value, op.style.size, op.style.bold)),
                r,
              )
            ) {
              continue;
            }
            c.text(op.value, op.x + dx, op.y + dy, op.style);
            continue;
          }
          for (const piece of clipPath(op.ops, op.style, r)) {
            c.path(translateOps(piece.ops, dx, dy), piece.style);
          }
        }
      };
      if (c.withClip) c.withClip(f.x, f.y, f.w, f.h, body);
      else body();
      // Bord de case.
      rect(c, f.x, f.y, f.w, f.h, undefined, RULE, 0.15);
      // Bandes de recouvrement avec les cases voisines imprimées.
      const o = grid.overlap;
      const dash = [2, 1.5];
      const neighbour = (dr: number, dc: number): string | undefined => {
        const key = tileLabel(tile.row + dr, tile.col + dc);
        return tile.row + dr >= 0 &&
          tile.col + dc >= 0 &&
          tile.row + dr < grid.rows &&
          tile.col + dc < grid.cols &&
          present.has(key)
          ? key
          : undefined;
      };
      const left = neighbour(0, -1);
      const right = neighbour(0, 1);
      const up = neighbour(-1, 0);
      const down = neighbour(1, 0);
      const small = { size: 2.2, color: GUIDE };
      if (left) {
        line(c, f.x + o, f.y, f.x + o, f.y + f.h, GUIDE, 0.15, dash);
        c.text(tx.t("pdf.template.overlap", { tile: left }), f.x + o / 2 + 0.8, f.y + f.h * 0.35, {
          ...small,
          angle: 90,
        });
      }
      if (right) {
        line(c, f.x + f.w - o, f.y, f.x + f.w - o, f.y + f.h, GUIDE, 0.15, dash);
        c.text(
          tx.t("pdf.template.overlap", { tile: right }),
          f.x + f.w - o / 2 + 0.8,
          f.y + f.h * 0.35,
          {
            ...small,
            angle: 90,
          },
        );
      }
      if (up) {
        line(c, f.x, f.y + o, f.x + f.w, f.y + o, GUIDE, 0.15, dash);
        c.text(
          tx.t("pdf.template.overlap", { tile: up }),
          f.x + f.w * 0.2,
          f.y + o / 2 + 0.8,
          small,
        );
      }
      if (down) {
        line(c, f.x, f.y + f.h - o, f.x + f.w, f.y + f.h - o, GUIDE, 0.15, dash);
        c.text(
          tx.t("pdf.template.overlap", { tile: down }),
          f.x + f.w * 0.2,
          f.y + f.h - o / 2 + 0.8,
          small,
        );
      }
      for (const m of marks) {
        if (m.x >= r.x && m.x <= r.x + r.w && m.y >= r.y && m.y <= r.y + r.h) {
          registrationMark(c, m.x + dx, m.y + dy);
        }
      }
      // Pied de page : règle de contrôle et consignes.
      const band = footerBand(c);
      drawControlRuler(c, band.x + 1, band.y + 6);
      const notes = [
        tx.t("pdf.template.note.print"),
        single
          ? tx.t("pdf.template.note.single")
          : tx.t("pdf.template.note.tile", {
              label: tile.label,
              row: rowLetters(tile.row),
              col: String(tile.col + 1),
              rows: String(grid.rows),
              cols: String(grid.cols),
              overlap: fr(tx, o),
            }),
      ];
      notes.forEach((t, i) => {
        c.text(fit(c, t, 2.4, band.w - 2), band.x + 1, band.y + 12 + i * 3.4, {
          size: 2.4,
          color: i === 0 ? INK : MUTED,
        });
      });
    },
    ...(single
      ? {}
      : {
          headerRight: (c: PdfCanvas) => drawAssemblyMap(c, tile, present, frame.w / frame.h, tx),
        }),
  }));
}
