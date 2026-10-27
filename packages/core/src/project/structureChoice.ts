/**
 * Choix de la structure (décisions A4 et A13 de l'utilisateur, 2026-09-30).
 *
 * `applyStructureChoice(project, kind, params)` pose la structure et adapte le jour des
 * tournants à ce qu'elle sait construire, en une seule modification (une seule entrée
 * d'annulation dans l'interface) accompagnée de remarques :
 *
 * - structure qui exige un poteau (`capabilities.requiresNewel` : limons à la française, plat
 *   laser, profilés) et
 *   jour à angle vif → **poteau d'angle** de `DEFAULT_NEWEL_SIZE` (correction `jour-newel`,
 *   décision A4) ; sans structure (ou autre structure), le jour vif reste le défaut ;
 * - `steel-profile` → **poteau élargi des profilés** (décision A13) : côté = largeur d'aile de
 *   la section retenue + 2 × jeu (paramètre du plugin, à valider), décalé vers le jour ; il
 *   remplace aussi un poteau existant qui ne lui convient pas (`newelSatisfies`). La section
 *   automatique dépend de la portée, donc du poteau : modèles successifs (au plus
 *   `PROFILE_NEWEL_ITERATIONS`) jusqu'à un poteau qui convient à la section obtenue ; avec le
 *   limon coudé (`stringerLine` = `nosing`, chantier bent-stringer K2e2, décisions K-Q15, K-Q19,
 *   K-Q20 et K-Q21 de QUESTIONS A41), un poteau n'est retenu que s'il n'ajoute aucune violation
 *   de règle à la barre droite du même projet (base de comparaison : voir `resolveNosingNewel`),
 *   un modèle de vérification de plus est permis, et quand aucun poteau essayé n'est retenu, le
 *   jour de la barre droite du même projet est posé, avec une remarque (K-Q25, sous-lot K2f) ;
 * - un jour en arc n'est jamais modifié (erreur explicite du plugin, jalon 5) ;
 * - un poteau que le tracé refuse (volée trop courte, ligne de foulée trop proche) n'est pas
 *   posé : remarque, jour conservé ;
 * - cage saisie (tracé libre, ADR-0010) : la structure est posée sans adapter le jour (poteau
 *   refusé en amont pour une jonction de cage) ; une structure qui ne construit pas toutes les
 *   fonctions de la cage (`structureAcceptsCage`, capacité `cage` du plugin, même règle que le
 *   garde-fou de `buildModel`) n'est pas générée (`structure.cageUnsupported`) : remarque, avec
 *   la piste de la reconversion en volées quand la cage s'écrit en volées (correction
 *   `cage-to-flights`) ; une structure à poteau qui construit la cage (limons à la française,
 *   sous-lot 6a) reçoit une remarque pour chaque jonction tournante à jour vif ou en arc, qu'aucun
 *   limon droit ne suit (pan coupé à choisir ; reconversion en volées pour un poteau seulement si
 *   tous ces jours sont vifs : en volées, un jour en arc n'en reçoit pas).
 *
 * Fonction pure (les modèles intermédiaires sont calculés sans mémoïsation).
 */
import { dec, msg, textMessage, type Message } from "@blondel/i18n";
import type { Model } from "../model/derived.js";
import type { Mm } from "../model/primitives.js";
import type { InnerCorner, Project, Turn } from "../model/project.js";
import { cageFeatures } from "../model/cageFeatures.js";
import { buildModel } from "../pipeline/build.js";
import { structureAcceptsCage } from "../structures/registry.js";
import {
  PROFILE_RULES,
  SteelProfileParamsSchema,
  profileFlangeWidth,
} from "../structures/steelProfile.js";
import {
  DEFAULT_NEWEL,
  compareNewels,
  expectedNewel,
  layoutAccepts,
  structureRequiresNewel,
  newelLabel,
  newelMatches,
  newelSatisfies,
  profileNewelFamily,
  withNewels,
  type NewelInner,
} from "./newel.js";
import { toFlightsLayout } from "./layoutConversion.js";

/** Nombre maximal de modèles calculés pour le point fixe section ↔ poteau des profilés. */
export const PROFILE_NEWEL_ITERATIONS = 3;

/**
 * Modèles de vérification permis en plus du point fixe quand son poteau final n'est pas vérifié
 * (limon coudé seulement, décision K-Q20 de l'utilisateur, QUESTIONS A41).
 */
export const PROFILE_NEWEL_VERIFICATIONS = 1;

