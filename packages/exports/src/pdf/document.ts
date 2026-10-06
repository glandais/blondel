/**
 * Dossier PDF complet (SPEC §3 « PDF coté », D §3.4, CHALLENGE P7) :
 *
 * 1. sommaire ;
 * 2. plan coté (`renderPlanSvg`) et élévation développée (`renderElevationSvg`) ;
 * 3. fiche de pose : plan d'implantation, cotes aux nus des murs et à la trémie, diagonales,
 *    hauteurs, épure des nez au sol ;
 * 4. nomenclature (repère, désignation, matériau, section, débit, quantité, masse) ;
 * 5. fiche de débit (pièces par matériau et épaisseur, longueurs, volumes et masses cumulés) ;
 * 6. contrôle de conception (avertissement « indicatif », résultats groupés, provenance) ;
 * 6 bis. valeurs à valider (valeurs par défaut non sourcées, validées et restantes ; ADR-0009
 *    point 9), si l'appelant les fournit ;
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
import { cutListRows, defaultMassNote, massNoteFor, type MassNote } from "../csv/cutlist.js";
import { cutSheet } from "../cutsheet.js";
import { formatIn } from "../format.js";
import {
  localeOption,
  materialLabel,
  translatorOf,
  tr,
  type LocaleOption,
  type Translator,
} from "../i18n.js";
import { renderElevationSvg } from "../svg/elevation.js";
import { renderFlatPatternSvg } from "../svg/flat.js";
import { renderPlanSvg } from "../svg/plan.js";
import { templateFamily, type TemplateFamily } from "../templateFamily.js";
import { JsPdfCanvas, type PdfCanvas } from "./canvas.js";
import { compliancePages } from "./compliance.js";
import { installationPages } from "./installation.js";
import { toValidatePages, type PdfToValidateRow } from "./toValidate.js";
import {
  MUTED,
  contentFrame,
  dateText,
  drawHeader,
  drawTitleBlock,
  fr,
  pagedTitle,
  tablePages,
  type Frame,
  type PageDraft,
  type TableRow,
  type TitlePart,
} from "./layout.js";
import { drawSvg, parseSvg, svgSize } from "./svg-draw.js";
import { DEFAULT_TILE_OVERLAP, templatePages, type TileInfo } from "./tiles.js";

export { complianceDisclaimer, complianceLines } from "./compliance.js";
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
  /** Valeurs à valider (seulement si `PdfLayoutOptions.toValidate` est fourni). */
  readonly toValidate?: boolean;
  readonly flats?: boolean;
  /** Gabarits 1:1 tuilés des développés. */
  readonly templates?: boolean;
}

export interface PdfLayoutOptions extends LocaleOption {
  /** Projet source : nom (cartouche), trémie, murs et plancher haut (plan, élévation, pose). */
  readonly project?: Project;
  /** Nom affiché dans le cartouche (défaut : `project.name`, sinon « Escalier »). */
  readonly title?: string;
  /**
   * Date du cartouche : texte libre ou `Date` (au format de la langue : JJ/MM/AAAA en
   * français, AAAA-MM-JJ en anglais). Absente : « — ». Jamais
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
  /**
   * Familles de pièces dont les gabarits 1:1 sont tuilés (QUESTIONS A20 : limons et structure,
   * marches, garde-corps ; `templateFamily`). Absent : toutes (dossier complet). Les autres
   * pages, développés à l'échelle compris, ne sont pas filtrées.
   */
  readonly templateFamilies?: readonly TemplateFamily[];
  /**
   * Remarque de masse par matériau (nomenclature, fiche de débit). Défaut : `massNoteFor` du
   * profil d'atelier du projet (bois non renseigné par l'atelier : « masse volumique à
   * valider »), sans projet `defaultMassNote`.
   */
  readonly massNote?: MassNote;
  /**
   * Valeurs par défaut à valider par l'atelier (ADR-0009 point 9), validées et restantes,
   * préparées par l'appelant. Absent : aucune page « Valeurs à valider ». Les valeurs restantes
   * ne bloquent jamais la génération.
   */
  readonly toValidate?: readonly PdfToValidateRow[];
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
  | "toValidate"
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
  t: Translator,
): { n: number; svg: string; note?: string } {
  const fits = (svg: string): boolean => {
    const s = svgSize(parseSvg(svg));
    return (s.widthMm ?? Infinity) <= frame.w + 1e-6 && (s.heightMm ?? Infinity) <= frame.h + 1e-6;
  };
  if (forced !== undefined) {
    if (!(forced > 0) || !Number.isFinite(forced)) {
      throw new RangeError(t.t("pdf.scale.invalid", { scale: String(forced) }));
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
        : { n, svg, note: t.t("pdf.scale.forcedTooLarge", { scale: fr(t, forced) }) };
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
  return { n, svg, note: t.t("pdf.scale.nonStandard") };
}

function drawingPage(
  kind: "plan" | "elevation" | "flat",
  title: string,
  render: (n: number) => string,
  frame: Frame,
  scales: readonly number[],
  forced: number | undefined,
  t: Translator,
  extra: Partial<PdfPageInfo> = {},
  part?: TitlePart,
): PageSpec {
  const chosen = chooseScale(render, frame, scales, forced, t);
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
        c.text(t.t("pdf.scale.note", { note: chosen.note }), f.x, f.y + f.h + 2, {
          size: 2.4,
          color: MUTED,
        });
      }
    },
  };
}

