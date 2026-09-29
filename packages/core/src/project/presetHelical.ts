/**
 * Préréglage **hélicoïdal à fût central** (jalon 5a, `createProject("helical")`).
 *
 * Valeurs par défaut **[choix Blondel, à valider]** (aucune n'est une règle métier) :
 * - R_e = 950 mm (Ø 1 900, dans la gamme courante Ø 1 400 à 3 800 d'un fabricant, C §2.3 [51],
 *   confiance moyenne ; 900 mm jusqu'au 2026-09-30, trop juste pour une sortie vers la dalle
 *   aussi large que l'emmarchement avec un giron d'au moins `G_MIN_LOGEMENT`) et fût de rayon
 *   r_f = 70 mm (Ø 140, non sourcé) : E = 880 mm, au-dessus des
 *   800 mm de `LARGEUR_MIN_LOGEMENT` ;
 * - ligne de foulée DTU sur l'emmarchement (milieu, B §2.1) : les sources hélicoïdales divergent
 *   (50 ou 60 cm, B §2.2) — voir le ledger ;
 * - nombre de marches par tour N : le **plus petit** (giron le plus grand) pour lequel la règle
 *   dérivée d'échappée sous le tour supérieur (`helicalHeadroomBound`) atteint
 *   `PRESET_HEADROOM_MIN`, le module 2h + g reste dans `BLONDEL_DTU`, le giron atteint
 *   `G_MIN_LOGEMENT` (contexte du préréglage) **et** le palier d'arrivée ouvre une sortie vers
 *   la dalle (corde de son arc extérieur) au moins aussi large que l'emmarchement (revu le
 *   2026-09-30 : le plus grand giron donnait un palier de 35 à 40°, sortie d'environ 0,5 m) ;
 *   à défaut de sortie assez large, le plus petit N qui passe les autres critères ;
 * - palier d'arrivée : le plus grand secteur, multiple de 5°, d'au plus 90° dont l'échappée
 *   (règle dérivée) reste suffisante ; aucun palier si même 5° ne passe ;
 * - contremarches pleines (revu le 2026-09-30) : sans contremarche, le vide entre marches
 *   h − e ≈ 140 mm dépasse la sphère de 100 mm de `VIDE_ENTRE_MARCHES` (conseil sur chaque
 *   marche) ; débord de nez des préréglages ;
 * - trémie dégageant tout l'escalier : cercle (polygone inscrit) ou carré de rayon / demi-côté
 *   R_e + jeu latéral (`openingClearance`, défaut `PRESET_OPENING_CLEARANCE`). **Sortie vers la
 *   dalle** (trémie circulaire, revu le 2026-09-30) : au droit du palier d'arrivée, le bord de
 *   la trémie suit l'arc extérieur du palier, qui affleure donc le nez de dalle (le plancher
 *   haut prolonge le palier) ; le jeu ne subsiste qu'autour des marches. Trémie carrée : palier
 *   séparé du nez de dalle par le jeu (liaison non modélisée) ;
 * - contextes `bois_dtu`, `logement_interieur` et `helicoidal` (ce dernier est aussi déduit du
 *   découpage par le moteur de règles depuis le 2026-09-30).
 *
 * `G_COLLET_MIN` reste en avertissement sur un fût : le collet r_f·Δθ (≈ 37 mm) n'atteint
 * 100 mm qu'avec un fût de plus de 400 mm de diamètre, hors des valeurs raisonnables (ledger §2 :
 * application de la règle aux fûts à arbitrer, DIN 18065 admettant 0 mm pour un noyau).
 */