/**
 * Règles qui ne comptent pas dans les violations « ajoutées » par un poteau (K-Q19) : l'écart
 * d'onglet (`FAB_ONGLET_RACCORD`, conseil), qu'un repli `heavier` entre deux faces coudées peut
 * ouvrir et que l'utilisateur accepte (K-Q21) ; sans cette exception, ce conseil ferait monter le
 * poteau, puis la section.
 */
export const PROFILE_NEWEL_EXEMPT_RULES: readonly string[] = [PROFILE_RULES.miter.id];

/**
 * Nombre de résultats en violation par règle (`compliance.results` au statut `violation`, toutes
 * sévérités ; `ok` et `non-evaluee` ignorés).
 */
export function violationCounts(m: Pick<Model, "compliance">): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of m.compliance.results) {
    if (r.status === "violation") out.set(r.ruleId, (out.get(r.ruleId) ?? 0) + 1);
  }
  return out;
}

/**
 * Violations **ajoutées** par le modèle `m` par rapport à la référence `ref` (K-Q19) : règles dont
 * le nombre de résultats en violation dépasse celui de la référence, avec l'excédent ; les règles
 * `exempt` sont ignorées. Comparaison par compteurs, sans seuil : une règle déjà en violation dans
 * la référence n'est « ajoutée » que si elle l'est plus souvent.
 */
export function addedViolations(
  m: Pick<Model, "compliance">,
  ref: ReadonlyMap<string, number>,
  exempt: readonly string[] = PROFILE_NEWEL_EXEMPT_RULES,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [rule, n] of violationCounts(m)) {
    if (exempt.includes(rule)) continue;
    const excess = n - (ref.get(rule) ?? 0);
    if (excess > 0) out.set(rule, excess);
  }
  return out;
}

export interface StructureChoiceResult {
  /** Projet avec la structure choisie et, si besoin, le jour adapté. */
  readonly project: Project;
  /** Remarques à afficher (modifications du jour, jour conservé et pourquoi). */
  readonly notes: readonly Message[];
}

/**
 * Paramètres d'un **choix neuf** de structure (assistant, comparateur, choix dans l'interface,
 * exemples) : pour les profilés sur un tracé à tournant (volées à tournant ou cage saisie), la
 * ligne d'appui par défaut (`stringerLine` = `nosing`, décision K-Q11) est écrite explicitement
 * quand elle manque, pour que la remarque de bascule `structure.steelProfile.note.defaultCranked`
 * reste réservée aux projets enregistrés avant la bascule (sous-lot K2d). Escaliers droits
 * inchangés (le limon y est droit dans les deux réglages, invariant I1 de K1, sauf nez imposés
 * inclinés : ligne des nez brisée, limon coudé et remarque de bascule, question ouverte K-Q39) ;
 * autres paramètres et autres structures rendus tels quels.
 */
export function explicitStructureParams(
  project: Project,
  kind: string,
  params: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (kind !== "steel-profile" || Object.hasOwn(params, "stringerLine")) return params;
  return isTurningLayout(project.stair.layout) ? { ...params, stringerLine: "nosing" } : params;
}

/** Tracé à tournant : volées à tournant ou cage saisie (l'hélicoïdal n'en est pas un ici). */
export function isTurningLayout(layout: Project["stair"]["layout"]): boolean {
  return layout.kind === "cage" || (layout.kind !== "helical" && layout.turns.length > 0);
}

/**
 * Édition du tracé d'un escalier en profilés qui passe d'une volée droite à un tournant (volées
 * à tournant ou cage saisie) : la ligne d'appui par défaut (`stringerLine` = `nosing`) est écrite
 * dans le projet quand elle manque (décision K-Q36 de l'utilisateur, QUESTIONS A41, sous-lot
 * K2h), comme pour un choix neuf (`explicitStructureParams`) : la remarque de bascule
 * `structure.steelProfile.note.defaultCranked` ne reste que sur les fichiers enregistrés avant
 * cette version. Appelée par l'interface après chaque édition du projet (pas au chargement d'un
 * fichier, ni à l'annulation). Rend `next` lui-même (même objet, mémoïsation par identité)
 * dans tous les autres cas : autre structure, ligne d'appui déjà choisie (`chord` compris),
 * tracé précédent déjà à tournant, tracé suivant droit. Pure, ne lève jamais.
 */
