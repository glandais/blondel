/**
 * Pièces liées d'une marche et d'une pièce (inspecteurs Marche et Pièce, ADR-0009, vague 3) :
 * lecture de `Part.treadNumber`, `Part.assembledWith` et des tronçons (`lib/joints.ts`), sans
 * calcul. Les listes rendues suivent l'ordre de `Model.parts`, sans doublon.
 *
 * Visserie d'une pièce (QUESTIONS A27) : éléments de `Model.fasteners` dont l'assemblage comprend
 * la pièce, réunis par repère (`fastenerLines` du cœur, quantités de ces assemblages seulement).
 */
import { fastenerLines, type FastenerLine, type Model, type Part } from "@blondel/core";
import { messageEquals, type Message } from "@blondel/i18n";
import { segmentedParts } from "./joints.js";

/** Pièces de `model.parts` dont l'identifiant est dans `ids`, dans l'ordre du modèle. */
function inModelOrder(model: Pick<Model, "parts">, ids: ReadonlySet<string>): Part[] {
  return model.parts.filter((p) => ids.has(p.id));
}

/** Pièces porteuses atteintes depuis un support (limon, tronçon de limon, crémaillère, poteau). */
const CARRIER_CATEGORIES: ReadonlySet<Part["category"]> = new Set(["stringer", "carriage", "post"]);

/**
 * Pièces d'une marche : pièces qui la matérialisent (`treadNumber`), puis pièces qui leur sont
 * assemblées (supports, limon…), puis les pièces porteuses assemblées à ces supports (tronçon de
 * limon auquel la cornière est soudée), sans reprendre les autres supports ni les autres marches ;
 * sans doublon, dans l'ordre de `Model.parts`.
 */
export function treadLinkedParts(model: Pick<Model, "parts">, treadNumber: number): Part[] {
  const own = model.parts.filter((p) => p.treadNumber === treadNumber);
  const ownIds = new Set(own.map((p) => p.id));
  const byId = new Map(model.parts.map((p) => [p.id, p]));
  const linked = new Set<string>();
  for (const p of own) for (const id of p.assembledWith ?? []) if (!ownIds.has(id)) linked.add(id);
  // Second saut : porteurs des supports de la marche.
  for (const id of [...linked]) {
    const support = byId.get(id);
    if (support?.category !== "support") continue;
    for (const next of support.assembledWith ?? []) {
      const carrier = byId.get(next);
      if (carrier && !ownIds.has(next) && CARRIER_CATEGORIES.has(carrier.category)) {
        linked.add(next);
      }
    }
  }
  return [...own, ...inModelOrder(model, linked)];
}

/** Catégories de petites pièces répétées regroupées dans les listes de liens (maquette 2b). */
const GROUPED_CATEGORIES: ReadonlySet<Part["category"]> = new Set([
  "support",
  "baluster",
  "fixing",
]);

/** Ligne d'une liste de liens : une pièce, ou des pièces identiques regroupées. */
export interface PartLinkGroup {
  /** Pièces de la ligne (ordre du modèle) ; la première est sélectionnée au clic. */
  readonly parts: readonly Part[];
  /** Repères distincts, triés (ordre naturel : CR2 avant CR10). */
  readonly marks: readonly string[];
  /** Désignation commune : nom de la pièce, ou genre commun (`params.kind`) des pièces. */
  readonly name: Message;
}

const naturalOrder = new Intl.Collator(undefined, { numeric: true }).compare;

/** Genre d'une désignation (`structure.common.support.name` : « {kind} sous {tread} »). */
function kindOf(name: Message): Message | undefined {
  const k = name.params?.["kind"];
  return typeof k === "object" && k !== null && "key" in k ? (k as Message) : undefined;
}

/**
 * Regroupe les petites pièces répétées (supports, barreaux, fixations) de même catégorie, même
 * section et même genre en une ligne (« CR1–CR9 Cornière soudée ×10 », maquette 2b) ; les
 * autres pièces restent une par ligne. Ordre : première pièce de chaque ligne dans la liste.
 */
export function groupPartLinks(parts: readonly Part[]): PartLinkGroup[] {
  const groups = new Map<string, Part[]>();
  const order: string[] = [];
  for (const p of parts) {
    const kind = kindOf(p.name);
    const key = GROUPED_CATEGORIES.has(p.category)
      ? JSON.stringify([p.category, p.section ?? null, kind ?? p.name.key])
      : `part:${p.id}`;
    const g = groups.get(key);
    if (g) g.push(p);
    else {
      groups.set(key, [p]);
      order.push(key);
    }
  }
  return order.map((key) => {
    const members = groups.get(key)!;
    const first = members[0]!;
    const marks = [...new Set(members.map((p) => p.mark))].sort(naturalOrder);
    const sameName = members.every((p) => messageEquals(p.name, first.name));
    return {
      parts: members,
      marks,
      name: sameName ? first.name : (kindOf(first.name) ?? first.name),
    };
  });
}

/**
 * Pièces assemblées à une pièce : `assembledWith`, tronçons voisins d'une pièce débitée en
 * plusieurs morceaux, autres pièces de la même marche ; sans la pièce elle-même ni doublon.
 */
export function assembledParts(model: Pick<Model, "parts">, partId: string): Part[] {
  const part = model.parts.find((p) => p.id === partId);
  if (!part) return [];
  const ids = new Set<string>(part.assembledWith ?? []);
  // Tronçons consécutifs (joints) de la même pièce débitée.
  for (const group of segmentedParts(model)) {
    for (const j of group.joints) {
      if (j.from.id === partId) ids.add(j.to.id);
      if (j.to.id === partId) ids.add(j.from.id);
    }
  }
  if (part.treadNumber !== undefined) {
    for (const p of model.parts) if (p.treadNumber === part.treadNumber) ids.add(p.id);
  }
  ids.delete(partId);
  return inModelOrder(model, ids);
}

/**
 * Visserie des assemblages d'une pièce : éléments de `Model.fasteners` dont `partIds` contient la
 * pièce, réunis par repère (`fastenerLines`). Vide sans visserie.
 */
export function partFastenerLines(
  model: Pick<Model, "fasteners">,
  partId: string,
): readonly FastenerLine[] {
  const own = (model.fasteners ?? []).filter((f) => f.partIds.includes(partId));
  return own.length === 0 ? [] : fastenerLines(own);
}
