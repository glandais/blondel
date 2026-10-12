/**
 * Contrôleurs de l'inspecteur du plan (ADR-0010, sous-lot 4d) : chaque champ et chaque action
 * de `components/sections/PlanInspector.tsx` passe par un **mutateur pur du cœur**
 * (`layout/cageEdit.ts`, `site/edit.ts`), qui rend le projet modifié, le même projet (sans effet)
 * ou un refus typé (`Message`). Aucun calcul métier ici : lecture des valeurs dans la cage
 * éditée (`editableCage`) et aiguillage du résultat vers le store.
 *
 * - `editOutcome` (pur) : résultat d'un mutateur sur un projet ; refus → aucune modification ;
 *   passage d'un tracé à volées en tracé libre → remarque (`ui.plan.inspector.becameCage`, ou la
 *   remarque explicite d'une conversion voulue).
 * - `commitEdit` : applique un mutateur au projet du store, en **une** entrée d'historique close
 *   aussitôt (`update` puis `endGroup`), et rend le résultat attendu par les champs
 *   (`UpdateResult`) avec la remarque éventuelle.
 * - `wellJointOfKind`, `wallJointOfKind` : raccord d'un autre type, cote de départ reprise du
 *   raccord précédent (rayon, côté de poteau, retrait), sinon `DEFAULT_NEWEL_SIZE` comme le
 *   formulaire des tournants (`LayoutSection`), valeur de départ de la saisie, à ajuster.
 * - Axe d'un autre type : graine du cœur (`axisSeed`, `layout/cageEdit.ts`), qui seul connaît la
 *   contrainte entre rayon et bord d'ancrage.
 * - `removeSectionInStore` : retrait d'un tronçon (bouton et touche Suppr), refus ou remarque
 *   rendus à l'éditeur.
 * - `newSectionAfter` : tronçon inséré après le tronçon `i` : même partie droite (ou sa largeur
 *   pour un tronçon en arc ou « auto »), relié par un palier droit (défaut d'`insertSection`).
 * - Site (sous-lot 5a) : `removeWallInStore`, `splitWallInStore`, `removeOpeningVertexInStore`,
 *   `insertOpeningVertexInStore` (boutons de l'inspecteur, Suppr et double-clic de l'éditeur :
 *   même chemin), une entrée d'historique chacun, élément à sélectionner ensuite et remarque ou
 *   refus rendus à l'éditeur ; une trémie ronde devenue polygonale l'annonce (cercle oublié).
 *   `trackedVertexMove` : champ x, y d'un sommet, sommet réindexé à resélectionner.
 * - Contour de pièce et obstacles (sous-lot 5b) : `replaceRoomInStore` (outil Contour de pièce :
 *   un projet n'a qu'un contour, retracer le remplace, annulable), `removeRoomInStore`,
 *   `insertRoomVertexInStore`, `removeRoomVertexInStore` (refus sous 3 sommets),
 *   `addObstacleInStore` (outil Obstacle, identifiant `nextObstacleId` rendu par `withObstacle`),
 *   `removeObstacleInStore` (Suppr, bouton) ; même contrat que les actions du site du sous-lot 5a.
 *   `obstaclePatch` : champ de l'inspecteur d'un obstacle (cote remplacée, `updateObstacle`).
 */
import {
  DEFAULT_NEWEL_SIZE,
  editableCage,
  insertOpeningVertex,
  insertRoomVertex,
  removeRoomVertex,
  updateObstacle,
  editError,
  withObstacle,
  withoutObstacle,
  withRoom,
  type ObstacleDraft,
  moveOpeningVertex,
  removeOpeningVertex,
  removeSection,
  removeWall,
  splitWall,
  type Vec2,
  type CageJunction,
  type CageSection,
  type EditResult,
  type NewSection,
  type Project,
  type WallJoint,
  type WellJoint,
} from "@blondel/core";
import { msg, type Message } from "@blondel/i18n";
import { appStore } from "../store/appStore.js";
import type { PlanSelection } from "../store/planEditor.js";
import type { UpdateResult } from "../store/projectStore.js";

/** Résultat d'un mutateur pour l'inspecteur. */
export interface EditOutcome {
  /** Projet modifié ; `null` : refus ou sans effet. */
  readonly next: Project | null;
  /** Motif du refus (traduit à l'affichage). */
  readonly error: Message | null;
  /** Remarque à annoncer (passage en tracé libre). */
  readonly remark: Message | null;
}

/** Le tracé est-il à volées (ni cage, ni hélicoïdal) ? */
export function isFlightsLayout(project: Project): boolean {
  const kind = project.stair.layout.kind;
  return kind !== "cage" && kind !== "helical";
}

