/**
 * Étape 2 du pipeline : le **tracé** (`computeLayout(project) → Layout`).
 *
 * Un seul chemin de calcul depuis le sous-lot 1c (ADR-0010) : un tracé à volées est converti en
 * cage (`flightsToCage`) puis calculé par le moteur de cage (`cage/cage.ts`, origine `flights` :
 * messages d'erreur du moteur à volées) ; une cage saisie est calculée par le même moteur
 * (origine `cage`) ; l'hélicoïdal garde son moteur (`helical.ts`). Le résultat d'un tracé à
 * volées est identique, champ pour champ, à celui de l'ancien moteur à volées (supprimé au
 * sous-lot 2f ; parité figée en instantanés, `cage/parity.test.ts`) ; `sections`
 * (tronçons) est en plus. Les conventions ci-dessous, établies pour les volées, sont celles du
 * moteur de cage à ±90°.
 *
 * Topologie explicite (docs/CHALLENGE.md G1) : N volées droites reliées par N − 1 tournants à
 * 90°, de même sens (quart tournant, U, demi-tournant) ou de sens opposés (S / Z). Les deux
 * bords et la ligne de foulée Γ sont construits **en forme fermée**, tournant par tournant
 * (droite / arc / droite), sans décalage générique de courbe.
 *
 * ## Repère local (voir `LayoutSpecSchema`)
 *
 * Départ sur le segment (0,0)–(E,0), montée selon +Y, x = 0 côté gauche. Pour chaque volée on
 * note A son origine sur le bord **gauche** (sur sa ligne de départ), u sa direction de montée
 * et r la normale unitaire gauche → droite. La longueur L d'une volée est mesurée hors tout le
 * long de u, carrés d'angle compris (c'est la longueur au mur pour un quart tournant ou un U) :
 * deux volées successives se recouvrent sur le carré d'angle E × E. Tournant à gauche :
 * u' = −r, coin intérieur K = A + (L − E)·u (bord gauche), coin du mur W = A + L·u + E·r.
 * Tournant à droite : u' = r, K = A + (L − E)·u + E·r (bord droit), W = A + L·u.
 *
 * ## Côtés du jour, S / Z (CHALLENGE G1)
 *
 * Chaque tournant a son jour (collet) du côté de son sens (`TurnZone.collarSide`). Chaque bord
 * porte le raccord de jour des tournants de son côté et l'angle vif du mur des autres.
 * `Layout.inner` est le bord du côté du jour du **premier** tournant (`innerSide`) et
 * `Layout.outer` l'autre, sur toute la montée : dans un S / Z, le jour du second tournant est
 * donc porté par `outer`.
 *
 * Ligne de foulée d'un S / Z : d_f est mesurée depuis le jour du tournant voisin. Quand
 * d_f = E/2 (E ≤ 1 200 mm en DTU), Γ reste au milieu, sans transition. Sinon (E > 1 200 mm :
 * 600 mm du côté intérieur, ou distance saisie) la position change de côté dans la volée
 * intermédiaire : **raccord linéaire** de d_f le long de la partie droite de cette volée
 * [défaut Blondel, DTU muet, point en suspens du ledger] — Γ y est un segment oblique, anguleux
 * à ses extrémités (`Layout.walklineTransitions`, angle signalé par le découpage). Une volée
 * intermédiaire sans partie droite de Γ est alors refusée (`LayoutError`) ; une partie droite
 * de moins d'un giron est refusée par le découpage (CHALLENGE G3 : pas de zone unique à travers
 * deux jours opposés).
 *
 * Escalier droit (décision A16) : d_f est mesurée depuis le bord gauche ou droit
 * (`stair.walkline.side`, sinon côté de la main courante principale, `walklineSide.ts`),
 * rendu dans `Layout.walklineSide` ; `innerSide` reste `left`.
 *
 * ## Raccords de jour (par tournant)
 *
 * - `sharp` : C_i a un angle vif en K ; Γ est l'arc de rayon d_f centré sur K (B §2.1 : « arc
 *   de cercle dont le centre est le point à l'intersection des faces internes des limons »).
 * - `arc` (rayon r) : C_i est raccordé par un arc de rayon r tangent aux deux faces internes,
 *   de centre F = K − r·n − r·u (dans le jour) ; Γ est l'arc concentrique de rayon r + d_f.
 *   Les parties droites de C_i et de Γ s'arrêtent à r avant K (points de tangence).
 * - `newel` (poteau carré de côté a, centré sur K, contrat `InnerCornerSchema`) : C_i suit le
 *   contour du poteau côté escalier (deux décrochements de a/2 dans les volées, puis les deux
 *   faces du poteau tournées vers l'escalier) ; Γ est l'arc de rayon d_f centré sur K, c'est-à-
 *   dire sur le point d'intersection des faces internes des limons (règle DTU ci-dessus), qui
 *   est ici le centre du poteau. Γ est donc identique au cas `sharp` ; sa distance au poteau
 *   est d_f − a·√2/2 au droit du coin du poteau (on exige d_f > a·√2/2).
 *   Poteau **décalé vers le jour** de δ (`offset`, poteau élargi des profilés, décision A13) :
 *   même contour avec des décrochements de s = a/2 + δ le long des faces et un débord de
 *   p = a/2 − δ côté marches (`newel.ts`) ; on exige δ < a/2 et d_f > p·√2.
 *
 * Le bord du mur reste toujours à angle vif en W.
 *
 * ## Palier d'angle (`mode: "landing"`)
 *
 * Choix : Γ garde **le même arc** que pour des marches balancées (et non un tracé en L). La
 * ligne de foulée ne dépend ainsi que de l'épure (même Γ quand on bascule balancé ↔ palier,
 * cf. CHALLENGE P2), reste continue en tangente et à distance d_f du jour. La zone du palier
 * est l'intervalle [sStart, sEnd] de la partie courbe : avec un jour à angle vif, les droites
 * perpendiculaires à Γ en sStart et sEnd sont exactement les bords du carré d'angle E × E.
 * Le découpage ne place aucun nez strictement à l'intérieur de cet intervalle.
 *
 * ## Emprise (`footprint`)
 *
 * Surface utile entre C_i et C_e, fermée par les lignes de départ et d'arrivée (polygone CCW,
 * arcs discrétisés à 0,1 mm de flèche). Le poteau et les limons (hors emmarchement utile,
 * CHALLENGE A3) n'en font pas partie.
 */
