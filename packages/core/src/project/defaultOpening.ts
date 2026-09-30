/**
 * Trémie proposée quand l'utilisateur en ajoute une à un projet qui n'en a pas (case « Trémie
 * dans le plancher haut » de l'interface) : **même calcul que les préréglages** (QUESTIONS D6),
 * au lieu d'une valeur provisoire de l'interface.
 *
 * - Escalier à volées : `computeOpening` (échappée `PRESET_HEADROOM_MIN` sur la ligne de foulée,
 *   jeu latéral `PRESET_OPENING_CLEARANCE`, à valider).
 * - Hélicoïdal : cercle (polygone inscrit) de rayon R_e + `PRESET_OPENING_CLEARANCE`, sortie
 *   vers la dalle au droit du palier d'arrivée (`helicalOpening`, comme le préréglage).
 *
 * `null` : aucune trémie n'est nécessaire (dalle assez haute) ou le tracé est impossible ;
 * l'appelant garde alors sa propre proposition. Ne lève jamais.
 */
import type { Opening, Project } from "../model/project.js";
import { computeOpening, PRESET_OPENING_CLEARANCE } from "./presets.js";
import { helicalOpening } from "./presetHelical.js";

export function defaultOpening(project: Project): Opening | null {
  try {
    const layout = project.stair.layout;
    if (layout.kind === "helical")
      return helicalOpening(project, layout.outerRadius + PRESET_OPENING_CLEARANCE, "circle");
    const rect = computeOpening(project, PRESET_OPENING_CLEARANCE);
    return rect ? { kind: "rect", ...rect } : null;
  } catch {
    return null;
  }
}
