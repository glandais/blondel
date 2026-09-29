/**
 * Recalage des volées et de la trémie (décision A18 (a) de l'utilisateur, 2026-09-29).
 *
 * Après une modification de H, de E, de l'épaisseur du plancher haut ou du réglage des hauteurs,
 * les longueurs de volées saisies ne donnent plus le giron cible et la trémie ne dégage plus
 * l'échappée. `realignFlightsAndOpening(project)` recalcule, en **une seule** modification du
 * projet (une seule entrée d'annulation dans l'interface) :
 *
 * - les **longueurs de volées** par la logique des préréglages du cœur (`presets.ts`) : n et g
 *   résolus comme le tracé (`resolveRiserCount`, `resolveTargetGoing`), proportions du
 *   préréglage de même topologie (`FLIGHTS_PRESET_SHAPES` : premier tournant à k girons du
 *   départ, jour ou partie droite intermédiaire), la dernière volée prenant le reste de la
 *   ligne de foulée (n − 1)·g. Le sens des tournants, leur mode, leur jour et tout le reste du
 *   projet sont conservés. Généralisations par rapport aux préréglages (qui supposent un jour
 *   vif et Γ au milieu) : d_f résolue (`resolveWalklineOffset`, E > 1 200 mm compris), jour en
 *   arc (Γ de rayon r + d_f, parties droites raccourcies de r), transition oblique de Γ d'un
 *   S / Z (partie droite de Γ de longueur M, axe √(M² − Δo²)) ;
 * - la **trémie** rectangulaire par `computeOpening` (même calcul que les préréglages, jeu
 *   latéral `PRESET_OPENING_CLEARANCE` par défaut, à valider), si le projet a une trémie ; un
 *   projet sans trémie (escalier extérieur) n'en reçoit pas.
 *
 * Topologies reconnues : droit, quart tournant (balancé ou palier), deux quarts de même sens
 * (U si la partie droite intermédiaire de Γ atteint un giron cible, demi-tournant sinon) ou de
 * sens opposés (S / Z). Un hélicoïdal ou une autre topologie est refusé (`RangeError`). Un
 * escalier droit de longueur `auto` garde sa longueur automatique.
 *
 * Limite : les proportions du préréglage remplacent la position des tournants saisie (le
 * recalage ne peut pas savoir quelle cote l'utilisateur voulait garder) ; l'annulation rend
 * l'état antérieur.
 *
 * Fonction pure.
 */
import { computeLayout } from "../layout/layout.js";
import { LayoutError } from "../layout/errors.js";
import { resolveRiserCount, resolveTargetGoing, resolveWalklineOffset } from "../layout/resolve.js";
import type { Mm } from "../model/primitives.js";
import type { Opening, Project, Turn } from "../model/project.js";
import { SteppingError } from "../stepping/errors.js";
import {
  computeOpening,
  FLIGHTS_PRESET_SHAPES,
  PRESET_LABELS,
  PRESET_OPENING_CLEARANCE,
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
  readonly notes: readonly string[];
}

const fmt = (v: number): string => Math.round(v).toLocaleString("fr-FR");

/** Retrait de la partie droite de Γ de part et d'autre du coin intérieur (rayon du jour). */
const walkSetback = (t: Turn): Mm => (t.inner.kind === "arc" ? t.inner.radius : 0);

/** Convertit les erreurs du tracé et du découpage en `RangeError` (message conservé). */
function guarded<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof LayoutError || e instanceof SteppingError) throw new RangeError(e.message);
    throw e;
  }
}

/** Préréglage de même topologie que le tracé à volées, ou `null`. */
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

