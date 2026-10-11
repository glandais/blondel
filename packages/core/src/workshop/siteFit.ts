/**
 * Adéquation au site du profil d'atelier (ADR-0010, plan E, décision F7 (b) du 2026-10-11) :
 * dégagements que le contrôle d'adéquation (`site/fit.ts`) ne tire d'aucune source.
 *
 * **Aucune de ces valeurs n'est sourcée** (docs/research : ni longueur de palier d'arrivée hors
 * PALIER_LONGUEUR_METIER, ni débattement de porte) : les défauts sont des hypothèses
 * **« à valider »**, exprimés par analogie et sans valeur en dur :
 * - `arrivalClearance` : dégagement à laisser libre devant le nez d'arrivée ; `null` (défaut) =
 *   emmarchement de l'arrivée (même analogie que `limits.arrivalClearance` de l'assistant,
 *   PALIER_LONGUEUR_METIER : palier au moins aussi long que l'emmarchement) ;
 * - `doorSwingRadius` : rayon du secteur de débattement d'une porte ; `null` (défaut) = largeur
 *   de la porte saisie (baie `a`–`b`).
 *
 * La fenêtre n'a aucun réglage : elle est signalée en conseil seulement (décision F7).
 * Le projet peut porter un réglage partiel (`Project.workshop.siteFit`).
 */
import { msg } from "@blondel/i18n";
import { z } from "zod";
import type { Mm } from "../model/primitives.js";
import type { SettingProvenance } from "./profile.js";

const mmPos = z.number().positive();

/** Réglage partiel porté par un projet (`WorkshopProfileInput.siteFit`). */
export const SiteFitProfileInputSchema = z.object({
  /** Dégagement devant le nez d'arrivée (mm) ; `null` : emmarchement de l'arrivée. */
  arrivalClearance: mmPos.nullable().optional(),
  /** Rayon du débattement d'une porte (mm) ; `null` : largeur de la porte. */
  doorSwingRadius: mmPos.nullable().optional(),
});
export type SiteFitProfileInput = z.infer<typeof SiteFitProfileInputSchema>;

/** Réglages résolus (`null` : valeur déduite du projet, voir l'en-tête). */
export interface SiteFitProfile {
  readonly arrivalClearance: Mm | null;
  readonly doorSwingRadius: Mm | null;
}

/** Défauts « à valider » : valeurs déduites de l'escalier et des portes saisies. */
export const DEFAULT_SITE_FIT_PROFILE: SiteFitProfile = {
  arrivalClearance: null,
  doorSwingRadius: null,
};

export type SiteFitSettingKey = keyof SiteFitProfile;

/** Provenance des réglages : tous « à valider » (décision F7 (b)). */
export const SITE_FIT_PROVENANCE: Readonly<Record<SiteFitSettingKey, SettingProvenance>> = {
  arrivalClearance: {
    status: "a-valider",
    note: msg("workshop.provenance.siteFit.arrivalClearance"),
  },
  doorSwingRadius: {
    status: "a-valider",
    note: msg("workshop.provenance.siteFit.doorSwingRadius"),
  },
};

/** Réglages effectifs : défauts surchargés champ par champ. */
export function resolveSiteFitProfile(input?: SiteFitProfileInput): SiteFitProfile {
  const d = DEFAULT_SITE_FIT_PROFILE;
  if (!input) return d;
  return {
    arrivalClearance:
      input.arrivalClearance !== undefined ? input.arrivalClearance : d.arrivalClearance,
    doorSwingRadius:
      input.doorSwingRadius !== undefined ? input.doorSwingRadius : d.doorSwingRadius,
  };
}
