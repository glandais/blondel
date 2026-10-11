/**
 * Garde-fou du sous-lot 1c (ADR-0010, plan B.5) : l'ancien moteur à volées (`legacyFlights.ts`)
 * est **réservé aux tests** et supprimé au lot 2. Aucune source hors `*.test.ts` des paquets et
 * des applications ne l'importe (import statique, dynamique ou réexport), et le point d'entrée du
 * cœur ne l'expose pas.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as core from "../index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");

/** Sources TypeScript (hors tests) sous `dir`, sans `node_modules` ni `dist`. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Spécificateurs de modules importés (statiques, dynamiques, réexports). */
function importsOf(text: string): string[] {
  const out: string[] = [];
  const re = /(?:from\s+|import\s*\(\s*|import\s+)"([^"]+)"/g;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) out.push(m[1]!);
  return out;
}

const roots = (): string[] =>
  ["packages", "apps"].flatMap((top) =>
    readdirSync(join(ROOT, top), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(ROOT, top, e.name, "src")),
  );

describe("legacyFlights.ts : réservé aux tests (supprimé au lot 2)", () => {
  it("aucune source hors test ne l'importe", () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const root of roots()) {
      let files: string[];
      try {
        files = sources(root);
      } catch {
        continue;
      }
      for (const file of files) {
        scanned++;
        if (importsOf(readFileSync(file, "utf8")).some((s) => /legacyFlights(\.js)?$/.test(s))) {
          offenders.push(relative(ROOT, file));
        }
      }
    }
    expect(scanned).toBeGreaterThan(100);
    expect(offenders).toEqual([]);
  });

  it("le point d'entrée du cœur ne l'expose pas", () => {
    expect(Object.keys(core)).not.toContain("legacyComputeFlightsLayout");
  });
});
