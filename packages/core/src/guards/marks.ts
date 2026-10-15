/**
 * Repères des pièces de garde-corps (chantier guard-marks, sous-lot G2b ; conventions CG1, CG2,
 * décision G-Q5) : regroupement « identiques à T près, à un déplacement près » autour d'une
 * ancre, au lieu de l'arrondi à seuil d'une signature.
 *
 * - **Clé** : préfixe, nature (clé i18n du nom : la main courante de garde-corps, de trémie ou
 *   murale ne se confondent pas), matériau, famille et clé du descripteur de forme (section ou
 *   épaisseur). L'identifiant de la ligne n'y entre pas : des mains courantes identiques
 *   partagent leur repère (G-Q5).
 * - **Identité** : `sameGuardShape` (descripteur de `guardShape.ts`) à T =
 *   `WorkshopProfile.identicalPartTolerance` (+ `GEOM_EPS`), comparée à l'**ancre** du groupe :
 *   la distance n'est pas transitive, on n'enchaîne pas les paires.
 * - **Ordre** : tri canonique avant regroupement (clé, taille par paquets à `GEOM_EPS` près, puis
 *   identifiant), comme `groupNearAnchor` / `groupIdenticalFlats` : la partition ne dépend pas de
 *   l'ordre des pièces, et l'ancre est la plus petite pièce du groupe (longueur d'un prisme ou
 *   d'une barre, aire nette d'un panneau). Numéros par préfixe dans l'ordre de première
 *   apparition des groupes dans les pièces ; numéros réservés sautés (repère d'une main courante
 *   portée par la structure, G-Q6).
 * - **Débit et grandeurs** : ceux de la **première pièce** du groupe dans l'ordre des pièces
 *   (QUESTIONS D1 : une seule ligne de fiche par repère), recopiés sur les autres membres.
 *
 * Fonctions pures, sans texte affiché ; elles ne lèvent pas.
 */
import { GEOM_EPS } from "../geom2d/tolerance.js";
import type { Part } from "../model/derived.js";
import type { Mm } from "../model/primitives.js";
import { cmpStr, ranksWithin } from "../structures/steelCommon.js";
import { sameGuardShape, type GuardShape } from "./guardShape.js";

/** Pièce à repérer. */
export interface GuardMarkEntry {
  readonly id: string;
  /** Préfixe du repère (PG, BA, LS, CA, MC, PN). */
  readonly prefix: string;
  /** Clé de regroupement (préfixe, nature, matériau, famille et clé de forme). */
  readonly key: string;
  readonly shape: GuardShape;
  /** Taille de tri (mm ou mm²) : la plus petite pièce d'un groupe en est l'ancre. */
  readonly size: number;
}

/** Groupe de pièces identiques : indices dans `entries` (ancre, membres croissants). */
export interface GuardMarkGroup {
  readonly anchor: number;
  readonly members: readonly number[];
}

/**
 * Clé de regroupement : préfixe, nature (clé i18n du nom), matériau, famille et clé du
 * descripteur.
 */
export function guardMarkKey(
  prefix: string,
  natureKey: string,
  material: string,
  shape: GuardShape,
): string {
  return `${prefix}|${natureKey}|${material}|${shape.kind}|${shape.key}`;
}

/**
 * Regroupe `entries` (voir l'en-tête) : groupes dans l'ordre de première apparition, membres
 * croissants ; l'ancre est la première pièce du groupe dans l'ordre canonique (la plus petite).
 */
export function groupGuardMarks(entries: readonly GuardMarkEntry[], tol: Mm): GuardMarkGroup[] {
  const rank = ranksWithin(
    entries.map((e) => e.size),
    GEOM_EPS,
  );
  const order = entries.map((_, i) => i);
  order.sort(
    (i, j) =>
      cmpStr(entries[i]!.key, entries[j]!.key) ||
      rank[i]! - rank[j]! ||
      cmpStr(entries[i]!.id, entries[j]!.id) ||
      i - j,
  );
  const byKey = new Map<string, { anchor: number; members: number[] }[]>();
  const groups: { anchor: number; members: number[] }[] = [];
  for (const i of order) {
    const e = entries[i]!;
    let list = byKey.get(e.key);
    if (!list) {
      list = [];
      byKey.set(e.key, list);
    }
    const g = list.find((x) => sameGuardShape(entries[x.anchor]!.shape, e.shape, tol));
    if (g) g.members.push(i);
    else {
      const created = { anchor: i, members: [i] };
      list.push(created);
      groups.push(created);
    }
  }
  for (const g of groups) g.members.sort((a, b) => a - b);
  return groups.sort((a, b) => a.members[0]! - b.members[0]!);
}

/**
 * Repérage des pièces de garde-corps d'un calcul : chaque pièce est enregistrée à sa
 * construction (`add`, repère provisoire vide), les repères sont attribués une fois toutes les
 * pièces connues (`apply`, fin de `computeGuards`).
 */
export class MarkRegistry {
  private readonly entries = new Map<Part, Omit<GuardMarkEntry, "id">>();
  private readonly reserved: ReadonlySet<string>;

  /**
   * `tol` : tolérance d'identité du profil d'atelier ; `reserved` : repères déjà pris par
   * ailleurs (main courante portée par la structure, G-Q6), jamais attribués.
   */
  constructor(
    readonly tol: Mm,
    reserved: readonly string[] = [],
  ) {
    this.reserved = new Set(reserved);
  }

  /** Enregistre une pièce construite (même objet que celui rendu dans les pièces). */
  add(part: Part, entry: Omit<GuardMarkEntry, "id">): void {
    this.entries.set(part, entry);
  }

  /**
   * Pièces repérées : `parts` (dans cet ordre) avec repère, débit et grandeurs de la première
   * pièce de leur groupe. Une pièce non enregistrée est rendue telle quelle.
   */
  apply(parts: readonly Part[]): Part[] {
    const at: number[] = [];
    const entries: GuardMarkEntry[] = [];
    parts.forEach((p, i) => {
      const e = this.entries.get(p);
      if (!e) return;
      at.push(i);
      entries.push({ ...e, id: p.id });
    });
    const out = [...parts];
    const counters = new Map<string, number>();
    for (const g of groupGuardMarks(entries, this.tol)) {
      const prefix = entries[g.anchor]!.prefix;
      let n = (counters.get(prefix) ?? 0) + 1;
      while (this.reserved.has(`${prefix}${n}`)) n++;
      counters.set(prefix, n);
      const mark = `${prefix}${n}`;
      // QUESTIONS D1 : débit et grandeurs de la première pièce du groupe.
      const first = parts[at[g.members[0]!]!]!;
      for (const m of g.members) {
        const i = at[m]!;
        out[i] = {
          ...parts[i]!,
          mark,
          stock: first.stock ? { ...first.stock } : first.stock,
          quantities: { ...first.quantities },
        };
      }
    }
    return out;
  }
}
