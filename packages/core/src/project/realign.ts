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
 * **Cage saisie** (tracé libre, ADR-0010, sous-lot 2e) : même principe, seule la **partie
 * droite du dernier tronçon** change (`axis.length`, F11) ; les autres tronçons, les jonctions
 * (angles, raccords, paliers droits), les largeurs et le placement sont conservés. Sur un
 * trapèze ou une ligne de foulée oblique, 1 mm de tronçon ne vaut plus 1 mm de Γ : la longueur
 * est cherchée par la méthode de la sécante sur le tracé lui-même (`computeLayout`), puis
 * arrondie au mm. Refus : dernier tronçon à axe en arc (balayage et rayon à ajuster à la main),
 * palier mal placé (partie droite qui le précède hors d'un nombre entier de girons), H trop
 * faible. Le placement n'est jamais modifié (le recalage cale les hauteurs, pas l'implantation).
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
import type { CageLayoutSpec, Opening, Project, Turn } from "../model/project.js";
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

/**
 * Parties droites de Γ qui précèdent un palier (d'angle ou droit) : nombre entier de girons
 * cible, sinon refus (`onFail` construit le message, avec l'indice du tournant / de la jonction).
 */
function checkLandings(
  layout: Layout,
  g: Mm,
  onFail: (index: number, straight: Mm, count: number, gap: Mm) => Message,
): void {
  let cursor = 0;
  for (const t of layout.turns.filter((z) => z.mode === "landing")) {
    const straight = Math.max(0, t.sStart - cursor);
    cursor = t.sEnd;
    const count = Math.round(straight / g);
    const gap = count * g - straight;
    if (Math.abs(gap) > LANDING_STRAIGHT_TOLERANCE) {
      throw new MessageRangeError(onFail(t.index, straight, count, gap));
    }
  }
}

/** Longueur de Γ hors paliers (partie qui reçoit les girons). */
function walkOutsideLandings(layout: Layout): Mm {
  const landings = layout.turns.filter((t) => t.mode === "landing");
  return curveLength(layout.walkline) - landings.reduce((acc, t) => acc + (t.sEnd - t.sStart), 0);
}

/** Nombre maximal d'itérations de la sécante (convergence en 1 à 3 pas en pratique). */
const SECANT_ITERATIONS = 8;
/** Écart (mm) de Γ en deçà duquel la sécante s'arrête : bien en deçà de l'arrondi au mm. */
const SECANT_TOLERANCE = 1e-3;

/** Cage dont la partie droite du dernier tronçon vaut `length`. */
function withLastSectionLength(project: Project, spec: CageLayoutSpec, length: Mm): Project {
  const last = spec.sections.length - 1;
  const sections = spec.sections.map((s, i) =>
    i === last ? { ...s, axis: { kind: "straight" as const, length } } : s,
  );
  return { ...project, stair: { ...project.stair, layout: { ...spec, sections } } };
}

/**
 * Partie droite recalée du dernier tronçon d'une cage (voir l'en-tête), ou `null` si elle est
 * automatique (tronçon unique `auto`, conservé).
 * @throws RangeError si le recalage est impossible (arc, palier, H trop faible).
 */
