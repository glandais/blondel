/**
 * Choix de la structure (décisions A4 et A13 de l'utilisateur, 2026-09-30).
 *
 * `applyStructureChoice(project, kind, params)` pose la structure et adapte le jour des
 * tournants à ce qu'elle sait construire, en une seule modification (une seule entrée
 * d'annulation dans l'interface) accompagnée de remarques :
 *
 * - structure de `NEWEL_REQUIRED_STRUCTURES` (limons à la française, plat laser, profilés) et
 *   jour à angle vif → **poteau d'angle** de `DEFAULT_NEWEL_SIZE` (correction `jour-newel`,
 *   décision A4) ; sans structure (ou autre structure), le jour vif reste le défaut ;
 * - `steel-profile` → **poteau élargi des profilés** (décision A13) : côté = largeur d'aile de
 *   la section retenue + 2 × jeu (paramètre du plugin, à valider), décalé vers le jour ; il
 *   remplace aussi un poteau existant qui ne lui convient pas (`newelSatisfies`). La section
 *   automatique dépend de la portée, donc du poteau : modèles successifs (au plus
 *   `PROFILE_NEWEL_ITERATIONS`) jusqu'à un poteau qui convient à la section obtenue ;
 * - un jour en arc n'est jamais modifié (erreur explicite du plugin, jalon 5) ;
 * - un poteau que le tracé refuse (volée trop courte, ligne de foulée trop proche) n'est pas
 *   posé : remarque, jour conservé.
 *
 * Fonction pure (les modèles intermédiaires sont calculés sans mémoïsation).
 */
import type { Model } from "../model/derived.js";
import type { Mm } from "../model/primitives.js";
import type { Project, Turn } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { profileFlangeWidth } from "../structures/steelProfile.js";
import {
  DEFAULT_NEWEL,
  NEWEL_REQUIRED_STRUCTURES,
  expectedNewel,
  layoutAccepts,
  newelLabel,
  newelMatches,
  newelSatisfies,
  withNewels,
  type NewelInner,
} from "./newel.js";

/** Nombre maximal de modèles calculés pour le point fixe section ↔ poteau des profilés. */
export const PROFILE_NEWEL_ITERATIONS = 3;

export interface StructureChoiceResult {
  /** Projet avec la structure choisie et, si besoin, le jour adapté. */
  readonly project: Project;
  /** Remarques à afficher (modifications du jour, jour conservé et pourquoi). */
  readonly notes: readonly string[];
}

/** Projet dont la structure est `kind` de paramètres `params`. */
function withStructure(
  project: Project,
  kind: string,
  params: Readonly<Record<string, unknown>>,
): Project {
  return { ...project, stair: { ...project.stair, structure: { kind, params: { ...params } } } };
}

/** Poteau des profilés résolu et largeur d'aile de la section qui l'a fixé. */
export interface ResolvedProfileNewel {
  readonly newel: NewelInner;
  /** Largeur d'aile (mm) de la section retenue avec ce poteau ; `null` si non calculée. */
  readonly flangeWidth: Mm | null;
}

/**
 * Poteau élargi des profilés pour le projet `project` (structure `steel-profile` déjà posée),
 * en remplaçant le jour des tournants `which` : section lue sur le modèle (poteau par défaut
 * d'abord), puis modèle recalculé avec le poteau attendu pour cette section, jusqu'à un poteau
 * qui est **exactement** celui de la section qu'il produit (aile + 2 × jeu, décision A13) ; à
 * défaut (sections voisines qui alternent, au plus `PROFILE_NEWEL_ITERATIONS` modèles), le
 * dernier poteau qui reçoit la section obtenue (`profileNewelFits`), sinon le dernier poteau
 * attendu. Côté imposé ou section nommée : sans modèle. `null` si aucun limon profilé n'est
 * construit (tracé ou découpage en erreur). Le poteau renvoyé peut être refusé par le tracé
 * (`layoutAccepts`) : à l'appelant de le vérifier.
 */
export function resolveProfileNewel(
  project: Project,
  which: (t: Turn, j: number) => boolean,
  build: (p: Project) => Pick<Model, "parts"> = (p) => buildModel(p, { memo: false }),
): ResolvedProfileNewel | null {
  const { kind, params } = project.stair.structure;
  const direct = expectedNewel(kind, params);
  if (direct) return { newel: direct, flangeWidth: null };
  // Dernier poteau attendu (non vérifié) et dernier poteau vérifié sur son propre modèle.
  let last: ResolvedProfileNewel | null = null;
  let fitting: ResolvedProfileNewel | null = null;
  let candidate: NewelInner = DEFAULT_NEWEL;
  const tried: NewelInner[] = [];
  for (let i = 0; i < PROFILE_NEWEL_ITERATIONS; i++) {
    const current = withNewels(project, candidate, which);
    if (!layoutAccepts(current)) break;
    tried.push(candidate);
    const b = profileFlangeWidth(build(current).parts);
    if (b === null) break;
    const next = expectedNewel(kind, params, b);
    if (!next) break;
    if (i > 0 && newelSatisfies(candidate, kind, params, b)) {
      // Poteau vérifié : exact (aile + 2 × jeu de la section qu'il produit) → terminé.
      if (newelMatches(candidate, next)) return { newel: candidate, flangeWidth: b };
      fitting = { newel: candidate, flangeWidth: b };
    }
    last = { newel: next, flangeWidth: b };
    if (tried.some((t) => newelMatches(t, next))) break;
    candidate = next;
  }
  return fitting ?? last;
}