// ------------------------------------------------------------------ nomenclature, débit

const dims = (tx: Translator, l?: number, w?: number, e?: number): string =>
  l !== undefined && w !== undefined && e !== undefined
    ? `${fr(tx, l, 1)} × ${fr(tx, w, 1)} × ${fr(tx, e, 1)}`
    : "—";

/**
 * Renvois des remarques de masse : un astérisque par remarque distincte (« * », « ** »…),
 * dans l'ordre d'apparition ; lignes d'explication pour l'introduction du tableau.
 */
function massNoteMarks(notes: Iterable<string | undefined>): {
  mark: (note: string | undefined) => string;
  legend: string[];
} {
  const order: string[] = [];
  for (const n of notes) if (n !== undefined && !order.includes(n)) order.push(n);
  return {
    mark: (n) => (n === undefined ? "" : ` ${"*".repeat(order.indexOf(n) + 1)}`),
    legend: order.map((n, i) => `${"*".repeat(i + 1)} ${n}.`),
  };
}

function bomPages(
  parts: readonly Part[],
  frame: Frame,
  massNote: MassNote,
  t: Translator,
): PageSpec[] {
  const rows = cutListRows(parts, { ...localeOption(t), massNote });
  const total = rows.reduce((s, r) => s + r.quantity, 0);
  const notes = massNoteMarks(rows.map((r) => r.massNote));
  let mass: number | undefined = rows.length > 0 ? 0 : undefined;
  for (const r of rows) {
    mass =
      mass === undefined || r.unitMass === undefined ? undefined : mass + r.unitMass * r.quantity;
  }
  const draws = tablePages(
    {
      columns: [
        { title: t.t("pdf.bom.col.mark"), weight: 12, align: "left" },
        { title: t.t("pdf.bom.col.designation"), weight: 44, align: "left" },
        { title: t.t("pdf.bom.col.material"), weight: 18, align: "left" },
        { title: t.t("pdf.bom.col.section"), weight: 20, align: "left" },
        { title: t.t("pdf.bom.col.stock"), weight: 30, align: "right" },
        { title: t.t("pdf.bom.col.quantity"), weight: 8, align: "right" },
        { title: t.t("pdf.bom.col.mass"), weight: 14, align: "right" },
      ],
      rows: rows.map((r) => ({
        cells: [
          r.mark,
          r.name,
          r.material,
          r.section,
          dims(t, r.length, r.width, r.thickness),
          String(r.quantity),
          r.unitMass !== undefined
            ? `${dec(t, r.unitMass * r.quantity, 1)}${notes.mark(r.massNote)}`
            : "—",
        ],
      })),
      footer:
        rows.length > 0
          ? [
              {
                cells: [
                  t.t("pdf.common.total"),
                  "",
                  "",
                  "",
                  "",
                  String(total),
                  mass !== undefined ? dec(t, mass, 1) : t.t("pdf.common.incomplete"),
                ],
              },
            ]
          : [],
      empty: t.t("pdf.common.noParts"),
      ...(notes.legend.length > 0
        ? { intro: [t.t("pdf.bom.intro", { legend: notes.legend.join(" ") })] }
        : {}),
    },
    frame,
  );
  const title = t.t("pdf.bom.title");
  return draws.map((draw, i) => ({
    info: { kind: "bom", title: pagedTitle(t, title, i + 1, draws.length) },
    tocTitle: title,
    draw,
  }));
}

const dec = (t: Translator, v: number, d: number): string => formatIn(t, v, { decimals: d });

