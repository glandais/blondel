/**
 * Conversion d'un projet entre tracé à volées et tracé libre (cage, ADR-0010, sous-lot 2e) :
 * fonctions pures, une seule modification du projet chacune (une entrée d'annulation dans
 * l'interface), tout le reste du projet conservé (mêmes objets).
 *
 * - `toCageLayout` (volées → cage) : chaque volée de longueur L (au mur) à k tournants voisins
 *   devient un tronçon droit de partie droite L − k·E (convention F11, `flightsToCage`), chaque
 *   tournant une jonction de ±90° de même mode et de même jour, mur vif. Refusée (`null`) si une
 *   volée est plus courte que ses carrés d'angle (partie droite négative, hors schéma) ou si un
 *   jour est à poteau (refusé en amont pour une cage saisie, `layout.cage.newelNotYetSupported`,
 *   tant que le développé du jour d'une cage n'existe pas). L'escalier droit de longueur `auto`
 *   devient un tronçon unique `auto`.
 * - `toFlightsLayout` (cage → volées, `cageToFlights`) : seulement pour une cage qui s'écrit en
 *   volées (fonctions de cage absentes, sauf tournants de sens opposés : un S / Z s'écrit en
 *   volées, à l'identique). Le tracé à volées obtenu n'a pas de `kind` (comme les projets
 *   enregistrés) : l'aller-retour `toFlightsLayout(toCageLayout(p))` rend `p` à l'identique
 *   (`toStrictEqual`). Le seuil `wallSharpWarningAngle` d'une cage (sans effet sur un tracé à
 *   volées, mur vif à ±90°) n'est pas reporté.
 *
 * La correction proposée « reconvertir en volées » (`suggestFixes`, `cage-to-flights`) repose
 * sur `toFlightsLayout`, pour une cage sans aucune fonction de cage (`cageFeatures` vide).
 */
import { flightsToCage, cageToFlights } from "../layout/cage/fromFlights.js";
import type { CageLayoutSpec, FlightsLayoutSpec, Project } from "../model/project.js";

/** Projet dont le tracé est `layout` (stair copié, reste du projet partagé). */
function withLayout(project: Project, layout: Project["stair"]["layout"]): Project {
  return { ...project, stair: { ...project.stair, layout } };
}

/**
 * Tracé libre équivalent à un tracé à volées, ou `null` (voir l'en-tête). Le tracé rendu a la
 * forme lue par le schéma (`CageLayoutSpecSchema` : `width` dérivée, `legs` et `turns` vides).
 */
export function flightsToCageLayout(spec: FlightsLayoutSpec): CageLayoutSpec | null {
  if (spec.turns.length !== spec.legs.length - 1) return null;
  if (spec.turns.some((t) => t.inner.kind === "newel")) return null;
  if (spec.legs.length === 1 && spec.legs[0]!.length === "auto") {
    return {
      kind: "cage",
      sections: [{ axis: { kind: "straight", length: "auto" }, width: spec.width }],
      junctions: [],
      width: spec.width,
      legs: [],
      turns: [],
    };
  }
  const lengths: number[] = [];
  for (const leg of spec.legs) {
    if (leg.length === "auto") return null;
    lengths.push(leg.length);
  }
  const cage = flightsToCage(spec, lengths);
  // Volée plus courte que ses carrés d'angle : partie droite négative, hors schéma.
  if (cage.sections.some((s) => s.axis.kind === "straight" && !(Number(s.axis.length) >= 0))) {
    return null;
  }
  return cage;
}

/** Projet au tracé à volées converti en cage (annulable), ou `null` (voir l'en-tête). */
export function toCageLayout(project: Project): Project | null {
  const spec = project.stair.layout;
  if (spec.kind === "helical" || spec.kind === "cage") return null;
  const cage = flightsToCageLayout(spec);
  return cage === null ? null : withLayout(project, cage);
}

/**
 * Projet à la cage reconvertie en volées, ou `null` si le tracé n'est pas une cage ou ne s'écrit
 * pas en volées (voir l'en-tête).
 */
export function toFlightsLayout(project: Project): Project | null {
  const spec = project.stair.layout;
  if (spec.kind !== "cage") return null;
  const flights = cageToFlights(spec);
  return flights === null ? null : withLayout(project, flights);
}
