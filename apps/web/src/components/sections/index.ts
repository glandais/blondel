/**
 * Sections de paramètres autonomes (ADR-0009) : une par entrée du rail du parcours libre, dans
 * l'ordre de `SECTION_IDS`. Chacune ne rend que son contenu, réparti par niveau selon le mode
 * d'affichage (`display`) : le titre et l'enveloppe viennent du conteneur (ancien panneau à
 * sections repliables, panneau libre, étape guidée).
 */
import type { MessageKey } from "@blondel/i18n";
import type { ComponentType } from "react";
import type { SectionId } from "../../lib/sectionIds.js";
import { GuardsSection } from "../GuardsSection.js";
import { StructureSection } from "../StructureSection.js";
import { BalancingSection } from "./BalancingSection.js";
import { ContextSection } from "./ContextSection.js";
import { LayoutSection } from "./LayoutSection.js";
import { SiteSection } from "./SiteSection.js";
import { SteppingSection } from "./SteppingSection.js";
import type { SectionProps } from "./Tiered.js";
import { TreadsSection } from "./TreadsSection.js";

export type { SectionProps } from "./Tiered.js";
export {
  DISPLAY_ALL,
  Tiered,
  hasVisibleItems,
  tieredPlacement,
  type TieredGroup,
  type TieredItem,
  type TieredItems,
} from "./Tiered.js";
export {
  BalancingSection,
  ContextSection,
  GuardsSection,
  LayoutSection,
  SiteSection,
  SteppingSection,
  StructureSection,
  TreadsSection,
};

/** Composant de chaque section. */
export const SECTION_COMPONENTS: Readonly<Record<SectionId, ComponentType<SectionProps>>> = {
  site: SiteSection,
  layout: LayoutSection,
  stepping: SteppingSection,
  balancing: BalancingSection,
  treads: TreadsSection,
  structure: StructureSection,
  guards: GuardsSection,
  compliance: ContextSection,
};

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
