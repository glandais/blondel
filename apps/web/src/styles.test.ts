/**
 * Contraste non textuel (WCAG 2.1, critère 1.4.11) : la limite des champs de saisie et des
 * boutons doit atteindre 3:1 sur les surfaces où ils sont posés, dans les deux thèmes. Les jetons
 * sont relus dans `styles.css` (source unique).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "styles.css"), "utf8");

/** Déclarations `--nom: #rrggbb` du premier bloc qui suit `selector`. */
function tokens(selector: string): Record<string, string> {
  const start = CSS.indexOf(selector);
  if (start < 0) throw new Error(`bloc introuvable : ${selector}`);
  const open = CSS.indexOf("{", start);
  const close = CSS.indexOf("}", open);
  const out: Record<string, string> = {};
  for (const m of CSS.slice(open + 1, close).matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[m[1] as string] = m[2] as string;
  }
  return out;
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rapport de contraste WCAG entre deux couleurs. */
function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Règle CSS (sélecteur exact en tête de ligne) → corps. */
function rule(selector: string): string {
  const i = CSS.indexOf(`\n${selector} {`);
  if (i < 0) throw new Error(`règle introuvable : ${selector}`);
  return CSS.slice(i, CSS.indexOf("}", i));
}

const THEMES = {
  clair: tokens(":root {"),
  "sombre (système)": tokens(':root:not([data-theme="light"])'),
  "sombre (forcé)": tokens(':root[data-theme="dark"]'),
};

describe("contraste des limites de composants (WCAG 1.4.11)", () => {
  it("formule de référence", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#d6dade", "#ffffff")).toBeCloseTo(1.41, 2);
  });

  for (const [name, t] of Object.entries(THEMES)) {
    it(`thème ${name} : --control-border ≥ 3:1 sur --panel, --panel-2 et --bg`, () => {
      const border = t["--control-border"];
      expect(border).toBeDefined();
      for (const surface of ["--panel", "--panel-2", "--bg"]) {
        const bg = t[surface] ?? THEMES.clair[surface];
        expect(bg, surface).toBeDefined();
        expect(contrastRatio(border as string, bg as string), surface).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it("boutons, listes et champs de texte ou de date bordés par --control-border", () => {
    expect(rule("button")).toContain("border: 1px solid var(--control-border)");
    expect(rule('select,\ninput[type="text"],\ninput[type="date"]')).toContain(
      "border: 1px solid var(--control-border)",
    );
  });
});