import { circularOpening, helicalHeadroomBound } from "../headroom/helical.js";
import { ensureCCW } from "../geom2d/polygon.js";
import { arcPoints } from "../layout/helical.js";
import { computeLayout } from "../layout/layout.js";
import { LayoutError } from "../layout/errors.js";
import { resolveRiserCount } from "../layout/resolve.js";
import {
  HELICAL_TREADS_PER_TURN_MIN,
  ProjectSchema,
  PROJECT_SCHEMA_VERSION,
  SteppingSchema,
  TreadSpecSchema,
  type HelicalLayoutSpecInput,
  type HelicalSweep,
  type Opening,
  type Project,
  type ProjectInput,
} from "../model/project.js";
import { getRule } from "../rules/table.js";
import {
  DEFAULT_FLOOR_TO_FLOOR,
  DEFAULT_SLAB_THICKNESS,
  deepMerge,
  pick,
  PRESET_HEADROOM_MIN,
  PRESET_LABELS,
  PRESET_NOSING,
  PRESET_OPENING_CLEARANCE,
  requirePositiveInt,
  type PresetOptions,
} from "./presets.js";

/** Rayon extérieur R_e par défaut (mm) — à valider. */
export const HELICAL_DEFAULT_OUTER_RADIUS = 950;
/** Rayon du fût r_f par défaut (mm) — à valider. */
export const HELICAL_DEFAULT_CORE_RADIUS = 70;
/** Plus grand palier d'arrivée essayé par le préréglage (degrés) — à valider. */
export const HELICAL_MAX_LANDING_ANGLE = 90;
/** Pas de recherche de l'angle du palier (degrés). */
const LANDING_ANGLE_STEP = 5;
/** Plus grand nombre de marches par tour essayé par le préréglage. */
const TREADS_PER_TURN_SEARCH_MAX = 30;
/** Contextes du préréglage : bois, logement, forme hélicoïdale. */
const HELICAL_CONTEXTS = ["bois_dtu", "logement_interieur", "helicoidal"] as const;

/** Giron minimal du contexte `logement_interieur` (`G_MIN_LOGEMENT`, rules.yaml). */
function minGoing(): number {
  const min = getRule("G_MIN_LOGEMENT").min;
  if (min === null) throw new Error("G_MIN_LOGEMENT sans seuil.");
  return min;
}

function blondelBounds(): { min: number; max: number } {
  const r = getRule("BLONDEL_DTU");
  if (r.min === null || r.max === null) throw new Error("BLONDEL_DTU sans bornes.");
  return { min: r.min, max: r.max };
}

/**
 * Crée un projet hélicoïdal complet et valide (voir l'en-tête du module).
 * @throws RangeError si les options sont incohérentes ou si aucun nombre de marches par tour ne
 *   satisfait l'échappée et le module de Blondel.
 */
