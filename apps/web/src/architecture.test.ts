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
 * - Les fonctions de `lib/` importées (valeurs) par un composant, une vue ou un store tournent sur
 *   le fil principal : elles n'appellent pas non plus ces étapes, directement ou par une autre
 *   fonction du même module (ex. `lib/variants.ts` : `runVariants`, qui appelle `compareEpure`,
 *   n'est importé que par le worker).
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
  "precheckStringers",
  "summarizeVariant",
  "meshParts",
];

const files = sources(SRC);

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Déclarations de premier niveau d'un module (fonctions et constantes, exportées ou non) :
 * nom → corps (jusqu'à la déclaration suivante).
 */
function topLevelDeclarations(code: string): Map<string, string> {
  const re = /^(?:export\s+)?(?:async\s+)?(?:function\*?\s+|const\s+|let\s+)(\w+)/gm;
  const heads: { name: string; start: number }[] = [];
  for (let m = re.exec(code); m !== null; m = re.exec(code)) {
    heads.push({ name: m[1]!, start: m.index });
  }
  const out = new Map<string, string>();
  heads.forEach((h, i) => out.set(h.name, code.slice(h.start, heads[i + 1]?.start ?? code.length)));
  return out;
}

/**
 * Déclarations d'un module qui appellent une étape du pipeline, directement ou par une autre
 * déclaration du même module (point fixe).
 */
function pipelineCallers(code: string, pipeline: readonly string[]): Set<string> {
  const decls = topLevelDeclarations(code.replace(/"(?:[^"\\\n]|\\.)*"/g, '""'));
  const tainted = new Set<string>();
  const calls = (body: string, name: string): boolean =>
    new RegExp(`\\b${escapeRe(name)}\\s*\\(`).test(body);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, body] of decls) {
      if (tainted.has(name)) continue;
      // Le corps commence par la déclaration : on ignore son propre nom (récursion).
      const inner = body.slice(body.indexOf(name) + name.length);
      if ([...pipeline, ...tainted].some((f) => calls(inner, f))) {
        tainted.add(name);
        changed = true;
      }
    }
  }
  return tainted;
}

/** Noms importés comme valeurs (hors `import type` et `type X`) depuis un module relatif. */
function valueImports(code: string): { spec: string; names: string[] }[] {
  const out: { spec: string; names: string[] }[] = [];
  const re = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*"([^"]+)"/g;
  for (let m = re.exec(code); m !== null; m = re.exec(code)) {
    if (m[1]) continue;
    const names = m[2]!
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n.length > 0 && !n.startsWith("type "))
      .map((n) => n.split(/\s+as\s+/)[0]!.trim());
    out.push({ spec: m[3]!, names });
  }
  return out;
}

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

  it("détection des appels indirects (garde-fou du garde-fou)", () => {
    const code = [
      "export function a() { return helper(); }",
      "function helper() { return precheckModel(p, m); }",
      "export function b() { return 1; }",
      'export const c = () => "precheckModel(";',
    ].join("\n");
    expect([...pipelineCallers(code, ["precheckModel"])].sort()).toEqual(["a", "helper"]);
    expect(
      valueImports('import { a, type B, c as d } from "../lib/x.js";\nimport type { E } from "y";'),
    ).toEqual([{ spec: "../lib/x.js", names: ["a", "c"] }]);
  });

  it("fonctions de lib/ utilisées sur le fil principal : aucune étape du pipeline appelée", () => {
    const mainThread = files.filter((f) => /[/\\](components|views|store)[/\\]/.test(f));
    const callers = new Map<string, Set<string>>();
    const callersOf = (file: string): Set<string> => {
      let set = callers.get(file);
      if (!set) {
        set = pipelineCallers(stripComments(readFileSync(file, "utf8")), PIPELINE);
        callers.set(file, set);
      }
      return set;
    };
    const bad: string[] = [];
    for (const f of mainThread) {
      const code = stripComments(readFileSync(f, "utf8"));
      for (const { spec, names } of valueImports(code)) {
        if (!/(^|\/)lib\//.test(spec) || !spec.startsWith(".")) continue;
        const target = join(dirname(f), spec.replace(/\.js$/, ".ts"));
        if (!files.includes(target)) continue;
        const tainted = callersOf(target);
        for (const n of names) {
          if (tainted.has(n)) bad.push(`${relative(SRC, f)} → ${relative(SRC, target)} : ${n}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
