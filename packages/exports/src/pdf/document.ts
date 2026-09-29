/**
 * Dossier PDF minimal (SPEC « PDF coté minimal », critère d'acceptation n° 1) :
 *
 * 1. plan coté (`renderPlanSvg`) ;
 * 2. élévation développée (`renderElevationSvg`) ;
 * 3. nomenclature (repère, désignation, matériau, section, débit, quantité), sur autant de
 *    pages que nécessaire ;
 * 4. contrôle de conception : avertissement « indicatif », résultats groupés (violations par
 *    sévérité, non évaluées, respectées) avec nature, confiance, source et source secondaire ;
 * 5. une page par développé (`renderFlatPatternSvg`), à l'échelle indiquée.
 *
 * Chaque page porte un cartouche (projet, titre de la page, échelle, date, pagination).
 * Les dessins sont posés à une échelle normalisée 1:n (la plus grande qui tient dans le
 * cadre), jamais « ajustés » sans le dire : l'échelle imprimée est l'échelle réelle.
 *
 * Mise en page écrite sur l'abstraction `PdfCanvas` (tests : `RecordingCanvas`) ;
 * `exportPdf` la réalise avec jsPDF.
 */
import type { Model, Part, Project, RuleResult, Severity } from "@blondel/core";
import { cutListRows } from "../csv/cutlist.js";
import { formatFr } from "../format.js";
import { renderElevationSvg } from "../svg/elevation.js";
import { renderFlatPatternSvg } from "../svg/flat.js";
import { renderPlanSvg } from "../svg/plan.js";
import { JsPdfCanvas, type PdfCanvas, type Rgb } from "./canvas.js";
import { drawSvg, parseSvg, svgSize } from "./svg-draw.js";

/** Avertissement imprimé en tête du contrôle de conception (CHALLENGE P3). */
export const COMPLIANCE_DISCLAIMER =
  "Contrôle de conception indicatif, ne vaut pas attestation de conformité.";

/** Échelles normalisées essayées, de la plus grande (1:1) à la plus petite. */
export const STANDARD_SCALES: readonly number[] = [1, 2, 5, 10, 20, 25, 50, 75, 100, 200, 500];

export interface PdfPages {
  readonly plan?: boolean;
  readonly elevation?: boolean;
  readonly bom?: boolean;
  readonly compliance?: boolean;
  readonly flats?: boolean;
}

export interface PdfLayoutOptions {
  /** Projet source : nom (cartouche), trémie et plancher haut (plan, élévation). */
  readonly project?: Project;
  /** Nom affiché dans le cartouche (défaut : `project.name`, sinon « Escalier »). */
  readonly title?: string;
  /**
   * Date du cartouche : texte libre ou `Date` (affichée JJ/MM/AAAA). Absente : « — ». Jamais
   * lue dans l'horloge : deux exports du même modèle sont identiques.
   */
  readonly date?: string | Date;
  /** Échelles imposées 1:n (sinon : la plus grande échelle normalisée qui tient). */
  readonly planScale?: number;
  readonly elevationScale?: number;
  readonly flatScale?: number;
  /** Échelles candidates (défaut `STANDARD_SCALES`). */
  readonly scales?: readonly number[];
  /** Pages produites (toutes par défaut). */
  readonly pages?: PdfPages;
  /** Corps des textes des dessins, mm papier (défaut 2,4). */
  readonly drawingTextMm?: number;
  /** Décimales des cotes (défaut : celles des rendus SVG). */
  readonly decimals?: number;
}

export interface PdfOptions extends PdfLayoutOptions {
  /** Format de page, paysage (défaut A4). */
  readonly format?: "a4" | "a3";
  /** Compression des flux (défaut : vrai ; faux pour inspecter le fichier). */
  readonly compress?: boolean;
}

/** Résumé d'une page produite (tests, table des matières éventuelle). */
export interface PdfPageInfo {
  readonly kind: "plan" | "elevation" | "bom" | "compliance" | "flat";
  readonly title: string;
  /** Échelle 1:n du dessin (absent : page de texte). */
  readonly scale?: number;
  /** Échelle imposée non tenue (dessin trop grand) : échelle retenue à la place. */
  readonly scaleNote?: string;
  readonly partIds?: readonly string[];
}

// ------------------------------------------------------------------ constantes de page