function realignedLastSection(
  project: Project,
  spec: CageLayoutSpec,
  layout: Layout,
  n: number,
  g: Mm,
): Mm | null {
  const lastSection = spec.sections[spec.sections.length - 1]!;
  if (lastSection.axis.kind === "straight" && lastSection.axis.length === "auto") return null;
  checkLandings(layout, g, (index, straight) =>
    msg("project.realign.cageLandingNotWhole", {
      junction: index + 1,
      straight: mm(straight),
      going: mm(g),
    }),
  );
  const landings = layout.turns.filter((t) => t.mode === "landing").length;
  const target = (n - 1 - landings) * g;
  const residual = (l: Layout): Mm => walkOutsideLandings(l) - target;
  if (lastSection.axis.kind === "arc") {
    // Axe en arc : rien à recaler si Γ a déjà la longueur voulue (à l'arrondi au mm près).
    if (Math.abs(residual(layout)) <= LANDING_STRAIGHT_TOLERANCE) return null;
    throw new MessageRangeError(msg("project.realign.cageArcLast"));
  }
  const current = lastSection.axis.length as Mm;
  // Sécante sur la partie droite du dernier tronçon ; premier pas : 1 mm de tronçon = 1 mm de Γ.
  let x0 = current;
  let f0 = residual(layout);
  let x1 = current - f0;
  for (let i = 0; i < SECANT_ITERATIONS && Math.abs(f0) > SECANT_TOLERANCE; i++) {
    if (x1 < 0) {
      throw new MessageRangeError(
        msg("project.realign.cageHeightTooLow", { missing: mm(Math.ceil(-x1)) }),
      );
    }
    const f1 = residual(guarded(() => computeLayout(withLastSectionLength(project, spec, x1))));
    if (Math.abs(f1) <= SECANT_TOLERANCE || f1 === f0) {
      x0 = x1;
      f0 = f1;
      break;
    }
    const next = x1 - (f1 * (x1 - x0)) / (f1 - f0);
    x0 = x1;
    f0 = f1;
    x1 = next;
  }
  if (Math.abs(f0) > LANDING_STRAIGHT_TOLERANCE) {
    throw new MessageRangeError(msg("project.realign.cageNotConverged"));
  }
  const length = Math.round(x0);
  if (length < 0) {
    throw new MessageRangeError(
      msg("project.realign.cageHeightTooLow", { missing: mm(Math.ceil(-x0)) }),
    );
  }
  return length;
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
 * @throws RangeError si le tracé est hélicoïdal, si la position des tournants (jonctions) saisie
 *   rend le recalage impossible (H trop faible, palier hors d'un nombre entier de girons), ou si le
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
  let flights: Project = project;
  let legsChanged = false;
  if (spec.kind === "cage") {
    // Cage saisie : seule la partie droite du dernier tronçon change (voir l'en-tête).
    const length = realignedLastSection(project, spec, current, n, g);
    const last = spec.sections[spec.sections.length - 1]!.axis;
    if (length !== null && last.kind === "straight" && last.length !== length) {
      legsChanged = true;
      flights = withLastSectionLength(project, spec, length);
      notes.push(
        msg("project.realign.lastSection", {
          risers: String(n),
          going: mm(g),
          section: spec.sections.length,
          from: mm(last.length as Mm),
          to: mm(length),
        }),
      );
    }
  } else {
    const lengths = realignedLegs(project, current, n, g);
    legsChanged = lengths !== null && lengths.some((l, i) => spec.legs[i]?.length !== l);
    if (lengths !== null && legsChanged) {
      flights = {
        ...project,
        stair: {
          ...project.stair,
          layout: { ...spec, legs: lengths.map((length) => ({ length })) },
        },
      };
      const last = spec.legs.length;
      notes.push(
        msg("project.realign.lastFlight", {
          risers: String(n),
          going: mm(g),
          flight: last,
          from: mm(spec.legs[last - 1]!.length as Mm),
          to: mm(lengths[last - 1]!),
        }),
      );
    }
  }
  // Le tracé recalé doit être constructible (poteau, transition de Γ…) et non dégénéré : une
  // emprise dégénérée (`Layout.errors`, volées qui se touchent…) n'est pas levée par le tracé,
  // elle bloque donc le recalage ici, avec le message du tracé.
  const realigned = guarded(() => computeLayout(flights));
  if (realigned.errors !== undefined && realigned.errors.length > 0) {
    throw new MessageRangeError(realigned.errors[0]!);
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
  if (next === project) {
    const aligned =
      spec.kind === "cage"
        ? msg("project.realign.cageAlreadyAligned")
        : msg("project.realign.alreadyAligned");
    return { project, notes: [...notes, aligned] };
  }
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