/** Longueurs de volées recalées (bord extérieur, mm entiers). */
function realignedLegs(project: Project, preset: FlightsPresetId, n: number, g: Mm): Mm[] {
  const shape = FLIGHTS_PRESET_SHAPES[preset];
  const { turns, width } = project.stair.layout;
  const df = guarded(() => resolveWalklineOffset(project));
  const r = turns.map(walkSetback);
  if (shape.mode === "landing") {
    const a = shape.firstStraightGoings;
    const b = n - 2 - a;
    if (b < 1)
      throw new RangeError("Hauteur à monter trop faible pour un quart tournant avec palier.");
    return [Math.round(a * g + width + r[0]!), Math.round(b * g + width + r[0]!)];
  }
  const total = (n - 1) * g;
  if (turns.length === 0) return [Math.round(total)];
  const offset = (t: Turn): Mm => (t.direction === "left" ? df : width - df);
  const first = shape.firstStraightGoings * g;
  const arcs = turns.reduce((acc, _t, j) => acc + (Math.PI / 2) * (r[j]! + df), 0);
  const middles: { gamma: Mm; axis: Mm }[] = [];
  for (let j = 0; j + 1 < turns.length; j++) {
    const gamma = shape.middleGoings !== undefined ? shape.middleGoings * g : shape.middleWell;
    const shift = Math.abs(offset(turns[j]!) - offset(turns[j + 1]!));
    if (gamma <= shift) {
      throw new RangeError(
        `Volée ${j + 2} : la partie droite de la ligne de foulée (${fmt(gamma)} mm) ne permet pas son passage d'un côté à l'autre (${fmt(shift)} mm).`,
      );
    }
    middles.push({ gamma, axis: Math.sqrt(gamma * gamma - shift * shift) });
  }
  const last = total - first - arcs - middles.reduce((acc, m) => acc + m.gamma, 0);
  if (last < 0) {
    throw new RangeError(
      `Hauteur à monter trop faible pour ce tracé : il manque ${Math.ceil(-last)} mm de ligne de foulée.`,
    );
  }
  const legs = [Math.round(first + width + r[0]!)];
  middles.forEach((m, j) => legs.push(Math.round(m.axis + 2 * width + r[j]! + r[j + 1]!)));
  legs.push(Math.round(last + width + r[r.length - 1]!));
  return legs;
}

const openingText = (o: Opening): string =>
  o.kind === "rect"
    ? `${fmt(o.sizeX)} × ${fmt(o.sizeY)} mm au coin (${fmt(o.x)} ; ${fmt(o.y)})`
    : `polygone de ${o.points.length} sommets`;

/**
 * Recale les volées et la trémie sur H, E, la dalle et le réglage des hauteurs (voir l'en-tête).
 * @throws RangeError si le tracé est hélicoïdal ou sans préréglage de même topologie, si H est
 *   trop faible pour la forme, ou si le tracé recalé est impossible (message du tracé).
 */
export function realignFlightsAndOpening(
  project: Project,
  options: RealignOptions = {},
): RealignResult {
  const spec = project.stair.layout;
  if (spec.kind === "helical") {
    throw new RangeError(
      "Recalage sans objet pour un hélicoïdal : ses marches suivent H (angle par marche) ; recalculer la trémie depuis le préréglage hélicoïdal.",
    );
  }
  const clearance = options.openingClearance ?? PRESET_OPENING_CLEARANCE;
  if (!Number.isInteger(clearance) || clearance < 0) {
    throw new RangeError(
      `Le jeu latéral de la trémie doit être un entier positif ou nul en mm (reçu : ${clearance}).`,
    );
  }
  const n = guarded(() => resolveRiserCount(project));
  const g = guarded(() => resolveTargetGoing(project, n));
  const preset = matchingFlightsPreset(project, g);
  if (preset === null) {
    throw new RangeError(
      `Recalage impossible : aucun préréglage de même topologie (${spec.turns.length} tournants). Ajuster les volées à la main ou par l'assistant.`,
    );
  }
  const notes: string[] = [];
  const autoStraight = spec.legs.length === 1 && spec.legs[0]!.length === "auto";
  const lengths = autoStraight ? null : realignedLegs(project, preset, n, g);
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
    notes.push(
      `Volées recalées selon le préréglage « ${PRESET_LABELS[preset]} » (${n} hauteurs, giron cible ${fmt(g)} mm) : ${spec.legs
        .map((l, i) => `${l.length === "auto" ? "auto" : fmt(l.length)} → ${fmt(lengths![i]!)}`)
        .join(", ")} mm.`,
    );
  }

  let next = flights;
  const opening = project.site.opening;
  if (opening === undefined) {
    notes.push("Pas de trémie dans le projet : aucune trémie ajoutée.");
  } else {
    const rect = guarded(() => computeOpening(flights, clearance));
    if (rect === null) {
      notes.push("Aucune trémie n'est nécessaire à l'échappée : trémie conservée.");
    } else {
      const computed: Opening = { kind: "rect", ...rect };
      if (JSON.stringify(computed) !== JSON.stringify(opening)) {
        next = { ...flights, site: { ...flights.site, opening: computed } };
        notes.push(
          `Trémie recalée (jeu latéral ${fmt(clearance)} mm, à valider) : ${openingText(opening)} → ${openingText(computed)}.`,
        );
      }
    }
  }
  if (next === project) return { project, notes: [...notes, "Volées et trémie déjà calées."] };
  if (legsChanged && project.stair.nosingOverrides.length > 0) {
    notes.push(
      "Surcharges du mode expert (nez fixes, angles imposés) conservées par indice : à vérifier.",
    );
  }
  return { project: next, notes };
}