export function createHelicalProject(options: PresetOptions = {}): Project {
  if (options.width !== undefined) {
    throw new RangeError(
      "Hélicoïdal : l'emmarchement se déduit des rayons (options « outerRadius » et « coreRadius »).",
    );
  }
  const patch = options.patch;
  const patchedLayout = patch?.stair?.layout as Partial<HelicalLayoutSpecInput> | undefined;
  const height =
    pick("floorToFloor", options.floorToFloor, patch?.site?.floorToFloor) ?? DEFAULT_FLOOR_TO_FLOOR;
  const slab =
    pick("upperSlabThickness", options.upperSlabThickness, patch?.site?.upperSlabThickness) ??
    DEFAULT_SLAB_THICKNESS;
  const outerRadius =
    pick("outerRadius", options.outerRadius, patchedLayout?.outerRadius) ??
    HELICAL_DEFAULT_OUTER_RADIUS;
  const coreRadius =
    pick("coreRadius", options.coreRadius, patchedLayout?.core?.radius) ??
    HELICAL_DEFAULT_CORE_RADIUS;
  requirePositiveInt("La hauteur à monter", height);
  requirePositiveInt("L'épaisseur du plancher haut", slab);
  requirePositiveInt("Le rayon extérieur", outerRadius);
  requirePositiveInt("Le rayon du fût", coreRadius);
  if (!(outerRadius > coreRadius)) {
    throw new RangeError(
      `Le rayon extérieur (${outerRadius} mm) doit dépasser le rayon du fût (${coreRadius} mm).`,
    );
  }
  const clearance = options.openingClearance ?? PRESET_OPENING_CLEARANCE;
  if (!Number.isInteger(clearance) || clearance < 0) {
    throw new RangeError(
      `Le jeu latéral de la trémie doit être un entier positif ou nul en mm (reçu : ${clearance}).`,
    );
  }
  const direction = options.direction ?? "left";

  const input: ProjectInput = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: options.name ?? PRESET_LABELS.helical,
    site: { floorToFloor: height, upperSlabThickness: slab },
    stair: {
      placement: { origin: { x: 0, y: 0 }, rotation: 0 },
      layout: {
        kind: "helical",
        direction,
        outerRadius,
        core: { kind: "column", radius: coreRadius },
        // Provisoire : remplacé par la recherche de N ci-dessous (sauf rotation imposée).
        sweep: { mode: "treadsPerTurn", count: 12 },
        startAngle: 0,
      },
      treads: { nosing: PRESET_NOSING, risers: "full" },
    },
    compliance: { contexts: [...HELICAL_CONTEXTS] },
  };
  let project: Project;
  try {
    project = structuredClone(ProjectSchema.parse(deepMerge(input, patch)));
  } catch (e) {
    if (e instanceof Error && e.name === "ZodError") {
      throw new RangeError(`Préréglage hélicoïdal invalide : ${e.message}`);
    }
    throw e;
  }
  const spec = project.stair.layout;
  if (spec.kind !== "helical") {
    throw new RangeError(
      "Le préréglage hélicoïdal n'accepte pas de tracé à volées dans « patch ».",
    );
  }

  let n: number;
  let walklineRadius: number;
  try {
    n = resolveRiserCount(project);
    walklineRadius = computeLayout(project).helical!.walklineRadius;
  } catch (e) {
    if (e instanceof LayoutError) throw new RangeError(e.message);
    throw e;
  }
  const rise = height / n;
  const treads = TreadSpecSchema.parse(project.stair.treads);
  SteppingSchema.parse(project.stair.stepping);
  const base = {
    riserCount: n,
    rise,
    walklineRadius,
    treadThickness: treads.thickness,
    nosing: treads.nosing,
  };

  // Palier d'arrivée : le plus grand secteur admissible pour un angle par marche donné.
  const landingFor = (step: number): { angle: number } | undefined => {
    for (let a = HELICAL_MAX_LANDING_ANGLE; a >= LANDING_ANGLE_STEP; a -= LANDING_ANGLE_STEP) {
      const bound = helicalHeadroomBound({
        ...base,
        stepAngle: step,
        landingAngle: (a * Math.PI) / 180,
      });
      if (bound.landing === null || bound.landing >= PRESET_HEADROOM_MIN) return { angle: a };
    }
    return undefined;
  };
  const landingGiven = patchedLayout?.landing !== undefined;
  /** Sortie vers la dalle : corde de l'arc extérieur du palier, au moins l'emmarchement. */
  const wideExit = (step: number): boolean => {
    if (landingGiven) return true;
    const a = landingFor(step);
    const chord = a ? 2 * outerRadius * Math.sin((a.angle * Math.PI) / 360) : 0;
    return chord >= outerRadius - coreRadius;
  };

  // Nombre de marches par tour : le plus petit qui passe et donne une sortie assez large ; à
  // défaut, le plus petit qui passe (sauf rotation donnée dans `patch`).
  let sweep: HelicalSweep = spec.sweep;
  if (patchedLayout?.sweep === undefined) {
    const blondel = blondelBounds();
    const gMin = minGoing();
    let found: number | null = null;
    let fallback: number | null = null;
    for (let N = HELICAL_TREADS_PER_TURN_MIN; N <= TREADS_PER_TURN_SEARCH_MAX; N++) {
      const step = (2 * Math.PI) / N;
      const going = walklineRadius * step;
      const module = 2 * rise + going;
      if (module < blondel.min || module > blondel.max || going < gMin) continue;
      const bound = helicalHeadroomBound({ ...base, stepAngle: step });
      if (bound.treads !== null && bound.treads < PRESET_HEADROOM_MIN) continue;
      fallback ??= N;
      if (wideExit(step)) {
        found = N;
        break;
      }
    }
    found ??= fallback;
    if (found === null) {
      throw new RangeError(
        `Hélicoïdal : aucun nombre de marches par tour (≤ ${TREADS_PER_TURN_SEARCH_MAX}) ne donne à la fois une échappée de ${PRESET_HEADROOM_MIN} mm sous le tour supérieur, un module 2h + g dans les bornes du DTU et un giron d'au moins ${gMin} mm : augmenter le rayon extérieur ou régler le nombre de hauteurs.`,
      );
    }
    sweep = { mode: "treadsPerTurn", count: found };
  }
  const step = computeStepAngle(sweep, n);

  // Palier d'arrivée : le plus grand secteur admissible (sauf palier donné dans `patch`).
  const landing = landingGiven ? spec.landing : landingFor(step);

  const { landing: _previous, ...layoutRest } = spec;
  const shaped = structuredClone(
    ProjectSchema.parse({
      ...project,
      stair: {
        ...project.stair,
        layout: { ...layoutRest, sweep, ...(landing ? { landing } : {}) },
      },
    }),
  );
  const opening: Opening | undefined =
    patch?.site?.opening !== undefined
      ? project.site.opening
      : helicalOpening(shaped, outerRadius + clearance, options.openingShape ?? "circle");
  return structuredClone(
    ProjectSchema.parse({
      ...shaped,
      site: { ...shaped.site, ...(opening ? { opening } : {}) },
    }),
  );
}

