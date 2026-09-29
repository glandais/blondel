/**
 * Outils de test : ligne des nez des limons au droit des paliers. Sur une marche `landing` entre
 * les nez k et k + 1, la ligne des nez du développé doit rester de niveau à z_k de σ_k jusqu'à
 * un giron avant le nez de sortie (profil des garde-corps, `sideEdge`). Un palier dont le nez de
 * sortie est le nez d'arrivée n'a pas de partie plate (aucun giron suivant).
 */
import type { Stepping } from "../model/derived.js";
import type { Mm, Vec2 } from "../model/primitives.js";
import type { StringerDevelopment } from "./development.js";
import { PiecewiseLinear } from "./geom.js";

export interface PitchedStringer {
  readonly face: { readonly side: "inner" | "outer"; readonly sigmaA: Mm };
  readonly development: StringerDevelopment;
}

/**
 * Écart vertical maximal (mm) entre la ligne des nez des développés et le niveau des paliers,
 * sur la partie plate de chaque palier comprise dans la portée du limon ; 0 sans palier.
 */
export function landingPitchGap(stepping: Stepping, stringers: readonly PitchedStringer[]): Mm {
  const nos = stepping.nosings;
  let gap = 0;
  for (const s of stringers) {
    const sigma = (k: number): Mm =>
      s.face.side === "inner" ? nos[k]!.sigmaInner : nos[k]!.sigmaOuter;
    const line = new PiecewiseLinear(s.development.pitchLine.map((p: Vec2) => p));
    for (const t of stepping.treads) {
      if (t.kind !== "landing") continue;
      const k = t.number - 1;
      // Palier sous le nez d'arrivée : pas de giron suivant, donc pas de partie plate (même
      // convention que `nosingPitchLine` et `sideEdge`, à valider : LEDGER §2).
      if (k + 2 >= nos.length) continue;
      const next = sigma(k + 1);
      const going = sigma(k + 2) - next;
      const lo = Math.max(sigma(k) - s.face.sigmaA, s.development.uLo);
      const hi = Math.min(next - going - s.face.sigmaA, s.development.uHi);
      if (!(hi > lo + 1)) continue;
      for (let i = 0; i <= 10; i++) {
        const u = lo + ((hi - lo) * i) / 10;
        gap = Math.max(gap, Math.abs(line.at(u) - nos[k]!.z));
      }
    }
  }
  return gap;
}
