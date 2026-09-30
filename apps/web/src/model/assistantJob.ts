/**
 * Calcul de l'assistant d'initialisation (worker dédié `assistant.worker.ts`, ou repli sur le
 * fil principal) : `proposeDesigns` du cœur, puis modèle et croquis en plan de chaque
 * proposition de la liste principale. Les croquis des **variantes repliées** sont calculés à la
 * demande (dépliage, `runSketchJob`, QUESTIONS D5) : 3 à 6 ms de modèle par variante, inutiles
 * tant qu'elles ne sont pas montrées. Tout le résultat est clonable (`postMessage`).
 */
import {
  buildModel,
  proposeDesigns,
  type AssistantInput,
  type AssistantResult,
  type Project,
} from "@blondel/core";
import { candidateSketch, type CandidateSketch } from "../lib/assistant.js";

export interface AssistantOutcome {
  readonly result: AssistantResult;
  /**
   * Croquis par identifiant de candidat de la liste principale (absent si le modèle du candidat
   * a échoué) ; ceux des variantes repliées sont demandés au dépliage (`runSketchJob`).
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
  const sketches = runSketchJob(result.candidates.map((c) => ({ id: c.id, project: c.project })));
  return { result, sketches, timeMs: now() - t0 };
}

/** Projet dont on demande le croquis (identifiant du candidat). */
export interface SketchRequest {
  readonly id: string;
  readonly project: Project;
}

/**
 * Croquis en plan des projets demandés (modèle complet de chacun) ; un modèle en échec est omis
 * (la carte s'affiche sans miniature). Ne lève jamais.
 */
export function runSketchJob(
  requests: readonly SketchRequest[],
): Readonly<Record<string, CandidateSketch>> {
  const sketches: Record<string, CandidateSketch> = {};
  for (const { id, project } of requests) {
    try {
      sketches[id] = candidateSketch(buildModel(project), project);
    } catch {
      // Croquis facultatif : la carte s'affiche sans miniature.
    }
  }
  return sketches;
}
