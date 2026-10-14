/**
 * Échantillonnage de la poutre cintrée (`samples`, `woodCentralBeam.ts`) : deux nœuds confondus
 * au bruit d'arrondi près (abscisse de nez et jonction de la trace) donnent un seul échantillon
 * (départage corrigé par la bascule de l'hélicoïdal, F10 sous-lot P2 : sans lui, le solide de
 * la poutre de `demo-central-glulam` portait un sommet dédoublé selon le chemin de calcul).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import { samples } from "./woodCentralBeam.js";

const never = (): boolean => false;

describe("samples (poutre cintrée)", () => {
  it("nœuds distincts gardés, extrémités comprises", () => {
    expect(samples(0, 100, [50, 20], never)).toEqual([0, 20, 50, 100]);
  });

  it("nœuds confondus à GEOM_EPS près : un seul échantillon", () => {
    expect(samples(0, 100, [50, 50 + 1e-9, 50 - 1e-10], never)).toEqual([0, 50 - 1e-10, 100]);
  });

  it("nœud confondu avec une extrémité : extrémité seule", () => {
    expect(samples(0, 100, [1e-9, 100 - 1e-9], never)).toEqual([0, 100]);
  });

  it("propriété : croissant, écarts > GEOM_EPS, chaque nœud représenté", () => {
    fc.assert(
      fc.property(
        // `+ 0` ramène -0 à 0 : abscisse sans signe de zéro (graine -1073138483).
        fc.double({ min: -5000, max: 5000, noNaN: true }).map((x) => x + 0),
        fc.double({ min: 1, max: 5000, noNaN: true }),
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 12 }),
        fc.array(fc.double({ min: -1e-7, max: 1e-7, noNaN: true }), { maxLength: 12 }),
        (a, len, us, noise) => {
          const b = a + len;
          const base = us.map((u) => a + u * len);
          // Nœuds dédoublés au bruit d'arrondi près.
          const nodes = [...base, ...noise.map((e, i) => (base[i] ?? a) + e)];
          const out = samples(a, b, nodes, never);
          expect(out[0]).toBe(a);
          expect(out[out.length - 1]).toBe(b);
          for (let i = 1; i < out.length; i++)
            expect(out[i]! - out[i - 1]!).toBeGreaterThan(GEOM_EPS);
          for (const x of nodes) {
            if (!(x > a && x < b)) continue;
            // Chaque nœud intérieur est à moins de GEOM_EPS d'un échantillon, de proche en proche.
            const nearest = Math.min(...out.map((s) => Math.abs(s - x)));
            expect(nearest).toBeLessThanOrEqual(nodes.length * GEOM_EPS);
          }
        },
      ),
    );
  });
});
