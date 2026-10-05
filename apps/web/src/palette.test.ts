/**
 * Palette fonctionnelle de l'interface (ADR-0009, point 10) : `palette.css` reflète exactement
 * `FUNCTIONAL_COLORS` de `@blondel/exports` (clair dans `:root`, sombre dans les deux blocs
 * sombres), et aucune de ces couleurs n'est écrite en dur ailleurs dans `apps/web/src`.
 */
import { FUNCTIONAL_COLORS, type FunctionalColors, type FunctionalRole } from "@blondel/exports";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(SRC, "palette.css"), "utf8");

const VAR_OF: Readonly<Record<FunctionalRole, string>> = {
  selection: "--fn-selection",
  blocking: "--fn-blocking",
  warning: "--fn-warning",
  advice: "--fn-advice",
  ok: "--fn-ok",
  opening: "--fn-opening",
};

/** Déclarations `--fn-*: #rrggbb` du premier bloc `{…}` sans imbrication qui suit `selector`. */
function block(selector: string): Record<string, string> {
  const start = CSS.indexOf(selector);
  if (start < 0) throw new Error(`bloc introuvable : ${selector}`);
  const open = CSS.indexOf("{", start);
  const close = CSS.indexOf("}", open);
  const out: Record<string, string> = {};
  for (const m of CSS.slice(open + 1, close).matchAll(/(--fn-[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[m[1] as string] = (m[2] as string).toLowerCase();
  }
  return out;
}

function expected(colors: FunctionalColors): Record<string, string> {
  return Object.fromEntries(
    (Object.keys(VAR_OF) as FunctionalRole[]).map((r) => [VAR_OF[r], colors[r]]),
  );
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(css|ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe("palette fonctionnelle de l'interface", () => {
  it("thème clair : :root reprend FUNCTIONAL_COLORS.light", () => {
    expect(block(":root {")).toEqual(expected(FUNCTIONAL_COLORS.light));
  });

  it("thème sombre : les deux blocs sombres reprennent FUNCTIONAL_COLORS.dark", () => {
    expect(block(':root:not([data-theme="light"])')).toEqual(expected(FUNCTIONAL_COLORS.dark));
    expect(block(':root[data-theme="dark"]')).toEqual(expected(FUNCTIONAL_COLORS.dark));
    expect(CSS).toMatch(
      /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/,
    );
  });

  it("aucune couleur fonctionnelle en dur hors de palette.css", () => {
    const values = [
      ...Object.values(FUNCTIONAL_COLORS.light),
      ...Object.values(FUNCTIONAL_COLORS.dark),
    ].map((v) => v.toLowerCase());
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (file === join(SRC, "palette.css")) continue;
      // Le conseil reprend deux pas de la ramp accent d'Industry (#416180 = accent-700,
      // #94bce3 = accent-400) : les déclarations de la ramp elle-même ne sont pas des couleurs
      // fonctionnelles en dur.
      const text = readFileSync(file, "utf8")
        .toLowerCase()
        .replace(/--color-accent(?:-\d+)?\s*:\s*#[0-9a-f]{3,8}\s*;/g, "");
      for (const v of values) {
        if (text.includes(v)) offenders.push(`${relative(SRC, file)} : ${v}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
