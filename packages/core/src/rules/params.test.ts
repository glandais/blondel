/**
 * Constantes nommées de `rules/params.ts` : pas de doublon en dur hors de rules.yaml (relecture
 * adverse de la vague J, QUESTIONS D2).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ASSISTANT_DEFAULTS } from "../assistant/defaults.js";
import { LF_WIDE_THRESHOLD } from "./params.js";

const SRC = fileURLToPath(new URL("../", import.meta.url));

/** Code d'un fichier source sans ses commentaires. */
function code(file: string): string {
  return readFileSync(SRC + file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("seuil d'emmarchement des lignes de foulée (LF_POSITION_*.parametres.E_seuil)", () => {
  it("lu dans rules.yaml par les préréglages et l'assistant (aucun 1 200 en dur)", () => {
    for (const f of ["project/presets.ts", "assistant/defaults.ts"])
      expect(code(f), f).not.toMatch(/\b1_?200\b/);
    expect(ASSISTANT_DEFAULTS.widthMax).toBe(LF_WIDE_THRESHOLD.value);
  });
});
