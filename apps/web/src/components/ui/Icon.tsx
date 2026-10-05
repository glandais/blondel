/**
 * Icône Lucide au trait de 1,5 (système Industry, ADR-0009). Sans `label`, l'icône est décorative
 * (masquée aux lecteurs d'écran) ; avec `label`, elle porte ce nom accessible. Le libellé vient
 * toujours de l'appelant (dictionnaire), jamais d'un texte écrit ici.
 */
import type { LucideIcon } from "lucide-react";

/** Épaisseur de trait commune à toutes les icônes de l'interface. */
export const ICON_STROKE_WIDTH = 1.5;

export interface IconProps {
  readonly icon: LucideIcon;
  /** Côté en pixels (20 par défaut). */
  readonly size?: number;
  /** Nom accessible ; absent : icône décorative. */
  readonly label?: string;
  readonly className?: string;
}

export function Icon({ icon: Glyph, size = 20, label, className }: IconProps) {
  const a11y =
    label === undefined
      ? ({ "aria-hidden": true, focusable: "false" } as const)
      : ({ role: "img", "aria-label": label } as const);
  return <Glyph size={size} strokeWidth={ICON_STROKE_WIDTH} className={className} {...a11y} />;
}
