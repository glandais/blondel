/**
 * Étape « Tracé » du pipeline : bords, ligne de foulée, tournants, emprise.
 */
export { computeLayout, type LayoutOptions } from "./layout.js";
export { LayoutError } from "./errors.js";
export {
  ARC_SEED_SWEEP_DEG,
  axisSeed,
  convertToCage,
  dragJunctionAngle,
  dragSectionEnd,
  dragWellRadius,
  dragWidth,
  editableCage,
  insertLanding,
  insertSection,
  junctionAngleAt,
  junctionFrame,
  removeSection,
  sectionEndLength,
  setJunctionAngle,
  setJunctionDepth,
  setJunctionMode,
  setSectionAxis,
  setSectionLength,
  setSectionWidth,
  setWallJoint,
  setWellJoint,
  splitSection,
  wellRadiusFrame,
  withPlacement,
  type JunctionFrame,
  type NewSection,
  type SectionWidthChange,
  type WellRadiusFrame,
} from "./cageEdit.js";
export {
  arcPoints,
  computeHelicalLayout,
  helicalAngleAt,
  helicalPoint,
  helicalSign,
  helicalStepAngle,
  sectorRing,
  splitArc,
} from "./helical.js";
export {
  AUTO_GOING_MODULE,
  RISER_COUNT_MAX,
  RISER_COUNT_MIN,
  resolveLegLengths,
  resolveRiserCount,
  resolveStraightRun,
  resolveTargetGoing,
  resolveWalklineOffset,
} from "./resolve.js";
export {
  newelOffset,
  newelProtrusion,
  newelReach,
  newelSetback,
  type NewelCorner,
} from "./newel.js";
export {
  autoWalklineSide,
  autoWalklineSideKey,
  resolveWalklineSide,
  straightSideKinds,
  type StraightSideKind,
} from "./walklineSide.js";
export {
  ZERO_LENGTH_JOUR_ERROR,
  zeroLengthJourAgainstWall,
  zeroLengthJourError,
} from "./zeroLengthJour.js";
