/**
 * Classe d'exécution EN 1090-2 (C §2.1, CNC2M N0169) : la nuance S355 ne fait passer en PC2
 * (donc EXC2) que les éléments soudés ; un élément non soudé reste en PC1 quelle que soit la
 * nuance.
 */
import { describe, expect, it } from "vitest";
import { buildModel } from "../pipeline/build.js";
import { createProject } from "../project/presets.js";
import "./index.js";
import { deduceExecutionClass, QUANTITY_WELD_MM } from "./steelCommon.js";
import { frList } from "../i18n.test-helpers.js";

describe("deduceExecutionClass", () => {
  it("S235 sans soudure bout à bout : EXC1 ; soudure bout à bout ou formage à chaud : EXC2", () => {
    expect(deduceExecutionClass({ grade: "S235", buttWeld: 0 }).executionClass).toBe("EXC1");
    expect(deduceExecutionClass({ grade: "S235", buttWeld: 120 }).executionClass).toBe("EXC2");
    expect(
      deduceExecutionClass({ grade: "S235", buttWeld: 0, hotForming: true }).executionClass,
    ).toBe("EXC2");
  });

  it("S355 soudé : EXC2 ; S355 sans aucune soudure : EXC1 (PC1, éléments non soudés)", () => {
    const welded = deduceExecutionClass({ grade: "S355", buttWeld: 0, welded: true });
    expect(welded.executionClass).toBe("EXC2");
    expect(frList(welded.reasons)).toEqual(["nuance S355 soudée"]);
    const bolted = deduceExecutionClass({ grade: "S355", buttWeld: 0, welded: false });
    expect(bolted).toEqual({ executionClass: "EXC1", reasons: [] });
    // Sans l'information : lecture conservatrice (soudé).
    expect(deduceExecutionClass({ grade: "S355", buttWeld: 0 }).executionClass).toBe("EXC2");
  });
});

describe("plugins métal : champ `welded` renseigné d'après les cordons des pièces", () => {
  const run = (kind: string, params: Record<string, unknown>) => {
    const p = createProject("straight");
    return buildModel({ ...p, stair: { ...p.stair, structure: { kind, params } } });
  };
  const weld = (m: ReturnType<typeof buildModel>): number =>
    m.parts.reduce((acc, p) => acc + (p.quantities[QUANTITY_WELD_MM] ?? 0), 0);

  it.each(["steel-flat", "steel-profile"])(
    "%s en S355 entièrement vissé : aucun cordon, EXC1 ; supports soudés : EXC2",
    (kind) => {
      // Platines de pied et de tête (soudées sur les limons de `steel-flat`) désactivées.
      const bolted = run(kind, {
        grade: "S355",
        splice: "bolted",
        supports: { fixing: "bolted" },
        ...(kind === "steel-flat" ? { plates: { foot: false, head: false } } : {}),
      });
      expect(bolted.errors).toEqual([]);
      expect(weld(bolted)).toBe(0);
      expect(bolted.executionClass).toBe("EXC1");
      const welded = run(kind, { grade: "S355", supports: { fixing: "welded" } });
      expect(weld(welded)).toBeGreaterThan(0);
      expect(welded.executionClass).toBe("EXC2");
    },
  );
});
