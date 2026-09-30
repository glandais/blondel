// Dictionnaires packages/i18n/src/locales/*.json (ADR-0007).
//
// - `pnpm i18n:sort` : trie les clés de fr.json, en.json et des fragments _wip/*.json (ordre des
//   unités de code, comme `compareKeys` dans packages/i18n/src/consistency.ts).
// - `pnpm i18n:merge` : fusionne en plus les fragments _wip/<domaine>.{fr,en}.json dans fr.json /
//   en.json, supprime _wip/ et remet locales/wip.ts à vide. Une clé présente deux fois avec des
//   textes différents arrête la fusion sans rien écrire.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../packages/i18n/src/locales/", import.meta.url));
const wipDir = join(dir, "_wip");
const merge = process.argv.includes("--merge");

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const write = (path, messages) => {
  const sorted = {};
  for (const key of Object.keys(messages).sort(compare)) sorted[key] = messages[key];
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`);
};

const wipFiles = existsSync(wipDir)
  ? readdirSync(wipDir)
      .filter((n) => n.endsWith(".json"))
      .sort(compare)
  : [];

if (!merge) {
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    write(join(dir, name), read(join(dir, name)));
  }
  for (const name of wipFiles) write(join(wipDir, name), read(join(wipDir, name)));
} else {
  const conflicts = [];
  const merged = {};
  for (const locale of ["fr", "en"]) {
    const target = read(join(dir, `${locale}.json`));
    const origin = Object.fromEntries(Object.keys(target).map((k) => [k, `${locale}.json`]));
    for (const name of wipFiles.filter((n) => n.endsWith(`.${locale}.json`))) {
      for (const [key, text] of Object.entries(read(join(wipDir, name)))) {
        if (key in target && target[key] !== text) {
          conflicts.push(`${key} : ${name} ≠ ${origin[key]}`);
        } else {
          target[key] = text;
          origin[key] = name;
        }
      }
    }
    merged[locale] = target;
  }
  if (conflicts.length > 0) {
    console.error(`Fusion interrompue, clés en conflit :\n${conflicts.join("\n")}`);
    process.exit(1);
  }
  for (const locale of ["fr", "en"]) write(join(dir, `${locale}.json`), merged[locale]);
  rmSync(wipDir, { recursive: true, force: true });
  const wipTs = join(dir, "wip.ts");
  const source = readFileSync(wipTs, "utf8");
  const header = source.slice(0, source.indexOf("export interface WipFragment"));
  writeFileSync(
    wipTs,
    `${header.replace(/^import .*\n/gm, "").replace(/\n{3,}/g, "\n\n")}export interface WipFragment {
  readonly name: string;
  readonly fr: Readonly<Record<string, string>>;
  readonly en: Readonly<Record<string, string>>;
}

export const WIP_FRAGMENTS: readonly WipFragment[] = [];

/** Union des fragments français (fournit les clés au type \`MessageKey\`). */
export const WIP_FR = {};

/** Union des fragments anglais. */
export const WIP_EN = {};
`,
  );
  console.log(`${wipFiles.length} fragment(s) fusionné(s) ; locales/wip.ts remis à vide.`);
}
