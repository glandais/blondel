/**
 * Fonctions d'une cage (tracé libre, ADR-0010) qui vont au-delà d'un escalier à volées « de
 * base » (volées droites d'un même emmarchement, tournants à ±90° de même sens, jour vif, en arc
 * ou à poteau, mur vif). Lu par le garde-fou des structures (`StructureCapabilities.cage`, lot 2f)
 * et par la correction « reconvertir en volées » (liste vide).
 */
import type { CageLayoutSpec } from "./project.js";

/** Fonction d'une cage, dans l'ordre de `CAGE_FEATURES`. */
export type CageFeature =
  | "anyAngle"
  | "variableWidth"
  | "arcAxis"
  | "straightLanding"
  | "wallArc"
  | "chamfer"
  | "radiating"
  | "oppositeTurns";

/** Toutes les fonctions, dans l'ordre où `cageFeatures` les rend. */
export const CAGE_FEATURES: readonly CageFeature[] = [
  "anyAngle",
  "variableWidth",
  "arcAxis",
  "straightLanding",
  "wallArc",
  "chamfer",
  "radiating",
  "oppositeTurns",
];

/**
 * Fonctions utilisées par une cage, sans doublon, dans l'ordre de `CAGE_FEATURES` :
 * - `anyAngle` : une jonction d'angle autre que 0 et ±90° ;
 * - `variableWidth` : largeur non uniforme (`widthEnd` ≠ `width` dans un tronçon, ou tronçons de
 *   largeurs différentes : un escalier à volées n'a qu'un emmarchement) ;
 * - `arcAxis` : un tronçon à axe en arc ;
 * - `straightLanding` : une jonction d'angle 0 (palier droit) ;
 * - `wallArc` : un raccord côté mur en arc ;
 * - `chamfer` : un raccord côté jour en pan coupé ;
 * - `radiating` : une jonction en marches rayonnantes ;
 * - `oppositeTurns` : deux jonctions tournantes de sens opposés (S / Z). Un S / Z s'écrit aussi
 *   en volées, mais les structures à limons le refusent (`structures/legs.ts`) : la fonction est
 *   signalée pour que le garde-fou des structures la voie.
 *
 * Liste vide : la cage n'utilise aucune de ces fonctions ; elle a vocation à s'écrire en volées et
 * à passer partout où passe le tracé à volées équivalent, sous la convention de mesure de
 * `length` du sous-lot 1b : partie droite hors carrés d'angle E × E, une volée de longueur L à
 * k tournants voisins valant L − k·E (amendement 1b d'ADR-0010, `layout/cage/section.ts` ; à
 * valider, question F11). Un tronçon intermédiaire de longueur 0 (demi-tour par deux jonctions
 * de 90°, décision F4) se reconvertit en volée de 2E ; seul un tronçon **unique** de longueur 0
 * n'a pas d'équivalent en volées (`LegSchema` exige une longueur > 0) : `cageToFlights` rend
 * `null`. Les raccords `wallArc` et `chamfer` ne peuvent venir que d'une jonction tournante (le
 * schéma les refuse sur un palier droit).
 */
export function cageFeatures(spec: CageLayoutSpec): CageFeature[] {
  const found = new Set<CageFeature>();
  const widths = new Set<number>();
  for (const s of spec.sections) {
    widths.add(s.width);
    if (s.widthEnd !== undefined) widths.add(s.widthEnd);
    if (s.axis.kind === "arc") found.add("arcAxis");
  }
  if (widths.size > 1) found.add("variableWidth");
  let lastSign = 0;
  for (const j of spec.junctions) {
    const a = Math.abs(j.angle);
    if (a === 0) found.add("straightLanding");
    else if (a !== 90) found.add("anyAngle");
    if (j.wall.kind === "arc") found.add("wallArc");
    if (j.well.kind === "chamfer") found.add("chamfer");
    if (j.mode === "radiating") found.add("radiating");
    const sign = Math.sign(j.angle);
    if (sign !== 0) {
      if (lastSign !== 0 && sign !== lastSign) found.add("oppositeTurns");
      lastSign = sign;
    }
  }
  return CAGE_FEATURES.filter((f) => found.has(f));
}
