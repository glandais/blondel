/**
 * Assemblages entre pièces (`Part.assembledWith`, inspecteur Pièce, ADR-0009) : normalisation
 * par le pipeline des assemblages déclarés par les plugins.
 *
 * Sources : `Part.assembledWith` déjà porté par une pièce (identifiants) et
 * `StructureOutput.assemblies` (paires de `PartRef`). Une référence par numéro de marche
 * désigne les pièces finales du modèle qui portent ce `Part.treadNumber` : aucun plugin n'a à
 * connaître la convention d'identifiant des pièces de marche.
 *
 * Résultat : relation **symétrique**, identifiants de pièces existantes seulement, sans
 * auto-référence ni doublon, dans l'ordre de `Model.parts` ; champ omis pour une pièce sans
 * assemblage. Les pièces inchangées gardent leur identité (mémoïsation).
 */
import type { Part } from "../model/derived.js";
import type { PartAssembly, PartRef } from "../model/plugins.js";

/** Pièces désignées par une référence (identifiant inconnu : aucune). */
function resolve(
  ref: PartRef,
  byId: ReadonlyMap<string, Part>,
  byTread: ReadonlyMap<number, readonly Part[]>,
): readonly Part[] {
  if ("partId" in ref) {
    const p = byId.get(ref.partId);
    return p ? [p] : [];
  }
  return byTread.get(ref.treadNumber) ?? [];
}

const sameList = (a: readonly string[] | undefined, b: readonly string[]): boolean =>
  a !== undefined && a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Pièces du modèle avec `assembledWith` normalisé (voir l'en-tête du module). Rend le tableau
 * d'entrée tel quel si rien ne change.
 */
export function normalizeAssemblies(
  parts: readonly Part[],
  assemblies: readonly PartAssembly[] = [],
): readonly Part[] {
  const hasDeclared = parts.some((p) => p.assembledWith !== undefined);
  if (assemblies.length === 0 && !hasDeclared) return parts;
  const byId = new Map<string, Part>();
  for (const p of parts) if (!byId.has(p.id)) byId.set(p.id, p);
  const byTread = new Map<number, Part[]>();
  for (const p of parts) {
    if (p.treadNumber === undefined) continue;
    const list = byTread.get(p.treadNumber) ?? [];
    list.push(p);
    byTread.set(p.treadNumber, list);
  }
  const links = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    if (a === b || !byId.has(a) || !byId.has(b)) return;
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      const set = links.get(x) ?? new Set<string>();
      set.add(y);
      links.set(x, set);
    }
  };
  for (const p of parts) for (const id of p.assembledWith ?? []) link(p.id, id);
  for (const { a, b } of assemblies) {
    const left = resolve(a, byId, byTread);
    const right = resolve(b, byId, byTread);
    for (const x of left) for (const y of right) link(x.id, y.id);
  }
  const rank = new Map<string, number>();
  parts.forEach((p, i) => {
    if (!rank.has(p.id)) rank.set(p.id, i);
  });
  let changed = false;
  const out = parts.map((p) => {
    const set = links.get(p.id);
    const list = set ? [...set].sort((x, y) => rank.get(x)! - rank.get(y)!) : [];
    if (list.length === 0) {
      if (p.assembledWith === undefined) return p;
      changed = true;
      const { assembledWith: _, ...rest } = p;
      return rest;
    }
    if (sameList(p.assembledWith, list)) return p;
    changed = true;
    return { ...p, assembledWith: list };
  });
  return changed ? out : parts;
}
