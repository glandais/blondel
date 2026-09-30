/**
 * @blondel/exports : rendus et fichiers dérivés du `Model` (plan, élévation et développés
 * SVG, DXF, liste de débit CSV, archive ZIP, projet JSON, modèle 3D glTF binaire, données de
 * la fiche de pose et de la fiche de débit). Fonctions pures, sans DOM.
 *
 * Pas d'export XLSX (exceljs peu maintenu, SPEC §5 : CSV seulement) ni STEP au MVP (noyau
 * OCCT sous LGPL, question Q21 ouverte) : voir LEDGER.
 *
 * Le dossier PDF (`exportPdf`, dépendance jsPDF d'environ 1 Mo avec ses dépendances) est
 * exposé **seulement** par `@blondel/exports/pdf`, pour un chargement à la demande par
 * l'interface (`await import("@blondel/exports/pdf")`) : le réexporter ici ferait entrer
 * jsPDF dans le paquet principal de l'application et rendrait l'import dynamique inopérant.
 */
export {
  formatFr,
  formatIn,
  formatNum,
  escapeXml,
  NARROW_NBSP,
  type FrNumberOptions,
} from "./format.js";
export {
  MATERIAL_KEYS,
  compareMarks,
  compareText,
  localeOption,
  materialLabel,
  translatorOf,
  type Locale,
  type LocaleOption,
  type Translator,
} from "./i18n.js";
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
export {
  ceilingIntervals,
  renderElevationSvg,
  soffitIntervals,
  type ElevationSvgOptions,
  type SoffitInterval,
} from "./svg/elevation.js";
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
export {
  PLAN_LAYERS,
  exportPlanDxf,
  planLayers,
  type PlanDxfOptions,
  type PlanLayerId,
} from "./dxf/plan.js";
export {
  PART_LAYERS,
  partLayers,
  engravingPoint,
  flatEngravingPoint,
  exportPartDxf,
  partLineAnnotation,
  partLineLayer,
  type PartDxfOptions,
  type PartLayerId,
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
  MASS_DENSITY_NOTE,
  QUANTITY_MASS,
  QUANTITY_MASS_KG,
  QUANTITY_VOLUME,
  csvField,
  csvSeparator,
  csvTextField,
  cutListHeader,
  cutListRows,
  defaultMassNote,
  massDensityNote,
  massNoteFor,
  neutralizeFormula,
  exportCutListCsv,
  partMassKg,
  type CsvSeparator,
  type CutListCsvOptions,
  type CutListRow,
  type CutListRowsOptions,
  type MassNote,
} from "./csv/cutlist.js";
export { PROJECT_FILE_EXTENSION, exportProjectJson } from "./json.js";
export {
  GLB_FILE_EXTENSION,
  GLB_MIME,
  buildGltf,
  exportGlb,
  packGlb,
  partExtras,
  type GlbOptions,
  type GltfDocument,
} from "./gltf/glb.js";
export {
  MATERIAL_PBR,
  hexToLinear,
  pbrLook,
  srgbToLinear,
  type PbrLook,
} from "./gltf/materials.js";
export {
  cutSheet,
  type CutSheetGroup,
  type CutSheetOptions,
  type CutSheetRow,
} from "./cutsheet.js";
export {
  installationSheet,
  wallOffset,
  type InstallationSheetOptions,
  type InstallationPoint,
  type InstallationSheet,
  type OpeningOffset,
  type WallOffset,
} from "./installation.js";
export {
  TEMPLATE_FAMILIES,
  TEMPLATE_FAMILY_KEYS,
  TEMPLATE_FAMILY_LABELS,
  templateFamily,
  templateFamilyLabel,
  type TemplateFamily,
} from "./templateFamily.js";
