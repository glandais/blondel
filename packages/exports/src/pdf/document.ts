/**
 * Dossier PDF complet (SPEC §3 « PDF coté », D §3.4, CHALLENGE P7) :
 *
 * 1. sommaire ;
 * 2. plan coté (`renderPlanSvg`) et élévation développée (`renderElevationSvg`) ;
 * 3. fiche de pose : plan d'implantation, cotes aux nus des murs et à la trémie, diagonales,
 *    hauteurs, épure des nez au sol ;
 * 4. nomenclature (repère, désignation, matériau, section, débit, quantité) ;
 * 5. fiche de débit (pièces par matériau et épaisseur, longueurs, volumes et masses cumulés) ;
 * 6. contrôle de conception (avertissement « indicatif », résultats groupés, provenance) ;
 * 7. une planche par développé distinct, à l'échelle normalisée qui tient dans la page ;
 * 8. gabarits 1:1 des développés, tuilés sur plusieurs pages (A4 ou A3) avec repères
 *    d'assemblage et règle de contrôle de 100 mm.
 *
 * Chaque page porte un cartouche (projet, document, échelle, date, repère, matériau,
 * épaisseur, pagination). Les dessins sont posés à une échelle normalisée 1:n (la plus grande
 * qui tient dans le cadre), jamais « ajustés » sans le dire : l'échelle imprimée est l'échelle
 * réelle.
 *
 * Mise en page écrite sur l'abstraction `PdfCanvas` (tests : `RecordingCanvas`) ;
 * `exportPdf` la réalise avec jsPDF.
 */
import type { Model, Part, Project } from "@blondel/core";
import { MATERIAL_LABELS, cutListRows } from "../csv/cutlist.js";
import { cutSheet } from "../cutsheet.js";
import { formatFr } from "../format.js";
import { renderElevationSvg } from "../svg/elevation.js";
import { renderFlatPatternSvg } from "../svg/flat.js";
import { renderPlanSvg } from "../svg/plan.js";
import { JsPdfCanvas, type PdfCanvas } from "./canvas.js";
import { compliancePages } from "./compliance.js";
import { installationPages } from "./installation.js";
import {
  MUTED,
  contentFrame,
  dateText,
  drawHeader,
  drawTitleBlock,
  fr,
  tablePages,
  type Frame,
  type PageDraft,
  type TableRow,
  type TitlePart,
} from "./layout.js";
import { drawSvg, parseSvg, svgSize } from "./svg-draw.js";
import { DEFAULT_TILE_OVERLAP, templatePages, type TileInfo } from "./tiles.js";

export { COMPLIANCE_DISCLAIMER, complianceLines } from "./compliance.js";
export { wrapText } from "./layout.js";

/** Échelles normalisées essayées, de la plus grande (1:1) à la plus petite. */
export const STANDARD_SCALES: readonly number[] = [1, 2, 5, 10, 20, 25, 50, 75, 100, 200, 500];

export interface PdfPages {
  readonly toc?: boolean;
  readonly plan?: boolean;
  readonly elevation?: boolean;
  readonly installation?: boolean;
  readonly bom?: boolean;
  readonly cutsheet?: boolean;
  readonly compliance?: boolean;
  readonly flats?: boolean;
  /** Gabarits 1:1 tuilés des développés. */
  readonly templates?: boolean;
}

export interface PdfLayoutOptions {
  /** Projet source : nom (cartouche), trémie, murs et plancher haut (plan, élévation, pose). */
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
  /** Pages produites (toutes par défaut ; une clé absente vaut vrai). */
  readonly pages?: PdfPages;
  /** Corps des textes des dessins, mm papier (défaut 2,4). */
  readonly drawingTextMm?: number;
  /** Décimales des cotes (défaut : celles des rendus SVG). */
  readonly decimals?: number;
  /** Recouvrement entre cases des gabarits 1:1, mm (défaut 10). */
  readonly tileOverlap?: number;
}

export interface PdfOptions extends PdfLayoutOptions {
  /** Format de page, paysage (défaut A4) ; les gabarits 1:1 sont tuilés à ce format. */
  readonly format?: "a4" | "a3";
  /** Compression des flux (défaut : vrai ; faux pour inspecter le fichier). */
  readonly compress?: boolean;
}

export type PdfPageKind =
  | "toc"
  | "plan"
  | "elevation"
  | "installation"
  | "bom"
  | "cutsheet"
  | "compliance"
  | "flat"
  | "template";

/** Résumé d'une page produite (tests, sommaire). */
export interface PdfPageInfo {
  readonly kind: PdfPageKind;
  readonly title: string;
  /** Échelle 1:n du dessin (absent : page de texte). */
  readonly scale?: number;
  /** Échelle imposée non tenue (dessin trop grand) : échelle retenue à la place. */
  readonly scaleNote?: string;
  readonly partIds?: readonly string[];
  /** Gabarit 1:1 : case de la grille. */
  readonly tile?: TileInfo;
}

