/**
 * Choix de l'écrivain DXF.
 *
 * Décision utilisateur du 2026-09-28 (LEDGER §2, remplace la décision 7bis / X14) :
 * **R12 (écrivain maison) par défaut pour les développés de pièces**, **AC1021 (2007) pour
 * les plans cotés** ; la version reste un paramètre d'export.
 */
import { Ac1021Writer } from "./ac1021.js";
import { R12Writer } from "./r12.js";
import type { DxfVersion, DxfWriter, DxfWriterOptions } from "./writer.js";

/** Version par défaut de `exportPartDxf` (découpe laser, plasma, CN : lecteurs les plus anciens). */
export const DEFAULT_PART_DXF_VERSION: DxfVersion = "R12";
/** Version par défaut de `exportPlanDxf`. */
export const DEFAULT_PLAN_DXF_VERSION: DxfVersion = "AC1021";

export function createDxfWriter(version: DxfVersion, options: DxfWriterOptions = {}): DxfWriter {
  switch (version) {
    case "R12":
      return new R12Writer(options);
    case "AC1021":
      return new Ac1021Writer(options);
    default: {
      const never: never = version;
      throw new RangeError(`Version DXF inconnue : ${String(never)}`);
    }
  }
}
