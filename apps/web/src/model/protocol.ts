/**
 * Messages échangés avec le Web Worker de calcul (`model.worker.ts`). Tout est clonable
 * (`postMessage`) : projet JSON, `Model` du cœur (objets simples), maillages en tableaux typés,
 * octets du dossier PDF et du modèle glTF (tampons transférés, sans copie).
 */
import type { PlanPreview, Project } from "@blondel/core";
import type { Locale, Message } from "@blondel/i18n";
import type { PdfJobOptions } from "../lib/optionalApi.js";
import type { CompareOutcome, Variant } from "../lib/variants.js";
import type { ModelSnapshot } from "./snapshot.js";

export type WorkerRequest =
  | { readonly id: number; readonly type: "build"; readonly project: Project }
  | { readonly id: number; readonly type: "preview"; readonly project: Project }
  | {
      readonly id: number;
      readonly type: "compare";
      readonly project: Project;
      readonly variants: readonly Variant[];
    }
  | {
      readonly id: number;
      readonly type: "pdf";
      readonly project: Project;
      /**
       * Pages, format, gabarits et valeurs ◆ du dossier (absent : dossier complet, A4, sans
       * page des valeurs à valider).
       */
      readonly options?: PdfJobOptions;
      /** Langue du dossier (absent : français). */
      readonly locale?: Locale;
    }
  | {
      readonly id: number;
      readonly type: "glb";
      readonly project: Project;
      /** Langue des noms du modèle glTF (absent : français). */
      readonly locale?: Locale;
    };

/**
 * Résultat d'un export PDF : les octets, ou le motif d'un échec **de l'export** (modèle
 * incalculable, rendu impossible), en `Message` traduit à l'affichage (il suit un changement de
 * langue). Un tel échec n'est pas une panne du worker : il est rendu à l'appelant sans repli
 * sur le fil principal.
 *
 * Le job `build` ne reçoit pas la langue : le `Model` est neutre (ADR-0007).
 */
export type PdfResult = { readonly bytes: Uint8Array } | { readonly error: Message };

/**
 * Aperçu de l'éditeur de plan pendant un glisser (ADR-0010, sous-lot 4c) : tracé, découpage
 * léger et conflits géométriques d'adéquation au site (`buildPlanPreview` du cœur), sans pièce,
 * maillage ni contrôle ; erreurs en `Message` (l'aperçu ne lève jamais). `timeMs` : durée du
 * calcul dans le worker.
 */
export interface PreviewResult extends PlanPreview {
  readonly timeMs: number;
}

/** Résultat d'un export glTF binaire (.glb) : mêmes conventions que `PdfResult`. */
export type GlbResult = PdfResult;

export type WorkerResponse =
  | { readonly id: number; readonly type: "build"; readonly result: ModelSnapshot }
  | { readonly id: number; readonly type: "preview"; readonly result: PreviewResult }
  | { readonly id: number; readonly type: "compare"; readonly result: CompareOutcome }
  | { readonly id: number; readonly type: "pdf"; readonly result: PdfResult }
  | { readonly id: number; readonly type: "glb"; readonly result: GlbResult }
  | { readonly id: number; readonly type: "error"; readonly message: string };

/** Charge utile d'une requête, sans son identifiant (attribué par le client). */
export type WorkerJob =
  | { readonly type: "build"; readonly project: Project }
  | { readonly type: "preview"; readonly project: Project }
  | { readonly type: "compare"; readonly project: Project; readonly variants: readonly Variant[] }
  | {
      readonly type: "pdf";
      readonly project: Project;
      readonly options?: PdfJobOptions;
      readonly locale?: Locale;
    }
  | { readonly type: "glb"; readonly project: Project; readonly locale?: Locale };
