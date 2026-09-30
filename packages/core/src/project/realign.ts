/**
 * Recalage des volées et de la trémie (décision A18 (a) de l'utilisateur, 2026-09-29, précisée
 * le 2026-09-30).
 *
 * Après une modification de H, de E, de l'épaisseur du plancher haut ou du réglage des hauteurs,
 * les longueurs de volées saisies ne donnent plus le giron cible et la trémie ne dégage plus
 * l'échappée. `realignFlightsAndOpening(project)` recalcule, en **une seule** modification du
 * projet (une seule entrée d'annulation dans l'interface) :
 *
 * - la **longueur de la dernière volée** seulement : n et g résolus comme le tracé
 *   (`resolveRiserCount`, `resolveTargetGoing`), la ligne de foulée hors paliers doit mesurer
 *   (n − 1 − paliers)·g ; l'écart est reporté sur la dernière volée (la ligne de foulée y est
 *   droite et parallèle au bord : 1 mm de volée = 1 mm de Γ). Les longueurs des autres volées,
 *   donc la **position des tournants saisie**, sont conservées, ainsi que le sens, le mode et
 *   le jour des tournants et tout le reste du projet (décision du 2026-09-30). La mesure de Γ
 *   vient du tracé lui-même (`computeLayout`) : d_f résolue, jour en arc, poteau, transition
 *   oblique d'un S / Z et nombre quelconque de tournants sont pris en compte sans formule de
 *   préréglage ; un U dont la partie droite intermédiaire est plus courte qu'un giron reste
 *   un U (sa volée intermédiaire n'est pas touchée). Avec un palier, chaque partie droite qui
 *   précède un palier doit contenir un nombre entier de girons cible (à l'arrondi au mm près des
 *   longueurs saisies), sinon le découpage donnerait des girons inégaux : le recalage est alors
 *   refusé, avec la longueur de volée qui garderait le palier au plus près ;
 * - la **trémie** rectangulaire par `computeOpening` (même calcul que les préréglages, jeu
 *   latéral `PRESET_OPENING_CLEARANCE` par défaut, à valider), si le projet a une trémie
 *   rectangulaire ; une trémie **polygonale** (saisie ou relevée) est conservée telle quelle ;
 *   un projet sans trémie (escalier extérieur) n'en reçoit pas.
 *
 * Refus (`RangeError`, message lisible, repris par `realignBlocker` pour désactiver le bouton de
 * l'interface avec son explication) : hélicoïdal, H trop faible pour la position des tournants
 * saisie (il manque de la ligne de foulée après le dernier tournant), palier mal placé (voir
 * ci-dessus), tracé recalé impossible (message du tracé). Un escalier droit de longueur `auto`,
 * ou une dernière volée `auto`, garde sa longueur automatique.
 *
 * Fonction pure.
 */
import { dec, msg, num, type Message, type NumberParam } from "@blondel/i18n";
import { curveLength } from "../geom2d/curve.js";
import { computeLayout } from "../layout/layout.js";
import { LayoutError } from "../layout/errors.js";
import { resolveRiserCount, resolveTargetGoing } from "../layout/resolve.js";
import type { Mm } from "../model/primitives.js";
import type { Layout } from "../model/derived.js";
import type { Opening, Project, Turn } from "../model/project.js";
import { SteppingError } from "../stepping/errors.js";
import { errorMessageOf, MessageRangeError } from "./errors.js";
import {
  computeOpening,
  PRESET_OPENING_CLEARANCE,
  requireOpeningClearance,
  type FlightsPresetId,
} from "./presets.js";

export interface RealignOptions {
  /** Jeu latéral de la trémie (mm, entier ≥ 0) ; défaut `PRESET_OPENING_CLEARANCE`. */
  readonly openingClearance?: number;
}

export interface RealignResult {
  /** Projet recalé (le projet d'entrée, inchangé, s'il était déjà calé). */
  readonly project: Project;
  /** Remarques à afficher : préréglage suivi, volées et trémie avant → après. */
  readonly notes: readonly Message[];
}

