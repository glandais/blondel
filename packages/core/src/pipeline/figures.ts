/**
 * Chiffres clés du modèle (`Model.figures`, ADR-0009, spécification de contenu § 2 « Chiffres
 * affichés ») : grandeurs lues par l'interface (bandes du panneau libre, étapes du guidé) qui ne
 * figurent nulle part ailleurs dans le `Model` sous une forme directement affichable. Fonction
 * pure, sans seuil ni valeur métier propres :
 *
 * - `minCollet` : plus petite corde de collet (`Tread.colletChord`) des marches balancées
 *   (`kind: "winder"`), même grandeur et mêmes marches que la règle de collet
 *   (`rules/evaluators/going.ts`) ; un hélicoïdal n'a que des marches balancées ;
 * - `footprint` : rectangle englobant en plan, axes du site, des contours des marches et
 *   paliers débord de nez compris (`Tread.outline`) et de l'emprise du tracé
 *   (`Layout.footprint`) ; garde-corps exclus ;
 * - `nosingOverlap` : recouvrement au nez, grandeur mesurée par les règles RECOUVREMENT_*
 *   (`rules/evaluators/nosing.ts` : le débord saisi `stair.treads.nosing` vaut recouvrement) ;
 * - `guards` : lignes de garde-corps (`GuardsAnalysis.runs`), longueur cumulée **en plan** de
 *   leurs axes, poteaux, et hauteur minimale exigée lue dans les résultats du contrôle.
 *
 * Une grandeur non calculable (contour vide, valeur non finie) est omise : jamais d'exception.
 */
import type {
  ComplianceReport,
  Layout,
  ModelFigures,
  ModelGuardFigures,
  Stepping,
} from "../model/derived.js";
import type { Mm, Vec2 } from "../model/primitives.js";
import type { GuardsAnalysis } from "../guards/types.js";

/**
 * Règles de hauteur de garde-corps dont la borne `min` est la hauteur exigée (évaluateurs
 * `rakeHeight`, `levelHeight` et `height2024` de `rules/evaluators/guards.ts`). Les règles de
 * main courante (MC_HAUTEUR*) n'en font pas partie.
 */
export const GUARD_HEIGHT_RULE_IDS: readonly string[] = [
  "GC_HAUTEUR_RAMPANT_1988",
  "GC_HAUTEUR_RAMPANT_2024",
  "GC_HAUTEUR_PALIER_1988",
  "GC_HAUTEUR_2024",
];

const GUARD_HEIGHT_RULES = new Set(GUARD_HEIGHT_RULE_IDS);

/** Plus petite corde de collet des marches balancées ; `undefined` sans marche balancée. */
export function minColletOf(stepping: Stepping): Mm | undefined {
  let min = Infinity;
  for (const t of stepping.treads) {
    if (t.kind === "winder" && Number.isFinite(t.colletChord) && t.colletChord < min)
      min = t.colletChord;
  }
  return Number.isFinite(min) ? min : undefined;
}

/**
 * Emprise au sol : dimensions (X, Y) du rectangle englobant en plan des contours des marches
 * (débord de nez compris) et de l'emprise du tracé. `undefined` sans point fini.
 */
export function footprintOf(
  layout: Layout,
  stepping: Stepping,
): { readonly x: Mm; readonly y: Mm } | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (pts: readonly Vec2[]): void => {
    for (const p of pts) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  };
  add(layout.footprint);
  for (const t of stepping.treads) add(t.outline);
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return undefined;
  return { x: maxX - minX, y: maxY - minY };
}

/** Longueur d'une polyligne en plan (mm). */
function polylineLength(path: readonly Vec2[]): Mm {
  let sum = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    sum += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return sum;
}

/**
 * Hauteur minimale exigée : plus forte borne `min` des résultats évalués (statut `ok` ou
 * `violation`) des règles de hauteur de garde-corps ; `undefined` si aucune n'est évaluée.
 */
export function requiredGuardHeightOf(compliance: ComplianceReport): Mm | undefined {
  let max = -Infinity;
  for (const r of compliance.results) {
    if (!GUARD_HEIGHT_RULES.has(r.ruleId) || r.status === "non-evaluee") continue;
    const min = r.min;
    if (typeof min === "number" && Number.isFinite(min) && min > max) max = min;
  }
  return Number.isFinite(max) ? max : undefined;
}

/** Chiffres des garde-corps ; `requiredHeight` est fourni par l'appelant (contrôle). */
export function guardFiguresOf(
  guards: GuardsAnalysis,
  requiredHeight: Mm | undefined,
): ModelGuardFigures {
  let length = 0;
  for (const r of guards.runs) length += polylineLength(r.path);
  const posts = guards.parts.filter((p) => p.category === "post").length;
  return {
    lines: guards.runs.length,
    length,
    posts,
    ...(requiredHeight !== undefined ? { requiredHeight } : {}),
  };
}

export interface FiguresInput {
  readonly layout: Layout;
  readonly stepping: Stepping;
  /** Débord de nez saisi (`stair.treads.nosing`), recouvrement des règles RECOUVREMENT_*. */
  readonly nosing: Mm;
  /** Analyse des garde-corps ; `undefined` ou `null` : pas de garde-corps (ou étape en échec). */
  readonly guards: GuardsAnalysis | null | undefined;
  /** Hauteur minimale exigée (`requiredGuardHeightOf` sur le rapport final). */
  readonly requiredGuardHeight: Mm | undefined;
}

/** Chiffres clés du modèle. Ne lève pas : une grandeur non calculable est omise. */
export function computeFigures(input: FiguresInput): ModelFigures {
  const { layout, stepping, nosing, guards, requiredGuardHeight } = input;
  let minCollet: Mm | undefined;
  let footprint: { readonly x: Mm; readonly y: Mm } | undefined;
  let guardFigures: ModelGuardFigures | undefined;
  try {
    minCollet = minColletOf(stepping);
  } catch {
    minCollet = undefined;
  }
  try {
    footprint = footprintOf(layout, stepping);
  } catch {
    footprint = undefined;
  }
  try {
    guardFigures = guards ? guardFiguresOf(guards, requiredGuardHeight) : undefined;
  } catch {
    guardFigures = undefined;
  }
  return {
    ...(minCollet !== undefined ? { minCollet } : {}),
    ...(footprint !== undefined ? { footprint } : {}),
    ...(Number.isFinite(nosing) ? { nosingOverlap: nosing } : {}),
    ...(guardFigures !== undefined ? { guards: guardFigures } : {}),
  };
}
