/**
 * Chaîne d'Échap du parcours libre (ADR-0009, README du handoff, « Comportements ») : une seule
 * action par appui, dans cet ordre :
 *
 * 1. un menu, un popover ou un éditeur qui consomme Échap (`preventDefault`), ou une saisie au
 *    focus (Échap y rétablit la valeur) : rien de plus ;
 * 2. panneau libre ouvert et **non épinglé** : il se ferme ;
 * 3. tiroir de l'inspecteur ouvert (fenêtre de 760 à 1 099 px seulement) : il se ferme, la
 *    sélection reste ;
 * 4. une sélection : elle est effacée (inspecteur « sans sélection », 2d) ;
 * 5. panneau libre **épinglé** ouvert : il se ferme.
 *
 * Fonction pure, testée sous Node ; l'écouteur global unique est `useEscapeChain` (App.tsx).
 */

/** Cible d'un événement clavier, réduite à ce que le filtre d'Échap consulte. */
export interface EscapeTarget {
  readonly tagName?: string;
  readonly isContentEditable?: boolean;
  closest?(selector: string): unknown;
}

export interface EscapeInput {
  readonly key: string;
  readonly defaultPrevented: boolean;
  readonly target: EscapeTarget | null;
  /** Assistant d'initialisation ouvert (fenêtre modale qui gère son propre Échap). */
  readonly assistantOpen: boolean;
  readonly panelOpen: boolean;
  readonly panelPinned: boolean;
  /**
   * Tiroir de l'inspecteur ouvert **et affiché en tiroir** (fenêtre moyenne, parcours libre en
   * Conception) ; faux sur grand écran, où l'inspecteur est une colonne.
   */
  readonly drawerOpen: boolean;
  readonly hasSelection: boolean;
}

export type EscapeAction = "closePanel" | "closeDrawer" | "clearSelection";

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** Cible éditable (saisie, liste, zone de texte, contenu éditable) : Échap lui appartient. */
export function isEditableTarget(target: EscapeTarget | null): boolean {
  if (target === null) return false;
  if (target.isContentEditable === true) return true;
  return target.tagName !== undefined && EDITABLE_TAGS.has(target.tagName.toUpperCase());
}

/** Cible dans une fenêtre modale (l'arrière-plan est alors inerte). */
export function inModalTarget(target: EscapeTarget | null): boolean {
  const modal = target?.closest?.('[aria-modal="true"], dialog[open]');
  return modal !== null && modal !== undefined;
}

/** Action d'un appui sur Échap, ou `null` (touche consommée ailleurs, ou rien à faire). */
export function escapeAction(e: EscapeInput): EscapeAction | null {
  if (e.key !== "Escape" || e.defaultPrevented || e.assistantOpen) return null;
  if (isEditableTarget(e.target) || inModalTarget(e.target)) return null;
  if (e.panelOpen && !e.panelPinned) return "closePanel";
  if (e.drawerOpen) return "closeDrawer";
  if (e.hasSelection) return "clearSelection";
  if (e.panelOpen) return "closePanel";
  return null;
}

/** Événement clavier réduit à ce que le filtre des raccourcis consulte. */
export interface ShortcutInput {
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly defaultPrevented: boolean;
  readonly target: EscapeTarget | null;
}

/**
 * Raccourci d'une lettre ou d'une flèche (F, ← →) applicable : ni Ctrl / Meta / Alt, ni cible
 * éditable, ni fenêtre modale, ni assistant ouvert, ni événement déjà traité.
 */
export function plainShortcut(e: ShortcutInput, assistantOpen: boolean): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || assistantOpen) return false;
  return !isEditableTarget(e.target) && !inModalTarget(e.target);
}
