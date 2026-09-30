import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  KEY_PATTERN,
  emptyValueProblems,
  hasKey,
  keyFormatProblems,
  parityProblems,
  placeholderProblems,
  sortProblems,
} from "./consistency";
import { DYNAMIC_KEYS, isDynamic } from "./dynamicKeys";
import { LOCALES, messagesFor } from "./index";
import frFile from "./locales/fr.json" with { type: "json" };
import enFile from "./locales/en.json" with { type: "json" };
import { WIP_EN, WIP_FR, WIP_FRAGMENTS } from "./locales/wip";

/** Contenu des fichiers `fr.json` / `en.json` (ordre du fichier). */
const frMain: Record<string, string> = frFile;
const enMain: Record<string, string> = enFile;
/** Dictionnaires servis (fichiers + fragments de migration). */
const fr = messagesFor("fr");
const en = messagesFor("en");

const REPO = fileURLToPath(new URL("../../../", import.meta.url));

/** Sources de production (hors tests) de packages/*\/src et apps/web/src. */
function sourceFiles(): string[] {
  const roots = [
    ...readdirSync(join(REPO, "packages"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(REPO, "packages", d.name, "src")),
    join(REPO, "apps", "web", "src"),
  ];
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const path = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && e.name !== "__snapshots__") walk(path);
      } else if (/\.tsx?$/.test(e.name) && !/\.test(-helpers)?\.tsx?$/.test(e.name)) {
        out.push(path);
      }
    }
  };
  roots.forEach(walk);
  return out;
}

/**
 * Clés littérales passées à `msg(…)` ou `t(…)` (y compris `translator.t(…)`). Les gabarits
 * avec `${…}` sont ignorés (clés dynamiques, voir `dynamicKeys.ts`), ainsi que les chaînes qui
 * n'ont pas la forme d'une clé.
 */
function literalKeysIn(source: string): string[] {
  const keys: string[] = [];
  for (const m of source.matchAll(/\b(?:msg|t)\(\s*(["'`])([^"'`\n]+)\1/g)) {
    const key = m[2]!;
    if (!key.includes("${") && KEY_PATTERN.test(key)) keys.push(key);
  }
  return keys;
}

const SOURCES = sourceFiles().map((path) => ({ path, text: readFileSync(path, "utf8") }));

describe("dictionnaires", () => {
  it("les deux langues sont déclarées", () => {
    expect(LOCALES).toEqual(["fr", "en"]);
  });

  it("fr et en ont exactement les mêmes clés", () => {
    expect(parityProblems(frMain, enMain, "en.json")).toEqual([]);
    expect(parityProblems(fr, en, "en (avec fragments)")).toEqual([]);
  });

  it("chaque traduction a les mêmes paramètres {…} que le français", () => {
    expect(placeholderProblems(fr, en)).toEqual([]);
  });

  it("aucune valeur vide", () => {
    expect(emptyValueProblems(fr)).toEqual([]);
    expect(emptyValueProblems(en)).toEqual([]);
  });

  it("clés triées dans les fichiers", () => {
    expect(sortProblems(frMain)).toEqual([]);
    expect(sortProblems(enMain)).toEqual([]);
  });

  it("clés bien formées", () => {
    expect(keyFormatProblems(fr)).toEqual([]);
    expect(keyFormatProblems(en)).toEqual([]);
    expect(KEY_PATTERN.test("rules.H_MAX_DTU.description")).toBe(true);
    expect(KEY_PATTERN.test("ui.toolbar.undo.title")).toBe(true);
    expect(KEY_PATTERN.test("Ui.toolbar")).toBe(false);
    expect(KEY_PATTERN.test("single")).toBe(false);
    expect(KEY_PATTERN.test("a..b")).toBe(false);
  });

  it("une clé plurielle a toujours sa variante .other", () => {
    const missing = Object.keys(fr)
      .filter((k) => /\.(zero|one|two|few|many)$/.test(k))
      .map((k) => k.replace(/\.[a-z]+$/, ""))
      .filter((base) => !(`${base}.other` in fr));
    expect(missing).toEqual([]);
  });
});

describe("fragments de migration (locales/wip.ts)", () => {
  it("chaque fragment est cohérent (parité, paramètres, valeurs, format, tri)", () => {
    const problems = WIP_FRAGMENTS.flatMap((f) =>
      [
        ...parityProblems(f.fr, f.en, `${f.name}.en.json`),
        ...placeholderProblems(f.fr, f.en),
        ...emptyValueProblems(f.fr),
        ...emptyValueProblems(f.en),
        ...keyFormatProblems(f.fr),
        ...sortProblems(f.fr),
        ...sortProblems(f.en),
      ].map((p) => `${f.name} : ${p}`),
    );
    expect(problems).toEqual([]);
  });

  it("aucune clé déclarée deux fois (fichier principal ou autre fragment)", () => {
    const seen = new Map<string, string>(Object.keys(frMain).map((k) => [k, "fr.json"]));
    const duplicates: string[] = [];
    for (const f of WIP_FRAGMENTS) {
      for (const key of Object.keys(f.fr)) {
        const previous = seen.get(key);
        if (previous !== undefined) duplicates.push(`${key} : ${f.name} et ${previous}`);
        else seen.set(key, f.name);
      }
    }
    expect(duplicates).toEqual([]);
  });

  it("WIP_FR / WIP_EN réunissent exactement les fragments déclarés", () => {
    const union = (side: "fr" | "en"): string[] =>
      WIP_FRAGMENTS.flatMap((f) => Object.keys(f[side])).sort();
    expect(Object.keys(WIP_FR).sort()).toEqual(union("fr"));
    expect(Object.keys(WIP_EN).sort()).toEqual(union("en"));
  });
});

describe("clés employées dans le code", () => {
  it("le scan reconnaît msg(…) et t(…), ignore les gabarits", () => {
    const src = `msg("a.b", x); tr.t('c.d'); t(\`e.\${id}.f\`); set("g.h"); t("pas une clé")`;
    expect(literalKeysIn(src)).toEqual(["a.b", "c.d"]);
  });

  it("toute clé littérale employée existe dans fr.json", () => {
    const missing: string[] = [];
    for (const { path, text } of SOURCES) {
      for (const key of literalKeysIn(text)) {
        if (!hasKey(fr, key)) missing.push(`${path.slice(REPO.length)} : ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("aucune clé orpheline : chaque clé est écrite en littéral ou construite (dynamicKeys.ts)", () => {
    const corpus = SOURCES.map((s) => s.text).join("\n");
    const used = (key: string): boolean =>
      ['"', "'", "`"].some((q) => corpus.includes(`${q}${key}${q}`));
    const orphans = Object.keys(fr).filter((key) => {
      const base = key.replace(/\.(zero|one|two|few|many|other)$/, "");
      return !used(key) && !used(base) && !isDynamic(key);
    });
    expect(orphans).toEqual([]);
  });

  it("chaque famille de clés dynamiques couvre des clés et cite un fichier qui la construit", () => {
    const keys = Object.keys(fr);
    expect(DYNAMIC_KEYS.filter((f) => !keys.some((k) => f.pattern.test(k)))).toEqual([]);
    for (const f of DYNAMIC_KEYS) {
      const file = f.builtBy.split(" ")[0]!;
      expect(
        SOURCES.some((s) => s.path.endsWith(file)),
        file,
      ).toBe(true);
    }
  });
});
