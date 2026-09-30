/**
 * Calques DXF traduits (ADR-0007) : chaque calque est décrit par la clé de son nom
 * (`dxf.layer.*`), sa couleur et son type de ligne ; le nom est traduit dans la langue de
 * l'export puis **toujours** passé par `sanitizeLayerName` (majuscules ASCII, sans espace), le
 * français rendant les noms historiques (CONTOUR, MARCHES, FOULEE…).
 */
import type { Locale, MessageKey } from "@blondel/i18n";
import type { Translator } from "../i18n.js";
import { sanitizeLayerName } from "./r12.js";
import type { DxfLayerDef, DxfLineType } from "./writer.js";

/** Description d'un calque avant traduction de son nom. */
export interface LayerSpec {
  readonly key: MessageKey;
  /** Couleur AutoCAD (ACI 1 … 255). */
  readonly color: number;
  readonly lineType?: DxfLineType;
}

const cache = new WeakMap<object, Map<Locale, unknown>>();

/** Calques d'une table de description, noms traduits (mémoïsés par table et par langue). */
export function localizedLayers<K extends string>(
  specs: Readonly<Record<K, LayerSpec>>,
  t: Translator,
): Readonly<Record<K, DxfLayerDef>> {
  let byLocale = cache.get(specs);
  if (byLocale === undefined) {
    byLocale = new Map();
    cache.set(specs, byLocale);
  }
  const hit = byLocale.get(t.locale) as Readonly<Record<K, DxfLayerDef>> | undefined;
  if (hit !== undefined) return hit;
  const out = {} as Record<K, DxfLayerDef>;
  for (const id of Object.keys(specs) as K[]) {
    const s = specs[id];
    const name = sanitizeLayerName(t.t(s.key));
    out[id] =
      s.lineType === undefined
        ? { name, color: s.color }
        : { name, color: s.color, lineType: s.lineType };
  }
  byLocale.set(t.locale, out);
  return out;
}