function computeStepAngle(sweep: HelicalSweep, n: number): number {
  return sweep.mode === "angle"
    ? (sweep.degrees * Math.PI) / 180 / (n - 1)
    : (2 * Math.PI) / sweep.count;
}

/**
 * Trémie qui dégage l'escalier : cercle (polygone inscrit) ou carré (grille de 10 mm) de rayon /
 * demi-côté R_e + jeu. **Sortie vers la dalle** (trémie circulaire avec palier d'arrivée) : au
 * droit du secteur du palier, le bord de la trémie suit l'arc extérieur du palier (mêmes sommets
 * que `Layout.helical.landingOutline`) : le palier affleure le nez de dalle sur ce secteur,
 * le plancher haut prolonge le palier (la trémie n'est élargie du jeu qu'autour des marches).
 */
function helicalOpening(project: Project, radius: number, shape: "circle" | "square"): Opening {
  const c = project.stair.placement.origin;
  if (shape === "square") {
    const half = Math.ceil(radius / 10) * 10;
    return { kind: "rect", x: c.x - half, y: c.y - half, sizeX: 2 * half, sizeY: 2 * half };
  }
  const h = computeLayout(project).helical;
  if (!h || !(h.landingAngle > 0)) return circularOpening(c, radius);
  const sign = h.direction === "left" ? 1 : -1;
  // Mêmes angles que le secteur du palier du tracé (`layout/helical.ts`).
  const landingStart = h.startAngle + sign * h.totalAngle;
  const landingSweep = sign * h.landingAngle;
  const landingEnd = landingStart + landingSweep;
  const landingArc = arcPoints(h.center, h.outerRadius, landingStart, landingSweep);
  // Reste du cercle : même pas que `circularOpening` (flèche ≤ 0,5 mm).
  const restSweep = 2 * Math.PI - h.landingAngle;
  const maxStep = 2 * Math.acos(1 - 0.5 / radius);
  const count = Math.max(2, Math.ceil(restSweep / maxStep));
  const rest = Array.from({ length: count + 1 }, (_, i) => {
    const a = landingEnd + (sign * restSweep * i) / count;
    return { x: h.center.x + radius * Math.cos(a), y: h.center.y + radius * Math.sin(a) };
  });
  // Reste du cercle au 1/100 mm (comme `circularOpening`) ; arc du palier **exact** (mêmes
  // flottants que le contour du palier : ses points, dont le nez d'arrivée, sont sur le bord de
  // la trémie, compté dans la trémie par l'échappée).
  const round = (v: number): number => Math.round(v * 100) / 100;
  const points = ensureCCW([
    ...landingArc,
    ...rest.map((p) => ({ x: round(p.x), y: round(p.y) })),
  ]).map((p) => ({ x: p.x, y: p.y }));
  return { kind: "polygon", points };
}
