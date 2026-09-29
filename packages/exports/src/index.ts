/**
 * @blondel/exports : rendus et fichiers dérivés du `Model` (plan, élévation et développés
 * SVG, DXF, liste de débit CSV, archive ZIP, projet JSON). Fonctions pures, sans DOM.
 *
 * Le dossier PDF (`exportPdf`, dépendance jsPDF d'environ 1 Mo avec ses dépendances) est
 * exposé **seulement** par `@blondel/exports/pdf`, pour un chargement à la demande par
 * l'interface (`await import("@blondel/exports/pdf")`) : le réexporter ici ferait entrer
 * jsPDF dans le paquet principal de l'application et rendrait l'import dynamique inopérant.
 */
export { formatFr, formatNum, escapeXml, NARROW_NBSP, type FrNumberOptions } from "./format.js";
export {
  arcFromBulge,
  bandContour,
  curvePath,
  polygonPath,
  type PathVertex,
  type PlanPath,
} from "./path.js";
export {
  locateViolations,
  openingPolygon,
  requiredHeadroom,
  violationSummary,
  worstSeverity,
  type LocatedViolations,
} from "./annotations.js";
export {
  buildPlanDrawing,
  dimensionGeometry,
  type Dimension,
  type DimensionGeometry,
  type DimensionRole,
  type PlanDrawing,
  type PlanDrawingOptions,
  type PlanLayer,
  type PlanNosing,
  type PlanTread,
} from "./plan/drawing.js";
export {
  DARK_THEME,
  LIGHT_THEME,
  resolveTheme,
  type SvgScaleOptions,
  type SvgTheme,
  type ThemeOption,
} from "./svg/svg.js";
export { renderPlanSvg, type PlanSvgLayers, type PlanSvgOptions } from "./svg/plan.js";
export { ceilingIntervals, renderElevationSvg, type ElevationSvgOptions } from "./svg/elevation.js";
export {
  declareLayers,
  type DxfLayerDef,
  type DxfLineType,
  type DxfTextAlign,
  type DxfTextOptions,
  type DxfVersion,
  type DxfWriter,
  type DxfWriterOptions,
} from "./dxf/writer.js";
export { R12Writer, encodeDxfText, sanitizeLayerName } from "./dxf/r12.js";
export { Ac1021Writer } from "./dxf/ac1021.js";
export {
  DEFAULT_PART_DXF_VERSION,
  DEFAULT_PLAN_DXF_VERSION,
  createDxfWriter,
} from "./dxf/create.js";
export { PLAN_LAYERS, exportPlanDxf, type PlanDxfOptions } from "./dxf/plan.js";
export {
  PART_LAYERS,
  engravingPoint,
  flatEngravingPoint,
  exportPartDxf,
  partLineAnnotation,
  partLineLayer,
  type PartDxfOptions,
} from "./dxf/part.js";
export {
  exportPartsDxf,
  safeFileStem,
  type PartDxfFile,
  type PartsDxfOptions,
} from "./dxf/parts.js";
export {
  flatLineStyle,
  flatPatternExtent,
  renderFlatPatternSvg,
  wrapWords,
  type FlatLineStyle,
  type FlatPatternSvgOptions,
} from "./svg/flat.js";
export { crc32, createZip, type ZipEntry, type ZipOptions } from "./zip.js";
export {
  CSV_BOM,
  CUT_LIST_HEADER,
  MATERIAL_LABELS,
  QUANTITY_MASS,
  QUANTITY_VOLUME,
  csvField,
  csvTextField,
  cutListRows,
  neutralizeFormula,
  exportCutListCsv,
  type CutListCsvOptions,
  type CutListRow,
} from "./csv/cutlist.js";
export { PROJECT_FILE_EXTENSION, exportProjectJson } from "./json.js";
