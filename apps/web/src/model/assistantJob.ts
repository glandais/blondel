/**
 * Calcul de l'assistant d'initialisation (worker dédié `assistant.worker.ts`, ou repli sur le
 * fil principal) : `proposeDesigns` du cœur, puis modèle et croquis en plan de chaque
 * candidat et de chacune de ses variantes. Tout le résultat est clonable (`postMessage`).
 */
import {
  buildModel,
  proposeDesigns,
  type AssistantInput,
  type AssistantResult,
} from "@blondel/core";
import { candidateSketch, displayedCandidates, type CandidateSketch } from "../lib/assistant.js";

export interface AssistantOutcome {
  readonly result: AssistantResult;
  /**
   * Croquis par identifiant de candidat, variantes comprises (absent si le modèle du candidat a
   * échoué).
   */
  readonly sketches: Readonly<Record<string, CandidateSketch>>;
  /** Durée totale (énumération, modèles des candidats, croquis), ms. */
  readonly timeMs: number;
}

/** Exécute l'assistant ; ne lève jamais (erreur rendue en diagnostic). */
export function runAssistantJob(
  input: AssistantInput,
  now: () => number = () => performance.now(),
): AssistantOutcome {
  const t0 = now();
  let result: AssistantResult;
  try {
    result = proposeDesigns(input);
  } catch (e) {
    result = {
      candidates: [],
      diagnostics: [`Erreur de l'assistant : ${e instanceof Error ? e.message : String(e)}`],
      rejections: [],
      stats: { enumerated: 0, built: 0, elapsedMs: 0, stopped: false, truncated: false },
    };
  }
  const sketches: Record<string, CandidateSketch> = {};
  for (const c of displayedCandidates(result.candidates)) {
    try {
      sketches[c.id] = candidateSketch(buildModel(c.project), c.project);
    } catch {
      // Croquis facultatif : la carte s'affiche sans miniature.
    }
  }
  return { result, sketches, timeMs: now() - t0 };
}
