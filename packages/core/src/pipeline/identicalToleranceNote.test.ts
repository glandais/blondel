/**
 * Remarque du contrôle de conception « tolérance d'identité supérieure au jeu de perçage »
 * (décision F10 (22), chantier part-marks R2b).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTranslator, messageEquals, type Message } from "@blondel/i18n";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Model } from "../model/derived.js";
import type { Project } from "../model/project.js";
import { parseProjectText } from "../project/parse.js";
import { buildModel } from "./build.js";
import { identicalToleranceNote } from "./identicalToleranceNote.js";
import "../structures/index.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const example = (name: string): Project =>
  parseProjectText(readFileSync(join(EXAMPLES_DIR, `${name}.blondel.json`), "utf8"));

const KEY = "compliance.note.identicalToleranceOverClearance";

const tuned = (p: Project, tolerance?: number, clearance?: number): Project => ({
  ...p,
  workshop: {
    ...p.workshop,
    ...(tolerance !== undefined ? { identicalPartTolerance: tolerance } : {}),
    ...(clearance !== undefined
      ? { fasteners: { ...p.workshop?.fasteners, holeClearance: clearance } }
      : {}),
  },
});

const notesOf = (m: Model): readonly Message[] =>
  (m.compliance.notes ?? []).filter((n) => n.key === KEY);

const build = (p: Project): Model => buildModel(p, { memo: false });

describe("remarque : tolérance d'identité au-dessus du jeu de perçage (F10 (22))", () => {
  const steel = example("cage-45-palier-acier");

  it("exemple acier, T = 1,5 mm > jeu 1 mm : remarque présente avec ses paramètres", () => {
    const n = notesOf(build(tuned(steel, 1.5)));
    expect(n).toHaveLength(1);
    expect(n[0]!.params).toMatchObject({ tolerance: { num: 1.5 }, clearance: { num: 1 } });
    const fr = createTranslator("fr").t(n[0]!);
    expect(fr).toContain("(1,5 mm)");
    expect(fr).toContain("(1 mm)");
  });

  it("profil par défaut (T = 0,5, jeu 1) ou T égal au jeu : pas de remarque", () => {
    expect(notesOf(build(steel))).toEqual([]);
    expect(notesOf(build(tuned(steel, 1)))).toEqual([]);
  });

  it("escalier bois (aucun repère porté par deux pièces percées) : pas de remarque", () => {
    expect(notesOf(build(tuned(example("demo-u-oak"), 1.5)))).toEqual([]);
  });

  it("la remarque ne change ni les résultats du contrôle ni la synthèse", () => {
    const a = build(tuned(steel, 1.5));
    const b = build(tuned(steel, 1.5, 2));
    expect(notesOf(b)).toEqual([]);
    expect(a.compliance.results).toEqual(b.compliance.results);
    expect(a.compliance.summary).toEqual(b.compliance.summary);
    const others = (m: Model) => (m.compliance.notes ?? []).filter((n) => n.key !== KEY);
    expect(others(a).length).toBe(others(b).length);
    for (const [i, n] of others(a).entries()) expect(messageEquals(n, others(b)[i]!)).toBe(true);
  });

  it("propriété (T, jeu) : remarque présente si et seulement si T > jeu (exemple acier)", () => {
    const parts = build(steel).parts;
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 3, noNaN: true }),
        fc.double({ min: 0, max: 3, noNaN: true }),
        (t, c) => {
          expect(identicalToleranceNote(parts, t, c) !== null).toBe(t > c);
        },
      ),
      { numRuns: 300 },
    );
    // Égalité exacte : pas de remarque (« dépasse »).
    expect(identicalToleranceNote(parts, 1, 1)).toBeNull();
  });

  it("grandeurs non finies : pas de remarque, jamais d'exception", () => {
    const parts = build(steel).parts;
    expect(identicalToleranceNote(parts, Number.NaN, 1)).toBeNull();
    expect(identicalToleranceNote(parts, Number.POSITIVE_INFINITY, 1)).toBeNull();
    expect(identicalToleranceNote([], 2, 1)).toBeNull();
  });
});
