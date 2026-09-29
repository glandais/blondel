/**
 * Vue éclatée (jalon 6) : déplacement de chaque pièce selon sa catégorie, proportionnel au
 * curseur (0 = assemblé, 1 = éclatement maximal). Présentation seulement (aucune règle métier) :
 *
 * - marches et paliers montent, contremarches et supports un peu moins ;
 * - limons et crémaillères s'écartent horizontalement du centre de l'escalier ;
 * - poteaux, garde-corps et mains courantes s'écartent et montent ;
 * - fixations s'écartent davantage.
 *
 * Repère : celui du cœur (mm, Z vers le haut).
 */
import type { PartCategory, Vec3 } from "@blondel/core";

/** Déplacement maximal de référence (mm, présentation). */
export const EXPLODE_DISTANCE = 400;

/** Coefficients (vertical, radial horizontal) par catégorie, en multiples de `EXPLODE_DISTANCE`. */
export const EXPLODE_FACTORS: Readonly<Record<PartCategory, { up: number; out: number }>> = {
  tread: { up: 1, out: 0 },
  landing: { up: 1, out: 0 },
  riser: { up: 0.5, out: 0 },
  support: { up: 0.5, out: 0 },
  stringer: { up: 0, out: 1 },
  carriage: { up: 0, out: 1 },
  post: { up: 0, out: 1.5 },
  handrail: { up: 1.5, out: 1.5 },
  baluster: { up: 1, out: 1.5 },
  infill: { up: 1, out: 1.5 },
  fixing: { up: 0, out: 2 },
};

export interface ExplodeInput {
  readonly partId: string;
  readonly category: PartCategory;
  /** Centre de la boîte englobante de la pièce (mm). */
  readonly center: Vec3;
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Déplacement de chaque pièce pour un éclatement `amount` (borné à [0, 1]) autour de `center`
 * (centre de l'escalier). Une pièce centrée sur l'axe vertical de l'escalier ne s'écarte pas.
 */
export function explodeOffsets(
  parts: readonly ExplodeInput[],
  center: Vec3,
  amount: number,
  distance = EXPLODE_DISTANCE,
): Map<string, Vec3> {
  const k = Number.isFinite(amount) ? Math.min(1, Math.max(0, amount)) * distance : 0;
  const out = new Map<string, Vec3>();
  for (const p of parts) {
    const f = EXPLODE_FACTORS[p.category] ?? { up: 0, out: 0 };
    if (k === 0) {
      out.set(p.partId, ZERO);
      continue;
    }
    const dx = p.center.x - center.x;
    const dy = p.center.y - center.y;
    const l = Math.hypot(dx, dy);
    const ox = l > 1e-6 ? (dx / l) * f.out * k : 0;
    const oy = l > 1e-6 ? (dy / l) * f.out * k : 0;
    out.set(p.partId, { x: ox + 0, y: oy + 0, z: f.up * k + 0 });
  }
  return out;
}
