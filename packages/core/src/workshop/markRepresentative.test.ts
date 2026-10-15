/**
 * Règles du représentant présentes dans un modèle (chantier « repères de garde-corps », sous-lot
 * G2d, décision G-Q7) : `markRepresentativeRules` rend les règles portées par les pièces repérées
 * (`Part.markRepresentative`), dans l'ordre fixe de `MARK_REPRESENTATIVE_RULES`. Condition de
 * présence des rappels ◆ de l'interface (une ligne par règle).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { textMessage } from "@blondel/i18n";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { MarkRepresentativeRule, Part } from "../model/derived.js";
import type { Project } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { parseProjectText } from "../project/parse.js";
import { MARK_REPRESENTATIVE_RULES, markRepresentativeRules } from "./profile.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const example = (name: string): Project =>
  parseProjectText(readFileSync(join(EXAMPLES_DIR, `${name}.blondel.json`), "utf8"));

describe("markRepresentativeRules (G-Q7)", () => {
  it.each([
    // Bois à panneaux de garde-corps : balustres, poteaux, lisses et mains courantes, panneaux.
    ["demo-quarter-landing-ash", ["shortest", "smallestNetArea"]],
    // Bois à balustres : barres seulement.
    ["demo-u-oak", ["shortest"]],
    // Limon central acier sans garde-corps : entretoises et platines (développés) seulement.
    ["cage-60-palier-central", ["smallestNetArea"]],
    // Acier à cornières UPN sans développé repéré.
    ["j3c-acceptance-01-upn", ["shortest"]],
    // Bois sans garde-corps : aucune pièce repérée par identité.
    ["j3a-acceptance-01-bois", []],
    // Hélicoïdal : main courante portée sans repère par identité (G-Q16).
    ["j5a-helicoidal", []],
  ] as const)("%s → %j", (name, expected) => {
    const m = buildModel(example(name), { memo: false });
    expect(markRepresentativeRules(m)).toEqual(expected);
  });

  it("propriété : ordre fixe, indépendant de l'ordre des pièces ; aucune règle sans pièce repérée", () => {
    const part = (i: number, rule: MarkRepresentativeRule | undefined): Part =>
      ({
        id: `p-${i}`,
        mark: `X${i}`,
        name: textMessage(`p${i}`),
        ...(rule === undefined ? {} : { markRepresentative: rule }),
      }) as unknown as Part;
    const ruleArb = fc.option(fc.constantFrom(...MARK_REPRESENTATIVE_RULES), { nil: undefined });
    fc.assert(
      fc.property(
        fc
          .array(ruleArb, { maxLength: 12 })
          .map((rules) => rules.map((r, i) => part(i, r)))
          .chain((parts) =>
            fc.tuple(
              fc.constant(parts),
              fc.shuffledSubarray(parts, { minLength: parts.length, maxLength: parts.length }),
            ),
          ),
        ([parts, shuffled]) => {
          const rules = parts.map((p) => p.markRepresentative);
          const got = markRepresentativeRules({ parts });
          expect(markRepresentativeRules({ parts: shuffled })).toEqual(got);
          expect(got).toEqual(MARK_REPRESENTATIVE_RULES.filter((r) => rules.includes(r)));
          if (rules.every((r) => r === undefined)) expect(got).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });
});
