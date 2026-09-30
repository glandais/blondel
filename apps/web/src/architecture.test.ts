/**
 * Critère d'acceptation « aucun calcul métier dans les composants UI » (prompt 2 §6, ADR-0005) :
 * garde-fous statiques sur les sources de l'application.
 *
 * - L'application ne consomme les paquets que par leurs points d'entrée publics
 *   (`@blondel/core`, `@blondel/core/dxf`, `@blondel/geometry`, `@blondel/exports`,
 *   `@blondel/exports/pdf`, `@blondel/i18n`) : aucun chemin vers `packages/…/src`, aucune lecture directe de la
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
import ts from "typescript";
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
  "@blondel/i18n",
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

/**
 * Textes visibles écrits en dur (ADR-0007) : dans les composants, vues et `App.tsx`, tout texte
 * affiché passe par le traducteur (`useT()`). Le détecteur analyse la syntaxe TSX (compilateur
 * TypeScript) et relève, s'ils contiennent une lettre :
 *
 * - le texte JSX (`<p>Texte</p>`) et les littéraux placés en enfant (`<p>{"Texte"}</p>`) ;
 * - les attributs `title`, `aria-label`, `placeholder`, `alt` littéraux (`title="…"`,
 *   `title={"…"}`, gabarit `` title={`… ${x}`} `` dont une partie fixe contient une lettre).
 *
 * Les textes invariants (nom propre, unités, symboles) sont listés dans `INVARIANT_TEXTS`.
 */
const TEXT_ATTRIBUTES = new Set(["title", "aria-label", "placeholder", "alt"]);

/**
 * Textes identiques dans toutes les langues, comparés espaces normalisées : nom du logiciel,
 * unités, et notation des Eurocodes du pré-dimensionnement (`PrecheckPanel` : symboles q/Q
 * indice k, L, f₁, flèche L/300, unités SI).
 */
const INVARIANT_TEXTS = new Set([
  "Blondel",
  "mm",
  "cm",
  "L/300",
  "L/",
  "· max",
  "MPa",
  "q",
  "k",
  "kN/m², Q",
  "kN",
  "L (m)",
  "f₁ (Hz)",
]);

const LETTER = /\p{L}/u;

function hardCodedTexts(fileName: string, code: string): string[] {
  const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const report = (node: ts.Node, text: string, what: string): void => {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (!LETTER.test(trimmed) || INVARIANT_TEXTS.has(trimmed)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    out.push(`${fileName}:${line + 1} ${what} « ${trimmed} »`);
  };
  /** Parties fixes d'un littéral de chaîne ou d'un gabarit (`null` pour une autre expression). */
  const literalParts = (e: ts.Expression): string[] | null => {
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
    if (ts.isTemplateExpression(e)) {
      return [e.head.text, ...e.templateSpans.map((s) => s.literal.text)];
    }
    if (ts.isParenthesizedExpression(e)) return literalParts(e.expression);
    return null;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      report(node, node.text, "texte JSX");
    } else if (
      ts.isJsxExpression(node) &&
      node.expression !== undefined &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      for (const part of literalParts(node.expression) ?? []) report(node, part, "texte JSX");
    } else if (ts.isJsxAttribute(node) && TEXT_ATTRIBUTES.has(node.name.getText(sf))) {
      const init = node.initializer;
      const name = node.name.getText(sf);
      if (init !== undefined && ts.isStringLiteral(init)) report(node, init.text, name);
      else if (init !== undefined && ts.isJsxExpression(init) && init.expression !== undefined) {
        for (const part of literalParts(init.expression) ?? []) report(node, part, name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("aucun texte visible en dur dans l'interface (ADR-0007)", () => {
  it("détecteur : texte JSX, enfants littéraux et attributs textuels (garde-fou du garde-fou)", () => {
    const code = [
      "export const A = () => (",
      '  <div title="Titre" aria-label={"Libellé"} placeholder={`Nom ${n}`} alt="" data-x="ok">',
      "    Bonjour",
      '    {"Monde"}',
      '    {t.t("ui.x.y")} {n} mm',
      '    <img alt={t.t("ui.a.b")} title={`${n} ·`} />',
      "    <b>Blondel</b> {x > 0 && y < 1 ? a : b} {cond && <i>Aide</i>}",
      "  </div>",
      ");",
      'const s = "Texte d\'une fonction";',
    ].join("\n");
    expect(hardCodedTexts("x.tsx", code)).toEqual([
      "x.tsx:2 title « Titre »",
      "x.tsx:2 aria-label « Libellé »",
      "x.tsx:2 placeholder « Nom »",
      "x.tsx:3 texte JSX « Bonjour »",
      "x.tsx:4 texte JSX « Monde »",
      "x.tsx:7 texte JSX « Aide »",
    ]);
  });

  it("composants, vues et App.tsx : aucun texte JSX ni attribut textuel littéral", () => {
    const ui = files.filter(
      (f) => f.endsWith(".tsx") && /[/\\](components|views)[/\\]|[/\\]App\.tsx$/.test(f),
    );
    expect(ui.length).toBeGreaterThan(20);
    const bad = ui.flatMap((f) => hardCodedTexts(relative(SRC, f), readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });

  it("nombres : aucun format français écrit en dur (toLocaleString / Intl.NumberFormat)", () => {
    const bad: string[] = [];
    for (const f of files) {
      const code = stripComments(readFileSync(f, "utf8"));
      if (/toLocale(?:String|DateString|TimeString)\(\s*["'`]fr/.test(code)) {
        bad.push(`${relative(SRC, f)} : toLocale…("fr…")`);
      }
      if (/Intl\.\w+\(\s*["'`]fr/.test(code)) bad.push(`${relative(SRC, f)} : Intl.…("fr…")`);
    }
    expect(bad).toEqual([]);
  });
});
