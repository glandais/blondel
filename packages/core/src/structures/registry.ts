/**
 * Registre des plugins de structure (`StructureKind`, ADR-0002), indexé par `kind`.
 *
 * Les plugins intégrés (`wood-housed`, `wood-cut`) sont enregistrés au chargement de
 * `structures/index.ts`. `none` n'est pas un plugin : c'est l'absence de structure (pièces de
 * base seules) et ne peut pas être enregistré.
 */
import { MessageError, msg, type Message } from "@blondel/i18n";
import { CAGE_FEATURES, cageFeatures, type CageFeature } from "../model/cageFeatures.js";
import type { Mm } from "../model/primitives.js";
import { isCageLayout, type Project } from "../model/project.js";
import type {
  CarriedHandrail,
  StructureKind,
  StructureLayoutKind,
  StructureLayoutTraits,
  UnsupportedParamOption,
} from "../model/plugins.js";

/**
 * Erreur de configuration non prise en charge par un plugin. Porte un `Message` (ADR-0007),
 * repris tel quel dans `Model.errors` ; `message` en est la traduction française.
 */
export class StructureError extends MessageError {
  constructor(message: Message) {
    super(message);
    this.name = "StructureError";
  }
}

const registry = new Map<string, StructureKind<unknown>>();

/**
 * Enregistre un plugin. Lève une erreur si `kind` est vide, vaut `none` ou est déjà pris
 * (sauf `replace: true`).
 */
export function registerStructure<P>(
  plugin: StructureKind<P>,
  options: { readonly replace?: boolean } = {},
): void {
  const kind = plugin.kind;
  if (kind.trim() === "" || kind === "none") {
    throw new MessageError(msg("structure.common.error.reservedKind", { kind }));
  }
  if (registry.has(kind) && !options.replace) {
    throw new MessageError(msg("structure.common.error.duplicateKind", { kind }));
  }
  registry.set(kind, plugin as StructureKind<unknown>);
}

/** Retire un plugin (tests) ; vrai s'il était enregistré. */
export function unregisterStructure(kind: string): boolean {
  return registry.delete(kind);
}

export function getStructure(kind: string): StructureKind<unknown> | undefined {
  return registry.get(kind);
}

/** Plugins enregistrés, dans l'ordre d'enregistrement. */
export function listStructures(): readonly StructureKind<unknown>[] {
  return [...registry.values()];
}

// ------------------------------------------------------------------ capacités (dette D4)

/** Types de tracé acceptés par `kind` (`none` : tous ; plugin inconnu : aucun). */
export function structureLayouts(kind: string): readonly StructureLayoutKind[] {
  if (kind === "none") return ["flights", "helical"];
  const plugin = registry.get(kind);
  if (!plugin) return [];
  return plugin.capabilities?.layouts ?? ["flights"];
}

/** La structure `kind` accepte-t-elle ce type de tracé ? */
export function structureAcceptsLayout(kind: string, layout: StructureLayoutKind): boolean {
  return structureLayouts(kind).includes(layout);
}

/**
 * Fonctions de cage saisie (ADR-0010) que `kind` sait construire : toutes pour `none` (pièces de
 * base seules) ; `null` si la structure ne lit aucune cage saisie (plugin inconnu, ou sans
 * `capabilities.cage` : tous les plugins intégrés au lot 2, généralisés un par un aux lots 6 et
 * suivants). Avec `params` valides pour le schéma du plugin (défauts appliqués), les fonctions
 * qui en dépendent (`capabilities.cageWith`, sous-lot K2f : palier droit des profilés en limon
 * coudé) ; sans `params`, paramètres invalides ou capacité qui lève : `capabilities.cage`.
 */
export function structureCageFeatures(
  kind: string,
  params?: unknown,
): readonly CageFeature[] | null {
  if (kind === "none") return CAGE_FEATURES;
  const plugin = registry.get(kind);
  const base = plugin?.capabilities?.cage;
  if (!plugin || !base) return null;
  const f = plugin.capabilities?.cageWith;
  if (!f || params === undefined) return base;
  const parsed = plugin.paramsSchema.safeParse(params ?? {});
  if (!parsed.success) return base;
  // Lu hors de `attempt` (garde-fou de `buildModel`) : une capacité qui lève ne doit pas faire
  // lever le pipeline (`buildModel` ne lève jamais) ; on garde alors les fonctions statiques.
  try {
    return f(parsed.data);
  } catch {
    return base;
  }
}

/**
 * Fonctions de `features` (celles d'une cage saisie, `cageFeatures`) que `kind` ne sait pas
 * construire (pour `params`, voir `structureCageFeatures`), dans l'ordre reçu ; `null` si la
 * structure ne lit aucune cage saisie.
 */
export function structureUnsupportedCageFeatures(
  kind: string,
  features: readonly CageFeature[],
  params?: unknown,
): readonly CageFeature[] | null {
  const accepted = structureCageFeatures(kind, params);
  if (accepted === null) return null;
  return features.filter((f) => !accepted.includes(f));
}

