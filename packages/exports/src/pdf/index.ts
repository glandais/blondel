/**
 * `@blondel/exports/pdf` : dossier PDF (plan, élévation, nomenclature, contrôle de conception,
 * développés). Point d'entrée séparé : jsPDF n'est chargé que si l'on exporte en PDF.
 */
export {
  JsPdfCanvas,
  MM_PER_PT,
  RecordingCanvas,
  toWinAnsi,
  type JsPdfCanvasOptions,
  type PaintStyle,
  type PathOp,
  type PdfCanvas,
  type RecordedOp,
  type Rgb,
  type TextStyle,
} from "./canvas.js";
export {
  arcToBeziers,
  drawSvg,
  parseColor,
  parsePathData,
  parseSvg,
  parseTransform,
  svgSize,
  type Matrix,
  type SvgNode,
  type SvgPlacement,
} from "./svg-draw.js";
export {
  COMPLIANCE_DISCLAIMER,
  STANDARD_SCALES,
  exportPdf,
  renderPdf,
  wrapText,
  type PdfLayoutOptions,
  type PdfOptions,
  type PdfPageInfo,
  type PdfPages,
} from "./document.js";
