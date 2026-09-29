/**
 * Poteau d'angle attendu par une structure (décisions A4 et A13 de l'utilisateur, 2026-09-30) :
 * fonctions pures, sans calcul de modèle, partagées par les corrections proposées
 * (`fixes.ts`), le choix de structure (`structureChoice.ts`), l'assistant et le comparateur.
 *
 * - Structures de `NEWEL_REQUIRED_STRUCTURES` : limons de jour assemblés sur un poteau d'angle.
 * - Poteau par défaut : `DEFAULT_NEWEL_SIZE`, centré sur le coin intérieur.
 * - `steel-profile` : poteau élargi des profilés (`profileNewel` du plugin : aile + 2 × jeu,
 *   décalé vers le jour), qui dépend de la section retenue.
 */
import { findSection } from "../catalog/sections.js";
import { LayoutError } from "../layout/errors.js";
import { computeLayout } from "../layout/layout.js";
import type { Mm } from "../model/primitives.js";
import { ProjectSchema, type InnerCorner, type Project, type Turn } from "../model/project.js";
import {
  SteelProfileParamsSchema,
  profileNewel,
  profileNewelFits,
  type SteelProfileParams,
} from "../structures/steelProfile.js";

/** Poteau d'angle du contrat `InnerCornerSchema`. */
export type NewelInner = Extract<InnerCorner, { kind: "newel" }>;

/**
 * Structures dont les limons de jour s'assemblent sur un **poteau d'angle** : un jour à angle
 * vif les empêche de se rencontrer (erreur « jour à angle vif » des plugins). Liste tenue ici
 * tant que les plugins ne le déclarent pas eux-mêmes (voir LEDGER §3).
 */
export const NEWEL_REQUIRED_STRUCTURES: readonly string[] = [
  "wood-housed",
  "steel-flat",
  "steel-profile",
];

/**
 * Côté du poteau d'angle proposé (mm). **[Valeur d'usage, confiance faible, à valider]** :
 * C §1.9 cite un poteau de 90 à 100 mm sur un escalier à deux quarts tournants [11] ; même
 * valeur que le cas d'acceptation n° 1 (CHALLENGE P1).
 */
export const DEFAULT_NEWEL_SIZE = 100;

/** Poteau par défaut, centré sur le coin intérieur. */
export const DEFAULT_NEWEL: NewelInner = { kind: "newel", size: DEFAULT_NEWEL_SIZE };

/**
 * Poteau attendu par la structure `kind` de paramètres `params` : `null` si elle n'exige pas de
 * poteau. Pour `steel-profile`, `flangeWidth` est la largeur d'aile de la section retenue (lue
 * sur un modèle, `profileFlangeWidth`) ; sans elle, la section nommée des paramètres ; `null`
 * si le côté dépend d'une section automatique inconnue (il faut un modèle).
 */
export function expectedNewel(
  kind: string,
  params: Readonly<Record<string, unknown>>,
  flangeWidth?: Mm | null,
): NewelInner | null {
  if (!NEWEL_REQUIRED_STRUCTURES.includes(kind)) return null;
  if (kind !== "steel-profile") return DEFAULT_NEWEL;
  const p = profileParams(params);
  if (p.newel.size !== "auto") return profileNewel(0, p.newel);
  const b = flangeWidth ?? namedFlangeWidth(p);
  return b === null ? null : profileNewel(b, p.newel);
}

/** Paramètres `steel-profile` complétés (défauts du plugin si invalides). */
function profileParams(params: Readonly<Record<string, unknown>>): SteelProfileParams {
  const parsed = SteelProfileParamsSchema.safeParse(params);
  return parsed.success ? parsed.data : SteelProfileParamsSchema.parse({});
}

/** Largeur d'aile de la section nommée des paramètres (`null` : section automatique). */
function namedFlangeWidth(p: SteelProfileParams): Mm | null {
  return p.section === "auto" ? null : (findSection(p.section)?.b ?? null);
}

/**
 * Le jour `inner` convient-il à la structure `kind` ? Structure sans poteau : toujours ; autre
 * structure à poteau : tout poteau ; `steel-profile` : poteau élargi (`profileNewelFits`) pour
 * la largeur d'aile `flangeWidth` (à défaut, celle de la section nommée ; inconnue : tout
 * poteau convient, faute de pouvoir en juger).
 */
export function newelSatisfies(
  inner: InnerCorner,
  kind: string,
  params: Readonly<Record<string, unknown>>,
  flangeWidth?: Mm | null,
): boolean {
  if (!NEWEL_REQUIRED_STRUCTURES.includes(kind)) return true;
  if (inner.kind !== "newel") return false;
  if (kind !== "steel-profile") return true;
  const p = profileParams(params);
  const b = flangeWidth ?? namedFlangeWidth(p);
  if (b === null) return p.newel.size === "auto" || newelMatches(inner, profileNewel(0, p.newel));
  return profileNewelFits(inner, b, p.newel);
}

/** Le jour `inner` est-il exactement le poteau `target` (côté et décalage) ? */
export function newelMatches(inner: InnerCorner, target: NewelInner): boolean {
  return (
    inner.kind === "newel" &&
    inner.size === target.size &&
    (inner.offset ?? 0) === (target.offset ?? 0)
  );
}

/** Libellé d'un poteau (« poteau de 106 mm décalé de 33 mm vers le jour »). */
export function newelLabel(n: NewelInner): string {
  return `poteau de ${n.size} mm${(n.offset ?? 0) > 0 ? ` décalé de ${n.offset} mm vers le jour` : ""}`;
}

/** Projet dont les tournants `which` reçoivent le jour `target`. */
export function withNewels(
  project: Project,
  target: NewelInner,
  which: (t: Turn, j: number) => boolean,
): Project {
  const turns = project.stair.layout.turns.map((t, j) =>
    which(t, j) ? { ...t, inner: { ...target } } : t,
  );
  return {
    ...project,
    stair: { ...project.stair, layout: { ...project.stair.layout, turns } },
  };
}

/**
 * Le tracé du projet est-il constructible ? Un poteau doit tenir dans la volée centrale d'un
 * demi-tournant (volée ≥ 2E + retraits) et hors de la ligne de foulée : sinon la modification
 * n'est pas proposée.
 */
export function layoutAccepts(project: Project): boolean {
  const parsed = ProjectSchema.safeParse(project);
  if (!parsed.success) return false;
  try {
    computeLayout(parsed.data);
    return true;
  } catch (e) {
    if (e instanceof LayoutError) return false;
    throw e;
  }
}