import { msg } from "@blondel/i18n";
import type { Layout } from "../model/derived.js";
import type { Mm } from "../model/primitives.js";
import type { Project } from "../model/project.js";
import { computeCageLayout } from "./cage/cage.js";
import { checkFlightsTopology, flightsToCage } from "./cage/fromFlights.js";
import { checkWellAngle } from "./cage/junction.js";
import { LayoutError } from "./errors.js";
import { computeHelicalLayout } from "./helical.js";
import { resolveLegLengths } from "./resolve.js";

export interface LayoutOptions {
  /**
   * Longueurs des volées déjà résolues (bord extérieur, mm). Remplacent celles du projet
   * (utile à l'assistant ou quand l'appelant a résolu `auto` lui-même). Sinon :
   * `resolveLegLengths(project)`. Sans effet sur un tracé hélicoïdal ou une cage.
   */
  readonly legLengths?: readonly Mm[];
}

/**
 * Calcule le tracé (bords, ligne de foulée, tournants, tronçons, emprise) d'un projet, en repère
 * monde. Un tracé hélicoïdal (`kind: "helical"`) est délégué à `computeHelicalLayout` ; un tracé
 * à volées et une cage (`kind: "cage"`, ADR-0010) au moteur de cage (`computeCageLayout`).
 *
 * @throws LayoutError si la topologie n'est pas prise en charge (nombre de tournants
 *   incohérent, `auto` hors escalier droit, fonction de la cage pas encore calculée ou dont
 *   l'aval n'est pas encore fiable : jour à poteau d'une cage saisie) ou si les
 *   cotes sont impossibles (volée ou tronçon trop court pour ses raccords ou pour la transition
 *   de la ligne de foulée d'un S, ligne de foulée hors emmarchement ou traversant un poteau).
 */
export function computeLayout(project: Project, options: LayoutOptions = {}): Layout {
  const spec = project.stair.layout;
  // Tracé hélicoïdal (jalon 5a) : forme fermée propre, `layout/helical.ts`.
  if (spec.kind === "helical") return computeHelicalLayout(project, spec);
  // Tracé libre (CAGE, ADR-0010) : vocabulaire « tronçon », borne `CAGE_MAX_SECTIONS`.
  if (spec.kind === "cage") {
    // Jour à poteau à ±90° : le moteur le calcule, mais l'aval (découpage par angle, développé
    // du jour, garde-corps) lit encore les poteaux dans `stair.layout.turns`, vide pour une
    // cage (lots 2c / 2d) : refus explicite plutôt qu'un modèle faux sans erreur (ADR-0010 §5).
    // À un autre angle, refus définitif du poteau (décision F5, `checkWellAngle`). Les deux
    // refus sont rendus dans l'ordre des jonctions (première jonction refusée).
    spec.junctions.forEach((j, i) => {
      checkWellAngle(j, i);
      if (j.well.kind === "newel") {
        throw new LayoutError(msg("layout.cage.newelNotYetSupported", { junction: i + 1 }));
      }
    });
    // Marque « cage saisie » (`Layout.cage`) : les exports cotent alors par tronçon (F11).
    return { ...computeCageLayout(project, spec, { origin: "cage" }), cage: true };
  }
  // Tracé à volées : générateur de cage, mêmes contrôles et mêmes messages que l'ancien moteur.
  checkFlightsTopology(spec);
  const lengths = options.legLengths ? [...options.legLengths] : resolveLegLengths(project);
  return computeCageLayout(project, flightsToCage(spec, lengths), { origin: "flights" });
}
