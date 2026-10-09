/**
 * Entraxes et pinces des organes de type tige dans le bois (QUESTIONS A34 (b), décision du
 * 2026-10-09) : NF EN 1995-1-1 § 8.5.1.1 (boulons, tableau 8.4) et § 8.6 (broches, tableau 8.5),
 * **norme non lue**, tableaux rapportés par C §1.11 [71] (Swedish Wood, tableaux 10.4 et 10.5,
 * p. 45 ; confiance moyenne), recoupés par [77]. Vis et tire-fonds de diamètre > 6 mm : règles
 * des boulons (EC5 § 8.7.1 via [71] § 10.6.1).
 *
 * d : diamètre de l'organe (mm, diamètre nominal : M10 → 10) ; α : angle entre l'effort et le
 * fil (radians). Fonctions pures, sans seuil caché : chaque coefficient est celui du tableau.
 *
 * `ec5Spacing(type, d)` sans angle rend les valeurs **« tous angles »** retenues par Blondel
 * faute de connaître la direction de l'effort (convention **à valider**, C §1.11 [CALCUL],
 * QUESTIONS A35 (e)) : a1, a2, a3,t, a4,t et a4,c sont l'enveloppe sur α (a1 au maximum de
 * |cos α|, a4,t au maximum de sin α) ; **a3,c ne l'est pas** : il est pris pour l'extrémité non
 * chargée la plus courante (150° ≤ α < 210°, effort dirigé vers l'intérieur de la pièce), soit
 * 4·d pour un boulon et max(3,5·d ; 40 mm) pour une broche, alors que son maximum sur α vaut
 * 7·d (boulon à 90°) et a3,t (broche à 90°). Les deux organes du limon central ne lisent pas la
 * même valeur : boulons et tire-fonds de marche à a3,c des bouts de l'assise (`bolts.edgeDistance`
 * `auto`), broches de platine à a3,t de la coupe au sol ou de la coupe de tête (extrémité
 * supposée chargée, plus sévère) ; choix à trancher (QUESTIONS A35 (e)).
 */
import { nominalDiameterFor } from "../fasteners/compute.js";
import type { Mm } from "../model/primitives.js";
import type { FastenerProfile } from "../workshop/fasteners.js";

/** Organe de type tige : boulon (vis et tire-fonds d > 6 mm compris) ou broche. */
export type WoodFastenerType = "bolt" | "dowel";

/** Entraxes et pinces minimaux (mm), notations de l'EC5. */
export interface Ec5Spacing {
  /** Entraxe parallèle au fil. */
  readonly a1: Mm;
  /** Entraxe perpendiculaire au fil. */
  readonly a2: Mm;
  /** Distance à une extrémité chargée. */
  readonly a3t: Mm;
  /** Distance à une extrémité non chargée. */
  readonly a3c: Mm;
  /** Distance à une rive chargée. */
  readonly a4t: Mm;
  /** Distance à une rive non chargée. */
  readonly a4c: Mm;
}

const DEG = Math.PI / 180;

/** Angle ramené dans [0 ; 360°[ (radians). */
function norm(alpha: number): number {
  const t = alpha % (2 * Math.PI);
  return t < 0 ? t + 2 * Math.PI : t;
}

/** a3,t = max(7·d ; 80 mm), boulons et broches. */
function a3tOf(d: Mm): Mm {
  return Math.max(7 * d, 80);
}

/**
 * Entraxes et pinces minimaux de l'EC5 pour un organe de diamètre `d` ; `alpha` (radians) :
 * angle effort / fil ; absent : valeurs « tous angles » (enveloppe, sauf a3,c : voir l'en-tête).
 */
export function ec5Spacing(type: WoodFastenerType, d: Mm, alpha?: number): Ec5Spacing {
  const a3t = a3tOf(d);
  if (alpha === undefined) {
    return type === "bolt"
      ? { a1: 5 * d, a2: 4 * d, a3t, a3c: 4 * d, a4t: 4 * d, a4c: 3 * d }
      : { a1: 5 * d, a2: 3 * d, a3t, a3c: Math.max(3.5 * d, 40), a4t: 4 * d, a4c: 3 * d };
  }
  const a = norm(alpha);
  const cos = Math.abs(Math.cos(a));
  const sin = Math.sin(a);
  // a4,t est défini pour 0° ≤ α ≤ 180° (sin α ≥ 0) ; hors de ce domaine, la rive est non chargée.
  const a4t = Math.max((2 + 2 * Math.max(0, sin)) * d, 3 * d);
  // a3,c est défini pour 90° ≤ α ≤ 270° ; hors de ce domaine, l'extrémité est chargée (a3,t).
  const inC = a >= 90 * DEG - 1e-12 && a <= 270 * DEG + 1e-12;
  const central = a >= 150 * DEG && a < 210 * DEG;
  if (type === "bolt") {
    const a3c = !inC ? a3t : central ? 4 * d : Math.max((1 + 6 * Math.abs(sin)) * d, 4 * d);
    return { a1: (4 + cos) * d, a2: 4 * d, a3t, a3c, a4t, a4c: 3 * d };
  }
  const a3c = !inC ? a3t : central ? Math.max(3.5 * d, 40) : Math.max(a3t * Math.abs(sin), 3 * d);
  return { a1: (3 + 2 * cos) * d, a2: 3 * d, a3t, a3c, a4t, a4c: 3 * d };
}

/** Pinces et entraxe des boulons (et tire-fonds) de marche du limon central bois, résolus. */
export interface WoodCentralBoltSpacing {
  /**
   * Diamètre nominal de l'organe (mm) : plus grand diamètre de la série du profil de visserie
   * qui passe dans `bolts.holeDiameter` avec le jeu minimal (M10 dans 11 mm) ; à défaut (série
   * vide, perçage trop petit), perçage moins le jeu.
   */
  readonly d: Mm;
  /** Valeurs « tous angles » de l'EC5 pour un boulon de diamètre `d` (a3,c : voir l'en-tête). */
  readonly ec5: Ec5Spacing;
  /** Entraxe minimal retenu (`bolts.minSpacing`, `auto` : a1 = 5·d). */
  readonly minSpacing: Mm;
  /** Distance minimale aux bouts de l'assise retenue (`bolts.edgeDistance`, `auto` : a3,c = 4·d). */
  readonly edgeDistance: Mm;
}

/**
 * Entraxe et pinces des boulons de marche (`bolts.*`, QUESTIONS A34 (b)) : valeurs saisies, ou
 * `auto` → bornes « tous angles » de l'EC5 (C §1.11 [71]). Contrat partagé : la poutre place
 * les boulons et tire-fonds avec, le plugin expose les valeurs `auto` retenues.
 */
export function woodCentralBoltSpacing(
  bolts: {
    readonly holeDiameter: Mm;
    readonly minSpacing: Mm | "auto";
    readonly edgeDistance: Mm | "auto";
  },
  fasteners: Pick<FastenerProfile, "nominalDiameters" | "holeClearance">,
): WoodCentralBoltSpacing {
  const nominal = nominalDiameterFor(
    bolts.holeDiameter,
    fasteners.nominalDiameters,
    fasteners.holeClearance,
  );
  const d = Number.isFinite(nominal)
    ? nominal
    : Math.max(1, bolts.holeDiameter - fasteners.holeClearance);
  const ec5 = ec5Spacing("bolt", d);
  return {
    d,
    ec5,
    minSpacing: bolts.minSpacing !== "auto" ? bolts.minSpacing : ec5.a1,
    edgeDistance: bolts.edgeDistance !== "auto" ? bolts.edgeDistance : ec5.a3c,
  };
}