/**
 * La structure `kind` sait-elle construire une cage saisie qui utilise `features`
 * (`cageFeatures(spec)`, liste vide comprise), pour `params` s'ils sont donnés ? `none` :
 * toujours.
 */
export function structureAcceptsCage(
  kind: string,
  features: readonly CageFeature[],
  params?: unknown,
): boolean {
  return structureUnsupportedCageFeatures(kind, features, params)?.length === 0;
}

/** Les limons de jour de `kind` exigent-ils un poteau d'angle ? */
export function structureRequiresNewel(kind: string): boolean {
  return registry.get(kind)?.capabilities?.requiresNewel === true;
}

/** Structures enregistrées qui exigent un poteau d'angle (ordre d'enregistrement). */
export function newelRequiredStructures(): string[] {
  return [...registry.values()].filter((p) => p.capabilities?.requiresNewel).map((p) => p.kind);
}

/**
 * Épaisseurs hors emprise utile déclarées par `kind` pour `params` (défauts du plugin
 * appliqués par son schéma) ; `null` si les paramètres sont invalides ou le plugin inconnu ;
 * `none` ou plugin sans déclaration : 0 / 0.
 */
export function structureLateralThickness(
  kind: string,
  params: unknown,
): { readonly inner: Mm; readonly outer: Mm } | null {
  if (kind === "none") return { inner: 0, outer: 0 };
  const plugin = registry.get(kind);
  if (!plugin) return null;
  const f = plugin.capabilities?.lateralThickness;
  if (!f) return { inner: 0, outer: 0 };
  const parsed = plugin.paramsSchema.safeParse(params ?? {});
  return parsed.success ? f(parsed.data) : null;
}

/**
 * Mains courantes que la structure du projet construit elle-même
 * (`capabilities.carriedHandrails`, décision G-Q6) : elles remplacent celle du garde-corps de ce
 * côté. Seule définition, lue par l'étape garde-corps (`computeGuards`), donc aussi par le
 * contrôle quand il la recalcule. Vide si la structure ne sera pas construite : `none`, plugin
 * inconnu, paramètres invalides (erreur de structure), tracé non accepté, cage saisie refusée,
 * capacité qui lève.
 */
export function structureCarriedHandrails(project: Project): readonly CarriedHandrail[] {
  const { kind, params } = project.stair.structure;
  if (kind === "none") return [];
  const plugin = registry.get(kind);
  const f = plugin?.capabilities?.carriedHandrails;
  if (!plugin || !f) return [];
  if (!structureAcceptsLayout(kind, projectLayoutTraits(project).kind)) return [];
  const layout = project.stair.layout;
  if (isCageLayout(layout) && !structureAcceptsCage(kind, cageFeatures(layout), params)) return [];
  const parsed = plugin.paramsSchema.safeParse(params ?? {});
  if (!parsed.success) return [];
  // Lu dans la clé de mémoïsation de `buildModel`, hors de `attempt` : un plugin qui lève ne
  // doit pas faire lever le pipeline (`buildModel` ne lève jamais) ; aucune main courante portée.
  try {
    return f(parsed.data);
  } catch {
    return [];
  }
}

/**
 * Traits du tracé d'un projet vus par les capacités des plugins : type (volées ou hélicoïdal)
 * et nombre de tournants (0 en hélicoïdal). Une cage saisie (ADR-0010) est vue comme des
 * volées dont les tournants sont ses jonctions d'angle non nul (un palier droit, angle 0, ne
 * tourne pas) et ses tronçons à axe en arc (sous-lot 6d : la trace y est courbe, l'escalier
 * n'est pas droit) ; `project.stair.layout.turns` n'existe pas pour elle. Lecture du projet
 * seule, reprise par l'interface (options grisées, paramètres applicables, variantes : limon
 * débillardé proposé, crémaillères non) et par les défauts de `steel-central`, pour un critère
 * unique.
 */
export function projectLayoutTraits(project: Project): StructureLayoutTraits {
  const layout = project.stair.layout;
  switch (layout.kind) {
    case "helical":
      return { kind: "helical", turns: 0 };
    case "cage":
      return {
        kind: "flights",
        turns:
          layout.junctions.filter((j) => j.angle !== 0).length +
          layout.sections.filter((s) => s.axis.kind === "arc").length,
      };
    default:
      return { kind: "flights", turns: layout.turns.length };
  }
}

/**
 * Options de paramètres que `kind` ne sait pas construire sur un tracé `layout`
 * (`capabilities.unsupportedOptions`) ; vide pour `none`, un plugin inconnu ou sans déclaration.
 */
export function structureUnsupportedOptions(
  kind: string,
  layout: StructureLayoutTraits,
): readonly UnsupportedParamOption[] {
  if (kind === "none") return [];
  return registry.get(kind)?.capabilities?.unsupportedOptions?.(layout) ?? [];
}
