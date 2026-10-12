/**
 * Attributs d'un élément sélectionnable de l'éditeur de plan : clé `data-plan-select` (lue au
 * clic et au clavier par délégation dans `PlanEditor`), surbrillance, et, dans l'outil de
 * sélection seulement, rôle de bouton focalisable avec un libellé traduit et `aria-pressed`.
 * Hors de l'outil de sélection, l'élément n'est ni focalisable ni annoncé : un clic de tracé
 * laisse le focus sur le plan.
 */
import type { Translator } from "@blondel/i18n";
import { msg } from "@blondel/i18n";
import type { PlanSelection } from "../../store/planEditor.js";
import { planSelectionKey, SELECTION_LABELS, selectionLabelParams } from "./planEditorGeometry.js";

export interface SelectContext {
  /** Outil de sélection actif. */
  readonly interactive: boolean;
  /** Clé de l'élément sélectionné (`planSelectionKey`), `null` sans sélection. */
  readonly selectedKey: string | null;
  readonly tr: Translator;
}

/** Libellé traduit d'un élément du plan. */
export function selectionLabel(sel: PlanSelection, tr: Translator): string {
  return tr.t(msg(SELECTION_LABELS[sel.kind], selectionLabelParams(sel)));
}

export interface SelectableProps {
  readonly "data-plan-select": string;
  readonly "data-selected"?: "true";
  readonly role?: "button";
  readonly tabIndex?: number;
  readonly "aria-label"?: string;
  readonly "aria-pressed"?: boolean;
}

export function selectable(sel: PlanSelection, ctx: SelectContext): SelectableProps {
  const key = planSelectionKey(sel);
  const selected = ctx.selectedKey === key;
  const base: SelectableProps = {
    "data-plan-select": key,
    ...(selected ? { "data-selected": "true" as const } : {}),
  };
  if (!ctx.interactive) return base;
  return {
    ...base,
    role: "button",
    tabIndex: 0,
    "aria-label": selectionLabel(sel, ctx.tr),
    "aria-pressed": selected,
  };
}
