/**
 * `@blondel/exports/pdf` : dossier PDF (sommaire, plan, élévation, fiche de pose, nomenclature,
 * fiche de débit, contrôle de conception, valeurs à valider, développés, gabarits 1:1 tuilés).
 * Point d'entrée séparé : jsPDF n'est chargé que si l'on exporte en PDF.
 */
export {
  JsPdfCanvas,
  MM_PER_PT,
  RecordingCanvas,
  helveticaMeasure,
  toWinAnsi,
  type JsPdfCanvasOptions,
  type PaintStyle,
  type PathOp,
  type PdfCanvas,
  type RecordedOp,
  type Rgb,
  type TextMeasure,
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
  clipPath,
  clipRing,
  clipSegment,
  flattenPath,
  type ClippedPath,
  type Rect,
} from "./clip.js";
export { CONTROL_RULER_MM, contentFrame, type Frame } from "./layout.js";
export {
  DEFAULT_TILE_OVERLAP,
  registrationPoints,
  templateSheet,
  templateTiles,
  tileGrid,
  tileLabel,
  tileRect,
  type TemplateSheet,
  type TileGrid,
  type TileInfo,
} from "./tiles.js";
export {
  STANDARD_SCALES,
  complianceDisclaimer,
  exportPdf,
  exportPdfDocument,
  renderPdf,
  wrapText,
  type PdfLayoutOptions,
  type PdfOptions,
  type PdfPageInfo,
  type PdfPageKind,
  type PdfPages,
} from "./document.js";
export type { PdfToValidateRow } from "./toValidate.js";
