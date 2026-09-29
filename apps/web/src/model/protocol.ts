/**
 * Messages échangés avec le Web Worker de calcul (`model.worker.ts`). Tout est clonable
 * (`postMessage`) : projet JSON, `Model` du cœur (objets simples), maillages en tableaux typés.
 */
import type { Project } from "@blondel/core";
import type { CompareOutcome, Variant } from "../lib/variants.js";
import type { ModelSnapshot } from "./snapshot.js";

export type WorkerRequest =
  | { readonly id: number; readonly type: "build"; readonly project: Project }
  | {
      readonly id: number;
      readonly type: "compare";
      readonly project: Project;
      readonly variants: readonly Variant[];
    };

export type WorkerResponse =
  | { readonly id: number; readonly type: "build"; readonly result: ModelSnapshot }
  | { readonly id: number; readonly type: "compare"; readonly result: CompareOutcome }
  | { readonly id: number; readonly type: "error"; readonly message: string };

/** Charge utile d'une requête, sans son identifiant (attribué par le client). */
export type WorkerJob =
  | { readonly type: "build"; readonly project: Project }
  | { readonly type: "compare"; readonly project: Project; readonly variants: readonly Variant[] };