function cutSheetPages(
  parts: readonly Part[],
  frame: Frame,
  massNote: MassNote,
  t: Translator,
): PageSpec[] {
  const groups = cutSheet(parts, { ...localeOption(t), massNote });
  const notes = massNoteMarks(groups.flatMap((g) => g.rows.map((r) => r.massNote)));
  const rows: TableRow[] = [];
  for (const g of groups) {
    rows.push({
      heading: true,
      cells: [
        g.thickness !== undefined
          ? t.t("pdf.cutsheet.group.thickness", {
              material: g.materialLabel,
              thickness: fr(t, g.thickness, 1),
            })
          : g.section !== undefined && g.section !== ""
            ? t.t("pdf.cutsheet.group.section", { material: g.materialLabel, section: g.section })
            : t.t("pdf.cutsheet.group.noStock", { material: g.materialLabel }),
      ],
    });
    for (const r of g.rows) {
      rows.push({
        cells: [
          r.mark,
          r.name,
          r.section,
          dims(t, r.length, r.width, r.thickness),
          r.source === "stock"
            ? t.t("pdf.cutsheet.source.stock")
            : r.source === "flat"
              ? t.t("pdf.cutsheet.source.flat")
              : "—",
          String(r.quantity),
          r.length !== undefined ? dec(t, (r.length * r.quantity) / 1000, 2) : "—",
          r.unitMass !== undefined
            ? `${dec(t, r.unitMass * r.quantity, 1)}${notes.mark(r.massNote)}`
            : "—",
        ],
      });
    }
    const tot = g.totals;
    rows.push({
      bold: true,
      cells: [
        t.t("pdf.common.total"),
        tot.volumeM3 !== undefined
          ? t.t("pdf.cutsheet.volume", { volume: dec(t, tot.volumeM3, 3) })
          : g.basis === "section"
            ? ""
            : t.t("pdf.cutsheet.volumeIncomplete"),
        "",
        "",
        "",
        String(tot.quantity),
        dec(t, tot.lengthM, 2),
        tot.massKg !== undefined
          ? `${dec(t, tot.massKg, 1)}${tot.massNotes.map((n) => notes.mark(n)).join("")}`
          : t.t("pdf.common.incomplete"),
      ],
    });
  }
  const draws = tablePages(
    {
      columns: [
        { title: t.t("pdf.cutsheet.col.mark"), weight: 10, align: "left" },
        { title: t.t("pdf.cutsheet.col.designation"), weight: 44, align: "left" },
        { title: t.t("pdf.cutsheet.col.section"), weight: 16, align: "left" },
        { title: t.t("pdf.cutsheet.col.dims"), weight: 28, align: "right" },
        { title: t.t("pdf.cutsheet.col.source"), weight: 12, align: "left" },
        { title: t.t("pdf.cutsheet.col.quantity"), weight: 7, align: "right" },
        { title: t.t("pdf.cutsheet.col.length"), weight: 14, align: "right" },
        { title: t.t("pdf.cutsheet.col.mass"), weight: 12, align: "right" },
      ],
      rows,
      empty: t.t("pdf.common.noParts"),
      intro: [
        t.t("pdf.cutsheet.intro.grouping"),
        t.t("pdf.cutsheet.intro.masses") +
          (notes.legend.length > 0 ? ` ${notes.legend.join(" ")}` : ""),
      ],
    },
    frame,
  );
  const title = t.t("pdf.cutsheet.title");
  return draws.map((draw, i) => ({
    info: { kind: "cutsheet", title: pagedTitle(t, title, i + 1, draws.length) },
    tocTitle: title,
    draw,
  }));
}

// ------------------------------------------------------------------ sommaire

interface TocEntry {
  readonly title: string;
  readonly from: number;
  readonly to: number;
}

/**
 * Entrées du sommaire : pages consécutives d'une même section regroupées. Le titre d'entrée
 * d'une page est son `tocTitle` (sections paginées, gabarits), sinon son titre.
 */
