/**
 * Actions du formulaire du tracé (décisions A16 et A18 (a) de l'utilisateur) : bord de mesure
 * de la ligne de foulée d'un escalier droit, recalage des volées et de la trémie. Le calcul est
 * fait par le cœur (`realignFlightsAndOpening`) ; l'interface applique le projet rendu en une
 * seule modification (une seule entrée d'annulation) et affiche les remarques du cœur.
 */
import {
  realignBlocker,
  realignFlightsAndOpening,
  type Project,
  type WalklineSide,
} from "@blondel/core";
import type { Message, MessageKey } from "@blondel/i18n";
import { joinMessages } from "../i18n/text.js";

/** Choix du formulaire : bord imposé, ou automatique (champ absent du projet). */
export type WalklineSideChoice = WalklineSide | "auto";

export interface RealignChoice {
  readonly project: Project;
  /** Message d'information (volées et trémie avant → après), `null` sans remarque. */
  readonly notice: Message | null;
}

/** Projet recalé et message ; lève `RangeError` (message du cœur) si le recalage est impossible. */
export function realign(project: Project): RealignChoice {
  const r = realignFlightsAndOpening(project);
  return { project: r.project, notice: joinMessages(r.notes) };
}

/**
 * Raison pour laquelle le bouton « Recaler volées et trémie » est désactivé (message du cœur :
 * position des tournants saisie incompatible avec H, palier hors d'un nombre entier de girons,
 * hélicoïdal…), ou `null` s'il est actif (décision A18 (a) du 2026-09-30).
 */
export function realignDisabledReason(project: Project): Message | null {
  return realignBlocker(project);
}

/** Infobulle du bouton de recalage actif (clé, traduite à l'affichage). */
export const REALIGN_HINT_KEY: MessageKey = "ui.lib.realign.hint";

/**
 * Aide du réglage du bord de mesure (clé, traduite à l'affichage). Sans valeur chiffrée : le
 * seuil d'emmarchement et la distance DTU sont dans rules.yaml (`LF_POSITION_DTU_*`), pas
 * recopiés dans l'interface.
 */
export const WALKLINE_SIDE_HINT_KEY: MessageKey = "ui.lib.realign.walklineSideHint";

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
