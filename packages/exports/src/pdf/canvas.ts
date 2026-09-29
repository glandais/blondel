/**
 * Surface de dessin PDF abstraite (mm, origine en haut à gauche, Y vers le bas, comme le SVG).
 *
 * La mise en page (`renderPdf`) et l'interprète SVG (`drawSvg`) n'écrivent que dans cette
 * interface : les tests l'observent avec `RecordingCanvas` (opérations enregistrées), et
 * `JsPdfCanvas` la réalise avec jsPDF (fonctionne sous Node et dans le navigateur, sans DOM).
 *
 * Textes : polices standard PDF (Helvetica), encodage WinAnsi (cp1252) ; `toWinAnsi`
 * remplace les caractères hors de cet encodage (≥, ≤, −, espaces fines…).
 */
import { GState, jsPDF } from "jspdf";

export type Rgb = readonly [number, number, number];

export type PathOp =
  | { readonly op: "M"; readonly x: number; readonly y: number }
  | { readonly op: "L"; readonly x: number; readonly y: number }
  | {
      readonly op: "C";
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly op: "Z" };

export interface PaintStyle {
  /** Remplissage (absent : aucun). */
  readonly fill?: Rgb;
  readonly fillOpacity?: number;
  readonly fillRule?: "nonzero" | "evenodd";
  /** Trait (absent : aucun). */
  readonly stroke?: Rgb;
  readonly strokeOpacity?: number;
  /** Épaisseur du trait, mm. */
  readonly lineWidth?: number;
  /** Motif de pointillés, mm. */
  readonly dash?: readonly number[];
}

export interface TextStyle {
  /** Hauteur du corps, mm. */
  readonly size: number;
  readonly color?: Rgb;
  readonly bold?: boolean;
  /** Rotation en degrés, sens trigonométrique **à l'écran** (vers le haut de la page). */
  readonly angle?: number;
  readonly opacity?: number;
}

export interface PdfCanvas {
  /** Dimensions de la page, mm. */
  readonly pageWidth: number;
  readonly pageHeight: number;
  /** Nouvelle page (la première page existe dès la création). */
  addPage(): void;
  path(ops: readonly PathOp[], style: PaintStyle): void;
  /** Texte posé sur sa ligne de base, aligné à gauche en (x, y). */
  text(value: string, x: number, y: number, style: TextStyle): void;
  /** Largeur du texte, mm. */
  textWidth(value: string, size: number, bold?: boolean): number;
}

export const MM_PER_PT = 25.4 / 72;

// ------------------------------------------------------------------ encodage

const CP1252_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".split("").map((c) => c.codePointAt(0)!));

const REPLACEMENTS: Readonly<Record<string, string>> = {
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  "−": "-",
  "‐": "-",
  "‑": "-",
  "≥": ">=",
  "≤": "<=",
  "≈": "~",
  "≠": "!=",
  "→": "->",
  "←": "<-",
  Δ: "D",
  "√": "rac.",
  "∞": "inf.",
  α: "alpha",
  β: "beta",
  φ: "phi",
  σ: "sigma",
  κ: "kappa",
  Γ: "Gamma",
};

/** Texte représentable en WinAnsi (polices standard PDF) ; « ? » pour le reste. */
export function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x09) out += " ";
    else if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) continue;
    else if (cp <= 0xff || CP1252_EXTRA.has(cp)) out += ch;
    else out += REPLACEMENTS[ch] ?? "?";
  }
  return out;
}

// ------------------------------------------------------------------ enregistrement (tests)

export type RecordedOp =
  | { readonly type: "page" }
  | { readonly type: "path"; readonly ops: readonly PathOp[]; readonly style: PaintStyle }
  | {
      readonly type: "text";
      readonly value: string;
      readonly x: number;
      readonly y: number;
      readonly style: TextStyle;
    };

/**
 * Surface qui enregistre les opérations (tests, inspection) ; largeur de texte approchée
 * (0,5 em par caractère, 0,55 em en gras).
 */
export class RecordingCanvas implements PdfCanvas {
  readonly ops: RecordedOp[] = [];
  pageCount = 1;
  constructor(
    readonly pageWidth = 297,
    readonly pageHeight = 210,
  ) {}
  addPage(): void {
    this.pageCount += 1;
    this.ops.push({ type: "page" });
  }
  path(ops: readonly PathOp[], style: PaintStyle): void {
    this.ops.push({ type: "path", ops: [...ops], style });
  }
  text(value: string, x: number, y: number, style: TextStyle): void {
    this.ops.push({ type: "text", value, x, y, style });
  }
  textWidth(value: string, size: number, bold = false): number {
    return value.length * size * (bold ? 0.55 : 0.5);
  }
  /** Textes de chaque page. */
  pageTexts(): string[][] {
    const pages: string[][] = [[]];
    for (const op of this.ops) {
      if (op.type === "page") pages.push([]);
      else if (op.type === "text") pages[pages.length - 1]!.push(op.value);
    }
    return pages;
  }
}

