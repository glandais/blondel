/**
 * Registre des plugins de structure (`StructureKind`, ADR-0002), indexé par `kind`.
 *
 * Les plugins intégrés (`wood-housed`, `wood-cut`) sont enregistrés au chargement de
 * `structures/index.ts`. `none` n'est pas un plugin : c'est l'absence de structure (pièces de
 * base seules) et ne peut pas être enregistré.
 */
import type { Mm } from "../model/primitives.js";
import type { StructureKind, StructureLayoutKind } from "../model/plugins.js";

/** Erreur de configuration non prise en charge par un plugin (message français). */
export class StructureError extends Error {
  constructor(message: string) {
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
    throw new Error(`Identifiant de structure réservé ou vide : « ${kind} ».`);
  }
  if (registry.has(kind) && !options.replace) {
    throw new Error(`Structure « ${kind} » déjà enregistrée.`);
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
