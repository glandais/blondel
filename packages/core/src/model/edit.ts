/**
 * Contrat commun des mutateurs purs du projet (ADR-0010, plan D, sous-lot 3a) : `site/edit.ts`
 * (murs, trémie, contour de pièce, obstacles) et `layout/cageEdit.ts` (placement, tracé, glisser).
 *
 * - Un mutateur rend `{ project }` (nouveau projet, ou **le même objet** si l'opération est sans
 *   effet) ou `{ error }` (`Message` neutre, ADR-0007) quand l'opération produirait un projet
 *   invalide : il ne lève jamais et ne rend jamais un projet hors schéma.
 * - Le projet est immuable : les sous-objets inchangés sont partagés (`shareStructure`), pour
 *   que la mémoïsation par identité du pipeline et du worker serve (`structuralShare.ts` côté web).
 */
import type { Message } from "@blondel/i18n";
import type { Project } from "./project.js";

/** Résultat d'un mutateur : projet modifié (avec d'éventuelles données en plus) ou refus. */
export type EditResult<Extra extends object = object> =
  | ({ readonly project: Project; readonly error?: undefined } & Extra)
  | { readonly project?: undefined; readonly error: Message };

/** Refus typé d'un mutateur. */
export function editError(error: Message): { readonly error: Message } {
  return { error };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * Partage structurel : rend `next` où chaque sous-objet (objet simple ou tableau) égal en
 * profondeur à son homologue de `prev` est remplacé par celui-ci ; rend `prev` lui-même si tout
 * est égal. Comparaison par `Object.is` sur les feuilles (un −0 diffère de 0 : les mutateurs
 * arrondissent en évitant −0).
 */
export function shareStructure<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return next;
  if (Array.isArray(next)) {
    if (!Array.isArray(prev)) return next;
    let same = prev.length === next.length;
    const out = next.map((v: unknown, i) => {
      const s = shareStructure(prev[i], v);
      if (!Object.is(s, prev[i])) same = false;
      return s;
    });
    return (same ? prev : out) as T;
  }
  if (isPlainObject(next) && isPlainObject(prev)) {
    const keys = Object.keys(next);
    let same = keys.length === Object.keys(prev).length;
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const s = shareStructure(prev[k], next[k]);
      if (!Object.hasOwn(prev, k) || !Object.is(s, prev[k])) same = false;
      out[k] = s;
    }
    return (same ? prev : out) as T;
  }
  return next;
}

/** Arrondi au mm entier (ADR-0003), sans −0. */
export function roundMm(v: number): number {
  return Math.round(v) + 0;
}