/** Longueur arrondie au mm, avec séparateur de milliers de la langue. */
const mm = (v: number): NumberParam => num(Math.round(v), 0);

/** Retrait de la partie droite de Γ de part et d'autre du coin intérieur (rayon du jour). */
const walkSetback = (t: Turn): Mm => (t.inner.kind === "arc" ? t.inner.radius : 0);

/** Convertit les erreurs du tracé et du découpage en `RangeError` (message conservé). */
function guarded<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof LayoutError || e instanceof SteppingError)
      throw new MessageRangeError(e.msg, { cause: e });
    throw e;
  }
}

/**
 * Préréglage de même topologie que le tracé à volées, ou `null` (information ; le recalage ne
 * s'en sert plus depuis le 2026-09-30 : il garde la position des tournants saisie).
 */
export function matchingFlightsPreset(project: Project, going: Mm): FlightsPresetId | null {
  const { turns, legs, width } = project.stair.layout;
  if (turns.length === 0) return "straight";
  if (turns.length === 1) {
    if (turns[0]!.mode === "landing") return "quarter-landing";
    return turns[0]!.direction === "left" ? "quarter-left" : "quarter-right";
  }
  if (turns.length === 2 && turns.every((t) => t.mode === "winders")) {
    if (turns[0]!.direction !== turns[1]!.direction) return "two-quarters-s";
    const middle = legs[1]!.length;
    if (middle === "auto") return null;
    const straight = middle - 2 * width - walkSetback(turns[0]!) - walkSetback(turns[1]!);
    return straight >= going ? "two-quarters-u" : "half-turn";
  }
  return null;
}

/**
 * Tolérance (mm) sur le nombre entier de girons d'une partie droite qui précède un palier :
 * arrondi au mm des deux longueurs de volées saisies qui la bornent (pas une valeur métier).
 */
const LANDING_STRAIGHT_TOLERANCE = 1;

/**
 * Longueurs de volées recalées : seule la dernière change (voir l'en-tête). `null` : dernière
 * volée en longueur automatique (conservée).
 * @throws RangeError si la position des tournants saisie rend le recalage impossible.
 */
function realignedLegs(project: Project, layout: Layout, n: number, g: Mm): Mm[] | null {
  const legs = project.stair.layout.legs;
  const lastLeg = legs[legs.length - 1]!.length;
  if (lastLeg === "auto") return null;
  const L = curveLength(layout.walkline);
  const landings = layout.turns.filter((t) => t.mode === "landing");
  // Parties droites qui précèdent un palier : nombre entier de girons cible.
  let cursor = 0;
  for (const t of landings) {
    const straight = Math.max(0, t.sStart - cursor);
    cursor = t.sEnd;
    // 0 giron (palier au départ ou entre deux tournants) est un nombre entier de girons : le
    // découpage rattache une partie droite vide au palier (relecture A18 a du 2026-09-30).
    const count = Math.round(straight / g);
    const gap = count * g - straight;
    if (Math.abs(gap) > LANDING_STRAIGHT_TOLERANCE) {
      const leg = legs[t.index]!.length;
      const params = { turn: t.index + 1, straight: mm(straight), going: mm(g) };
      throw new MessageRangeError(
        leg === "auto"
          ? msg("project.realign.landingNotWhole", params)
          : msg("project.realign.landingNotWholeFix", {
              ...params,
              length: mm(leg + gap),
              flight: t.index + 1,
              count: dec(count, 0),
            }),
      );
    }
  }
  const landingLength = landings.reduce((acc, t) => acc + (t.sEnd - t.sStart), 0);
  const target = (n - 1 - landings.length) * g;
  const delta = target - (L - landingLength);
  const lastTurn = layout.turns[layout.turns.length - 1];
  const lastStraight = L - (lastTurn?.sEnd ?? 0) + delta;
  if (lastStraight < 0) {
    throw new MessageRangeError(
      msg("project.realign.heightTooLow", { missing: mm(Math.ceil(-lastStraight)) }),
    );
  }
  const out = legs.map((l) => l.length as Mm);
  out[out.length - 1] = Math.round(lastLeg + delta);
  return out;
}

