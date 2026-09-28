/**
 * Édition structurelle du tracé (ajout et retrait de volées) : transformations pures du
 * `Project`. Les longueurs `auto` sont résolues par le cœur (`resolveLegLengths`), jamais
 * recalculées ici.
 */
import { resolveLegLengths, type Leg, type Project, type Turn } from "@blondel/core";

/**
 * Tournant ajouté après un escalier droit (aucun tournant à recopier) : valeur provisoire de
 * présentation, à ajuster par l'utilisateur (LEDGER §2).
 */
export const DEFAULT_NEW_TURN: Turn = {
  direction: "left",
  mode: "winders",
  inner: { kind: "sharp" },
};

/**
 * Le mode `auto` d'une longueur de volée n'existe que pour un escalier droit (une seule volée,
 * voir `LegSchema` et `resolveLegLengths`).
 */
export function legAutoAllowed(legCount: number): boolean {
  return legCount === 1;
}

/**
 * Ajoute une volée (copie de la dernière) et un tournant (copie du dernier, sinon
 * `DEFAULT_NEW_TURN`). Une longueur `auto` devient la longueur résolue par le cœur, arrondie au
 * mm (saisies en mm entiers, ADR-0003), puisque `auto` est interdit à plusieurs volées.
 *
 * @throws LayoutError (message pour l'utilisateur) si le cœur ne peut pas résoudre `auto`.
 */
export function addLeg(p: Project): Project {
  const l = p.stair.layout;
  const hasAuto = l.legs.some((leg) => leg.length === "auto");
  const legs: Leg[] = hasAuto
    ? resolveLegLengths(p).map((length) => ({ length: Math.max(1, Math.round(length)) }))
    : [...l.legs];
  const lastLeg = legs[legs.length - 1] as Leg;
  const lastTurn = l.turns[l.turns.length - 1] ?? DEFAULT_NEW_TURN;
  return {
    ...p,
    stair: {
      ...p.stair,
      layout: { ...l, legs: [...legs, { ...lastLeg }], turns: [...l.turns, { ...lastTurn }] },
    },
  };
}

/** Retire la dernière volée et le tournant qui la précède ; sans effet sur un escalier droit. */
export function removeLastLeg(p: Project): Project {
  const l = p.stair.layout;
  if (l.legs.length <= 1) return p;
  return {
    ...p,
    stair: {
      ...p.stair,
      layout: { ...l, legs: l.legs.slice(0, -1), turns: l.turns.slice(0, -1) },
    },
  };
}