export function stringerLineOnTurn(previous: Project, next: Project): Project {
  // `next` n'est pas encore validé par le schéma (édition de l'interface, refusée ensuite si
  // invalide) : une forme inattendue le rend tel quel.
  try {
    const structure = next.stair.structure;
    const params: unknown = structure.params;
    if (structure.kind !== "steel-profile" || typeof params !== "object" || params === null) {
      return next;
    }
    if (Object.hasOwn(params, "stringerLine")) return next;
    if (isTurningLayout(previous.stair.layout) || !isTurningLayout(next.stair.layout)) return next;
    return withStructure(
      next,
      structure.kind,
      explicitStructureParams(next, structure.kind, structure.params),
    );
  } catch {
    return next;
  }
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
  /**
   * Limon coudé seulement (`nosing`) : le poteau a été construit et reçoit l'aile de la section
   * de son propre modèle (`newelSatisfies`). Absent en barre droite et sur le chemin direct.
   */
  readonly verified?: boolean;
  /**
   * Limon coudé seulement, quand aucun poteau essayé n'est retenu (K-Q19) : jour de la **barre
   * droite du même projet** à poser tel quel (décision K-Q25, sous-lot K2f) ; absent sinon.
   * `newel` et `flangeWidth` décrivent alors ce jour (poteau posé dans la barre droite, sinon
   * poteau de son point fixe, sinon poteau du premier tournant visé, sinon poteau par défaut ;
   * aile du limon coudé aux jours de la barre droite), `verified` dit s'il reçoit cette aile.
   * `adaptJour` (comparateur) ne lit que `newel` et `flangeWidth`.
   */
  readonly chordJour?: ChordJour;
}

/** Jour de la barre droite gardé par le limon coudé (K-Q25). */
export interface ChordJour {
  /** Jour de chaque tournant du projet de la barre droite (`turns[j].inner`). */
  readonly turns: readonly InnerCorner[];
  /** Remarques de la pose du poteau dans la barre droite (`placeNewel`). */
  readonly notes: readonly Message[];
  /** Règles que les poteaux essayés ajoutaient à la base (union triée, pour la remarque). */
  readonly rules: readonly string[];
  /**
   * Règles que le limon coudé au jour gardé ajoute encore à la **barre droite** du même projet
   * (triées, `PROFILE_NEWEL_EXEMPT_RULES` à part ; décision K-Q29, sous-lot K2f2). Lues sur le
   * modèle coudé de la base, déjà construit : aucun modèle de plus. Comparer à la base entière
   * ne trouverait rien (elle contient ce modèle) : seul son premier terme, la barre droite,
   * compte. Vide : remarque neutre `newelFromChord` ; sinon `newelAddsViolations`.
   */
  readonly keptAdds: readonly string[];
}

/** Modèle réduit lu par le point fixe : pièces (aile) et contrôle de conception (K-Q19). */
export type ProfileNewelModel = Pick<Model, "parts" | "compliance">;

/**
 * Poteau élargi des profilés pour le projet `project` (structure `steel-profile` déjà posée),
 * en remplaçant le jour des tournants `which`. Côté imposé ou section nommée : sans modèle.
 * `null` si aucun limon profilé n'est construit (tracé ou découpage en erreur). Le poteau
 * renvoyé peut être refusé par le tracé (`layoutAccepts`) : à l'appelant de le vérifier.
 *
 * - **Barre droite** (`stringerLine` = `chord`) : section lue sur le modèle (poteau par
 *   défaut d'abord), puis modèle recalculé avec le poteau attendu pour cette section, jusqu'à un
 *   poteau qui est **exactement** celui de la section qu'il produit (aile + 2 × jeu, décision
 *   A13) ; à défaut (sections voisines qui alternent, au plus `PROFILE_NEWEL_ITERATIONS`
 *   modèles), le dernier poteau qui reçoit la section obtenue (`profileNewelFits`), sinon le
 *   dernier poteau attendu (`resolveChordNewel`, inchangé).
 * - **Limon coudé** (`nosing`, défaut depuis le sous-lot K2d, K-Q11 ; K2e2) : voir
 *   `resolveNosingNewel`.
 */
export function resolveProfileNewel(
  project: Project,
  which: (t: Turn, j: number) => boolean,
  build: (p: Project) => ProfileNewelModel = (p) => buildModel(p, { memo: false }),
): ResolvedProfileNewel | null {
  const { kind, params } = project.stair.structure;
  const direct = expectedNewel(kind, params);
  if (direct) return { newel: direct, flangeWidth: null };
  const parsed = SteelProfileParamsSchema.safeParse(params);
  if (parsed.success && parsed.data.stringerLine === "nosing") {
    return resolveNosingNewel(project, which, build);
  }
  return resolveChordNewel(project, which, build);
}

