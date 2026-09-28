/**
 * Ligne de pente sur la ligne de foulée Γ : altitude z(s) linéaire par morceaux passant par les
 * nez (P_k, z_k) (décision Q4, CHALLENGE G4).
 *
 * Paliers [choix Blondel, à valider] : sur une marche palière (entre les nez k et k + 1), la
 * ligne de pente est le **dessus du palier** (z = z_k constant) ; elle saute à z_{k+1} au nez
 * k + 1 (bord d'arrivée du palier). z est donc croissante et continue à droite ; la limite à
 * gauche au nez k + 1 vaut z_k. Hors paliers, z est continue et affine entre deux nez.
 */
import type { Stepping } from "../model/derived.js";
import type { Mm } from "../model/primitives.js";

export interface SlopeProfile {
  /** Abscisses des nez sur Γ (croissantes), s_0 = 0, s_{n−1} = |Γ|. */
  readonly s: readonly Mm[];
  /** Altitudes des nez (sol fini). */
  readonly z: readonly Mm[];
  /** Marches palières : indice k de la marche comprise entre les nez k et k + 1. */
  readonly landings: ReadonlySet<number>;
}

/** Profil de la ligne de pente d'un découpage. */
export function slopeProfileOf(stepping: Stepping): SlopeProfile {
  const landings = new Set<number>();
  for (const t of stepping.treads) if (t.kind === "landing") landings.add(t.number - 1);
  return {
    s: stepping.nosings.map((n) => n.s),
    z: stepping.nosings.map((n) => n.z),
    landings,
  };
}

/**
 * Altitude de la ligne de pente en s. `side = "left"` donne la limite à gauche (utile au bord
 * d'arrivée d'un palier) ; hors de [s_0 ; s_{n−1}], altitude du nez extrême. Profil vide : NaN.
 */
export function slopeZ(profile: SlopeProfile, s: Mm, side: "left" | "right" = "right"): Mm {
  const { s: xs, z } = profile;
  const n = xs.length;
  if (n === 0) return Number.NaN;
  if (s <= xs[0]!) return z[0]!;
  const last = n - 1;
  if (s > xs[last]! || (side === "right" && s === xs[last]!)) return z[last]!;
  // Plus grand k ≤ n − 2 tel que s_k < s (gauche) ou s_k ≤ s (droite).
  let lo = 0;
  let hi = last - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const before = side === "left" ? xs[mid]! < s : xs[mid]! <= s;
    if (before) lo = mid;
    else hi = mid - 1;
  }
  const k = lo;
  const s0 = xs[k]!;
  const s1 = xs[k + 1]!;
  const z0 = z[k]!;
  const z1 = z[k + 1]!;
  if (profile.landings.has(k)) return z0;
  const len = s1 - s0;
  if (!(len > 0)) return side === "left" ? z0 : z1;
  return z0 + ((z1 - z0) * (s - s0)) / len;
}

/**
 * Plus petite abscisse s* à partir de laquelle la ligne de pente dépasse `zMax`
 * (z(s) > zMax pour s > s*, et z(s) ≤ zMax pour s < s*). `null` si z ≤ zMax partout.
 */
export function slopeExceedsFrom(profile: SlopeProfile, zMax: Mm): Mm | null {
  const { s: xs, z } = profile;
  const n = xs.length;
  if (n === 0 || !(z[n - 1]! > zMax)) return null;
  if (z[0]! > zMax) return xs[0]!;
  for (let k = 0; k + 1 < n; k++) {
    const z0 = z[k]!;
    const z1 = z[k + 1]!;
    if (profile.landings.has(k)) {
      // Palier plat à z_k ≤ zMax : le dépassement commence au plus tôt au nez k + 1.
      if (z1 > zMax) return xs[k + 1]!;
      continue;
    }
    if (z1 > zMax) {
      const s0 = xs[k]!;
      const s1 = xs[k + 1]!;
      const f = z1 > z0 ? (zMax - z0) / (z1 - z0) : 0;
      return s0 + Math.min(1, Math.max(0, f)) * (s1 - s0);
    }
  }
  return null;
}