/**
 * Résultat du mutateur `edit` appliqué à `project`. Un tracé à volées devenu tracé libre donne
 * la remarque `converted` (conversion voulue) ou `ui.plan.inspector.becameCage` (modification qui
 * ne s'écrit plus en volées).
 */
export function editOutcome(
  project: Project,
  edit: (p: Project) => EditResult,
  converted?: Message,
): EditOutcome {
  const r = edit(project);
  if (r.error) return { next: null, error: r.error, remark: null };
  if (r.project === project) return { next: null, error: null, remark: null };
  const became = isFlightsLayout(project) && r.project.stair.layout.kind === "cage";
  return {
    next: r.project,
    error: null,
    remark: became ? (converted ?? msg("ui.plan.inspector.becameCage")) : null,
  };
}

/** Résultat d'une validation de l'inspecteur : réponse du champ et remarque éventuelle. */
export interface CommitOutcome {
  readonly result: UpdateResult;
  readonly remark: Message | null;
}

/**
 * Applique le mutateur `edit` au projet du store : une entrée d'historique (annulable), aucune
 * en cas de refus ou sans effet. Le refus est rendu dans `result.issues` (affiché sous le champ).
 */
export function commitEdit(edit: (p: Project) => EditResult, converted?: Message): CommitOutcome {
  const store = appStore.getState();
  const o = editOutcome(store.project, edit, converted);
  if (o.error) return { result: { ok: false, issues: [o.error] }, remark: null };
  if (!o.next) return { result: { ok: true }, remark: null };
  const next = o.next;
  const result = store.update(() => next);
  appStore.getState().endGroup();
  return { result, remark: result.ok ? o.remark : null };
}

/** Message de l'éditeur de plan (annonce ou refus), traduit au rendu. */
export interface PlanNote {
  readonly kind: "info" | "error";
  readonly text: Message;
}

/**
 * Retrait du tronçon `i` (bouton « Supprimer le tronçon » de l'inspecteur et touche Suppr de
 * l'éditeur : même chemin) : une entrée d'historique. `removed` : la sélection est à effacer ;
 * `note` : remarque à annoncer (passage en tracé libre) ou refus (`ui.plan.inspector.refused`),
 * à afficher par l'éditeur, qui survit au démontage de l'inspecteur.
 */
export function removeSectionInStore(i: number): {
  readonly removed: boolean;
  readonly note: PlanNote | null;
} {
  const o = commitEdit((p) => removeSection(p, i));
  if (!o.result.ok) {
    const error = o.result.issues[0] ?? msg("ui.plan.site.refused");
    return {
      removed: false,
      note: { kind: "error", text: msg("ui.plan.inspector.refused", { error }) },
    };
  }
  return { removed: true, note: o.remark ? { kind: "info", text: o.remark } : null };
}

/** Tronçon `i` de la cage éditée (tracé libre, ou équivalent d'un tracé à volées). */
export function inspectedSection(
  project: Project,
  i: number,
): { readonly section: CageSection; readonly count: number } | null {
  const cage = editableCage(project);
  const section = cage?.sections[i];
  return cage && section ? { section, count: cage.sections.length } : null;
}

/** Jonction `j` de la cage éditée, avec le tronçon qui y entre. */
export function inspectedJunction(
  project: Project,
  j: number,
): { readonly junction: CageJunction; readonly before: CageSection } | null {
  const cage = editableCage(project);
  const junction = cage?.junctions[j];
  const before = cage?.sections[j];
  return junction && before ? { junction, before } : null;
}

/** Cote de départ d'un raccord du jour (rayon, côté du poteau ou retrait d'entrée). */
function wellSeed(well: WellJoint): number {
  switch (well.kind) {
    case "arc":
      return well.radius;
    case "newel":
      return well.size;
    case "chamfer":
      return well.setbackIn;
    case "sharp":
      return DEFAULT_NEWEL_SIZE;
  }
}

/** Raccord du jour de type `kind`, cote reprise de `current` (même objet si même type). */
export function wellJointOfKind(kind: WellJoint["kind"], current: WellJoint): WellJoint {
  if (kind === current.kind) return current;
  const size = wellSeed(current);
  switch (kind) {
    case "sharp":
      return { kind: "sharp" };
    case "arc":
      return { kind: "arc", radius: size };
    case "newel":
      return { kind: "newel", size };
    case "chamfer":
      return { kind: "chamfer", setbackIn: size, setbackOut: size };
  }
}

/**
 * Raccord côté mur de type `kind`, rayon repris du congé précédent, sinon du raccord du jour
 * (`wellSeed`).
 */
