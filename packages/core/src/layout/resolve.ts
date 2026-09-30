/**
 * Résolution des valeurs `auto` utiles au tracé, partagée avec le découpage.
 *
 * Choix (tâche « Tracé ») : la longueur `auto` d'un escalier droit est le reculement
 * R = (n − 1)·g (SPEC §2.3, A §1.8), avec n = `riserCount` (ou arrondi(H / targetRise)) et
 * g = `targetGoing` (ou 630 − 2h, h = H / n, cf. `SteppingSchema`). Ces fonctions sont pures et
 * exportées : le découpage doit les réutiliser pour obtenir **le même** n et le même g, ce qui
 * garantit que la ligne de foulée mesure exactement (n − 1)·g. `computeLayout` accepte aussi des
 * longueurs de volées déjà résolues (option `legLengths`) pour les appelants qui les calculent
 * autrement (assistant, énumération de variantes).
 */
import type { Mm } from "../model/primitives.js";
import type { Project } from "../model/project.js";
import { LF_WIDE_THRESHOLD } from "../rules/params.js";
import { getRule } from "../rules/table.js";
import { LayoutError } from "./errors.js";

/** Module de la valeur `auto` de `targetGoing` : g = 630 − 2h (commentaire de `SteppingSchema`). */
export const AUTO_GOING_MODULE = 630;
/** Bornes de `riserCount` (`SteppingSchema`). */
export const RISER_COUNT_MIN = 2;
export const RISER_COUNT_MAX = 60;

/**
 * Distance DTU de la ligne de foulée au bord intérieur quand E dépasse le seuil
 * (`LF_POSITION_DTU_LARGE` : « E > 1200 => d_lf = 600 »), lue dans rules.yaml.
 */
const DTU_WIDE_OFFSET: Mm = (() => {
  const min = getRule("LF_POSITION_DTU_LARGE").min;
  if (min === null) throw new Error("La règle LF_POSITION_DTU_LARGE n'a pas de seuil.");
  return min;
})();

/**
 * Distance d_f de la ligne de foulée de conception au bord intérieur (jour) :
 * DTU 36.3 (B §2.1) : E/2 si E ≤ 1 200 mm, sinon 600 mm ; ou distance saisie (`fromInner`).
 * @throws LayoutError si d_f n'est pas strictement comprise entre 0 et E.
 */
export function resolveWalklineOffset(project: Project): Mm {
  const width = project.stair.layout.width;
  const spec = project.stair.walkline;
  const d =
    spec.mode === "fromInner"
      ? spec.distance
      : width <= LF_WIDE_THRESHOLD.value
        ? width / 2
        : DTU_WIDE_OFFSET;
  if (!(d > 0 && d < width)) {
    throw new LayoutError(
      `La ligne de foulée (${d} mm du jour) doit être strictement comprise dans l'emmarchement (${width} mm).`,
    );
  }
  return d;
}

/**
 * Données suffisantes pour résoudre n et g (sous-ensemble structurel de `Project`) : les
 * préréglages les résolvent avant de connaître les volées.
 */
export interface RiserSizing {
  readonly site: Pick<Project["site"], "floorToFloor">;
  readonly stair: Pick<Project["stair"], "stepping">;
}

/**
 * Nombre de hauteurs n : valeur saisie, ou arrondi(H / targetRise).
 * @throws LayoutError si n sort de [2 ; 60].
 */
export function resolveRiserCount(project: RiserSizing): number {
  const s = project.stair.stepping;
  const n =
    s.riserCount === "auto" ? Math.round(project.site.floorToFloor / s.targetRise) : s.riserCount;
  if (!Number.isInteger(n) || n < RISER_COUNT_MIN || n > RISER_COUNT_MAX) {
    throw new LayoutError(
      `Nombre de hauteurs hors domaine : ${n} (attendu entre ${RISER_COUNT_MIN} et ${RISER_COUNT_MAX}).`,
    );
  }
  return n;
}

/**
 * Giron cible : valeur saisie, ou 630 − 2h avec h = H / n (hauteur nominale).
 * @throws LayoutError si le giron calculé n'est pas positif.
 */
export function resolveTargetGoing(project: RiserSizing, riserCount: number): Mm {
  const s = project.stair.stepping;
  const g =
    s.targetGoing === "auto"
      ? AUTO_GOING_MODULE - (2 * project.site.floorToFloor) / riserCount
      : s.targetGoing;
  if (!(g > 0)) {
    throw new LayoutError(
      `Giron cible non positif (${g.toFixed(1)} mm) : hauteur de marche trop grande.`,
    );
  }
  return g;
}

/** Reculement d'un escalier droit : R = (n − 1)·g. */
export function resolveStraightRun(project: Project): Mm {
  const n = resolveRiserCount(project);
  return (n - 1) * resolveTargetGoing(project, n);
}

/**
 * Longueurs des volées (bord extérieur), `auto` résolu.
 * @throws LayoutError si `auto` est employé hors d'un escalier droit.
 */
export function resolveLegLengths(project: Project): Mm[] {
  const { legs } = project.stair.layout;
  const hasAuto = legs.some((l) => l.length === "auto");
  if (!hasAuto) return legs.map((l) => l.length as Mm);
  if (legs.length !== 1) {
    throw new LayoutError(
      "La longueur « auto » n'est possible que pour un escalier droit (une seule volée).",
    );
  }
  return [resolveStraightRun(project)];
}
