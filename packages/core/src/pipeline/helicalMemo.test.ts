/**
 * Mémoïsation après la bascule de l'hélicoïdal sur le moteur de cage (F10, sous-lot P2) : la
 * conversion `helicalToCage` est interne à `computeLayout` (étage mémoïsé du pipeline) et ses
 * objets jetables ne servent de clé à aucun cache. Deux projets à partage structurel qui ne
 * diffèrent que par les réglages de structure rendent donc le **même** tracé et le **même**
 * découpage (identité d'objet, dont dépendent les caches aval et ceux du worker), et un même
 * projet rend le même `Model`.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Project } from "../model/project.js";
import { parseProjectText } from "../project/parse.js";
import { buildModel, clearModelCache } from "./build.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const j5a = (): Project =>
  parseProjectText(readFileSync(join(EXAMPLES_DIR, "j5a-helicoidal.blondel.json"), "utf8"));

describe("hélicoïdal sur le moteur de cage (F10, P2) — identité d'objet", () => {
  it("réglages de structure seuls modifiés : même tracé, même découpage (===)", () => {
    clearModelCache();
    const p = j5a();
    const params = p.stair.structure.params as Record<string, unknown>;
    const p2: Project = {
      ...p,
      stair: {
        ...p.stair,
        structure: {
          ...p.stair.structure,
          params: { ...params, outerStringer: { enabled: false } },
        },
      },
    };
    const m1 = buildModel(p);
    const m2 = buildModel(p2);
    expect(m1.layout.helicalOrigin).toBeDefined();
    expect(m2).not.toBe(m1);
    expect(m2.layout).toBe(m1.layout);
    expect(m2.stepping).toBe(m1.stepping);
    expect(m2.layout.helical).toBe(m1.layout.helical);
  });

  it("même projet : même Model (===)", () => {
    clearModelCache();
    const p = j5a();
    expect(buildModel(p)).toBe(buildModel(p));
  });
});
