/**
 * Panneau « Garde-corps » : libellés français et transitions d'édition de `Project.guards`
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

export const INFILL_LABELS: Readonly<Record<InfillKind, string>> = {
  balusters: "Barreaudage vertical (balustres)",
  rails: "Lisses",
  cables: "Câbles tendus",
  glass: "Verre",
  perforated: "Tôle perforée",
  panel: "Panneau plein",
};

export const SIDE_MODE_LABELS: Readonly<Record<GuardSideMode, string>> = {
  auto: "Automatique (murs du site)",
  void: "Vide (garde-corps)",
  wall: "Mur",
};

export const WALL_SIDES_LABELS: Readonly<Record<GuardsSpec["handrail"]["wallSides"], string>> = {
  auto: "Automatique",
  none: "Aucune",
  inner: "Côté jour",
  outer: "Côté extérieur",
  both: "Des deux côtés",
};

export const SECTION_KIND_LABELS: Readonly<Record<GuardSection["kind"], string>> = {
  round: "Ronde",
  rect: "Rectangulaire",
};

/** Matériaux proposés pour les garde-corps (liste du cœur), libellés français. */
export const GUARD_MATERIAL_OPTIONS: readonly { value: MaterialId; label: string }[] =
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
