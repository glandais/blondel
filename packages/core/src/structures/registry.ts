/**
 * Registre des plugins de structure (`StructureKind`, ADR-0002), indexé par `kind`.
 *
 * Les plugins intégrés (`wood-housed`, `wood-cut`) sont enregistrés au chargement de
 * `structures/index.ts`. `none` n'est pas un plugin : c'est l'absence de structure (pièces de
 * base seules) et ne peut pas être enregistré.
 */
import type { StructureKind } from "../model/plugins.js";

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
