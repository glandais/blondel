import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { RULE_CONTEXTS, RULES, RULES_VERSION, getRule, ruleParam, ruleTable } from "./table.js";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

describe("table des règles", () => {
  it("rules.data.json est à jour par rapport à docs/research/rules.yaml (pnpm rules:build)", () => {
    const yamlSrc = readFileSync(root + "docs/research/rules.yaml", "utf8");
    const expected = JSON.stringify(parse(yamlSrc), null, 2) + "\n";
    const actual = readFileSync(root + "packages/core/src/rules/rules.data.json", "utf8");
    expect(actual).toBe(expected);
  });

  it("identifiants uniques et contextes tous déclarés", () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of RULES) for (const c of r.contexte) expect(RULE_CONTEXTS).toContain(c);
    expect(RULE_CONTEXTS).toContain("tous");
  });

  it("version et accès par identifiant", () => {
    expect(RULES_VERSION).toBeGreaterThanOrEqual(1);
    expect(getRule("H_MAX_DTU").max).toBe(210);
    expect(() => getRule("INEXISTANTE")).toThrow();
  });

  it("min ≤ max quand les deux bornes existent", () => {
    for (const r of RULES)
      if (r.min !== null && r.max !== null) expect(r.min).toBeLessThanOrEqual(r.max);
  });

  it("une source citée « via » un tiers ou « sources secondaires » implique source_secondaire", () => {
    // Norme payante non lue (décision 2026-09-28) : la règle doit pouvoir être rétrogradée par
    // le profil souple (ADR-0004).
    const secondary = /\bvia\b|sources?\s+secondaires?/i;
    const missing = RULES.filter((r) => secondary.test(r.source) && !r.source_secondaire).map(
      (r) => r.id,
    );
    expect(missing).toEqual([]);
  });

  it("valeurs structurées (parametres, tables) : reprises dans la formule ou la description", () => {
    // Écritures d'un nombre dans le texte : 1200, 1 200, 0,6, 2,0…
    const spellings = (v: number): string[] => {
      const plain = String(v);
      const out = [plain, plain.replace(".", ",")];
      if (Number.isInteger(v)) out.push(`${v},0`, v.toLocaleString("fr-FR").replace(/\s/g, " "));
      else out.push(v.toFixed(1).replace(".", ","));
      return out;
    };
    const appears = (text: string, v: number): boolean =>
      spellings(v).some((sp) => {
        const esc = sp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|[^\\d,.])${esc}(?![\\d]|,\\d)`).test(
          text.replace(/\u202f|\u00a0/g, " "),
        );
      });
    const missing: string[] = [];
    for (const r of RULES) {
      const text = `${r.formule} ${r.description}`;
      for (const [k, v] of Object.entries(r.parametres ?? {}))
        if (!appears(text, v)) missing.push(`${r.id}.parametres.${k} = ${v}`);
      for (const [name, rows] of Object.entries(r.tables ?? {}))
        for (const row of rows)
          for (const [k, v] of Object.entries(row))
            if (typeof v === "number" && !appears(text, v))
              missing.push(`${r.id}.tables.${name}.${k} = ${v}`);
    }
    expect(missing).toEqual([]);
  });

  it("accès aux champs structurés : erreur explicite si absent", () => {
    expect(ruleParam("LF_POSITION_DTU_LARGE", "E_seuil")).toBe(1200);
    expect(ruleTable("GC_HAUTEUR_2024", "h_E").length).toBeGreaterThan(0);
    expect(() => ruleParam("H_MAX_DTU", "absent")).toThrow(/absent/);
    expect(() => ruleTable("H_MAX_DTU", "absente")).toThrow(/absente/);
  });

  it("regles_mesurees : règles de giron existantes", () => {
    for (const r of RULES)
      for (const id of r.regles_mesurees ?? []) {
        expect(r.id).toMatch(/^LF_POSITION_/);
        expect(getRule(id).id).toMatch(/^G_/);
      }
  });

  it("LIMON_ENTAILLE_MIN et GC_CABLES_DETENTE sont dans la table, avec leur source", () => {
    expect(getRule("LIMON_ENTAILLE_MIN")).toMatchObject({
      min: 14,
      severite: "avertissement",
      contexte: ["bois_dtu", "limon_bois_encastre"],
    });
    expect(getRule("LIMON_ENTAILLE_MIN").source).toMatch(/NF EN 16481/);
    expect(getRule("GC_CABLES_DETENTE")).toMatchObject({
      severite: "avertissement",
      contexte: ["garde_corps_1988", "garde_corps_2024"],
    });
    expect(getRule("GC_CABLES_DETENTE").source).toMatch(/NF P01-012:2024/);
  });
});
