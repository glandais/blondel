/**
 * Garde-fou du sous-lot P2 (F10, ADR-0010) : la copie figée de l'ancien chemin hélicoïdal
 * (`legacyHelical.ts`) est **réservée aux tests** et retirée après P3. Aucune source hors test
 * des paquets et des applications ne l'importe (import statique, dynamique ou réexport), et le
 * point d'entrée du cœur ne l'expose pas (modèle : `legacyFlights.test.ts`, sous-lot 1c).
 *
 * Sont des sources de test, exclues du parcours : les `*.test.ts(x)` et les assistants de test
 * nommés `*-helpers.ts` (précédents : `layout/helical-test-helpers.ts`,
 * `layout/cage/helical-parity-helpers.ts`, qui importe la copie figée). Motif restreint à ce
 * suffixe exact ; vérifié ci-dessous : chaque assistant exclu n'est importé que par des tests
 * ou d'autres assistants, jamais par une source de production.
 *
 * Tant que l'ancien moteur existe (`layout/helical.ts`, `stepping/helical.ts`, retrait en P3),
 * la copie est vérifiée fidèle au bit près sur des tirages (test à retirer avec lui).
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as core from "../index.js";
import type { HelicalLayoutSpec } from "../model/project.js";
import { computeHelicalStepping } from "../stepping/helical.js";
import { helicalParityShapeArb } from "./cage/helical-parity-helpers.js";
import { computeHelicalLayout } from "./helical.js";
import { makeHelicalProject } from "./helical-test-helpers.js";
import { legacyComputeHelicalLayout, legacyComputeHelicalStepping } from "./legacyHelical.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");

const TEST_FILE = /\.test\.tsx?$/;
const TEST_HELPER = /-helpers\.tsx?$/;

/** Sources TypeScript sous `dir`, sans `node_modules` ni `dist`. */
function allSources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...allSources(p));
    else if (/\.tsx?$/.test(e.name)) out.push(p);
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

function files(): string[] {
  return roots().flatMap((root) => {
    try {
      return allSources(root);
    } catch {
      return [];
    }
  });
}

const isTestSource = (file: string): boolean =>
  TEST_FILE.test(basename(file)) || TEST_HELPER.test(basename(file));

describe("legacyHelical.ts : réservé aux tests (retiré après P3)", () => {
  it("aucune source hors test ne l'importe", () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const file of files()) {
      if (isTestSource(file)) continue;
      scanned++;
      if (importsOf(readFileSync(file, "utf8")).some((s) => /legacyHelical(\.js)?$/.test(s))) {
        offenders.push(relative(ROOT, file));
      }
    }
    expect(scanned).toBeGreaterThan(100);
    expect(offenders).toEqual([]);
  });

  it("les assistants de test exclus ne sont importés par aucune source de production", () => {
    const helpers = files()
      .filter((f) => TEST_HELPER.test(basename(f)))
      .map((f) => basename(f).replace(/\.tsx?$/, ""));
    expect(helpers.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files()) {
      if (isTestSource(file)) continue;
      const imported = importsOf(readFileSync(file, "utf8"));
      for (const h of helpers) {
        if (imported.some((s) => new RegExp(`/${h}(\\.js)?$`).test(s))) {
          offenders.push(`${relative(ROOT, file)} → ${h}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("copie fidèle : mêmes résultats, au bit, que l'ancien moteur tant qu'il existe (P3)", () => {
    fc.assert(
      fc.property(helicalParityShapeArb, (s) => {
        const p = makeHelicalProject(s);
        const spec = p.stair.layout as HelicalLayoutSpec;
        const layout = computeHelicalLayout(p, spec);
        expect(legacyComputeHelicalLayout(p, spec)).toStrictEqual(layout);
        expect(legacyComputeHelicalStepping(p, layout)).toStrictEqual(
          computeHelicalStepping(p, layout),
        );
      }),
      { numRuns: 100 },
    );
  });

  it("le point d'entrée du cœur ne l'expose pas", () => {
    const keys = Object.keys(core);
    expect(keys).not.toContain("legacyComputeHelicalLayout");
    expect(keys).not.toContain("legacyComputeHelicalStepping");
  });
});
