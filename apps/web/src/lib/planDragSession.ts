/**
 * Session de glisser d'une poignée de l'éditeur de plan (ADR-0010, sous-lot 4b) : cadence et
 * historique d'un geste, indépendants de React (testés sous Node avec un hôte factice).
 *
 * - Chaque déplacement du pointeur est mémorisé ; le pas (`dragStep`) n'est calculé et appliqué
 *   qu'**une fois par image** (`requestFrame`, `requestAnimationFrame` dans le navigateur) avec
 *   le dernier pointeur.
 * - Chaque pas appliqué passe par `update(recipe, key, { sticky: true })` : tout le geste est un
 *   seul groupe d'historique, quel que soit le délai (une annulation le défait en entier).
 * - Fin (`end`, relâchement) : le dernier pointeur en attente est appliqué, puis `endGroup()` ;
 *   geste revenu au projet de départ : le groupe est abandonné (`revertGroup`, aucune entrée).
 * - Annulation (`cancel`, Échap) : le groupe est abandonné, retour au projet du début du geste.
 *   Si une autre modification s'est glissée dans le geste (le groupe ne le couvre plus en
 *   entier), le projet du début est rétabli par une entrée d'historique.
 * - Refus d'un mutateur (ou du schéma, `update`) : rien n'est appliqué, l'état reste au dernier
 *   pas valide et `onStep` reçoit le message.
 */
import type { Message } from "@blondel/i18n";
import type { Project, Vec2 } from "@blondel/core";
import { dragStep, type DragGesture, type DragSnap, type DragStepOptions } from "./planDrag.js";

/** Hôte d'une session : store du projet, horloge d'images, retour d'état. */
export interface DragHost {
  update(
    recipe: (p: Project) => Project,
    groupKey: string,
    options: { readonly sticky: boolean },
  ): { readonly ok: true } | { readonly ok: false; readonly issues: readonly Message[] };
  endGroup(): void;
  revertGroup(groupKey: string): boolean;
  /** Projet courant du store. */
  current(): Project;
  requestFrame(cb: () => void): number;
  cancelFrame(id: number): void;
  /** Après chaque pas calculé : accroche retenue, ou refus. */
  onStep?(step: { readonly snap: DragSnap | null; readonly error: Message | null }): void;
}

export interface DragSession {
  /** Geste en cours, ou `null`. */
  readonly gesture: () => DragGesture | null;
  begin(gesture: DragGesture): void;
  /** Pointeur déplacé (repère du site) ; le pas est appliqué à la prochaine image. */
  move(pointer: Vec2, opts: DragStepOptions): void;
  /** Fin du geste (relâchement) ; vrai si un geste était en cours. */
  end(): boolean;
  /** Annulation du geste (Échap) : retour au projet du début ; vrai si un geste était en cours. */
  cancel(): boolean;
}

export function createDragSession(host: DragHost): DragSession {
  let gesture: DragGesture | null = null;
  let pending: { pointer: Vec2; opts: DragStepOptions } | null = null;
  let frame: number | null = null;
  /** Un pas a été enregistré dans l'historique (groupe ouvert par ce geste). */
  let committed = false;
  /** Dernier projet appliqué. */
  let last: Project | null = null;

  const flush = (): void => {
    frame = null;
    const g = gesture;
    const next = pending;
    pending = null;
    if (!g || !next) return;
    const r = dragStep(g, next.pointer, next.opts);
    if (r.error) {
      host.onStep?.({ snap: null, error: r.error });
      return;
    }
    if (r.project !== last) {
      const project = r.project;
      const u = host.update(() => project, g.key, { sticky: true });
      if (!u.ok) {
        host.onStep?.({ snap: null, error: u.issues[0] ?? null });
        return;
      }
      committed = true;
      last = project;
    }
    host.onStep?.({ snap: r.snap, error: null });
  };

  const stopFrame = (): void => {
    if (frame !== null) host.cancelFrame(frame);
    frame = null;
  };

  const reset = (): void => {
    gesture = null;
    pending = null;
    committed = false;
    last = null;
  };

  return {
    gesture: () => gesture,
    begin(g) {
      if (gesture) this.end();
      reset();
      gesture = g;
      last = g.project;
    },
    move(pointer, opts) {
      if (!gesture) return;
      pending = { pointer, opts };
      if (frame === null) frame = host.requestFrame(flush);
    },
    end() {
      const g = gesture;
      if (!g) return false;
      stopFrame();
      flush();
      if (committed && last === g.project) host.revertGroup(g.key);
      else host.endGroup();
      reset();
      return true;
    },
    cancel() {
      const g = gesture;
      if (!g) return false;
      stopFrame();
      if (committed) host.revertGroup(g.key);
      if (host.current() !== g.project) {
        // Modification étrangère au geste pendant celui-ci : retour explicite au départ.
        host.update(() => g.project, g.key, { sticky: true });
        host.endGroup();
      }
      reset();
      return true;
    },
  };
}
