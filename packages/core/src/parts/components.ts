/**
 * Pièces fabriquées d'un lot (QUESTIONS A33 (e), `Part.componentOf`) : une pièce finie faite de
 * composantes (poutre de limon central bois en couches empilées) ne porte ni débit ni grandeurs
 * de matière, ses composantes les portent. Les comptes de pièces, de matière et de surface
 * (liste et fiche de débit, comparateur de variantes, chiffres du projet) portent donc sur les
 * pièces fabriquées : toutes, sauf une pièce finie dont des composantes sont dans le lot.
 * La scène 3D et le glTF font l'inverse (pièce finie dessinée, composantes non dessinées).
 *
 * Composantes imbriquées (QUESTIONS A36 (9), décision du 2026-10-09) : une planche d'une couche
 * composée est composante de sa couche (`componentOf` = la couche), la couche de la poutre
 * (`componentOf` = LC1). Une pièce dont des composantes sont dans le lot (poutre, couche
 * composée) n'est pas fabriquée elle-même : `fabricatedParts` rend les planches et les couches
 * d'une seule planche, sans double compte ; seule la pièce racine (`rootAssemblyId`) est
 * dessinée.
 */
import type { Part } from "../model/derived.js";

/** Pièces fabriquées : toutes, sauf une pièce finie dont des composantes sont dans le lot. */
export function fabricatedParts<P extends Pick<Part, "id" | "componentOf">>(
  parts: readonly P[],
): readonly P[] {
  const assemblies = new Set<string>();
  for (const p of parts) if (p.componentOf !== undefined) assemblies.add(p.componentOf);
  return assemblies.size === 0 ? parts : parts.filter((p) => !assemblies.has(p.id));
}

/**
 * Pièce racine d'une pièce (QUESTIONS A36 (9)) : en remontant `componentOf` tant que la pièce
 * finie est dans le lot (planche → couche → poutre) ; la pièce elle-même si elle n'est la
 * composante d'aucune pièce du lot. Une boucle (lot incohérent) s'arrête sur la dernière pièce
 * visitée.
 */
export function rootAssemblyId<P extends Pick<Part, "id" | "componentOf">>(
  parts: readonly P[],
  id: string,
): string {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const seen = new Set<string>();
  let current = id;
  for (;;) {
    seen.add(current);
    const parent = byId.get(current)?.componentOf;
    if (parent === undefined || !byId.has(parent) || seen.has(parent)) return current;
    current = parent;
  }
}

/**
 * Grandeur de matière d'une pièce (`quantities[key]`, masse, volume…) : la sienne si elle n'a
 * aucune composante dans le lot, sinon la somme de celles de ses composantes, imbriquées
 * (planche → couche → poutre, QUESTIONS A36 (9)). `undefined` si une feuille ne la porte pas ;
 * une boucle (lot incohérent) donne `undefined`.
 */
export function assemblyQuantity<P extends Pick<Part, "id" | "componentOf" | "quantities">>(
  parts: readonly P[],
  id: string,
  key: string,
): number | undefined {
  const children = new Map<string, P[]>();
  const byId = new Map<string, P>();
  for (const p of parts) {
    byId.set(p.id, p);
    if (p.componentOf === undefined) continue;
    const list = children.get(p.componentOf);
    if (list === undefined) children.set(p.componentOf, [p]);
    else list.push(p);
  }
  const visiting = new Set<string>();
  const walk = (pid: string): number | undefined => {
    if (visiting.has(pid)) return undefined;
    const kids = children.get(pid);
    if (kids === undefined) return byId.get(pid)?.quantities[key];
    visiting.add(pid);
    let sum = 0;
    for (const k of kids) {
      const v = walk(k.id);
      if (v === undefined) return undefined;
      sum += v;
    }
    visiting.delete(pid);
    return sum;
  };
  return walk(id);
}