/** Point fixe de la barre droite (algorithme d'origine, sans changement de comportement). */
function resolveChordNewel(
  project: Project,
  which: (t: Turn, j: number) => boolean,
  build: (p: Project) => ProfileNewelModel,
): ResolvedProfileNewel | null {
  const { kind, params } = project.stair.structure;
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
 * Clé d'un modèle du point fixe dans le cache d'un appel : ligne d'appui et jours. La ligne
 * d'appui est lue sur les paramètres complétés par les défauts du schéma (sous-lot K2d : un
 * projet sans `stringerLine` est en limon coudé, il ne doit pas partager la clé de sa référence
 * en barre droite, `stringerLine` = `chord` explicite).
 */
function newelModelKey(p: Project): string {
  const parsed = SteelProfileParamsSchema.safeParse(p.stair.structure.params);
  const line = parsed.success ? parsed.data.stringerLine : "invalid";
  const layout = p.stair.layout;
  const turns = layout.kind === "cage" ? "cage" : JSON.stringify(layout.turns.map((t) => t.inner));
  return `${line}|${turns}`;
}

/** Même projet, paramètres de structure `params` (même `kind`). */
function withParams(p: Project, params: Readonly<Record<string, unknown>>): Project {
  return withStructure(p, p.stair.structure.kind, params);
}

/** Maximum, règle par règle, de deux compteurs de violations. */
function maxCounts(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
): Map<string, number> {
  const out = new Map(a);
  for (const [rule, n] of b) out.set(rule, Math.max(n, out.get(rule) ?? 0));
  return out;
}

/**
 * Point fixe section ↔ poteau du **limon coudé** (`stringerLine` = `nosing`, sous-lot K2e2,
 * décisions K-Q15, K-Q19, K-Q20 et K-Q21 de QUESTIONS A41). Un poteau est **retenu** s'il est
 * accepté par le tracé, s'il reçoit l'aile de la section de son propre modèle (`newelSatisfies`)
 * et s'il n'**ajoute** aucune violation de règle (`addedViolations` : compteurs par règle,
 * toutes sévérités, `PROFILE_NEWEL_EXEMPT_RULES` à part, aucun seuil) à la base suivante.
 *
 * **Base de comparaison** (construite à la demande, au premier poteau vérifié à juger) : la
 * **référence** est le même projet en `stringerLine` = `chord`, poteau posé comme
 * `applyStructureChoice` le poserait en barre droite (point fixe `resolveChordNewel`, puis
 * `placeNewel` : poteaux existants qui reçoivent sa section conservés, poteau par défaut sur les
 * jours vifs si le tracé refuse le poteau élargi). Pour chaque règle, la base est le **maximum**
 * des résultats en violation de la référence et du **limon coudé au poteau de la référence** :
 * une violation que la ligne d'appui coudée crée quel que soit le poteau (débord d'appui en
 * profilé IPE ou HEA, par exemple) n'est pas imputée au poteau ; seule compte celle qu'un poteau
 * ajoute par rapport au poteau de la barre droite (lecture de « ajoute une violation » de K-Q19,
 * validée par K-Q24). Le poteau de la référence n'est donc jamais écarté par K-Q19. Le modèle
 * coudé au poteau de la référence n'est construit que pour juger un poteau qui dépasse la
 * référence.
 *
 * 1. boucle du point fixe, au plus `PROFILE_NEWEL_ITERATIONS` modèles construits (un modèle
 *    déjà en cache, celui de la base, ne compte pas) : un poteau vérifié, retenu et exact est
 *    rendu ; retenu non exact, il est gardé (K-Q15) ; **non retenu** (K-Q19), il est écarté et
 *    le poteau essayé ensuite est celui **posé** dans la référence s'il est plus grand et pas
 *    encore essayé (son modèle coudé est celui de la base : jugé sans modèle de plus), sinon le
 *    plus petit poteau de la famille (`profileNewelFamily`) au-dessus de lui ; un poteau ainsi
 *    visé que le tracé refuse est passé, sans modèle, au cran suivant ;
 * 2. poteau final non vérifié, ou poteau plus petit encore possible (K-Q20) : au plus
 *    `PROFILE_NEWEL_VERIFICATIONS` modèle de plus, sur le plus petit poteau de la famille non
 *    essayé et accepté par le tracé, au-dessus de tous les poteaux non retenus et sous le poteau
 *    gardé ; rendu s'il est retenu ;
 * 3. sinon le poteau gardé (K-Q15) ; sinon, si au moins un poteau vérifié a été écarté par
 *    K-Q19 (aucun poteau essayé n'est retenu), **le jour de la barre droite du même projet**
 *    (décision K-Q25, sous-lot K2f : plus de « moindre excédent ») : `chordJour` porte les jours
 *    de la référence, ses remarques de pose et les règles ajoutées par les poteaux écartés ;
 *    `applyStructureChoice` pose ces jours tels quels avec une remarque. Le modèle coudé au jour
 *    de la référence est celui de la base, déjà construit (aucun modèle de plus) : son aile donne
 *    `flangeWidth` et `verified` ; sinon le dernier poteau attendu, non vérifié.
 *
 * Budget : au plus `PROFILE_NEWEL_ITERATIONS` + `PROFILE_NEWEL_VERIFICATIONS` + 1 (base, si un
 * poteau dépasse la référence) modèles coudés et `PROFILE_NEWEL_ITERATIONS` en barre droite pour la référence (modèles mis
 * en cache pour la durée de l'appel : le modèle coudé de la base est souvent un modèle du point
 * fixe, celui de la référence le dernier du point fixe de la barre droite).
 */