/**
 * Pose la structure `kind` (paramètres `params`, défaut `{}`) et adapte le jour (voir l'en-tête).
 * Les remarques décrivent chaque modification ; aucune si le jour convient déjà.
 */
export function applyStructureChoice(
  project: Project,
  kind: string,
  params: Readonly<Record<string, unknown>> = {},
): StructureChoiceResult {
  const chosen = withStructure(project, kind, params);
  if (!NEWEL_REQUIRED_STRUCTURES.includes(kind)) return { project: chosen, notes: [] };
  const turns = chosen.stair.layout.turns;
  const profile = kind === "steel-profile";
  // Tournants à adapter : jours vifs ; pour les profilés, aussi les poteaux différents du poteau
  // attendu (comparaison faite après résolution de la section).
  const candidate = (t: Turn): boolean =>
    t.inner.kind === "sharp" || (profile && t.inner.kind === "newel");
  if (!turns.some(candidate)) return { project: chosen, notes: [] };

  let target: NewelInner = DEFAULT_NEWEL;
  let flange: Mm | null = null;
  let why = `structure « ${kind} » : limons de jour assemblés sur un poteau d'angle, décision A4, côté à valider`;
  if (profile) {
    const resolved = resolveProfileNewel(chosen, candidate);
    if (resolved) {
      target = resolved.newel;
      flange = resolved.flangeWidth;
      why =
        "poteau élargi des profilés : largeur d'aile + 2 × jeu, décalé vers le jour, qui reçoit chaque limon de jour en barre droite ; décision A13, paramètre « côté du poteau pour profilés », à valider";
    } else {
      why += " ; poteau des profilés indéterminé (section inconnue) : poteau par défaut";
    }
  }
  const which = (t: Turn): boolean =>
    t.inner.kind === "sharp" ||
    (profile && t.inner.kind === "newel" && !newelSatisfies(t.inner, kind, params, flange));
  const indices = turns.map((t, j) => (which(t) ? j : -1)).filter((j) => j >= 0);
  if (indices.length === 0) return { project: chosen, notes: [] };
  const list = (js: readonly number[]): string =>
    `Tournant${js.length > 1 ? "s" : ""} ${js.map((j) => j + 1).join(", ")}`;
  const adapted = withNewels(chosen, target, which);
  if (layoutAccepts(adapted))
    return { project: adapted, notes: changeNotes(turns, indices, target, why) };
  const refused = `${list(indices)} : ${newelLabel(target)} impossible dans ce tracé (volée trop courte ou ligne de foulée trop proche du jour)`;
  // Poteau élargi des profilés refusé : les jours vifs reçoivent au moins le poteau par défaut
  // (décision A4), les poteaux existants sont conservés ; le plugin signale la réception.
  if (profile && !newelMatches(target, DEFAULT_NEWEL)) {
    const sharp = (t: Turn): boolean => t.inner.kind === "sharp";
    const sharpIdx = indices.filter((j) => sharp(turns[j]!));
    const fallback = withNewels(chosen, DEFAULT_NEWEL, sharp);
    if (sharpIdx.length > 0 && layoutAccepts(fallback)) {
      return {
        project: fallback,
        notes: [
          `${refused} ; poteau par défaut posé à la place (limon de jour reçu sans le jeu de la décision A13 : voir FAB_POTEAU_RECEPTION).`,
          ...changeNotes(
            turns,
            sharpIdx,
            DEFAULT_NEWEL,
            `structure « ${kind} » : limons de jour assemblés sur un poteau d'angle, décision A4, côté à valider`,
          ),
        ],
      };
    }
  }
  return { project: chosen, notes: [`${refused} ; jour conservé.`] };
}

/** Remarques « Tournant j : ancien jour → nouveau poteau (pourquoi) ». */
function changeNotes(
  turns: readonly Turn[],
  indices: readonly number[],
  target: NewelInner,
  why: string,
): string[] {
  return indices.map((j) => {
    const from = turns[j]!.inner;
    const was = from.kind === "sharp" ? "jour vif" : newelLabel(from as NewelInner);
    return `Tournant ${j + 1} : ${was} → ${newelLabel(target)} (${why}). Modification annulable.`;
  });
}
