/**
 * Hélicoïdal découpé par le chemin de cage (F10, sous-lot P2) : `regularHelicalTreads`
 * (`stepping.ts`) donne à chaque marche le giron du découpage et les collets et le giron
 * extérieur de la première marche (égaux par construction, vissage de l'hélicoïde). Cet
 * écrasement masquerait une dérive du calcul général de la cage sur les marches 2 à n − 1 :
 * on vérifie ici, sur la sortie **brute** de `buildTreads` (capturée par `vi.mock`), que chaque
 * marche retrouve déjà ces valeurs au bruit d'arrondi près, et que l'écrasement ne change que
 * ces quatre grandeurs.
 */
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import type { Tread } from "../model/derived.js";
import { helicalParityProjectArb } from "../layout/cage/helical-parity-helpers.js";
import { computeLayout } from "../layout/layout.js";
import { computeStepping } from "./stepping.js";

const captured = vi.hoisted(() => ({ treads: null as readonly unknown[] | null }));

vi.mock("./treads.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./treads.js")>();
  return {
    ...mod,
    buildTreads: (ctx: Parameters<typeof mod.buildTreads>[0]) => {
      const treads = mod.buildTreads(ctx);
      captured.treads = treads;
      return treads;
    },
  };
});

/** Tolérance (mm) : bruit d'arrondi du calcul général, très en dessous de l'affichage. */
const TOL = 1e-9;

describe("hélicoïdal sur cage : grandeurs par marche égales avant l'écrasement", () => {
  it("chaque marche brute a le giron du découpage, les collets et le giron extérieur de la 1re", () => {
    let checked = 0;
    fc.assert(
      fc.property(helicalParityProjectArb, (project) => {
        captured.treads = null;
        let stepping;
        try {
          stepping = computeStepping(project, computeLayout(project));
        } catch {
          return; // projet refusé (débord, contrôle de tracé) : rien à découper
        }
        const raw = captured.treads as readonly Tread[] | null;
        expect(raw).not.toBeNull();
        expect(stepping.helical).toBe(true);
        expect(raw!.length).toBe(stepping.treads.length);
        const first = raw![0]!;
        const scale = Math.max(1, stepping.going);
        raw!.forEach((t, k) => {
          expect(Math.abs(t.going - stepping.going), `giron ${k + 1}`).toBeLessThanOrEqual(
            TOL * scale,
          );
          for (const key of ["colletArc", "colletChord", "goingOuter"] as const) {
            expect(Math.abs(t[key] - first[key]), `${key} ${k + 1}`).toBeLessThanOrEqual(
              TOL * Math.max(1, Math.abs(first[key])),
            );
          }
          // L'écrasement ne touche que ces quatre grandeurs.
          const { going: _g, colletArc: _a, colletChord: _c, goingOuter: _o, ...rest } = t;
          const out = stepping.treads[k]!;
          const { going: _g2, colletArc: _a2, colletChord: _c2, goingOuter: _o2, ...restOut } = out;
          expect(restOut).toStrictEqual(rest);
        });
        checked++;
      }),
      { numRuns: Number(process.env.HELICAL_REGULAR_RUNS ?? 200) },
    );
    expect(checked).toBeGreaterThan(0);
  });
});