function resolveNosingNewel(
  project: Project,
  which: (t: Turn, j: number) => boolean,
  build: (p: Project) => ProfileNewelModel,
): ResolvedProfileNewel | null {
  const { kind, params } = project.stair.structure;
  const cache = new Map<string, ProfileNewelModel>();
  const cached = (p: Project): ProfileNewelModel => {
    const key = newelModelKey(p);
    let m = cache.get(key);
    if (!m) {
      m = build(p);
      cache.set(key, m);
    }
    return m;
  };
  // Base de comparaison : barre droite du même projet et limon coudé à son poteau.
  type Reference = {
    readonly chord: Map<string, number>;
    readonly newel: NewelInner | null;
    readonly project: Project;
    readonly notes: readonly Message[];
    /** Poteau du point fixe de la barre droite (`resolveChordNewel`), posé ou non. */
    readonly fixed: NewelInner | null;
    base?: Map<string, number>;
  };
  let ref: Reference | null = null;
  const reference = (): Reference => {
    if (ref) return ref;
    const chordParams = { ...params, stringerLine: "chord" };
    const chordP = withParams(project, chordParams);
    const rc = resolveChordNewel(chordP, which, cached);
    const placed = placeNewel(
      chordP,
      kind,
      chordParams,
      which,
      rc?.newel ?? DEFAULT_NEWEL,
      rc?.flangeWidth ?? null,
      msg("project.structureChoice.why.profileNewel"),
    );
    const chord = violationCounts(cached(placed.project));
    ref = {
      chord,
      newel: placed.posed,
      project: placed.project,
      notes: placed.notes,
      fixed: rc?.newel ?? null,
    };
    return ref;
  };
  /** Base : maximum de la référence et du limon coudé à son poteau (construit à la demande). */
  const baseCounts = (): Map<string, number> => {
    const r = reference();
    r.base ??= maxCounts(r.chord, violationCounts(cached(withParams(r.project, params))));
    return r.base;
  };
  const family = profileNewelFamily(kind, params);
  const tried: NewelInner[] = [];
  const wasTried = (n: NewelInner): boolean => tried.some((t) => newelMatches(t, n));
  const refused: NewelInner[] = [];
  const wasRefused = (n: NewelInner): boolean => refused.some((t) => newelMatches(t, n));
  /** Plus petit poteau de la famille au-dessus de `from`, ni essayé ni refusé par le tracé. */
  const stepUp = (from: NewelInner): NewelInner | undefined =>
    family.find((f) => compareNewels(f, from) > 0 && !wasTried(f) && !wasRefused(f));
  const unretained: NewelInner[] = [];
  /** Règles ajoutées par chaque poteau vérifié écarté par K-Q19. */
  const rejected: ReadonlyMap<string, number>[] = [];
  let fitting: ResolvedProfileNewel | null = null;
  let last: ResolvedProfileNewel | null = null;
  /** Poteau vérifié sur le modèle `m` : retenu (K-Q19), sinon ses règles ajoutées sont notées. */
  const retained = (m: ProfileNewelModel): boolean => {
    // La base majore la référence : sans excédent sur la référence, le modèle coudé à son poteau
    // n'est pas construit.
    if (addedViolations(m, reference().chord).size === 0) return true;
    const added = addedViolations(m, baseCounts());
    if (added.size === 0) return true;
    rejected.push(added);
    return false;
  };
  let candidate: NewelInner = DEFAULT_NEWEL;
  let jumped = false;
  // Modèles construits par la boucle ; un modèle déjà en cache (celui de la base, au poteau de
  // la référence) ne compte pas. La boucle finit : chaque tour essaie un poteau nouveau.
  let built = 0;
  for (let i = 0; ; i++) {
    let current = withNewels(project, candidate, which);
    if (!layoutAccepts(current)) {
      // Poteau visé après un rejet (K-Q19) refusé par le tracé : cran suivant, sans modèle.
      if (!jumped) break;
      let alt: NewelInner | undefined = candidate;
      while (alt && !layoutAccepts(current)) {
        refused.push(alt);
        alt = stepUp(alt);
        if (alt) current = withNewels(project, alt, which);
      }
      if (!alt) break;
      candidate = alt;
    }
    jumped = false;
    if (!cache.has(newelModelKey(current))) {
      if (built >= PROFILE_NEWEL_ITERATIONS) break;
      built++;
    }
    tried.push(candidate);
    const m = cached(current);
    const b = profileFlangeWidth(m.parts);
    if (b === null) break;
    let next = expectedNewel(kind, params, b);
    if (!next) break;
    if (i > 0 && newelSatisfies(candidate, kind, params, b)) {
      if (retained(m)) {
        if (newelMatches(candidate, next)) {
          return { newel: candidate, flangeWidth: b, verified: true };
        }
        fitting = { newel: candidate, flangeWidth: b, verified: true };
      } else {
        // K-Q19 : poteau écarté ; on monte vers le poteau posé dans la référence, sinon d'un cran.
        unretained.push(candidate);
        const rn = reference().newel;
        const from = candidate;
        const up =
          rn && compareNewels(rn, from) > 0 && !wasTried(rn) && !wasRefused(rn) ? rn : stepUp(from);
        if (up) {
          next = up;
          jumped = true;
        }
      }
    } else if (i > 0) {
      unretained.push(candidate);
    }
    last = { newel: next, flangeWidth: b, verified: false };
    if (wasTried(next)) break;
    candidate = next;
  }
  // K-Q20 : un modèle de vérification de plus, au-dessus du plus grand poteau non retenu et
  // sous le poteau gardé.
  if (last || fitting) {
    const floor = unretained.reduce<NewelInner | null>(
      (a, n) => (a === null || compareNewels(n, a) > 0 ? n : a),
      null,
    );
    const ks = family.filter(
      (f) =>
        !wasTried(f) &&
        !wasRefused(f) &&
        (floor === null || compareNewels(f, floor) > 0) &&
        (fitting === null || compareNewels(f, fitting.newel) < 0),
    );
    let verifications = 0;
    for (const k of ks) {
      if (verifications >= PROFILE_NEWEL_VERIFICATIONS) break;
      const current = withNewels(project, k, which);
      if (!layoutAccepts(current)) continue;
      verifications++;
      tried.push(k);
      const m = cached(current);
      const b = profileFlangeWidth(m.parts);
      if (b !== null && newelSatisfies(k, kind, params, b) && retained(m)) {
        return { newel: k, flangeWidth: b, verified: true };
      }
    }
  }
  if (fitting) return fitting;
  // K-Q25 : tous les poteaux vérifiés jugés sont écartés : jour de la barre droite du même projet,
  // tel que la référence le pose (son modèle coudé est celui de la base, déjà construit).
  if (rejected.length > 0) {
    const r = reference();
    const layout = r.project.stair.layout;
    const turns = layout.kind === "cage" ? [] : layout.turns.map((t) => t.inner);
    const firstAimed = project.stair.layout.kind === "cage" ? [] : project.stair.layout.turns;
    const aimed = firstAimed.findIndex((t, j) => which(t, j));
    const aimedInner = aimed >= 0 ? turns[aimed] : undefined;
    // Poteau de la barre droite : posé dans la référence, sinon celui de son point fixe (jour non
    // remplacé par `placeNewel`, jour en arc du comparateur par exemple : `adaptJour` le pose),
    // sinon le jour du premier tournant visé s'il est un poteau, sinon le poteau par défaut.
    const newel: NewelInner =
      r.newel ??
      r.fixed ??
      (aimedInner?.kind === "newel" ? (aimedInner as NewelInner) : DEFAULT_NEWEL);
    const kept = cached(withParams(r.project, params));
    const b = profileFlangeWidth(kept.parts);
    const rules = [...new Set(rejected.flatMap((a) => [...a.keys()]))].sort();
    // K-Q29 : violations que le jour gardé ajoute encore à la barre droite (même modèle, en cache).
    const keptAdds = [...addedViolations(kept, r.chord).keys()].sort();
    return {
      newel,
      flangeWidth: b,
      verified: b !== null && newelSatisfies(newel, kind, params, b),
      chordJour: { turns, notes: r.notes, rules, keptAdds },
    };
  }
  return last;
}

