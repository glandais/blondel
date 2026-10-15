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
 * - **Débit, grandeurs et désignation** (CG3, CG4, CG5 ; QUESTIONS D1 remplacée) : ceux du
 *   **représentant** du groupe, son ancre, recopiés sur les autres membres par `unifyMarkGroup`
 *   (l'utilitaire de l'acier) ; le solide reste celui de la pièce réelle. Le représentant est la
 *   plus courte des barres et prismes (PG, BA, LS, CA, MC) et la plus petite par l'aire nette des
 *   panneaux (PN). Le débit recopié d'une barre n'est jamais plus long que la pièce réelle ; celui
 *   d'un panneau peut dépasser une autre pièce du repère sur une cote (longueur en plan ou
 *   hauteur), d'au plus T, la forme étant comparée à T (QUESTIONS G-Q14). La règle est portée
 *   par chaque pièce (`Part.markRepresentative`, posée par `makePart`, G-Q7) et rappelée en ◆
 *   dans l'interface ; à confirmer par un atelier (`MARK_REPRESENTATIVE_PROVENANCES`,
 *   `workshop/profile.ts`).
 *
 * Fonctions pures, sans texte affiché ; elles ne lèvent pas.
 */
import { GEOM_EPS } from "../geom2d/tolerance.js";
import type { Part } from "../model/derived.js";
import type { Mm } from "../model/primitives.js";
import { cmpStr, ranksWithin, unifyMarkGroup } from "../structures/steelCommon.js";
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
   * Pièces repérées : `parts` (dans cet ordre) avec repère, puis débit, grandeurs et désignation
   * commune (`markName`) du représentant de leur groupe, son ancre (la plus courte, ou la plus
   * petite par l'aire nette d'un panneau ; règle à confirmer par un atelier,
   * `MARK_REPRESENTATIVE_PROVENANCE`). Une pièce non enregistrée est rendue telle quelle.
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
      const idx = g.members.map((m) => at[m]!);
      for (const i of idx) out[i] = { ...parts[i]!, mark };
      // CG3, CG4 : débit et grandeurs du représentant (l'ancre), recopiés sur chaque membre.
      const unified = unifyMarkGroup(
        idx.map((i) => out[i]!),
        out[at[g.anchor]!]!,
      );
      idx.forEach((i, k) => (out[i] = unified[k]!));
    }
    return out;
  }
}
