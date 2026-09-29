/**
 * Réglages par défaut de l'assistant. Aucun n'est une règle métier : ce sont des choix
 * d'exploration ou de présentation **[choix Blondel, à valider]** (LEDGER §2), tous
 * modifiables par `AssistantInput.limits` / `weights`.
 */
import { AUTO_GOING_MODULE } from "../layout/resolve.js";
import type { ScoreWeights } from "./types.js";

export const ASSISTANT_DEFAULTS = {
  /** Candidats rendus. */
  maxCandidates: 10,
  /** Candidats rendus par typologie et sens (diversité de la liste). */
  perGroupLimit: 3,
  /** Modèles complets construits au plus (≈ 3 à 6 ms chacun, ADR-0006). */
  maxBuilds: 180,
  /** Budget de temps (ms) de l'évaluation : sous les 2 s du cas d'acceptation (G8). */
  timeBudgetMs: 1500,
  /** Pas de la recherche du giron (mm), comme la grille de 5 mm de CHALLENGE-panel (G8). */
  goingStep: 5,
  /** Pas de la grille d'emmarchement (mm) et nombre de valeurs au-delà du minimum. */
  widthStep: 100,
  widthSteps: 2,
  /**
   * Emmarchement de départ de la grille quand aucune règle active ne borne E (ni minimum, ni
   * valeur recommandée) : jamais atteint avec rules.yaml.
   */
  widthFallback: 800,
  /**
   * Part du budget de temps réservée à l'étage analytique (énumération) ; le reste va aux
   * modèles complets (qui s'arrêtent de toute façon au budget total).
   */
  enumerationShare: 0.8,
  /**
   * Équité de l'énumération : un groupe typologie × sens dispose au plus de ce nombre de parts
   * égales du temps restant (les groupes rapides laissent leur temps aux suivants).
   */
  enumerationGroupFactor: 3,
  /** Emmarchement maximal exploré : ligne de foulée au milieu (`LF_POSITION_DTU_ETROIT`). */
  widthMax: 1200,
  /**
   * Jour (partie droite intérieure) de la volée centrale : deux quarts tournants (U) et
   * demi-tournant. Mêmes valeurs que les préréglages `two-quarters-u` et `half-turn`
   * (`project/presets.ts`, déjà « à valider ») ; le demi-tournant garde une volée centrale de
   * moins d'un giron (zone unique de 180°, CHALLENGE G3).
   */
  uMiddleWell: 400,
  halfTurnMiddleWell: 240,
  /** Replis si aucune règle active ne borne h ou le module (jamais atteints avec rules.yaml). */
  riseMaxFallback: 210,
  riseMinFallback: 160,
  blondelTargetFallback: AUTO_GOING_MODULE,
  /** Tolérance (mm) de contact : un escalier au nu d'un mur ou d'une trémie est admis. */
  contactTolerance: 0.5,
} as const;

/** Poids par défaut du score **[choix Blondel, à valider]**. */
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  blondel: 1,
  collet: 0.2,
  headroom: 0.05,
  winders: 2,
  regularity: 1,
  warnings: 5,
};
