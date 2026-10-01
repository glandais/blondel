/**
 * Placement d'une liste de menu déroulant : ouverte vers la droite depuis le
 * bouton, elle est alignée sur le bord droit du bouton quand elle dépasserait
 * de la fenêtre (sinon le document gagne une barre de défilement).
 */
import { useLayoutEffect, useRef, useState } from "react";

export function useMenuPlacement(open: boolean) {
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

  return { ref: list, className: alignEnd ? "menu__list menu__list--end" : "menu__list" };
}
