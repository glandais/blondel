/**
 * @blondel/exports : rendus et fichiers dérivés du `Model` (plan et élévation SVG, DXF,
 * liste de débit CSV, projet JSON). Fonctions pures, sans DOM.
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
export { PART_LAYERS, engravingPoint, exportPartDxf, type PartDxfOptions } from "./dxf/part.js";
export {
  CSV_BOM,
  CUT_LIST_HEADER,
  MATERIAL_LABELS,
  QUANTITY_MASS,
  QUANTITY_VOLUME,
  csvField,
  cutListRows,
  exportCutListCsv,
  type CutListCsvOptions,
  type CutListRow,
} from "./csv/cutlist.js";
export { PROJECT_FILE_EXTENSION, exportProjectJson } from "./json.js";
