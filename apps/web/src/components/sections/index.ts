/**
 * Sections de paramètres autonomes (ADR-0009) : une par entrée du rail du parcours libre, dans
 * l'ordre de `SECTION_IDS`. Chacune ne rend que son contenu, réparti par niveau selon le mode
 * d'affichage (`display`) : le titre et l'enveloppe viennent du conteneur (ancien panneau à
 * sections repliables, panneau libre, étape guidée).
 */
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

/** Titre de chaque section : déplacé dans `lib/sectionIds.ts` (utilisable hors composants). */
export { SECTION_TITLE_KEYS } from "../../lib/sectionIds.js";
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