const MARGIN = 10;
const HEADER = 9;
const TITLE_BLOCK_H = 20;
const TITLE_BLOCK_W = 110;
const INK: Rgb = [31, 35, 40];
const MUTED: Rgb = [87, 96, 106];
const RULE: Rgb = [175, 184, 193];
const BAND: Rgb = [246, 248, 250];
const SEVERITY_COLOR: Readonly<Record<Severity, Rgb>> = {
  bloquant: [209, 36, 47],
  avertissement: [232, 134, 12],
  conseil: [191, 135, 0],
};

const NATURE_LABELS: Readonly<Record<string, string>> = {
  reglementaire: "réglementaire",
  normatif: "normatif",
  metier: "métier",
};
const CONFIDENCE_LABELS: Readonly<Record<string, string>> = {
  eleve: "élevée",
  moyen: "moyenne",
  faible: "faible",
};

const fr = (v: number, d = 0): string => formatFr(v, { decimals: d, trimZeros: true });

function dateText(d: string | Date | undefined): string {
  if (d === undefined) return "—";
  if (typeof d === "string") return d;
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// ------------------------------------------------------------------ primitives de mise en page

function rect(
  c: PdfCanvas,
  x: number,
  y: number,
  w: number,
  h: number,
  fill?: Rgb,
  stroke?: Rgb,
): void {
  c.path(
    [
      { op: "M", x, y },
      { op: "L", x: x + w, y },
      { op: "L", x: x + w, y: y + h },
      { op: "L", x, y: y + h },
      { op: "Z" },
    ],
    { ...(fill ? { fill } : {}), ...(stroke ? { stroke, lineWidth: 0.2 } : {}) },
  );
}

function hline(c: PdfCanvas, x0: number, x1: number, y: number, color: Rgb = RULE): void {
  c.path(
    [
      { op: "M", x: x0, y },
      { op: "L", x: x1, y },
    ],
    { stroke: color, lineWidth: 0.2 },
  );
}

/** Tronque un texte à une largeur (points de suspension). */
function fit(c: PdfCanvas, s: string, size: number, width: number, bold = false): string {
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
    let line = "";
    for (const word of para.split(/\s+/).filter((w) => w !== "")) {
      const tryLine = line === "" ? word : `${line} ${word}`;
      if (c.textWidth(tryLine, size, bold) <= width) {
        line = tryLine;
        continue;
      }
      if (line !== "") out.push(line);
      // Mot plus long que la ligne : coupé en morceaux.
      let rest = word;
      while (c.textWidth(rest, size, bold) > width && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && c.textWidth(rest.slice(0, n), size, bold) > width) n--;
        out.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

// ------------------------------------------------------------------ pages

interface Frame {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface PageSpec extends PdfPageInfo {
  draw(c: PdfCanvas, frame: Frame): void;
}

/** Cadre utile d'une page (sous l'en-tête, au-dessus du cartouche). */
function contentFrame(c: PdfCanvas): Frame {
  const top = MARGIN + HEADER;
  return {
    x: MARGIN,
    y: top,
    w: c.pageWidth - 2 * MARGIN,
    h: c.pageHeight - MARGIN - TITLE_BLOCK_H - 3 - top,
  };
}

function drawHeader(c: PdfCanvas, title: string): void {
  c.text(title, MARGIN, MARGIN + 5, { size: 4.2, bold: true, color: INK });
  hline(c, MARGIN, c.pageWidth - MARGIN, MARGIN + HEADER - 2, INK);
}

function drawTitleBlock(
  c: PdfCanvas,
  info: {
    project: string;
    page: string;
    scale: string;
    date: string;
    index: number;
    total: number;
  },
): void {
  const w = TITLE_BLOCK_W;
  const h = TITLE_BLOCK_H;
  const x = c.pageWidth - MARGIN - w;
  const y = c.pageHeight - MARGIN - h;
  rect(c, x, y, w, h, undefined, INK);
  const rowH = h / 4;
  for (let i = 1; i < 4; i++) hline(c, x, x + w, y + i * rowH, RULE);
  const col = x + 22;
  const rows: [string, string][] = [
    ["Projet", info.project],
    ["Document", info.page],
    ["Échelle", info.scale],
    ["Date", info.date],
  ];
  rows.forEach(([label, value], i) => {
    const by = y + i * rowH + rowH * 0.68;
    c.text(label, x + 2, by, { size: 2.6, color: MUTED });
    c.text(fit(c, value, 3, x + w - 26 - col), col, by, { size: 3, color: INK, bold: i === 0 });
  });
  const pg = `Page ${info.index} / ${info.total}`;
  c.text(pg, x + w - 2 - c.textWidth(pg, 2.6), y + 3 * rowH + rowH * 0.68, {
    size: 2.6,
    color: MUTED,
  });
  c.text("Blondel", x + 2, y - 1.5, { size: 2.2, color: MUTED });
}

/**
 * Plus grande échelle normalisée (1:n, n croissant) à laquelle le dessin tient dans le cadre ;
 * au-delà de la liste, n entier calculé. `render(n)` rend le SVG à l'échelle 1:n.
 */
function chooseScale(
  render: (n: number) => string,
  frame: Frame,
  scales: readonly number[],
  forced: number | undefined,
): { n: number; svg: string; note?: string } {
  const fits = (svg: string): boolean => {
    const s = svgSize(parseSvg(svg));
    return (s.widthMm ?? Infinity) <= frame.w + 1e-6 && (s.heightMm ?? Infinity) <= frame.h + 1e-6;
  };
  if (forced !== undefined) {
    if (!(forced > 0) || !Number.isFinite(forced)) {
      throw new RangeError(`Échelle imposée invalide : 1:${forced}`);
    }
    const svg = render(forced);
    if (fits(svg)) return { n: forced, svg };
  }
  const sorted = [...scales].filter((n) => n > 0).sort((a, b) => a - b);
  for (const n of sorted) {
    const svg = render(n);
    if (fits(svg)) {
      return forced === undefined
        ? { n, svg }
        : { n, svg, note: `échelle 1:${fr(forced)} demandée trop grande pour le format` };
    }
  }
  // Aucune échelle de la liste : n entier croissant à partir de la plus petite.
  // Arrêt dès que réduire l'échelle ne réduit plus le dessin (textes de taille physique
  // fixe plus larges que le cadre) : inutile de rendre 60 fois la même emprise.
  const extent = (svg: string): number => {
    const s = svgSize(parseSvg(svg));
    return Math.max(s.widthMm ?? Infinity, s.heightMm ?? Infinity);
  };
  let n = Math.max(1, sorted[sorted.length - 1] ?? 1);
  let svg = render(n);
  let size = extent(svg);
  for (let i = 0; i < 60 && !fits(svg); i++) {
    const next = Math.ceil(n * 1.25);
    const nextSvg = render(next);
    const nextSize = extent(nextSvg);
    if (!(nextSize < size - 1e-3)) break;
    n = next;
    svg = nextSvg;
    size = nextSize;
  }
  return { n, svg, note: "échelle non normalisée (dessin trop grand)" };
}

function drawingPage(
  kind: "plan" | "elevation" | "flat",
  title: string,
  render: (n: number) => string,
  frame: Frame,
  scales: readonly number[],
  forced: number | undefined,
  extra: Partial<PdfPageInfo> = {},
): PageSpec {
  const chosen = chooseScale(render, frame, scales, forced);
  const svg = parseSvg(chosen.svg);
  return {
    kind,
    title,
    scale: chosen.n,
    ...(chosen.note !== undefined ? { scaleNote: chosen.note } : {}),
    ...extra,
    draw(c, f) {
      const size = svgSize(svg);
      const w = size.widthMm ?? 0;
      const h = size.heightMm ?? 0;
      drawSvg(c, svg, { x: f.x + Math.max(0, (f.w - w) / 2), y: f.y + Math.max(0, (f.h - h) / 2) });
      if (chosen.note !== undefined) {
        c.text(`Remarque : ${chosen.note}.`, f.x, f.y + f.h + 2, { size: 2.4, color: MUTED });
      }
    },
  };
}

// ------------------------------------------------------------------ nomenclature

interface BomColumn {
  readonly title: string;
  readonly weight: number;
  readonly align: "left" | "right";
}

const BOM_COLUMNS: readonly BomColumn[] = [
  { title: "Repère", weight: 12, align: "left" },
  { title: "Désignation", weight: 48, align: "left" },
  { title: "Matériau", weight: 20, align: "left" },
  { title: "Section", weight: 22, align: "left" },
  { title: "Débit L × l × e (mm)", weight: 32, align: "right" },
  { title: "Qté", weight: 8, align: "right" },
];

function bomCells(parts: readonly Part[]): string[][] {
  return cutListRows(parts).map((r) => [
    r.mark,
    r.name,
    r.material,
    r.section,
    r.length !== undefined && r.width !== undefined && r.thickness !== undefined
      ? `${fr(r.length, 1)} × ${fr(r.width, 1)} × ${fr(r.thickness, 1)}`
      : "—",
    String(r.quantity),
  ]);
}

function bomPages(parts: readonly Part[], frame: Frame): PageSpec[] {
  const rows = bomCells(parts);
  const rowH = 5.2;
  const size = 3;
  const perPage = Math.max(1, Math.floor((frame.h - rowH * 2) / rowH));
  const total = rows.reduce((s, r) => s + Number(r[5]), 0);
  const chunks: string[][][] = [];
  for (let i = 0; i < rows.length; i += perPage) chunks.push(rows.slice(i, i + perPage));
  if (chunks.length === 0) chunks.push([]);
  const weights = BOM_COLUMNS.reduce((s, col) => s + col.weight, 0);
  return chunks.map((chunk, pi) => ({
    kind: "bom" as const,
    title: chunks.length > 1 ? `Nomenclature (${pi + 1}/${chunks.length})` : "Nomenclature",
    draw(cv, f) {
      const widths = BOM_COLUMNS.map((col) => (col.weight / weights) * f.w);
      const xs = widths.map((_, i) => f.x + widths.slice(0, i).reduce((s, w) => s + w, 0));
      const cell = (text: string, i: number, y: number, bold: boolean): void => {
        const col = BOM_COLUMNS[i]!;
        const t = fit(cv, text, size, widths[i]! - 3, bold);
        const x =
          col.align === "right"
            ? xs[i]! + widths[i]! - 1.5 - cv.textWidth(t, size, bold)
            : xs[i]! + 1.5;
        cv.text(t, x, y, { size, bold, color: INK });
      };
      let y = f.y;
      rect(cv, f.x, y, f.w, rowH, BAND, undefined);
      BOM_COLUMNS.forEach((col, i) => cell(col.title, i, y + rowH * 0.7, true));
      y += rowH;
      hline(cv, f.x, f.x + f.w, y, INK);
      if (chunk.length === 0) {
        cv.text("Aucune pièce générée.", f.x + 1.5, y + rowH * 0.7, { size, color: MUTED });
      }
      for (const r of chunk) {
        r.forEach((v, i) => cell(v, i, y + rowH * 0.7, false));
        y += rowH;
        hline(cv, f.x, f.x + f.w, y);
      }
      if (pi === chunks.length - 1 && rows.length > 0) {
        cell("Total", 0, y + rowH * 0.7, true);
        cell(String(total), 5, y + rowH * 0.7, true);
      }
    },
  }));
}

// ------------------------------------------------------------------ contrôle de conception

interface Line {
  readonly text: string;
  readonly size: number;
  readonly bold?: boolean;
  readonly color?: Rgb;
  readonly indent?: number;
  /** Espace avant la ligne, mm. */
  readonly before?: number;
}

function measuredText(r: RuleResult): string | undefined {
  const u = r.unit !== undefined && r.unit !== "" ? ` ${r.unit}` : "";
  const parts: string[] = [];
  if (r.measured !== undefined && Number.isFinite(r.measured))
    parts.push(`mesuré ${fr(r.measured, 1)}${u}`);
  if (r.min !== undefined && r.min !== null) parts.push(`min ${fr(r.min, 1)}${u}`);
  if (r.max !== undefined && r.max !== null) parts.push(`max ${fr(r.max, 1)}${u}`);
  return parts.length > 0 ? parts.join(" — ") : undefined;
}

function provenance(r: RuleResult): string {
  const nature = NATURE_LABELS[r.nature] ?? r.nature;
  const conf = CONFIDENCE_LABELS[r.confidence] ?? r.confidence;
  return `Nature : ${nature} — confiance : ${conf} — source : ${r.source}${r.secondarySource ? " (source secondaire : norme payante non lue)" : ""}`;
}

const SEVERITY_TITLES: Readonly<Record<Severity, string>> = {
  bloquant: "Violations bloquantes",
  avertissement: "Avertissements",
  conseil: "Conseils",
};

/** Lignes du contrôle de conception (avant découpage en pages). */
export function complianceLines(
  model: Model,
  c: Pick<PdfCanvas, "textWidth">,
  width: number,
): Line[] {
  const rep = model.compliance;
  const body = 3;
  const small = 2.6;
  const out: Line[] = [];
  const push = (text: string, style: Omit<Line, "text">): void => {
    const indent = style.indent ?? 0;
    wrapText(c, text, style.size, width - indent, style.bold).forEach((t, i) =>
      out.push({ ...style, text: t, ...(i > 0 ? { before: 0 } : {}) }),
    );
  };
  push(COMPLIANCE_DISCLAIMER, { size: 3.4, bold: true, color: SEVERITY_COLOR.bloquant });
  push(
    `Profil ${rep.profile} — règles v${rep.rulesVersion} — contextes : ${rep.contexts.join(", ") || "—"} — ` +
      `${rep.summary.bloquant} bloquant(s), ${rep.summary.avertissement} avertissement(s), ${rep.summary.conseil} conseil(s)`,
    { size: body, color: INK, before: 2 },
  );
  for (const n of rep.notes ?? []) push(`Remarque : ${n}`, { size: small, color: MUTED });
  for (const e of model.errors)
    push(`Erreur de génération : ${e}`, { size: small, color: SEVERITY_COLOR.bloquant });

  const results = rep.results;
  const block = (r: RuleResult, color: Rgb, detailed: boolean): void => {
    push(`${r.ruleId} — ${r.description}`, {
      size: body,
      bold: true,
      color,
      indent: 2,
      before: 1.5,
    });
    if (r.message !== "") push(r.message, { size: body, color: INK, indent: 4 });
    const m = measuredText(r);
    if (detailed && m !== undefined) push(m, { size: small, color: INK, indent: 4 });
    if (r.downgradeReason !== undefined) {
      push(`Sévérité déclarée ${r.declaredSeverity}, rétrogradée : ${r.downgradeReason}`, {
        size: small,
        color: MUTED,
        indent: 4,
      });
    }
    push(provenance(r), { size: small, color: MUTED, indent: 4 });
  };
  for (const s of ["bloquant", "avertissement", "conseil"] as const) {
    const group = results.filter((r) => r.status === "violation" && r.severity === s);
    if (group.length === 0) continue;
    push(`${SEVERITY_TITLES[s]} (${group.length})`, {
      size: 3.6,
      bold: true,
      color: INK,
      before: 4,
    });
    for (const r of group) block(r, SEVERITY_COLOR[s], true);
  }
  const pending = results.filter((r) => r.status === "non-evaluee");
  if (pending.length > 0) {
    push(`Règles non évaluées (${pending.length})`, {
      size: 3.6,
      bold: true,
      color: INK,
      before: 4,
    });
    for (const r of pending) block(r, MUTED, false);
  }
  const ok = results.filter((r) => r.status === "ok");
  if (ok.length > 0) {
    push(`Règles respectées (${ok.length})`, { size: 3.6, bold: true, color: INK, before: 4 });
    for (const r of ok) {
      const m = measuredText(r);
      push(`${r.ruleId} — ${r.description}${m !== undefined ? ` (${m})` : ""}`, {
        size: small,
        color: INK,
        indent: 2,
      });
      push(provenance(r), { size: 2.2, color: MUTED, indent: 4 });
    }
  }
  if (results.length === 0) push("Aucune règle évaluée.", { size: body, color: MUTED, before: 2 });
  return out;
}

const lineHeight = (l: Line): number => l.size * 1.35 + (l.before ?? 0);

/** Hauteur réservée à l'avertissement rappelé en tête des pages de suite, mm. */
const REPEATED_DISCLAIMER_H = 3.4 * 1.35;

function compliancePages(c: PdfCanvas, model: Model, frame: Frame): PageSpec[] {
  const lines = complianceLines(model, c, frame.w);
  const chunks: Line[][] = [[]];
  let used = 0;
  for (const l of lines) {
    const h = lineHeight(l);
    if (used + h > frame.h && chunks[chunks.length - 1]!.length > 0) {
      chunks.push([]);
      // Pages de suite : l'avertissement rappelé en tête occupe sa hauteur.
      used = REPEATED_DISCLAIMER_H;
    }
    chunks[chunks.length - 1]!.push(l);
    used += h;
  }
  return chunks.map((chunk, i) => ({
    kind: "compliance" as const,
    title:
      chunks.length > 1
        ? `Contrôle de conception (${i + 1}/${chunks.length})`
        : "Contrôle de conception",
    draw(cv, f) {
      let y = f.y;
      // L'avertissement est rappelé en tête de chaque page de suite.
      if (i > 0) {
        y += REPEATED_DISCLAIMER_H;
        cv.text(COMPLIANCE_DISCLAIMER, f.x, y - 1, {
          size: 2.6,
          bold: true,
          color: SEVERITY_COLOR.bloquant,
        });
      }
      for (const l of chunk) {
        y += lineHeight(l);
        cv.text(l.text, f.x + (l.indent ?? 0), y - l.size * 0.35, {
          size: l.size,
          color: l.color ?? INK,
          ...(l.bold ? { bold: true } : {}),
        });
      }
    },
  }));
}

// ------------------------------------------------------------------ assemblage

/** Développés distincts (un par repère et développé identiques), dans l'ordre des pièces. */
function flatGroups(parts: readonly Part[]): { part: Part; ids: string[] }[] {
  const groups = new Map<string, { part: Part; ids: string[] }>();
  for (const p of parts) {
    if (p.flat === undefined || p.flat.outline.outer.length < 3) continue;
    const key = JSON.stringify([p.mark, p.material, p.flat]);
    const g = groups.get(key);
    if (g) g.ids.push(p.id);
    else groups.set(key, { part: p, ids: [p.id] });
  }
  return [...groups.values()];
}

/**
 * Met en page le dossier sur une surface quelconque (la première page existe déjà) et
 * renvoie la liste des pages produites.
 */
export function renderPdf(
  c: PdfCanvas,
  model: Model,
  options: PdfLayoutOptions = {},
): PdfPageInfo[] {
  const project = options.project;
  const name = options.title ?? project?.name ?? "Escalier";
  const frame = contentFrame(c);
  const scales = options.scales ?? STANDARD_SCALES;
  const show: Required<PdfPages> = {
    plan: true,
    elevation: true,
    bom: true,
    compliance: true,
    flats: true,
    ...options.pages,
  };
  // Corps des textes des dessins : px CSS (96 dpi) → mm papier.
  const fontPx = ((options.drawingTextMm ?? 2.4) * 96) / 25.4;
  const common = {
    theme: "light" as const,
    fontSize: fontPx,
    margin: 8,
    ...(project !== undefined ? { project } : {}),
  };

  const pages: PageSpec[] = [];
  if (show.plan) {
    pages.push(
      drawingPage(
        "plan",
        "Plan coté",
        (n) =>
          renderPlanSvg(model, {
            ...common,
            scale: n,
            background: false,
            title: name,
            ...(options.decimals !== undefined ? { decimals: options.decimals } : {}),
          }),
        frame,
        scales,
        options.planScale,
      ),
    );
  }
  if (show.elevation) {
    pages.push(
      drawingPage(
        "elevation",
        "Élévation développée",
        (n) => renderElevationSvg(model, { ...common, scale: n, background: false, title: name }),
        frame,
        scales,
        options.elevationScale,
      ),
    );
  }
  if (show.bom) pages.push(...bomPages(model.parts, frame));
  if (show.compliance) pages.push(...compliancePages(c, model, frame));
  if (show.flats) {
    for (const { part, ids } of flatGroups(model.parts)) {
      const qty = ids.length > 1 ? ` (${ids.length} pièces identiques)` : "";
      pages.push(
        drawingPage(
          "flat",
          `Développé ${part.mark} — ${part.name}${qty}`,
          (n) =>
            renderFlatPatternSvg(part, {
              theme: "light",
              fontSize: fontPx,
              margin: 8,
              scale: n,
              background: false,
              ...(options.decimals !== undefined ? { decimals: options.decimals } : {}),
            }),
          frame,
          scales,
          options.flatScale,
          { partIds: ids },
        ),
      );
    }
  }

  const date = dateText(options.date);
  pages.forEach((p, i) => {
    if (i > 0) c.addPage();
    drawHeader(c, p.title);
    p.draw(c, frame);
    drawTitleBlock(c, {
      project: name,
      page: p.title,
      scale: p.scale !== undefined ? `1:${fr(p.scale)}` : "—",
      date,
      index: i + 1,
      total: pages.length,
    });
  });
  return pages.map(({ draw: _draw, ...info }) => info);
}

/** Dossier PDF du modèle (octets). Sortie déterministe (date de création fixe, sauf `date`). */
export function exportPdf(model: Model, options: PdfOptions = {}): Uint8Array {
  const name = options.title ?? options.project?.name ?? "Escalier";
  const canvas = new JsPdfCanvas({
    format: options.format ?? "a4",
    orientation: "landscape",
    ...(options.compress !== undefined ? { compress: options.compress } : {}),
    ...(options.date instanceof Date && !Number.isNaN(options.date.getTime())
      ? { creationDate: options.date }
      : {}),
    title: name,
    subject: "Dossier d'escalier (Blondel)",
  });
  renderPdf(canvas, model, options);
  return canvas.output();
}