type PageSpec = PageDraft<PdfPageInfo>;

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
  part?: TitlePart,
): PageSpec {
  const chosen = chooseScale(render, frame, scales, forced);
  const svg = parseSvg(chosen.svg);
  return {
    info: {
      kind,
      title,
      scale: chosen.n,
      ...(chosen.note !== undefined ? { scaleNote: chosen.note } : {}),
      ...extra,
    },
    ...(part ? { part } : {}),
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

// ------------------------------------------------------------------ nomenclature, débit

const dims = (l?: number, w?: number, t?: number): string =>
  l !== undefined && w !== undefined && t !== undefined
    ? `${fr(l, 1)} × ${fr(w, 1)} × ${fr(t, 1)}`
    : "—";

function bomPages(parts: readonly Part[], frame: Frame): PageSpec[] {
  const rows = cutListRows(parts);
  const total = rows.reduce((s, r) => s + r.quantity, 0);
  const draws = tablePages(
    {
      columns: [
        { title: "Repère", weight: 12, align: "left" },
        { title: "Désignation", weight: 48, align: "left" },
        { title: "Matériau", weight: 20, align: "left" },
        { title: "Section", weight: 22, align: "left" },
        { title: "Débit L × l × e (mm)", weight: 32, align: "right" },
        { title: "Qté", weight: 8, align: "right" },
      ],
      rows: rows.map((r) => ({
        cells: [
          r.mark,
          r.name,
          r.material,
          r.section,
          dims(r.length, r.width, r.thickness),
          String(r.quantity),
        ],
      })),
      footer: rows.length > 0 ? [{ cells: ["Total", "", "", "", "", String(total)] }] : [],
      empty: "Aucune pièce générée.",
    },
    frame,
  );
  return draws.map((draw, i) => ({
    info: {
      kind: "bom",
      title: draws.length > 1 ? `Nomenclature (${i + 1}/${draws.length})` : "Nomenclature",
    },
    draw,
  }));
}

const dec = (v: number, d: number): string => formatFr(v, { decimals: d });

function cutSheetPages(parts: readonly Part[], frame: Frame): PageSpec[] {
  const groups = cutSheet(parts);
  const rows: TableRow[] = [];
  for (const g of groups) {
    rows.push({
      heading: true,
      cells: [
        g.thickness !== undefined
          ? `${g.materialLabel} — épaisseur ${fr(g.thickness, 1)} mm`
          : `${g.materialLabel} — ${g.section !== undefined && g.section !== "" ? `section ${g.section}` : "sans débit"}`,
      ],
    });
    for (const r of g.rows) {
      rows.push({
        cells: [
          r.mark,
          r.name,
          r.section,
          dims(r.length, r.width, r.thickness),
          r.source === "stock" ? "débit" : r.source === "flat" ? "développé" : "—",
          String(r.quantity),
          r.length !== undefined ? dec((r.length * r.quantity) / 1000, 2) : "—",
          r.unitMass !== undefined ? dec(r.unitMass * r.quantity, 1) : "—",
        ],
      });
    }
    const t = g.totals;
    rows.push({
      bold: true,
      cells: [
        "Total",
        t.volumeM3 !== undefined
          ? `volume brut ${dec(t.volumeM3, 3)} m³`
          : g.basis === "section"
            ? ""
            : "volume brut incomplet",
        "",
        "",
        "",
        String(t.quantity),
        dec(t.lengthM, 2),
        t.massKg !== undefined ? dec(t.massKg, 1) : "incomplet",
      ],
    });
  }
  const draws = tablePages(
    {
      columns: [
        { title: "Repère", weight: 10, align: "left" },
        { title: "Désignation", weight: 44, align: "left" },
        { title: "Section", weight: 16, align: "left" },
        { title: "L × l × e (mm)", weight: 28, align: "right" },
        { title: "Origine", weight: 12, align: "left" },
        { title: "Qté", weight: 7, align: "right" },
        { title: "Long. tot. (m)", weight: 14, align: "right" },
        { title: "Masse (kg)", weight: 12, align: "right" },
      ],
      rows,
      empty: "Aucune pièce générée.",
      intro: [
        "Pièces groupées par matériau et épaisseur (plaques, plateaux) ou section (profilés, tubes). Origine : débit brut du cœur (surcotes comprises) ou emprise du développé (flan).",
        "Masses : seulement celles fournies par le modèle ; un total est « incomplet » si une masse manque.",
      ],
    },
    frame,
  );
  return draws.map((draw, i) => ({
    info: {
      kind: "cutsheet",
      title: draws.length > 1 ? `Fiche de débit (${i + 1}/${draws.length})` : "Fiche de débit",
    },
    draw,
  }));
}

// ------------------------------------------------------------------ sommaire

interface TocEntry {
  readonly title: string;
  readonly from: number;
  readonly to: number;
}

/** Entrées du sommaire : pages consécutives d'une même section regroupées. */
function tocEntries(pages: readonly PageSpec[], offset: number): TocEntry[] {
  const out: TocEntry[] = [];
  const sectionOf = (p: PdfPageInfo): string => {
    switch (p.kind) {
      case "installation":
        return "Fiche de pose";
      case "bom":
        return "Nomenclature";
      case "cutsheet":
        return "Fiche de débit";
      case "compliance":
        return "Contrôle de conception";
      case "template": {
        const t = p.tile!;
        const base = p.title.replace(/ — case .*$/, "").replace(/ \(\d+ pièces\)$/, "");
        return t.rows * t.cols > 1
          ? `${base} : ${t.count} case(s), grille ${t.rows} × ${t.cols}`
          : base;
      }
      default:
        return p.title;
    }
  };
  let key = "";
  let partKey = "";
  pages.forEach((p, i) => {
    const s = sectionOf(p.info);
    const pk = p.info.partIds?.join(",") ?? "";
    const last = out[out.length - 1];
    if (last && s === key && pk === partKey) {
      out[out.length - 1] = { ...last, to: i + 1 + offset };
    } else out.push({ title: s, from: i + 1 + offset, to: i + 1 + offset });
    key = s;
    partKey = pk;
  });
  return out;
}

function tocPages(
  pages: readonly PageSpec[],
  frame: Frame,
  name: string,
  date: string,
): PageSpec[] {
  const spec = (entries: readonly TocEntry[]) => ({
    columns: [
      { title: "Document", weight: 80, align: "left" as const },
      { title: "Pages", weight: 14, align: "right" as const },
    ],
    rows: entries.map((e) => ({
      cells: [e.title, e.from === e.to ? String(e.from) : `${e.from} à ${e.to}`],
    })),
    empty: "Aucune page.",
    intro: [
      `Projet : ${name} — date : ${date}.`,
      "Gabarits 1:1 : imprimer à 100 % (sans « ajuster à la page ») et vérifier la règle de contrôle de 100 mm de chaque page.",
      "Les cotes d'implantation de la fiche de pose sont données dans le repère du relevé (murs, trémie).",
    ],
  });
  // Nombre de pages du sommaire : il ne dépend que du nombre d'entrées.
  const count = tablePages(spec(tocEntries(pages, 0)), frame).length;
  const draws = tablePages(spec(tocEntries(pages, count)), frame);
  return draws.map((draw, i) => ({
    info: {
      kind: "toc",
      title: draws.length > 1 ? `Sommaire (${i + 1}/${draws.length})` : "Sommaire",
    },
    draw,
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

function titlePart(part: Part): TitlePart {
  const thickness = part.flat?.thickness ?? part.stock?.thickness;
  return {
    mark: part.mark,
    material: MATERIAL_LABELS[part.material] ?? part.material,
    ...(thickness !== undefined ? { thickness } : {}),
  };
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
    toc: true,
    plan: true,
    elevation: true,
    installation: true,
    bom: true,
    cutsheet: true,
    compliance: true,
    flats: true,
    templates: true,
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
  const decimals = options.decimals !== undefined ? { decimals: options.decimals } : {};

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
            ...decimals,
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
  if (show.installation) pages.push(...installationPages(c, model, project, frame, scales));
  if (show.bom) pages.push(...bomPages(model.parts, frame));
  if (show.cutsheet) pages.push(...cutSheetPages(model.parts, frame));
  if (show.compliance) pages.push(...compliancePages(c, model, frame));
  const groups = show.flats || show.templates ? flatGroups(model.parts) : [];
  if (show.flats) {
    for (const { part, ids } of groups) {
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
              ...decimals,
            }),
          frame,
          scales,
          options.flatScale,
          { partIds: ids },
          titlePart(part),
        ),
      );
    }
  }
  if (show.templates) {
    for (const { part, ids } of groups) {
      pages.push(
        ...templatePages(c, part, ids, frame, {
          fontPx,
          overlap: options.tileOverlap ?? DEFAULT_TILE_OVERLAP,
          ...decimals,
        }),
      );
    }
  }

  const date = dateText(options.date);
  const all = show.toc ? [...tocPages(pages, frame, name, date), ...pages] : pages;
  all.forEach((p, i) => {
    if (i > 0) c.addPage();
    const reserved = p.headerRight ? p.headerRight(c) : 0;
    drawHeader(c, p.info.title, reserved);
    p.draw(c, frame);
    drawTitleBlock(c, {
      project: name,
      page: p.info.title,
      scale: p.info.scale !== undefined ? `1:${fr(p.info.scale)}` : "—",
      date,
      index: i + 1,
      total: all.length,
      ...(p.part ? { part: p.part } : {}),
    });
  });
  return all.map((p) => p.info);
}

/** Dossier PDF et description de ses pages (mise en page avec la métrique réelle de jsPDF). */
export function exportPdfDocument(
  model: Model,
  options: PdfOptions = {},
): { bytes: Uint8Array; pages: PdfPageInfo[] } {
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
  const pages = renderPdf(canvas, model, options);
  return { bytes: canvas.output(), pages };
}

/** Dossier PDF du modèle (octets). Sortie déterministe (date de création fixe, sauf `date`). */
export function exportPdf(model: Model, options: PdfOptions = {}): Uint8Array {
  return exportPdfDocument(model, options).bytes;
}
