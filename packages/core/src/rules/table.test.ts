import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { RULE_CONTEXTS, RULES, RULES_VERSION, getRule } from "./table.js";

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
});
