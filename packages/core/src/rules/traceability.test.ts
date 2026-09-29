/**
 * Critère d'acceptation « toute règle de conformité est traçable jusqu'à sa source dans
 * docs/research/ » (prompt 2 §6) : sur tous les exemples du dépôt, chaque ligne du contrôle de
 * conception porte une source.
 *
 * - Règle de la table (`docs/research/rules.yaml`) : la source affichée est celle de la table.
 * - Contrôle hors table (fabrication, prédimensionnement, garde-corps) : la source cite un
 *   document de `docs/research/` (ou SPEC / CHALLENGE, ou la norme via la recherche), sinon elle
 *   déclare explicitement une provenance non réglementaire : profil d'atelier « à valider »,
 *   géométrie du projet ou calcul de Blondel. Aucune source vide ni inventée.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildModel } from "../pipeline/build.js";
import { parseProjectText } from "../project/index.js";
import { RULES } from "./table.js";

const EXAMPLES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");

/** Source rattachée à la recherche (ou aux documents qui font foi). */
const RESEARCH = /docs\/research\/|\b[ABC] §\d|SPEC [A-Z]?\d|docs\/CHALLENGE\.md/;
/** Provenance non réglementaire déclarée (valeur d'atelier, constat géométrique, calcul). */
const DECLARED = /^(Profil d'atelier Blondel|Géométrie d(u|e la) |Calcul élastique Blondel)/;

const models = readdirSync(EXAMPLES)
  .filter((f) => f.endsWith(".blondel.json"))
  .map((f) => ({
    file: f,
    model: buildModel(parseProjectText(readFileSync(resolve(EXAMPLES, f), "utf8"))),
  }));

describe("traçabilité des règles jusqu'à leur source", () => {
  const table = new Map(RULES.map((r) => [r.id, r]));

  it("chaque règle de rules.yaml a une source", () => {
    for (const r of RULES) expect(r.source.trim(), r.id).not.toBe("");
  });

  it("exemples : règle de la table → source de la table", () => {
    expect(models.length).toBeGreaterThanOrEqual(15);
    for (const { file, model } of models) {
      for (const r of model.compliance.results) {
        const def = table.get(r.ruleId);
        if (def !== undefined) expect(r.source, `${file} ${r.ruleId}`).toBe(def.source);
      }
    }
  });

  it("exemples : contrôle hors table → recherche citée ou provenance déclarée", () => {
    const outside = new Map<string, string>();
    for (const { model } of models) {
      for (const r of model.compliance.results) {
        if (!table.has(r.ruleId)) outside.set(r.ruleId, r.source);
      }
    }
    expect(outside.size).toBeGreaterThan(0);
    const untraced = [...outside].filter(([, s]) => !RESEARCH.test(s) && !DECLARED.test(s));
    expect(untraced).toEqual([]);
  });
});
