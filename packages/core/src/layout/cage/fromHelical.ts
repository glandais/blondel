/**
 * Conversion d'un tracé **hélicoïdal** en cage d'un seul tronçon à axe en arc (F10, sous-lot P1,
 * ADR-0010) : `helicalToCage(project) → { project', spec, options }`, fonction pure, sans effet
 * sur le pipeline (`computeLayout` garde le moteur hélicoïdal pour `kind: "helical"`). Elle sert
 * au test de parité entre les deux moteurs (`helicalParity.test.ts`).
 *
 * ## Correspondance
 *
 * - Rayons : r_i = `core.radius`, R_e = `outerRadius`, emmarchement E = R_e − r_i (`width`).
 * - Un tronçon, aucune jonction : `axis = { kind: "arc", radius: r_i, sweep: σ·Θ° }`,
 *   `width = E`, `anchor` = côté de l'axe (`left` pour `direction: left`, `right` sinon) : le
 *   rayon de l'arc, mesuré sur le bord d'ancrage (F11), est r_i sans calcul ; le bord extérieur
 *   est au rayon r_i + E = R_e.
 * - Sens : σ = +1 à gauche (trigonométrique), −1 à droite ; le signe du balayage porte le sens,
 *   le côté intérieur de la courbure vaut `direction` (comme `Layout.innerSide`).
 * - Angle total : Θ° = `sweep.degrees` (mode `angle`) ou (n − 1)·360 / N (mode `treadsPerTurn`,
 *   n = `resolveRiserCount(project)`, conversion figée au n du projet). Θ peut dépasser 360°
 *   (jusqu'à 2 160°) : la cage est alors construite **hors schéma** (`CageAxisSchema` borne le
 *   balayage sous un tour) et calculée avec `options.origin = "helical"`, qui lève cette borne
 *   dans le moteur général (`general.ts`).
 * - Placement : repère local de la cage = ligne de départ (0, 0)–(E, 0), montée +Y. Avec
 *   α = `startAngle` + `placement.rotation` (degrés) et O l'origine (axe) de l'hélicoïdal :
 *   à gauche, centre local (−r_i, 0), rayon de départ d'angle 0, placement
 *   { origin: O + r_i·(cos α, sin α), rotation: α } ; à droite, centre local (E + r_i, 0),
 *   rayon de départ d'angle π, placement { origin: O + R_e·(cos α, sin α), rotation: α − 180 }.
 *   Le centre monde retombe sur O (au bruit d'arrondi près ; l'origine n'est plus en mm entiers,
 *   sans effet en P1 où rien n'est sérialisé).
 * - Ligne de foulée : même règle de d_f (`walklineOffsetFor` sur E, DTU ou `fromInner`) ; la
 *   cage la mesure depuis `walkline.side`, l'hélicoïdal toujours depuis l'axe : la conversion
 *   fixe `walkline.side = direction`, Γ est l'arc de rayon r_i + d_f.
 * - Fût / jour (`core.kind`) et palier d'arrivée en secteur (`landing.angle`) n'ont aucun champ
 *   de cage : ils passent par les options de calcul (`options.core`, `options.arrival`).
 * - Tout le reste du projet est repris tel quel (site, découpage, marches, surcharges de nez,
 *   balancement, structure).
 *
 * ## Contrôles
 *
 * Mêmes contrôles, dans le même ordre et avec les mêmes messages que `computeHelicalLayout` :
 * domaine de n (`layout.riserCountOutOfRange`), R_e > r_i (`layout.helical.outerRadiusBelow*`),
 * ligne de foulée dans l'emmarchement (`layout.walklineOutsideWidth`), angle par marche dans
 * ]0 ; 180°[ (`layout.helical.invalidStepAngle`).
 */
import type { CageLayoutSpec, HelicalLayoutSpec, Project } from "../../model/project.js";
import { msg } from "@blondel/i18n";
import { LayoutError } from "../errors.js";
import { helicalStepAngle } from "../helical.js";
import { resolveRiserCount, resolveWalklineOffset } from "../resolve.js";
import type { CageLayoutOptions } from "./cage.js";

/** Résultat de `helicalToCage`. */
export interface HelicalToCage {
  /** Projet dont seul le tracé est remplacé par la cage ; placement et côté de Γ recalés. */
  readonly project: Project;
  /** Cage d'un tronçon à axe en arc (`project.stair.layout`), hors schéma au-delà d'un tour. */
  readonly spec: CageLayoutSpec;
  /** Options de calcul (`computeCageLayout`) : origine `helical`, fût ou jour, palier d'arrivée. */
  readonly options: CageLayoutOptions;
}

/**
 * Convertit un projet hélicoïdal en projet à cage d'un tronçon à axe en arc (voir l'en-tête).
 * @throws LayoutError si le tracé n'est pas hélicoïdal ou si l'hélicoïdal est incalculable
 *   (mêmes messages que `computeHelicalLayout`).
 */
export function helicalToCage(project: Project): HelicalToCage {
  const helical = project.stair.layout;
  if (helical.kind !== "helical") {
    throw new LayoutError(msg("stepping.helical.flightLayout"));
  }
  const h: HelicalLayoutSpec = helical;
  const n = resolveRiserCount(project);
  const rIn = h.core.radius;
  const rOut = h.outerRadius;
  if (!(rOut > rIn)) {
    throw new LayoutError(
      msg(
        h.core.kind === "column"
          ? "layout.helical.outerRadiusBelowColumn"
          : "layout.helical.outerRadiusBelowWell",
        { outer: String(rOut), inner: String(rIn) },
      ),
    );
  }
  resolveWalklineOffset(project);
  helicalStepAngle(h, n);
  const width = rOut - rIn;
  const sign = h.direction === "left" ? 1 : -1;
  const thetaDeg = h.sweep.mode === "angle" ? h.sweep.degrees : ((n - 1) * 360) / h.sweep.count;

  const spec: CageLayoutSpec = {
    kind: "cage",
    sections: [
      { axis: { kind: "arc", radius: rIn, sweep: sign * thetaDeg }, width, anchor: h.direction },
    ],
    junctions: [],
    width,
    legs: [],
    turns: [],
  };

  const { origin, rotation } = project.stair.placement;
  const alphaDeg = h.startAngle + rotation;
  const alpha = (alphaDeg * Math.PI) / 180;
  const reach = h.direction === "left" ? rIn : rOut;
  const placement = {
    origin: { x: origin.x + reach * Math.cos(alpha), y: origin.y + reach * Math.sin(alpha) },
    rotation: h.direction === "left" ? alphaDeg : alphaDeg - 180,
  };
  const out: Project = {
    ...project,
    stair: {
      ...project.stair,
      placement,
      layout: spec,
      walkline: { ...project.stair.walkline, side: h.direction },
    },
  };
  return {
    project: out,
    spec,
    options: {
      origin: "helical",
      core: h.core.kind,
      ...(h.landing ? { arrival: { sweep: sign * h.landing.angle } } : {}),
    },
  };
}