/**
 * Pose la structure `kind` (paramètres `params`, défaut `{}`) et adapte le jour (voir l'en-tête).
 * Les remarques décrivent chaque modification ; aucune si le jour convient déjà.
 */
export function applyStructureChoice(
  project: Project,
  kind: string,
  requested: Readonly<Record<string, unknown>> = {},
): StructureChoiceResult {
  const params = explicitStructureParams(project, kind, requested);
  const chosen = withStructure(project, kind, params);
  const spec = chosen.stair.layout;
  if (spec.kind === "cage") {
    // Même règle que le garde-fou de `buildModel` (capacité `cage` du plugin) : pas de remarque
    // quand la structure construit toutes les fonctions de la cage (« aucune » : toujours).
    const convertible = (): boolean =>
      cageFeatures(spec).length === 0 && toFlightsLayout(chosen) !== null;
    if (structureAcceptsCage(kind, cageFeatures(spec), chosen.stair.structure.params)) {
      if (!structureRequiresNewel(kind)) return { project: chosen, notes: [] };
      // Jour vif ou en arc d'une jonction tournante : pas de poteau sur une cage saisie.
      const open = spec.junctions
        .map((j, i) =>
          j.angle !== 0 && (j.well.kind === "sharp" || j.well.kind === "arc") ? i : -1,
        )
        .filter((i) => i >= 0);
      if (open.length === 0) return { project: chosen, notes: [] };
      const params = {
        kind,
        count: open.length,
        junctions: open.map((i) => i + 1).join(", "),
      };
      return {
        project: chosen,
        notes: [
          convertible() && open.every((i) => spec.junctions[i]!.well.kind === "sharp")
            ? msg("project.structureChoice.cageJourConvertible", params)
            : msg("project.structureChoice.cageJour", params),
        ],
      };
    }
    return {
      project: chosen,
      notes: [
        convertible()
          ? msg("project.structureChoice.cageConvertible", { kind })
          : msg("project.structureChoice.cage", { kind }),
      ],
    };
  }
  if (!structureRequiresNewel(kind)) return { project: chosen, notes: [] };
  const turns = chosen.stair.layout.turns;
  const profile = kind === "steel-profile";
  // Tournants à adapter : jours vifs ; pour les profilés, aussi les poteaux différents du poteau
  // attendu (comparaison faite après résolution de la section).
  const candidate = (t: Turn): boolean =>
    t.inner.kind === "sharp" || (profile && t.inner.kind === "newel");
  if (!turns.some(candidate)) return { project: chosen, notes: [] };

  let target: NewelInner = DEFAULT_NEWEL;
  let flange: Mm | null = null;
  let why: Message = msg("project.structureChoice.why.cornerNewel", { kind });
  if (profile) {
    const resolved = resolveProfileNewel(chosen, candidate);
    if (resolved?.chordJour) {
      // Limon coudé : aucun poteau essayé n'est retenu (K-Q19) ; jour de la barre droite du même
      // projet posé tel quel, avec ses remarques de pose et une remarque (K-Q25).
      return chordJourChoice(chosen, resolved.chordJour);
    }
    if (resolved) {
      target = resolved.newel;
      flange = resolved.flangeWidth;
      why = msg("project.structureChoice.why.profileNewel");
    } else {
      why = msg("project.structureChoice.why.cornerNewelUnknownProfile", { kind });
    }
  }
  const placed = placeNewel(chosen, kind, params, candidate, target, flange, why);
  return { project: placed.project, notes: placed.notes };
}

