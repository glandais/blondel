/**
 * Débit des barres du commerce (calepinage 1D simple, jalon 3c) : C §4.3 et C-M-08, barres de
 * 6 m ou 12 m [46] (longueurs du profil d'atelier).
 *
 * Algorithme [choix Blondel, à valider] : « premier ajustement décroissant » — pièces triées par
 * longueur décroissante ; chaque pièce va dans la barre entamée qui laisse la plus petite chute
 * (meilleur ajustement), sinon dans une nouvelle barre de la plus petite longueur du commerce
 * qui la contient. Chaque pièce consomme sa longueur plus un trait de scie (profil d'atelier,
 * « à valider »). Une pièce plus longue que la plus grande barre est signalée (aboutage).
 */
import type { Mm } from "../model/primitives.js";

export interface CutPiece {
  readonly id: string;
  readonly mark: string;
  readonly length: Mm;
}

export interface BarLayout {
  /** Longueur de la barre du commerce. */
  readonly barLength: Mm;
  readonly pieces: readonly CutPiece[];
  /** Longueur consommée (pièces et traits de scie). */
  readonly used: Mm;
  /** Chute. */
  readonly offcut: Mm;
}

export interface CuttingPlan {
  readonly bars: readonly BarLayout[];
  /** Pièces plus longues que la plus grande barre (aboutage nécessaire). */
  readonly oversize: readonly CutPiece[];
  /** Taux d'utilisation matière : Σ pièces / Σ barres (0 si aucune barre). */
  readonly utilization: number;
}

export function cuttingPlan(
  pieces: readonly CutPiece[],
  barLengths: readonly Mm[],
  kerf: Mm,
): CuttingPlan {
  const lengths = [...barLengths].filter((l) => l > 0).sort((a, b) => a - b);
  const maxBar = lengths[lengths.length - 1] ?? 0;
  const sorted = [...pieces].sort((a, b) => b.length - a.length || a.id.localeCompare(b.id));
  const bars: { barLength: Mm; pieces: CutPiece[]; used: Mm }[] = [];
  const oversize: CutPiece[] = [];
  for (const p of sorted) {
    const need = p.length + kerf;
    if (p.length > maxBar + 1e-9) {
      oversize.push(p);
      continue;
    }
    let best: (typeof bars)[number] | null = null;
    for (const b of bars) {
      const rest = b.barLength - b.used;
      // Le dernier trait de scie peut tomber hors de la barre (bout de barre).
      if (p.length <= rest + 1e-9 && (best === null || rest < best.barLength - best.used)) best = b;
    }
    if (best) {
      best.pieces.push(p);
      best.used = Math.min(best.barLength, best.used + need);
      continue;
    }
    const barLength = lengths.find((l) => l >= p.length - 1e-9) ?? maxBar;
    bars.push({ barLength, pieces: [p], used: Math.min(barLength, need) });
  }
  const total = bars.reduce((s, b) => s + b.barLength, 0);
  const net = bars.reduce((s, b) => s + b.pieces.reduce((t, p) => t + p.length, 0), 0);
  return {
    bars: bars.map((b) => ({ ...b, offcut: b.barLength - b.used })),
    oversize,
    utilization: total > 0 ? net / total : 0,
  };
}
