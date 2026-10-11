/**
 * Conversion entre un tracé à volées et une cage (ADR-0010, « les volées deviennent un
 * générateur de CAGE »).
 *
 * Une volée de longueur L (au mur, carrés d'angle E × E compris, `LegSchema`) avec k tournants
 * voisins devient un tronçon droit de largeur E et de longueur de partie droite L − k·E
 * (convention de `section.ts`, amendement d'ADR-0010) ; un tournant devient une jonction de
 * +90° (gauche) ou −90° (droite), de même mode, au raccord de jour identique (même objet) et au
 * mur vif. L'inverse (`cageToFlights`) n'existe que pour une cage qui s'écrit en volées.
 */
import type { Mm } from "../../model/primitives.js";
import type {
  CageJunction,
  CageLayoutSpec,
  CageSection,
  FlightsLayoutSpec,
  Leg,
  Turn,
} from "../../model/project.js";
import { cageFeatures } from "../../model/cageFeatures.js";
import { msg } from "@blondel/i18n";
import { LayoutError } from "../errors.js";

/** Tracé à volées vu par la conversion (`kind` ignoré, longueurs fournies à part). */
export type FlightsShape = Pick<FlightsLayoutSpec, "width" | "turns">;

/**
 * Cage équivalente à un tracé à volées dont les longueurs (au mur) sont déjà résolues
 * (`resolveLegLengths`, ou l'option `legLengths` de `computeLayout`). Mêmes contrôles, dans le
 * même ordre et avec les mêmes messages, que le moteur à volées avant tout calcul.
 *
 * **Adaptateur du moteur**, à calculer par `computeCageLayout(…, { origin: "flights" })`. La
 * sortie n'est valide au schéma (`CageLayoutSpecSchema`, `axis.length` ≥ 0) que si chaque volée
 * mesure au moins k·E (k tournants voisins) : une volée plus courte donne une partie droite
 * **négative**, gardée telle quelle pour que le moteur rende l'erreur `layout.legTooShort` du
 * moteur à volées (parité). Un chemin qui écrit la cage dans un projet (correction « convertir
 * en tracé libre ») doit d'abord calculer le tracé et refuser ce cas.
 *
 * @throws LayoutError si le nombre de tournants ou de longueurs est incohérent, ou si une
 *   longueur n'est pas finie et positive.
 */
export function flightsToCage(spec: FlightsShape, legLengths: readonly Mm[]): CageLayoutSpec {
  const width = spec.width;
  const turns = spec.turns;
  const legCount = turns.length + 1;
  if (legLengths.length !== legCount) {
    throw new LayoutError(
      msg("layout.legLengthCountMismatch", { given: legLengths.length, legs: legCount }),
    );
  }
  legLengths.forEach((l, i) => {
    if (!(Number.isFinite(l) && l > 0)) {
      throw new LayoutError(msg("layout.invalidLegLength", { flight: i + 1, length: String(l) }));
    }
  });
  const sections: CageSection[] = legLengths.map((length, i) => {
    const corners = (i > 0 ? 1 : 0) + (i < turns.length ? 1 : 0);
    return { axis: { kind: "straight", length: length - corners * width }, width };
  });
  const junctions: CageJunction[] = turns.map((t) => ({
    angle: t.direction === "left" ? 90 : -90,
    mode: t.mode,
    well: t.inner,
    wall: { kind: "sharp" },
  }));
  return { kind: "cage", sections, junctions, width, legs: [], turns: [] };
}

/**
 * Contrôle préalable du nombre de tournants d'un tracé à volées (N volées, N − 1 tournants),
 * même message que le moteur à volées. À appeler avant de résoudre les longueurs.
 * @throws LayoutError sinon.
 */
export function checkFlightsTopology(spec: Pick<FlightsLayoutSpec, "legs" | "turns">): void {
  if (spec.turns.length !== spec.legs.length - 1) {
    throw new LayoutError(
      msg("layout.turnCountMismatch", { legs: spec.legs.length, turns: spec.turns.length }),
    );
  }
}

/**
 * Tracé à volées équivalent à une cage, ou `null` si la cage ne s'écrit pas en volées : fonction
 * de cage autre que les tournants de sens opposés (`cageFeatures`, S / Z admis en volées),
 * partie droite négative (hors schéma), ou volée de longueur non positive (tronçon unique de
 * longueur 0). L'admission des S / Z vaut pour cette conversion seulement : la place d'un S / Z
 * dans la correction « reconvertir en volées » reste à trancher au lot 2e (ligne 0b du journal
 * `docs/ledger/LEDGER-free-2d.md`) ; cette correction filtrera `oppositeTurns` si besoin.
 * `anchor` est sans effet à largeur constante et n'est pas reporté. Une longueur `auto` (cage
 * d'un seul tronçon) reste `auto`. Inverse de `flightsToCage` :
 * `cageToFlights(flightsToCage(s, L))` rend `s` avec les longueurs `L`, sans `kind`.
 */
export function cageToFlights(cage: CageLayoutSpec): FlightsLayoutSpec | null {
  if (cageFeatures(cage).some((f) => f !== "oppositeTurns")) return null;
  const width = cage.sections[0]?.width;
  if (width === undefined || cage.junctions.length !== cage.sections.length - 1) return null;
  const last = cage.sections.length - 1;
  const legs: Leg[] = [];
  for (const [i, section] of cage.sections.entries()) {
    if (section.axis.kind !== "straight") return null;
    const straight = section.axis.length;
    if (straight === "auto") {
      legs.push({ length: "auto" });
      continue;
    }
    if (!(straight >= 0)) return null;
    const corners = (i > 0 ? 1 : 0) + (i < last ? 1 : 0);
    const length = straight + corners * width;
    if (!(length > 0)) return null;
    legs.push({ length });
  }
  const turns: Turn[] = [];
  for (const j of cage.junctions) {
    if (j.well.kind === "chamfer" || j.wall.kind !== "sharp" || j.mode === "radiating") return null;
    if (j.angle !== 90 && j.angle !== -90) return null;
    turns.push({ direction: j.angle > 0 ? "left" : "right", mode: j.mode, inner: j.well });
  }
  return { width, legs, turns };
}