const openingText = (o: Opening): Message =>
  o.kind === "rect"
    ? msg("project.realign.openingRect", {
        sizeX: mm(o.sizeX),
        sizeY: mm(o.sizeY),
        x: mm(o.x),
        y: mm(o.y),
      })
    : msg("project.realign.openingPolygon", { count: String(o.points.length) });

/**
 * Recale les volées et la trémie sur H, E, la dalle et le réglage des hauteurs (voir l'en-tête).
 * @throws RangeError si le tracé est hélicoïdal, si la position des tournants saisie rend le
 *   recalage impossible (H trop faible, palier hors d'un nombre entier de girons), ou si le
 *   tracé recalé est impossible (message du tracé).
 */
export function realignFlightsAndOpening(
  project: Project,
  options: RealignOptions = {},
): RealignResult {
  const spec = project.stair.layout;
  if (spec.kind === "helical") {
    throw new MessageRangeError(msg("project.realign.helical"));
  }
  const clearance = options.openingClearance ?? PRESET_OPENING_CLEARANCE;
  requireOpeningClearance(clearance);
  const n = guarded(() => resolveRiserCount(project));
  const g = guarded(() => resolveTargetGoing(project, n));
  const current = guarded(() => computeLayout(project));
  const notes: Message[] = [];
  const lengths = realignedLegs(project, current, n, g);
  const legsChanged = lengths !== null && lengths.some((l, i) => spec.legs[i]?.length !== l);
  const flights: Project =
    lengths === null || !legsChanged
      ? project
      : {
          ...project,
          stair: {
            ...project.stair,
            layout: { ...spec, legs: lengths.map((length) => ({ length })) },
          },
        };
  // Le tracé recalé doit être constructible (poteau, transition de Γ…).
  guarded(() => computeLayout(flights));
  if (legsChanged) {
    const last = spec.legs.length;
    notes.push(
      msg("project.realign.lastFlight", {
        risers: String(n),
        going: mm(g),
        flight: last,
        from: mm(spec.legs[last - 1]!.length as Mm),
        to: mm(lengths![last - 1]!),
      }),
    );
  }

  let next = flights;
  const opening = project.site.opening;
  if (opening === undefined) {
    notes.push(msg("project.realign.noOpening"));
  } else if (opening.kind !== "rect") {
    notes.push(msg("project.realign.polygonKept", { opening: openingText(opening) }));
  } else {
    const rect = guarded(() => computeOpening(flights, clearance));
    if (rect === null) {
      notes.push(msg("project.realign.openingNotNeeded"));
    } else {
      const computed: Opening = { kind: "rect", ...rect };
      if (JSON.stringify(computed) !== JSON.stringify(opening)) {
        next = { ...flights, site: { ...flights.site, opening: computed } };
        notes.push(
          msg("project.realign.openingRealigned", {
            clearance: mm(clearance),
            from: openingText(opening),
            to: openingText(computed),
          }),
        );
      }
    }
  }
  if (next === project)
    return { project, notes: [...notes, msg("project.realign.alreadyAligned")] };
  if (legsChanged && project.stair.nosingOverrides.length > 0) {
    notes.push(msg("project.realign.overridesKept"));
  }
  return { project: next, notes };
}

/**
 * Raison pour laquelle le recalage est impossible (message du cœur, à afficher à côté du bouton
 * désactivé), ou `null` s'il est possible (y compris « déjà calé »).
 */
export function realignBlocker(project: Project, options: RealignOptions = {}): Message | null {
  try {
    realignFlightsAndOpening(project, options);
    return null;
  } catch (e) {
    return errorMessageOf(e);
  }
}
