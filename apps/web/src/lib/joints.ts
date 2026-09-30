/**
 * Tronçons et joints des pièces débitées en plusieurs morceaux (limon de jour débillardé
 * `steel-curved`, jalon 5b) : les pièces dont le développé porte des lignes `joint` sont groupées
 * par identifiant de base (`stringer-inner-curved-1`, `-2`… → `stringer-inner-curved`), dans
 * l'ordre de la montée, et chaque joint entre deux tronçons consécutifs reçoit un repère J1, J2…
 * Présentation seulement : tronçons, joints et cordons viennent du modèle du cœur.
 */
import {
  QUANTITY_MASS_KG,
  QUANTITY_ROLLED_LENGTH_MM,
  QUANTITY_WELD_MM,
  type Model,
  type Part,
} from "@blondel/core";
import { tr } from "../i18n/fr.js";

export interface SegmentRow {
  readonly part: Part;
  /** Longueur développée (étendue du développé selon x), mm. */
  readonly developed: number;
  /** Longueur roulée (génératrices sur arc), mm ; 0 : tronçon droit. */
  readonly rolled: number;
  readonly massKg: number | undefined;
}

export interface JointRow {
  /** Repère du joint (J1, J2… dans l'ordre de la montée, toutes pièces confondues). */
  readonly mark: string;
  readonly from: Part;
  readonly to: Part;
  /**
   * Longueur du cordon (trait de joint du développé), mm ; `null` : assemblage non soudé (pièces
   * sans cordon au métré, ex. angle mural à queues d'un limon bois).
   */
  readonly weldMm: number | null;
  /** Libellé du trait de joint (nature de l'assemblage). */
  readonly label: string;
}

export interface SegmentedPart {
  /** Identifiant de base commun aux tronçons. */
  readonly base: string;
  readonly segments: readonly SegmentRow[];
  readonly joints: readonly JointRow[];
}

const hasJoint = (p: Part): boolean => p.flat?.lines.some((l) => l.kind === "joint") ?? false;

function split(id: string): { base: string; index: number } | undefined {
  const m = /^(.*)-(\d+)$/.exec(id);
  return m ? { base: m[1]!, index: Number(m[2]) } : undefined;
}

function extentX(p: Part): { min: number; max: number } {
  const xs = p.flat?.outline.outer.map((v) => v.x) ?? [0];
  return { min: Math.min(...xs), max: Math.max(...xs) };
}

type FlatLine = NonNullable<Part["flat"]>["lines"][number];

const jointLines = (p: Part): FlatLine[] => (p.flat?.lines ?? []).filter((l) => l.kind === "joint");

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Traits de joint de `p` dont le libellé nomme le repère `mark` (mot entier : LD1 ≠ LD10). */
function namingLines(p: Part, mark: string): FlatLine[] {
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(mark)}($|[^\\p{L}\\p{N}])`, "u");
  return jointLines(p).filter((l) => l.label !== undefined && re.test(tr(l.label)));
}

/**
 * Trait du joint entre deux tronçons consécutifs. Priorité au libellé qui nomme le voisin (le
 * développé d'un tronçon intermédiaire porte deux traits, et le sens de la montée selon x dépend
 * du côté du jour : développé miroir à droite) ; sinon trait unique de `from` (premier tronçon)
 * ou de `to` (dernier tronçon).
 */
function jointLine(from: Part, to: Part): FlatLine | undefined {
  const named = namingLines(from, to.mark);
  if (named.length === 1) return named[0];
  const back = namingLines(to, from.mark);
  if (back.length === 1) return back[0];
  const own = jointLines(from);
  if (own.length === 1) return own[0];
  const other = jointLines(to);
  return other.length === 1 ? other[0] : undefined;
}

/** Pièce soudée au métré (quantité `weld_mm` présente : pièces acier). */
const welded = (p: Part): boolean => p.quantities[QUANTITY_WELD_MM] !== undefined;

/** Pièces en tronçons du modèle (au moins deux tronçons reliés par un joint). */
export function segmentedParts(model: Pick<Model, "parts">): SegmentedPart[] {
  const groups = new Map<string, { index: number; part: Part }[]>();
  for (const part of model.parts) {
    if (!hasJoint(part)) continue;
    const s = split(part.id);
    if (!s) continue;
    const g = groups.get(s.base) ?? [];
    g.push({ index: s.index, part });
    groups.set(s.base, g);
  }
  const out: SegmentedPart[] = [];
  let count = 0;
  for (const [base, members] of groups) {
    if (members.length < 2) continue;
    const ordered = members.sort((a, b) => a.index - b.index).map((m) => m.part);
    const segments = ordered.map((part): SegmentRow => {
      const e = extentX(part);
      return {
        part,
        developed: e.max - e.min,
        rolled: part.quantities[QUANTITY_ROLLED_LENGTH_MM] ?? 0,
        massKg: part.quantities[QUANTITY_MASS_KG],
      };
    });
    const joints: JointRow[] = [];
    for (let i = 0; i + 1 < ordered.length; i++) {
      const from = ordered[i]!;
      const to = ordered[i + 1]!;
      const line = jointLine(from, to);
      const length = line ? Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y) : 0;
      joints.push({
        mark: `J${++count}`,
        from,
        to,
        weldMm: welded(from) || welded(to) ? length : null,
        label: line?.label !== undefined ? tr(line.label) : "Joint",
      });
    }
    out.push({ base, segments, joints });
  }
  return out;
}
