/**
 * Mène au champ d'une valeur ◆ dans le panneau ouvert du parcours libre ou dans le formulaire
 * de l'étape du parcours guidé (lien « Ouvrir » de la liste des valeurs à valider) : le champ est repéré par `data-param` (posé par `Tiered` sur
 * chaque champ ◆), les replis qui le contiennent (« Plus de réglages », « Réglages d'atelier »)
 * sont dépliés, puis le champ reçoit le focus et défile au milieu de la vue.
 *
 * Le panneau ou l'étape vient d'être demandé : on attend son rendu, quelques images au plus.
 * Sans champ trouvé (valeur hors du panneau), rien ne se passe : la section reste ouverte.
 */

/** Nombre d'images attendues au plus avant d'abandonner. */
const MAX_FRAMES = 30;

/**
 * Champ ◆ de clé `key` dans le panneau libre ouvert, sinon dans le formulaire de l'étape du
 * guidé ; `null` s'il n'est pas (encore) rendu.
 */
export function findParamField(key: string, root: ParentNode): HTMLElement | null {
  const attr = `[data-param="${CSS.escape(key)}"]`;
  return (
    root.querySelector<HTMLElement>(`.free-panel ${attr}`) ??
    root.querySelector<HTMLElement>(`.guided-form ${attr}`)
  );
}

/** Déplie les replis qui contiennent `el`, lui donne le focus et le fait défiler. */
export function revealParamField(el: HTMLElement): void {
  for (let d = el.closest("details"); d !== null; d = d.parentElement?.closest("details") ?? null) {
    d.open = true;
  }
  const target =
    el.querySelector<HTMLElement>(
      "input:not([type='hidden']):not(:disabled), select:not(:disabled), textarea, button:not(:disabled)",
    ) ?? el;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "center" });
}

/** Attend le rendu du panneau puis mène au champ de clé `key`. */
export function focusParamField(key: string): void {
  if (typeof document === "undefined" || typeof requestAnimationFrame === "undefined") return;
  const attempt = (left: number): void => {
    const el = findParamField(key, document);
    if (el !== null) revealParamField(el);
    else if (left > 0) requestAnimationFrame(() => attempt(left - 1));
  };
  requestAnimationFrame(() => attempt(MAX_FRAMES));
}