// ------------------------------------------------------------------ jsPDF

export interface JsPdfCanvasOptions {
  readonly format?: "a4" | "a3";
  readonly orientation?: "landscape" | "portrait";
  /** Compression des flux (défaut : vrai). */
  readonly compress?: boolean;
  /** Date de création écrite dans le PDF (défaut : 2000-01-01, sortie déterministe). */
  readonly creationDate?: Date;
  readonly title?: string;
  readonly subject?: string;
}

const FIXED_DATE = new Date(Date.UTC(2000, 0, 1));

/** Réalisation jsPDF de la surface (unité mm). */
export class JsPdfCanvas implements PdfCanvas {
  readonly doc: jsPDF;
  readonly pageWidth: number;
  readonly pageHeight: number;

  constructor(o: JsPdfCanvasOptions = {}) {
    this.doc = new jsPDF({
      orientation: o.orientation ?? "landscape",
      unit: "mm",
      format: o.format ?? "a4",
      compress: o.compress ?? true,
    });
    this.doc.setCreationDate(o.creationDate ?? FIXED_DATE);
    // Identifiant de fichier fixe : deux exports d'un même modèle sont identiques octet à octet.
    this.doc.setFileId("B1D0E1B1D0E1B1D0E1B1D0E1B1D0E1B1");
    this.doc.setProperties({
      title: toWinAnsi(o.title ?? "Blondel"),
      subject: toWinAnsi(o.subject ?? ""),
      creator: "Blondel",
    });
    this.doc.setLineJoin("round");
    this.doc.setLineCap("butt");
    this.pageWidth = this.doc.internal.pageSize.getWidth();
    this.pageHeight = this.doc.internal.pageSize.getHeight();
  }

  addPage(): void {
    this.doc.addPage();
  }

  private opacity(fill: number, stroke: number): void {
    this.doc.setGState(new GState({ opacity: fill, "stroke-opacity": stroke }));
  }

  path(ops: readonly PathOp[], style: PaintStyle): void {
    const fill = style.fill;
    const stroke =
      style.stroke !== undefined && (style.lineWidth ?? 0.2) > 0 ? style.stroke : undefined;
    if ((fill === undefined && stroke === undefined) || ops.length === 0) return;
    const lines = ops.map((o) =>
      o.op === "M"
        ? { op: "m", c: [o.x, o.y] }
        : o.op === "L"
          ? { op: "l", c: [o.x, o.y] }
          : o.op === "C"
            ? { op: "c", c: [o.x1, o.y1, o.x2, o.y2, o.x, o.y] }
            : { op: "h", c: [] },
    );
    const d = this.doc;
    const fo = style.fillOpacity ?? 1;
    const so = style.strokeOpacity ?? 1;
    const translucent = fo < 1 || so < 1;
    if (translucent) this.opacity(fo, so);
    if (fill) d.setFillColor(fill[0], fill[1], fill[2]);
    if (stroke) {
      d.setDrawColor(stroke[0], stroke[1], stroke[2]);
      d.setLineWidth(style.lineWidth ?? 0.2);
      d.setLineDashPattern(style.dash ? [...style.dash] : [], 0);
    }
    d.path(lines);
    const evenOdd = style.fillRule === "evenodd";
    if (fill && stroke) {
      if (evenOdd) d.fillStrokeEvenOdd();
      else d.fillStroke();
    } else if (fill) {
      if (evenOdd) d.fillEvenOdd();
      else d.fill();
    } else d.stroke();
    if (stroke && style.dash) d.setLineDashPattern([], 0);
    if (translucent) this.opacity(1, 1);
  }

  text(value: string, x: number, y: number, style: TextStyle): void {
    const s = toWinAnsi(value);
    if (s === "") return;
    const d = this.doc;
    d.setFont("helvetica", style.bold ? "bold" : "normal");
    d.setFontSize(style.size / MM_PER_PT);
    const c = style.color ?? [0, 0, 0];
    d.setTextColor(c[0], c[1], c[2]);
    const translucent = style.opacity !== undefined && style.opacity < 1;
    if (translucent) this.opacity(style.opacity!, 1);
    d.text(s, x, y, style.angle ? { angle: style.angle } : {});
    if (translucent) this.opacity(1, 1);
  }

  textWidth(value: string, size: number, bold = false): number {
    const d = this.doc;
    d.setFont("helvetica", bold ? "bold" : "normal");
    return d.getStringUnitWidth(toWinAnsi(value)) * size;
  }

  /** Octets du document PDF. */
  output(): Uint8Array {
    return new Uint8Array(this.doc.output("arraybuffer"));
  }
}
