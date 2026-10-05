/**
 * Placement d'une liste de menu déroulant (ou d'un popover de la barre du haut) : ouverte vers
 * la droite depuis le bouton, elle est alignée sur le bord droit du bouton quand elle dépasserait
 * de la fenêtre (sinon le document gagne une barre de défilement). `base` : classe de la liste
 * (`menu__list` par défaut), complétée de `<base>--end` une fois alignée à droite.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Fermeture d'un menu ou d'un popover ouvert au pointeur posé en dehors de `root` (le bouton
 * déclencheur est dans `root` : il garde la main sur l'ouverture).
 */
export function useOutsideDismiss(
  open: boolean,
  root: RefObject<HTMLElement | null>,
  close: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && e.target instanceof Node && !root.current.contains(e.target)) close();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, root, close]);
}

export function useMenuPlacement(open: boolean, base = "menu__list") {
  const list = useRef<HTMLDivElement>(null);
  const [alignEnd, setAlignEnd] = useState(false);

  useLayoutEffect(() => {
    if (!open) {
      setAlignEnd(false);
      return;
    }
    const el = list.current;
    if (!el || alignEnd) return;
    if (el.getBoundingClientRect().right > document.documentElement.clientWidth) setAlignEnd(true);
  }, [open, alignEnd]);

  return { ref: list, className: alignEnd ? `${base} ${base}--end` : base };
}
