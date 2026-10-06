/**
 * Identifiants partagés des parcours (ADR-0009) : les 8 sections du parcours libre (rail,
 * panneau unique) et les 7 étapes du parcours guidé. Contrat commun au dictionnaire des niveaux
 * (`lib/paramTiers.ts`), aux composants de section (`components/sections/`) et à l'état
 * d'interface (`lib/journey.ts`, `store/journeyStore.ts`). Ordre = ordre d'affichage.
 */
import type { MessageKey } from "@blondel/i18n";

/** Sections du parcours libre, dans l'ordre du rail. `compliance` : « Contexte » de contrôle. */
export const SECTION_IDS = [
  "site",
  "layout",
  "stepping",
  "balancing",
  "treads",
  "structure",
  "guards",
  "compliance",
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

/** Titre de chaque section (clés existantes de l'ancien panneau). */
export const SECTION_TITLE_KEYS: Readonly<Record<SectionId, MessageKey>> = {
  site: "ui.params.site.title",
  layout: "ui.params.layout.title",
  stepping: "ui.params.stepping.title",
  balancing: "ui.params.balancing.title",
  treads: "ui.params.treads.title",
  structure: "ui.structure.label",
  guards: "ui.params.guards.title",
  compliance: "ui.params.compliance.title",
};

/** Étapes du parcours guidé : 1 Site, 2 Forme, 3 Découpage, 4 Marches, 5 Structure, 6 Garde-corps, 7 Fabrication. */
export const GUIDED_STEPS = [1, 2, 3, 4, 5, 6, 7] as const;

export type GuidedStep = (typeof GUIDED_STEPS)[number];

export function isSectionId(v: unknown): v is SectionId {
  return typeof v === "string" && (SECTION_IDS as readonly string[]).includes(v);
}

export function isGuidedStep(v: unknown): v is GuidedStep {
  return typeof v === "number" && (GUIDED_STEPS as readonly number[]).includes(v);
}
