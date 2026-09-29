/**
 * Exemple du jalon 5a : `examples/j5a-helicoidal.blondel.json` (préréglage hélicoïdal, structure
 * `helical-core` : fût acier, marches en tôle, limon extérieur hélicoïdal, main courante).
 * Régénération : `UPDATE_EXAMPLES=1 pnpm vitest run packages/core/src/structures/helicalExample.test.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Project } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { parseProjectText } from "../project/parse.js";
import { createProject, PRESET_HEADROOM_MIN } from "../project/presets.js";
import { serializeProject } from "../project/serialize.js";
import { withHelicalCore } from "./helicalCore.js";
import { ruledFlatGap } from "./ruled.test-helpers.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
export const J5A_HELICAL = "j5a-helicoidal.blondel.json";

/**
 * Hélicoïdal à fût central du préréglage, structure `helical-core` complète. H = 2 750 mm et
 * R_e = 950 mm (Ø 1 900) : avec les valeurs par défaut (2 700 / 900), le test de bout en bout
 * des exports compte une page de moins dans le PDF que dans son plan de pages (largeur de texte
 * estimée par `RecordingCanvas`), fragilité signalée au ledger (§3, exports).
 */
export function helicalExample(): Project {
  // Marches en tôle sans contremarche (usage des hélicoïdaux métalliques ; le préréglage pose des
  // contremarches pleines depuis le 2026-09-30) : `VIDE_ENTRE_MARCHES` reste en conseil.
  const p = createProject("helical", {
    name: "Jalon 5a — hélicoïdal à fût central",
    floorToFloor: 2750,
    outerRadius: 950,
    patch: { stair: { treads: { risers: "none" } } },
  });
  return withHelicalCore(p, {
    treads: { material: "steel" },
    outerStringer: { enabled: true },
  });
}

if (process.env["UPDATE_EXAMPLES"] === "1") {
  writeFileSync(join(EXAMPLES_DIR, J5A_HELICAL), serializeProject(helicalExample()));
}

describe(`examples/${J5A_HELICAL}`, () => {
  const text = readFileSync(join(EXAMPLES_DIR, J5A_HELICAL), "utf8");

  it("est à jour avec son générateur et relu à l'identique", () => {
    expect(text).toBe(serializeProject(helicalExample()));
    expect(serializeProject(parseProjectText(text))).toBe(text);
  });

  it("modèle complet : fût, marches en tôle, limon développé, main courante, échappée", () => {
    const project = parseProjectText(text);
    const m = buildModel(project);
    expect(m.errors).toEqual([]);
    expect(m.layout.helical).toBeDefined();
    const ids = m.parts.map((p) => p.id);
    for (const id of [
      "helical-column",
      "helical-stringer",
      "helical-handrail",
      "landing-arrival",
    ]) {
      expect(ids).toContain(id);
    }
    expect(m.parts.find((p) => p.id === "helical-stringer")?.flat?.reference?.kind).toBe(
      "neutral-fiber",
    );
    expect(m.headroom!.min).toBeGreaterThanOrEqual(PRESET_HEADROOM_MIN);
    const blocking = m.compliance.results.filter(
      (r) => r.status === "violation" && r.severity === "bloquant",
    );
    expect(blocking.map((r) => r.ruleId)).toEqual([]);
    const cantilever = m.compliance.results.find((r) => r.ruleId === "HELICOIDAL_PORTE_A_FAUX");
    expect(cantilever?.status).toBe("violation");
    expect(cantilever?.severity).toBe("avertissement");
  });

  it("limon hélicoïdal : solide 3D conforme au développé, coin de la coupe au sol compris", () => {
    // Le coin où la rive basse atteint le sol est une génératrice du solide (sinon 2,35 mm
    // d'écart ici, 6 mm avec H = 3 000).
    const project = parseProjectText(text);
    for (const h of [project.site.floorToFloor, 3000]) {
      const m = buildModel({ ...project, site: { ...project.site, floorToFloor: h } });
      const stringer = m.parts.find((p) => p.id === "helical-stringer")!;
      expect(ruledFlatGap(stringer), `H = ${h}`).toBeLessThan(0.5);
    }
  });
});