export function wallJointOfKind(
  kind: WallJoint["kind"],
  current: WallJoint,
  well: WellJoint,
): WallJoint {
  if (kind === current.kind) return current;
  return kind === "sharp" ? { kind: "sharp" } : { kind: "arc", radius: wellSeed(well) };
}

/** Tronçon inséré après `section` (voir l'en-tête). */
export function newSectionAfter(section: CageSection): NewSection {
  const end = section.widthEnd ?? section.width;
  const length =
    section.axis.kind === "straight" && section.axis.length !== "auto" ? section.axis.length : end;
  return { length, width: end };
}

// ------------------------------------------------------------------ Site (sous-lot 5a)

/**
 * Action du site sur la sélection : `done` (projet modifié), `selection` (élément à sélectionner
 * ensuite ; `null` : sélection effacée, l'élément a disparu ; absent : inchangée), `note`
 * (annonce ou refus, affichée par l'éditeur, qui survit au démontage de l'inspecteur).
 */
export interface SiteActionOutcome {
  readonly done: boolean;
  readonly selection?: PlanSelection | null;
  readonly note: PlanNote | null;
}

function refused(result: UpdateResult): SiteActionOutcome {
  const error = (result.ok ? null : result.issues[0]) ?? msg("ui.plan.site.refused");
  return {
    done: false,
    note: { kind: "error", text: msg("ui.plan.inspector.refused", { error }) },
  };
}

/** Suppression du mur `id` (Suppr, bouton « Supprimer le mur »). */
export function removeWallInStore(id: string): SiteActionOutcome {
  const o = commitEdit((p) => removeWall(p, id));
  if (!o.result.ok) return refused(o.result);
  return {
    done: true,
    selection: null,
    note: { kind: "info", text: msg("ui.plan.editor.wall.removed", { id }) },
  };
}

/** Coupe du mur `id` au projeté de `point` (double-clic, ou milieu de l'axe : inspecteur). */
export function splitWallInStore(id: string, point: Vec2): SiteActionOutcome {
  const got: { newId?: string } = {};
  const o = commitEdit((p) => {
    const r = splitWall(p, id, point);
    if (!r.error) got.newId = r.id;
    return r;
  });
  const newId = got.newId;
  if (!o.result.ok || newId === undefined) return refused(o.result);
  return {
    done: true,
    selection: { kind: "wall", id },
    note: { kind: "info", text: msg("ui.plan.editor.wall.split", { id, newId }) },
  };
}

/** Suppression du sommet `index` de la trémie (Suppr, bouton « Supprimer le sommet »). */
export function removeOpeningVertexInStore(index: number): SiteActionOutcome {
  const round = hasCircle();
  const o = commitEdit((p) => removeOpeningVertex(p, index));
  if (!o.result.ok) return refused(o.result);
  return {
    done: true,
    selection: { kind: "opening" },
    note: {
      kind: "info",
      text: circleNote(round, msg("ui.plan.editor.opening.vertexRemoved", { index: index + 1 })),
    },
  };
}

/** Trémie ronde (`circle`) dans le projet du store. */
function hasCircle(): boolean {
  const o = appStore.getState().project.site.opening;
  return o?.kind === "polygon" && o.circle !== undefined;
}

/** Annonce complétée de la perte du cercle exact (trémie ronde devenue polygonale). */
function circleNote(round: boolean, text: Message): Message {
  return round ? msg("ui.plan.editor.opening.circleLost", { action: text }) : text;
}

/**
 * Champ x ou y d'un sommet de la trémie (inspecteur) : mutateur `edit` (`moveOpeningVertex`) et
 * `reselect`, à lire après une validation acceptée : sommet à sélectionner quand la forme
 * canonique a réindexé le sommet déplacé (contour retourné), `null` sinon.
 */
export function trackedVertexMove(
  index: number,
  point: Vec2,
): { readonly edit: (p: Project) => EditResult; reselect(): PlanSelection | null } {
  let moved: number | null = null;
  return {
    edit: (p) => {
      const r = moveOpeningVertex(p, index, point);
      moved = r.error ? null : r.index;
      return r;
    },
    reselect: () =>
      moved !== null && moved !== index ? { kind: "openingVertex", index: moved } : null,
  };
}

/**
 * Insertion d'un sommet sur le côté `edge` de la trémie, au projeté de `point` (double-clic sur
 * le côté) ou en son milieu (inspecteur) ; le nouveau sommet est sélectionné.
 */
