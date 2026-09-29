/**
 * Critère d'acceptation « aucun calcul métier dans les composants UI » (prompt 2 §6, ADR-0005) :
 * garde-fous statiques sur les sources de l'application.
 *
 * - L'application ne consomme les paquets que par leurs points d'entrée publics
 *   (`@blondel/core`, `@blondel/core/dxf`, `@blondel/geometry`, `@blondel/exports`,
 *   `@blondel/exports/pdf`) : aucun chemin vers `packages/…/src`, aucune lecture directe de la
 *   table des règles (`rules.data.json`, `rules.yaml`).
 * - Les composants React (`components/`, `views/`) n'appellent aucune étape du pipeline du cœur
 *   (tracé, découpage, garde-corps, échappée, contrôle, assistant, comparateur, maillage) : le
 *   modèle est calculé dans le worker (`model/`) et les composants le lisent (appel direct ou
 *   import nommé interdits).
 *
 * Ces contrôles ne prouvent pas l'absence de toute formule dans l'interface (les écarts connus
 * sont listés dans docs/ACCEPTATION.md) ; ils empêchent la régression la plus probable.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
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

/** Retire les commentaires (les en-têtes citent volontiers les fonctions du cœur). */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const PUBLIC_ENTRIES = new Set([
  "@blondel/core",
  "@blondel/core/dxf",
  "@blondel/geometry",
  "@blondel/exports",
  "@blondel/exports/pdf",
]);

/** Étapes du pipeline et calculs du cœur réservés au worker (`model/`). */
const PIPELINE = [
  "buildModel",
  "computeLayout",
  "computeStepping",
  "buildBasicParts",
  "computeGuards",
  "computeHeadroom",
  "evaluateCompliance",
  "evaluateComplianceDetailed",
  "proposeDesigns",
  "compareEpure",
  "compareVariants",
  "precheckModel",
  "meshParts",
];

const files = sources(SRC);

describe("aucun calcul métier dans les composants UI", () => {
  it("les sources existent", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("paquets consommés par leurs points d'entrée publics seulement", () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const spec of importsOf(readFileSync(f, "utf8"))) {
        const rel = relative(SRC, f);
        if (spec.startsWith("@blondel/") && !PUBLIC_ENTRIES.has(spec)) bad.push(`${rel} → ${spec}`);
        if (/packages\/|rules\.data\.json|rules\.yaml/.test(spec)) bad.push(`${rel} → ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("composants et vues : aucune étape du pipeline du cœur appelée", () => {
    const ui = files.filter((f) => /[/\\](components|views)[/\\]/.test(f));
    expect(ui.length).toBeGreaterThan(10);
    const bad: string[] = [];
    for (const f of ui) {
      const code = stripComments(readFileSync(f, "utf8"));
      const withoutStrings = code.replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
      for (const name of PIPELINE) {
        // Appel direct ou import nommé (les chaînes de libellés peuvent citer la fonction).
        const called = new RegExp(`\\b${name}\\s*\\(`).test(withoutStrings);
        const imported = new RegExp(`import[^;]*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(code);
        if (called || imported) bad.push(`${relative(SRC, f)} : ${name}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
