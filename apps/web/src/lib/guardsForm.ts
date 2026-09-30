/**
 * Panneau « Garde-corps » : clés des libellés et transitions d'édition de `Project.guards`
 * (jalon 4). Aucune valeur métier ici : les valeurs par défaut sont celles du schéma du cœur
 * (`GuardsSpecSchema`, `GuardInfillSchema`, `GuardSectionSchema`), obtenues par analyse d'un
 * objet minimal ; la validation reste celle du store (schéma du projet).
 */
import {
  GUARD_MATERIALS,
  GuardInfillSchema,
  GuardsSpecSchema,
  type GuardInfill,
  type GuardSection,
  type GuardSideMode,
  type GuardsSpec,
  type MaterialId,
} from "@blondel/core";
import type { MessageKey } from "@blondel/i18n";
import { MATERIAL_LABELS } from "../three/materials.js";

export type InfillKind = GuardInfill["kind"];

export const INFILL_KINDS: readonly InfillKind[] = [
  "balusters",
  "rails",
  "cables",
  "glass",
  "perforated",
  "panel",
];

export const INFILL_LABELS: Readonly<Record<InfillKind, MessageKey>> = {
  balusters: "ui.label.infill.balusters",
  rails: "ui.label.infill.rails",
  cables: "ui.label.infill.cables",
  glass: "ui.label.infill.glass",
  perforated: "ui.label.infill.perforated",
  panel: "ui.label.infill.panel",
};

export const SIDE_MODE_LABELS: Readonly<Record<GuardSideMode, MessageKey>> = {
  auto: "ui.label.sideMode.auto",
  void: "ui.label.sideMode.void",
  wall: "ui.label.sideMode.wall",
};

export const WALL_SIDES_LABELS: Readonly<Record<GuardsSpec["handrail"]["wallSides"], MessageKey>> =
  {
    auto: "ui.label.wallSides.auto",
    none: "ui.label.wallSides.none",
    inner: "ui.label.wallSides.inner",
    outer: "ui.label.wallSides.outer",
    both: "ui.label.wallSides.both",
  };

export const SECTION_KIND_LABELS: Readonly<Record<GuardSection["kind"], MessageKey>> = {
  round: "ui.label.sectionKind.round",
  rect: "ui.label.sectionKind.rect",
};

/** Matériaux proposés pour les garde-corps (liste du cœur), clés de leurs libellés. */
export const GUARD_MATERIAL_OPTIONS: readonly { value: MaterialId; label: MessageKey }[] =
  GUARD_MATERIALS.map((m) => ({ value: m, label: MATERIAL_LABELS[m] }));

/** Spécification par défaut du cœur (garde-corps activés, valeurs du schéma). */
export function defaultGuards(): GuardsSpec {
  return GuardsSpecSchema.parse({});
}

/**
 * Remplissage d'un autre type : défauts du cœur pour ce type, en conservant le vide sous le
 * remplissage déjà saisi (paramètre commun à tous les types).
 */
export function switchInfill(current: GuardInfill, kind: InfillKind): GuardInfill {
  if (current.kind === kind) return current;
  return GuardInfillSchema.parse({ kind, bottomGap: current.bottomGap });
}

/**
 * Section d'une autre forme : la dimension principale est conservée (diamètre ↔ largeur) et la
 * hauteur d'une section rectangulaire reprend cette dimension (section carrée, à ajuster).
 */
export function switchSection(current: GuardSection, kind: GuardSection["kind"]): GuardSection {
  if (current.kind === kind) return current;
  if (current.kind === "rect") return { kind: "round", diameter: current.width };
  return { kind: "rect", width: current.diameter, height: current.diameter };
}

/** Résumé d'une section (« Ø 42 », « 40 × 30 »). */
export function sectionLabel(s: GuardSection): string {
  return s.kind === "round" ? `Ø ${s.diameter}` : `${s.width} × ${s.height}`;
}

/** Le remplissage a-t-il une section d'élément (balustres, lisses) ? */
export function infillHasSection(
  infill: GuardInfill,
): infill is Extract<GuardInfill, { section: GuardSection }> {
  return infill.kind === "balusters" || infill.kind === "rails";
}

/** Le remplissage est-il un panneau (jeu entre panneaux, épaisseur) ? */
export function infillIsPanel(
  infill: GuardInfill,
): infill is Extract<GuardInfill, { kind: "glass" | "perforated" | "panel" }> {
  return infill.kind === "glass" || infill.kind === "perforated" || infill.kind === "panel";
}
