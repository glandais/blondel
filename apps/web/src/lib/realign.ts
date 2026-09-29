/**
 * Actions du formulaire du tracé (décisions A16 et A18 (a) de l'utilisateur) : bord de mesure
 * de la ligne de foulée d'un escalier droit, recalage des volées et de la trémie. Le calcul est
 * fait par le cœur (`realignFlightsAndOpening`) ; l'interface applique le projet rendu en une
 * seule modification (une seule entrée d'annulation) et affiche les remarques du cœur.
 */
import { realignFlightsAndOpening, type Project, type WalklineSide } from "@blondel/core";

/** Choix du formulaire : bord imposé, ou automatique (champ absent du projet). */
export type WalklineSideChoice = WalklineSide | "auto";

export interface RealignChoice {
  readonly project: Project;
  /** Message d'information (volées et trémie avant → après). */
  readonly notice: string;
}

/** Projet recalé et message ; lève `RangeError` (message du cœur) si le recalage est impossible. */
export function realign(project: Project): RealignChoice {
  const r = realignFlightsAndOpening(project);
  return { project: r.project, notice: r.notes.join(" ") };
}

/**
 * Aide du réglage du bord de mesure. Sans valeur chiffrée : le seuil d'emmarchement et la
 * distance DTU sont dans rules.yaml (`LF_POSITION_DTU_*`), pas recopiés dans l'interface.
 */
export const WALKLINE_SIDE_HINT =
  "Escalier droit : bord depuis lequel la ligne de foulée est placée (emmarchement large selon le DTU, ou distance imposée) ; automatique = côté de la main courante principale (vide avec garde-corps, sinon mur ; à défaut gauche)";

/** Bord de mesure saisi (`auto` si absent). */
export function walklineSideChoice(project: Project): WalklineSideChoice {
  return project.stair.walkline.side ?? "auto";
}

/** Projet avec le bord de mesure `choice` (`auto` retire le champ). */
export function withWalklineSide(project: Project, choice: WalklineSideChoice): Project {
  const { side: _side, ...rest } = project.stair.walkline;
  const walkline = choice === "auto" ? rest : { ...rest, side: choice };
  return { ...project, stair: { ...project.stair, walkline } };
}

/** Le réglage du bord de mesure s'applique-t-il (escalier droit à volées) ? */
export function walklineSideApplies(project: Project): boolean {
  const layout = project.stair.layout;
  return layout.kind !== "helical" && layout.turns.length === 0;
}
