/**
 * Choix d'un préréglage dans l'interface : deux groupes, « Basiques » (formes nues du cœur,
 * `ALL_PRESET_IDS`) et « Démo » (escaliers complets et habillés, `DEMO_PRESET_IDS`), avec une
 * ligne de description pour chaque démo. Aucune valeur métier : libellés et projets viennent du
 * cœur.
 */
import {
  ALL_PRESET_IDS,
  DEMO_PRESET_DESCRIPTIONS,
  DEMO_PRESET_IDS,
  DEMO_PRESET_LABELS,
  PRESET_LABELS,
  isDemoPresetId,
  type DemoPresetId,
  type PresetId,
} from "@blondel/core";
import type { AppState, UpdateResult } from "../store/projectStore.js";

export type PresetChoice = PresetId | DemoPresetId;

export interface PresetItem {
  readonly id: PresetChoice;
  readonly label: string;
  /** Une ligne (démos seulement). */
  readonly description?: string;
}

export interface PresetGroup {
  readonly label: string;
  readonly items: readonly PresetItem[];
}

export const BASIC_GROUP_LABEL = "Basiques";
export const DEMO_GROUP_LABEL = "Démo";

/** Les deux groupes du sélecteur, dans l'ordre d'affichage. */
export const PRESET_GROUPS: readonly PresetGroup[] = [
  {
    label: BASIC_GROUP_LABEL,
    items: ALL_PRESET_IDS.map((id) => ({ id, label: PRESET_LABELS[id] })),
  },
  {
    label: DEMO_GROUP_LABEL,
    items: DEMO_PRESET_IDS.map((id) => ({
      id,
      label: DEMO_PRESET_LABELS[id],
      description: DEMO_PRESET_DESCRIPTIONS[id],
    })),
  },
];

/** Description d'une ligne du choix (démo), `undefined` pour un préréglage de base. */
export function presetDescription(id: PresetChoice): string | undefined {
  return isDemoPresetId(id) ? DEMO_PRESET_DESCRIPTIONS[id] : undefined;
}

/**
 * Applique le choix : démo (`loadDemo` : projet complet, onglet 3D, cadrage) ou préréglage de
 * base (`loadPreset`, comportement inchangé). Une seule entrée d'annulation dans les deux cas.
 */
export function applyPresetChoice(
  state: Pick<AppState, "loadDemo" | "loadPreset">,
  id: PresetChoice,
): UpdateResult {
  return isDemoPresetId(id) ? state.loadDemo(id) : state.loadPreset(id);
}