export function insertOpeningVertexInStore(edge: number, point?: Vec2): SiteActionOutcome {
  const round = hasCircle();
  const got: { index?: number } = {};
  const o = commitEdit((p) => {
    const r = insertOpeningVertex(p, edge, point);
    if (!r.error) got.index = r.index;
    return r;
  });
  const index = got.index;
  if (!o.result.ok || index === undefined) return refused(o.result);
  return {
    done: true,
    selection: { kind: "openingVertex", index },
    note: {
      kind: "info",
      text: circleNote(round, msg("ui.plan.editor.opening.vertexInserted", { index: index + 1 })),
    },
  };
}

// ------------------------------------------------------------------ Contour et obstacles (5b)

/**
 * Contour de pièce tracé (outil Contour de pièce) : il remplace le contour existant (un seul par
 * projet), une entrée d'historique ; refus (contour invalide) rendu sans modification.
 */
export function replaceRoomInStore(points: readonly Vec2[]): SiteActionOutcome {
  const replaced = appStore.getState().project.site.room !== undefined;
  const o = commitEdit((p) => withRoom(p, points));
  if (!o.result.ok) return refused(o.result);
  return {
    done: true,
    note: {
      kind: "info",
      text: msg(replaced ? "ui.plan.editor.room.replaced" : "ui.plan.editor.room.saved", {
        count: points.length,
      }),
    },
  };
}

/** Suppression du contour de pièce (Suppr sur le contour sélectionné, bouton). */
export function removeRoomInStore(): SiteActionOutcome {
  if (appStore.getState().project.site.room === undefined) {
    return refused({ ok: false, issues: [msg("site.edit.noRoom")] });
  }
  const o = commitEdit((p) => withRoom(p, undefined));
  if (!o.result.ok) return refused(o.result);
  return {
    done: true,
    selection: null,
    note: { kind: "info", text: msg("ui.plan.editor.room.removed") },
  };
}

/**
 * Sommet inséré sur le côté `edge` du contour de pièce, en `point` (double-clic : projeté sur le
 * côté) ou au milieu du côté (inspecteur) ; le nouveau sommet `edge + 1` est sélectionné.
 */
export function insertRoomVertexInStore(edge: number, point?: Vec2): SiteActionOutcome {
  const o = commitEdit((p) => insertRoomVertex(p, edge, point));
  if (!o.result.ok) return refused(o.result);
  return {
    done: true,
    selection: { kind: "roomVertex", index: edge + 1 },
    note: {
      kind: "info",
      text: msg("ui.plan.editor.room.vertexInserted", { index: edge + 2 }),
    },
  };
}

/** Suppression du sommet `index` du contour de pièce (refus sous 3 sommets). */
export function removeRoomVertexInStore(index: number): SiteActionOutcome {
  const o = commitEdit((p) => removeRoomVertex(p, index));
  if (!o.result.ok) return refused(o.result);
  return {
    done: true,
    selection: { kind: "room" },
    note: {
      kind: "info",
      text: msg("ui.plan.editor.room.vertexRemoved", { index: index + 1 }),
    },
  };
}

/** Obstacle ajouté (outil Obstacle) : identifiant rendu par le cœur, une entrée d'historique. */
export function addObstacleInStore(draft: ObstacleDraft): SiteActionOutcome & {
  readonly id?: string;
} {
  const got: { id?: string } = {};
  const o = commitEdit((p) => {
    const r = withObstacle(p, draft);
    if (!r.error) got.id = r.id;
    return r;
  });
  const id = got.id;
  if (!o.result.ok || id === undefined) return refused(o.result);
  return {
    done: true,
    id,
    note: { kind: "info", text: msg("ui.plan.editor.obstacle.added", { id }) },
  };
}

/** Suppression de l'obstacle `id` (Suppr, bouton « Supprimer l'obstacle »). */
export function removeObstacleInStore(id: string): SiteActionOutcome {
  const o = commitEdit((p) => withoutObstacle(p, id));
  if (!o.result.ok) return refused(o.result);
  return {
    done: true,
    selection: null,
    note: { kind: "info", text: msg("ui.plan.editor.obstacle.removed", { id }) },
  };
}

/**
 * Champ de l'inspecteur d'un obstacle : mutateur qui remplace les cotes `patch` de l'obstacle
 * `id` (`updateObstacle` : arrondi, contrôle du schéma ; identifiant et nature conservés).
 */
export function obstaclePatch(
  id: string,
  patch: Partial<ObstacleDraft>,
): (p: Project) => EditResult {
  return (p) => {
    const o = (p.site.obstacles ?? []).find((x) => x.id === id);
    if (!o) return editError(msg("site.edit.unknownObstacle", { id }));
    const { id: _id, ...draft } = o;
    return updateObstacle(p, id, { ...draft, ...patch } as ObstacleDraft);
  };
}