/** Libellé d'un jour gardé (poteau, angle vif, jour en arc). */
function innerLabel(c: InnerCorner): Message {
  if (c.kind === "newel") return newelLabel(c as NewelInner);
  if (c.kind === "arc")
    return msg("structure.common.compare.jour.arc", { radius: dec(c.radius, 0) });
  return msg("project.structureChoice.sharpJour");
}

/**
 * Jour de la barre droite posé pour le limon coudé (K-Q25) : jours des tournants de la barre
 * droite du même projet, remarques de leur pose, puis une remarque (K-Q29, sous-lot K2f2) :
 * `newelAddsViolations` si le jour gardé ajoute encore une violation à la barre droite (règles
 * que les poteaux essayés ajoutaient, règles que le jour gardé ajoute), sinon la remarque neutre
 * `newelFromChord` (le poteau est celui de la barre droite) ; jours gardés des tournants,
 * libellés distincts dans l'ordre des tournants.
 */
function chordJourChoice(chosen: Project, jour: ChordJour): StructureChoiceResult {
  const layout = chosen.stair.layout;
  if (layout.kind === "cage") return { project: chosen, notes: [] };
  const turns = layout.turns.map((t, j) => ({ ...t, inner: jour.turns[j] ?? t.inner }));
  const project: Project = { ...chosen, stair: { ...chosen.stair, layout: { ...layout, turns } } };
  const labels: Message[] = [];
  for (const t of turns) {
    const l = innerLabel(t.inner);
    if (!labels.some((x) => JSON.stringify(x) === JSON.stringify(l))) labels.push(l);
  }
  const join = (items: readonly Message[]): Message | null =>
    items.reduceRight<Message | null>(
      (rest, first) => (rest === null ? first : msg("common.list", { first, rest })),
      null,
    );
  // Identifiants de règle cités tels quels, liés comme les jours (`common.list`).
  const rules = join(jour.rules.map((r) => textMessage(r))) ?? "";
  const kept = join(labels) ?? msg("project.structureChoice.sharpJour");
  const added = join(jour.keptAdds.map((r) => textMessage(r)));
  return {
    project,
    notes: [
      ...jour.notes,
      added
        ? msg("project.structureChoice.newelAddsViolations", { rules, jour: kept, added })
        : msg("project.structureChoice.newelFromChord", { rules, jour: kept }),
    ],
  };
}

