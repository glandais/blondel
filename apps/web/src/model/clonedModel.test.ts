/**
 * Le modèle publié par le worker de calcul est une **copie** (`postMessage` clone les objets,
 * sans prototypes ni fonctions) : les exports et vues du fil principal doivent donner le même
 * résultat sur la copie que sur le modèle d'origine.
 */
import { buildModel, clearModelCache, parseProjectText } from "@blondel/core";
import { describe, expect, it } from "vitest";
import { EXPORT_ENTRIES, buildExport } from "../lib/exportFiles.js";
import j3aText from "../../../../examples/j3a-acceptance-01-bois.blondel.json?raw";
import j4Text from "../../../../examples/j4-acceptance-01-garde-corps.blondel.json?raw";

describe("modèle cloné (worker) : exports identiques", () => {
  for (const [name, text] of [
    ["j3a", j3aText],
    ["j4", j4Text],
  ] as const) {
    it(
      name,
      async () => {
        clearModelCache();
        const project = parseProjectText(text);
        const model = buildModel(project);
        const cloned = structuredClone(model);
        for (const e of EXPORT_ENTRIES) {
          if (e.id === "pdf") continue;
          const a = await buildExport(e.id, project, model).catch((x: unknown) => String(x));
          const b = await buildExport(e.id, project, cloned).catch((x: unknown) => String(x));
          expect(b, e.id).toEqual(a);
        }
      },
      60_000,
    );
  }
});
