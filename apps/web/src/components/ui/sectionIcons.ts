/**
 * Icônes des 8 sections du parcours libre (rail) et des étapes correspondantes du parcours guidé
 * (ADR-0009, maquette 1b). Lucide, trait 1,5 via `Icon`.
 */
import {
  Box,
  CornerDownRight,
  Fence,
  Layers,
  RotateCw,
  Ruler,
  ShieldCheck,
  SquareDashed,
  type LucideIcon,
} from "lucide-react";
import type { SectionId } from "../../lib/sectionIds.js";

export const SECTION_ICONS: Readonly<Record<SectionId, LucideIcon>> = {
  site: SquareDashed,
  layout: CornerDownRight,
  stepping: Ruler,
  balancing: RotateCw,
  treads: Layers,
  structure: Box,
  guards: Fence,
  compliance: ShieldCheck,
};