/** Projet avec le poteau posé, remarques, et poteau posé sur les tournants visés (`null` : aucun). */
interface PlacedNewel extends StructureChoiceResult {
  readonly posed: NewelInner | null;
}

/**
 * Pose du poteau `target` (aile `flange`) sur les tournants de `scope` qui ne le reçoivent pas
 * déjà (jours vifs ; pour les profilés, poteaux qui ne reçoivent pas la section) : règle commune
 * à `applyStructureChoice` et à la référence en barre droite du point fixe du limon coudé.
 * Poteau élargi refusé par le tracé : poteau par défaut sur les jours vifs (décision A4), sinon
 * projet inchangé.
 */
function placeNewel(
  chosen: Project,
  kind: string,
  params: Readonly<Record<string, unknown>>,
  scope: (t: Turn, j: number) => boolean,
  target: NewelInner,
  flange: Mm | null,
  why: Message,
): PlacedNewel {
  if (chosen.stair.layout.kind === "cage") return { project: chosen, notes: [], posed: null };
  const turns = chosen.stair.layout.turns;
  const profile = kind === "steel-profile";
  const which = (t: Turn, j: number): boolean =>
    scope(t, j) &&
    (t.inner.kind === "sharp" ||
      (profile && t.inner.kind === "newel" && !newelSatisfies(t.inner, kind, params, flange)));
  const indices = turns.map((t, j) => (which(t, j) ? j : -1)).filter((j) => j >= 0);
  if (indices.length === 0) return { project: chosen, notes: [], posed: null };
  const list = (js: readonly number[]): Message =>
    msg("project.structureChoice.turns", {
      count: js.length > 1 ? 2 : 1,
      turns: js.map((j) => j + 1).join(", "),
    });
  const adapted = withNewels(chosen, target, which);
  if (layoutAccepts(adapted))
    return { project: adapted, notes: changeNotes(turns, indices, target, why), posed: target };
  const refused = msg("project.structureChoice.refused", {
    turns: list(indices),
    newel: newelLabel(target),
  });
  // Poteau élargi des profilés refusé : les jours vifs reçoivent au moins le poteau par défaut
  // (décision A4), les poteaux existants sont conservés ; le plugin signale la réception.
  if (profile && !newelMatches(target, DEFAULT_NEWEL)) {
    const sharp = (t: Turn, j: number): boolean => scope(t, j) && t.inner.kind === "sharp";
    const sharpIdx = indices.filter((j) => sharp(turns[j]!, j));
    const fallback = withNewels(chosen, DEFAULT_NEWEL, sharp);
    if (sharpIdx.length > 0 && layoutAccepts(fallback)) {
      return {
        project: fallback,
        notes: [
          msg("project.structureChoice.refusedDefaultNewel", { refused }),
          ...changeNotes(
            turns,
            sharpIdx,
            DEFAULT_NEWEL,
            msg("project.structureChoice.why.cornerNewel", { kind }),
          ),
        ],
        posed: DEFAULT_NEWEL,
      };
    }
  }
  return {
    project: chosen,
    notes: [msg("project.structureChoice.refusedKept", { refused })],
    posed: null,
  };
}

/** Remarques « Tournant j : ancien jour → nouveau poteau (pourquoi) ». */
function changeNotes(
  turns: readonly Turn[],
  indices: readonly number[],
  target: NewelInner,
  why: Message,
): Message[] {
  return indices.map((j) => {
    const from = turns[j]!.inner;
    const was =
      from.kind === "sharp"
        ? msg("project.structureChoice.sharpJour")
        : newelLabel(from as NewelInner);
    return msg("project.structureChoice.change", {
      turn: j + 1,
      was,
      newel: newelLabel(target),
      why,
    });
  });
}
