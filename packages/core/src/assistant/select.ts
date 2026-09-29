/**
 * Sélection diversifiée de la liste principale de l'assistant (constat en ligne : les premières
 * propositions étaient toutes la même forme, variantes de sens et d'emmarchement).
 *
 * La **forme** d'un candidat est le couple typologie × position du tournant ; le sens, E, n et
 * le calage n'en font pas partie. La liste principale garde au plus `perShapeLimit` candidats
 * par forme ; les suivants deviennent des **variantes** regroupées sous le meilleur candidat de
 * leur forme. Tout est classé par score croissant (identifiant en cas d'égalité), dans la liste
 * principale comme dans chaque groupe de variantes. Avec `showAllVariants`, la liste est rendue
 * à plat (tous les candidats, sans regroupement ni troncature).
 */
import type { DesignCandidate, TypologyId } from "./types.js";

/** Clé de forme : `typologie|position du tournant` (`-` sans tournant). */
export function shapeKey(
  typology: TypologyId,
  turnPosition: DesignCandidate["turnPosition"],
): string {
  return `${typology}|${turnPosition ?? "-"}`;
}

export interface SelectionOptions {
  /** Candidats par forme dans la liste principale (entier ≥ 1). */
  readonly perShapeLimit: number;
  /** Longueur maximale de la liste principale (entier ≥ 0). */
  readonly maxCandidates: number;
  /** Liste à plat, sans regroupement ni troncature. */
  readonly showAllVariants: boolean;
}

const byScore = (x: DesignCandidate, y: DesignCandidate): number =>
  x.score.total - y.score.total || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);

/**
 * Liste principale à partir des candidats acceptés (dans n'importe quel ordre ; leurs
 * `variants` éventuelles sont ignorées). Chaque candidat accepté figure au plus une fois dans
 * le résultat, en tête ou en variante ; seuls disparaissent ceux d'une forme dont aucun
 * candidat n'entre dans les `maxCandidates` premières places.
 *
 * @throws RangeError si `perShapeLimit` n'est pas un entier ≥ 1 ou `maxCandidates` un entier ≥ 0
 *   (QUESTIONS D1 : les options n'étaient pas validées).
 */
export function selectDiverse(
  accepted: readonly DesignCandidate[],
  options: SelectionOptions,
): DesignCandidate[] {
  if (!Number.isInteger(options.perShapeLimit) || options.perShapeLimit < 1) {
    throw new RangeError(
      `selectDiverse : perShapeLimit doit être un entier ≥ 1 (reçu : ${options.perShapeLimit}).`,
    );
  }
  if (!Number.isInteger(options.maxCandidates) || options.maxCandidates < 0) {
    throw new RangeError(
      `selectDiverse : maxCandidates doit être un entier ≥ 0 (reçu : ${options.maxCandidates}).`,
    );
  }
  const sorted = [...accepted].sort(byScore);
  if (options.showAllVariants) return sorted.map((c) => ({ ...c, variants: [] }));
  const heads: DesignCandidate[] = [];
  const perShape = new Map<string, number>();
  /** Variantes du meilleur candidat de chaque forme (dans l'ordre du score). */
  const variantsOf = new Map<string, DesignCandidate[]>();
  const bestIndex = new Map<string, number>();
  for (const c of sorted) {
    const k = c.shape;
    const count = perShape.get(k) ?? 0;
    if (count < options.perShapeLimit && heads.length < options.maxCandidates) {
      if (count === 0) {
        bestIndex.set(k, heads.length);
        variantsOf.set(k, []);
      }
      heads.push(c);
      perShape.set(k, count + 1);
    } else {
      // Forme déjà en tête : variante du meilleur ; forme absente et liste pleine : écartée.
      variantsOf.get(k)?.push({ ...c, variants: [] });
    }
  }
  return heads.map((c, i) => {
    const k = c.shape;
    return { ...c, variants: bestIndex.get(k) === i ? (variantsOf.get(k) ?? []) : [] };
  });
}