function tocEntries(pages: readonly PageSpec[], offset: number): TocEntry[] {
  const out: TocEntry[] = [];
  let key = "";
  let partKey = "";
  pages.forEach((p, i) => {
    const s = p.tocTitle ?? p.info.title;
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
  t: Translator,
): PageSpec[] {
  const spec = (entries: readonly TocEntry[]) => ({
    columns: [
      { title: t.t("pdf.toc.col.document"), weight: 80, align: "left" as const },
      { title: t.t("pdf.toc.col.pages"), weight: 14, align: "right" as const },
    ],
    rows: entries.map((e) => ({
      cells: [
        e.title,
        e.from === e.to
          ? String(e.from)
          : t.t("pdf.toc.range", { from: String(e.from), to: String(e.to) }),
      ],
    })),
    empty: t.t("pdf.toc.empty"),
    intro: [
      t.t("pdf.toc.intro.project", { name, date }),
      t.t("pdf.toc.intro.templates"),
      t.t("pdf.toc.intro.installation"),
    ],
  });
  // Nombre de pages du sommaire : il ne dépend que du nombre d'entrées.
  const count = tablePages(spec(tocEntries(pages, 0)), frame).length;
  const draws = tablePages(spec(tocEntries(pages, count)), frame);
  return draws.map((draw, i) => ({
    info: {
      kind: "toc",
      title: pagedTitle(t, t.t("pdf.toc.title"), i + 1, draws.length),
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

function titlePart(part: Part, t: Translator): TitlePart {
  const thickness = part.flat?.thickness ?? part.stock?.thickness;
  return {
    mark: part.mark,
    material: materialLabel(t, part.material),
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
  const t = translatorOf(options);
  const project = options.project;
  const name = options.title ?? project?.name ?? t.t("export.common.defaultName");
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
    toValidate: true,
    flats: true,
    templates: true,
    ...options.pages,
  };
  // Corps des textes des dessins : px CSS (96 dpi) → mm papier.
  const fontPx = ((options.drawingTextMm ?? 2.4) * 96) / 25.4;
  const common = {
    ...localeOption(t),
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
        t.t("pdf.plan.title"),
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
        t,
      ),
    );
  }
  if (show.elevation) {
    pages.push(
      drawingPage(
        "elevation",
        t.t("pdf.elevation.title"),
        (n) => renderElevationSvg(model, { ...common, scale: n, background: false, title: name }),
        frame,
        scales,
        options.elevationScale,
        t,
      ),
    );
  }
  if (show.installation) pages.push(...installationPages(c, model, project, frame, scales, t));
  const massNote =
    options.massNote ?? (project !== undefined ? massNoteFor(project.workshop) : defaultMassNote);
  if (show.bom) pages.push(...bomPages(model.parts, frame, massNote, t));
  if (show.cutsheet) pages.push(...cutSheetPages(model.parts, frame, massNote, t));
  if (show.compliance)
    pages.push(...compliancePages(c, model, frame, project?.compliance.overrides ?? [], t));
  if (show.toValidate && options.toValidate !== undefined) {
    pages.push(
      ...toValidatePages(options.toValidate, frame, t, (title) => ({
        kind: "toValidate" as const,
        title,
      })),
    );
  }
  const groups = show.flats || show.templates ? flatGroups(model.parts) : [];
  if (show.flats) {
    for (const { part, ids } of groups) {
      const title = t.t("pdf.flat.title", { mark: part.mark, name: tr(t, part.name) });
      pages.push(
        drawingPage(
          "flat",
          ids.length > 1
            ? t.t("pdf.flat.withQuantity", { title, count: String(ids.length) })
            : title,
          (n) =>
            renderFlatPatternSvg(part, {
              ...localeOption(t),
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
          t,
          { partIds: ids },
          titlePart(part, t),
        ),
      );
    }
  }
  if (show.templates) {
    const families = options.templateFamilies ? new Set(options.templateFamilies) : null;
    for (const { part, ids } of groups) {
      if (families && !families.has(templateFamily(part))) continue;
      pages.push(
        ...templatePages(c, part, ids, frame, {
          ...localeOption(t),
          fontPx,
          overlap: options.tileOverlap ?? DEFAULT_TILE_OVERLAP,
          ...decimals,
        }),
      );
    }
  }

  const date = dateText(options.date, t);
  const all = show.toc ? [...tocPages(pages, frame, name, date, t), ...pages] : pages;
  all.forEach((p, i) => {
    if (i > 0) c.addPage();
    const reserved = p.headerRight ? p.headerRight(c) : 0;
    drawHeader(c, p.info.title, reserved);
    p.draw(c, frame);
    drawTitleBlock(
      c,
      {
        project: name,
        page: p.info.title,
        scale: p.info.scale !== undefined ? `1:${fr(t, p.info.scale)}` : "—",
        date,
        index: i + 1,
        total: all.length,
        ...(p.part ? { part: p.part } : {}),
      },
      t,
    );
  });
  return all.map((p) => p.info);
}

/** Dossier PDF et description de ses pages (mise en page avec la métrique réelle de jsPDF). */
export function exportPdfDocument(
  model: Model,
  options: PdfOptions = {},
): { bytes: Uint8Array; pages: PdfPageInfo[] } {
  const t = translatorOf(options);
  const name = options.title ?? options.project?.name ?? t.t("export.common.defaultName");
  const canvas = new JsPdfCanvas({
    format: options.format ?? "a4",
    orientation: "landscape",
    ...(options.compress !== undefined ? { compress: options.compress } : {}),
    ...(options.date instanceof Date && !Number.isNaN(options.date.getTime())
      ? { creationDate: options.date }
      : {}),
    title: name,
    subject: t.t("pdf.document.subject"),
  });
  const pages = renderPdf(canvas, model, options);
  return { bytes: canvas.output(), pages };
}

/** Dossier PDF du modèle (octets). Sortie déterministe (date de création fixe, sauf `date`). */
export function exportPdf(model: Model, options: PdfOptions = {}): Uint8Array {
  return exportPdfDocument(model, options).bytes;
}
