// Convertit docs/research/rules.yaml (source de vérité) en JSON embarqué par @blondel/core.
// Usage : pnpm rules:build. Un test vérifie que le JSON est à jour.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = readFileSync(root + "docs/research/rules.yaml", "utf8");
const data = parse(src);
writeFileSync(
  root + "packages/core/src/rules/rules.data.json",
  JSON.stringify(data, null, 2) + "\n",
);
console.log(`rules.data.json : ${data.regles.length} règles`);
