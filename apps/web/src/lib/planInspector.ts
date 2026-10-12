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
 */
import {
  DEFAULT_NEWEL_SIZE,
  editableCage,
  removeSection,
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
